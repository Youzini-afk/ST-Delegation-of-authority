import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { AgentHostToolService } from './agent-host-tools.js';
import type { AgentCompletionRequester, AgentLlmCompletionResponse } from './agent-llm-client.js';
import { AgentService, type AgentServiceOptions } from './agent-service.js';
import { AgentStoreService } from './agent-store-service.js';
import { WorkspaceHistoryService } from './workspace-history-service.js';

const tempDirs: string[] = [];

afterEach(() => {
    for (const dir of tempDirs.splice(0)) {
        fs.rmSync(dir, { recursive: true, force: true });
    }
});

describe('AgentService', () => {
    it('defers persisted-run recovery so plugin initialization is not blocked', async () => {
        const base = fs.mkdtempSync(path.join(os.tmpdir(), 'authority-agent-start-'));
        tempDirs.push(base);
        const root = path.join(base, 'workspace');
        fs.mkdirSync(root);
        const history = new WorkspaceHistoryService(path.join(base, 'history'));
        await history.registerWorkspace({ id: 'workspace', rootPath: root });
        const store = new AgentStoreService(path.join(base, 'agent'));
        const startStore = vi.spyOn(store, 'start');
        const agent = new AgentService(store, history, new AgentHostToolService(history), {
            requestCompletion: sequenceRequester([finalMessage('done')]),
        });

        const startup = agent.start();
        expect(startStore).not.toHaveBeenCalled();
        await startup;
        expect(startStore).toHaveBeenCalledOnce();
        await agent.stop();
    });

    it('runs an approved mutation through recoverable before/after checkpoints', async () => {
        const requester = sequenceRequester([
            toolCall('call-1', 'host_write_file', { path: 'config.json', content: '{"ok":true}' }),
            finalMessage('Done and verified.'),
        ]);
        const fixture = await createFixture(requester);
        const run = fixture.agent.createRun({ goal: 'Create config.json', mode: 'ask' }, 'test-extension');

        const waiting = await waitFor(() => fixture.agent.getRun(run.id), detail => detail.run.status === 'waiting_approval');
        const approval = waiting.approvals[0]!;
        expect(waiting.run.pendingApprovalId).toBe(approval.id);
        expect(fs.existsSync(path.join(fixture.root, 'config.json'))).toBe(false);
        fixture.agent.resolveApproval(run.id, approval.id, { decision: 'approve' });

        const completed = await waitFor(() => fixture.agent.getRun(run.id), detail => detail.run.status === 'completed');
        expect(fs.readFileSync(path.join(fixture.root, 'config.json'), 'utf8')).toBe('{"ok":true}');
        expect(completed.run).toMatchObject({ status: 'completed', finalText: 'Done and verified.', stepCount: 2 });
        expect(completed.invocations).toMatchObject([{ toolId: 'host_write_file', status: 'completed' }]);
        expect(completed.events.filter(event => event.type === 'workspace.checkpoint')).toHaveLength(1);
        const commits = fixture.history.listCommits('workspace');
        expect(commits.map(commit => commit.message)).toEqual(['After Write workspace file', 'Before Write workspace file']);
        await fixture.agent.stop();
    });

    it('does not expose mutating tools in plan mode', async () => {
        const requester = vi.fn<AgentCompletionRequester>(async (_profile, request) => {
            expect(request.tools.map(tool => tool.function.name)).not.toContain('host_write_file');
            expect(request.tools.map(tool => tool.function.name)).not.toContain('host_shell');
            return finalMessage('Read-only plan.');
        });
        const fixture = await createFixture(requester);
        const run = fixture.agent.createRun({ goal: 'Plan a change', mode: 'plan' });
        const completed = await waitFor(() => fixture.agent.getRun(run.id), detail => detail.run.status === 'completed');
        expect(completed.invocations).toEqual([]);
        expect(requester).toHaveBeenCalledOnce();
        await fixture.agent.stop();
    });

    it('returns a denied tool result to the model without changing the workspace', async () => {
        const requester = sequenceRequester([
            toolCall('call-denied', 'host_write_file', { path: 'denied.txt', content: 'no' }),
            finalMessage('The requested write was denied.'),
        ]);
        const fixture = await createFixture(requester);
        const run = fixture.agent.createRun({ goal: 'Try a write', mode: 'ask' });
        const waiting = await waitFor(() => fixture.agent.getRun(run.id), detail => detail.run.status === 'waiting_approval');
        fixture.agent.resolveApproval(run.id, waiting.approvals[0]!.id, { decision: 'deny' });
        const completed = await waitFor(() => fixture.agent.getRun(run.id), detail => detail.run.status === 'completed');
        expect(fs.existsSync(path.join(fixture.root, 'denied.txt'))).toBe(false);
        expect(completed.invocations[0]).toMatchObject({ status: 'cancelled', error: expect.stringContaining('denied') });
        expect(completed.messages.find(message => message.toolCallId === 'call-denied')?.content).toContain('"ok":false');
        await fixture.agent.stop();
    });

    it('does not execute an approved mutation after the run is cancelled', async () => {
        const requester = sequenceRequester([
            toolCall('call-race', 'host_write_file', { path: 'race.txt', content: 'must not exist' }),
            finalMessage('unexpected'),
        ]);
        const fixture = await createFixture(requester);
        const run = fixture.agent.createRun({ goal: 'Race approval and cancellation', mode: 'ask' });
        const waiting = await waitFor(() => fixture.agent.getRun(run.id), detail => detail.run.status === 'waiting_approval');
        fixture.agent.resolveApproval(run.id, waiting.approvals[0]!.id, { decision: 'approve' });
        fixture.agent.cancelRun(run.id);
        await new Promise(resolve => setTimeout(resolve, 30));
        expect(fixture.agent.getRun(run.id).run.status).toBe('cancelled');
        expect(fs.existsSync(path.join(fixture.root, 'race.txt'))).toBe(false);
        await fixture.agent.stop();
    });

    it('expires unanswered approvals and releases the run', async () => {
        const requester = sequenceRequester([
            toolCall('call-expired', 'host_write_file', { path: 'expired.txt', content: 'no' }),
            finalMessage('Approval expired.'),
        ]);
        const fixture = await createFixture(requester, { approvalTimeoutMs: 20 });
        const run = fixture.agent.createRun({ goal: 'Wait for approval', mode: 'ask' });
        const completed = await waitFor(() => fixture.agent.getRun(run.id), detail => detail.run.status === 'completed');
        expect(completed.approvals[0]?.status).toBe('expired');
        expect(completed.invocations[0]).toMatchObject({ status: 'timed_out' });
        expect(fs.existsSync(path.join(fixture.root, 'expired.txt'))).toBe(false);
        await fixture.agent.stop();
    });

    it('keeps a cancelled run terminal when a completion ignores abort', async () => {
        let resolveCompletion!: (value: AgentLlmCompletionResponse) => void;
        const requester = vi.fn<AgentCompletionRequester>(() => new Promise(resolve => { resolveCompletion = resolve; }));
        const fixture = await createFixture(requester);
        const run = fixture.agent.createRun({ goal: 'Wait for model' });
        await waitFor(() => requester.mock.calls.length, count => count === 1);
        fixture.agent.cancelRun(run.id);
        resolveCompletion(finalMessage('late response'));
        await new Promise(resolve => setTimeout(resolve, 30));
        expect(fixture.agent.getRun(run.id).run).toMatchObject({ status: 'cancelled' });
        expect(fixture.agent.getRun(run.id).run.finalText).toBeUndefined();
        await fixture.agent.stop();
    });

    it('records the failure checkpoint head when a shell is cancelled after writing', async () => {
        const script = "require('fs').writeFileSync('partial.txt','partial');setTimeout(()=>{},5000)";
        const command = `"${process.execPath}" -e "${script}"`;
        const requester = sequenceRequester([
            toolCall('call-shell', 'host_shell', { command }),
            finalMessage('unexpected'),
        ]);
        const fixture = await createFixture(requester);
        const run = fixture.agent.createRun({ goal: 'Run a partial shell command', mode: 'ask' });
        const waiting = await waitFor(() => fixture.agent.getRun(run.id), detail => detail.run.status === 'waiting_approval');
        fixture.agent.resolveApproval(run.id, waiting.approvals[0]!.id, { decision: 'approve' });
        await waitFor(() => fs.existsSync(path.join(fixture.root, 'partial.txt')), Boolean);
        fixture.agent.cancelRun(run.id);
        const synced = await waitFor(
            () => fixture.agent.getRun(run.id),
            detail => detail.events.some(event => event.type === 'workspace.checkpoint' && (event.payload as any)?.failed === true),
        );
        expect(synced.run.headCommitId).toBe(fixture.history.getWorkspace('workspace').headCommitId);
        expect(fs.readFileSync(path.join(fixture.root, 'partial.txt'), 'utf8')).toBe('partial');
        await fixture.agent.stop();
    });

    it('bounds shutdown when a completion requester ignores abort forever', async () => {
        const requester = vi.fn<AgentCompletionRequester>(() => new Promise(() => {}));
        const fixture = await createFixture(requester, { shutdownTimeoutMs: 20 });
        const run = fixture.agent.createRun({ goal: 'Never resolve' });
        await waitFor(() => requester.mock.calls.length, count => count === 1);
        const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
        await fixture.agent.stop();
        expect(fixture.agent.getRun(run.id).run.status).toBe('interrupted');
        expect(warn).toHaveBeenCalledWith(expect.stringContaining('did not stop'));
        await expect(fixture.agent.start()).rejects.toThrow('cannot restart');
    });
});

async function createFixture(requestCompletion: AgentCompletionRequester, options: Omit<AgentServiceOptions, 'requestCompletion'> = {}) {
    const base = fs.mkdtempSync(path.join(os.tmpdir(), 'authority-agent-service-'));
    tempDirs.push(base);
    const root = path.join(base, 'workspace');
    fs.mkdirSync(root);
    const history = new WorkspaceHistoryService(path.join(base, 'history'));
    await history.registerWorkspace({ id: 'workspace', rootPath: root });
    const store = new AgentStoreService(path.join(base, 'agent'));
    const agent = new AgentService(store, history, new AgentHostToolService(history), { requestCompletion, ...options });
    agent.upsertProfile({
        id: 'profile',
        displayName: 'Test',
        provider: 'openai-compatible',
        baseUrl: 'http://localhost:1234/v1',
        model: 'test',
    });
    await agent.start();
    return { base, root, history, store, agent };
}

function sequenceRequester(responses: AgentLlmCompletionResponse[]): AgentCompletionRequester {
    let index = 0;
    return vi.fn(async () => responses[index++] ?? finalMessage('Unexpected extra step'));
}

function toolCall(id: string, name: string, args: unknown): AgentLlmCompletionResponse {
    return {
        message: {
            role: 'assistant',
            content: null,
            toolCalls: [{ id, name, arguments: JSON.stringify(args) }],
        },
        finishReason: 'tool_calls',
    };
}

function finalMessage(content: string): AgentLlmCompletionResponse {
    return { message: { role: 'assistant', content }, finishReason: 'stop' };
}

async function waitFor<T>(read: () => T, done: (value: T) => boolean): Promise<T> {
    const deadline = Date.now() + 5_000;
    while (Date.now() < deadline) {
        const value = read();
        if (done(value)) {
            return value;
        }
        await new Promise(resolve => setTimeout(resolve, 10));
    }
    throw new Error('Timed out waiting for Agent state');
}

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { AuthorityServiceError } from '../utils.js';
import { AgentHostToolService } from './agent-host-tools.js';
import type { AgentCompletionRequester, AgentLlmCompletionResponse } from './agent-llm-client.js';
import { AgentService, type AgentServiceOptions } from './agent-service.js';
import { AgentStoreService } from './agent-store-service.js';
import type { ModuleHostService } from './module-host-service.js';
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

    it('rate-limits repeated run starts for one user', async () => {
        const fixture = await createFixture(vi.fn(async () => finalMessage('done')));
        for (let index = 0; index < 30; index += 1) {
            const run = fixture.agent.createRun({ goal: `Run ${index}`, workspaceId: 'workspace' });
            fixture.agent.cancelRun(run.id);
        }

        expect(() => fixture.agent.createRun({ goal: 'One too many', workspaceId: 'workspace' }))
            .toThrow('Agent run rate limit reached');
        await fixture.agent.stop();
    });

    it('keeps one user waiting for approval from occupying the whole global queue', async () => {
        const requester = vi.fn<AgentCompletionRequester>(async (_profile, request) => {
            const prompt = request.messages.find(message => message.role === 'user')?.content ?? '';
            return prompt.includes('Bob')
                ? finalMessage('Bob completed.')
                : toolCall(`call-${request.messages.length}`, 'host_write_file', { path: 'alice.txt', content: 'waiting' });
        });
        const fixture = await createFixture(requester, { maxConcurrentRuns: 2 });
        const caller = (handle: string) => ({
            user: { handle, isAdmin: false, rootDir: fixture.base },
            session: { extension: { id: 'test-extension' } },
        } as any);

        const first = fixture.agent.createRun(
            { goal: 'Alice first', mode: 'ask', workspaceId: 'workspace' },
            'test-extension',
            caller('alice'),
        );
        const second = fixture.agent.createRun(
            { goal: 'Alice second', mode: 'ask', workspaceId: 'workspace' },
            'test-extension',
            caller('alice'),
        );
        const bob = fixture.agent.createRun(
            { goal: 'Bob can proceed', mode: 'ask', workspaceId: 'workspace' },
            'test-extension',
            caller('bob'),
        );

        await waitFor(() => fixture.agent.getRun(first.id), detail => detail.run.status === 'waiting_approval');
        expect(fixture.agent.getRun(second.id).run.status).toBe('queued');
        await waitFor(() => fixture.agent.getRun(bob.id), detail => detail.run.status === 'completed');
        fixture.agent.cancelRun(first.id);
        fixture.agent.cancelRun(second.id);
        await fixture.agent.stop();
    });

    it('rejects callers outside the workspace ACL inside the Agent service', async () => {
        const fixture = await createFixture(vi.fn(async () => finalMessage('done')));
        const callerContext = {
            user: { handle: 'carol', isAdmin: false, rootDir: fixture.base },
            session: { extension: { id: 'test-extension' } },
        } as any;

        expect(() => fixture.agent.createRun(
            { goal: 'Read another user workspace', workspaceId: 'workspace' },
            'test-extension',
            callerContext,
        )).toThrow('Workspace not found');
        await fixture.agent.stop();
    });

    it('runs an approved mutation through recoverable before/after checkpoints', async () => {
        const requester = sequenceRequester([
            toolCall('call-1', 'host_write_file', { path: 'config.json', content: '{"ok":true}' }),
            finalMessage('Done and verified.'),
        ]);
        const fixture = await createFixture(requester);
        const run = fixture.agent.createRun({ goal: 'Create config.json', mode: 'ask', workspaceId: 'workspace' }, 'test-extension');

        const waiting = await waitFor(() => fixture.agent.getRun(run.id), detail => detail.run.status === 'waiting_approval');
        const approval = waiting.approvals[0]!;
        expect(waiting.run.pendingApprovalId).toBe(approval.id);
        expect(fs.existsSync(path.join(fixture.root, 'config.json'))).toBe(false);
        const resolved = fixture.agent.resolveApproval(run.id, approval.id, { decision: 'approve' }, 'admin');
        expect(resolved.resolvedByUserHandle).toBe('admin');

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
        const run = fixture.agent.createRun({ goal: 'Plan a change', mode: 'plan', workspaceId: 'workspace' });
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
        const run = fixture.agent.createRun({ goal: 'Try a write', mode: 'ask', workspaceId: 'workspace' });
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
        const run = fixture.agent.createRun({ goal: 'Race approval and cancellation', mode: 'ask', workspaceId: 'workspace' });
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
        const run = fixture.agent.createRun({ goal: 'Wait for approval', mode: 'ask', workspaceId: 'workspace' });
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
        const run = fixture.agent.createRun({ goal: 'Wait for model', workspaceId: 'workspace' });
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
        const run = fixture.agent.createRun({ goal: 'Run a partial shell command', mode: 'ask', workspaceId: 'workspace' });
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
        const run = fixture.agent.createRun({ goal: 'Never resolve', workspaceId: 'workspace' });
        await waitFor(() => requester.mock.calls.length, count => count === 1);
        const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
        await fixture.agent.stop();
        expect(fixture.agent.getRun(run.id).run.status).toBe('interrupted');
        expect(warn).toHaveBeenCalledWith(expect.stringContaining('did not stop'));
        await expect(fixture.agent.start()).rejects.toThrow('cannot restart');
    });

    it('persists browser tool claim and result before continuing the run', async () => {
        let browserToolName = '';
        const callId = 'c'.repeat(256);
        const requester = vi.fn<AgentCompletionRequester>(async (_profile, request) => {
            if (!browserToolName) {
                browserToolName = request.tools.find(tool => tool.function.name.includes('memory_lookup'))!.function.name;
                return toolCall(callId, browserToolName, { query: 'name' });
            }
            return finalMessage('Browser memory received.');
        });
        const fixture = await createFixture(requester);
        const registration = fixture.agent.registerBrowserTools('authority', 'test-extension', {
            browserInstanceId: 'browser-1',
            tools: [{
                id: 'memory_lookup',
                title: 'Look up memory',
                description: 'Return a memory from the active browser plugin.',
                inputSchema: { type: 'object' },
                riskLevel: 'low',
                approvalPolicy: 'never',
                mutatesWorkspace: false,
            }],
        });
        expect(registration.tools[0]).toMatchObject({ riskLevel: 'medium', approvalPolicy: 'on-mutation' });
        const run = fixture.agent.createRun({ goal: 'Use browser memory', mode: 'auto', workspaceId: 'workspace' }, 'test-extension');
        const waiting = await waitFor(() => fixture.agent.getRun(run.id), detail => detail.run.status === 'waiting_browser_tool');
        expect(waiting.invocations[0]).toMatchObject({ toolId: registration.tools[0]!.id, status: 'pending' });

        const claimed = fixture.agent.claimBrowserTool('authority', 'test-extension', {
            browserInstanceId: 'browser-1',
            claimId: 'claim-browser',
        });
        expect(claimed.invocation).toMatchObject({ runId: run.id, callId, status: 'claimed', claimId: 'claim-browser' });
        expect(fixture.agent.claimBrowserTool('authority', 'test-extension', {
            browserInstanceId: 'browser-1',
            claimId: 'another-claim',
        }).invocation).toBeNull();
        expect(fixture.agent.claimBrowserTool('authority', 'test-extension', {
            browserInstanceId: 'browser-1',
            claimId: 'claim-browser',
        }).invocation?.callId).toBe(callId);
        expect(() => fixture.agent.submitBrowserToolResult('authority', 'another-extension', {
            runId: run.id,
            callId,
            claimId: 'claim-browser',
            browserInstanceId: 'browser-1',
            status: 'completed',
            result: { value: 'wrong' },
        })).toThrow(/unavailable/);
        fixture.agent.submitBrowserToolResult('authority', 'test-extension', {
            runId: run.id,
            callId,
            claimId: 'claim-browser',
            browserInstanceId: 'browser-1',
            status: 'completed',
            result: { value: 'remembered' },
        });

        const completed = await waitFor(() => fixture.agent.getRun(run.id), detail => detail.run.status === 'completed');
        expect(completed.invocations[0]).toMatchObject({ status: 'completed', result: { value: 'remembered' } });
        expect(completed.events.some(event => event.type === 'tool.waiting_browser')).toBe(true);
        expect(completed.messages.find(message => message.toolCallId === callId)?.content).toContain('remembered');
        await fixture.agent.stop();
    });

    it('scopes browser registrations by user and versions descriptor changes', async () => {
        const fixture = await createFixture(sequenceRequester([finalMessage('done')]));
        const request = {
            browserInstanceId: 'browser-1',
            tools: [{
                id: 'memory_lookup',
                title: 'Look up memory',
                description: 'Read memory version one.',
                inputSchema: { type: 'object' },
                riskLevel: 'low' as const,
                approvalPolicy: 'never' as const,
                mutatesWorkspace: false as const,
            }],
        };

        const first = fixture.agent.registerBrowserTools('alice', 'test-extension', request);
        const renewed = fixture.agent.registerBrowserTools('alice', 'test-extension', request);
        const changed = fixture.agent.registerBrowserTools('alice', 'test-extension', {
            ...request,
            tools: [{ ...request.tools[0]!, description: 'Read memory version two.' }],
        });

        expect(renewed.registrationId).toBe(first.registrationId);
        expect(renewed.tools[0]!.id).toBe(first.tools[0]!.id);
        expect(changed.registrationId).not.toBe(first.registrationId);
        expect(changed.tools[0]!.id).not.toBe(first.tools[0]!.id);
        expect(fixture.agent.listTools('test-extension', 'alice').some(tool => tool.id === changed.tools[0]!.id)).toBe(true);
        expect(fixture.agent.listTools('test-extension', 'bob').some(tool => tool.execution === 'browser')).toBe(false);
        await fixture.agent.stop();
    });

    it('interrupts a run when a claimed browser timeout leaves an unknown outcome', async () => {
        let requested = false;
        const requester = vi.fn<AgentCompletionRequester>(async (_profile, request) => {
            if (!requested) {
                requested = true;
                const name = request.tools.find(tool => tool.function.name.includes('slow_browser'))!.function.name;
                return toolCall('call-slow', name, {});
            }
            return finalMessage('Handled unknown outcome.');
        });
        const fixture = await createFixture(requester, { browserToolTimeoutMs: 1_000 });
        fixture.agent.registerBrowserTools('authority', 'test-extension', {
            browserInstanceId: 'browser-1',
            tools: [{
                id: 'slow_browser',
                title: 'Slow browser tool',
                description: 'May finish after the service deadline.',
                inputSchema: { type: 'object' },
                riskLevel: 'low',
                approvalPolicy: 'never',
                mutatesWorkspace: false,
            }],
        });
        const run = fixture.agent.createRun({ goal: 'Call a slow browser tool', mode: 'auto', workspaceId: 'workspace' }, 'test-extension');
        await waitFor(() => fixture.agent.getRun(run.id), detail => detail.run.status === 'waiting_browser_tool');
        fixture.agent.claimBrowserTool('authority', 'test-extension', {
            browserInstanceId: 'browser-1',
            claimId: 'claim-slow',
        });

        const interrupted = await waitFor(() => fixture.agent.getRun(run.id), detail => detail.run.status === 'interrupted');

        expect(interrupted.invocations[0]).toMatchObject({ status: 'outcome_unknown' });
        expect(interrupted.messages.find(message => message.toolCallId === 'call-slow')?.content).toContain('side effects are unknown');
        expect(requester).toHaveBeenCalledTimes(1);
        await fixture.agent.stop();
    });

    it('maps loaded module transactions into the same Agent tool loop', async () => {
        const execute = vi.fn(async () => ({
            ok: true as const,
            moduleId: 'sample.module',
            transaction: 'echo',
            transactionVersion: '1',
            result: { echoed: true },
        }));
        const moduleHost = {
            listManifests: () => ({
                count: 1,
                modules: [sampleModuleManifest()],
            }),
            execute,
        } as unknown as ModuleHostService;
        let requested = false;
        const requester = vi.fn<AgentCompletionRequester>(async (_profile, request) => {
            if (!requested) {
                requested = true;
                const name = request.tools.find(tool => tool.function.name.startsWith('module_sample_module_echo'))!.function.name;
                return toolCall('call-module', name, { input: { value: 'hello' } });
            }
            return finalMessage('Module completed.');
        });
        const fixture = await createFixture(requester, { moduleHost });
        const callerContext = {
            user: { handle: 'alice', isAdmin: false, rootDir: fixture.base },
            session: { extension: { id: 'test-extension' } },
        } as any;
        const run = fixture.agent.createRun({ goal: 'Call the sample module', workspaceId: 'workspace' }, 'test-extension', callerContext);
        const completed = await waitFor(() => fixture.agent.getRun(run.id), detail => detail.run.status === 'completed');
        expect(execute).toHaveBeenCalledWith(
            callerContext.user,
            callerContext.session,
            'sample.module',
            'echo',
            { input: { value: 'hello' } },
            expect.objectContaining({ aborted: false }),
        );
        expect(completed.invocations[0]).toMatchObject({ toolId: 'module:sample.module:echo', status: 'completed' });
        await fixture.agent.stop();
    });

    it('interrupts a run when a module timeout leaves an unknown outcome', async () => {
        const execute = vi.fn().mockRejectedValue(new AuthorityServiceError(
            'Module transaction timed out',
            504,
            'timeout',
            'timeout',
            { code: 'transaction_timeout' },
        ));
        const moduleHost = {
            listManifests: () => ({ count: 1, modules: [sampleModuleManifest()] }),
            execute,
        } as unknown as ModuleHostService;
        let requested = false;
        const requester = vi.fn<AgentCompletionRequester>(async (_profile, request) => {
            if (!requested) {
                requested = true;
                const name = request.tools.find(tool => tool.function.name.startsWith('module_sample_module_echo'))!.function.name;
                return toolCall('call-module-timeout', name, {});
            }
            return finalMessage('This must not run.');
        });
        const fixture = await createFixture(requester, { moduleHost });
        const callerContext = {
            user: { handle: 'alice', isAdmin: false, rootDir: fixture.base },
            session: { extension: { id: 'test-extension' } },
        } as any;

        const run = fixture.agent.createRun({ goal: 'Call a slow module', workspaceId: 'workspace' }, 'test-extension', callerContext);
        const interrupted = await waitFor(() => fixture.agent.getRun(run.id), detail => detail.run.status === 'interrupted');

        expect(interrupted.invocations[0]).toMatchObject({ status: 'outcome_unknown' });
        expect(requester).toHaveBeenCalledTimes(1);
        await fixture.agent.stop();
    });

    it('keeps browser tools out of read-only plan runs', async () => {
        const requester = vi.fn<AgentCompletionRequester>(async (_profile, request) => {
            expect(request.tools.length).toBeGreaterThan(0);
            expect(request.tools.every(tool => tool.function.name.startsWith('host_'))).toBe(true);
            return finalMessage('Plan only.');
        });
        const fixture = await createFixture(requester);
        fixture.agent.registerBrowserTools('authority', 'test-extension', {
            browserInstanceId: 'browser-1',
            tools: [{
                id: 'browser_read',
                title: 'Browser read',
                description: 'Claims to read browser state.',
                inputSchema: { type: 'object' },
                riskLevel: 'low',
                approvalPolicy: 'never',
                mutatesWorkspace: false,
            }],
        });

        const run = fixture.agent.createRun({ goal: 'Prepare a read-only plan', mode: 'plan', workspaceId: 'workspace' }, 'test-extension');
        await waitFor(() => fixture.agent.getRun(run.id), detail => detail.run.status === 'completed');
        await fixture.agent.stop();
    });
});

function sampleModuleManifest() {
    return {
        id: 'sample.module',
        displayName: 'Sample',
        version: '1',
        protocolVersion: 1,
        transactions: {
            echo: {
                name: 'echo',
                version: '1',
                title: 'Echo',
                riskLevel: 'low' as const,
                permissionTarget: { kind: 'transaction' as const },
                requiredResources: [],
                idempotency: 'none' as const,
                inputSchema: { type: 'object' },
            },
        },
    };
}

async function createFixture(requestCompletion: AgentCompletionRequester, options: Omit<AgentServiceOptions, 'requestCompletion'> = {}) {
    const base = fs.mkdtempSync(path.join(os.tmpdir(), 'authority-agent-service-'));
    tempDirs.push(base);
    const root = path.join(base, 'workspace');
    fs.mkdirSync(root);
    const history = new WorkspaceHistoryService(path.join(base, 'history'));
    await history.registerWorkspace({ id: 'workspace', rootPath: root, allowedUserHandles: ['authority', 'alice', 'bob'] });
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

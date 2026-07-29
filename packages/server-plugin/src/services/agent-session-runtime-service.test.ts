import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { AgentHostToolService } from './agent-host-tools.js';
import type { AgentCompletionRequester, AgentLlmCompletionResponse } from './agent-llm-client.js';
import {
    AgentSessionRuntimeService,
    type AgentSessionRuntimeOptions,
} from './agent-session-runtime-service.js';
import { AgentSessionStoreService } from './agent-session-store-service.js';
import { AgentStoreService } from './agent-store-service.js';
import type { ModuleHostService } from './module-host-service.js';
import { WorkspaceHistoryService } from './workspace-history-service.js';

const tempDirs: string[] = [];

afterEach(() => {
    for (const dir of tempDirs.splice(0)) fs.rmSync(dir, { recursive: true, force: true });
});

describe('AgentSessionRuntimeService', () => {
    it('keeps follow-up work in one persistent session while giving each accepted input its own run', async () => {
        const fixture = await createFixture(sequenceRequester([
            finalMessage('First answer.'),
            finalMessage('Second answer.'),
        ]));
        const created = await fixture.runtime.createSession({ workspaceId: 'workspace', message: 'First request' });
        const firstRunId = created.runs[0]!.id;
        const first = await waitFor(
            () => fixture.runtime.getSession(created.session.id),
            snapshot => snapshot.runs.find(run => run.id === firstRunId)?.status === 'completed',
        );

        const sent = await fixture.runtime.sendMessage(created.session.id, { content: 'Second request' });
        expect(sent.runId).not.toBe(firstRunId);
        const completed = await waitFor(
            () => fixture.runtime.getSession(created.session.id),
            snapshot => snapshot.runs.length === 2 && snapshot.runs.every(run => run.status === 'completed'),
        );

        expect(completed.refs).toMatchObject([{ name: 'main', activeRunId: null }]);
        expect(completed.conversation.filter(entry => entry.kind === 'message').map(entry => [entry.role, entry.content]))
            .toEqual([
                ['user', 'First request'],
                ['assistant', 'First answer.'],
                ['user', 'Second request'],
                ['assistant', 'Second answer.'],
            ]);
        expect(completed.steps).toHaveLength(2);
        expect(completed.generations).toMatchObject([
            { status: 'completed', providerRequestState: 'response_received' },
            { status: 'completed', providerRequestState: 'response_received' },
        ]);
        expect(fixture.sessionStore.readSession(created.session.id).snapshot).toEqual(completed);
        await fixture.runtime.stop();
        expect(first.session.id).toBe(created.session.id);
    });

    it('persists session settings as one journal transition and restores them after restart', async () => {
        const fixture = await createFixture(sequenceRequester([]));
        fixture.profileStore.upsertProfile({
            id: 'profile-2',
            displayName: 'Second profile',
            provider: 'openai-compatible',
            baseUrl: 'http://localhost:2345/v1',
            model: 'second',
        });
        const created = await fixture.runtime.createSession({ workspaceId: 'workspace', profileId: 'profile' });

        await expect(fixture.runtime.updateSession(created.session.id, {}))
            .rejects.toThrow('session update is empty');
        const updated = await fixture.runtime.updateSession(created.session.id, {
            title: 'Long-lived repair session',
            profileId: 'profile-2',
            mode: 'plan',
            allowedTools: ['host_read_file', 'host_search_text'],
            maxSteps: 31,
            archived: true,
        });

        expect(updated.session).toMatchObject({
            title: 'Long-lived repair session',
            profileId: 'profile-2',
            mode: 'plan',
            allowedTools: ['host_read_file', 'host_search_text'],
            maxSteps: 31,
            archivedAt: expect.any(String),
        });
        const updateRecords = fixture.sessionStore.readSession(created.session.id).records
            .filter(record => record.entry.type === 'session.updated');
        expect(updateRecords).toHaveLength(1);
        await fixture.runtime.stop();

        const restarted = new AgentSessionRuntimeService(
            fixture.sessionStore,
            fixture.profileStore,
            fixture.history,
            new AgentHostToolService(fixture.history),
            { requestCompletion: sequenceRequester([]) },
        );
        await restarted.start();
        expect((await restarted.getSession(created.session.id)).session).toEqual(updated.session);
        await restarted.stop();
    });

    it('records approval, intent, checkpoints, tool result, and model continuation in durable order', async () => {
        const fixture = await createFixture(sequenceRequester([
            toolCall('call-write', 'host_write_file', { path: 'config.json', content: '{"ok":true}' }),
            finalMessage('Written and verified.'),
        ]));
        const created = await fixture.runtime.createSession({
            workspaceId: 'workspace',
            message: 'Create config.json',
            mode: 'ask',
        });
        const runId = created.runs[0]!.id;
        const waiting = await waitFor(
            () => fixture.runtime.getSession(created.session.id),
            snapshot => snapshot.runs.find(run => run.id === runId)?.status === 'waiting_approval',
        );
        expect(fs.existsSync(path.join(fixture.root, 'config.json'))).toBe(false);
        await fixture.runtime.resolveApproval(created.session.id, waiting.approvals[0]!.id, 'approve', 'admin');
        const completed = await waitFor(
            () => fixture.runtime.getSession(created.session.id),
            snapshot => snapshot.runs.find(run => run.id === runId)?.status === 'completed',
        );

        expect(fs.readFileSync(path.join(fixture.root, 'config.json'), 'utf8')).toBe('{"ok":true}');
        expect(completed.runs[0]).toMatchObject({ status: 'completed', stepCount: 2, finalText: 'Written and verified.' });
        expect(completed.approvals[0]).toMatchObject({ status: 'approved', resolvedByUserHandle: 'admin' });
        expect(completed.invocations[0]).toMatchObject({
            status: 'completed',
            beforeCommitId: expect.any(String),
            afterCommitId: expect.any(String),
        });
        const commits = fixture.history.listCommits('workspace');
        expect(commits.map(commit => commit.metadata?.mutationPhase)).toEqual(['after', 'before']);
        const records = fixture.sessionStore.readSession(created.session.id).records;
        const types = records.map(record => record.entry.type);
        expect(types.indexOf('tool.requested')).toBeLessThan(types.indexOf('approval.requested'));
        expect(types.indexOf('workspace.checkpointed')).toBeLessThan(types.indexOf('tool.started'));
        expect(types.lastIndexOf('workspace.checkpointed')).toBeLessThan(types.indexOf('tool.finished'));
        await fixture.runtime.stop();
    });

    it('does not lose an approval wake-up that arrives before the yielding task unwinds', async () => {
        const fixture = await createFixture(sequenceRequester([
            toolCall('call-fast-approval', 'host_write_file', { path: 'fast.txt', content: 'ok' }),
            finalMessage('Fast approval continued.'),
        ]));
        const created = await fixture.runtime.createSession({ workspaceId: 'workspace', mode: 'ask' });
        let approval: Promise<unknown> | null = null;
        const unsubscribe = fixture.runtime.subscribe(created.session.id, record => {
            if (record.entry.type === 'approval.requested' && approval === null) {
                approval = fixture.runtime.resolveApproval(
                    created.session.id,
                    record.entry.approvalId,
                    'approve',
                    'admin',
                );
            }
        });

        await fixture.runtime.sendMessage(created.session.id, { content: 'Write immediately after approval' });
        const completed = await waitFor(
            () => fixture.runtime.getSession(created.session.id),
            snapshot => snapshot.runs[0]?.status === 'completed',
        );
        await approval;
        unsubscribe();

        expect(fs.readFileSync(path.join(fixture.root, 'fast.txt'), 'utf8')).toBe('ok');
        expect(completed.runs[0]).toMatchObject({ status: 'completed', stepCount: 2 });
        await fixture.runtime.stop();
    });

    it('cancels a persisted pending approval without executing the mutation', async () => {
        const fixture = await createFixture(sequenceRequester([
            toolCall('call-cancel', 'host_write_file', { path: 'cancelled.txt', content: 'no' }),
        ]));
        const created = await fixture.runtime.createSession({
            workspaceId: 'workspace',
            message: 'Wait for approval',
            mode: 'ask',
        });
        const runId = created.runs[0]!.id;
        await waitFor(
            () => fixture.runtime.getSession(created.session.id),
            snapshot => snapshot.runs[0]?.status === 'waiting_approval',
        );
        const cancelled = await fixture.runtime.cancelRun(created.session.id, runId);

        expect(cancelled.runs[0]).toMatchObject({ status: 'cancelled' });
        expect(cancelled.approvals[0]).toMatchObject({ status: 'cancelled' });
        expect(cancelled.invocations[0]).toMatchObject({ status: 'cancelled' });
        expect(fs.existsSync(path.join(fixture.root, 'cancelled.txt'))).toBe(false);
        await fixture.runtime.stop();
    });

    it('delivers a steering message at the next model boundary instead of losing it after a final response', async () => {
        let resolveFirst!: (value: AgentLlmCompletionResponse) => void;
        const requester = vi.fn<AgentCompletionRequester>()
            .mockImplementationOnce(() => new Promise(resolve => { resolveFirst = resolve; }))
            .mockResolvedValueOnce(finalMessage('Answer after steering.'));
        const fixture = await createFixture(requester);
        const created = await fixture.runtime.createSession({ workspaceId: 'workspace', message: 'Initial request' });
        await waitFor(() => requester.mock.calls.length, count => count === 1);
        const sent = await fixture.runtime.sendMessage(created.session.id, { content: 'Use this extra constraint', delivery: 'steer' });
        expect(sent.queuedMessageId).toEqual(expect.any(String));
        resolveFirst(finalMessage('Initial answer.'));

        const completed = await waitFor(
            () => fixture.runtime.getSession(created.session.id),
            snapshot => snapshot.runs[0]?.status === 'completed',
        );
        expect(requester).toHaveBeenCalledTimes(2);
        expect(requester.mock.calls[1]![1].messages.filter(message => message.role === 'user').map(message => message.content))
            .toEqual(['Initial request', 'Use this extra constraint']);
        expect(completed.runs).toHaveLength(1);
        expect(completed.runs[0]).toMatchObject({ status: 'completed', stepCount: 2 });
        expect(completed.pendingMessages).toEqual([]);
        await fixture.runtime.stop();
    });

    it('suspends a generation that was active at restart and never resends it automatically', async () => {
        const base = await createBase();
        const sessionStore = new AgentSessionStoreService(path.join(base.base, 'agent'));
        const created = sessionStore.createSession({
            id: 'restart-session',
            callerUserHandle: 'authority',
            callerExtensionId: 'authority',
            workspaceId: 'workspace',
            title: 'Restart test',
            profileId: 'profile',
            mode: 'ask',
            allowedTools: [],
            maxSteps: 4,
        });
        const writer = sessionStore.openWriter(created.session.id);
        writer.append(messageEntry('user-entry', null, 'Restart me'));
        writer.append(runEntry('run-entry', 'run-restart', 'user-entry'));
        writer.append({ id: 'run-started', type: 'run.started', timestamp: timestamp(3), runId: 'run-restart' });
        writer.append({ id: 'step-started', type: 'step.started', timestamp: timestamp(4), runId: 'run-restart', stepId: 'step-restart', index: 1 });
        writer.append({
            id: 'generation-started',
            type: 'generation.started',
            timestamp: timestamp(5),
            runId: 'run-restart',
            stepId: 'step-restart',
            generationId: 'generation-restart',
            attempt: 1,
        });
        writer.close();
        const requester = vi.fn<AgentCompletionRequester>(async () => finalMessage('must not run'));
        const runtime = new AgentSessionRuntimeService(
            sessionStore,
            base.profileStore,
            base.history,
            new AgentHostToolService(base.history),
            { requestCompletion: requester },
        );

        const started = await runtime.start();
        const recovered = await runtime.getSession(created.session.id);
        expect(started.recoveredRuns).toBe(1);
        expect(requester).not.toHaveBeenCalled();
        expect(recovered.generations[0]).toMatchObject({
            status: 'interrupted',
            providerRequestState: 'sent_or_unknown',
        });
        expect(recovered.steps[0]).toMatchObject({ status: 'interrupted' });
        expect(recovered.runs[0]).toMatchObject({ status: 'suspended' });
        await runtime.stop();
    });

    it('keeps a pending approval actionable across a host restart', async () => {
        const base = await createBase();
        const sessionStore = new AgentSessionStoreService(path.join(base.base, 'agent'));
        const firstRuntime = new AgentSessionRuntimeService(
            sessionStore,
            base.profileStore,
            base.history,
            new AgentHostToolService(base.history),
            { requestCompletion: sequenceRequester([
                toolCall('call-restart-approval', 'host_write_file', { path: 'after-restart.txt', content: 'ok' }),
            ]) },
        );
        await firstRuntime.start();
        const created = await firstRuntime.createSession({
            workspaceId: 'workspace',
            message: 'Approve after restart',
            mode: 'ask',
        });
        const waiting = await waitFor(
            () => firstRuntime.getSession(created.session.id),
            snapshot => snapshot.runs[0]?.status === 'waiting_approval',
        );
        const approvalId = waiting.approvals[0]!.id;
        await firstRuntime.stop();

        const secondRequester = sequenceRequester([finalMessage('Continued after restart.')]);
        const secondRuntime = new AgentSessionRuntimeService(
            sessionStore,
            base.profileStore,
            base.history,
            new AgentHostToolService(base.history),
            { requestCompletion: secondRequester },
        );
        await secondRuntime.start();
        const stillWaiting = await secondRuntime.getSession(created.session.id);
        expect(stillWaiting.runs[0]).toMatchObject({ status: 'waiting_approval' });
        expect(stillWaiting.approvals[0]).toMatchObject({ status: 'pending' });

        await secondRuntime.resolveApproval(created.session.id, approvalId, 'approve', 'admin');
        const completed = await waitFor(
            () => secondRuntime.getSession(created.session.id),
            snapshot => snapshot.runs[0]?.status === 'completed',
        );
        expect(fs.readFileSync(path.join(base.root, 'after-restart.txt'), 'utf8')).toBe('ok');
        expect(completed.approvals[0]).toMatchObject({ status: 'approved', resolvedByUserHandle: 'admin' });
        expect(secondRequester).toHaveBeenCalledOnce();
        await secondRuntime.stop();
    });

    it('uses a durable browser wait/claim/result boundary and then continues the same run', async () => {
        const requester = vi.fn<AgentCompletionRequester>(async (_profile, request) => {
            if (request.messages.some(message => message.role === 'tool')) return finalMessage('Browser result received.');
            const browser = request.tools.find(tool => tool.function.description.includes('Read the visible page'))!;
            return toolCall('call-browser', browser.function.name, { selector: 'body' });
        });
        const fixture = await createFixture(requester);
        fixture.runtime.registerBrowserTools('authority', 'authority', {
            browserInstanceId: 'browser-1',
            tools: [{
                id: 'read_page',
                title: 'Read page',
                description: 'Read the visible page',
                inputSchema: { type: 'object' },
                riskLevel: 'low',
                approvalPolicy: 'never',
                mutatesWorkspace: false,
            }],
        });
        const created = await fixture.runtime.createSession({
            workspaceId: 'workspace',
            message: 'Inspect the browser',
            mode: 'auto',
        });
        const waiting = await waitFor(
            () => fixture.runtime.getSession(created.session.id),
            snapshot => snapshot.runs[0]?.status === 'waiting_tool',
        );
        expect(waiting.invocations[0]).toMatchObject({ execution: 'browser', status: 'pending' });
        const claimed = await fixture.runtime.claimBrowserTool('authority', 'authority', {
            browserInstanceId: 'browser-1',
            claimId: 'claim-1',
            callId: 'call-browser',
        });
        expect(claimed?.invocation).toMatchObject({ status: 'claimed', claimId: 'claim-1' });
        const duplicateClaim = await fixture.runtime.claimBrowserTool('authority', 'authority', {
            browserInstanceId: 'browser-1',
            claimId: 'claim-1',
            callId: 'call-browser',
        });
        expect(duplicateClaim?.invocation.id).toBe(claimed?.invocation.id);
        await fixture.runtime.submitBrowserToolResult('authority', 'authority', {
            runId: waiting.runs[0]!.id,
            callId: 'call-browser',
            claimId: 'claim-1',
            browserInstanceId: 'browser-1',
            status: 'completed',
            result: { text: 'hello' },
        });
        const completed = await waitFor(
            () => fixture.runtime.getSession(created.session.id),
            snapshot => snapshot.runs[0]?.status === 'completed',
        );
        expect(completed.invocations[0]).toMatchObject({ status: 'completed', result: { text: 'hello' } });
        expect(completed.runs[0]).toMatchObject({ status: 'completed', stepCount: 2 });
        expect(requester).toHaveBeenCalledTimes(2);
        await fixture.runtime.stop();
    });

    it('rejects a late browser result after a claimed invocation times out', async () => {
        const requester = vi.fn<AgentCompletionRequester>(async (_profile, request) => {
            const browser = request.tools.find(tool => tool.function.description.includes('Timeout browser result'))!;
            return toolCall('call-browser-timeout', browser.function.name, {});
        });
        const fixture = await createFixture(requester, { browserToolTimeoutMs: 1_000 });
        fixture.runtime.registerBrowserTools('authority', 'authority', {
            browserInstanceId: 'browser-timeout',
            tools: [{
                id: 'timeout_result',
                title: 'Timeout browser result',
                description: 'Timeout browser result',
                inputSchema: { type: 'object' },
                riskLevel: 'low',
                approvalPolicy: 'never',
                mutatesWorkspace: false,
            }],
        });
        const created = await fixture.runtime.createSession({
            workspaceId: 'workspace',
            message: 'Wait for a browser timeout',
            mode: 'auto',
        });
        const waiting = await waitFor(
            () => fixture.runtime.getSession(created.session.id),
            snapshot => snapshot.runs[0]?.status === 'waiting_tool',
        );
        await fixture.runtime.claimBrowserTool('authority', 'authority', {
            browserInstanceId: 'browser-timeout',
            claimId: 'claim-timeout',
            callId: 'call-browser-timeout',
        });
        const suspended = await waitFor(
            () => fixture.runtime.getSession(created.session.id),
            snapshot => snapshot.runs[0]?.status === 'suspended',
        );
        expect(suspended.invocations[0]).toMatchObject({ status: 'outcome_unknown' });
        const recordsBefore = fixture.sessionStore.readSession(created.session.id).records.length;

        await expect(fixture.runtime.submitBrowserToolResult('authority', 'authority', {
            runId: waiting.runs[0]!.id,
            callId: 'call-browser-timeout',
            claimId: 'claim-timeout',
            browserInstanceId: 'browser-timeout',
            status: 'completed',
            result: { tooLate: true },
        })).rejects.toThrow('invocation is unavailable');
        expect(fixture.sessionStore.readSession(created.session.id).records).toHaveLength(recordsBefore);
        expect(requester).toHaveBeenCalledOnce();
        await fixture.runtime.stop();
    });

    it('marks a claimed browser invocation unknown on restart and never accepts its old result', async () => {
        const fixture = await createFixture(vi.fn<AgentCompletionRequester>(async (_profile, request) => {
            const browser = request.tools.find(tool => tool.function.description.includes('Restart claimed browser'))!;
            return toolCall('call-browser-restart', browser.function.name, {});
        }));
        fixture.runtime.registerBrowserTools('authority', 'authority', {
            browserInstanceId: 'browser-restart',
            tools: [{
                id: 'restart_claimed',
                title: 'Restart claimed browser',
                description: 'Restart claimed browser',
                inputSchema: { type: 'object' },
                riskLevel: 'low',
                approvalPolicy: 'never',
                mutatesWorkspace: false,
            }],
        });
        const created = await fixture.runtime.createSession({
            workspaceId: 'workspace',
            message: 'Claim then restart',
            mode: 'auto',
        });
        const waiting = await waitFor(
            () => fixture.runtime.getSession(created.session.id),
            snapshot => snapshot.runs[0]?.status === 'waiting_tool',
        );
        await fixture.runtime.claimBrowserTool('authority', 'authority', {
            browserInstanceId: 'browser-restart',
            claimId: 'claim-restart',
            callId: 'call-browser-restart',
        });
        await fixture.runtime.stop();

        const requester = vi.fn<AgentCompletionRequester>(async () => finalMessage('must not run'));
        const restarted = new AgentSessionRuntimeService(
            fixture.sessionStore,
            fixture.profileStore,
            fixture.history,
            new AgentHostToolService(fixture.history),
            { requestCompletion: requester },
        );
        await restarted.start();
        const recovered = await restarted.getSession(created.session.id);
        expect(requester).not.toHaveBeenCalled();
        expect(recovered.invocations[0]).toMatchObject({
            status: 'outcome_unknown',
            error: expect.stringContaining('side effects are unknown'),
        });
        expect(recovered.steps[0]).toMatchObject({ status: 'interrupted' });
        expect(recovered.runs[0]).toMatchObject({ status: 'suspended' });
        await expect(restarted.submitBrowserToolResult('authority', 'authority', {
            runId: waiting.runs[0]!.id,
            callId: 'call-browser-restart',
            claimId: 'claim-restart',
            browserInstanceId: 'browser-restart',
            status: 'completed',
        })).rejects.toThrow('invocation is unavailable');
        await restarted.stop();
    });

    it('suspends on an uncertain model failure and continues only after explicit resume', async () => {
        const requester = vi.fn<AgentCompletionRequester>()
            .mockRejectedValueOnce(new Error('network connection reset'))
            .mockResolvedValueOnce(finalMessage('Recovered explicitly.'));
        const fixture = await createFixture(requester);
        const created = await fixture.runtime.createSession({ workspaceId: 'workspace', message: 'Retry safely' });
        const runId = created.runs[0]!.id;
        const suspended = await waitFor(
            () => fixture.runtime.getSession(created.session.id),
            snapshot => snapshot.runs[0]?.status === 'suspended',
        );
        expect(requester).toHaveBeenCalledOnce();
        expect(suspended.generations[0]).toMatchObject({
            status: 'failed',
            providerRequestState: 'sent_or_unknown',
        });

        await fixture.runtime.resumeRun(created.session.id, runId);
        const completed = await waitFor(
            () => fixture.runtime.getSession(created.session.id),
            snapshot => snapshot.runs[0]?.status === 'completed',
        );
        expect(requester).toHaveBeenCalledTimes(2);
        expect(completed.runs[0]).toMatchObject({ status: 'completed', stepCount: 2, resumeCount: 1 });
        await fixture.runtime.stop();
    });

    it('does not expose mutating capabilities to a plan-mode generation', async () => {
        const requester = vi.fn<AgentCompletionRequester>(async (_profile, request) => {
            expect(request.tools.map(tool => tool.function.name)).not.toContain('host_write_file');
            expect(request.tools.map(tool => tool.function.name)).not.toContain('host_shell');
            return finalMessage('Plan only.');
        });
        const fixture = await createFixture(requester);
        const created = await fixture.runtime.createSession({
            workspaceId: 'workspace',
            message: 'Inspect and plan a change',
            mode: 'plan',
        });

        const completed = await waitFor(
            () => fixture.runtime.getSession(created.session.id),
            snapshot => snapshot.runs[0]?.status === 'completed',
        );
        expect(completed.invocations).toEqual([]);
        expect(requester).toHaveBeenCalledOnce();
        await fixture.runtime.stop();
    });

    it('passes the authenticated caller context to module tools and suspends unknown module outcomes', async () => {
        const execute = vi.fn().mockRejectedValue(new Error('module transport lost'));
        const moduleHost = {
            listManifests: () => ({ count: 1, modules: [sampleModuleManifest()] }),
            execute,
        } as unknown as ModuleHostService;
        const requester = vi.fn<AgentCompletionRequester>(async (_profile, request) => {
            const name = request.tools.find(tool => tool.function.name.startsWith('module_sample_module_echo'))!.function.name;
            return toolCall('call-module-context', name, { input: { value: 'hello' } });
        });
        const fixture = await createFixture(requester, { moduleHost });
        const callerContext = {
            user: { handle: 'authority', isAdmin: false, rootDir: fixture.base },
            session: { extension: { id: 'test-extension' } },
        } as any;
        const created = await fixture.runtime.createSession({
            workspaceId: 'workspace',
            message: 'Call the module',
            mode: 'auto',
        }, 'test-extension', callerContext);

        const suspended = await waitFor(
            () => fixture.runtime.getSession(created.session.id),
            snapshot => snapshot.runs[0]?.status === 'suspended',
        );
        expect(execute).toHaveBeenCalledWith(
            callerContext.user,
            callerContext.session,
            'sample.module',
            'echo',
            { input: { value: 'hello' } },
            expect.objectContaining({ aborted: false }),
        );
        expect(suspended.invocations[0]).toMatchObject({ status: 'outcome_unknown' });
        expect(suspended.steps[0]).toMatchObject({ status: 'interrupted' });
        expect(requester).toHaveBeenCalledOnce();
        await fixture.runtime.stop();
    });

    it('durably suspends a run when an unexpected executor error escapes the normal protocol', async () => {
        const requester = vi.fn<AgentCompletionRequester>(async (_profile, request) => {
            const browser = request.tools.find(tool => tool.function.description.includes('Disappear before dispatch'))!;
            return toolCall('call-browser-disappear', browser.function.name, {});
        });
        const fixture = await createFixture(requester);
        fixture.runtime.registerBrowserTools('authority', 'authority', {
            browserInstanceId: 'browser-disappear',
            tools: [{
                id: 'disappear',
                title: 'Disappear before dispatch',
                description: 'Disappear before dispatch',
                inputSchema: { type: 'object' },
                riskLevel: 'low',
                approvalPolicy: 'never',
                mutatesWorkspace: false,
            }],
        });
        const created = await fixture.runtime.createSession({ workspaceId: 'workspace', mode: 'auto' });
        const unsubscribe = fixture.runtime.subscribe(created.session.id, record => {
            if (record.entry.type === 'tool.requested') {
                fixture.runtime.registerBrowserTools('authority', 'authority', {
                    browserInstanceId: 'browser-disappear',
                    tools: [{
                        id: 'replacement',
                        title: 'Replacement browser tool',
                        description: 'Replacement browser tool',
                        inputSchema: { type: 'object' },
                        riskLevel: 'low',
                        approvalPolicy: 'never',
                        mutatesWorkspace: false,
                    }],
                });
            }
        });

        await fixture.runtime.sendMessage(created.session.id, { content: 'Use the disappearing tool' });
        const suspended = await waitFor(
            () => fixture.runtime.getSession(created.session.id),
            snapshot => snapshot.runs[0]?.status === 'suspended',
        );
        unsubscribe();

        expect(suspended.invocations[0]).toMatchObject({ status: 'cancelled' });
        expect(suspended.steps[0]).toMatchObject({ status: 'interrupted' });
        expect(suspended.runs[0]).toMatchObject({
            status: 'suspended',
            suspensionReason: expect.stringContaining('failed unexpectedly'),
        });
        await fixture.runtime.stop();
    });

    it('records cancellation instead of tool failure when cancellation wins the start boundary', async () => {
        const fixture = await createFixture(sequenceRequester([
            toolCall('call-read-cancel', 'host_read_file', { path: 'never-read.txt' }),
        ]));
        const created = await fixture.runtime.createSession({ workspaceId: 'workspace' });
        let cancellation: Promise<unknown> | null = null;
        const unsubscribe = fixture.runtime.subscribe(created.session.id, record => {
            if (record.entry.type === 'tool.requested' && cancellation === null) {
                cancellation = fixture.runtime.cancelRun(created.session.id, record.entry.runId);
            }
        });

        await fixture.runtime.sendMessage(created.session.id, { content: 'Read a file, then stop' });
        const cancelled = await waitFor(
            () => fixture.runtime.getSession(created.session.id),
            snapshot => snapshot.runs[0]?.status === 'cancelled',
        );
        await cancellation;
        unsubscribe();

        expect(cancelled.invocations[0]).toMatchObject({ status: 'cancelled' });
        const entries = fixture.sessionStore.readSession(created.session.id).records.map(record => record.entry);
        expect(entries.some(entry => entry.type === 'tool.started')).toBe(false);
        expect(entries.find(entry => entry.type === 'tool.finished')).toMatchObject({ outcome: 'cancelled' });
        await fixture.runtime.stop();
    });

    it('does not publish a browser dispatch after cancellation wins the durable intent boundary', async () => {
        const requester = vi.fn<AgentCompletionRequester>(async (_profile, request) => {
            const browser = request.tools.find(tool => tool.function.description.includes('Race browser dispatch'))!;
            return toolCall('call-browser-cancel', browser.function.name, {});
        });
        const fixture = await createFixture(requester);
        fixture.runtime.registerBrowserTools('authority', 'authority', {
            browserInstanceId: 'browser-cancel',
            tools: [{
                id: 'race_dispatch',
                title: 'Race browser dispatch',
                description: 'Race browser dispatch',
                inputSchema: { type: 'object' },
                riskLevel: 'low',
                approvalPolicy: 'never',
                mutatesWorkspace: false,
            }],
        });
        const created = await fixture.runtime.createSession({ workspaceId: 'workspace', mode: 'auto' });
        let cancellation: Promise<unknown> | null = null;
        const unsubscribe = fixture.runtime.subscribe(created.session.id, record => {
            if (record.entry.type === 'tool.requested' && cancellation === null) {
                cancellation = fixture.runtime.cancelRun(created.session.id, record.entry.runId);
            }
        });

        await fixture.runtime.sendMessage(created.session.id, { content: 'Dispatch, unless cancelled' });
        const cancelled = await waitFor(
            () => fixture.runtime.getSession(created.session.id),
            snapshot => snapshot.runs[0]?.status === 'cancelled',
        );
        await cancellation;
        unsubscribe();

        expect(cancelled.invocations[0]).toMatchObject({ status: 'cancelled', execution: 'browser' });
        const types = fixture.sessionStore.readSession(created.session.id).records.map(record => record.entry.type);
        expect(types).not.toContain('tool.waiting');
        expect(types).not.toContain('tool.started');
        await fixture.runtime.stop();
    });

    it('reconciles a durable before-checkpoint even when the invocation never crossed tool.started', async () => {
        const base = await createBase();
        const sessionStore = new AgentSessionStoreService(path.join(base.base, 'agent'));
        const sessionId = 'pending-checkpoint-session';
        seedPendingHostInvocation(sessionStore, sessionId, 'run-pending-checkpoint', 'invocation-pending-checkpoint');
        const checkpoint = await base.history.checkpoint('workspace', {
            message: 'Before Write a file',
            paths: ['pending.txt'],
            runId: 'run-pending-checkpoint',
            toolCallId: 'call-pending-checkpoint',
            metadata: {
                mutationPhase: 'before',
                agentSessionId: sessionId,
                agentInvocationId: 'invocation-pending-checkpoint',
            },
        }, { kind: 'agent', id: 'run-pending-checkpoint' });
        const requester = vi.fn<AgentCompletionRequester>(async () => finalMessage('must not run'));
        const runtime = new AgentSessionRuntimeService(
            sessionStore,
            base.profileStore,
            base.history,
            new AgentHostToolService(base.history),
            { requestCompletion: requester },
        );

        const started = await runtime.start();
        const recovered = await runtime.getSession(sessionId);
        expect(started.recoveredRuns).toBe(1);
        expect(requester).not.toHaveBeenCalled();
        expect(recovered.invocations[0]).toMatchObject({
            status: 'cancelled',
            beforeCommitId: checkpoint.commit.id,
        });
        expect(recovered.runs[0]).toMatchObject({ status: 'suspended' });
        const entries = sessionStore.readSession(sessionId).records.map(record => record.entry);
        const checkpointIndex = entries.findIndex(entry => entry.type === 'workspace.checkpointed');
        const finishIndex = entries.findIndex(entry => entry.type === 'tool.finished');
        expect(checkpointIndex).toBeGreaterThanOrEqual(0);
        expect(checkpointIndex).toBeLessThan(finishIndex);
        await runtime.stop();
    });

    it('rejects browser effect entrypoints after stop', async () => {
        const requester = vi.fn<AgentCompletionRequester>(async (_profile, request) => {
            const browser = request.tools.find(tool => tool.function.description.includes('Read after stop'))!;
            return toolCall('call-browser-stop', browser.function.name, {});
        });
        const fixture = await createFixture(requester);
        fixture.runtime.registerBrowserTools('authority', 'authority', {
            browserInstanceId: 'browser-stop',
            tools: [{
                id: 'read_after_stop',
                title: 'Read after stop',
                description: 'Read after stop',
                inputSchema: { type: 'object' },
                riskLevel: 'low',
                approvalPolicy: 'never',
                mutatesWorkspace: false,
            }],
        });
        const created = await fixture.runtime.createSession({
            workspaceId: 'workspace',
            message: 'Wait for browser',
            mode: 'auto',
        });
        const waiting = await waitFor(
            () => fixture.runtime.getSession(created.session.id),
            snapshot => snapshot.runs[0]?.status === 'waiting_tool',
        );
        await fixture.runtime.stop();

        expect(() => fixture.runtime.registerBrowserTools('authority', 'authority', {
            browserInstanceId: 'browser-stop',
            tools: [],
        })).toThrow('not running');
        await expect(fixture.runtime.claimBrowserTool('authority', 'authority', {
            browserInstanceId: 'browser-stop',
            claimId: 'late-claim',
            callId: 'call-browser-stop',
        })).rejects.toThrow('not running');
        await expect(fixture.runtime.submitBrowserToolResult('authority', 'authority', {
            runId: waiting.runs[0]!.id,
            callId: 'call-browser-stop',
            claimId: 'late-claim',
            browserInstanceId: 'browser-stop',
            status: 'completed',
        })).rejects.toThrow('not running');
    });

    it('keeps the session writer lease until an abort-ignoring task actually settles', async () => {
        let resolveCompletion!: (value: AgentLlmCompletionResponse) => void;
        const requester = vi.fn<AgentCompletionRequester>(() => new Promise(resolve => { resolveCompletion = resolve; }));
        const fixture = await createFixture(requester, { shutdownTimeoutMs: 20 });
        const created = await fixture.runtime.createSession({ workspaceId: 'workspace', message: 'Keep running' });
        await waitFor(() => requester.mock.calls.length, count => count === 1);

        await fixture.runtime.stop();
        expect(() => fixture.sessionStore.openWriter(created.session.id)).toThrow('active writer');
        resolveCompletion(finalMessage('Late response'));

        const writer = await waitFor(
            () => {
                try {
                    return fixture.sessionStore.openWriter(created.session.id);
                } catch {
                    return null;
                }
            },
            value => value !== null,
        );
        const settled = writer!.snapshot();
        expect(settled.runs[0]).toMatchObject({ status: 'suspended' });
        expect(settled.generations[0]).toMatchObject({
            status: 'interrupted',
            providerRequestState: 'response_received',
        });
        expect(settled.conversation.some(entry => entry.kind === 'message' && entry.role === 'assistant')).toBe(false);
        writer!.close();
    });
});

async function createFixture(
    requestCompletion: AgentCompletionRequester,
    options: Omit<AgentSessionRuntimeOptions, 'requestCompletion'> = {},
) {
    const base = await createBase();
    const sessionStore = new AgentSessionStoreService(path.join(base.base, 'agent'));
    const runtime = new AgentSessionRuntimeService(
        sessionStore,
        base.profileStore,
        base.history,
        new AgentHostToolService(base.history),
        { requestCompletion, ...options },
    );
    await runtime.start();
    return { ...base, sessionStore, runtime };
}

async function createBase() {
    const base = fs.mkdtempSync(path.join(os.tmpdir(), 'authority-agent-session-runtime-'));
    tempDirs.push(base);
    const root = path.join(base, 'workspace');
    fs.mkdirSync(root);
    const history = new WorkspaceHistoryService(path.join(base, 'history'));
    await history.registerWorkspace({ id: 'workspace', rootPath: root, allowedUserHandles: ['authority'] });
    const profileStore = new AgentStoreService(path.join(base, 'agent'));
    profileStore.upsertProfile({
        id: 'profile',
        displayName: 'Test',
        provider: 'openai-compatible',
        baseUrl: 'http://localhost:1234/v1',
        model: 'test',
    });
    return { base, root, history, profileStore };
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

function messageEntry(id: string, parentId: string | null, content: string) {
    return {
        id,
        type: 'conversation.message' as const,
        timestamp: timestamp(1),
        ref: 'main',
        parentId,
        role: 'user' as const,
        content,
    };
}

function runEntry(id: string, runId: string, triggerMessageId: string) {
    return {
        id,
        type: 'run.accepted' as const,
        timestamp: timestamp(2),
        runId,
        ref: 'main',
        triggerMessageId,
        profileId: 'profile',
        mode: 'ask' as const,
        allowedTools: [],
        maxSteps: 4,
    };
}

function seedPendingHostInvocation(
    store: AgentSessionStoreService,
    sessionId: string,
    runId: string,
    invocationId: string,
): void {
    store.createSession({
        id: sessionId,
        callerUserHandle: 'authority',
        callerExtensionId: 'authority',
        workspaceId: 'workspace',
        title: 'Pending checkpoint recovery',
        profileId: 'profile',
        mode: 'auto',
        allowedTools: ['host_write_file'],
        maxSteps: 4,
    });
    const writer = store.openWriter(sessionId);
    writer.append(messageEntry('pending-user', null, 'Write pending.txt'));
    writer.append({
        ...runEntry('pending-run-entry', runId, 'pending-user'),
        allowedTools: ['host_write_file'],
        mode: 'auto',
    });
    writer.append({ id: 'pending-run-started', type: 'run.started', timestamp: timestamp(3), runId });
    writer.append({
        id: 'pending-step-started',
        type: 'step.started',
        timestamp: timestamp(4),
        runId,
        stepId: 'pending-step',
        index: 1,
    });
    writer.append({
        id: 'pending-generation-started',
        type: 'generation.started',
        timestamp: timestamp(5),
        runId,
        stepId: 'pending-step',
        generationId: 'pending-generation',
        attempt: 1,
    });
    writer.append({
        id: 'pending-generation-finished',
        type: 'generation.finished',
        timestamp: timestamp(6),
        runId,
        stepId: 'pending-step',
        generationId: 'pending-generation',
        outcome: 'completed',
        providerRequestState: 'response_received',
        finishReason: 'tool_calls',
    });
    writer.append({
        id: 'pending-assistant',
        type: 'conversation.message',
        timestamp: timestamp(7),
        ref: 'main',
        parentId: 'pending-user',
        role: 'assistant',
        content: null,
        runId,
        stepId: 'pending-step',
        toolCalls: [{
            id: 'call-pending-checkpoint',
            name: 'host_write_file',
            arguments: '{"path":"pending.txt","content":"hello"}',
        }],
    });
    writer.append({
        id: 'pending-tool-requested',
        type: 'tool.requested',
        timestamp: timestamp(8),
        runId,
        stepId: 'pending-step',
        invocationId,
        callId: 'call-pending-checkpoint',
        toolId: 'host_write_file',
        execution: 'host',
        arguments: { path: 'pending.txt', content: 'hello' },
    });
    writer.close();
}

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

function timestamp(offset: number): string {
    return new Date(Date.UTC(2026, 0, 1, 0, 0, offset)).toISOString();
}

async function waitFor<T>(read: () => T | Promise<T>, done: (value: T) => boolean): Promise<T> {
    const deadline = Date.now() + 5_000;
    while (Date.now() < deadline) {
        const value = await read();
        if (done(value)) return value;
        await new Promise(resolve => setTimeout(resolve, 10));
    }
    throw new Error('Timed out waiting for Agent session state');
}

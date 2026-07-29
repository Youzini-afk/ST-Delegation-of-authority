import { describe, expect, it, vi } from 'vitest';
import type { AuthorityRuntime } from '../runtime.js';
import type {
    AgentSessionJournalRecord,
    AgentSessionSnapshot,
} from '../services/agent-session-model.js';
import type { AuthorityRequest, AuthorityResponse, SessionRecord } from '../types.js';
import { registerAgentRoutes } from './agent-routes.js';

type Handler = (req: AuthorityRequest, res: AuthorityResponse) => void | Promise<void>;

function setup(extensionId = 'third-party/ext-a', isAdmin = false) {
    const get = new Map<string, Handler>();
    const post = new Map<string, Handler>();
    const session = {
        token: 'session-token',
        userHandle: 'alice',
        isAdmin,
        extension: {
            id: extensionId,
            displayName: 'Ext A',
            version: '1.0.0',
            installType: 'local',
        },
    } as SessionRecord;
    const snapshot = buildSnapshot({ extensionId });
    const runtime = {
        sessions: { assertSession: vi.fn().mockResolvedValue(session) },
        permissions: { authorize: vi.fn().mockResolvedValue(true) },
        agentProfiles: {
            listProfiles: vi.fn(() => []),
            upsertProfile: vi.fn(),
            getProfile: vi.fn(),
            deleteProfile: vi.fn(),
        },
        agentSessions: {
            start: vi.fn().mockResolvedValue({ sessions: 1, recoveredRuns: 0, problems: [] }),
            tools: { list: vi.fn(() => []) },
            listSessions: vi.fn(() => [snapshot]),
            getSession: vi.fn().mockResolvedValue(snapshot),
            attachContext: vi.fn(),
            createSession: vi.fn().mockResolvedValue(snapshot),
            updateSession: vi.fn().mockResolvedValue(snapshot),
            sendMessage: vi.fn().mockResolvedValue({ snapshot, runId: 'run-1', queuedMessageId: null }),
            cancelRun: vi.fn().mockResolvedValue(snapshot),
            resumeRun: vi.fn().mockResolvedValue(snapshot),
            openSubscription: vi.fn().mockResolvedValue({ snapshot, close: vi.fn() }),
            registerBrowserTools: vi.fn(() => ({ browserInstanceId: 'tab-a', tools: [] })),
            claimBrowserTool: vi.fn().mockResolvedValue(null),
            submitBrowserToolResult: vi.fn().mockResolvedValue(snapshot.invocations[0]),
            resolveApproval: vi.fn().mockResolvedValue(snapshot),
        },
        workspaceHistory: { assertWorkspaceAccess: vi.fn(() => ({ id: 'workspace-a' })) },
        audit: { logUsage: vi.fn().mockResolvedValue(undefined) },
    } as unknown as AuthorityRuntime;
    const fail = vi.fn((_runtime, _req, _res, _extensionId, error: unknown) => {
        throw error;
    });

    registerAgentRoutes({
        get: (path, handler) => get.set(path, handler),
        post: (path, handler) => post.set(path, handler),
    }, runtime, fail);

    return { runtime, session, snapshot, get, post, fail };
}

function request(body?: unknown, isAdmin = false): AuthorityRequest {
    return {
        headers: { 'x-st-authority-session': 'session-token' },
        ...(body === undefined ? {} : { body }),
        user: {
            profile: { handle: 'alice', admin: isAdmin },
            directories: { root: 'C:\\test-user' },
        },
    };
}

function response(): AuthorityResponse {
    const value = {} as AuthorityResponse;
        Object.assign(value, {
        status: vi.fn(() => value),
        json: vi.fn(),
        send: vi.fn(),
        setHeader: vi.fn(),
        write: vi.fn(),
        end: vi.fn(),
        on: vi.fn(),
    });
    return value;
}

describe('Agent session routes', () => {
    it('lists tools in the authenticated user and extension scope', async () => {
        const { runtime, get } = setup();

        await get.get('/agent/tools')!(request(), response());

        expect(runtime.agentSessions.tools.list).toHaveBeenCalledWith('alice', 'third-party/ext-a');
    });

    it('paginates durable sessions inside the authenticated owner scope', async () => {
        const { runtime, post } = setup();
        const res = response();

        await post.get('/agent/sessions/list')!(request({ page: { limit: 25 } }), res);

        expect(runtime.agentSessions.listSessions).toHaveBeenCalledWith('third-party/ext-a', 'alice');
        expect(res.json).toHaveBeenCalledWith(expect.objectContaining({
            sessions: [expect.objectContaining({ id: 'session-1', activeRunId: 'run-1', status: 'running' })],
            page: expect.objectContaining({ limit: 25, totalCount: 1 }),
        }));
    });

    it('binds a new session to the authenticated extension and workspace grant', async () => {
        const { runtime, session, post } = setup();
        const body = { message: 'Fix the extension', workspaceId: 'workspace-a', mode: 'ask' as const };

        await post.get('/agent/sessions')!(request(body), response());

        expect(runtime.workspaceHistory.assertWorkspaceAccess).toHaveBeenCalledWith('workspace-a', 'alice', false);
        expect(runtime.permissions.authorize).toHaveBeenCalledWith(
            expect.objectContaining({ handle: 'alice' }),
            session,
            { resource: 'agent.run', target: 'workspace-a' },
        );
        expect(runtime.agentSessions.createSession).toHaveBeenCalledWith(
            body,
            'third-party/ext-a',
            expect.objectContaining({ session }),
        );
    });

    it('rejects missing or inaccessible workspaces before requesting a grant', async () => {
        const { runtime, post } = setup();

        await expect(post.get('/agent/sessions')!(request({ message: 'Missing workspace' }), response()))
            .rejects.toThrow('workspaceId is required');
        vi.mocked(runtime.workspaceHistory.assertWorkspaceAccess).mockImplementationOnce(() => {
            throw new Error('Agent workspace not found: future-workspace');
        });
        await expect(post.get('/agent/sessions')!(
            request({ message: 'Unknown workspace', workspaceId: 'future-workspace' }),
            response(),
        )).rejects.toThrow('Agent workspace not found');

        expect(runtime.permissions.authorize).not.toHaveBeenCalled();
        expect(runtime.agentSessions.createSession).not.toHaveBeenCalled();
    });

    it('does not expose another extension session', async () => {
        const { runtime, get } = setup('third-party/ext-a');
        vi.mocked(runtime.agentSessions.getSession).mockResolvedValue(buildSnapshot({ extensionId: 'third-party/ext-b' }));
        const req = request();
        req.params = { sessionId: 'session-1' };

        await expect(get.get('/agent/sessions/:sessionId')!(req, response()))
            .rejects.toThrow('Agent session not found');
    });

    it('reauthorizes the workspace when a new message can start or extend work', async () => {
        const { runtime, session, post } = setup();
        const req = request({ content: 'Continue with the tests' });
        req.params = { sessionId: 'session-1' };

        await post.get('/agent/sessions/:sessionId/messages')!(req, response());

        expect(runtime.permissions.authorize).toHaveBeenCalledWith(
            expect.objectContaining({ handle: 'alice' }),
            session,
            { resource: 'agent.run', target: 'workspace-a' },
        );
        expect(runtime.agentSessions.sendMessage).toHaveBeenCalledWith(
            'session-1',
            { content: 'Continue with the tests' },
            'third-party/ext-a',
            expect.objectContaining({ session }),
        );
    });

    it('never exposes journal hashes or browser claim secrets', async () => {
        const { get } = setup();
        const req = request();
        req.params = { sessionId: 'session-1' };
        const res = response();

        await get.get('/agent/sessions/:sessionId')!(req, res);

        const body = vi.mocked(res.json).mock.calls[0]![0] as Record<string, any>;
        expect(body.lastHash).toBeUndefined();
        expect(body.invocations[0].claimId).toBeUndefined();
        expect(body.invocations[0].idempotencyKey).toBeUndefined();
    });

    it('reauthorizes browser registration, claim, and result under the authenticated session', async () => {
        const { runtime, session, post } = setup('third-party/ext-a');
        const body = {
            extensionId: 'third-party/ext-b',
            browserInstanceId: 'tab-a',
            tools: [],
        };

        await post.get('/agent/browser-tools/register')!(request(body), response());
        await post.get('/agent/browser-tools/claim')!(request({
            browserInstanceId: 'tab-a',
            claimId: 'claim-1',
        }), response());
        await post.get('/agent/browser-tools/result')!(request({
            runId: 'run-1',
            callId: 'call-1',
            claimId: 'claim-1',
            browserInstanceId: 'tab-a',
            status: 'completed',
            result: { ok: true },
        }), response());

        expect(runtime.permissions.authorize).toHaveBeenCalledTimes(3);
        expect(runtime.permissions.authorize).toHaveBeenNthCalledWith(1,
            expect.objectContaining({ handle: 'alice' }),
            session,
            { resource: 'agent.browser', target: 'tab-a' },
        );
        expect(runtime.permissions.authorize).toHaveBeenNthCalledWith(2,
            expect.objectContaining({ handle: 'alice' }),
            session,
            { resource: 'agent.browser', target: 'tab-a' },
        );
        expect(runtime.permissions.authorize).toHaveBeenNthCalledWith(3,
            expect.objectContaining({ handle: 'alice' }),
            session,
            { resource: 'agent.browser', target: 'tab-a' },
        );
        expect(runtime.agentSessions.registerBrowserTools).toHaveBeenCalledWith('alice', 'third-party/ext-a', body);
    });

    it('opens an atomic snapshot-plus-event stream and releases its listener', async () => {
        const { runtime, snapshot, get, post } = setup();
        let listener: ((record: AgentSessionJournalRecord) => void) | null = null;
        const close = vi.fn();
        vi.mocked(runtime.agentSessions.openSubscription).mockImplementation(async (_id, next) => {
            listener = next;
            return { snapshot, close };
        });
        const callbacks = new Map<string, () => void>();
        const ticketRequest = request();
        ticketRequest.params = { sessionId: 'session-1' };
        const ticketResponse = response();
        await post.get('/agent/sessions/:sessionId/events-ticket')!(ticketRequest, ticketResponse);
        const ticket = (vi.mocked(ticketResponse.json).mock.calls[0]![0] as { ticket: string }).ticket;
        expect(ticket).not.toContain('session-token');
        const req = request();
        req.headers = {};
        req.params = { sessionId: 'session-1' };
        req.query = { ticket };
        const res = response();
        res.on = (event, callback) => callbacks.set(event, callback);

        await get.get('/agent/sessions/:sessionId/events')!(req, res);
        const record = buildRecord(snapshot.lastSequence + 1);
        (listener as ((value: AgentSessionJournalRecord) => void) | null)?.(record);
        callbacks.get('close')?.();

        expect(runtime.agentSessions.openSubscription).toHaveBeenCalledWith(
            'session-1',
            expect.any(Function),
            'third-party/ext-a',
            expect.objectContaining({ session: expect.any(Object) }),
        );
        const writes = vi.mocked(res.write).mock.calls.map(call => String(call[0])).join('');
        expect(writes).toContain('event: authority.agent.session.snapshot');
        expect(writes).toContain('event: authority.agent.session.event');
        expect(writes).not.toContain('claim-secret');
        expect(close).toHaveBeenCalledOnce();

        const replay = request();
        replay.params = { sessionId: 'session-1' };
        replay.query = { ticket };
        await expect(get.get('/agent/sessions/:sessionId/events')!(replay, response()))
            .rejects.toThrow('ticket is invalid or expired');
    });

    it('rejects approval resolution for non-admin users', async () => {
        const { runtime, post } = setup();
        const req = request({ decision: 'approve' });
        req.params = { sessionId: 'session-1', approvalId: 'approval-1' };

        await expect(post.get('/admin/agent/sessions/:sessionId/approvals/:approvalId/resolve')!(req, response()))
            .rejects.toThrow('Forbidden');
        expect(runtime.sessions.assertSession).toHaveBeenCalled();
        expect(runtime.agentSessions.resolveApproval).not.toHaveBeenCalled();
    });

    it('requires a valid Authority session before any Agent admin operation', async () => {
        const { runtime, get } = setup('third-party/ext-a', true);
        vi.mocked(runtime.sessions.assertSession).mockRejectedValueOnce(new Error('Invalid authority session'));

        await expect(get.get('/admin/agent/profiles')!(request(undefined, true), response()))
            .rejects.toThrow('Invalid authority session');
        expect(runtime.agentProfiles.listProfiles).not.toHaveBeenCalled();
    });

    it('preserves already-decoded profile ids instead of decoding them twice', async () => {
        const { runtime, get } = setup('third-party/ext-a', true);
        const req = request(undefined, true);
        req.params = { profileId: 'profile%2Fname' };

        await get.get('/admin/agent/profiles/:profileId')!(req, response());

        expect(runtime.agentProfiles.getProfile).toHaveBeenCalledWith('profile%2Fname');
    });

    it('records the admin identity when resolving an approval', async () => {
        const { runtime, post } = setup('third-party/ext-a', true);
        const req = request({ decision: 'approve' }, true);
        req.params = { sessionId: 'session-1', approvalId: 'approval-1' };

        await post.get('/admin/agent/sessions/:sessionId/approvals/:approvalId/resolve')!(req, response());

        expect(runtime.agentSessions.resolveApproval).toHaveBeenCalledWith(
            'session-1',
            'approval-1',
            'approve',
            'alice',
        );
        expect(runtime.audit.logUsage).toHaveBeenCalledWith(
            expect.objectContaining({ handle: 'alice' }),
            expect.any(String),
            'Agent approval resolved',
            { sessionId: 'session-1', approvalId: 'approval-1', decision: 'approve' },
        );
    });

    it('rejects malformed approval decisions instead of treating them as denial', async () => {
        const { runtime, post } = setup('third-party/ext-a', true);
        const req = request({ decision: 'later' }, true);
        req.params = { sessionId: 'session-1', approvalId: 'approval-1' };

        await expect(post.get('/admin/agent/sessions/:sessionId/approvals/:approvalId/resolve')!(req, response()))
            .rejects.toThrow('decision must be approve or deny');
        expect(runtime.agentSessions.resolveApproval).not.toHaveBeenCalled();
    });
});

function buildSnapshot(options: { extensionId?: string; userHandle?: string } = {}): AgentSessionSnapshot {
    const timestamp = '2026-07-29T12:00:00.000Z';
    return {
        session: {
            id: 'session-1',
            callerUserHandle: options.userHandle ?? 'alice',
            callerExtensionId: options.extensionId ?? 'third-party/ext-a',
            workspaceId: 'workspace-a',
            title: 'Fix the extension',
            profileId: 'profile-1',
            mode: 'ask',
            allowedTools: ['browser.inspect'],
            maxSteps: 24,
            createdAt: timestamp,
            updatedAt: timestamp,
        },
        lastSequence: 8,
        lastHash: 'journal-secret-hash',
        refs: [{ name: 'main', leafEntryId: 'message-2', activeRunId: 'run-1', createdAt: timestamp, updatedAt: timestamp }],
        conversation: [
            { id: 'message-1', sequence: 3, ref: 'main', parentId: null, timestamp, runId: 'run-1', kind: 'message', role: 'user', content: 'Fix the extension' },
            { id: 'message-2', sequence: 8, ref: 'main', parentId: 'message-1', timestamp, runId: 'run-1', kind: 'message', role: 'assistant', content: 'Working on it' },
        ],
        activePaths: { main: ['message-1', 'message-2'] },
        runs: [{
            id: 'run-1', ref: 'main', triggerMessageId: 'message-1', status: 'running', profileId: 'profile-1',
            mode: 'ask', allowedTools: ['browser.inspect'], maxSteps: 24, stepCount: 1,
            createdAt: timestamp, updatedAt: timestamp, startedAt: timestamp, resumeCount: 0,
        }],
        steps: [{ id: 'step-1', runId: 'run-1', index: 0, status: 'running', createdAt: timestamp, updatedAt: timestamp }],
        generations: [],
        invocations: [{
            id: 'invocation-1', runId: 'run-1', stepId: 'step-1', callId: 'call-1', toolId: 'browser.inspect',
            execution: 'browser', arguments: {}, status: 'claimed', createdAt: timestamp, updatedAt: timestamp,
            claimId: 'claim-secret', idempotencyKey: 'idempotency-secret',
        }],
        approvals: [],
        pendingMessages: [],
    };
}

function buildRecord(sequence: number): AgentSessionJournalRecord {
    return {
        format: 'authority-agent-session-journal/v1',
        sessionId: 'session-1',
        sequence,
        previousHash: 'previous',
        entry: {
            id: 'entry-9',
            type: 'queue.added',
            timestamp: '2026-07-29T12:00:01.000Z',
            queueId: 'queue-1',
            ref: 'main',
            kind: 'follow_up',
            content: 'Continue',
        },
        hash: 'next',
    };
}

import { describe, expect, it, vi } from 'vitest';
import type { AuthorityRuntime } from '../runtime.js';
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
    const runtime = {
        sessions: { assertSession: vi.fn().mockResolvedValue(session) },
        permissions: { authorize: vi.fn().mockResolvedValue(true) },
        agent: {
            start: vi.fn().mockResolvedValue([]),
            listTools: vi.fn(() => []),
            listRuns: vi.fn(() => []),
            listRunsPage: vi.fn(() => ({ runs: [], page: { nextCursor: null, limit: 50, hasMore: false, totalCount: 0 } })),
            pruneTerminalRuns: vi.fn(() => ({ deletedRuns: 0, reclaimedBytes: 0, retainedTerminalRuns: 0, activeRuns: 0 })),
            createRun: vi.fn(() => ({ id: 'run-1', workspaceId: 'workspace-a', mode: 'ask' })),
            getRun: vi.fn(() => ({ run: { id: 'run-1', callerUserHandle: 'alice', callerExtensionId: extensionId } })),
            cancelRun: vi.fn(() => ({ id: 'run-1', status: 'cancelled' })),
            registerBrowserTools: vi.fn(() => ({ browserInstanceId: 'tab-a', tools: [] })),
            claimBrowserTool: vi.fn(() => ({ invocation: null })),
            submitBrowserToolResult: vi.fn(() => ({ callId: 'call-1', status: 'completed' })),
            listProfiles: vi.fn(() => []),
            upsertProfile: vi.fn(),
            getProfile: vi.fn(),
            deleteProfile: vi.fn(),
            resolveApproval: vi.fn(),
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

    return { runtime, session, get, post, fail };
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
    });
    return value;
}

describe('Agent routes', () => {
    it('lists browser tools in the authenticated user and extension scope', async () => {
        const { runtime, get } = setup();

        await get.get('/agent/tools')!(request(), response());

        expect(runtime.agent.listTools).toHaveBeenCalledWith('third-party/ext-a', 'alice');
    });

    it('paginates extension runs inside the authenticated owner scope', async () => {
        const { runtime, post } = setup();

        await post.get('/agent/runs/list')!(request({ page: { cursor: '50', limit: 25 }, status: 'failed' }), response());

        expect(runtime.agent.listRunsPage).toHaveBeenCalledWith(
            { page: { cursor: '50', limit: 25 }, status: 'failed' },
            'third-party/ext-a',
            'alice',
        );
    });

    it('caps legacy run lists through the paginated owner and admin paths', async () => {
        const extension = setup();
        await extension.get.get('/agent/runs')!(request(), response());
        expect(extension.runtime.agent.listRunsPage).toHaveBeenCalledWith({}, 'third-party/ext-a', 'alice');
        expect(extension.runtime.agent.listRuns).not.toHaveBeenCalled();

        const admin = setup('third-party/ext-a', true);
        await admin.get.get('/admin/agent/runs')!(request(undefined, true), response());
        expect(admin.runtime.agent.listRunsPage).toHaveBeenCalledWith();
        expect(admin.runtime.agent.listRuns).not.toHaveBeenCalled();
    });

    it('binds a created run to the authenticated extension and workspace permission', async () => {
        const { runtime, session, post } = setup();
        const body = { goal: 'Fix the extension', workspaceId: 'workspace-a', mode: 'ask' };

        await post.get('/agent/runs')!(request(body), response());

        expect(runtime.permissions.authorize).toHaveBeenCalledWith(
            expect.objectContaining({ handle: 'alice' }),
            session,
            { resource: 'agent.run', target: 'workspace-a' },
        );
        expect(runtime.agent.createRun).toHaveBeenCalledWith(
            body,
            'third-party/ext-a',
            expect.objectContaining({ session }),
        );
    });

    it('rejects missing or unknown workspaces before requesting permission', async () => {
        const { runtime, post } = setup();

        await expect(post.get('/agent/runs')!(request({ goal: 'Missing workspace' }), response()))
            .rejects.toThrow('workspaceId is required');
        vi.mocked(runtime.workspaceHistory.assertWorkspaceAccess).mockImplementationOnce(() => {
            throw new Error('Agent workspace not found: future-workspace');
        });
        await expect(post.get('/agent/runs')!(
            request({ goal: 'Unknown workspace', workspaceId: 'future-workspace' }),
            response(),
        )).rejects.toThrow('Agent workspace not found');

        expect(runtime.permissions.authorize).not.toHaveBeenCalled();
        expect(runtime.agent.createRun).not.toHaveBeenCalled();
    });

    it('rejects users outside the workspace ACL before requesting permission', async () => {
        const { runtime, post } = setup();
        vi.mocked(runtime.workspaceHistory.assertWorkspaceAccess).mockImplementationOnce(() => {
            throw new Error('Workspace not found: workspace-a');
        });
        const req = request({ goal: 'Cross-user read', workspaceId: 'workspace-a' });
        req.user!.profile.handle = 'bob';

        await expect(post.get('/agent/runs')!(req, response())).rejects.toThrow('Workspace not found');

        expect(runtime.sessions.assertSession).toHaveBeenCalled();
        expect(runtime.workspaceHistory.assertWorkspaceAccess).toHaveBeenCalledWith('workspace-a', 'bob', false);
        expect(runtime.permissions.authorize).not.toHaveBeenCalled();
    });

    it('does not expose another extension run', async () => {
        const { runtime, get } = setup('third-party/ext-a');
        vi.mocked(runtime.agent.getRun).mockReturnValue({
            run: { id: 'run-1', callerUserHandle: 'alice', callerExtensionId: 'third-party/ext-b' },
        } as unknown as ReturnType<AuthorityRuntime['agent']['getRun']>);
        const req = request();
        req.params = { runId: 'run-1' };

        await expect(get.get('/agent/runs/:runId')!(req, response())).rejects.toThrow('Agent run not found');
    });

    it('does not expose another user run under the same extension id', async () => {
        const { runtime, get } = setup('third-party/ext-a');
        vi.mocked(runtime.agent.getRun).mockReturnValue({
            run: { id: 'run-1', callerUserHandle: 'bob', callerExtensionId: 'third-party/ext-a' },
        } as ReturnType<AuthorityRuntime['agent']['getRun']>);
        const req = request();
        req.params = { runId: 'run-1' };

        await expect(get.get('/agent/runs/:runId')!(req, response())).rejects.toThrow('Agent run not found');
    });

    it('does not expose browser claim secrets in extension run details', async () => {
        const { runtime, get } = setup();
        vi.mocked(runtime.agent.getRun).mockReturnValue({
            run: { id: 'run-1', callerUserHandle: 'alice', callerExtensionId: 'third-party/ext-a' },
            messages: [],
            events: [],
            approvals: [],
            invocations: [{ callId: 'call-1', claimId: 'claim-secret' }],
        } as unknown as ReturnType<AuthorityRuntime['agent']['getRun']>);
        const req = request();
        req.params = { runId: 'run-1' };
        const res = response();

        await get.get('/agent/runs/:runId')!(req, res);

        const body = vi.mocked(res.json).mock.calls[0]![0] as { invocations: Array<{ claimId?: string }> };
        expect(body.invocations[0]!.claimId).toBeUndefined();
    });

    it('takes browser tool ownership only from the authenticated session', async () => {
        const { runtime, session, post } = setup('third-party/ext-a');
        const body = {
            extensionId: 'third-party/ext-b',
            browserInstanceId: 'tab-a',
            tools: [],
        };

        await post.get('/agent/browser-tools/register')!(request(body), response());

        expect(runtime.permissions.authorize).toHaveBeenCalledWith(
            expect.objectContaining({ handle: 'alice' }),
            session,
            { resource: 'agent.browser', target: 'tab-a' },
        );
        expect(runtime.agent.registerBrowserTools).toHaveBeenCalledWith('alice', 'third-party/ext-a', body);
    });

    it('rejects approval resolution for non-admin users', async () => {
        const { runtime, post } = setup();
        const req = request({ decision: 'approve' });
        req.params = { runId: 'run-1', approvalId: 'approval-1' };

        await expect(post.get('/admin/agent/runs/:runId/approvals/:approvalId/resolve')!(req, response()))
            .rejects.toThrow('Forbidden');
        expect(runtime.agent.resolveApproval).not.toHaveBeenCalled();
    });

    it('records the admin identity when resolving an approval', async () => {
        const { runtime, post } = setup('third-party/ext-a', true);
        const req = request({ decision: 'approve' }, true);
        req.params = { runId: 'run-1', approvalId: 'approval-1' };

        await post.get('/admin/agent/runs/:runId/approvals/:approvalId/resolve')!(req, response());

        expect(runtime.agent.resolveApproval).toHaveBeenCalledWith(
            'run-1',
            'approval-1',
            { decision: 'approve' },
            'alice',
        );
        expect(runtime.audit.logUsage).toHaveBeenCalledWith(
            expect.objectContaining({ handle: 'alice' }),
            expect.any(String),
            'Agent approval resolved',
            { runId: 'run-1', approvalId: 'approval-1', decision: 'approve' },
        );
    });

    it('allows an admin to prune terminal run details without touching active runs', async () => {
        const { runtime, post } = setup('third-party/ext-a', true);

        await post.get('/admin/agent/runs/prune')!(request({ retainLatest: 200 }, true), response());

        expect(runtime.agent.pruneTerminalRuns).toHaveBeenCalledWith(200);
        expect(runtime.audit.logUsage).toHaveBeenCalledWith(
            expect.objectContaining({ handle: 'alice' }),
            expect.any(String),
            'Terminal Agent runs pruned',
            expect.objectContaining({ retainLatest: 200 }),
        );
    });
});

import type {
    AgentWorkspaceRegisterRequest,
    WorkspaceCheckpointRequest,
    WorkspaceCommitListResponse,
    WorkspaceRollbackRequest,
} from '@stdo/shared-types';
import { AUTHORITY_SDK_EXTENSION_ID } from '../constants.js';
import type { AuthorityRuntime } from '../runtime.js';
import type { AuthorityRequest, AuthorityResponse } from '../types.js';
import { getUserContext } from '../utils.js';

type RouterLike = {
    get(path: string, handler: (req: AuthorityRequest, res: AuthorityResponse) => void | Promise<void>): void;
    post(path: string, handler: (req: AuthorityRequest, res: AuthorityResponse) => void | Promise<void>): void;
};

type RouteFailureHandler = (
    runtime: AuthorityRuntime,
    req: AuthorityRequest,
    res: AuthorityResponse,
    extensionId: string,
    error: unknown,
) => void;

export function registerAgentHistoryRoutes(
    router: RouterLike,
    runtime: AuthorityRuntime,
    fail: RouteFailureHandler,
): void {
    router.get('/admin/agent/workspaces', (req, res) => {
        try {
            assertAdmin(req);
            res.json({ workspaces: runtime.workspaceHistory.listWorkspaces() });
        } catch (error) {
            fail(runtime, req, res, AUTHORITY_SDK_EXTENSION_ID, error);
        }
    });

    router.post('/admin/agent/workspaces', async (req, res) => {
        try {
            const user = assertAdmin(req);
            const workspace = await runtime.workspaceHistory.registerWorkspace((req.body ?? {}) as AgentWorkspaceRegisterRequest);
            void runtime.audit.logUsage(user, AUTHORITY_SDK_EXTENSION_ID, 'Agent workspace registered', {
                workspaceId: workspace.id,
            }).catch(() => undefined);
            res.json(workspace);
        } catch (error) {
            fail(runtime, req, res, AUTHORITY_SDK_EXTENSION_ID, error);
        }
    });

    router.get('/admin/agent/workspaces/:workspaceId', (req, res) => {
        try {
            assertAdmin(req);
            res.json(runtime.workspaceHistory.getWorkspace(workspaceId(req)));
        } catch (error) {
            fail(runtime, req, res, AUTHORITY_SDK_EXTENSION_ID, error);
        }
    });

    router.get('/admin/agent/workspaces/:workspaceId/status', async (req, res) => {
        try {
            assertAdmin(req);
            res.json(await runtime.workspaceHistory.status(workspaceId(req)));
        } catch (error) {
            fail(runtime, req, res, AUTHORITY_SDK_EXTENSION_ID, error);
        }
    });

    router.get('/admin/agent/workspaces/:workspaceId/commits', (req, res) => {
        try {
            assertAdmin(req);
            const id = workspaceId(req);
            const limit = Number(req.query?.limit ?? 100);
            if (!Number.isSafeInteger(limit) || limit < 1 || limit > 500) {
                throw new Error('limit must be an integer between 1 and 500');
            }
            const response: WorkspaceCommitListResponse = {
                workspace: runtime.workspaceHistory.getWorkspace(id),
                commits: runtime.workspaceHistory.listCommits(id, limit),
            };
            res.json(response);
        } catch (error) {
            fail(runtime, req, res, AUTHORITY_SDK_EXTENSION_ID, error);
        }
    });

    router.get('/admin/agent/workspaces/:workspaceId/diff', (req, res) => {
        try {
            assertAdmin(req);
            const id = workspaceId(req);
            const workspace = runtime.workspaceHistory.getWorkspace(id);
            res.json(runtime.workspaceHistory.diff(
                id,
                resolveCommit(req.query?.from, workspace.headCommitId),
                resolveCommit(req.query?.to, workspace.headCommitId),
            ));
        } catch (error) {
            fail(runtime, req, res, AUTHORITY_SDK_EXTENSION_ID, error);
        }
    });

    router.post('/admin/agent/workspaces/:workspaceId/checkpoints', async (req, res) => {
        try {
            const user = assertAdmin(req);
            const response = await runtime.workspaceHistory.checkpoint(
                workspaceId(req),
                (req.body ?? {}) as WorkspaceCheckpointRequest,
                { kind: 'user', id: user.handle },
            );
            void runtime.audit.logUsage(user, AUTHORITY_SDK_EXTENSION_ID, 'Agent workspace checkpoint created', {
                workspaceId: response.workspace.id,
                commitId: response.commit.id,
                changedPaths: response.changedPaths,
            }).catch(() => undefined);
            res.json(response);
        } catch (error) {
            fail(runtime, req, res, AUTHORITY_SDK_EXTENSION_ID, error);
        }
    });

    router.post('/admin/agent/workspaces/:workspaceId/rollback', async (req, res) => {
        try {
            const user = assertAdmin(req);
            const response = await runtime.workspaceHistory.rollback(
                workspaceId(req),
                (req.body ?? {}) as WorkspaceRollbackRequest,
                { kind: 'user', id: user.handle },
            );
            void runtime.audit.logUsage(user, AUTHORITY_SDK_EXTENSION_ID, 'Agent workspace rolled back', {
                workspaceId: response.workspace.id,
                operationId: response.operationId,
                targetCommitId: response.restoredCommitId,
                rollbackCommitId: response.rollbackCommit.id,
            }).catch(() => undefined);
            res.json(response);
        } catch (error) {
            fail(runtime, req, res, AUTHORITY_SDK_EXTENSION_ID, error);
        }
    });

    router.post('/admin/agent/workspaces/:workspaceId/rollback/resume', async (req, res) => {
        try {
            const user = assertAdmin(req);
            const response = await runtime.workspaceHistory.resumeRollback(workspaceId(req));
            void runtime.audit.logUsage(user, AUTHORITY_SDK_EXTENSION_ID, 'Agent workspace rollback resumed', {
                workspaceId: response.workspace.id,
                operationId: response.operationId,
                rollbackCommitId: response.rollbackCommit.id,
            }).catch(() => undefined);
            res.json(response);
        } catch (error) {
            fail(runtime, req, res, AUTHORITY_SDK_EXTENSION_ID, error);
        }
    });
}

function assertAdmin(req: AuthorityRequest): ReturnType<typeof getUserContext> {
    const user = getUserContext(req);
    if (!user.isAdmin) {
        throw new Error('Forbidden');
    }
    return user;
}

function workspaceId(req: AuthorityRequest): string {
    try {
        return decodeURIComponent(req.params?.workspaceId ?? '');
    } catch {
        throw new Error('Invalid workspace id encoding');
    }
}

function resolveCommit(value: string | undefined, head: string | null): string | null {
    const normalized = value?.trim();
    if (!normalized || normalized === 'head') {
        return head;
    }
    return normalized === 'empty' ? null : normalized;
}

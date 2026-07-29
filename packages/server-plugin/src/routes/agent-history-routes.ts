import type {
    AgentWorkspaceRegisterRequest,
    WorkspaceCheckpointRequest,
    WorkspaceCommitListResponse,
    WorkspaceRollbackRequest,
} from '@stdo/shared-types';
import type { AuthorityRuntime } from '../runtime.js';
import type { AuthorityRequest, AuthorityResponse } from '../types.js';
import {
    withAuthorityAdmin,
    type AuthorityRouteFailureHandler,
} from './authority-route-context.js';

type RouterLike = {
    get(path: string, handler: (req: AuthorityRequest, res: AuthorityResponse) => void | Promise<void>): void;
    post(path: string, handler: (req: AuthorityRequest, res: AuthorityResponse) => void | Promise<void>): void;
};

export function registerAgentHistoryRoutes(
    router: RouterLike,
    runtime: AuthorityRuntime,
    fail: AuthorityRouteFailureHandler,
): void {
    router.get('/admin/agent/workspaces', withAuthorityAdmin(runtime, fail, async (_req, res) => {
        res.json({ workspaces: runtime.workspaceHistory.listWorkspaces() });
    }));

    router.post('/admin/agent/workspaces', withAuthorityAdmin(runtime, fail, async (req, res, context) => {
        const request = (req.body ?? {}) as AgentWorkspaceRegisterRequest;
        const workspace = await runtime.workspaceHistory.registerWorkspace({
            ...request,
            allowedUserHandles: request.allowedUserHandles ?? [context.user.handle],
        });
        void runtime.audit.logUsage(context.user, context.session.extension.id, 'Agent workspace registered', {
            workspaceId: workspace.id,
        }).catch(() => undefined);
        res.json(workspace);
    }));

    router.get('/admin/agent/workspaces/:workspaceId', withAuthorityAdmin(runtime, fail, async (req, res) => {
        res.json(runtime.workspaceHistory.getWorkspace(workspaceId(req)));
    }));

    router.get('/admin/agent/workspaces/:workspaceId/status', withAuthorityAdmin(runtime, fail, async (req, res) => {
        res.json(await runtime.workspaceHistory.status(workspaceId(req)));
    }));

    router.get('/admin/agent/workspaces/:workspaceId/commits', withAuthorityAdmin(runtime, fail, async (req, res) => {
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
    }));

    router.get('/admin/agent/workspaces/:workspaceId/diff', withAuthorityAdmin(runtime, fail, async (req, res) => {
        const id = workspaceId(req);
        const workspace = runtime.workspaceHistory.getWorkspace(id);
        res.json(runtime.workspaceHistory.diff(
            id,
            resolveCommit(req.query?.from, workspace.headCommitId),
            resolveCommit(req.query?.to, workspace.headCommitId),
        ));
    }));

    router.post('/admin/agent/workspaces/:workspaceId/checkpoints', withAuthorityAdmin(runtime, fail, async (req, res, context) => {
        const response = await runtime.workspaceHistory.checkpoint(
            workspaceId(req),
            (req.body ?? {}) as WorkspaceCheckpointRequest,
            { kind: 'user', id: context.user.handle },
        );
        void runtime.audit.logUsage(context.user, context.session.extension.id, 'Agent workspace checkpoint created', {
            workspaceId: response.workspace.id,
            commitId: response.commit.id,
            changedPaths: response.changedPaths,
        }).catch(() => undefined);
        res.json(response);
    }));

    router.post('/admin/agent/workspaces/:workspaceId/rollback', withAuthorityAdmin(runtime, fail, async (req, res, context) => {
        const response = await runtime.workspaceHistory.rollback(
            workspaceId(req),
            (req.body ?? {}) as WorkspaceRollbackRequest,
            { kind: 'user', id: context.user.handle },
        );
        void runtime.audit.logUsage(context.user, context.session.extension.id, 'Agent workspace rolled back', {
            workspaceId: response.workspace.id,
            operationId: response.operationId,
            targetCommitId: response.restoredCommitId,
            rollbackCommitId: response.rollbackCommit.id,
        }).catch(() => undefined);
        res.json(response);
    }));

    router.post('/admin/agent/workspaces/:workspaceId/rollback/resume', withAuthorityAdmin(runtime, fail, async (req, res, context) => {
        const response = await runtime.workspaceHistory.resumeRollback(workspaceId(req));
        void runtime.audit.logUsage(context.user, context.session.extension.id, 'Agent workspace rollback resumed', {
            workspaceId: response.workspace.id,
            operationId: response.operationId,
            rollbackCommitId: response.rollbackCommit.id,
        }).catch(() => undefined);
        res.json(response);
    }));
}

function workspaceId(req: AuthorityRequest): string {
    const value = req.params?.workspaceId;
    if (typeof value !== 'string' || !value) {
        throw new Error('Invalid workspace id');
    }
    // Express has already decoded route parameters once.
    return value;
}

function resolveCommit(value: string | undefined, head: string | null): string | null {
    const normalized = value?.trim();
    if (!normalized || normalized === 'head') {
        return head;
    }
    return normalized === 'empty' ? null : normalized;
}

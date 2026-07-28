import type {
    AgentApprovalResolveRequest,
    AgentBrowserToolClaimRequest,
    AgentBrowserToolRegistrationRequest,
    AgentLlmProfileInput,
    AgentRunCreateRequest,
    AgentToolResultRequest,
    PermissionResource,
} from '@stdo/shared-types';
import { AUTHORITY_SDK_EXTENSION_ID } from '../constants.js';
import type { AuthorityRuntime } from '../runtime.js';
import type { AuthorityRequest, AuthorityResponse, SessionRecord, UserContext } from '../types.js';
import { getSessionToken, getUserContext } from '../utils.js';

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

export function registerAgentRoutes(router: RouterLike, runtime: AuthorityRuntime, fail: RouteFailureHandler): void {
    router.get('/agent/tools', async (req, res) => {
        let extensionId = AUTHORITY_SDK_EXTENSION_ID;
        try {
            const { user, session } = await caller(runtime, req);
            extensionId = session.extension.id;
            res.json({ tools: runtime.agent.listTools(extensionId, user.handle) });
        } catch (error) {
            fail(runtime, req, res, extensionId, error);
        }
    });

    router.get('/agent/runs', async (req, res) => {
        let extensionId = AUTHORITY_SDK_EXTENSION_ID;
        try {
            await runtime.agent.start();
            const { user, session } = await caller(runtime, req);
            extensionId = session.extension.id;
            res.json({ runs: runtime.agent.listRuns(extensionId, user.handle) });
        } catch (error) {
            fail(runtime, req, res, extensionId, error);
        }
    });

    router.post('/agent/runs', async (req, res) => {
        let extensionId = AUTHORITY_SDK_EXTENSION_ID;
        try {
            const request = (req.body ?? {}) as AgentRunCreateRequest;
            const workspaceId = request.workspaceId?.trim();
            if (!workspaceId) {
                throw new Error('Agent workspaceId is required');
            }
            await runtime.agent.start();
            const context = await caller(runtime, req);
            extensionId = context.session.extension.id;
            runtime.workspaceHistory.assertWorkspaceAccess(workspaceId, context.user.handle, context.user.isAdmin);
            if (!await runtime.permissions.authorize(context.user, context.session, {
                resource: 'agent.run',
                target: workspaceId,
            })) {
                throw new Error(`Permission not granted: agent.run for ${workspaceId}`);
            }
            const run = runtime.agent.createRun({ ...request, workspaceId }, extensionId, context);
            void runtime.audit.logUsage(context.user, extensionId, 'Agent run created', {
                runId: run.id,
                workspaceId: run.workspaceId,
                mode: run.mode,
            }).catch(() => undefined);
            res.json(run);
        } catch (error) {
            fail(runtime, req, res, extensionId, error);
        }
    });

    router.get('/agent/runs/:runId', async (req, res) => {
        let extensionId = AUTHORITY_SDK_EXTENSION_ID;
        try {
            await runtime.agent.start();
            const { user, session } = await caller(runtime, req);
            extensionId = session.extension.id;
            res.json(ownedRun(runtime, runId(req), user.handle, extensionId));
        } catch (error) {
            fail(runtime, req, res, extensionId, error);
        }
    });

    router.post('/agent/runs/:runId/cancel', async (req, res) => {
        let extensionId = AUTHORITY_SDK_EXTENSION_ID;
        try {
            await runtime.agent.start();
            const { user, session } = await caller(runtime, req);
            extensionId = session.extension.id;
            const id = runId(req);
            ownedRun(runtime, id, user.handle, extensionId);
            const run = runtime.agent.cancelRun(id);
            void runtime.audit.logUsage(user, extensionId, 'Agent run cancelled', { runId: id }).catch(() => undefined);
            res.json(run);
        } catch (error) {
            fail(runtime, req, res, extensionId, error);
        }
    });

    router.post('/agent/browser-tools/register', async (req, res) => {
        let extensionId = AUTHORITY_SDK_EXTENSION_ID;
        try {
            const request = (req.body ?? {}) as AgentBrowserToolRegistrationRequest;
            const browserInstanceId = request.browserInstanceId?.trim();
            if (!browserInstanceId) {
                throw new Error('Browser instance id is required');
            }
            const { user, session } = await caller(runtime, req, browserInstanceId, 'agent.browser');
            extensionId = session.extension.id;
            res.json(runtime.agent.registerBrowserTools(
                user.handle,
                extensionId,
                { ...request, browserInstanceId },
            ));
        } catch (error) {
            fail(runtime, req, res, extensionId, error);
        }
    });

    router.post('/agent/browser-tools/claim', async (req, res) => {
        let extensionId = AUTHORITY_SDK_EXTENSION_ID;
        try {
            const { user, session } = await caller(runtime, req);
            extensionId = session.extension.id;
            res.json(runtime.agent.claimBrowserTool(
                user.handle,
                extensionId,
                (req.body ?? {}) as AgentBrowserToolClaimRequest,
            ));
        } catch (error) {
            fail(runtime, req, res, extensionId, error);
        }
    });

    router.post('/agent/browser-tools/result', async (req, res) => {
        let extensionId = AUTHORITY_SDK_EXTENSION_ID;
        try {
            const { user, session } = await caller(runtime, req);
            extensionId = session.extension.id;
            res.json(runtime.agent.submitBrowserToolResult(
                user.handle,
                extensionId,
                (req.body ?? {}) as AgentToolResultRequest,
            ));
        } catch (error) {
            fail(runtime, req, res, extensionId, error);
        }
    });

    router.get('/admin/agent/profiles', (req, res) => {
        try {
            assertAdmin(req);
            res.json({ profiles: runtime.agent.listProfiles() });
        } catch (error) {
            fail(runtime, req, res, AUTHORITY_SDK_EXTENSION_ID, error);
        }
    });

    router.post('/admin/agent/profiles', (req, res) => {
        try {
            const user = assertAdmin(req);
            const profile = runtime.agent.upsertProfile((req.body ?? {}) as AgentLlmProfileInput);
            void runtime.audit.logUsage(user, AUTHORITY_SDK_EXTENSION_ID, 'Agent LLM profile saved', {
                profileId: profile.id,
                baseUrl: profile.baseUrl,
                model: profile.model,
            }).catch(() => undefined);
            res.json(profile);
        } catch (error) {
            fail(runtime, req, res, AUTHORITY_SDK_EXTENSION_ID, error);
        }
    });

    router.get('/admin/agent/profiles/:profileId', (req, res) => {
        try {
            assertAdmin(req);
            res.json(runtime.agent.getProfile(decodeParam(req.params?.profileId, 'profile id')));
        } catch (error) {
            fail(runtime, req, res, AUTHORITY_SDK_EXTENSION_ID, error);
        }
    });

    router.post('/admin/agent/profiles/:profileId/delete', (req, res) => {
        try {
            const user = assertAdmin(req);
            const profileId = decodeParam(req.params?.profileId, 'profile id');
            const deleted = runtime.agent.deleteProfile(profileId);
            void runtime.audit.logUsage(user, AUTHORITY_SDK_EXTENSION_ID, 'Agent LLM profile deleted', {
                profileId,
                deleted,
            }).catch(() => undefined);
            res.json({ deleted });
        } catch (error) {
            fail(runtime, req, res, AUTHORITY_SDK_EXTENSION_ID, error);
        }
    });

    router.get('/admin/agent/runs', async (req, res) => {
        try {
            assertAdmin(req);
            await runtime.agent.start();
            res.json({ runs: runtime.agent.listRuns() });
        } catch (error) {
            fail(runtime, req, res, AUTHORITY_SDK_EXTENSION_ID, error);
        }
    });

    router.get('/admin/agent/runs/:runId', async (req, res) => {
        try {
            assertAdmin(req);
            await runtime.agent.start();
            res.json(runtime.agent.getRun(runId(req)));
        } catch (error) {
            fail(runtime, req, res, AUTHORITY_SDK_EXTENSION_ID, error);
        }
    });

    router.post('/admin/agent/runs/:runId/cancel', async (req, res) => {
        try {
            const user = assertAdmin(req);
            await runtime.agent.start();
            const id = runId(req);
            const run = runtime.agent.cancelRun(id);
            void runtime.audit.logUsage(user, AUTHORITY_SDK_EXTENSION_ID, 'Agent run cancelled by admin', {
                runId: id,
            }).catch(() => undefined);
            res.json(run);
        } catch (error) {
            fail(runtime, req, res, AUTHORITY_SDK_EXTENSION_ID, error);
        }
    });

    router.post('/admin/agent/runs/:runId/approvals/:approvalId/resolve', async (req, res) => {
        try {
            const user = assertAdmin(req);
            await runtime.agent.start();
            const id = runId(req);
            const approvalId = decodeParam(req.params?.approvalId, 'approval id');
            const request = (req.body ?? {}) as AgentApprovalResolveRequest;
            const approval = runtime.agent.resolveApproval(id, approvalId, request, user.handle);
            void runtime.audit.logUsage(user, AUTHORITY_SDK_EXTENSION_ID, 'Agent approval resolved', {
                runId: id,
                approvalId,
                decision: request.decision,
            }).catch(() => undefined);
            res.json(approval);
        } catch (error) {
            fail(runtime, req, res, AUTHORITY_SDK_EXTENSION_ID, error);
        }
    });
}

async function caller(
    runtime: AuthorityRuntime,
    req: AuthorityRequest,
    permissionTarget?: string,
    permissionResource: PermissionResource = 'agent.run',
): Promise<{ user: UserContext; session: SessionRecord }> {
    const user = getUserContext(req);
    const session = await runtime.sessions.assertSession(getSessionToken(req), user);
    if (permissionTarget !== undefined
        && !await runtime.permissions.authorize(user, session, { resource: permissionResource, target: permissionTarget })) {
        throw new Error(`Permission not granted: ${permissionResource} for ${permissionTarget}`);
    }
    return { user, session };
}

function assertAdmin(req: AuthorityRequest): UserContext {
    const user = getUserContext(req);
    if (!user.isAdmin) {
        throw new Error('Forbidden');
    }
    return user;
}

function ownedRun(
    runtime: AuthorityRuntime,
    id: string,
    userHandle: string,
    extensionId: string,
): ReturnType<AuthorityRuntime['agent']['getRun']> {
    const detail = runtime.agent.getRun(id);
    if (detail.run.callerUserHandle !== userHandle || detail.run.callerExtensionId !== extensionId) {
        throw new Error(`Agent run not found: ${id}`);
    }
    const result = structuredClone(detail);
    for (const invocation of result.invocations) {
        delete invocation.claimId;
    }
    return result;
}

function runId(req: AuthorityRequest): string {
    return decodeParam(req.params?.runId, 'run id');
}

function decodeParam(value: string | undefined, label: string): string {
    try {
        const result = decodeURIComponent(value ?? '');
        if (!result) throw new Error();
        return result;
    } catch {
        throw new Error(`Invalid ${label}`);
    }
}

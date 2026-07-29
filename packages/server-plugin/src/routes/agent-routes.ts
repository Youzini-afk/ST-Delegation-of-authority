import type {
    AgentApprovalResolveRequest,
    AgentBrowserToolClaimRequest,
    AgentBrowserToolRegistrationRequest,
    AgentLlmProfileInput,
    AgentSessionCreateRequest,
    AgentSessionListRequest,
    AgentSessionSendRequest,
    AgentSessionUpdateRequest,
    AgentBrowserToolResultRequest,
    PermissionResource,
} from '@stdo/shared-types';
import { AUTHORITY_SDK_EXTENSION_ID } from '../constants.js';
import type { AuthorityRuntime } from '../runtime.js';
import type { AgentSessionJournalRecord, AgentSessionSnapshot } from '../services/agent-session-model.js';
import { OneTimeTicketStore } from '../services/one-time-ticket-store.js';
import type { AuthorityRequest, AuthorityResponse, SessionRecord, UserContext } from '../types.js';
import { getUserContext } from '../utils.js';
import {
    requireAuthorityCaller,
    withAuthorityAdmin,
    type AuthorityRouteFailureHandler,
} from './authority-route-context.js';
import {
    pageAgentSessions,
    presentAgentSession,
    presentAgentSessionEvent,
    presentAgentSessionInvocation,
} from './agent-session-presenter.js';

type RouterLike = {
    get(path: string, handler: (req: AuthorityRequest, res: AuthorityResponse) => void | Promise<void>): void;
    post(path: string, handler: (req: AuthorityRequest, res: AuthorityResponse) => void | Promise<void>): void;
};

type RouteFailureHandler = AuthorityRouteFailureHandler;

interface AgentStreamTicket {
    sessionId: string;
    context: { user: UserContext; session: SessionRecord };
}

export function registerAgentRoutes(router: RouterLike, runtime: AuthorityRuntime, fail: RouteFailureHandler): void {
    const streamTickets = new OneTimeTicketStore<AgentStreamTicket>();
    router.get('/agent/tools', async (req, res) => {
        let extensionId = AUTHORITY_SDK_EXTENSION_ID;
        try {
            await runtime.agentSessions.start();
            const { user, session } = await caller(runtime, req);
            extensionId = session.extension.id;
            res.json({ tools: runtime.agentSessions.tools.list(user.handle, extensionId) });
        } catch (error) {
            fail(runtime, req, res, extensionId, error);
        }
    });

    router.get('/agent/sessions', async (req, res) => {
        let extensionId = AUTHORITY_SDK_EXTENSION_ID;
        try {
            await runtime.agentSessions.start();
            const { user, session } = await caller(runtime, req);
            extensionId = session.extension.id;
            res.json(pageAgentSessions(
                runtime.agentSessions.listSessions(extensionId, user.handle),
            ));
        } catch (error) {
            fail(runtime, req, res, extensionId, error);
        }
    });

    router.post('/agent/sessions/list', async (req, res) => {
        let extensionId = AUTHORITY_SDK_EXTENSION_ID;
        try {
            await runtime.agentSessions.start();
            const { user, session } = await caller(runtime, req);
            extensionId = session.extension.id;
            res.json(pageAgentSessions(
                runtime.agentSessions.listSessions(extensionId, user.handle),
                (req.body ?? {}) as AgentSessionListRequest,
            ));
        } catch (error) {
            fail(runtime, req, res, extensionId, error);
        }
    });

    router.post('/agent/sessions', async (req, res) => {
        let extensionId = AUTHORITY_SDK_EXTENSION_ID;
        try {
            await runtime.agentSessions.start();
            const request = (req.body ?? {}) as AgentSessionCreateRequest;
            const workspaceId = requiredWorkspaceId(request.workspaceId);
            const context = await callerForWorkspace(runtime, req, workspaceId);
            extensionId = context.session.extension.id;
            const snapshot = await runtime.agentSessions.createSession(
                { ...request, workspaceId },
                extensionId,
                context,
            );
            void runtime.audit.logUsage(context.user, extensionId, 'Agent session created', {
                sessionId: snapshot.session.id,
                workspaceId: snapshot.session.workspaceId,
                mode: snapshot.session.mode,
            }).catch(() => undefined);
            res.json(presentAgentSession(snapshot));
        } catch (error) {
            fail(runtime, req, res, extensionId, error);
        }
    });

    router.get('/agent/sessions/:sessionId', async (req, res) => {
        let extensionId = AUTHORITY_SDK_EXTENSION_ID;
        try {
            await runtime.agentSessions.start();
            const context = await caller(runtime, req);
            extensionId = context.session.extension.id;
            const snapshot = await ownedSession(runtime, sessionId(req), context);
            res.json(presentAgentSession(snapshot));
        } catch (error) {
            fail(runtime, req, res, extensionId, error);
        }
    });

    router.post('/agent/sessions/:sessionId/update', async (req, res) => {
        let extensionId = AUTHORITY_SDK_EXTENSION_ID;
        try {
            await runtime.agentSessions.start();
            const context = await caller(runtime, req);
            extensionId = context.session.extension.id;
            const snapshot = await runtime.agentSessions.updateSession(
                sessionId(req),
                (req.body ?? {}) as AgentSessionUpdateRequest,
                extensionId,
                context,
            );
            res.json(presentAgentSession(snapshot));
        } catch (error) {
            fail(runtime, req, res, extensionId, error);
        }
    });

    router.post('/agent/sessions/:sessionId/messages', async (req, res) => {
        let extensionId = AUTHORITY_SDK_EXTENSION_ID;
        try {
            await runtime.agentSessions.start();
            const id = sessionId(req);
            const context = await caller(runtime, req);
            extensionId = context.session.extension.id;
            const existing = await ownedSession(runtime, id, context, false);
            await authorizeWorkspace(runtime, context, existing.session.workspaceId);
            const result = await runtime.agentSessions.sendMessage(
                id,
                (req.body ?? {}) as AgentSessionSendRequest,
                extensionId,
                context,
            );
            void runtime.audit.logUsage(context.user, extensionId, 'Agent session message accepted', {
                sessionId: id,
                runId: result.runId,
                queuedMessageId: result.queuedMessageId,
            }).catch(() => undefined);
            res.json({
                snapshot: presentAgentSession(result.snapshot),
                runId: result.runId,
                queuedMessageId: result.queuedMessageId,
            });
        } catch (error) {
            fail(runtime, req, res, extensionId, error);
        }
    });

    router.post('/agent/sessions/:sessionId/runs/:runId/cancel', async (req, res) => {
        let extensionId = AUTHORITY_SDK_EXTENSION_ID;
        try {
            await runtime.agentSessions.start();
            const id = sessionId(req);
            const context = await caller(runtime, req);
            extensionId = context.session.extension.id;
            await ownedSession(runtime, id, context);
            const snapshot = await runtime.agentSessions.cancelRun(id, runId(req));
            void runtime.audit.logUsage(context.user, extensionId, 'Agent session run cancelled', {
                sessionId: id,
                runId: runId(req),
            }).catch(() => undefined);
            res.json(presentAgentSession(snapshot));
        } catch (error) {
            fail(runtime, req, res, extensionId, error);
        }
    });

    router.post('/agent/sessions/:sessionId/runs/:runId/resume', async (req, res) => {
        let extensionId = AUTHORITY_SDK_EXTENSION_ID;
        try {
            await runtime.agentSessions.start();
            const id = sessionId(req);
            const context = await caller(runtime, req);
            extensionId = context.session.extension.id;
            const existing = await ownedSession(runtime, id, context, false);
            await authorizeWorkspace(runtime, context, existing.session.workspaceId);
            const snapshot = await runtime.agentSessions.resumeRun(id, runId(req), extensionId, context);
            void runtime.audit.logUsage(context.user, extensionId, 'Agent session run resumed', {
                sessionId: id,
                runId: runId(req),
            }).catch(() => undefined);
            res.json(presentAgentSession(snapshot));
        } catch (error) {
            fail(runtime, req, res, extensionId, error);
        }
    });

    router.post('/agent/sessions/:sessionId/events-ticket', async (req, res) => {
        let extensionId = AUTHORITY_SDK_EXTENSION_ID;
        try {
            await runtime.agentSessions.start();
            const id = sessionId(req);
            const context = await caller(runtime, req);
            extensionId = context.session.extension.id;
            await ownedSession(runtime, id, context);
            res.json(streamTickets.issue({ sessionId: id, context }));
        } catch (error) {
            fail(runtime, req, res, extensionId, error);
        }
    });

    router.get('/agent/sessions/:sessionId/events', async (req, res) => {
        let extensionId = AUTHORITY_SDK_EXTENSION_ID;
        let streamClose: (() => void) | null = null;
        let heartbeat: ReturnType<typeof setInterval> | null = null;
        let disconnected = false;
        const cleanup = () => {
            disconnected = true;
            if (heartbeat !== null) clearInterval(heartbeat);
            heartbeat = null;
            streamClose?.();
            streamClose = null;
        };
        res.on?.('close', cleanup);
        try {
            await runtime.agentSessions.start();
            const id = sessionId(req);
            const ticket = streamTickets.consume(req.query?.ticket);
            if (!ticket || ticket.sessionId !== id) {
                throw new Error('Agent session stream ticket is invalid or expired');
            }
            const requestUser = getUserContext(req);
            if (requestUser.handle !== ticket.context.user.handle
                || requestUser.isAdmin !== ticket.context.user.isAdmin) {
                throw new Error('Agent session stream ticket owner mismatch');
            }
            const context = ticket.context;
            extensionId = context.session.extension.id;
            const buffered: AgentSessionJournalRecord[] = [];
            let ready = false;
            const opened = await runtime.agentSessions.openSubscription(
                id,
                record => {
                    if (!ready) {
                        buffered.push(record);
                        return;
                    }
                    writeSse(res, 'authority.agent.session.event', presentAgentSessionEvent(id, record));
                },
                extensionId,
                context,
            );
            streamClose = opened.close;
            if (disconnected) {
                cleanup();
                return;
            }

            res.setHeader('Content-Type', 'text/event-stream');
            res.setHeader('Cache-Control', 'no-cache');
            res.setHeader('Connection', 'keep-alive');
            res.write('retry: 2000\n\n');
            writeSse(
                res,
                'authority.agent.session.snapshot',
                presentAgentSession(opened.snapshot),
            );
            ready = true;
            for (const record of buffered) {
                if (record.sequence > opened.snapshot.lastSequence) {
                    writeSse(res, 'authority.agent.session.event', presentAgentSessionEvent(id, record));
                }
            }
            heartbeat = setInterval(() => res.write(': keepalive\n\n'), 15_000);
            heartbeat.unref?.();
        } catch (error) {
            cleanup();
            fail(runtime, req, res, extensionId, error);
        }
    });

    router.post('/agent/browser-tools/register', async (req, res) => {
        let extensionId = AUTHORITY_SDK_EXTENSION_ID;
        try {
            await runtime.agentSessions.start();
            const request = (req.body ?? {}) as AgentBrowserToolRegistrationRequest;
            const browserInstanceId = request.browserInstanceId?.trim();
            if (!browserInstanceId) throw new Error('Browser instance id is required');
            const { user, session } = await caller(runtime, req, browserInstanceId, 'agent.browser');
            extensionId = session.extension.id;
            res.json(runtime.agentSessions.registerBrowserTools(
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
            await runtime.agentSessions.start();
            const request = (req.body ?? {}) as AgentBrowserToolClaimRequest;
            const browserInstanceId = requiredBrowserInstanceId(request.browserInstanceId);
            const { user, session } = await caller(runtime, req, browserInstanceId, 'agent.browser');
            extensionId = session.extension.id;
            const claimed = await runtime.agentSessions.claimBrowserTool(
                user.handle,
                extensionId,
                { ...request, browserInstanceId },
            );
            res.json({
                sessionId: claimed?.sessionId ?? null,
                invocation: claimed ? presentAgentSessionInvocation(claimed.invocation) : null,
            });
        } catch (error) {
            fail(runtime, req, res, extensionId, error);
        }
    });

    router.post('/agent/browser-tools/result', async (req, res) => {
        let extensionId = AUTHORITY_SDK_EXTENSION_ID;
        try {
            await runtime.agentSessions.start();
            const request = (req.body ?? {}) as AgentBrowserToolResultRequest;
            const browserInstanceId = requiredBrowserInstanceId(request.browserInstanceId);
            const { user, session } = await caller(runtime, req, browserInstanceId, 'agent.browser');
            extensionId = session.extension.id;
            const invocation = await runtime.agentSessions.submitBrowserToolResult(
                user.handle,
                extensionId,
                { ...request, browserInstanceId },
            );
            res.json(presentAgentSessionInvocation(invocation));
        } catch (error) {
            fail(runtime, req, res, extensionId, error);
        }
    });

    registerAgentAdminRoutes(router, runtime, fail);
}

function registerAgentAdminRoutes(
    router: RouterLike,
    runtime: AuthorityRuntime,
    fail: RouteFailureHandler,
): void {
    router.get('/admin/agent/profiles', withAuthorityAdmin(runtime, fail, async (_req, res) => {
        res.json({ profiles: runtime.agentProfiles.listProfiles() });
    }));

    router.post('/admin/agent/profiles', withAuthorityAdmin(runtime, fail, async (req, res, context) => {
            const profile = runtime.agentProfiles.upsertProfile((req.body ?? {}) as AgentLlmProfileInput);
            void runtime.audit.logUsage(context.user, context.session.extension.id, 'Agent LLM profile saved', {
                profileId: profile.id,
                baseUrl: profile.baseUrl,
                model: profile.model,
            }).catch(() => undefined);
            res.json(profile);
    }));

    router.get('/admin/agent/profiles/:profileId', withAuthorityAdmin(runtime, fail, async (req, res) => {
        res.json(runtime.agentProfiles.getProfile(decodeParam(req.params?.profileId, 'profile id')));
    }));

    router.post('/admin/agent/profiles/:profileId/delete', withAuthorityAdmin(runtime, fail, async (req, res, context) => {
            const profileId = decodeParam(req.params?.profileId, 'profile id');
            const deleted = runtime.agentProfiles.deleteProfile(profileId);
            void runtime.audit.logUsage(context.user, context.session.extension.id, 'Agent LLM profile deleted', {
                profileId,
                deleted,
            }).catch(() => undefined);
            res.json({ deleted });
    }));

    router.get('/admin/agent/sessions', withAuthorityAdmin(runtime, fail, async (_req, res) => {
        await runtime.agentSessions.start();
        res.json(pageAgentSessions(runtime.agentSessions.listSessions()));
    }));

    router.post('/admin/agent/sessions/list', withAuthorityAdmin(runtime, fail, async (req, res) => {
            await runtime.agentSessions.start();
            res.json(pageAgentSessions(
                runtime.agentSessions.listSessions(),
                (req.body ?? {}) as AgentSessionListRequest,
            ));
    }));

    router.get('/admin/agent/sessions/:sessionId', withAuthorityAdmin(runtime, fail, async (req, res) => {
        await runtime.agentSessions.start();
        res.json(presentAgentSession(await runtime.agentSessions.getSession(sessionId(req))));
    }));

    router.post('/admin/agent/sessions/:sessionId/runs/:runId/cancel', withAuthorityAdmin(runtime, fail, async (req, res, context) => {
            await runtime.agentSessions.start();
            const id = sessionId(req);
            const run = runId(req);
            const snapshot = await runtime.agentSessions.cancelRun(id, run);
            void runtime.audit.logUsage(context.user, context.session.extension.id, 'Agent session run cancelled by admin', {
                sessionId: id,
                runId: run,
            }).catch(() => undefined);
            res.json(presentAgentSession(snapshot));
    }));

    router.post('/admin/agent/sessions/:sessionId/approvals/:approvalId/resolve', withAuthorityAdmin(runtime, fail, async (req, res, context) => {
            await runtime.agentSessions.start();
            const id = sessionId(req);
            const approvalId = decodeParam(req.params?.approvalId, 'approval id');
            const request = (req.body ?? {}) as AgentApprovalResolveRequest;
            const decision = requiredApprovalDecision(request.decision);
            const snapshot = await runtime.agentSessions.resolveApproval(id, approvalId, decision, context.user.handle);
            void runtime.audit.logUsage(context.user, context.session.extension.id, 'Agent approval resolved', {
                sessionId: id,
                approvalId,
                decision,
            }).catch(() => undefined);
            res.json(presentAgentSession(snapshot));
    }));
}

async function caller(
    runtime: AuthorityRuntime,
    req: AuthorityRequest,
    permissionTarget?: string,
    permissionResource: PermissionResource = 'agent.run',
): Promise<{ user: UserContext; session: SessionRecord }> {
    const { user, session } = await requireAuthorityCaller(runtime, req);
    if (permissionTarget !== undefined
        && !await runtime.permissions.authorize(user, session, { resource: permissionResource, target: permissionTarget })) {
        throw new Error(`Permission not granted: ${permissionResource} for ${permissionTarget}`);
    }
    return { user, session };
}

async function callerForWorkspace(
    runtime: AuthorityRuntime,
    req: AuthorityRequest,
    workspaceId: string,
): Promise<{ user: UserContext; session: SessionRecord }> {
    const context = await caller(runtime, req);
    await authorizeWorkspace(runtime, context, workspaceId);
    return context;
}

async function authorizeWorkspace(
    runtime: AuthorityRuntime,
    context: { user: UserContext; session: SessionRecord },
    workspaceId: string,
): Promise<void> {
    runtime.workspaceHistory.assertWorkspaceAccess(workspaceId, context.user.handle, context.user.isAdmin);
    if (!await runtime.permissions.authorize(context.user, context.session, {
        resource: 'agent.run',
        target: workspaceId,
    })) {
        throw new Error(`Permission not granted: agent.run for ${workspaceId}`);
    }
}

async function ownedSession(
    runtime: AuthorityRuntime,
    id: string,
    context: { user: UserContext; session: SessionRecord },
    attachContext = true,
): Promise<AgentSessionSnapshot> {
    const snapshot = await runtime.agentSessions.getSession(id);
    if (snapshot.session.callerUserHandle !== context.user.handle
        || snapshot.session.callerExtensionId !== context.session.extension.id) {
        throw new Error(`Agent session not found: ${id}`);
    }
    if (attachContext) {
        runtime.agentSessions.attachContext(id, context.session.extension.id, context);
    }
    return snapshot;
}

function requiredWorkspaceId(value: unknown): string {
    if (typeof value !== 'string' || !value.trim()) throw new Error('Agent workspaceId is required');
    return value.trim();
}

function requiredBrowserInstanceId(value: unknown): string {
    if (typeof value !== 'string' || !value.trim()) throw new Error('Browser instance id is required');
    return value.trim();
}

function requiredApprovalDecision(value: unknown): 'approve' | 'deny' {
    if (value !== 'approve' && value !== 'deny') {
        throw new Error('Agent approval decision must be approve or deny');
    }
    return value;
}

function sessionId(req: AuthorityRequest): string {
    return decodeParam(req.params?.sessionId, 'session id');
}

function runId(req: AuthorityRequest): string {
    return decodeParam(req.params?.runId, 'run id');
}

function decodeParam(value: string | undefined, label: string): string {
    if (typeof value !== 'string' || !value) throw new Error(`Invalid ${label}`);
    // Express has already decoded route parameters once. Decoding again would
    // turn a literal "%2F" in an id into a different resource name.
    return value;
}

function writeSse(res: AuthorityResponse, event: string, data: unknown): void {
    res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
}

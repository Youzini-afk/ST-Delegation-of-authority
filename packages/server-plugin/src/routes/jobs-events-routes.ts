import type { JobListRequest } from '@stdo/shared-types';
import type { AuthorityRuntime } from '../runtime.js';
import { OneTimeTicketStore } from '../services/one-time-ticket-store.js';
import { getUserAuthorityPaths } from '../store/authority-paths.js';
import type { AuthorityRequest, AuthorityResponse, SessionRecord, UserContext } from '../types.js';
import { getSessionToken, getUserContext } from '../utils.js';

type RouterLike = {
    get(path: string, handler: (req: AuthorityRequest, res: AuthorityResponse) => void | Promise<void>): void;
    post(path: string, handler: (req: AuthorityRequest, res: AuthorityResponse) => void | Promise<void>): void;
};

type RouteFailureHandler = (runtime: AuthorityRuntime, req: AuthorityRequest, res: AuthorityResponse, extensionId: string, error: unknown) => void;

function ok(res: AuthorityResponse, data: unknown): void {
    res.json(data);
}

interface EventStreamTicket {
    user: UserContext;
    session: SessionRecord;
    channel: string;
}

export function registerJobsAndEventsRoutes(router: RouterLike, runtime: AuthorityRuntime, fail: RouteFailureHandler): void {
    const streamTickets = new OneTimeTicketStore<EventStreamTicket>();
    router.post('/jobs/create', async (req, res) => {
        try {
            const user = getUserContext(req);
            const session = await runtime.sessions.assertSession(getSessionToken(req), user);
            const jobType = String(req.body?.type ?? '');
            if (!await runtime.permissions.authorize(user, session, { resource: 'jobs.background', target: jobType })) {
                throw new Error(`Permission not granted: jobs.background for ${jobType}`);
            }

            const jobOptions: Record<string, unknown> = {};
            if (typeof req.body?.timeoutMs === 'number') jobOptions.timeoutMs = req.body.timeoutMs;
            if (typeof req.body?.idempotencyKey === 'string') jobOptions.idempotencyKey = req.body.idempotencyKey;
            if (typeof req.body?.maxAttempts === 'number') jobOptions.maxAttempts = req.body.maxAttempts;
            const job = await runtime.jobs.create(user, session.extension.id, jobType, req.body?.payload ?? {}, jobOptions);
            await runtime.audit.logUsage(user, session.extension.id, 'Job created', { jobId: job.id, jobType });
            ok(res, job);
        } catch (error) {
            fail(runtime, req, res, 'jobs.background', error);
        }
    });

    router.get('/jobs', async (req, res) => {
        try {
            const user = getUserContext(req);
            const session = await runtime.sessions.assertSession(getSessionToken(req), user);
            ok(res, await runtime.jobs.list(user, session.extension.id));
        } catch (error) {
            fail(runtime, req, res, 'jobs.background', error);
        }
    });

    router.post('/jobs/list', async (req, res) => {
        try {
            const user = getUserContext(req);
            const session = await runtime.sessions.assertSession(getSessionToken(req), user);
            const payload = (req.body ?? {}) as JobListRequest;
            ok(res, await runtime.jobs.listPage(user, session.extension.id, payload));
        } catch (error) {
            fail(runtime, req, res, 'jobs.background', error);
        }
    });

    router.get('/jobs/:id', async (req, res) => {
        try {
            const user = getUserContext(req);
            const session = await runtime.sessions.assertSession(getSessionToken(req), user);
            const job = await runtime.jobs.get(user, String(req.params?.id ?? ''));
            if (!job || job.extensionId !== session.extension.id) {
                throw new Error('Job not found');
            }

            ok(res, job);
        } catch (error) {
            fail(runtime, req, res, 'jobs.background', error);
        }
    });

    router.post('/jobs/:id/cancel', async (req, res) => {
        try {
            const user = getUserContext(req);
            const session = await runtime.sessions.assertSession(getSessionToken(req), user);
            const job = await runtime.jobs.cancel(user, session.extension.id, String(req.params?.id ?? ''));
            await runtime.audit.logUsage(user, session.extension.id, 'Job cancelled', { jobId: job.id });
            ok(res, job);
        } catch (error) {
            fail(runtime, req, res, 'jobs.background', error);
        }
    });

    router.post('/jobs/:id/requeue', async (req, res) => {
        try {
            const user = getUserContext(req);
            const session = await runtime.sessions.assertSession(getSessionToken(req), user);
            const jobId = String(req.params?.id ?? '');
            const existing = await runtime.jobs.get(user, jobId);
            if (!existing || existing.extensionId !== session.extension.id) {
                throw new Error('Job not found');
            }
            if (!await runtime.permissions.authorize(user, session, { resource: 'jobs.background', target: existing.type })) {
                throw new Error(`Permission not granted: jobs.background for ${existing.type}`);
            }

            const job = await runtime.jobs.requeue(user, session.extension.id, jobId);
            await runtime.audit.logUsage(user, session.extension.id, 'Job requeued', {
                previousJobId: jobId,
                jobId: job.id,
                jobType: job.type,
            });
            ok(res, job);
        } catch (error) {
            fail(runtime, req, res, 'jobs.background', error);
        }
    });

    router.post('/events/ticket', async (req, res) => {
        let extensionId = 'events.stream';
        try {
            const user = getUserContext(req);
            const session = await runtime.sessions.assertSession(getSessionToken(req), user);
            extensionId = session.extension.id;
            const channel = eventChannel(req.body?.channel, session.extension.id);
            if (!await runtime.permissions.authorize(user, session, { resource: 'events.stream', target: channel })) {
                throw new Error(`Permission not granted: events.stream for ${channel}`);
            }
            ok(res, streamTickets.issue({ user, session, channel }));
        } catch (error) {
            fail(runtime, req, res, extensionId, error);
        }
    });

    router.get('/events/stream', async (req, res) => {
        let extensionId = 'events.stream';
        let closeBroker: (() => void) | null = null;
        let disconnected = false;
        const cleanup = () => {
            disconnected = true;
            closeBroker?.();
            closeBroker = null;
        };
        res.on?.('close', cleanup);
        try {
            const ticket = streamTickets.consume(req.query?.ticket);
            if (!ticket) {
                throw new Error('Event stream ticket is invalid or expired');
            }
            extensionId = ticket.session.extension.id;
            const requestUser = getUserContext(req);
            if (requestUser.handle !== ticket.user.handle || requestUser.isAdmin !== ticket.user.isAdmin) {
                throw new Error('Event stream ticket owner mismatch');
            }

            res.setHeader('Content-Type', 'text/event-stream');
            res.setHeader('Cache-Control', 'no-cache');
            res.setHeader('Connection', 'keep-alive');
            res.write(': connected\n\n');

            const paths = getUserAuthorityPaths(ticket.user);
            closeBroker = runtime.events.register(paths.controlDbFile, ticket.user.handle, ticket.channel, res);
            if (disconnected) cleanup();
        } catch (error) {
            cleanup();
            fail(runtime, req, res, extensionId, error);
        }
    });
}

function eventChannel(value: unknown, extensionId: string): string {
    if (value === undefined || value === null) {
        return `extension:${extensionId}`;
    }
    if (typeof value !== 'string' || !value.trim() || value.length > 512) {
        throw new Error('Event channel must be a non-empty string of at most 512 characters');
    }
    return value.trim();
}

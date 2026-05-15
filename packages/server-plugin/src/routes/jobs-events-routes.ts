import type { JobListRequest } from '@stdo/shared-types';
import type { AuthorityRuntime } from '../runtime.js';
import { getUserAuthorityPaths } from '../store/authority-paths.js';
import type { AuthorityRequest, AuthorityResponse } from '../types.js';
import { getSessionToken, getUserContext } from '../utils.js';

type RouterLike = {
    get(path: string, handler: (req: AuthorityRequest, res: AuthorityResponse) => void | Promise<void>): void;
    post(path: string, handler: (req: AuthorityRequest, res: AuthorityResponse) => void | Promise<void>): void;
};

type RouteFailureHandler = (runtime: AuthorityRuntime, req: AuthorityRequest, res: AuthorityResponse, extensionId: string, error: unknown) => void;

function ok(res: AuthorityResponse, data: unknown): void {
    res.json(data);
}

export function registerJobsAndEventsRoutes(router: RouterLike, runtime: AuthorityRuntime, fail: RouteFailureHandler): void {
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

    router.get('/events/stream', async (req, res) => {
        try {
            const user = getUserContext(req);
            const session = await runtime.sessions.assertSession(getSessionToken(req), user);
            const channel = String(req.query?.channel ?? `extension:${session.extension.id}`);
            if (!await runtime.permissions.authorize(user, session, { resource: 'events.stream', target: channel })) {
                throw new Error(`Permission not granted: events.stream for ${channel}`);
            }

            res.setHeader('Content-Type', 'text/event-stream');
            res.setHeader('Cache-Control', 'no-cache');
            res.setHeader('Connection', 'keep-alive');
            res.write(': connected\n\n');

            const paths = getUserAuthorityPaths(user);
            const cleanup = runtime.events.register(paths.controlDbFile, user.handle, channel, res);
            req.on?.('close', cleanup);
            req.on?.('end', cleanup);
        } catch (error) {
            fail(runtime, req, res, 'events.stream', error);
        }
    });
}

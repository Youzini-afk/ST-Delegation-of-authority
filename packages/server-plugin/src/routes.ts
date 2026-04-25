import path from 'node:path';
import type { AuthorityInitConfig, PermissionEvaluateRequest, PermissionResolveRequest, SqlBatchRequest, SqlExecRequest, SqlQueryRequest } from '@stdo/shared-types';
import { createAuthorityRuntime, type AuthorityRuntime } from './runtime.js';
import { getUserAuthorityPaths } from './store/authority-paths.js';
import type { AuthorityRequest, AuthorityResponse } from './types.js';
import { asErrorMessage, getSessionToken, getUserContext, normalizeHostname, sanitizeFileSegment } from './utils.js';

type RouterLike = {
    get(path: string, handler: (req: AuthorityRequest, res: AuthorityResponse) => void | Promise<void>): void;
    post(path: string, handler: (req: AuthorityRequest, res: AuthorityResponse) => void | Promise<void>): void;
};

function ok(res: AuthorityResponse, data: unknown): void {
    res.json(data);
}

function fail(runtime: AuthorityRuntime, req: AuthorityRequest, res: AuthorityResponse, extensionId: string, error: unknown): void {
    const message = asErrorMessage(error);
    try {
        const user = getUserContext(req);
        runtime.audit.logError(user, extensionId, message);
    } catch {
        // ignore errors raised before auth is available
    }
    res.status(400).json({ error: message });
}

function getSqlDatabaseName(value: unknown): string {
    return typeof value === 'string' && value.trim() ? value.trim() : 'default';
}

function resolvePrivateSqlDatabasePath(user: ReturnType<typeof getUserContext>, extensionId: string, databaseName: string): string {
    const paths = getUserAuthorityPaths(user);
    return path.join(
        paths.sqlPrivateDir,
        sanitizeFileSegment(extensionId),
        `${sanitizeFileSegment(databaseName)}.sqlite`,
    );
}

function previewSqlStatement(statement: string): string {
    const normalized = statement.replace(/\s+/g, ' ').trim();
    return normalized.length > 160 ? `${normalized.slice(0, 157)}...` : normalized;
}

export function registerRoutes(router: RouterLike, runtime = createAuthorityRuntime()): AuthorityRuntime {

    router.post('/probe', async (_req, res) => {
        await runtime.core.refreshHealth();
        const install = runtime.install.getStatus();
        const core = runtime.core.getStatus();
        ok(res, {
            id: 'authority',
            online: true,
            version: install.pluginVersion,
            pluginVersion: install.pluginVersion,
            sdkBundledVersion: install.sdkBundledVersion,
            sdkDeployedVersion: install.sdkDeployedVersion,
            installStatus: install.installStatus,
            installMessage: install.installMessage,
            core,
        });
    });

    router.post('/session/init', async (req, res) => {
        try {
            const user = getUserContext(req);
            const config = req.body as AuthorityInitConfig;
            const extension = runtime.extensions.upsertExtension(user, config);
            const session = runtime.sessions.createSession(user, config, extension.firstSeenAt);
            const grants = runtime.permissions.listPersistentGrants(user, extension.id);
            const policies = runtime.permissions.getPolicyEntries(user, extension.id);
            runtime.audit.logUsage(user, extension.id, 'Session initialized');
            ok(res, runtime.sessions.buildSessionResponse(session, grants, policies));
        } catch (error) {
            fail(runtime, req, res, 'third-party/st-authority-sdk', error);
        }
    });

    router.get('/session/current', async (req, res) => {
        try {
            const user = getUserContext(req);
            const session = runtime.sessions.assertSession(getSessionToken(req), user);
            ok(res, runtime.sessions.buildSessionResponse(
                session,
                runtime.permissions.listPersistentGrants(user, session.extension.id),
                runtime.permissions.getPolicyEntries(user, session.extension.id),
            ));
        } catch (error) {
            fail(runtime, req, res, 'third-party/st-authority-sdk', error);
        }
    });

    router.post('/permissions/evaluate', async (req, res) => {
        try {
            const user = getUserContext(req);
            const session = runtime.sessions.assertSession(getSessionToken(req), user);
            ok(res, runtime.permissions.evaluate(user, session, req.body as PermissionEvaluateRequest));
        } catch (error) {
            fail(runtime, req, res, 'third-party/st-authority-sdk', error);
        }
    });

    router.post('/permissions/resolve', async (req, res) => {
        try {
            const user = getUserContext(req);
            const session = runtime.sessions.assertSession(getSessionToken(req), user);
            const payload = req.body as PermissionResolveRequest;
            const grant = runtime.permissions.resolve(user, session, payload, payload.choice);
            runtime.audit.logPermission(user, session.extension.id, 'Permission resolved', {
                key: grant.key,
                status: grant.status,
                scope: grant.scope,
                choice: payload.choice,
            });
            ok(res, grant);
        } catch (error) {
            fail(runtime, req, res, 'third-party/st-authority-sdk', error);
        }
    });

    router.get('/extensions', async (req, res) => {
        try {
            const user = getUserContext(req);
            const list = runtime.extensions.listExtensions(user).map(extension => {
                const grants = runtime.permissions.listPersistentGrants(user, extension.id);
                return {
                    ...extension,
                    grantedCount: grants.filter(grant => grant.status === 'granted').length,
                    deniedCount: grants.filter(grant => grant.status === 'denied').length,
                };
            });
            ok(res, list);
        } catch (error) {
            fail(runtime, req, res, 'third-party/st-authority-sdk', error);
        }
    });

    router.get('/extensions/:id', async (req, res) => {
        try {
            const user = getUserContext(req);
            const extensionId = decodeURIComponent(req.params?.id ?? '');
            const extension = runtime.extensions.getExtension(user, extensionId);
            if (!extension) {
                throw new Error('Extension not found');
            }

            ok(res, {
                extension,
                grants: runtime.permissions.listPersistentGrants(user, extensionId),
                policies: runtime.permissions.getPolicyEntries(user, extensionId),
                activity: runtime.audit.getRecentActivity(user, extensionId),
                jobs: runtime.jobs.list(user, extensionId),
            });
        } catch (error) {
            fail(runtime, req, res, decodeURIComponent(req.params?.id ?? 'unknown'), error);
        }
    });

    router.post('/extensions/:id/grants/reset', async (req, res) => {
        try {
            const user = getUserContext(req);
            const extensionId = decodeURIComponent(req.params?.id ?? '');
            runtime.permissions.resetPersistentGrants(user, extensionId, req.body?.keys);
            runtime.audit.logPermission(user, extensionId, 'Persistent grants reset', {
                keys: req.body?.keys ?? null,
            });
            if (typeof res.sendStatus === 'function') {
                res.sendStatus(204);
            } else {
                res.status(204).send();
            }
        } catch (error) {
            fail(runtime, req, res, decodeURIComponent(req.params?.id ?? 'unknown'), error);
        }
    });

    router.post('/storage/kv/get', async (req, res) => {
        try {
            const user = getUserContext(req);
            const session = runtime.sessions.assertSession(getSessionToken(req), user);
            if (!runtime.permissions.authorize(user, session, { resource: 'storage.kv' })) {
                throw new Error('Permission not granted: storage.kv');
            }

            ok(res, { value: runtime.storage.getKv(user, session.extension.id, String(req.body?.key ?? '')) });
        } catch (error) {
            fail(runtime, req, res, 'storage.kv', error);
        }
    });

    router.post('/storage/kv/set', async (req, res) => {
        try {
            const user = getUserContext(req);
            const session = runtime.sessions.assertSession(getSessionToken(req), user);
            if (!runtime.permissions.authorize(user, session, { resource: 'storage.kv' })) {
                throw new Error('Permission not granted: storage.kv');
            }

            runtime.storage.setKv(user, session.extension.id, String(req.body?.key ?? ''), req.body?.value);
            runtime.audit.logUsage(user, session.extension.id, 'KV set', { key: req.body?.key });
            ok(res, { ok: true });
        } catch (error) {
            fail(runtime, req, res, 'storage.kv', error);
        }
    });

    router.post('/storage/kv/delete', async (req, res) => {
        try {
            const user = getUserContext(req);
            const session = runtime.sessions.assertSession(getSessionToken(req), user);
            if (!runtime.permissions.authorize(user, session, { resource: 'storage.kv' })) {
                throw new Error('Permission not granted: storage.kv');
            }

            runtime.storage.deleteKv(user, session.extension.id, String(req.body?.key ?? ''));
            ok(res, { ok: true });
        } catch (error) {
            fail(runtime, req, res, 'storage.kv', error);
        }
    });

    router.post('/storage/kv/list', async (req, res) => {
        try {
            const user = getUserContext(req);
            const session = runtime.sessions.assertSession(getSessionToken(req), user);
            if (!runtime.permissions.authorize(user, session, { resource: 'storage.kv' })) {
                throw new Error('Permission not granted: storage.kv');
            }

            ok(res, { entries: runtime.storage.listKv(user, session.extension.id) });
        } catch (error) {
            fail(runtime, req, res, 'storage.kv', error);
        }
    });

    router.post('/storage/blob/put', async (req, res) => {
        try {
            const user = getUserContext(req);
            const session = runtime.sessions.assertSession(getSessionToken(req), user);
            if (!runtime.permissions.authorize(user, session, { resource: 'storage.blob' })) {
                throw new Error('Permission not granted: storage.blob');
            }

            const record = runtime.storage.putBlob(
                user,
                session.extension.id,
                String(req.body?.name ?? 'blob'),
                String(req.body?.content ?? ''),
                req.body?.encoding,
                req.body?.contentType,
            );
            runtime.audit.logUsage(user, session.extension.id, 'Blob stored', { id: record.id });
            ok(res, record);
        } catch (error) {
            fail(runtime, req, res, 'storage.blob', error);
        }
    });

    router.post('/storage/blob/get', async (req, res) => {
        try {
            const user = getUserContext(req);
            const session = runtime.sessions.assertSession(getSessionToken(req), user);
            if (!runtime.permissions.authorize(user, session, { resource: 'storage.blob' })) {
                throw new Error('Permission not granted: storage.blob');
            }

            ok(res, runtime.storage.getBlob(user, session.extension.id, String(req.body?.id ?? '')));
        } catch (error) {
            fail(runtime, req, res, 'storage.blob', error);
        }
    });

    router.post('/storage/blob/delete', async (req, res) => {
        try {
            const user = getUserContext(req);
            const session = runtime.sessions.assertSession(getSessionToken(req), user);
            if (!runtime.permissions.authorize(user, session, { resource: 'storage.blob' })) {
                throw new Error('Permission not granted: storage.blob');
            }

            runtime.storage.deleteBlob(user, session.extension.id, String(req.body?.id ?? ''));
            ok(res, { ok: true });
        } catch (error) {
            fail(runtime, req, res, 'storage.blob', error);
        }
    });

    router.post('/storage/blob/list', async (req, res) => {
        try {
            const user = getUserContext(req);
            const session = runtime.sessions.assertSession(getSessionToken(req), user);
            if (!runtime.permissions.authorize(user, session, { resource: 'storage.blob' })) {
                throw new Error('Permission not granted: storage.blob');
            }

            ok(res, { entries: runtime.storage.listBlobs(user, session.extension.id) });
        } catch (error) {
            fail(runtime, req, res, 'storage.blob', error);
        }
    });

    router.post('/sql/query', async (req, res) => {
        try {
            const user = getUserContext(req);
            const session = runtime.sessions.assertSession(getSessionToken(req), user);
            const payload = (req.body ?? {}) as SqlQueryRequest;
            const database = getSqlDatabaseName(payload.database);
            if (!runtime.permissions.authorize(user, session, { resource: 'sql.private', target: database })) {
                throw new Error(`Permission not granted: sql.private for ${database}`);
            }

            const dbPath = resolvePrivateSqlDatabasePath(user, session.extension.id, database);
            const result = await runtime.core.querySql(dbPath, {
                ...payload,
                database,
            });
            runtime.audit.logUsage(user, session.extension.id, 'SQL query', {
                database,
                statement: previewSqlStatement(payload.statement ?? ''),
            });
            ok(res, result);
        } catch (error) {
            fail(runtime, req, res, 'sql.private', error);
        }
    });

    router.post('/sql/exec', async (req, res) => {
        try {
            const user = getUserContext(req);
            const session = runtime.sessions.assertSession(getSessionToken(req), user);
            const payload = (req.body ?? {}) as SqlExecRequest;
            const database = getSqlDatabaseName(payload.database);
            if (!runtime.permissions.authorize(user, session, { resource: 'sql.private', target: database })) {
                throw new Error(`Permission not granted: sql.private for ${database}`);
            }

            const dbPath = resolvePrivateSqlDatabasePath(user, session.extension.id, database);
            const result = await runtime.core.execSql(dbPath, {
                ...payload,
                database,
            });
            runtime.audit.logUsage(user, session.extension.id, 'SQL exec', {
                database,
                statement: previewSqlStatement(payload.statement ?? ''),
            });
            ok(res, result);
        } catch (error) {
            fail(runtime, req, res, 'sql.private', error);
        }
    });

    router.post('/sql/batch', async (req, res) => {
        try {
            const user = getUserContext(req);
            const session = runtime.sessions.assertSession(getSessionToken(req), user);
            const payload = (req.body ?? {}) as SqlBatchRequest;
            const database = getSqlDatabaseName(payload.database);
            if (!runtime.permissions.authorize(user, session, { resource: 'sql.private', target: database })) {
                throw new Error(`Permission not granted: sql.private for ${database}`);
            }

            const dbPath = resolvePrivateSqlDatabasePath(user, session.extension.id, database);
            const result = await runtime.core.batchSql(dbPath, {
                ...payload,
                database,
            });
            runtime.audit.logUsage(user, session.extension.id, 'SQL batch', {
                database,
                statements: Array.isArray(payload.statements) ? payload.statements.length : 0,
            });
            ok(res, result);
        } catch (error) {
            fail(runtime, req, res, 'sql.private', error);
        }
    });

    router.post('/http/fetch', async (req, res) => {
        try {
            const user = getUserContext(req);
            const session = runtime.sessions.assertSession(getSessionToken(req), user);
            const hostname = normalizeHostname(String(req.body?.url ?? ''));
            if (!runtime.permissions.authorize(user, session, { resource: 'http.fetch', target: hostname })) {
                throw new Error(`Permission not granted: http.fetch for ${hostname}`);
            }

            const result = await runtime.http.fetch(user, req.body);
            runtime.audit.logUsage(user, session.extension.id, 'HTTP fetch', { hostname });
            ok(res, result);
        } catch (error) {
            fail(runtime, req, res, 'http.fetch', error);
        }
    });

    router.post('/jobs/create', async (req, res) => {
        try {
            const user = getUserContext(req);
            const session = runtime.sessions.assertSession(getSessionToken(req), user);
            const jobType = String(req.body?.type ?? '');
            if (!runtime.permissions.authorize(user, session, { resource: 'jobs.background', target: jobType })) {
                throw new Error(`Permission not granted: jobs.background for ${jobType}`);
            }

            const job = runtime.jobs.create(user, session.extension.id, jobType, req.body?.payload ?? {});
            runtime.audit.logUsage(user, session.extension.id, 'Job created', { jobId: job.id, jobType });
            ok(res, job);
        } catch (error) {
            fail(runtime, req, res, 'jobs.background', error);
        }
    });

    router.get('/jobs', async (req, res) => {
        try {
            const user = getUserContext(req);
            const session = runtime.sessions.assertSession(getSessionToken(req), user);
            ok(res, runtime.jobs.list(user, session.extension.id));
        } catch (error) {
            fail(runtime, req, res, 'jobs.background', error);
        }
    });

    router.get('/jobs/:id', async (req, res) => {
        try {
            const user = getUserContext(req);
            const session = runtime.sessions.assertSession(getSessionToken(req), user);
            const job = runtime.jobs.get(user, String(req.params?.id ?? ''));
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
            const session = runtime.sessions.assertSession(getSessionToken(req), user);
            const job = runtime.jobs.cancel(user, session.extension.id, String(req.params?.id ?? ''));
            runtime.audit.logUsage(user, session.extension.id, 'Job cancelled', { jobId: job.id });
            ok(res, job);
        } catch (error) {
            fail(runtime, req, res, 'jobs.background', error);
        }
    });

    router.get('/events/stream', async (req, res) => {
        try {
            const user = getUserContext(req);
            const session = runtime.sessions.assertSession(getSessionToken(req), user);
            const channel = String(req.query?.channel ?? `extension:${session.extension.id}`);
            if (!runtime.permissions.authorize(user, session, { resource: 'events.stream', target: channel })) {
                throw new Error(`Permission not granted: events.stream for ${channel}`);
            }

            res.setHeader('Content-Type', 'text/event-stream');
            res.setHeader('Cache-Control', 'no-cache');
            res.setHeader('Connection', 'keep-alive');
            res.write(': connected\n\n');

            const cleanup = runtime.events.register(user.handle, session.extension.id, res);
            req.on?.('close', cleanup);
            req.on?.('end', cleanup);
        } catch (error) {
            fail(runtime, req, res, 'events.stream', error);
        }
    });

    router.get('/admin/policies', async (req, res) => {
        try {
            const user = getUserContext(req);
            if (!user.isAdmin) {
                throw new Error('Forbidden');
            }
            ok(res, runtime.policies.getPolicies(user));
        } catch (error) {
            fail(runtime, req, res, 'third-party/st-authority-sdk', error);
        }
    });

    router.post('/admin/policies', async (req, res) => {
        try {
            const user = getUserContext(req);
            const result = runtime.policies.saveGlobalPolicies(user, req.body ?? {});
            runtime.audit.logUsage(user, 'third-party/st-authority-sdk', 'Policies updated');
            ok(res, result);
        } catch (error) {
            fail(runtime, req, res, 'third-party/st-authority-sdk', error);
        }
    });

    return runtime;
}

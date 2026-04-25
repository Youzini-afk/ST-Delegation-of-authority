/******/ (() => { // webpackBootstrap
/******/ 	"use strict";
/******/ 	var __webpack_modules__ = ({

/***/ "./src/constants.ts"
/*!**************************!*\
  !*** ./src/constants.ts ***!
  \**************************/
(__unused_webpack_module, __webpack_exports__, __webpack_require__) {

__webpack_require__.r(__webpack_exports__);
/* harmony export */ __webpack_require__.d(__webpack_exports__, {
/* harmony export */   AUTHORITY_DATA_FOLDER: () => (/* binding */ AUTHORITY_DATA_FOLDER),
/* harmony export */   AUTHORITY_MANAGED_CORE_DIR: () => (/* binding */ AUTHORITY_MANAGED_CORE_DIR),
/* harmony export */   AUTHORITY_MANAGED_FILE: () => (/* binding */ AUTHORITY_MANAGED_FILE),
/* harmony export */   AUTHORITY_MANAGED_SDK_DIR: () => (/* binding */ AUTHORITY_MANAGED_SDK_DIR),
/* harmony export */   AUTHORITY_PLUGIN_ID: () => (/* binding */ AUTHORITY_PLUGIN_ID),
/* harmony export */   AUTHORITY_RELEASE_FILE: () => (/* binding */ AUTHORITY_RELEASE_FILE),
/* harmony export */   AUTHORITY_SDK_EXTENSION_ID: () => (/* binding */ AUTHORITY_SDK_EXTENSION_ID),
/* harmony export */   BUILTIN_JOB_TYPES: () => (/* binding */ BUILTIN_JOB_TYPES),
/* harmony export */   DEFAULT_POLICY_STATUS: () => (/* binding */ DEFAULT_POLICY_STATUS),
/* harmony export */   MAX_AUDIT_LINES: () => (/* binding */ MAX_AUDIT_LINES),
/* harmony export */   MAX_BLOB_BYTES: () => (/* binding */ MAX_BLOB_BYTES),
/* harmony export */   MAX_HTTP_BODY_BYTES: () => (/* binding */ MAX_HTTP_BODY_BYTES),
/* harmony export */   MAX_HTTP_RESPONSE_BYTES: () => (/* binding */ MAX_HTTP_RESPONSE_BYTES),
/* harmony export */   MAX_KV_VALUE_BYTES: () => (/* binding */ MAX_KV_VALUE_BYTES),
/* harmony export */   RESOURCE_RISK: () => (/* binding */ RESOURCE_RISK),
/* harmony export */   SESSION_HEADER: () => (/* binding */ SESSION_HEADER),
/* harmony export */   SESSION_QUERY: () => (/* binding */ SESSION_QUERY),
/* harmony export */   SUPPORTED_RESOURCES: () => (/* binding */ SUPPORTED_RESOURCES)
/* harmony export */ });
const AUTHORITY_PLUGIN_ID = 'authority';
const AUTHORITY_DATA_FOLDER = 'extensions-data/authority';
const AUTHORITY_SDK_EXTENSION_ID = 'third-party/st-authority-sdk';
const AUTHORITY_MANAGED_FILE = '.authority-managed.json';
const AUTHORITY_RELEASE_FILE = '.authority-release.json';
const AUTHORITY_MANAGED_SDK_DIR = 'managed/sdk-extension';
const AUTHORITY_MANAGED_CORE_DIR = 'managed/core';
const SESSION_HEADER = 'x-authority-session-token';
const SESSION_QUERY = 'authoritySessionToken';
const MAX_KV_VALUE_BYTES = 128 * 1024;
const MAX_BLOB_BYTES = 2 * 1024 * 1024;
const MAX_HTTP_BODY_BYTES = 512 * 1024;
const MAX_HTTP_RESPONSE_BYTES = 2 * 1024 * 1024;
const MAX_AUDIT_LINES = 200;
const SUPPORTED_RESOURCES = [
    'storage.kv',
    'storage.blob',
    'sql.private',
    'http.fetch',
    'jobs.background',
    'events.stream',
];
const RESOURCE_RISK = {
    'storage.kv': 'low',
    'storage.blob': 'low',
    'sql.private': 'medium',
    'http.fetch': 'medium',
    'jobs.background': 'medium',
    'events.stream': 'low',
};
const DEFAULT_POLICY_STATUS = {
    'storage.kv': 'prompt',
    'storage.blob': 'prompt',
    'sql.private': 'prompt',
    'http.fetch': 'prompt',
    'jobs.background': 'prompt',
    'events.stream': 'prompt',
};
const BUILTIN_JOB_TYPES = ['delay'];


/***/ },

/***/ "./src/events/sse-broker.ts"
/*!**********************************!*\
  !*** ./src/events/sse-broker.ts ***!
  \**********************************/
(__unused_webpack_module, __webpack_exports__, __webpack_require__) {

__webpack_require__.r(__webpack_exports__);
/* harmony export */ __webpack_require__.d(__webpack_exports__, {
/* harmony export */   SseBroker: () => (/* binding */ SseBroker)
/* harmony export */ });
/* harmony import */ var _utils_js__WEBPACK_IMPORTED_MODULE_0__ = __webpack_require__(/*! ../utils.js */ "./src/utils.ts");

class SseBroker {
    clients = new Set();
    register(userHandle, extensionId, response) {
        const client = { userHandle, extensionId, response };
        this.clients.add(client);
        this.emitToClient(client, 'authority.connected', {
            timestamp: (0,_utils_js__WEBPACK_IMPORTED_MODULE_0__.nowIso)(),
            extensionId,
        });
        return () => {
            this.clients.delete(client);
        };
    }
    emit(userHandle, extensionId, eventName, payload) {
        for (const client of this.clients) {
            if (client.userHandle !== userHandle || client.extensionId !== extensionId) {
                continue;
            }
            this.emitToClient(client, eventName, payload);
        }
    }
    emitToClient(client, eventName, payload) {
        client.response.write(`event: ${eventName}\n`);
        client.response.write(`data: ${JSON.stringify(payload)}\n\n`);
    }
}


/***/ },

/***/ "./src/routes.ts"
/*!***********************!*\
  !*** ./src/routes.ts ***!
  \***********************/
(__unused_webpack_module, __webpack_exports__, __webpack_require__) {

__webpack_require__.r(__webpack_exports__);
/* harmony export */ __webpack_require__.d(__webpack_exports__, {
/* harmony export */   registerRoutes: () => (/* binding */ registerRoutes)
/* harmony export */ });
/* harmony import */ var node_path__WEBPACK_IMPORTED_MODULE_0__ = __webpack_require__(/*! node:path */ "node:path");
/* harmony import */ var node_path__WEBPACK_IMPORTED_MODULE_0___default = /*#__PURE__*/__webpack_require__.n(node_path__WEBPACK_IMPORTED_MODULE_0__);
/* harmony import */ var _runtime_js__WEBPACK_IMPORTED_MODULE_1__ = __webpack_require__(/*! ./runtime.js */ "./src/runtime.ts");
/* harmony import */ var _store_authority_paths_js__WEBPACK_IMPORTED_MODULE_2__ = __webpack_require__(/*! ./store/authority-paths.js */ "./src/store/authority-paths.ts");
/* harmony import */ var _utils_js__WEBPACK_IMPORTED_MODULE_3__ = __webpack_require__(/*! ./utils.js */ "./src/utils.ts");




function ok(res, data) {
    res.json(data);
}
function fail(runtime, req, res, extensionId, error) {
    const message = (0,_utils_js__WEBPACK_IMPORTED_MODULE_3__.asErrorMessage)(error);
    try {
        const user = (0,_utils_js__WEBPACK_IMPORTED_MODULE_3__.getUserContext)(req);
        runtime.audit.logError(user, extensionId, message);
    }
    catch {
        // ignore errors raised before auth is available
    }
    res.status(400).json({ error: message });
}
function getSqlDatabaseName(value) {
    return typeof value === 'string' && value.trim() ? value.trim() : 'default';
}
function resolvePrivateSqlDatabasePath(user, extensionId, databaseName) {
    const paths = (0,_store_authority_paths_js__WEBPACK_IMPORTED_MODULE_2__.getUserAuthorityPaths)(user);
    return node_path__WEBPACK_IMPORTED_MODULE_0___default().join(paths.sqlPrivateDir, (0,_utils_js__WEBPACK_IMPORTED_MODULE_3__.sanitizeFileSegment)(extensionId), `${(0,_utils_js__WEBPACK_IMPORTED_MODULE_3__.sanitizeFileSegment)(databaseName)}.sqlite`);
}
function previewSqlStatement(statement) {
    const normalized = statement.replace(/\s+/g, ' ').trim();
    return normalized.length > 160 ? `${normalized.slice(0, 157)}...` : normalized;
}
function registerRoutes(router, runtime = (0,_runtime_js__WEBPACK_IMPORTED_MODULE_1__.createAuthorityRuntime)()) {
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
            const user = (0,_utils_js__WEBPACK_IMPORTED_MODULE_3__.getUserContext)(req);
            const config = req.body;
            const extension = runtime.extensions.upsertExtension(user, config);
            const session = runtime.sessions.createSession(user, config, extension.firstSeenAt);
            const grants = runtime.permissions.listPersistentGrants(user, extension.id);
            const policies = runtime.permissions.getPolicyEntries(user, extension.id);
            runtime.audit.logUsage(user, extension.id, 'Session initialized');
            ok(res, runtime.sessions.buildSessionResponse(session, grants, policies));
        }
        catch (error) {
            fail(runtime, req, res, 'third-party/st-authority-sdk', error);
        }
    });
    router.get('/session/current', async (req, res) => {
        try {
            const user = (0,_utils_js__WEBPACK_IMPORTED_MODULE_3__.getUserContext)(req);
            const session = runtime.sessions.assertSession((0,_utils_js__WEBPACK_IMPORTED_MODULE_3__.getSessionToken)(req), user);
            ok(res, runtime.sessions.buildSessionResponse(session, runtime.permissions.listPersistentGrants(user, session.extension.id), runtime.permissions.getPolicyEntries(user, session.extension.id)));
        }
        catch (error) {
            fail(runtime, req, res, 'third-party/st-authority-sdk', error);
        }
    });
    router.post('/permissions/evaluate', async (req, res) => {
        try {
            const user = (0,_utils_js__WEBPACK_IMPORTED_MODULE_3__.getUserContext)(req);
            const session = runtime.sessions.assertSession((0,_utils_js__WEBPACK_IMPORTED_MODULE_3__.getSessionToken)(req), user);
            ok(res, runtime.permissions.evaluate(user, session, req.body));
        }
        catch (error) {
            fail(runtime, req, res, 'third-party/st-authority-sdk', error);
        }
    });
    router.post('/permissions/resolve', async (req, res) => {
        try {
            const user = (0,_utils_js__WEBPACK_IMPORTED_MODULE_3__.getUserContext)(req);
            const session = runtime.sessions.assertSession((0,_utils_js__WEBPACK_IMPORTED_MODULE_3__.getSessionToken)(req), user);
            const payload = req.body;
            const grant = runtime.permissions.resolve(user, session, payload, payload.choice);
            runtime.audit.logPermission(user, session.extension.id, 'Permission resolved', {
                key: grant.key,
                status: grant.status,
                scope: grant.scope,
                choice: payload.choice,
            });
            ok(res, grant);
        }
        catch (error) {
            fail(runtime, req, res, 'third-party/st-authority-sdk', error);
        }
    });
    router.get('/extensions', async (req, res) => {
        try {
            const user = (0,_utils_js__WEBPACK_IMPORTED_MODULE_3__.getUserContext)(req);
            const list = runtime.extensions.listExtensions(user).map(extension => {
                const grants = runtime.permissions.listPersistentGrants(user, extension.id);
                return {
                    ...extension,
                    grantedCount: grants.filter(grant => grant.status === 'granted').length,
                    deniedCount: grants.filter(grant => grant.status === 'denied').length,
                };
            });
            ok(res, list);
        }
        catch (error) {
            fail(runtime, req, res, 'third-party/st-authority-sdk', error);
        }
    });
    router.get('/extensions/:id', async (req, res) => {
        try {
            const user = (0,_utils_js__WEBPACK_IMPORTED_MODULE_3__.getUserContext)(req);
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
        }
        catch (error) {
            fail(runtime, req, res, decodeURIComponent(req.params?.id ?? 'unknown'), error);
        }
    });
    router.post('/extensions/:id/grants/reset', async (req, res) => {
        try {
            const user = (0,_utils_js__WEBPACK_IMPORTED_MODULE_3__.getUserContext)(req);
            const extensionId = decodeURIComponent(req.params?.id ?? '');
            runtime.permissions.resetPersistentGrants(user, extensionId, req.body?.keys);
            runtime.audit.logPermission(user, extensionId, 'Persistent grants reset', {
                keys: req.body?.keys ?? null,
            });
            if (typeof res.sendStatus === 'function') {
                res.sendStatus(204);
            }
            else {
                res.status(204).send();
            }
        }
        catch (error) {
            fail(runtime, req, res, decodeURIComponent(req.params?.id ?? 'unknown'), error);
        }
    });
    router.post('/storage/kv/get', async (req, res) => {
        try {
            const user = (0,_utils_js__WEBPACK_IMPORTED_MODULE_3__.getUserContext)(req);
            const session = runtime.sessions.assertSession((0,_utils_js__WEBPACK_IMPORTED_MODULE_3__.getSessionToken)(req), user);
            if (!runtime.permissions.authorize(user, session, { resource: 'storage.kv' })) {
                throw new Error('Permission not granted: storage.kv');
            }
            ok(res, { value: runtime.storage.getKv(user, session.extension.id, String(req.body?.key ?? '')) });
        }
        catch (error) {
            fail(runtime, req, res, 'storage.kv', error);
        }
    });
    router.post('/storage/kv/set', async (req, res) => {
        try {
            const user = (0,_utils_js__WEBPACK_IMPORTED_MODULE_3__.getUserContext)(req);
            const session = runtime.sessions.assertSession((0,_utils_js__WEBPACK_IMPORTED_MODULE_3__.getSessionToken)(req), user);
            if (!runtime.permissions.authorize(user, session, { resource: 'storage.kv' })) {
                throw new Error('Permission not granted: storage.kv');
            }
            runtime.storage.setKv(user, session.extension.id, String(req.body?.key ?? ''), req.body?.value);
            runtime.audit.logUsage(user, session.extension.id, 'KV set', { key: req.body?.key });
            ok(res, { ok: true });
        }
        catch (error) {
            fail(runtime, req, res, 'storage.kv', error);
        }
    });
    router.post('/storage/kv/delete', async (req, res) => {
        try {
            const user = (0,_utils_js__WEBPACK_IMPORTED_MODULE_3__.getUserContext)(req);
            const session = runtime.sessions.assertSession((0,_utils_js__WEBPACK_IMPORTED_MODULE_3__.getSessionToken)(req), user);
            if (!runtime.permissions.authorize(user, session, { resource: 'storage.kv' })) {
                throw new Error('Permission not granted: storage.kv');
            }
            runtime.storage.deleteKv(user, session.extension.id, String(req.body?.key ?? ''));
            ok(res, { ok: true });
        }
        catch (error) {
            fail(runtime, req, res, 'storage.kv', error);
        }
    });
    router.post('/storage/kv/list', async (req, res) => {
        try {
            const user = (0,_utils_js__WEBPACK_IMPORTED_MODULE_3__.getUserContext)(req);
            const session = runtime.sessions.assertSession((0,_utils_js__WEBPACK_IMPORTED_MODULE_3__.getSessionToken)(req), user);
            if (!runtime.permissions.authorize(user, session, { resource: 'storage.kv' })) {
                throw new Error('Permission not granted: storage.kv');
            }
            ok(res, { entries: runtime.storage.listKv(user, session.extension.id) });
        }
        catch (error) {
            fail(runtime, req, res, 'storage.kv', error);
        }
    });
    router.post('/storage/blob/put', async (req, res) => {
        try {
            const user = (0,_utils_js__WEBPACK_IMPORTED_MODULE_3__.getUserContext)(req);
            const session = runtime.sessions.assertSession((0,_utils_js__WEBPACK_IMPORTED_MODULE_3__.getSessionToken)(req), user);
            if (!runtime.permissions.authorize(user, session, { resource: 'storage.blob' })) {
                throw new Error('Permission not granted: storage.blob');
            }
            const record = runtime.storage.putBlob(user, session.extension.id, String(req.body?.name ?? 'blob'), String(req.body?.content ?? ''), req.body?.encoding, req.body?.contentType);
            runtime.audit.logUsage(user, session.extension.id, 'Blob stored', { id: record.id });
            ok(res, record);
        }
        catch (error) {
            fail(runtime, req, res, 'storage.blob', error);
        }
    });
    router.post('/storage/blob/get', async (req, res) => {
        try {
            const user = (0,_utils_js__WEBPACK_IMPORTED_MODULE_3__.getUserContext)(req);
            const session = runtime.sessions.assertSession((0,_utils_js__WEBPACK_IMPORTED_MODULE_3__.getSessionToken)(req), user);
            if (!runtime.permissions.authorize(user, session, { resource: 'storage.blob' })) {
                throw new Error('Permission not granted: storage.blob');
            }
            ok(res, runtime.storage.getBlob(user, session.extension.id, String(req.body?.id ?? '')));
        }
        catch (error) {
            fail(runtime, req, res, 'storage.blob', error);
        }
    });
    router.post('/storage/blob/delete', async (req, res) => {
        try {
            const user = (0,_utils_js__WEBPACK_IMPORTED_MODULE_3__.getUserContext)(req);
            const session = runtime.sessions.assertSession((0,_utils_js__WEBPACK_IMPORTED_MODULE_3__.getSessionToken)(req), user);
            if (!runtime.permissions.authorize(user, session, { resource: 'storage.blob' })) {
                throw new Error('Permission not granted: storage.blob');
            }
            runtime.storage.deleteBlob(user, session.extension.id, String(req.body?.id ?? ''));
            ok(res, { ok: true });
        }
        catch (error) {
            fail(runtime, req, res, 'storage.blob', error);
        }
    });
    router.post('/storage/blob/list', async (req, res) => {
        try {
            const user = (0,_utils_js__WEBPACK_IMPORTED_MODULE_3__.getUserContext)(req);
            const session = runtime.sessions.assertSession((0,_utils_js__WEBPACK_IMPORTED_MODULE_3__.getSessionToken)(req), user);
            if (!runtime.permissions.authorize(user, session, { resource: 'storage.blob' })) {
                throw new Error('Permission not granted: storage.blob');
            }
            ok(res, { entries: runtime.storage.listBlobs(user, session.extension.id) });
        }
        catch (error) {
            fail(runtime, req, res, 'storage.blob', error);
        }
    });
    router.post('/sql/query', async (req, res) => {
        try {
            const user = (0,_utils_js__WEBPACK_IMPORTED_MODULE_3__.getUserContext)(req);
            const session = runtime.sessions.assertSession((0,_utils_js__WEBPACK_IMPORTED_MODULE_3__.getSessionToken)(req), user);
            const payload = (req.body ?? {});
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
        }
        catch (error) {
            fail(runtime, req, res, 'sql.private', error);
        }
    });
    router.post('/sql/exec', async (req, res) => {
        try {
            const user = (0,_utils_js__WEBPACK_IMPORTED_MODULE_3__.getUserContext)(req);
            const session = runtime.sessions.assertSession((0,_utils_js__WEBPACK_IMPORTED_MODULE_3__.getSessionToken)(req), user);
            const payload = (req.body ?? {});
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
        }
        catch (error) {
            fail(runtime, req, res, 'sql.private', error);
        }
    });
    router.post('/sql/batch', async (req, res) => {
        try {
            const user = (0,_utils_js__WEBPACK_IMPORTED_MODULE_3__.getUserContext)(req);
            const session = runtime.sessions.assertSession((0,_utils_js__WEBPACK_IMPORTED_MODULE_3__.getSessionToken)(req), user);
            const payload = (req.body ?? {});
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
        }
        catch (error) {
            fail(runtime, req, res, 'sql.private', error);
        }
    });
    router.post('/http/fetch', async (req, res) => {
        try {
            const user = (0,_utils_js__WEBPACK_IMPORTED_MODULE_3__.getUserContext)(req);
            const session = runtime.sessions.assertSession((0,_utils_js__WEBPACK_IMPORTED_MODULE_3__.getSessionToken)(req), user);
            const hostname = (0,_utils_js__WEBPACK_IMPORTED_MODULE_3__.normalizeHostname)(String(req.body?.url ?? ''));
            if (!runtime.permissions.authorize(user, session, { resource: 'http.fetch', target: hostname })) {
                throw new Error(`Permission not granted: http.fetch for ${hostname}`);
            }
            const result = await runtime.http.fetch(user, req.body);
            runtime.audit.logUsage(user, session.extension.id, 'HTTP fetch', { hostname });
            ok(res, result);
        }
        catch (error) {
            fail(runtime, req, res, 'http.fetch', error);
        }
    });
    router.post('/jobs/create', async (req, res) => {
        try {
            const user = (0,_utils_js__WEBPACK_IMPORTED_MODULE_3__.getUserContext)(req);
            const session = runtime.sessions.assertSession((0,_utils_js__WEBPACK_IMPORTED_MODULE_3__.getSessionToken)(req), user);
            const jobType = String(req.body?.type ?? '');
            if (!runtime.permissions.authorize(user, session, { resource: 'jobs.background', target: jobType })) {
                throw new Error(`Permission not granted: jobs.background for ${jobType}`);
            }
            const job = runtime.jobs.create(user, session.extension.id, jobType, req.body?.payload ?? {});
            runtime.audit.logUsage(user, session.extension.id, 'Job created', { jobId: job.id, jobType });
            ok(res, job);
        }
        catch (error) {
            fail(runtime, req, res, 'jobs.background', error);
        }
    });
    router.get('/jobs', async (req, res) => {
        try {
            const user = (0,_utils_js__WEBPACK_IMPORTED_MODULE_3__.getUserContext)(req);
            const session = runtime.sessions.assertSession((0,_utils_js__WEBPACK_IMPORTED_MODULE_3__.getSessionToken)(req), user);
            ok(res, runtime.jobs.list(user, session.extension.id));
        }
        catch (error) {
            fail(runtime, req, res, 'jobs.background', error);
        }
    });
    router.get('/jobs/:id', async (req, res) => {
        try {
            const user = (0,_utils_js__WEBPACK_IMPORTED_MODULE_3__.getUserContext)(req);
            const session = runtime.sessions.assertSession((0,_utils_js__WEBPACK_IMPORTED_MODULE_3__.getSessionToken)(req), user);
            const job = runtime.jobs.get(user, String(req.params?.id ?? ''));
            if (!job || job.extensionId !== session.extension.id) {
                throw new Error('Job not found');
            }
            ok(res, job);
        }
        catch (error) {
            fail(runtime, req, res, 'jobs.background', error);
        }
    });
    router.post('/jobs/:id/cancel', async (req, res) => {
        try {
            const user = (0,_utils_js__WEBPACK_IMPORTED_MODULE_3__.getUserContext)(req);
            const session = runtime.sessions.assertSession((0,_utils_js__WEBPACK_IMPORTED_MODULE_3__.getSessionToken)(req), user);
            const job = runtime.jobs.cancel(user, session.extension.id, String(req.params?.id ?? ''));
            runtime.audit.logUsage(user, session.extension.id, 'Job cancelled', { jobId: job.id });
            ok(res, job);
        }
        catch (error) {
            fail(runtime, req, res, 'jobs.background', error);
        }
    });
    router.get('/events/stream', async (req, res) => {
        try {
            const user = (0,_utils_js__WEBPACK_IMPORTED_MODULE_3__.getUserContext)(req);
            const session = runtime.sessions.assertSession((0,_utils_js__WEBPACK_IMPORTED_MODULE_3__.getSessionToken)(req), user);
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
        }
        catch (error) {
            fail(runtime, req, res, 'events.stream', error);
        }
    });
    router.get('/admin/policies', async (req, res) => {
        try {
            const user = (0,_utils_js__WEBPACK_IMPORTED_MODULE_3__.getUserContext)(req);
            if (!user.isAdmin) {
                throw new Error('Forbidden');
            }
            ok(res, runtime.policies.getPolicies(user));
        }
        catch (error) {
            fail(runtime, req, res, 'third-party/st-authority-sdk', error);
        }
    });
    router.post('/admin/policies', async (req, res) => {
        try {
            const user = (0,_utils_js__WEBPACK_IMPORTED_MODULE_3__.getUserContext)(req);
            const result = runtime.policies.saveGlobalPolicies(user, req.body ?? {});
            runtime.audit.logUsage(user, 'third-party/st-authority-sdk', 'Policies updated');
            ok(res, result);
        }
        catch (error) {
            fail(runtime, req, res, 'third-party/st-authority-sdk', error);
        }
    });
    return runtime;
}


/***/ },

/***/ "./src/runtime.ts"
/*!************************!*\
  !*** ./src/runtime.ts ***!
  \************************/
(__unused_webpack_module, __webpack_exports__, __webpack_require__) {

__webpack_require__.r(__webpack_exports__);
/* harmony export */ __webpack_require__.d(__webpack_exports__, {
/* harmony export */   createAuthorityRuntime: () => (/* binding */ createAuthorityRuntime)
/* harmony export */ });
/* harmony import */ var _events_sse_broker_js__WEBPACK_IMPORTED_MODULE_0__ = __webpack_require__(/*! ./events/sse-broker.js */ "./src/events/sse-broker.ts");
/* harmony import */ var _services_audit_service_js__WEBPACK_IMPORTED_MODULE_1__ = __webpack_require__(/*! ./services/audit-service.js */ "./src/services/audit-service.ts");
/* harmony import */ var _services_core_service_js__WEBPACK_IMPORTED_MODULE_2__ = __webpack_require__(/*! ./services/core-service.js */ "./src/services/core-service.ts");
/* harmony import */ var _services_extension_service_js__WEBPACK_IMPORTED_MODULE_3__ = __webpack_require__(/*! ./services/extension-service.js */ "./src/services/extension-service.ts");
/* harmony import */ var _services_http_service_js__WEBPACK_IMPORTED_MODULE_4__ = __webpack_require__(/*! ./services/http-service.js */ "./src/services/http-service.ts");
/* harmony import */ var _services_install_service_js__WEBPACK_IMPORTED_MODULE_5__ = __webpack_require__(/*! ./services/install-service.js */ "./src/services/install-service.ts");
/* harmony import */ var _services_job_service_js__WEBPACK_IMPORTED_MODULE_6__ = __webpack_require__(/*! ./services/job-service.js */ "./src/services/job-service.ts");
/* harmony import */ var _services_permission_service_js__WEBPACK_IMPORTED_MODULE_7__ = __webpack_require__(/*! ./services/permission-service.js */ "./src/services/permission-service.ts");
/* harmony import */ var _services_policy_service_js__WEBPACK_IMPORTED_MODULE_8__ = __webpack_require__(/*! ./services/policy-service.js */ "./src/services/policy-service.ts");
/* harmony import */ var _services_session_service_js__WEBPACK_IMPORTED_MODULE_9__ = __webpack_require__(/*! ./services/session-service.js */ "./src/services/session-service.ts");
/* harmony import */ var _services_storage_service_js__WEBPACK_IMPORTED_MODULE_10__ = __webpack_require__(/*! ./services/storage-service.js */ "./src/services/storage-service.ts");











function createAuthorityRuntime() {
    const events = new _events_sse_broker_js__WEBPACK_IMPORTED_MODULE_0__.SseBroker();
    const audit = new _services_audit_service_js__WEBPACK_IMPORTED_MODULE_1__.AuditService();
    const core = new _services_core_service_js__WEBPACK_IMPORTED_MODULE_2__.CoreService();
    const extensions = new _services_extension_service_js__WEBPACK_IMPORTED_MODULE_3__.ExtensionService();
    const install = new _services_install_service_js__WEBPACK_IMPORTED_MODULE_5__.InstallService();
    const policies = new _services_policy_service_js__WEBPACK_IMPORTED_MODULE_8__.PolicyService();
    const permissions = new _services_permission_service_js__WEBPACK_IMPORTED_MODULE_7__.PermissionService(policies);
    const sessions = new _services_session_service_js__WEBPACK_IMPORTED_MODULE_9__.SessionService();
    const storage = new _services_storage_service_js__WEBPACK_IMPORTED_MODULE_10__.StorageService();
    const http = new _services_http_service_js__WEBPACK_IMPORTED_MODULE_4__.HttpService();
    const jobs = new _services_job_service_js__WEBPACK_IMPORTED_MODULE_6__.JobService(events);
    return {
        events,
        audit,
        core,
        extensions,
        install,
        policies,
        permissions,
        sessions,
        storage,
        http,
        jobs,
    };
}


/***/ },

/***/ "./src/services/audit-service.ts"
/*!***************************************!*\
  !*** ./src/services/audit-service.ts ***!
  \***************************************/
(__unused_webpack_module, __webpack_exports__, __webpack_require__) {

__webpack_require__.r(__webpack_exports__);
/* harmony export */ __webpack_require__.d(__webpack_exports__, {
/* harmony export */   AuditService: () => (/* binding */ AuditService)
/* harmony export */ });
/* harmony import */ var _constants_js__WEBPACK_IMPORTED_MODULE_0__ = __webpack_require__(/*! ../constants.js */ "./src/constants.ts");
/* harmony import */ var _store_authority_paths_js__WEBPACK_IMPORTED_MODULE_1__ = __webpack_require__(/*! ../store/authority-paths.js */ "./src/store/authority-paths.ts");
/* harmony import */ var _utils_js__WEBPACK_IMPORTED_MODULE_2__ = __webpack_require__(/*! ../utils.js */ "./src/utils.ts");



class AuditService {
    logPermission(user, extensionId, message, details) {
        const paths = (0,_store_authority_paths_js__WEBPACK_IMPORTED_MODULE_1__.getUserAuthorityPaths)(user);
        const record = {
            timestamp: (0,_utils_js__WEBPACK_IMPORTED_MODULE_2__.nowIso)(),
            kind: 'permission',
            extensionId,
            message,
        };
        if (details) {
            record.details = details;
        }
        (0,_utils_js__WEBPACK_IMPORTED_MODULE_2__.appendJsonl)(paths.permissionsAuditFile, record);
    }
    logUsage(user, extensionId, message, details) {
        const paths = (0,_store_authority_paths_js__WEBPACK_IMPORTED_MODULE_1__.getUserAuthorityPaths)(user);
        const record = {
            timestamp: (0,_utils_js__WEBPACK_IMPORTED_MODULE_2__.nowIso)(),
            kind: 'usage',
            extensionId,
            message,
        };
        if (details) {
            record.details = details;
        }
        (0,_utils_js__WEBPACK_IMPORTED_MODULE_2__.appendJsonl)(paths.usageAuditFile, record);
    }
    logError(user, extensionId, message, details) {
        const paths = (0,_store_authority_paths_js__WEBPACK_IMPORTED_MODULE_1__.getUserAuthorityPaths)(user);
        const record = {
            timestamp: (0,_utils_js__WEBPACK_IMPORTED_MODULE_2__.nowIso)(),
            kind: 'error',
            extensionId,
            message,
        };
        if (details) {
            record.details = details;
        }
        (0,_utils_js__WEBPACK_IMPORTED_MODULE_2__.appendJsonl)(paths.errorsAuditFile, record);
    }
    getRecentActivity(user, extensionId) {
        const paths = (0,_store_authority_paths_js__WEBPACK_IMPORTED_MODULE_1__.getUserAuthorityPaths)(user);
        return {
            permissions: (0,_utils_js__WEBPACK_IMPORTED_MODULE_2__.tailJsonl)(paths.permissionsAuditFile, _constants_js__WEBPACK_IMPORTED_MODULE_0__.MAX_AUDIT_LINES).filter(item => item.extensionId === extensionId),
            usage: (0,_utils_js__WEBPACK_IMPORTED_MODULE_2__.tailJsonl)(paths.usageAuditFile, _constants_js__WEBPACK_IMPORTED_MODULE_0__.MAX_AUDIT_LINES).filter(item => item.extensionId === extensionId),
            errors: (0,_utils_js__WEBPACK_IMPORTED_MODULE_2__.tailJsonl)(paths.errorsAuditFile, _constants_js__WEBPACK_IMPORTED_MODULE_0__.MAX_AUDIT_LINES).filter(item => item.extensionId === extensionId),
        };
    }
}


/***/ },

/***/ "./src/services/core-service.ts"
/*!**************************************!*\
  !*** ./src/services/core-service.ts ***!
  \**************************************/
(__unused_webpack_module, __webpack_exports__, __webpack_require__) {

__webpack_require__.r(__webpack_exports__);
/* harmony export */ __webpack_require__.d(__webpack_exports__, {
/* harmony export */   CoreService: () => (/* binding */ CoreService)
/* harmony export */ });
/* harmony import */ var node_fs__WEBPACK_IMPORTED_MODULE_0__ = __webpack_require__(/*! node:fs */ "node:fs");
/* harmony import */ var node_fs__WEBPACK_IMPORTED_MODULE_0___default = /*#__PURE__*/__webpack_require__.n(node_fs__WEBPACK_IMPORTED_MODULE_0__);
/* harmony import */ var node_net__WEBPACK_IMPORTED_MODULE_1__ = __webpack_require__(/*! node:net */ "node:net");
/* harmony import */ var node_net__WEBPACK_IMPORTED_MODULE_1___default = /*#__PURE__*/__webpack_require__.n(node_net__WEBPACK_IMPORTED_MODULE_1__);
/* harmony import */ var node_path__WEBPACK_IMPORTED_MODULE_2__ = __webpack_require__(/*! node:path */ "node:path");
/* harmony import */ var node_path__WEBPACK_IMPORTED_MODULE_2___default = /*#__PURE__*/__webpack_require__.n(node_path__WEBPACK_IMPORTED_MODULE_2__);
/* harmony import */ var node_process__WEBPACK_IMPORTED_MODULE_3__ = __webpack_require__(/*! node:process */ "node:process");
/* harmony import */ var node_process__WEBPACK_IMPORTED_MODULE_3___default = /*#__PURE__*/__webpack_require__.n(node_process__WEBPACK_IMPORTED_MODULE_3__);
/* harmony import */ var node_child_process__WEBPACK_IMPORTED_MODULE_4__ = __webpack_require__(/*! node:child_process */ "node:child_process");
/* harmony import */ var node_child_process__WEBPACK_IMPORTED_MODULE_4___default = /*#__PURE__*/__webpack_require__.n(node_child_process__WEBPACK_IMPORTED_MODULE_4__);
/* harmony import */ var _constants_js__WEBPACK_IMPORTED_MODULE_5__ = __webpack_require__(/*! ../constants.js */ "./src/constants.ts");
/* harmony import */ var _utils_js__WEBPACK_IMPORTED_MODULE_6__ = __webpack_require__(/*! ../utils.js */ "./src/utils.ts");







const HEALTH_TIMEOUT_MS = 5000;
const HEALTH_POLL_INTERVAL_MS = 150;
const CORE_API_VERSION = 'authority-core/v1';
class CoreService {
    runtimeDir;
    cwd;
    env;
    logger;
    child = null;
    token = null;
    stopping = false;
    status;
    constructor(options = {}) {
        this.runtimeDir = node_path__WEBPACK_IMPORTED_MODULE_2___default().resolve(options.runtimeDir ?? __dirname);
        this.cwd = node_path__WEBPACK_IMPORTED_MODULE_2___default().resolve(options.cwd ?? node_process__WEBPACK_IMPORTED_MODULE_3___default().cwd());
        this.env = options.env ?? (node_process__WEBPACK_IMPORTED_MODULE_3___default().env);
        this.logger = options.logger ?? console;
        this.status = {
            enabled: true,
            state: 'stopped',
            platform: (node_process__WEBPACK_IMPORTED_MODULE_3___default().platform),
            arch: (node_process__WEBPACK_IMPORTED_MODULE_3___default().arch),
            binaryPath: null,
            port: null,
            pid: null,
            version: null,
            startedAt: null,
            lastError: null,
            health: null,
        };
    }
    getStatus() {
        return {
            ...this.status,
            health: this.status.health ? { ...this.status.health } : null,
        };
    }
    async start() {
        if (this.status.state === 'running') {
            await this.refreshHealth();
            return this.getStatus();
        }
        if (this.status.state === 'starting') {
            return this.waitUntilReady();
        }
        if (this.child) {
            await this.stop();
        }
        const artifact = this.resolveArtifact();
        if (!artifact) {
            this.setStatus('missing', {
                binaryPath: null,
                version: null,
                lastError: `Authority core binary not found under ${_constants_js__WEBPACK_IMPORTED_MODULE_5__.AUTHORITY_MANAGED_CORE_DIR}`,
                port: null,
                pid: null,
                startedAt: null,
                health: null,
            });
            return this.getStatus();
        }
        const port = await getAvailablePort();
        const token = (0,_utils_js__WEBPACK_IMPORTED_MODULE_6__.randomToken)();
        const child = (0,node_child_process__WEBPACK_IMPORTED_MODULE_4__.spawn)(artifact.binaryPath, [], {
            cwd: node_path__WEBPACK_IMPORTED_MODULE_2___default().dirname(artifact.binaryPath),
            env: {
                ...this.env,
                AUTHORITY_CORE_HOST: '127.0.0.1',
                AUTHORITY_CORE_PORT: String(port),
                AUTHORITY_CORE_TOKEN: token,
                AUTHORITY_CORE_VERSION: artifact.metadata.version,
                AUTHORITY_CORE_API_VERSION: CORE_API_VERSION,
            },
            stdio: ['ignore', 'pipe', 'pipe'],
            windowsHide: true,
        });
        this.child = child;
        this.token = token;
        this.stopping = false;
        this.attachProcessListeners(child);
        this.setStatus('starting', {
            binaryPath: artifact.binaryPath,
            version: artifact.metadata.version,
            port,
            pid: child.pid ?? null,
            startedAt: null,
            lastError: null,
            health: null,
        });
        try {
            const health = await this.waitForHealth(port, token);
            this.setStatus('running', {
                binaryPath: artifact.binaryPath,
                version: artifact.metadata.version,
                port,
                pid: child.pid ?? null,
                startedAt: health.startedAt,
                lastError: null,
                health,
            });
            return this.getStatus();
        }
        catch (error) {
            const message = (0,_utils_js__WEBPACK_IMPORTED_MODULE_6__.asErrorMessage)(error);
            this.logger.error(`[authority] Failed to start authority-core: ${message}`);
            await this.stop();
            this.setStatus('error', {
                binaryPath: artifact.binaryPath,
                version: artifact.metadata.version,
                port,
                pid: null,
                startedAt: null,
                lastError: message,
                health: null,
            });
            return this.getStatus();
        }
    }
    async stop() {
        const child = this.child;
        if (!child) {
            if (this.status.state !== 'missing') {
                this.setStatus('stopped', {
                    pid: null,
                    port: null,
                    startedAt: null,
                    health: null,
                    lastError: this.status.lastError,
                });
            }
            return;
        }
        this.stopping = true;
        const closePromise = onceChildExit(child);
        child.kill();
        await Promise.race([
            closePromise,
            delay(1000),
        ]);
        if (child.exitCode === null && !child.killed) {
            child.kill('SIGKILL');
            await Promise.race([
                closePromise,
                delay(1000),
            ]);
        }
        this.child = null;
        this.token = null;
        this.setStatus('stopped', {
            pid: null,
            port: null,
            startedAt: null,
            health: null,
        });
    }
    async refreshHealth() {
        if (!this.token || !this.status.port) {
            return null;
        }
        try {
            const health = await fetchHealth(this.status.port, this.token);
            this.status = {
                ...this.status,
                state: 'running',
                startedAt: health.startedAt,
                health,
                lastError: null,
            };
            return health;
        }
        catch (error) {
            const message = (0,_utils_js__WEBPACK_IMPORTED_MODULE_6__.asErrorMessage)(error);
            this.status = {
                ...this.status,
                state: 'error',
                health: null,
                lastError: message,
            };
            return null;
        }
    }
    async querySql(dbPath, request) {
        return await this.request('/v1/sql/query', {
            dbPath,
            statement: request.statement,
            params: request.params ?? [],
        });
    }
    async execSql(dbPath, request) {
        return await this.request('/v1/sql/exec', {
            dbPath,
            statement: request.statement,
            params: request.params ?? [],
        });
    }
    async batchSql(dbPath, request) {
        return await this.request('/v1/sql/batch', {
            dbPath,
            statements: request.statements,
        });
    }
    attachProcessListeners(child) {
        child.stdout?.on('data', chunk => {
            const text = String(chunk).trim();
            if (text) {
                this.logger.info(`[authority-core] ${text}`);
            }
        });
        child.stderr?.on('data', chunk => {
            const text = String(chunk).trim();
            if (text) {
                this.logger.warn(`[authority-core] ${text}`);
            }
        });
        child.on('exit', (code, signal) => {
            const currentPid = this.child?.pid;
            if (currentPid !== child.pid) {
                return;
            }
            this.child = null;
            this.token = null;
            const state = this.stopping ? 'stopped' : 'error';
            const lastError = this.stopping ? this.status.lastError : `authority-core exited with code ${code ?? 'null'} and signal ${signal ?? 'null'}`;
            this.setStatus(state, {
                pid: null,
                port: null,
                startedAt: null,
                health: null,
                lastError,
            });
            this.stopping = false;
        });
    }
    async waitUntilReady() {
        const startedAt = Date.now();
        while (Date.now() - startedAt < HEALTH_TIMEOUT_MS) {
            if (this.status.state !== 'starting') {
                return this.getStatus();
            }
            await delay(HEALTH_POLL_INTERVAL_MS);
        }
        return this.getStatus();
    }
    async waitForHealth(port, token) {
        const startedAt = Date.now();
        while (Date.now() - startedAt < HEALTH_TIMEOUT_MS) {
            const child = this.child;
            if (!child) {
                throw new Error('authority-core process disappeared before becoming healthy');
            }
            if (child.exitCode !== null) {
                throw new Error(`authority-core exited before becoming healthy with code ${child.exitCode}`);
            }
            try {
                return await fetchHealth(port, token);
            }
            catch {
                await delay(HEALTH_POLL_INTERVAL_MS);
            }
        }
        throw new Error(`authority-core did not become healthy within ${HEALTH_TIMEOUT_MS}ms`);
    }
    resolveArtifact() {
        for (const root of this.resolveManagedCoreRoots()) {
            const artifact = readArtifact(root);
            if (artifact) {
                return artifact;
            }
        }
        return null;
    }
    resolveManagedCoreRoots() {
        const explicitRoot = this.env.AUTHORITY_CORE_ROOT?.trim();
        const candidates = new Set();
        if (explicitRoot) {
            candidates.add(node_path__WEBPACK_IMPORTED_MODULE_2___default().resolve(explicitRoot));
        }
        for (const origin of [this.runtimeDir, this.cwd]) {
            let current = node_path__WEBPACK_IMPORTED_MODULE_2___default().resolve(origin);
            while (true) {
                candidates.add(node_path__WEBPACK_IMPORTED_MODULE_2___default().join(current, _constants_js__WEBPACK_IMPORTED_MODULE_5__.AUTHORITY_MANAGED_CORE_DIR));
                const parent = node_path__WEBPACK_IMPORTED_MODULE_2___default().dirname(current);
                if (parent === current) {
                    break;
                }
                current = parent;
            }
        }
        return [...candidates];
    }
    setStatus(state, patch) {
        this.status = {
            ...this.status,
            ...patch,
            state,
        };
    }
    async request(requestPath, body) {
        let status = this.getStatus();
        if (status.state !== 'running' || !this.token || !status.port) {
            status = await this.start();
        }
        if (status.state !== 'running' || !this.token || !status.port) {
            throw new Error(status.lastError ?? 'Authority core is not available');
        }
        const response = await fetch(`http://127.0.0.1:${status.port}${requestPath}`, {
            method: 'POST',
            headers: {
                'content-type': 'application/json',
                'x-authority-core-token': this.token,
            },
            body: JSON.stringify(body),
        });
        const payload = await readCorePayload(response);
        if (!response.ok) {
            throw new Error(extractCoreErrorMessage(payload, response.status));
        }
        return payload;
    }
}
function readArtifact(root) {
    const platformDir = node_path__WEBPACK_IMPORTED_MODULE_2___default().join(root, `${(node_process__WEBPACK_IMPORTED_MODULE_3___default().platform)}-${(node_process__WEBPACK_IMPORTED_MODULE_3___default().arch)}`);
    const metadataPath = node_path__WEBPACK_IMPORTED_MODULE_2___default().join(platformDir, 'authority-core.json');
    if (!node_fs__WEBPACK_IMPORTED_MODULE_0___default().existsSync(metadataPath)) {
        return null;
    }
    const metadata = JSON.parse(node_fs__WEBPACK_IMPORTED_MODULE_0___default().readFileSync(metadataPath, 'utf8'));
    const binaryPath = node_path__WEBPACK_IMPORTED_MODULE_2___default().join(platformDir, metadata.binaryName);
    if (!node_fs__WEBPACK_IMPORTED_MODULE_0___default().existsSync(binaryPath)) {
        return null;
    }
    return {
        binaryPath,
        metadata,
    };
}
async function fetchHealth(port, token) {
    const response = await fetch(`http://127.0.0.1:${port}/health`, {
        headers: {
            'x-authority-core-token': token,
        },
    });
    if (!response.ok) {
        throw new Error(`authority-core health check failed with ${response.status}`);
    }
    return await response.json();
}
async function getAvailablePort() {
    return await new Promise((resolve, reject) => {
        const server = node_net__WEBPACK_IMPORTED_MODULE_1___default().createServer();
        server.unref();
        server.on('error', reject);
        server.listen(0, '127.0.0.1', () => {
            const address = server.address();
            if (!address || typeof address === 'string') {
                server.close(() => reject(new Error('Unable to resolve an ephemeral authority-core port')));
                return;
            }
            const { port } = address;
            server.close(error => {
                if (error) {
                    reject(error);
                    return;
                }
                resolve(port);
            });
        });
    });
}
function onceChildExit(child) {
    return new Promise(resolve => {
        child.once('exit', () => resolve());
    });
}
async function readCorePayload(response) {
    const contentType = response.headers.get('content-type') ?? '';
    if (contentType.includes('application/json')) {
        return await response.json();
    }
    const text = await response.text();
    return text || undefined;
}
function extractCoreErrorMessage(payload, statusCode) {
    if (payload && typeof payload === 'object' && 'error' in payload) {
        return String(payload.error);
    }
    if (typeof payload === 'string' && payload.trim()) {
        return payload.trim();
    }
    return `authority-core request failed with ${statusCode}`;
}
function delay(durationMs) {
    return new Promise(resolve => setTimeout(resolve, durationMs));
}


/***/ },

/***/ "./src/services/extension-service.ts"
/*!*******************************************!*\
  !*** ./src/services/extension-service.ts ***!
  \*******************************************/
(__unused_webpack_module, __webpack_exports__, __webpack_require__) {

__webpack_require__.r(__webpack_exports__);
/* harmony export */ __webpack_require__.d(__webpack_exports__, {
/* harmony export */   ExtensionService: () => (/* binding */ ExtensionService)
/* harmony export */ });
/* harmony import */ var _store_authority_paths_js__WEBPACK_IMPORTED_MODULE_0__ = __webpack_require__(/*! ../store/authority-paths.js */ "./src/store/authority-paths.ts");
/* harmony import */ var _utils_js__WEBPACK_IMPORTED_MODULE_1__ = __webpack_require__(/*! ../utils.js */ "./src/utils.ts");


class ExtensionService {
    upsertExtension(user, config) {
        const paths = (0,_store_authority_paths_js__WEBPACK_IMPORTED_MODULE_0__.getUserAuthorityPaths)(user);
        const file = (0,_utils_js__WEBPACK_IMPORTED_MODULE_1__.readJsonFile)(paths.extensionsFile, { entries: {} });
        const current = file.entries[config.extensionId];
        const timestamp = (0,_utils_js__WEBPACK_IMPORTED_MODULE_1__.nowIso)();
        const next = {
            id: config.extensionId,
            installType: config.installType,
            displayName: config.displayName,
            version: config.version,
            firstSeenAt: current?.firstSeenAt ?? timestamp,
            lastSeenAt: timestamp,
            declaredPermissions: config.declaredPermissions,
        };
        if (config.uiLabel) {
            next.uiLabel = config.uiLabel;
        }
        file.entries[config.extensionId] = next;
        (0,_utils_js__WEBPACK_IMPORTED_MODULE_1__.atomicWriteJson)(paths.extensionsFile, file);
        return next;
    }
    listExtensions(user) {
        const paths = (0,_store_authority_paths_js__WEBPACK_IMPORTED_MODULE_0__.getUserAuthorityPaths)(user);
        const file = (0,_utils_js__WEBPACK_IMPORTED_MODULE_1__.readJsonFile)(paths.extensionsFile, { entries: {} });
        return Object.values(file.entries).sort((left, right) => left.displayName.localeCompare(right.displayName));
    }
    getExtension(user, extensionId) {
        return this.listExtensions(user).find(entry => entry.id === extensionId) ?? null;
    }
}


/***/ },

/***/ "./src/services/http-service.ts"
/*!**************************************!*\
  !*** ./src/services/http-service.ts ***!
  \**************************************/
(__unused_webpack_module, __webpack_exports__, __webpack_require__) {

__webpack_require__.r(__webpack_exports__);
/* harmony export */ __webpack_require__.d(__webpack_exports__, {
/* harmony export */   HttpService: () => (/* binding */ HttpService)
/* harmony export */ });
/* harmony import */ var _constants_js__WEBPACK_IMPORTED_MODULE_0__ = __webpack_require__(/*! ../constants.js */ "./src/constants.ts");
/* harmony import */ var _utils_js__WEBPACK_IMPORTED_MODULE_1__ = __webpack_require__(/*! ../utils.js */ "./src/utils.ts");


class HttpService {
    async fetch(_user, input) {
        const bodySize = Buffer.byteLength(input.body ?? '');
        if (bodySize > _constants_js__WEBPACK_IMPORTED_MODULE_0__.MAX_HTTP_BODY_BYTES) {
            throw new Error(`HTTP request body exceeds ${_constants_js__WEBPACK_IMPORTED_MODULE_0__.MAX_HTTP_BODY_BYTES} bytes`);
        }
        const requestInit = {
            method: input.method ?? 'GET',
            headers: input.headers ?? {},
            redirect: 'follow',
        };
        if (input.body !== undefined) {
            requestInit.body = input.body;
        }
        const response = await fetch(input.url, requestInit);
        const buffer = Buffer.from(await response.arrayBuffer());
        if (buffer.byteLength > _constants_js__WEBPACK_IMPORTED_MODULE_0__.MAX_HTTP_RESPONSE_BYTES) {
            throw new Error(`HTTP response exceeds ${_constants_js__WEBPACK_IMPORTED_MODULE_0__.MAX_HTTP_RESPONSE_BYTES} bytes`);
        }
        const contentType = response.headers.get('content-type') ?? 'application/octet-stream';
        const isTextual = /(json|text|xml|javascript|html)/i.test(contentType);
        const headers = {};
        response.headers.forEach((value, key) => {
            headers[key] = value;
        });
        return {
            url: input.url,
            hostname: (0,_utils_js__WEBPACK_IMPORTED_MODULE_1__.normalizeHostname)(input.url),
            status: response.status,
            ok: response.ok,
            headers,
            body: isTextual ? buffer.toString('utf8') : buffer.toString('base64'),
            bodyEncoding: isTextual ? 'utf8' : 'base64',
            contentType,
        };
    }
}


/***/ },

/***/ "./src/services/install-service.ts"
/*!*****************************************!*\
  !*** ./src/services/install-service.ts ***!
  \*****************************************/
(__unused_webpack_module, __webpack_exports__, __webpack_require__) {

__webpack_require__.r(__webpack_exports__);
/* harmony export */ __webpack_require__.d(__webpack_exports__, {
/* harmony export */   InstallService: () => (/* binding */ InstallService)
/* harmony export */ });
/* harmony import */ var node_crypto__WEBPACK_IMPORTED_MODULE_0__ = __webpack_require__(/*! node:crypto */ "node:crypto");
/* harmony import */ var node_crypto__WEBPACK_IMPORTED_MODULE_0___default = /*#__PURE__*/__webpack_require__.n(node_crypto__WEBPACK_IMPORTED_MODULE_0__);
/* harmony import */ var node_fs__WEBPACK_IMPORTED_MODULE_1__ = __webpack_require__(/*! node:fs */ "node:fs");
/* harmony import */ var node_fs__WEBPACK_IMPORTED_MODULE_1___default = /*#__PURE__*/__webpack_require__.n(node_fs__WEBPACK_IMPORTED_MODULE_1__);
/* harmony import */ var node_path__WEBPACK_IMPORTED_MODULE_2__ = __webpack_require__(/*! node:path */ "node:path");
/* harmony import */ var node_path__WEBPACK_IMPORTED_MODULE_2___default = /*#__PURE__*/__webpack_require__.n(node_path__WEBPACK_IMPORTED_MODULE_2__);
/* harmony import */ var _constants_js__WEBPACK_IMPORTED_MODULE_3__ = __webpack_require__(/*! ../constants.js */ "./src/constants.ts");
/* harmony import */ var _utils_js__WEBPACK_IMPORTED_MODULE_4__ = __webpack_require__(/*! ../utils.js */ "./src/utils.ts");





const DEFAULT_VERSION = '0.0.0-dev';
class InstallService {
    runtimeDir;
    pluginRoot;
    cwd;
    env;
    logger;
    releaseMetadata;
    status;
    constructor(options = {}) {
        this.runtimeDir = node_path__WEBPACK_IMPORTED_MODULE_2___default().resolve(options.runtimeDir ?? __dirname);
        this.pluginRoot = resolvePluginRoot(this.runtimeDir);
        this.cwd = node_path__WEBPACK_IMPORTED_MODULE_2___default().resolve(options.cwd ?? process.cwd());
        this.env = options.env ?? process.env;
        this.logger = options.logger ?? console;
        this.releaseMetadata = readReleaseMetadata(this.pluginRoot);
        const pluginVersion = this.releaseMetadata?.pluginVersion ?? readPackageVersion(this.pluginRoot) ?? DEFAULT_VERSION;
        const sdkBundledVersion = this.releaseMetadata?.sdkVersion ?? readBundledSdkVersion(this.pluginRoot) ?? pluginVersion;
        this.status = {
            installStatus: 'missing',
            installMessage: 'Authority SDK deployment has not run yet.',
            pluginVersion,
            sdkBundledVersion,
            sdkDeployedVersion: null,
        };
    }
    getStatus() {
        return { ...this.status };
    }
    async bootstrap() {
        const bundledDir = node_path__WEBPACK_IMPORTED_MODULE_2___default().join(this.pluginRoot, _constants_js__WEBPACK_IMPORTED_MODULE_3__.AUTHORITY_MANAGED_SDK_DIR);
        try {
            if (!this.releaseMetadata || !node_fs__WEBPACK_IMPORTED_MODULE_1___default().existsSync(bundledDir)) {
                return this.setStatus('missing', 'Managed Authority SDK bundle is not embedded in this plugin build.');
            }
            const sillyTavernRoot = this.resolveSillyTavernRoot();
            if (!sillyTavernRoot) {
                return this.setStatus('missing', 'Unable to resolve the SillyTavern root for managed SDK deployment.');
            }
            const targetDir = node_path__WEBPACK_IMPORTED_MODULE_2___default().join(sillyTavernRoot, 'public', 'scripts', 'extensions', 'third-party', 'st-authority-sdk');
            const managedFile = node_path__WEBPACK_IMPORTED_MODULE_2___default().join(targetDir, _constants_js__WEBPACK_IMPORTED_MODULE_3__.AUTHORITY_MANAGED_FILE);
            const existingManaged = (0,_utils_js__WEBPACK_IMPORTED_MODULE_4__.readJsonFile)(managedFile, null);
            if (!node_fs__WEBPACK_IMPORTED_MODULE_1___default().existsSync(targetDir)) {
                this.deployBundledSdk(bundledDir, targetDir);
                return this.setStatus('installed', `Authority SDK deployed to ${targetDir}.`, this.releaseMetadata.sdkVersion);
            }
            if (!existingManaged || existingManaged.managedBy !== _constants_js__WEBPACK_IMPORTED_MODULE_3__.AUTHORITY_PLUGIN_ID) {
                return this.setStatus('conflict', `Authority SDK target already exists and is not managed by ${_constants_js__WEBPACK_IMPORTED_MODULE_3__.AUTHORITY_PLUGIN_ID}.`, null);
            }
            const currentHash = hashDirectory(targetDir, new Set([_constants_js__WEBPACK_IMPORTED_MODULE_3__.AUTHORITY_MANAGED_FILE]));
            const needsUpdate = existingManaged.sdkVersion !== this.releaseMetadata.sdkVersion
                || existingManaged.assetHash !== this.releaseMetadata.assetHash
                || currentHash !== this.releaseMetadata.assetHash;
            if (needsUpdate) {
                this.deployBundledSdk(bundledDir, targetDir);
                return this.setStatus('updated', `Authority SDK refreshed at ${targetDir}.`, this.releaseMetadata.sdkVersion);
            }
            return this.setStatus('ready', `Authority SDK is already available at ${targetDir}.`, existingManaged.sdkVersion);
        }
        catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            this.logger.error(`[authority] Managed SDK deployment failed: ${message}`);
            return this.setStatus('error', message);
        }
    }
    resolveSillyTavernRoot() {
        const envRoot = this.env.AUTHORITY_ST_ROOT?.trim();
        const candidates = [
            this.cwd,
            node_path__WEBPACK_IMPORTED_MODULE_2___default().resolve(this.pluginRoot, '..', '..'),
            envRoot ? node_path__WEBPACK_IMPORTED_MODULE_2___default().resolve(envRoot) : null,
        ];
        for (const candidate of candidates) {
            if (candidate && isSillyTavernRoot(candidate)) {
                return candidate;
            }
        }
        return null;
    }
    deployBundledSdk(bundledDir, targetDir) {
        const parentDir = node_path__WEBPACK_IMPORTED_MODULE_2___default().dirname(targetDir);
        node_fs__WEBPACK_IMPORTED_MODULE_1___default().mkdirSync(parentDir, { recursive: true });
        node_fs__WEBPACK_IMPORTED_MODULE_1___default().rmSync(targetDir, { recursive: true, force: true });
        node_fs__WEBPACK_IMPORTED_MODULE_1___default().cpSync(bundledDir, targetDir, { recursive: true, force: true });
        const metadata = {
            managedBy: _constants_js__WEBPACK_IMPORTED_MODULE_3__.AUTHORITY_PLUGIN_ID,
            pluginVersion: this.releaseMetadata?.pluginVersion ?? this.status.pluginVersion,
            sdkVersion: this.releaseMetadata?.sdkVersion ?? this.status.sdkBundledVersion,
            assetHash: this.releaseMetadata?.assetHash ?? hashDirectory(targetDir, new Set([_constants_js__WEBPACK_IMPORTED_MODULE_3__.AUTHORITY_MANAGED_FILE])),
            installedAt: (0,_utils_js__WEBPACK_IMPORTED_MODULE_4__.nowIso)(),
            targetPath: targetDir,
        };
        (0,_utils_js__WEBPACK_IMPORTED_MODULE_4__.atomicWriteJson)(node_path__WEBPACK_IMPORTED_MODULE_2___default().join(targetDir, _constants_js__WEBPACK_IMPORTED_MODULE_3__.AUTHORITY_MANAGED_FILE), metadata);
        this.logger.info(`[authority] Managed SDK deployed to ${targetDir}`);
    }
    setStatus(installStatus, installMessage, sdkDeployedVersion = null) {
        this.status = {
            ...this.status,
            installStatus,
            installMessage,
            sdkDeployedVersion,
        };
        const prefix = `[authority] ${installStatus.toUpperCase()}`;
        if (installStatus === 'error') {
            this.logger.error(`${prefix}: ${installMessage}`);
        }
        else if (installStatus === 'conflict' || installStatus === 'missing') {
            this.logger.warn(`${prefix}: ${installMessage}`);
        }
        else {
            this.logger.info(`${prefix}: ${installMessage}`);
        }
        return this.getStatus();
    }
}
function resolvePluginRoot(runtimeDir) {
    let current = runtimeDir;
    while (true) {
        if (node_fs__WEBPACK_IMPORTED_MODULE_1___default().existsSync(node_path__WEBPACK_IMPORTED_MODULE_2___default().join(current, _constants_js__WEBPACK_IMPORTED_MODULE_3__.AUTHORITY_RELEASE_FILE))) {
            return current;
        }
        const packageJsonPath = node_path__WEBPACK_IMPORTED_MODULE_2___default().join(current, 'package.json');
        if (node_fs__WEBPACK_IMPORTED_MODULE_1___default().existsSync(packageJsonPath)) {
            const packageJson = (0,_utils_js__WEBPACK_IMPORTED_MODULE_4__.readJsonFile)(packageJsonPath, {});
            if (packageJson.name === _constants_js__WEBPACK_IMPORTED_MODULE_3__.AUTHORITY_PLUGIN_ID) {
                return current;
            }
        }
        const parent = node_path__WEBPACK_IMPORTED_MODULE_2___default().dirname(current);
        if (parent === current) {
            return runtimeDir;
        }
        current = parent;
    }
}
function readReleaseMetadata(pluginRoot) {
    return (0,_utils_js__WEBPACK_IMPORTED_MODULE_4__.readJsonFile)(node_path__WEBPACK_IMPORTED_MODULE_2___default().join(pluginRoot, _constants_js__WEBPACK_IMPORTED_MODULE_3__.AUTHORITY_RELEASE_FILE), null);
}
function readPackageVersion(pluginRoot) {
    const packageJsonPath = node_path__WEBPACK_IMPORTED_MODULE_2___default().join(pluginRoot, 'package.json');
    if (!node_fs__WEBPACK_IMPORTED_MODULE_1___default().existsSync(packageJsonPath)) {
        return null;
    }
    return (0,_utils_js__WEBPACK_IMPORTED_MODULE_4__.readJsonFile)(packageJsonPath, {}).version ?? null;
}
function readBundledSdkVersion(pluginRoot) {
    const manifestPath = node_path__WEBPACK_IMPORTED_MODULE_2___default().join(pluginRoot, _constants_js__WEBPACK_IMPORTED_MODULE_3__.AUTHORITY_MANAGED_SDK_DIR, 'manifest.json');
    if (!node_fs__WEBPACK_IMPORTED_MODULE_1___default().existsSync(manifestPath)) {
        return null;
    }
    return (0,_utils_js__WEBPACK_IMPORTED_MODULE_4__.readJsonFile)(manifestPath, {}).version ?? null;
}
function isSillyTavernRoot(candidate) {
    return node_fs__WEBPACK_IMPORTED_MODULE_1___default().existsSync(node_path__WEBPACK_IMPORTED_MODULE_2___default().join(candidate, 'plugins'))
        && node_fs__WEBPACK_IMPORTED_MODULE_1___default().existsSync(node_path__WEBPACK_IMPORTED_MODULE_2___default().join(candidate, 'public', 'scripts', 'extensions'));
}
function hashDirectory(rootDir, ignoreNames = new Set()) {
    const hash = node_crypto__WEBPACK_IMPORTED_MODULE_0___default().createHash('sha256');
    for (const filePath of listFiles(rootDir, ignoreNames)) {
        const relativePath = node_path__WEBPACK_IMPORTED_MODULE_2___default().relative(rootDir, filePath).replace(/\\/g, '/');
        hash.update(relativePath);
        hash.update('\0');
        hash.update(node_fs__WEBPACK_IMPORTED_MODULE_1___default().readFileSync(filePath));
        hash.update('\0');
    }
    return hash.digest('hex');
}
function listFiles(rootDir, ignoreNames) {
    const files = [];
    if (!node_fs__WEBPACK_IMPORTED_MODULE_1___default().existsSync(rootDir)) {
        return files;
    }
    const visit = (currentDir) => {
        const entries = node_fs__WEBPACK_IMPORTED_MODULE_1___default().readdirSync(currentDir, { withFileTypes: true })
            .filter(entry => !ignoreNames.has(entry.name))
            .sort((left, right) => left.name.localeCompare(right.name));
        for (const entry of entries) {
            const fullPath = node_path__WEBPACK_IMPORTED_MODULE_2___default().join(currentDir, entry.name);
            if (entry.isDirectory()) {
                visit(fullPath);
            }
            else if (entry.isFile()) {
                files.push(fullPath);
            }
        }
    };
    visit(rootDir);
    return files;
}


/***/ },

/***/ "./src/services/job-service.ts"
/*!*************************************!*\
  !*** ./src/services/job-service.ts ***!
  \*************************************/
(__unused_webpack_module, __webpack_exports__, __webpack_require__) {

__webpack_require__.r(__webpack_exports__);
/* harmony export */ __webpack_require__.d(__webpack_exports__, {
/* harmony export */   JobService: () => (/* binding */ JobService)
/* harmony export */ });
/* harmony import */ var _constants_js__WEBPACK_IMPORTED_MODULE_0__ = __webpack_require__(/*! ../constants.js */ "./src/constants.ts");
/* harmony import */ var _store_authority_paths_js__WEBPACK_IMPORTED_MODULE_1__ = __webpack_require__(/*! ../store/authority-paths.js */ "./src/store/authority-paths.ts");
/* harmony import */ var _utils_js__WEBPACK_IMPORTED_MODULE_2__ = __webpack_require__(/*! ../utils.js */ "./src/utils.ts");



class JobService {
    events;
    inflight = new Map();
    constructor(events) {
        this.events = events;
    }
    list(user, extensionId) {
        const paths = (0,_store_authority_paths_js__WEBPACK_IMPORTED_MODULE_1__.getUserAuthorityPaths)(user);
        const file = (0,_utils_js__WEBPACK_IMPORTED_MODULE_2__.readJsonFile)(paths.jobsFile, { entries: {} });
        return Object.values(file.entries)
            .filter(job => !extensionId || job.extensionId === extensionId)
            .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt));
    }
    get(user, jobId) {
        return this.list(user).find(job => job.id === jobId) ?? null;
    }
    create(user, extensionId, type, payload) {
        if (!_constants_js__WEBPACK_IMPORTED_MODULE_0__.BUILTIN_JOB_TYPES.includes(type)) {
            throw new Error(`Unsupported job type: ${type}`);
        }
        const id = (0,_utils_js__WEBPACK_IMPORTED_MODULE_2__.randomToken)();
        const timestamp = (0,_utils_js__WEBPACK_IMPORTED_MODULE_2__.nowIso)();
        const job = {
            id,
            extensionId,
            type,
            status: 'queued',
            createdAt: timestamp,
            updatedAt: timestamp,
            progress: 0,
            payload,
            channel: `extension:${extensionId}`,
        };
        this.writeJob(user, job);
        this.runDelayJob(user, job);
        return job;
    }
    cancel(user, extensionId, jobId) {
        const job = this.get(user, jobId);
        if (!job || job.extensionId !== extensionId) {
            throw new Error('Job not found');
        }
        const task = this.inflight.get(jobId);
        if (task) {
            clearInterval(task.timer);
            this.inflight.delete(jobId);
        }
        const next = {
            ...job,
            status: 'cancelled',
            updatedAt: (0,_utils_js__WEBPACK_IMPORTED_MODULE_2__.nowIso)(),
            summary: 'Cancelled by user',
        };
        this.writeJob(user, next);
        this.events.emit(user.handle, extensionId, 'authority.job', next);
        return next;
    }
    runDelayJob(user, job) {
        const durationMs = Number(job.payload?.durationMs ?? 3000);
        const startedAt = Date.now();
        const runningJob = {
            ...job,
            status: 'running',
            updatedAt: (0,_utils_js__WEBPACK_IMPORTED_MODULE_2__.nowIso)(),
            summary: `Running delay job for ${durationMs}ms`,
        };
        this.writeJob(user, runningJob);
        this.events.emit(user.handle, job.extensionId, 'authority.job', runningJob);
        const timer = setInterval(() => {
            const current = this.get(user, job.id);
            if (!current || current.status === 'cancelled') {
                clearInterval(timer);
                this.inflight.delete(job.id);
                return;
            }
            const elapsed = Date.now() - startedAt;
            const progress = Math.min(100, Math.round((elapsed / durationMs) * 100));
            if (progress >= 100) {
                clearInterval(timer);
                this.inflight.delete(job.id);
                const completed = {
                    ...current,
                    status: 'completed',
                    progress: 100,
                    updatedAt: (0,_utils_js__WEBPACK_IMPORTED_MODULE_2__.nowIso)(),
                    summary: String(job.payload?.message ?? 'Delay completed'),
                    result: {
                        elapsedMs: durationMs,
                        message: job.payload?.message ?? 'Delay completed',
                    },
                };
                this.writeJob(user, completed);
                this.events.emit(user.handle, job.extensionId, 'authority.job', completed);
                return;
            }
            const update = {
                ...current,
                progress,
                updatedAt: (0,_utils_js__WEBPACK_IMPORTED_MODULE_2__.nowIso)(),
            };
            this.writeJob(user, update);
            this.events.emit(user.handle, job.extensionId, 'authority.job', update);
        }, 250);
        this.inflight.set(job.id, { timer });
    }
    writeJob(user, job) {
        const paths = (0,_store_authority_paths_js__WEBPACK_IMPORTED_MODULE_1__.getUserAuthorityPaths)(user);
        const file = (0,_utils_js__WEBPACK_IMPORTED_MODULE_2__.readJsonFile)(paths.jobsFile, { entries: {} });
        file.entries[job.id] = job;
        (0,_utils_js__WEBPACK_IMPORTED_MODULE_2__.atomicWriteJson)(paths.jobsFile, file);
    }
}


/***/ },

/***/ "./src/services/permission-service.ts"
/*!********************************************!*\
  !*** ./src/services/permission-service.ts ***!
  \********************************************/
(__unused_webpack_module, __webpack_exports__, __webpack_require__) {

__webpack_require__.r(__webpack_exports__);
/* harmony export */ __webpack_require__.d(__webpack_exports__, {
/* harmony export */   PermissionService: () => (/* binding */ PermissionService)
/* harmony export */ });
/* harmony import */ var _constants_js__WEBPACK_IMPORTED_MODULE_0__ = __webpack_require__(/*! ../constants.js */ "./src/constants.ts");
/* harmony import */ var _store_authority_paths_js__WEBPACK_IMPORTED_MODULE_1__ = __webpack_require__(/*! ../store/authority-paths.js */ "./src/store/authority-paths.ts");
/* harmony import */ var _utils_js__WEBPACK_IMPORTED_MODULE_2__ = __webpack_require__(/*! ../utils.js */ "./src/utils.ts");



class PermissionService {
    policyService;
    constructor(policyService) {
        this.policyService = policyService;
    }
    listPersistentGrants(user, extensionId) {
        const paths = (0,_store_authority_paths_js__WEBPACK_IMPORTED_MODULE_1__.getUserAuthorityPaths)(user);
        const file = (0,_utils_js__WEBPACK_IMPORTED_MODULE_2__.readJsonFile)(paths.permissionsFile, { entries: {} });
        return Object.values(file.entries[extensionId] ?? {});
    }
    getPolicyEntries(user, extensionId) {
        return this.policyService.getExtensionPolicies(user, extensionId);
    }
    evaluate(user, session, request) {
        const descriptor = (0,_utils_js__WEBPACK_IMPORTED_MODULE_2__.buildPermissionDescriptor)(request.resource, request.target);
        const policy = this.getPolicyGrant(user, session.extension.id, descriptor.key);
        if (policy) {
            return {
                decision: policy.status,
                key: descriptor.key,
                riskLevel: descriptor.riskLevel,
                target: descriptor.target,
                resource: descriptor.resource,
                grant: policy,
            };
        }
        const persistentGrant = this.getPersistentGrant(user, session.extension.id, descriptor.key);
        if (persistentGrant) {
            return {
                decision: persistentGrant.status,
                key: descriptor.key,
                riskLevel: descriptor.riskLevel,
                target: descriptor.target,
                resource: descriptor.resource,
                grant: persistentGrant,
            };
        }
        const sessionGrant = session.sessionGrants.get(descriptor.key)?.grant;
        if (sessionGrant) {
            return {
                decision: sessionGrant.status,
                key: descriptor.key,
                riskLevel: descriptor.riskLevel,
                target: descriptor.target,
                resource: descriptor.resource,
                grant: sessionGrant,
            };
        }
        return {
            decision: _constants_js__WEBPACK_IMPORTED_MODULE_0__.DEFAULT_POLICY_STATUS[descriptor.resource],
            key: descriptor.key,
            riskLevel: descriptor.riskLevel,
            target: descriptor.target,
            resource: descriptor.resource,
        };
    }
    authorize(user, session, request, consume = true) {
        const evaluation = this.evaluate(user, session, request);
        if (evaluation.decision !== 'granted') {
            return null;
        }
        const descriptor = (0,_utils_js__WEBPACK_IMPORTED_MODULE_2__.buildPermissionDescriptor)(request.resource, request.target);
        const sessionState = session.sessionGrants.get(descriptor.key);
        if (consume && sessionState?.remainingUses) {
            sessionState.remainingUses -= 1;
            if (sessionState.remainingUses <= 0) {
                session.sessionGrants.delete(descriptor.key);
            }
            else {
                session.sessionGrants.set(descriptor.key, sessionState);
            }
        }
        return evaluation.grant ?? null;
    }
    resolve(user, session, request, choice) {
        const descriptor = (0,_utils_js__WEBPACK_IMPORTED_MODULE_2__.buildPermissionDescriptor)(request.resource, request.target);
        const timestamp = (0,_utils_js__WEBPACK_IMPORTED_MODULE_2__.nowIso)();
        const grant = {
            key: descriptor.key,
            resource: descriptor.resource,
            target: descriptor.target,
            status: choice === 'deny' ? 'denied' : 'granted',
            scope: choice === 'allow-always' || choice === 'deny' ? 'persistent' : 'session',
            riskLevel: descriptor.riskLevel,
            updatedAt: timestamp,
            source: user.isAdmin ? 'admin' : 'user',
        };
        if (choice === 'allow-always' || choice === 'deny') {
            this.writePersistentGrant(user, session.extension.id, {
                ...grant,
                choice,
            });
        }
        else {
            const sessionGrant = { grant };
            if (choice === 'allow-once') {
                sessionGrant.remainingUses = 1;
            }
            session.sessionGrants.set(descriptor.key, sessionGrant);
        }
        return grant;
    }
    resetPersistentGrants(user, extensionId, keys) {
        const paths = (0,_store_authority_paths_js__WEBPACK_IMPORTED_MODULE_1__.getUserAuthorityPaths)(user);
        const file = (0,_utils_js__WEBPACK_IMPORTED_MODULE_2__.readJsonFile)(paths.permissionsFile, { entries: {} });
        const current = file.entries[extensionId] ?? {};
        if (!keys || keys.length === 0) {
            delete file.entries[extensionId];
        }
        else {
            for (const key of keys) {
                delete current[key];
            }
            file.entries[extensionId] = current;
        }
        (0,_utils_js__WEBPACK_IMPORTED_MODULE_2__.atomicWriteJson)(paths.permissionsFile, file);
    }
    getPolicyGrant(user, extensionId, key) {
        const file = this.policyService.getPolicies(user);
        return file.extensions[extensionId]?.[key] ?? null;
    }
    getPersistentGrant(user, extensionId, key) {
        const paths = (0,_store_authority_paths_js__WEBPACK_IMPORTED_MODULE_1__.getUserAuthorityPaths)(user);
        const file = (0,_utils_js__WEBPACK_IMPORTED_MODULE_2__.readJsonFile)(paths.permissionsFile, { entries: {} });
        return file.entries[extensionId]?.[key] ?? null;
    }
    writePersistentGrant(user, extensionId, grant) {
        const paths = (0,_store_authority_paths_js__WEBPACK_IMPORTED_MODULE_1__.getUserAuthorityPaths)(user);
        const file = (0,_utils_js__WEBPACK_IMPORTED_MODULE_2__.readJsonFile)(paths.permissionsFile, { entries: {} });
        const current = file.entries[extensionId] ?? {};
        current[grant.key] = grant;
        file.entries[extensionId] = current;
        (0,_utils_js__WEBPACK_IMPORTED_MODULE_2__.atomicWriteJson)(paths.permissionsFile, file);
    }
}


/***/ },

/***/ "./src/services/policy-service.ts"
/*!****************************************!*\
  !*** ./src/services/policy-service.ts ***!
  \****************************************/
(__unused_webpack_module, __webpack_exports__, __webpack_require__) {

__webpack_require__.r(__webpack_exports__);
/* harmony export */ __webpack_require__.d(__webpack_exports__, {
/* harmony export */   PolicyService: () => (/* binding */ PolicyService)
/* harmony export */ });
/* harmony import */ var _constants_js__WEBPACK_IMPORTED_MODULE_0__ = __webpack_require__(/*! ../constants.js */ "./src/constants.ts");
/* harmony import */ var _store_authority_paths_js__WEBPACK_IMPORTED_MODULE_1__ = __webpack_require__(/*! ../store/authority-paths.js */ "./src/store/authority-paths.ts");
/* harmony import */ var _utils_js__WEBPACK_IMPORTED_MODULE_2__ = __webpack_require__(/*! ../utils.js */ "./src/utils.ts");



class PolicyService {
    getPolicies(user) {
        const globalPaths = (0,_store_authority_paths_js__WEBPACK_IMPORTED_MODULE_1__.getGlobalAuthorityPaths)();
        const userPaths = (0,_store_authority_paths_js__WEBPACK_IMPORTED_MODULE_1__.getUserAuthorityPaths)(user);
        const globalFile = (0,_utils_js__WEBPACK_IMPORTED_MODULE_2__.readJsonFile)(globalPaths.policiesFile, {
            defaults: { ..._constants_js__WEBPACK_IMPORTED_MODULE_0__.DEFAULT_POLICY_STATUS },
            extensions: {},
            updatedAt: (0,_utils_js__WEBPACK_IMPORTED_MODULE_2__.nowIso)(),
        });
        const userFile = (0,_utils_js__WEBPACK_IMPORTED_MODULE_2__.readJsonFile)(userPaths.policiesFile, {
            defaults: { ..._constants_js__WEBPACK_IMPORTED_MODULE_0__.DEFAULT_POLICY_STATUS },
            extensions: {},
            updatedAt: (0,_utils_js__WEBPACK_IMPORTED_MODULE_2__.nowIso)(),
        });
        return {
            defaults: {
                ...globalFile.defaults,
                ...userFile.defaults,
            },
            extensions: {
                ...globalFile.extensions,
                ...userFile.extensions,
            },
            updatedAt: userFile.updatedAt || globalFile.updatedAt,
        };
    }
    getExtensionPolicies(user, extensionId) {
        return Object.values(this.getPolicies(user).extensions[extensionId] ?? {});
    }
    saveGlobalPolicies(actor, partial) {
        if (!actor.isAdmin) {
            throw new Error('Forbidden');
        }
        const paths = (0,_store_authority_paths_js__WEBPACK_IMPORTED_MODULE_1__.getGlobalAuthorityPaths)();
        const current = (0,_utils_js__WEBPACK_IMPORTED_MODULE_2__.readJsonFile)(paths.policiesFile, {
            defaults: { ..._constants_js__WEBPACK_IMPORTED_MODULE_0__.DEFAULT_POLICY_STATUS },
            extensions: {},
            updatedAt: (0,_utils_js__WEBPACK_IMPORTED_MODULE_2__.nowIso)(),
        });
        const next = {
            defaults: {
                ...current.defaults,
                ...(partial.defaults ?? {}),
            },
            extensions: {
                ...current.extensions,
                ...(partial.extensions ?? {}),
            },
            updatedAt: (0,_utils_js__WEBPACK_IMPORTED_MODULE_2__.nowIso)(),
        };
        (0,_utils_js__WEBPACK_IMPORTED_MODULE_2__.atomicWriteJson)(paths.policiesFile, next);
        return next;
    }
}


/***/ },

/***/ "./src/services/session-service.ts"
/*!*****************************************!*\
  !*** ./src/services/session-service.ts ***!
  \*****************************************/
(__unused_webpack_module, __webpack_exports__, __webpack_require__) {

__webpack_require__.r(__webpack_exports__);
/* harmony export */ __webpack_require__.d(__webpack_exports__, {
/* harmony export */   SessionService: () => (/* binding */ SessionService)
/* harmony export */ });
/* harmony import */ var _utils_js__WEBPACK_IMPORTED_MODULE_0__ = __webpack_require__(/*! ../utils.js */ "./src/utils.ts");

class SessionService {
    sessions = new Map();
    createSession(user, config, firstSeenAt) {
        const token = (0,_utils_js__WEBPACK_IMPORTED_MODULE_0__.randomToken)();
        const session = {
            token,
            createdAt: (0,_utils_js__WEBPACK_IMPORTED_MODULE_0__.nowIso)(),
            userHandle: user.handle,
            isAdmin: user.isAdmin,
            extension: {
                id: config.extensionId,
                installType: config.installType,
                displayName: config.displayName,
                version: config.version,
                firstSeenAt,
            },
            declaredPermissions: config.declaredPermissions,
            sessionGrants: new Map(),
        };
        this.sessions.set(token, session);
        return session;
    }
    getSession(token) {
        if (!token) {
            return null;
        }
        return this.sessions.get(token) ?? null;
    }
    assertSession(token, user) {
        const session = this.getSession(token);
        if (!session) {
            throw new Error('Invalid authority session');
        }
        if (session.userHandle !== user.handle) {
            throw new Error('Authority session does not belong to current user');
        }
        return session;
    }
    buildSessionResponse(session, grants, policies) {
        return {
            sessionToken: session.token,
            user: {
                handle: session.userHandle,
                isAdmin: session.isAdmin,
            },
            extension: session.extension,
            grants,
            policies,
            features: {
                securityCenter: true,
                admin: session.isAdmin,
            },
        };
    }
}


/***/ },

/***/ "./src/services/storage-service.ts"
/*!*****************************************!*\
  !*** ./src/services/storage-service.ts ***!
  \*****************************************/
(__unused_webpack_module, __webpack_exports__, __webpack_require__) {

__webpack_require__.r(__webpack_exports__);
/* harmony export */ __webpack_require__.d(__webpack_exports__, {
/* harmony export */   StorageService: () => (/* binding */ StorageService)
/* harmony export */ });
/* harmony import */ var node_fs__WEBPACK_IMPORTED_MODULE_0__ = __webpack_require__(/*! node:fs */ "node:fs");
/* harmony import */ var node_fs__WEBPACK_IMPORTED_MODULE_0___default = /*#__PURE__*/__webpack_require__.n(node_fs__WEBPACK_IMPORTED_MODULE_0__);
/* harmony import */ var node_path__WEBPACK_IMPORTED_MODULE_1__ = __webpack_require__(/*! node:path */ "node:path");
/* harmony import */ var node_path__WEBPACK_IMPORTED_MODULE_1___default = /*#__PURE__*/__webpack_require__.n(node_path__WEBPACK_IMPORTED_MODULE_1__);
/* harmony import */ var _constants_js__WEBPACK_IMPORTED_MODULE_2__ = __webpack_require__(/*! ../constants.js */ "./src/constants.ts");
/* harmony import */ var _store_authority_paths_js__WEBPACK_IMPORTED_MODULE_3__ = __webpack_require__(/*! ../store/authority-paths.js */ "./src/store/authority-paths.ts");
/* harmony import */ var _utils_js__WEBPACK_IMPORTED_MODULE_4__ = __webpack_require__(/*! ../utils.js */ "./src/utils.ts");





class StorageService {
    getKv(user, extensionId, key) {
        return this.listKv(user, extensionId)[key];
    }
    setKv(user, extensionId, key, value) {
        const valueBytes = Buffer.byteLength(JSON.stringify(value));
        if (valueBytes > _constants_js__WEBPACK_IMPORTED_MODULE_2__.MAX_KV_VALUE_BYTES) {
            throw new Error(`KV value exceeds ${_constants_js__WEBPACK_IMPORTED_MODULE_2__.MAX_KV_VALUE_BYTES} bytes`);
        }
        const filePath = this.getKvFilePath(user, extensionId);
        const data = (0,_utils_js__WEBPACK_IMPORTED_MODULE_4__.readJsonFile)(filePath, {});
        data[key] = value;
        (0,_utils_js__WEBPACK_IMPORTED_MODULE_4__.atomicWriteJson)(filePath, data);
    }
    deleteKv(user, extensionId, key) {
        const filePath = this.getKvFilePath(user, extensionId);
        const data = (0,_utils_js__WEBPACK_IMPORTED_MODULE_4__.readJsonFile)(filePath, {});
        delete data[key];
        (0,_utils_js__WEBPACK_IMPORTED_MODULE_4__.atomicWriteJson)(filePath, data);
    }
    listKv(user, extensionId) {
        return (0,_utils_js__WEBPACK_IMPORTED_MODULE_4__.readJsonFile)(this.getKvFilePath(user, extensionId), {});
    }
    putBlob(user, extensionId, name, content, encoding = 'utf8', contentType = 'application/octet-stream') {
        const extensionDir = this.getBlobDir(user, extensionId);
        (0,_utils_js__WEBPACK_IMPORTED_MODULE_4__.ensureDir)(extensionDir);
        const blobId = (0,_utils_js__WEBPACK_IMPORTED_MODULE_4__.sanitizeFileSegment)(name || 'blob');
        const payload = encoding === 'base64' ? Buffer.from(content, 'base64') : Buffer.from(content, 'utf8');
        if (payload.byteLength > _constants_js__WEBPACK_IMPORTED_MODULE_2__.MAX_BLOB_BYTES) {
            throw new Error(`Blob exceeds ${_constants_js__WEBPACK_IMPORTED_MODULE_2__.MAX_BLOB_BYTES} bytes`);
        }
        const binPath = node_path__WEBPACK_IMPORTED_MODULE_1___default().join(extensionDir, `${blobId}.bin`);
        const metaPath = node_path__WEBPACK_IMPORTED_MODULE_1___default().join(extensionDir, `${blobId}.json`);
        node_fs__WEBPACK_IMPORTED_MODULE_0___default().writeFileSync(binPath, payload);
        const record = {
            id: blobId,
            name,
            contentType,
            size: payload.byteLength,
            updatedAt: (0,_utils_js__WEBPACK_IMPORTED_MODULE_4__.nowIso)(),
        };
        (0,_utils_js__WEBPACK_IMPORTED_MODULE_4__.atomicWriteJson)(metaPath, record);
        return record;
    }
    getBlob(user, extensionId, blobId) {
        const extensionDir = this.getBlobDir(user, extensionId);
        const safeId = (0,_utils_js__WEBPACK_IMPORTED_MODULE_4__.sanitizeFileSegment)(blobId);
        const metaPath = node_path__WEBPACK_IMPORTED_MODULE_1___default().join(extensionDir, `${safeId}.json`);
        const binPath = node_path__WEBPACK_IMPORTED_MODULE_1___default().join(extensionDir, `${safeId}.bin`);
        if (!node_fs__WEBPACK_IMPORTED_MODULE_0___default().existsSync(metaPath) || !node_fs__WEBPACK_IMPORTED_MODULE_0___default().existsSync(binPath)) {
            throw new Error('Blob not found');
        }
        const record = (0,_utils_js__WEBPACK_IMPORTED_MODULE_4__.readJsonFile)(metaPath, {});
        return {
            record,
            content: node_fs__WEBPACK_IMPORTED_MODULE_0___default().readFileSync(binPath).toString('base64'),
            encoding: 'base64',
        };
    }
    deleteBlob(user, extensionId, blobId) {
        const extensionDir = this.getBlobDir(user, extensionId);
        const safeId = (0,_utils_js__WEBPACK_IMPORTED_MODULE_4__.sanitizeFileSegment)(blobId);
        node_fs__WEBPACK_IMPORTED_MODULE_0___default().rmSync(node_path__WEBPACK_IMPORTED_MODULE_1___default().join(extensionDir, `${safeId}.json`), { force: true });
        node_fs__WEBPACK_IMPORTED_MODULE_0___default().rmSync(node_path__WEBPACK_IMPORTED_MODULE_1___default().join(extensionDir, `${safeId}.bin`), { force: true });
    }
    listBlobs(user, extensionId) {
        const extensionDir = this.getBlobDir(user, extensionId);
        if (!node_fs__WEBPACK_IMPORTED_MODULE_0___default().existsSync(extensionDir)) {
            return [];
        }
        return node_fs__WEBPACK_IMPORTED_MODULE_0___default().readdirSync(extensionDir)
            .filter(entry => entry.endsWith('.json'))
            .map(entry => (0,_utils_js__WEBPACK_IMPORTED_MODULE_4__.readJsonFile)(node_path__WEBPACK_IMPORTED_MODULE_1___default().join(extensionDir, entry), {}))
            .filter(record => Boolean(record?.id));
    }
    getKvFilePath(user, extensionId) {
        const paths = (0,_store_authority_paths_js__WEBPACK_IMPORTED_MODULE_3__.getUserAuthorityPaths)(user);
        (0,_utils_js__WEBPACK_IMPORTED_MODULE_4__.ensureDir)(paths.kvDir);
        return node_path__WEBPACK_IMPORTED_MODULE_1___default().join(paths.kvDir, `${(0,_utils_js__WEBPACK_IMPORTED_MODULE_4__.sanitizeFileSegment)(extensionId)}.json`);
    }
    getBlobDir(user, extensionId) {
        const paths = (0,_store_authority_paths_js__WEBPACK_IMPORTED_MODULE_3__.getUserAuthorityPaths)(user);
        return node_path__WEBPACK_IMPORTED_MODULE_1___default().join(paths.blobDir, (0,_utils_js__WEBPACK_IMPORTED_MODULE_4__.sanitizeFileSegment)(extensionId));
    }
}


/***/ },

/***/ "./src/store/authority-paths.ts"
/*!**************************************!*\
  !*** ./src/store/authority-paths.ts ***!
  \**************************************/
(__unused_webpack_module, __webpack_exports__, __webpack_require__) {

__webpack_require__.r(__webpack_exports__);
/* harmony export */ __webpack_require__.d(__webpack_exports__, {
/* harmony export */   getGlobalAuthorityPaths: () => (/* binding */ getGlobalAuthorityPaths),
/* harmony export */   getUserAuthorityPaths: () => (/* binding */ getUserAuthorityPaths)
/* harmony export */ });
/* harmony import */ var node_path__WEBPACK_IMPORTED_MODULE_0__ = __webpack_require__(/*! node:path */ "node:path");
/* harmony import */ var node_path__WEBPACK_IMPORTED_MODULE_0___default = /*#__PURE__*/__webpack_require__.n(node_path__WEBPACK_IMPORTED_MODULE_0__);
/* harmony import */ var _constants_js__WEBPACK_IMPORTED_MODULE_1__ = __webpack_require__(/*! ../constants.js */ "./src/constants.ts");


function getUserAuthorityPaths(user) {
    const baseDir = node_path__WEBPACK_IMPORTED_MODULE_0___default().join(user.rootDir, _constants_js__WEBPACK_IMPORTED_MODULE_1__.AUTHORITY_DATA_FOLDER);
    const stateDir = node_path__WEBPACK_IMPORTED_MODULE_0___default().join(baseDir, 'state');
    const auditDir = node_path__WEBPACK_IMPORTED_MODULE_0___default().join(baseDir, 'audit');
    const storageDir = node_path__WEBPACK_IMPORTED_MODULE_0___default().join(baseDir, 'storage');
    const sqlDir = node_path__WEBPACK_IMPORTED_MODULE_0___default().join(baseDir, 'sql');
    const jobsDir = node_path__WEBPACK_IMPORTED_MODULE_0___default().join(baseDir, 'jobs');
    return {
        baseDir,
        stateDir,
        auditDir,
        storageDir,
        sqlDir,
        sqlPrivateDir: node_path__WEBPACK_IMPORTED_MODULE_0___default().join(sqlDir, 'private'),
        kvDir: node_path__WEBPACK_IMPORTED_MODULE_0___default().join(storageDir, 'kv'),
        blobDir: node_path__WEBPACK_IMPORTED_MODULE_0___default().join(storageDir, 'blobs'),
        jobsDir,
        extensionsFile: node_path__WEBPACK_IMPORTED_MODULE_0___default().join(stateDir, 'extensions.json'),
        permissionsFile: node_path__WEBPACK_IMPORTED_MODULE_0___default().join(stateDir, 'permissions.json'),
        policiesFile: node_path__WEBPACK_IMPORTED_MODULE_0___default().join(stateDir, 'policies.json'),
        jobsFile: node_path__WEBPACK_IMPORTED_MODULE_0___default().join(jobsDir, 'jobs.json'),
        permissionsAuditFile: node_path__WEBPACK_IMPORTED_MODULE_0___default().join(auditDir, 'permissions.jsonl'),
        usageAuditFile: node_path__WEBPACK_IMPORTED_MODULE_0___default().join(auditDir, 'usage.jsonl'),
        errorsAuditFile: node_path__WEBPACK_IMPORTED_MODULE_0___default().join(auditDir, 'errors.jsonl'),
    };
}
function getGlobalAuthorityPaths() {
    const globalState = globalThis;
    const dataRoot = String(globalState.DATA_ROOT ?? process.cwd());
    const baseDir = node_path__WEBPACK_IMPORTED_MODULE_0___default().join(dataRoot, '_authority-global', 'authority');
    const stateDir = node_path__WEBPACK_IMPORTED_MODULE_0___default().join(baseDir, 'state');
    return {
        baseDir,
        stateDir,
        policiesFile: node_path__WEBPACK_IMPORTED_MODULE_0___default().join(stateDir, 'policies.json'),
    };
}


/***/ },

/***/ "./src/utils.ts"
/*!**********************!*\
  !*** ./src/utils.ts ***!
  \**********************/
(__unused_webpack_module, __webpack_exports__, __webpack_require__) {

__webpack_require__.r(__webpack_exports__);
/* harmony export */ __webpack_require__.d(__webpack_exports__, {
/* harmony export */   appendJsonl: () => (/* binding */ appendJsonl),
/* harmony export */   asErrorMessage: () => (/* binding */ asErrorMessage),
/* harmony export */   atomicWriteJson: () => (/* binding */ atomicWriteJson),
/* harmony export */   buildPermissionDescriptor: () => (/* binding */ buildPermissionDescriptor),
/* harmony export */   ensureDir: () => (/* binding */ ensureDir),
/* harmony export */   getSessionToken: () => (/* binding */ getSessionToken),
/* harmony export */   getUserContext: () => (/* binding */ getUserContext),
/* harmony export */   normalizeHostname: () => (/* binding */ normalizeHostname),
/* harmony export */   nowIso: () => (/* binding */ nowIso),
/* harmony export */   randomToken: () => (/* binding */ randomToken),
/* harmony export */   readJsonFile: () => (/* binding */ readJsonFile),
/* harmony export */   safeJsonParse: () => (/* binding */ safeJsonParse),
/* harmony export */   sanitizeFileSegment: () => (/* binding */ sanitizeFileSegment),
/* harmony export */   tailJsonl: () => (/* binding */ tailJsonl)
/* harmony export */ });
/* harmony import */ var node_crypto__WEBPACK_IMPORTED_MODULE_0__ = __webpack_require__(/*! node:crypto */ "node:crypto");
/* harmony import */ var node_crypto__WEBPACK_IMPORTED_MODULE_0___default = /*#__PURE__*/__webpack_require__.n(node_crypto__WEBPACK_IMPORTED_MODULE_0__);
/* harmony import */ var node_fs__WEBPACK_IMPORTED_MODULE_1__ = __webpack_require__(/*! node:fs */ "node:fs");
/* harmony import */ var node_fs__WEBPACK_IMPORTED_MODULE_1___default = /*#__PURE__*/__webpack_require__.n(node_fs__WEBPACK_IMPORTED_MODULE_1__);
/* harmony import */ var node_path__WEBPACK_IMPORTED_MODULE_2__ = __webpack_require__(/*! node:path */ "node:path");
/* harmony import */ var node_path__WEBPACK_IMPORTED_MODULE_2___default = /*#__PURE__*/__webpack_require__.n(node_path__WEBPACK_IMPORTED_MODULE_2__);
/* harmony import */ var _constants_js__WEBPACK_IMPORTED_MODULE_3__ = __webpack_require__(/*! ./constants.js */ "./src/constants.ts");




function nowIso() {
    return new Date().toISOString();
}
function randomToken() {
    return node_crypto__WEBPACK_IMPORTED_MODULE_0___default().randomUUID();
}
function safeJsonParse(value, fallback) {
    try {
        return JSON.parse(value);
    }
    catch {
        return fallback;
    }
}
function ensureDir(dirPath) {
    node_fs__WEBPACK_IMPORTED_MODULE_1___default().mkdirSync(dirPath, { recursive: true });
}
function atomicWriteJson(filePath, value) {
    ensureDir(node_path__WEBPACK_IMPORTED_MODULE_2___default().dirname(filePath));
    const tempPath = `${filePath}.${node_crypto__WEBPACK_IMPORTED_MODULE_0___default().randomUUID()}.tmp`;
    node_fs__WEBPACK_IMPORTED_MODULE_1___default().writeFileSync(tempPath, JSON.stringify(value, null, 2), 'utf8');
    node_fs__WEBPACK_IMPORTED_MODULE_1___default().renameSync(tempPath, filePath);
}
function readJsonFile(filePath, fallback) {
    if (!node_fs__WEBPACK_IMPORTED_MODULE_1___default().existsSync(filePath)) {
        return fallback;
    }
    return safeJsonParse(node_fs__WEBPACK_IMPORTED_MODULE_1___default().readFileSync(filePath, 'utf8'), fallback);
}
function appendJsonl(filePath, value) {
    ensureDir(node_path__WEBPACK_IMPORTED_MODULE_2___default().dirname(filePath));
    node_fs__WEBPACK_IMPORTED_MODULE_1___default().appendFileSync(filePath, `${JSON.stringify(value)}\n`, 'utf8');
}
function tailJsonl(filePath, limit) {
    if (!node_fs__WEBPACK_IMPORTED_MODULE_1___default().existsSync(filePath)) {
        return [];
    }
    const lines = node_fs__WEBPACK_IMPORTED_MODULE_1___default().readFileSync(filePath, 'utf8')
        .split(/\r?\n/)
        .filter(Boolean)
        .slice(-limit);
    return lines.map(line => safeJsonParse(line, null)).filter(Boolean);
}
function sanitizeFileSegment(input) {
    return input.replace(/[^a-zA-Z0-9._-]/g, '_');
}
function getUserContext(request) {
    if (!request.user) {
        throw new Error('Unauthorized');
    }
    return {
        handle: request.user.profile.handle,
        isAdmin: Boolean(request.user.profile.admin),
        rootDir: request.user.directories.root,
    };
}
function getSessionToken(request) {
    const headerValue = request.headers[_constants_js__WEBPACK_IMPORTED_MODULE_3__.SESSION_HEADER];
    if (typeof headerValue === 'string' && headerValue.trim()) {
        return headerValue.trim();
    }
    const queryValue = request.query?.[_constants_js__WEBPACK_IMPORTED_MODULE_3__.SESSION_QUERY];
    if (typeof queryValue === 'string' && queryValue.trim()) {
        return queryValue.trim();
    }
    return null;
}
function normalizeHostname(input) {
    const url = new URL(input);
    return url.hostname.toLowerCase();
}
function buildPermissionDescriptor(resource, target) {
    if (!_constants_js__WEBPACK_IMPORTED_MODULE_3__.SUPPORTED_RESOURCES.includes(resource)) {
        throw new Error(`Unsupported resource: ${resource}`);
    }
    const normalizedTarget = target && target.trim() ? target.trim() : '*';
    return {
        key: `${resource}:${normalizedTarget}`,
        resource,
        target: normalizedTarget,
        riskLevel: _constants_js__WEBPACK_IMPORTED_MODULE_3__.RESOURCE_RISK[resource],
    };
}
function asErrorMessage(error) {
    if (error instanceof Error) {
        return error.message;
    }
    return String(error);
}


/***/ },

/***/ "node:child_process"
/*!*************************************!*\
  !*** external "node:child_process" ***!
  \*************************************/
(module) {

module.exports = require("node:child_process");

/***/ },

/***/ "node:crypto"
/*!******************************!*\
  !*** external "node:crypto" ***!
  \******************************/
(module) {

module.exports = require("node:crypto");

/***/ },

/***/ "node:fs"
/*!**************************!*\
  !*** external "node:fs" ***!
  \**************************/
(module) {

module.exports = require("node:fs");

/***/ },

/***/ "node:net"
/*!***************************!*\
  !*** external "node:net" ***!
  \***************************/
(module) {

module.exports = require("node:net");

/***/ },

/***/ "node:path"
/*!****************************!*\
  !*** external "node:path" ***!
  \****************************/
(module) {

module.exports = require("node:path");

/***/ },

/***/ "node:process"
/*!*******************************!*\
  !*** external "node:process" ***!
  \*******************************/
(module) {

module.exports = require("node:process");

/***/ }

/******/ 	});
/************************************************************************/
/******/ 	// The module cache
/******/ 	var __webpack_module_cache__ = {};
/******/ 	
/******/ 	// The require function
/******/ 	function __webpack_require__(moduleId) {
/******/ 		// Check if module is in cache
/******/ 		var cachedModule = __webpack_module_cache__[moduleId];
/******/ 		if (cachedModule !== undefined) {
/******/ 			return cachedModule.exports;
/******/ 		}
/******/ 		// Create a new module (and put it into the cache)
/******/ 		var module = __webpack_module_cache__[moduleId] = {
/******/ 			// no module.id needed
/******/ 			// no module.loaded needed
/******/ 			exports: {}
/******/ 		};
/******/ 	
/******/ 		// Execute the module function
/******/ 		if (!(moduleId in __webpack_modules__)) {
/******/ 			delete __webpack_module_cache__[moduleId];
/******/ 			var e = new Error("Cannot find module '" + moduleId + "'");
/******/ 			e.code = 'MODULE_NOT_FOUND';
/******/ 			throw e;
/******/ 		}
/******/ 		__webpack_modules__[moduleId](module, module.exports, __webpack_require__);
/******/ 	
/******/ 		// Return the exports of the module
/******/ 		return module.exports;
/******/ 	}
/******/ 	
/************************************************************************/
/******/ 	/* webpack/runtime/compat get default export */
/******/ 	(() => {
/******/ 		// getDefaultExport function for compatibility with non-harmony modules
/******/ 		__webpack_require__.n = (module) => {
/******/ 			var getter = module && module.__esModule ?
/******/ 				() => (module['default']) :
/******/ 				() => (module);
/******/ 			__webpack_require__.d(getter, { a: getter });
/******/ 			return getter;
/******/ 		};
/******/ 	})();
/******/ 	
/******/ 	/* webpack/runtime/define property getters */
/******/ 	(() => {
/******/ 		// define getter functions for harmony exports
/******/ 		__webpack_require__.d = (exports, definition) => {
/******/ 			for(var key in definition) {
/******/ 				if(__webpack_require__.o(definition, key) && !__webpack_require__.o(exports, key)) {
/******/ 					Object.defineProperty(exports, key, { enumerable: true, get: definition[key] });
/******/ 				}
/******/ 			}
/******/ 		};
/******/ 	})();
/******/ 	
/******/ 	/* webpack/runtime/hasOwnProperty shorthand */
/******/ 	(() => {
/******/ 		__webpack_require__.o = (obj, prop) => (Object.prototype.hasOwnProperty.call(obj, prop))
/******/ 	})();
/******/ 	
/******/ 	/* webpack/runtime/make namespace object */
/******/ 	(() => {
/******/ 		// define __esModule on exports
/******/ 		__webpack_require__.r = (exports) => {
/******/ 			if(typeof Symbol !== 'undefined' && Symbol.toStringTag) {
/******/ 				Object.defineProperty(exports, Symbol.toStringTag, { value: 'Module' });
/******/ 			}
/******/ 			Object.defineProperty(exports, '__esModule', { value: true });
/******/ 		};
/******/ 	})();
/******/ 	
/************************************************************************/
var __webpack_exports__ = {};
// This entry needs to be wrapped in an IIFE because it needs to be isolated against other modules in the chunk.
(() => {
/*!**********************!*\
  !*** ./src/index.ts ***!
  \**********************/
__webpack_require__.r(__webpack_exports__);
/* harmony export */ __webpack_require__.d(__webpack_exports__, {
/* harmony export */   exit: () => (/* binding */ exit),
/* harmony export */   info: () => (/* binding */ info),
/* harmony export */   init: () => (/* binding */ init)
/* harmony export */ });
/* harmony import */ var _constants_js__WEBPACK_IMPORTED_MODULE_0__ = __webpack_require__(/*! ./constants.js */ "./src/constants.ts");
/* harmony import */ var _runtime_js__WEBPACK_IMPORTED_MODULE_1__ = __webpack_require__(/*! ./runtime.js */ "./src/runtime.ts");
/* harmony import */ var _routes_js__WEBPACK_IMPORTED_MODULE_2__ = __webpack_require__(/*! ./routes.js */ "./src/routes.ts");



const info = {
    id: _constants_js__WEBPACK_IMPORTED_MODULE_0__.AUTHORITY_PLUGIN_ID,
    name: 'ST Authority',
    description: 'Authority security center and delegation platform for SillyTavern extensions.',
};
let runtime = null;
async function init(router) {
    runtime ??= (0,_runtime_js__WEBPACK_IMPORTED_MODULE_1__.createAuthorityRuntime)();
    (0,_routes_js__WEBPACK_IMPORTED_MODULE_2__.registerRoutes)(router, runtime);
    void runtime.install.bootstrap();
    void runtime.core.start();
}
async function exit() {
    if (!runtime) {
        return;
    }
    await runtime.core.stop();
    runtime = null;
}

})();

module.exports = __webpack_exports__;
/******/ })()
;
//# sourceMappingURL=index.cjs.map
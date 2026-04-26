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
/* harmony export */   DATA_TRANSFER_CHUNK_BYTES: () => (/* binding */ DATA_TRANSFER_CHUNK_BYTES),
/* harmony export */   DATA_TRANSFER_INLINE_THRESHOLD_BYTES: () => (/* binding */ DATA_TRANSFER_INLINE_THRESHOLD_BYTES),
/* harmony export */   DEFAULT_POLICY_STATUS: () => (/* binding */ DEFAULT_POLICY_STATUS),
/* harmony export */   MAX_AUDIT_LINES: () => (/* binding */ MAX_AUDIT_LINES),
/* harmony export */   MAX_BLOB_BYTES: () => (/* binding */ MAX_BLOB_BYTES),
/* harmony export */   MAX_DATA_TRANSFER_BYTES: () => (/* binding */ MAX_DATA_TRANSFER_BYTES),
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
const MAX_BLOB_BYTES = 16 * 1024 * 1024;
const MAX_HTTP_BODY_BYTES = 512 * 1024;
const MAX_HTTP_RESPONSE_BYTES = 2 * 1024 * 1024;
const MAX_AUDIT_LINES = 200;
const DATA_TRANSFER_CHUNK_BYTES = 256 * 1024;
const DATA_TRANSFER_INLINE_THRESHOLD_BYTES = 256 * 1024;
const MAX_DATA_TRANSFER_BYTES = MAX_BLOB_BYTES;
const SUPPORTED_RESOURCES = [
    'storage.kv',
    'storage.blob',
    'fs.private',
    'sql.private',
    'trivium.private',
    'http.fetch',
    'jobs.background',
    'events.stream',
];
const RESOURCE_RISK = {
    'storage.kv': 'low',
    'storage.blob': 'low',
    'fs.private': 'medium',
    'sql.private': 'medium',
    'trivium.private': 'high',
    'http.fetch': 'medium',
    'jobs.background': 'medium',
    'events.stream': 'low',
};
const DEFAULT_POLICY_STATUS = {
    'storage.kv': 'prompt',
    'storage.blob': 'prompt',
    'fs.private': 'prompt',
    'sql.private': 'prompt',
    'trivium.private': 'prompt',
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
    core;
    constructor(core) {
        this.core = core;
    }
    clients = new Set();
    register(dbPath, userHandle, channel, response) {
        const client = {
            dbPath,
            userHandle,
            channel,
            response,
            cursor: null,
            polling: false,
            timer: null,
        };
        this.clients.add(client);
        this.emitToClient(client, 'authority.connected', {
            timestamp: (0,_utils_js__WEBPACK_IMPORTED_MODULE_0__.nowIso)(),
            ...(channel.startsWith('extension:') ? { extensionId: channel.slice('extension:'.length) } : { channel }),
        });
        void this.pollClient(client);
        client.timer = setInterval(() => {
            void this.pollClient(client);
        }, 500);
        return () => {
            if (client.timer) {
                clearInterval(client.timer);
            }
            this.clients.delete(client);
        };
    }
    async pollClient(client) {
        if (client.polling || !this.clients.has(client)) {
            return;
        }
        client.polling = true;
        try {
            const { events, cursor } = await this.core.pollControlEvents(client.dbPath, {
                userHandle: client.userHandle,
                channel: client.channel,
                ...(client.cursor !== null ? { afterId: client.cursor } : {}),
            });
            client.cursor = cursor;
            for (const event of events) {
                this.emitToClient(client, event.name, event.payload);
                client.cursor = event.id;
            }
        }
        catch {
            return;
        }
        finally {
            client.polling = false;
        }
    }
    emitToClient(client, eventName, payload) {
        client.response.write(`event: ${eventName}\n`);
        client.response.write(`data: ${JSON.stringify(payload ?? null)}\n\n`);
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
/* harmony import */ var node_fs__WEBPACK_IMPORTED_MODULE_0__ = __webpack_require__(/*! node:fs */ "node:fs");
/* harmony import */ var node_fs__WEBPACK_IMPORTED_MODULE_0___default = /*#__PURE__*/__webpack_require__.n(node_fs__WEBPACK_IMPORTED_MODULE_0__);
/* harmony import */ var node_path__WEBPACK_IMPORTED_MODULE_1__ = __webpack_require__(/*! node:path */ "node:path");
/* harmony import */ var node_path__WEBPACK_IMPORTED_MODULE_1___default = /*#__PURE__*/__webpack_require__.n(node_path__WEBPACK_IMPORTED_MODULE_1__);
/* harmony import */ var _constants_js__WEBPACK_IMPORTED_MODULE_2__ = __webpack_require__(/*! ./constants.js */ "./src/constants.ts");
/* harmony import */ var _runtime_js__WEBPACK_IMPORTED_MODULE_3__ = __webpack_require__(/*! ./runtime.js */ "./src/runtime.ts");
/* harmony import */ var _store_authority_paths_js__WEBPACK_IMPORTED_MODULE_4__ = __webpack_require__(/*! ./store/authority-paths.js */ "./src/store/authority-paths.ts");
/* harmony import */ var _utils_js__WEBPACK_IMPORTED_MODULE_5__ = __webpack_require__(/*! ./utils.js */ "./src/utils.ts");






function ok(res, data) {
    res.json(data);
}
function fail(runtime, req, res, extensionId, error) {
    const message = (0,_utils_js__WEBPACK_IMPORTED_MODULE_5__.asErrorMessage)(error);
    try {
        const user = (0,_utils_js__WEBPACK_IMPORTED_MODULE_5__.getUserContext)(req);
        void runtime.audit.logError(user, extensionId, message).catch(() => undefined);
    }
    catch {
        // ignore errors raised before auth is available
    }
    res.status(400).json({ error: message });
}
function parseAdminUpdateAction(value) {
    return value === 'redeploy-sdk' ? 'redeploy-sdk' : 'git-pull';
}
function getSqlDatabaseName(value) {
    return typeof value === 'string' && value.trim() ? value.trim() : 'default';
}
function resolvePrivateSqlDatabaseDir(user, extensionId) {
    const paths = (0,_store_authority_paths_js__WEBPACK_IMPORTED_MODULE_4__.getUserAuthorityPaths)(user);
    return node_path__WEBPACK_IMPORTED_MODULE_1___default().join(paths.sqlPrivateDir, (0,_utils_js__WEBPACK_IMPORTED_MODULE_5__.sanitizeFileSegment)(extensionId));
}
function resolvePrivateSqlDatabasePath(user, extensionId, databaseName) {
    return node_path__WEBPACK_IMPORTED_MODULE_1___default().join(resolvePrivateSqlDatabaseDir(user, extensionId), `${(0,_utils_js__WEBPACK_IMPORTED_MODULE_5__.sanitizeFileSegment)(databaseName)}.sqlite`);
}
function getTriviumDatabaseName(value) {
    return typeof value === 'string' && value.trim() ? value.trim() : 'default';
}
function decodeHttpResponseBody(bytes, encoding) {
    if (encoding === 'base64') {
        return bytes.toString('base64');
    }
    return bytes.toString('utf8');
}
function resolvePrivateTriviumDatabaseDir(user, extensionId) {
    const paths = (0,_store_authority_paths_js__WEBPACK_IMPORTED_MODULE_4__.getUserAuthorityPaths)(user);
    return node_path__WEBPACK_IMPORTED_MODULE_1___default().join(paths.triviumPrivateDir, (0,_utils_js__WEBPACK_IMPORTED_MODULE_5__.sanitizeFileSegment)(extensionId));
}
function resolvePrivateTriviumDatabasePath(user, extensionId, databaseName) {
    return node_path__WEBPACK_IMPORTED_MODULE_1___default().join(resolvePrivateTriviumDatabaseDir(user, extensionId), `${(0,_utils_js__WEBPACK_IMPORTED_MODULE_5__.sanitizeFileSegment)(databaseName)}.tdb`);
}
function readTriviumDimension(filePath) {
    try {
        const handle = node_fs__WEBPACK_IMPORTED_MODULE_0___default().openSync(filePath, 'r');
        try {
            const header = Buffer.alloc(10);
            const bytesRead = node_fs__WEBPACK_IMPORTED_MODULE_0___default().readSync(handle, header, 0, 10, 0);
            if (bytesRead < 10 || header.toString('utf8', 0, 4) !== 'TVDB') {
                return null;
            }
            return header.readUInt32LE(6);
        }
        finally {
            node_fs__WEBPACK_IMPORTED_MODULE_0___default().closeSync(handle);
        }
    }
    catch {
        return null;
    }
}
function buildTriviumDatabaseRecord(filePath, entryName) {
    const mainStats = node_fs__WEBPACK_IMPORTED_MODULE_0___default().statSync(filePath);
    const walPath = `${filePath}.wal`;
    const vecPath = `${filePath}.vec`;
    const walStats = node_fs__WEBPACK_IMPORTED_MODULE_0___default().existsSync(walPath) ? node_fs__WEBPACK_IMPORTED_MODULE_0___default().statSync(walPath) : null;
    const vecStats = node_fs__WEBPACK_IMPORTED_MODULE_0___default().existsSync(vecPath) ? node_fs__WEBPACK_IMPORTED_MODULE_0___default().statSync(vecPath) : null;
    const storageMode = vecStats ? 'mmap' : 'rom';
    const timestamps = [mainStats, walStats, vecStats]
        .filter((value) => value !== null)
        .map(stats => stats.mtime.toISOString())
        .sort((left, right) => left.localeCompare(right));
    return {
        name: entryName.slice(0, -'.tdb'.length),
        fileName: entryName,
        dim: readTriviumDimension(filePath),
        dtype: null,
        syncMode: null,
        storageMode,
        sizeBytes: mainStats.size,
        walSizeBytes: walStats?.size ?? 0,
        vecSizeBytes: vecStats?.size ?? 0,
        totalSizeBytes: mainStats.size + (walStats?.size ?? 0) + (vecStats?.size ?? 0),
        updatedAt: timestamps.at(-1) ?? null,
    };
}
function listPrivateTriviumDatabases(user, extensionId) {
    const databaseDir = resolvePrivateTriviumDatabaseDir(user, extensionId);
    if (!node_fs__WEBPACK_IMPORTED_MODULE_0___default().existsSync(databaseDir)) {
        return { databases: [] };
    }
    const databases = node_fs__WEBPACK_IMPORTED_MODULE_0___default().readdirSync(databaseDir, { withFileTypes: true })
        .filter(entry => entry.isFile() && entry.name.endsWith('.tdb'))
        .map(entry => buildTriviumDatabaseRecord(node_path__WEBPACK_IMPORTED_MODULE_1___default().join(databaseDir, entry.name), entry.name))
        .sort((left, right) => (right.updatedAt ?? '').localeCompare(left.updatedAt ?? ''));
    return { databases };
}
function listPrivateSqlDatabases(user, extensionId) {
    const databaseDir = resolvePrivateSqlDatabaseDir(user, extensionId);
    if (!node_fs__WEBPACK_IMPORTED_MODULE_0___default().existsSync(databaseDir)) {
        return { databases: [] };
    }
    const databases = node_fs__WEBPACK_IMPORTED_MODULE_0___default().readdirSync(databaseDir, { withFileTypes: true })
        .filter(entry => entry.isFile() && entry.name.endsWith('.sqlite'))
        .map(entry => {
        const filePath = node_path__WEBPACK_IMPORTED_MODULE_1___default().join(databaseDir, entry.name);
        const stats = node_fs__WEBPACK_IMPORTED_MODULE_0___default().statSync(filePath);
        return {
            name: entry.name.slice(0, -'.sqlite'.length),
            fileName: entry.name,
            sizeBytes: stats.size,
            updatedAt: stats.mtime.toISOString(),
        };
    })
        .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt));
    return { databases };
}
function previewSqlStatement(statement) {
    const normalized = statement.replace(/\s+/g, ' ').trim();
    return normalized.length > 160 ? `${normalized.slice(0, 157)}...` : normalized;
}
function summarizeBlobRecords(records) {
    return {
        count: records.length,
        totalSizeBytes: records.reduce((sum, record) => sum + record.size, 0),
    };
}
function summarizeDatabases(databases) {
    return {
        count: databases.length,
        totalSizeBytes: databases.reduce((sum, record) => sum + record.sizeBytes, 0),
    };
}
function summarizeTriviumDatabases(databases) {
    return {
        count: databases.length,
        totalSizeBytes: databases.reduce((sum, record) => sum + record.totalSizeBytes, 0),
    };
}
async function buildExtensionStorageSummary(runtime, user, extensionId, sqlDatabases = listPrivateSqlDatabases(user, extensionId).databases, triviumDatabases = listPrivateTriviumDatabases(user, extensionId).databases) {
    const [kvEntries, blobs, files] = await Promise.all([
        runtime.storage.listKv(user, extensionId),
        runtime.storage.listBlobs(user, extensionId),
        runtime.files.getUsageSummary(user, extensionId),
    ]);
    const blobSummary = summarizeBlobRecords(blobs);
    const sqlDatabaseSummary = summarizeDatabases(sqlDatabases);
    const triviumDatabaseSummary = summarizeTriviumDatabases(triviumDatabases);
    return {
        kvEntries: Object.keys(kvEntries).length,
        blobCount: blobSummary.count,
        blobBytes: blobSummary.totalSizeBytes,
        databaseCount: sqlDatabaseSummary.count + triviumDatabaseSummary.count,
        databaseBytes: sqlDatabaseSummary.totalSizeBytes + triviumDatabaseSummary.totalSizeBytes,
        sqlDatabaseCount: sqlDatabaseSummary.count,
        sqlDatabaseBytes: sqlDatabaseSummary.totalSizeBytes,
        triviumDatabaseCount: triviumDatabaseSummary.count,
        triviumDatabaseBytes: triviumDatabaseSummary.totalSizeBytes,
        files,
    };
}
function registerRoutes(router, runtime = (0,_runtime_js__WEBPACK_IMPORTED_MODULE_3__.createAuthorityRuntime)()) {
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
            coreBundledVersion: install.coreBundledVersion,
            coreArtifactPlatform: install.coreArtifactPlatform,
            coreArtifactPlatforms: install.coreArtifactPlatforms,
            coreArtifactHash: install.coreArtifactHash,
            coreBinarySha256: install.coreBinarySha256,
            coreVerified: install.coreVerified,
            coreMessage: install.coreMessage,
            installStatus: install.installStatus,
            installMessage: install.installMessage,
            core,
        });
    });
    router.post('/session/init', async (req, res) => {
        try {
            const user = (0,_utils_js__WEBPACK_IMPORTED_MODULE_5__.getUserContext)(req);
            const config = req.body;
            const session = await runtime.sessions.createSession(user, config);
            const grants = await runtime.permissions.listPersistentGrants(user, session.extension.id);
            const policies = await runtime.permissions.getPolicyEntries(user, session.extension.id);
            await runtime.audit.logUsage(user, session.extension.id, 'Session initialized');
            ok(res, runtime.sessions.buildSessionResponse(session, grants, policies));
        }
        catch (error) {
            fail(runtime, req, res, 'third-party/st-authority-sdk', error);
        }
    });
    router.get('/session/current', async (req, res) => {
        try {
            const user = (0,_utils_js__WEBPACK_IMPORTED_MODULE_5__.getUserContext)(req);
            const session = await runtime.sessions.assertSession((0,_utils_js__WEBPACK_IMPORTED_MODULE_5__.getSessionToken)(req), user);
            ok(res, runtime.sessions.buildSessionResponse(session, await runtime.permissions.listPersistentGrants(user, session.extension.id), await runtime.permissions.getPolicyEntries(user, session.extension.id)));
        }
        catch (error) {
            fail(runtime, req, res, 'third-party/st-authority-sdk', error);
        }
    });
    router.post('/permissions/evaluate', async (req, res) => {
        try {
            const user = (0,_utils_js__WEBPACK_IMPORTED_MODULE_5__.getUserContext)(req);
            const session = await runtime.sessions.assertSession((0,_utils_js__WEBPACK_IMPORTED_MODULE_5__.getSessionToken)(req), user);
            ok(res, await runtime.permissions.evaluate(user, session, req.body));
        }
        catch (error) {
            fail(runtime, req, res, 'third-party/st-authority-sdk', error);
        }
    });
    router.post('/permissions/resolve', async (req, res) => {
        try {
            const user = (0,_utils_js__WEBPACK_IMPORTED_MODULE_5__.getUserContext)(req);
            const session = await runtime.sessions.assertSession((0,_utils_js__WEBPACK_IMPORTED_MODULE_5__.getSessionToken)(req), user);
            const payload = req.body;
            const grant = await runtime.permissions.resolve(user, session, payload, payload.choice);
            await runtime.audit.logPermission(user, session.extension.id, 'Permission resolved', {
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
            const user = (0,_utils_js__WEBPACK_IMPORTED_MODULE_5__.getUserContext)(req);
            const list = await Promise.all((await runtime.extensions.listExtensions(user)).map(async (extension) => {
                const grants = await runtime.permissions.listPersistentGrants(user, extension.id);
                const sqlDatabases = listPrivateSqlDatabases(user, extension.id).databases;
                const triviumDatabases = listPrivateTriviumDatabases(user, extension.id).databases;
                return {
                    ...extension,
                    grantedCount: grants.filter(grant => grant.status === 'granted').length,
                    deniedCount: grants.filter(grant => grant.status === 'denied').length,
                    storage: await buildExtensionStorageSummary(runtime, user, extension.id, sqlDatabases, triviumDatabases),
                };
            }));
            ok(res, list);
        }
        catch (error) {
            fail(runtime, req, res, 'third-party/st-authority-sdk', error);
        }
    });
    router.get('/extensions/:id', async (req, res) => {
        try {
            const user = (0,_utils_js__WEBPACK_IMPORTED_MODULE_5__.getUserContext)(req);
            const extensionId = decodeURIComponent(req.params?.id ?? '');
            const extension = await runtime.extensions.getExtension(user, extensionId);
            if (!extension) {
                throw new Error('Extension not found');
            }
            const databases = listPrivateSqlDatabases(user, extensionId).databases;
            const triviumDatabases = listPrivateTriviumDatabases(user, extensionId).databases;
            ok(res, {
                extension,
                grants: await runtime.permissions.listPersistentGrants(user, extensionId),
                policies: await runtime.permissions.getPolicyEntries(user, extensionId),
                activity: await runtime.audit.getRecentActivity(user, extensionId),
                jobs: await runtime.jobs.list(user, extensionId),
                databases,
                triviumDatabases,
                storage: await buildExtensionStorageSummary(runtime, user, extensionId, databases, triviumDatabases),
            });
        }
        catch (error) {
            fail(runtime, req, res, decodeURIComponent(req.params?.id ?? 'unknown'), error);
        }
    });
    router.post('/extensions/:id/grants/reset', async (req, res) => {
        try {
            const user = (0,_utils_js__WEBPACK_IMPORTED_MODULE_5__.getUserContext)(req);
            const extensionId = decodeURIComponent(req.params?.id ?? '');
            await runtime.permissions.resetPersistentGrants(user, extensionId, req.body?.keys);
            await runtime.audit.logPermission(user, extensionId, 'Persistent grants reset', {
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
            const user = (0,_utils_js__WEBPACK_IMPORTED_MODULE_5__.getUserContext)(req);
            const session = await runtime.sessions.assertSession((0,_utils_js__WEBPACK_IMPORTED_MODULE_5__.getSessionToken)(req), user);
            if (!await runtime.permissions.authorize(user, session, { resource: 'storage.kv' })) {
                throw new Error('Permission not granted: storage.kv');
            }
            ok(res, { value: await runtime.storage.getKv(user, session.extension.id, String(req.body?.key ?? '')) });
        }
        catch (error) {
            fail(runtime, req, res, 'storage.kv', error);
        }
    });
    router.post('/storage/kv/set', async (req, res) => {
        try {
            const user = (0,_utils_js__WEBPACK_IMPORTED_MODULE_5__.getUserContext)(req);
            const session = await runtime.sessions.assertSession((0,_utils_js__WEBPACK_IMPORTED_MODULE_5__.getSessionToken)(req), user);
            if (!await runtime.permissions.authorize(user, session, { resource: 'storage.kv' })) {
                throw new Error('Permission not granted: storage.kv');
            }
            await runtime.storage.setKv(user, session.extension.id, String(req.body?.key ?? ''), req.body?.value);
            await runtime.audit.logUsage(user, session.extension.id, 'KV set', { key: req.body?.key });
            ok(res, { ok: true });
        }
        catch (error) {
            fail(runtime, req, res, 'storage.kv', error);
        }
    });
    router.post('/storage/kv/delete', async (req, res) => {
        try {
            const user = (0,_utils_js__WEBPACK_IMPORTED_MODULE_5__.getUserContext)(req);
            const session = await runtime.sessions.assertSession((0,_utils_js__WEBPACK_IMPORTED_MODULE_5__.getSessionToken)(req), user);
            if (!await runtime.permissions.authorize(user, session, { resource: 'storage.kv' })) {
                throw new Error('Permission not granted: storage.kv');
            }
            await runtime.storage.deleteKv(user, session.extension.id, String(req.body?.key ?? ''));
            ok(res, { ok: true });
        }
        catch (error) {
            fail(runtime, req, res, 'storage.kv', error);
        }
    });
    router.post('/storage/kv/list', async (req, res) => {
        try {
            const user = (0,_utils_js__WEBPACK_IMPORTED_MODULE_5__.getUserContext)(req);
            const session = await runtime.sessions.assertSession((0,_utils_js__WEBPACK_IMPORTED_MODULE_5__.getSessionToken)(req), user);
            if (!await runtime.permissions.authorize(user, session, { resource: 'storage.kv' })) {
                throw new Error('Permission not granted: storage.kv');
            }
            ok(res, { entries: await runtime.storage.listKv(user, session.extension.id) });
        }
        catch (error) {
            fail(runtime, req, res, 'storage.kv', error);
        }
    });
    router.post('/transfers/init', async (req, res) => {
        try {
            const user = (0,_utils_js__WEBPACK_IMPORTED_MODULE_5__.getUserContext)(req);
            const session = await runtime.sessions.assertSession((0,_utils_js__WEBPACK_IMPORTED_MODULE_5__.getSessionToken)(req), user);
            const payload = (req.body ?? {});
            if (payload.resource !== 'storage.blob' && payload.resource !== 'fs.private' && payload.resource !== 'http.fetch') {
                throw new Error(`Unsupported transfer resource: ${String(payload.resource)}`);
            }
            if (payload.resource !== 'http.fetch' && !await runtime.permissions.authorize(user, session, { resource: payload.resource })) {
                throw new Error(`Permission not granted: ${payload.resource}`);
            }
            ok(res, await runtime.transfers.init(user, session.extension.id, payload));
        }
        catch (error) {
            fail(runtime, req, res, 'third-party/st-authority-sdk', error);
        }
    });
    router.post('/transfers/:id/append', async (req, res) => {
        try {
            const user = (0,_utils_js__WEBPACK_IMPORTED_MODULE_5__.getUserContext)(req);
            const session = await runtime.sessions.assertSession((0,_utils_js__WEBPACK_IMPORTED_MODULE_5__.getSessionToken)(req), user);
            const payload = (req.body ?? {});
            ok(res, await runtime.transfers.append(user, session.extension.id, String(req.params?.id ?? ''), payload));
        }
        catch (error) {
            fail(runtime, req, res, 'third-party/st-authority-sdk', error);
        }
    });
    router.post('/transfers/:id/read', async (req, res) => {
        try {
            const user = (0,_utils_js__WEBPACK_IMPORTED_MODULE_5__.getUserContext)(req);
            const session = await runtime.sessions.assertSession((0,_utils_js__WEBPACK_IMPORTED_MODULE_5__.getSessionToken)(req), user);
            const payload = (req.body ?? {});
            ok(res, await runtime.transfers.read(user, session.extension.id, String(req.params?.id ?? ''), payload));
        }
        catch (error) {
            fail(runtime, req, res, 'third-party/st-authority-sdk', error);
        }
    });
    router.post('/transfers/:id/discard', async (req, res) => {
        try {
            const user = (0,_utils_js__WEBPACK_IMPORTED_MODULE_5__.getUserContext)(req);
            const session = await runtime.sessions.assertSession((0,_utils_js__WEBPACK_IMPORTED_MODULE_5__.getSessionToken)(req), user);
            await runtime.transfers.discard(user, session.extension.id, String(req.params?.id ?? ''));
            ok(res, { ok: true });
        }
        catch (error) {
            fail(runtime, req, res, 'third-party/st-authority-sdk', error);
        }
    });
    router.post('/storage/blob/put', async (req, res) => {
        try {
            const user = (0,_utils_js__WEBPACK_IMPORTED_MODULE_5__.getUserContext)(req);
            const session = await runtime.sessions.assertSession((0,_utils_js__WEBPACK_IMPORTED_MODULE_5__.getSessionToken)(req), user);
            if (!await runtime.permissions.authorize(user, session, { resource: 'storage.blob' })) {
                throw new Error('Permission not granted: storage.blob');
            }
            const record = await runtime.storage.putBlob(user, session.extension.id, String(req.body?.name ?? 'blob'), String(req.body?.content ?? ''), req.body?.encoding, req.body?.contentType);
            await runtime.audit.logUsage(user, session.extension.id, 'Blob stored', { id: record.id });
            ok(res, record);
        }
        catch (error) {
            fail(runtime, req, res, 'storage.blob', error);
        }
    });
    router.post('/storage/blob/commit-transfer', async (req, res) => {
        try {
            const user = (0,_utils_js__WEBPACK_IMPORTED_MODULE_5__.getUserContext)(req);
            const session = await runtime.sessions.assertSession((0,_utils_js__WEBPACK_IMPORTED_MODULE_5__.getSessionToken)(req), user);
            const payload = (req.body ?? {});
            if (!await runtime.permissions.authorize(user, session, { resource: 'storage.blob' })) {
                throw new Error('Permission not granted: storage.blob');
            }
            const transfer = runtime.transfers.get(user, session.extension.id, payload.transferId, 'storage.blob');
            const record = await runtime.storage.putBlobFromSource(user, session.extension.id, String(payload.name ?? 'blob'), transfer.filePath, payload.contentType);
            await runtime.transfers.discard(user, session.extension.id, payload.transferId).catch(() => undefined);
            await runtime.audit.logUsage(user, session.extension.id, 'Blob stored', { id: record.id, via: 'transfer' });
            ok(res, record);
        }
        catch (error) {
            fail(runtime, req, res, 'storage.blob', error);
        }
    });
    router.post('/storage/blob/get', async (req, res) => {
        try {
            const user = (0,_utils_js__WEBPACK_IMPORTED_MODULE_5__.getUserContext)(req);
            const session = await runtime.sessions.assertSession((0,_utils_js__WEBPACK_IMPORTED_MODULE_5__.getSessionToken)(req), user);
            if (!await runtime.permissions.authorize(user, session, { resource: 'storage.blob' })) {
                throw new Error('Permission not granted: storage.blob');
            }
            ok(res, await runtime.storage.getBlob(user, session.extension.id, String(req.body?.id ?? '')));
        }
        catch (error) {
            fail(runtime, req, res, 'storage.blob', error);
        }
    });
    router.post('/storage/blob/open-read', async (req, res) => {
        try {
            const user = (0,_utils_js__WEBPACK_IMPORTED_MODULE_5__.getUserContext)(req);
            const session = await runtime.sessions.assertSession((0,_utils_js__WEBPACK_IMPORTED_MODULE_5__.getSessionToken)(req), user);
            if (!await runtime.permissions.authorize(user, session, { resource: 'storage.blob' })) {
                throw new Error('Permission not granted: storage.blob');
            }
            const blobId = String(req.body?.id ?? '');
            const opened = await runtime.storage.openBlobRead(user, session.extension.id, blobId);
            if (opened.record.size <= _constants_js__WEBPACK_IMPORTED_MODULE_2__.DATA_TRANSFER_INLINE_THRESHOLD_BYTES) {
                ok(res, {
                    mode: 'inline',
                    ...(await runtime.storage.getBlob(user, session.extension.id, blobId)),
                });
                return;
            }
            const transfer = await runtime.transfers.openRead(user, session.extension.id, {
                resource: 'storage.blob',
                sourcePath: opened.sourcePath,
            });
            ok(res, {
                mode: 'transfer',
                record: opened.record,
                encoding: 'base64',
                transfer,
            });
        }
        catch (error) {
            fail(runtime, req, res, 'storage.blob', error);
        }
    });
    router.post('/storage/blob/delete', async (req, res) => {
        try {
            const user = (0,_utils_js__WEBPACK_IMPORTED_MODULE_5__.getUserContext)(req);
            const session = await runtime.sessions.assertSession((0,_utils_js__WEBPACK_IMPORTED_MODULE_5__.getSessionToken)(req), user);
            if (!await runtime.permissions.authorize(user, session, { resource: 'storage.blob' })) {
                throw new Error('Permission not granted: storage.blob');
            }
            await runtime.storage.deleteBlob(user, session.extension.id, String(req.body?.id ?? ''));
            ok(res, { ok: true });
        }
        catch (error) {
            fail(runtime, req, res, 'storage.blob', error);
        }
    });
    router.post('/storage/blob/list', async (req, res) => {
        try {
            const user = (0,_utils_js__WEBPACK_IMPORTED_MODULE_5__.getUserContext)(req);
            const session = await runtime.sessions.assertSession((0,_utils_js__WEBPACK_IMPORTED_MODULE_5__.getSessionToken)(req), user);
            if (!await runtime.permissions.authorize(user, session, { resource: 'storage.blob' })) {
                throw new Error('Permission not granted: storage.blob');
            }
            ok(res, { entries: await runtime.storage.listBlobs(user, session.extension.id) });
        }
        catch (error) {
            fail(runtime, req, res, 'storage.blob', error);
        }
    });
    router.post('/fs/private/mkdir', async (req, res) => {
        try {
            const user = (0,_utils_js__WEBPACK_IMPORTED_MODULE_5__.getUserContext)(req);
            const session = await runtime.sessions.assertSession((0,_utils_js__WEBPACK_IMPORTED_MODULE_5__.getSessionToken)(req), user);
            const payload = (req.body ?? {});
            if (!await runtime.permissions.authorize(user, session, { resource: 'fs.private' })) {
                throw new Error('Permission not granted: fs.private');
            }
            const entry = await runtime.files.mkdir(user, session.extension.id, payload);
            await runtime.audit.logUsage(user, session.extension.id, 'Private file mkdir', { path: payload.path });
            ok(res, { entry });
        }
        catch (error) {
            fail(runtime, req, res, 'fs.private', error);
        }
    });
    router.post('/fs/private/read-dir', async (req, res) => {
        try {
            const user = (0,_utils_js__WEBPACK_IMPORTED_MODULE_5__.getUserContext)(req);
            const session = await runtime.sessions.assertSession((0,_utils_js__WEBPACK_IMPORTED_MODULE_5__.getSessionToken)(req), user);
            const payload = (req.body ?? {});
            if (!await runtime.permissions.authorize(user, session, { resource: 'fs.private' })) {
                throw new Error('Permission not granted: fs.private');
            }
            const entries = await runtime.files.readDir(user, session.extension.id, payload);
            await runtime.audit.logUsage(user, session.extension.id, 'Private file read dir', { path: payload.path });
            ok(res, { entries });
        }
        catch (error) {
            fail(runtime, req, res, 'fs.private', error);
        }
    });
    router.post('/fs/private/write-file', async (req, res) => {
        try {
            const user = (0,_utils_js__WEBPACK_IMPORTED_MODULE_5__.getUserContext)(req);
            const session = await runtime.sessions.assertSession((0,_utils_js__WEBPACK_IMPORTED_MODULE_5__.getSessionToken)(req), user);
            const payload = (req.body ?? {});
            if (!await runtime.permissions.authorize(user, session, { resource: 'fs.private' })) {
                throw new Error('Permission not granted: fs.private');
            }
            const entry = await runtime.files.writeFile(user, session.extension.id, payload);
            await runtime.audit.logUsage(user, session.extension.id, 'Private file write', { path: payload.path });
            ok(res, { entry });
        }
        catch (error) {
            fail(runtime, req, res, 'fs.private', error);
        }
    });
    router.post('/fs/private/write-file-transfer', async (req, res) => {
        try {
            const user = (0,_utils_js__WEBPACK_IMPORTED_MODULE_5__.getUserContext)(req);
            const session = await runtime.sessions.assertSession((0,_utils_js__WEBPACK_IMPORTED_MODULE_5__.getSessionToken)(req), user);
            const payload = (req.body ?? {});
            if (!await runtime.permissions.authorize(user, session, { resource: 'fs.private' })) {
                throw new Error('Permission not granted: fs.private');
            }
            const transfer = runtime.transfers.get(user, session.extension.id, payload.transferId, 'fs.private');
            const entry = await runtime.files.writeFileFromSource(user, session.extension.id, {
                path: payload.path,
                sourcePath: transfer.filePath,
                ...(payload.createParents === undefined ? {} : { createParents: payload.createParents }),
            });
            await runtime.transfers.discard(user, session.extension.id, payload.transferId).catch(() => undefined);
            await runtime.audit.logUsage(user, session.extension.id, 'Private file write', { path: payload.path, via: 'transfer' });
            ok(res, { entry });
        }
        catch (error) {
            fail(runtime, req, res, 'fs.private', error);
        }
    });
    router.post('/fs/private/read-file', async (req, res) => {
        try {
            const user = (0,_utils_js__WEBPACK_IMPORTED_MODULE_5__.getUserContext)(req);
            const session = await runtime.sessions.assertSession((0,_utils_js__WEBPACK_IMPORTED_MODULE_5__.getSessionToken)(req), user);
            const payload = (req.body ?? {});
            if (!await runtime.permissions.authorize(user, session, { resource: 'fs.private' })) {
                throw new Error('Permission not granted: fs.private');
            }
            const result = await runtime.files.readFile(user, session.extension.id, payload);
            await runtime.audit.logUsage(user, session.extension.id, 'Private file read', { path: payload.path });
            ok(res, result);
        }
        catch (error) {
            fail(runtime, req, res, 'fs.private', error);
        }
    });
    router.post('/fs/private/open-read', async (req, res) => {
        try {
            const user = (0,_utils_js__WEBPACK_IMPORTED_MODULE_5__.getUserContext)(req);
            const session = await runtime.sessions.assertSession((0,_utils_js__WEBPACK_IMPORTED_MODULE_5__.getSessionToken)(req), user);
            const payload = (req.body ?? {});
            if (!await runtime.permissions.authorize(user, session, { resource: 'fs.private' })) {
                throw new Error('Permission not granted: fs.private');
            }
            const opened = await runtime.files.openRead(user, session.extension.id, payload);
            if (opened.entry.sizeBytes <= _constants_js__WEBPACK_IMPORTED_MODULE_2__.DATA_TRANSFER_INLINE_THRESHOLD_BYTES) {
                const result = await runtime.files.readFile(user, session.extension.id, payload);
                await runtime.audit.logUsage(user, session.extension.id, 'Private file read', { path: payload.path });
                ok(res, {
                    mode: 'inline',
                    ...result,
                });
                return;
            }
            const transfer = await runtime.transfers.openRead(user, session.extension.id, {
                resource: 'fs.private',
                sourcePath: opened.sourcePath,
            });
            await runtime.audit.logUsage(user, session.extension.id, 'Private file read', { path: payload.path, via: 'transfer' });
            ok(res, {
                mode: 'transfer',
                entry: opened.entry,
                encoding: payload.encoding ?? 'utf8',
                transfer,
            });
        }
        catch (error) {
            fail(runtime, req, res, 'fs.private', error);
        }
    });
    router.post('/fs/private/delete', async (req, res) => {
        try {
            const user = (0,_utils_js__WEBPACK_IMPORTED_MODULE_5__.getUserContext)(req);
            const session = await runtime.sessions.assertSession((0,_utils_js__WEBPACK_IMPORTED_MODULE_5__.getSessionToken)(req), user);
            const payload = (req.body ?? {});
            if (!await runtime.permissions.authorize(user, session, { resource: 'fs.private' })) {
                throw new Error('Permission not granted: fs.private');
            }
            await runtime.files.delete(user, session.extension.id, payload);
            await runtime.audit.logUsage(user, session.extension.id, 'Private file delete', { path: payload.path });
            ok(res, { ok: true });
        }
        catch (error) {
            fail(runtime, req, res, 'fs.private', error);
        }
    });
    router.post('/fs/private/stat', async (req, res) => {
        try {
            const user = (0,_utils_js__WEBPACK_IMPORTED_MODULE_5__.getUserContext)(req);
            const session = await runtime.sessions.assertSession((0,_utils_js__WEBPACK_IMPORTED_MODULE_5__.getSessionToken)(req), user);
            const payload = (req.body ?? {});
            if (!await runtime.permissions.authorize(user, session, { resource: 'fs.private' })) {
                throw new Error('Permission not granted: fs.private');
            }
            const entry = await runtime.files.stat(user, session.extension.id, payload);
            await runtime.audit.logUsage(user, session.extension.id, 'Private file stat', { path: payload.path });
            ok(res, { entry });
        }
        catch (error) {
            fail(runtime, req, res, 'fs.private', error);
        }
    });
    router.post('/sql/query', async (req, res) => {
        try {
            const user = (0,_utils_js__WEBPACK_IMPORTED_MODULE_5__.getUserContext)(req);
            const session = await runtime.sessions.assertSession((0,_utils_js__WEBPACK_IMPORTED_MODULE_5__.getSessionToken)(req), user);
            const payload = (req.body ?? {});
            const database = getSqlDatabaseName(payload.database);
            if (!await runtime.permissions.authorize(user, session, { resource: 'sql.private', target: database })) {
                throw new Error(`Permission not granted: sql.private for ${database}`);
            }
            const dbPath = resolvePrivateSqlDatabasePath(user, session.extension.id, database);
            const result = await runtime.core.querySql(dbPath, {
                ...payload,
                database,
            });
            await runtime.audit.logUsage(user, session.extension.id, 'SQL query', {
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
            const user = (0,_utils_js__WEBPACK_IMPORTED_MODULE_5__.getUserContext)(req);
            const session = await runtime.sessions.assertSession((0,_utils_js__WEBPACK_IMPORTED_MODULE_5__.getSessionToken)(req), user);
            const payload = (req.body ?? {});
            const database = getSqlDatabaseName(payload.database);
            if (!await runtime.permissions.authorize(user, session, { resource: 'sql.private', target: database })) {
                throw new Error(`Permission not granted: sql.private for ${database}`);
            }
            const dbPath = resolvePrivateSqlDatabasePath(user, session.extension.id, database);
            const result = await runtime.core.execSql(dbPath, {
                ...payload,
                database,
            });
            await runtime.audit.logUsage(user, session.extension.id, 'SQL exec', {
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
            const user = (0,_utils_js__WEBPACK_IMPORTED_MODULE_5__.getUserContext)(req);
            const session = await runtime.sessions.assertSession((0,_utils_js__WEBPACK_IMPORTED_MODULE_5__.getSessionToken)(req), user);
            const payload = (req.body ?? {});
            const database = getSqlDatabaseName(payload.database);
            if (!await runtime.permissions.authorize(user, session, { resource: 'sql.private', target: database })) {
                throw new Error(`Permission not granted: sql.private for ${database}`);
            }
            const dbPath = resolvePrivateSqlDatabasePath(user, session.extension.id, database);
            const result = await runtime.core.batchSql(dbPath, {
                ...payload,
                database,
            });
            await runtime.audit.logUsage(user, session.extension.id, 'SQL batch', {
                database,
                statements: Array.isArray(payload.statements) ? payload.statements.length : 0,
            });
            ok(res, result);
        }
        catch (error) {
            fail(runtime, req, res, 'sql.private', error);
        }
    });
    router.post('/sql/transaction', async (req, res) => {
        try {
            const user = (0,_utils_js__WEBPACK_IMPORTED_MODULE_5__.getUserContext)(req);
            const session = await runtime.sessions.assertSession((0,_utils_js__WEBPACK_IMPORTED_MODULE_5__.getSessionToken)(req), user);
            const payload = (req.body ?? {});
            const database = getSqlDatabaseName(payload.database);
            if (!await runtime.permissions.authorize(user, session, { resource: 'sql.private', target: database })) {
                throw new Error(`Permission not granted: sql.private for ${database}`);
            }
            const dbPath = resolvePrivateSqlDatabasePath(user, session.extension.id, database);
            const result = await runtime.core.transactionSql(dbPath, {
                ...payload,
                database,
            });
            await runtime.audit.logUsage(user, session.extension.id, 'SQL transaction', {
                database,
                statements: Array.isArray(payload.statements) ? payload.statements.length : 0,
            });
            ok(res, result);
        }
        catch (error) {
            fail(runtime, req, res, 'sql.private', error);
        }
    });
    router.post('/sql/migrate', async (req, res) => {
        try {
            const user = (0,_utils_js__WEBPACK_IMPORTED_MODULE_5__.getUserContext)(req);
            const session = await runtime.sessions.assertSession((0,_utils_js__WEBPACK_IMPORTED_MODULE_5__.getSessionToken)(req), user);
            const payload = (req.body ?? {});
            const database = getSqlDatabaseName(payload.database);
            if (!await runtime.permissions.authorize(user, session, { resource: 'sql.private', target: database })) {
                throw new Error(`Permission not granted: sql.private for ${database}`);
            }
            const dbPath = resolvePrivateSqlDatabasePath(user, session.extension.id, database);
            const result = await runtime.core.migrateSql(dbPath, {
                ...payload,
                database,
            });
            await runtime.audit.logUsage(user, session.extension.id, 'SQL migrate', {
                database,
                migrations: Array.isArray(payload.migrations) ? payload.migrations.length : 0,
                tableName: payload.tableName ?? '_authority_migrations',
            });
            ok(res, result);
        }
        catch (error) {
            fail(runtime, req, res, 'sql.private', error);
        }
    });
    router.get('/sql/databases', async (req, res) => {
        try {
            const user = (0,_utils_js__WEBPACK_IMPORTED_MODULE_5__.getUserContext)(req);
            const session = await runtime.sessions.assertSession((0,_utils_js__WEBPACK_IMPORTED_MODULE_5__.getSessionToken)(req), user);
            if (!await runtime.permissions.authorize(user, session, { resource: 'sql.private' }, false)) {
                throw new Error('Permission not granted: sql.private');
            }
            const result = listPrivateSqlDatabases(user, session.extension.id);
            await runtime.audit.logUsage(user, session.extension.id, 'SQL list databases', {
                count: result.databases.length,
            });
            ok(res, result);
        }
        catch (error) {
            fail(runtime, req, res, 'sql.private', error);
        }
    });
    router.post('/trivium/insert', async (req, res) => {
        try {
            const user = (0,_utils_js__WEBPACK_IMPORTED_MODULE_5__.getUserContext)(req);
            const session = await runtime.sessions.assertSession((0,_utils_js__WEBPACK_IMPORTED_MODULE_5__.getSessionToken)(req), user);
            const payload = (req.body ?? {});
            const database = getTriviumDatabaseName(payload.database);
            if (!await runtime.permissions.authorize(user, session, { resource: 'trivium.private', target: database })) {
                throw new Error(`Permission not granted: trivium.private for ${database}`);
            }
            const dbPath = resolvePrivateTriviumDatabasePath(user, session.extension.id, database);
            const result = await runtime.core.insertTrivium(dbPath, {
                ...payload,
                database,
            });
            await runtime.audit.logUsage(user, session.extension.id, 'Trivium insert', {
                database,
                id: result.id,
            });
            ok(res, result);
        }
        catch (error) {
            fail(runtime, req, res, 'trivium.private', error);
        }
    });
    router.post('/trivium/insert-with-id', async (req, res) => {
        try {
            const user = (0,_utils_js__WEBPACK_IMPORTED_MODULE_5__.getUserContext)(req);
            const session = await runtime.sessions.assertSession((0,_utils_js__WEBPACK_IMPORTED_MODULE_5__.getSessionToken)(req), user);
            const payload = (req.body ?? {});
            const database = getTriviumDatabaseName(payload.database);
            if (!await runtime.permissions.authorize(user, session, { resource: 'trivium.private', target: database })) {
                throw new Error(`Permission not granted: trivium.private for ${database}`);
            }
            const dbPath = resolvePrivateTriviumDatabasePath(user, session.extension.id, database);
            await runtime.core.insertTriviumWithId(dbPath, {
                ...payload,
                database,
            });
            await runtime.audit.logUsage(user, session.extension.id, 'Trivium insert with id', {
                database,
                id: payload.id,
            });
            ok(res, { ok: true });
        }
        catch (error) {
            fail(runtime, req, res, 'trivium.private', error);
        }
    });
    router.post('/trivium/get', async (req, res) => {
        try {
            const user = (0,_utils_js__WEBPACK_IMPORTED_MODULE_5__.getUserContext)(req);
            const session = await runtime.sessions.assertSession((0,_utils_js__WEBPACK_IMPORTED_MODULE_5__.getSessionToken)(req), user);
            const payload = (req.body ?? {});
            const database = getTriviumDatabaseName(payload.database);
            if (!await runtime.permissions.authorize(user, session, { resource: 'trivium.private', target: database })) {
                throw new Error(`Permission not granted: trivium.private for ${database}`);
            }
            const dbPath = resolvePrivateTriviumDatabasePath(user, session.extension.id, database);
            const node = await runtime.core.getTrivium(dbPath, {
                ...payload,
                database,
            });
            await runtime.audit.logUsage(user, session.extension.id, 'Trivium get', {
                database,
                id: payload.id,
            });
            ok(res, { node });
        }
        catch (error) {
            fail(runtime, req, res, 'trivium.private', error);
        }
    });
    router.post('/trivium/update-payload', async (req, res) => {
        try {
            const user = (0,_utils_js__WEBPACK_IMPORTED_MODULE_5__.getUserContext)(req);
            const session = await runtime.sessions.assertSession((0,_utils_js__WEBPACK_IMPORTED_MODULE_5__.getSessionToken)(req), user);
            const payload = (req.body ?? {});
            const database = getTriviumDatabaseName(payload.database);
            if (!await runtime.permissions.authorize(user, session, { resource: 'trivium.private', target: database })) {
                throw new Error(`Permission not granted: trivium.private for ${database}`);
            }
            const dbPath = resolvePrivateTriviumDatabasePath(user, session.extension.id, database);
            await runtime.core.updateTriviumPayload(dbPath, {
                ...payload,
                database,
            });
            await runtime.audit.logUsage(user, session.extension.id, 'Trivium update payload', {
                database,
                id: payload.id,
            });
            ok(res, { ok: true });
        }
        catch (error) {
            fail(runtime, req, res, 'trivium.private', error);
        }
    });
    router.post('/trivium/update-vector', async (req, res) => {
        try {
            const user = (0,_utils_js__WEBPACK_IMPORTED_MODULE_5__.getUserContext)(req);
            const session = await runtime.sessions.assertSession((0,_utils_js__WEBPACK_IMPORTED_MODULE_5__.getSessionToken)(req), user);
            const payload = (req.body ?? {});
            const database = getTriviumDatabaseName(payload.database);
            if (!await runtime.permissions.authorize(user, session, { resource: 'trivium.private', target: database })) {
                throw new Error(`Permission not granted: trivium.private for ${database}`);
            }
            const dbPath = resolvePrivateTriviumDatabasePath(user, session.extension.id, database);
            await runtime.core.updateTriviumVector(dbPath, {
                ...payload,
                database,
            });
            await runtime.audit.logUsage(user, session.extension.id, 'Trivium update vector', {
                database,
                id: payload.id,
            });
            ok(res, { ok: true });
        }
        catch (error) {
            fail(runtime, req, res, 'trivium.private', error);
        }
    });
    router.post('/trivium/delete', async (req, res) => {
        try {
            const user = (0,_utils_js__WEBPACK_IMPORTED_MODULE_5__.getUserContext)(req);
            const session = await runtime.sessions.assertSession((0,_utils_js__WEBPACK_IMPORTED_MODULE_5__.getSessionToken)(req), user);
            const payload = (req.body ?? {});
            const database = getTriviumDatabaseName(payload.database);
            if (!await runtime.permissions.authorize(user, session, { resource: 'trivium.private', target: database })) {
                throw new Error(`Permission not granted: trivium.private for ${database}`);
            }
            const dbPath = resolvePrivateTriviumDatabasePath(user, session.extension.id, database);
            await runtime.core.deleteTrivium(dbPath, {
                ...payload,
                database,
            });
            await runtime.audit.logUsage(user, session.extension.id, 'Trivium delete', {
                database,
                id: payload.id,
            });
            ok(res, { ok: true });
        }
        catch (error) {
            fail(runtime, req, res, 'trivium.private', error);
        }
    });
    router.post('/trivium/link', async (req, res) => {
        try {
            const user = (0,_utils_js__WEBPACK_IMPORTED_MODULE_5__.getUserContext)(req);
            const session = await runtime.sessions.assertSession((0,_utils_js__WEBPACK_IMPORTED_MODULE_5__.getSessionToken)(req), user);
            const payload = (req.body ?? {});
            const database = getTriviumDatabaseName(payload.database);
            if (!await runtime.permissions.authorize(user, session, { resource: 'trivium.private', target: database })) {
                throw new Error(`Permission not granted: trivium.private for ${database}`);
            }
            const dbPath = resolvePrivateTriviumDatabasePath(user, session.extension.id, database);
            await runtime.core.linkTrivium(dbPath, {
                ...payload,
                database,
            });
            await runtime.audit.logUsage(user, session.extension.id, 'Trivium link', {
                database,
                src: payload.src,
                dst: payload.dst,
            });
            ok(res, { ok: true });
        }
        catch (error) {
            fail(runtime, req, res, 'trivium.private', error);
        }
    });
    router.post('/trivium/unlink', async (req, res) => {
        try {
            const user = (0,_utils_js__WEBPACK_IMPORTED_MODULE_5__.getUserContext)(req);
            const session = await runtime.sessions.assertSession((0,_utils_js__WEBPACK_IMPORTED_MODULE_5__.getSessionToken)(req), user);
            const payload = (req.body ?? {});
            const database = getTriviumDatabaseName(payload.database);
            if (!await runtime.permissions.authorize(user, session, { resource: 'trivium.private', target: database })) {
                throw new Error(`Permission not granted: trivium.private for ${database}`);
            }
            const dbPath = resolvePrivateTriviumDatabasePath(user, session.extension.id, database);
            await runtime.core.unlinkTrivium(dbPath, {
                ...payload,
                database,
            });
            await runtime.audit.logUsage(user, session.extension.id, 'Trivium unlink', {
                database,
                src: payload.src,
                dst: payload.dst,
            });
            ok(res, { ok: true });
        }
        catch (error) {
            fail(runtime, req, res, 'trivium.private', error);
        }
    });
    router.post('/trivium/neighbors', async (req, res) => {
        try {
            const user = (0,_utils_js__WEBPACK_IMPORTED_MODULE_5__.getUserContext)(req);
            const session = await runtime.sessions.assertSession((0,_utils_js__WEBPACK_IMPORTED_MODULE_5__.getSessionToken)(req), user);
            const payload = (req.body ?? {});
            const database = getTriviumDatabaseName(payload.database);
            if (!await runtime.permissions.authorize(user, session, { resource: 'trivium.private', target: database })) {
                throw new Error(`Permission not granted: trivium.private for ${database}`);
            }
            const dbPath = resolvePrivateTriviumDatabasePath(user, session.extension.id, database);
            const result = await runtime.core.neighborsTrivium(dbPath, {
                ...payload,
                database,
            });
            await runtime.audit.logUsage(user, session.extension.id, 'Trivium neighbors', {
                database,
                id: payload.id,
                depth: payload.depth ?? 1,
            });
            ok(res, result);
        }
        catch (error) {
            fail(runtime, req, res, 'trivium.private', error);
        }
    });
    router.post('/trivium/search', async (req, res) => {
        try {
            const user = (0,_utils_js__WEBPACK_IMPORTED_MODULE_5__.getUserContext)(req);
            const session = await runtime.sessions.assertSession((0,_utils_js__WEBPACK_IMPORTED_MODULE_5__.getSessionToken)(req), user);
            const payload = (req.body ?? {});
            const database = getTriviumDatabaseName(payload.database);
            if (!await runtime.permissions.authorize(user, session, { resource: 'trivium.private', target: database })) {
                throw new Error(`Permission not granted: trivium.private for ${database}`);
            }
            const dbPath = resolvePrivateTriviumDatabasePath(user, session.extension.id, database);
            const hits = await runtime.core.searchTrivium(dbPath, {
                ...payload,
                database,
            });
            await runtime.audit.logUsage(user, session.extension.id, 'Trivium search', {
                database,
                topK: payload.topK ?? 5,
                expandDepth: payload.expandDepth ?? 0,
            });
            ok(res, { hits });
        }
        catch (error) {
            fail(runtime, req, res, 'trivium.private', error);
        }
    });
    router.post('/trivium/search-advanced', async (req, res) => {
        try {
            const user = (0,_utils_js__WEBPACK_IMPORTED_MODULE_5__.getUserContext)(req);
            const session = await runtime.sessions.assertSession((0,_utils_js__WEBPACK_IMPORTED_MODULE_5__.getSessionToken)(req), user);
            const payload = (req.body ?? {});
            const database = getTriviumDatabaseName(payload.database);
            if (!await runtime.permissions.authorize(user, session, { resource: 'trivium.private', target: database })) {
                throw new Error(`Permission not granted: trivium.private for ${database}`);
            }
            const dbPath = resolvePrivateTriviumDatabasePath(user, session.extension.id, database);
            const hits = await runtime.core.searchAdvancedTrivium(dbPath, {
                ...payload,
                database,
            });
            await runtime.audit.logUsage(user, session.extension.id, 'Trivium advanced search', {
                database,
                topK: payload.topK ?? 5,
                expandDepth: payload.expandDepth ?? 2,
            });
            ok(res, { hits });
        }
        catch (error) {
            fail(runtime, req, res, 'trivium.private', error);
        }
    });
    router.post('/trivium/search-hybrid', async (req, res) => {
        try {
            const user = (0,_utils_js__WEBPACK_IMPORTED_MODULE_5__.getUserContext)(req);
            const session = await runtime.sessions.assertSession((0,_utils_js__WEBPACK_IMPORTED_MODULE_5__.getSessionToken)(req), user);
            const payload = (req.body ?? {});
            const database = getTriviumDatabaseName(payload.database);
            if (!await runtime.permissions.authorize(user, session, { resource: 'trivium.private', target: database })) {
                throw new Error(`Permission not granted: trivium.private for ${database}`);
            }
            const dbPath = resolvePrivateTriviumDatabasePath(user, session.extension.id, database);
            const hits = await runtime.core.searchHybridTrivium(dbPath, {
                ...payload,
                database,
            });
            await runtime.audit.logUsage(user, session.extension.id, 'Trivium hybrid search', {
                database,
                topK: payload.topK ?? 5,
                expandDepth: payload.expandDepth ?? 2,
            });
            ok(res, { hits });
        }
        catch (error) {
            fail(runtime, req, res, 'trivium.private', error);
        }
    });
    router.post('/trivium/filter-where', async (req, res) => {
        try {
            const user = (0,_utils_js__WEBPACK_IMPORTED_MODULE_5__.getUserContext)(req);
            const session = await runtime.sessions.assertSession((0,_utils_js__WEBPACK_IMPORTED_MODULE_5__.getSessionToken)(req), user);
            const payload = (req.body ?? {});
            const database = getTriviumDatabaseName(payload.database);
            if (!await runtime.permissions.authorize(user, session, { resource: 'trivium.private', target: database })) {
                throw new Error(`Permission not granted: trivium.private for ${database}`);
            }
            const dbPath = resolvePrivateTriviumDatabasePath(user, session.extension.id, database);
            const nodes = await runtime.core.filterWhereTrivium(dbPath, {
                ...payload,
                database,
            });
            await runtime.audit.logUsage(user, session.extension.id, 'Trivium filter where', {
                database,
                count: nodes.length,
            });
            ok(res, { nodes });
        }
        catch (error) {
            fail(runtime, req, res, 'trivium.private', error);
        }
    });
    router.post('/trivium/query', async (req, res) => {
        try {
            const user = (0,_utils_js__WEBPACK_IMPORTED_MODULE_5__.getUserContext)(req);
            const session = await runtime.sessions.assertSession((0,_utils_js__WEBPACK_IMPORTED_MODULE_5__.getSessionToken)(req), user);
            const payload = (req.body ?? {});
            const database = getTriviumDatabaseName(payload.database);
            if (!await runtime.permissions.authorize(user, session, { resource: 'trivium.private', target: database })) {
                throw new Error(`Permission not granted: trivium.private for ${database}`);
            }
            const dbPath = resolvePrivateTriviumDatabasePath(user, session.extension.id, database);
            const rows = await runtime.core.queryTrivium(dbPath, {
                ...payload,
                database,
            });
            await runtime.audit.logUsage(user, session.extension.id, 'Trivium query', {
                database,
                rowCount: rows.length,
            });
            ok(res, { rows });
        }
        catch (error) {
            fail(runtime, req, res, 'trivium.private', error);
        }
    });
    router.post('/trivium/index-text', async (req, res) => {
        try {
            const user = (0,_utils_js__WEBPACK_IMPORTED_MODULE_5__.getUserContext)(req);
            const session = await runtime.sessions.assertSession((0,_utils_js__WEBPACK_IMPORTED_MODULE_5__.getSessionToken)(req), user);
            const payload = (req.body ?? {});
            const database = getTriviumDatabaseName(payload.database);
            if (!await runtime.permissions.authorize(user, session, { resource: 'trivium.private', target: database })) {
                throw new Error(`Permission not granted: trivium.private for ${database}`);
            }
            const dbPath = resolvePrivateTriviumDatabasePath(user, session.extension.id, database);
            await runtime.core.indexTextTrivium(dbPath, {
                ...payload,
                database,
            });
            await runtime.audit.logUsage(user, session.extension.id, 'Trivium index text', {
                database,
                id: payload.id,
            });
            ok(res, { ok: true });
        }
        catch (error) {
            fail(runtime, req, res, 'trivium.private', error);
        }
    });
    router.post('/trivium/index-keyword', async (req, res) => {
        try {
            const user = (0,_utils_js__WEBPACK_IMPORTED_MODULE_5__.getUserContext)(req);
            const session = await runtime.sessions.assertSession((0,_utils_js__WEBPACK_IMPORTED_MODULE_5__.getSessionToken)(req), user);
            const payload = (req.body ?? {});
            const database = getTriviumDatabaseName(payload.database);
            if (!await runtime.permissions.authorize(user, session, { resource: 'trivium.private', target: database })) {
                throw new Error(`Permission not granted: trivium.private for ${database}`);
            }
            const dbPath = resolvePrivateTriviumDatabasePath(user, session.extension.id, database);
            await runtime.core.indexKeywordTrivium(dbPath, {
                ...payload,
                database,
            });
            await runtime.audit.logUsage(user, session.extension.id, 'Trivium index keyword', {
                database,
                id: payload.id,
            });
            ok(res, { ok: true });
        }
        catch (error) {
            fail(runtime, req, res, 'trivium.private', error);
        }
    });
    router.post('/trivium/build-text-index', async (req, res) => {
        try {
            const user = (0,_utils_js__WEBPACK_IMPORTED_MODULE_5__.getUserContext)(req);
            const session = await runtime.sessions.assertSession((0,_utils_js__WEBPACK_IMPORTED_MODULE_5__.getSessionToken)(req), user);
            const payload = (req.body ?? {});
            const database = getTriviumDatabaseName(payload.database);
            if (!await runtime.permissions.authorize(user, session, { resource: 'trivium.private', target: database })) {
                throw new Error(`Permission not granted: trivium.private for ${database}`);
            }
            const dbPath = resolvePrivateTriviumDatabasePath(user, session.extension.id, database);
            await runtime.core.buildTextIndexTrivium(dbPath, {
                ...payload,
                database,
            });
            await runtime.audit.logUsage(user, session.extension.id, 'Trivium build text index', {
                database,
            });
            ok(res, { ok: true });
        }
        catch (error) {
            fail(runtime, req, res, 'trivium.private', error);
        }
    });
    router.post('/trivium/flush', async (req, res) => {
        try {
            const user = (0,_utils_js__WEBPACK_IMPORTED_MODULE_5__.getUserContext)(req);
            const session = await runtime.sessions.assertSession((0,_utils_js__WEBPACK_IMPORTED_MODULE_5__.getSessionToken)(req), user);
            const payload = (req.body ?? {});
            const database = getTriviumDatabaseName(payload.database);
            if (!await runtime.permissions.authorize(user, session, { resource: 'trivium.private', target: database })) {
                throw new Error(`Permission not granted: trivium.private for ${database}`);
            }
            const dbPath = resolvePrivateTriviumDatabasePath(user, session.extension.id, database);
            await runtime.core.flushTrivium(dbPath, {
                ...payload,
                database,
            });
            await runtime.audit.logUsage(user, session.extension.id, 'Trivium flush', {
                database,
            });
            ok(res, { ok: true });
        }
        catch (error) {
            fail(runtime, req, res, 'trivium.private', error);
        }
    });
    router.post('/trivium/stat', async (req, res) => {
        try {
            const user = (0,_utils_js__WEBPACK_IMPORTED_MODULE_5__.getUserContext)(req);
            const session = await runtime.sessions.assertSession((0,_utils_js__WEBPACK_IMPORTED_MODULE_5__.getSessionToken)(req), user);
            const payload = (req.body ?? {});
            const database = getTriviumDatabaseName(payload.database);
            if (!await runtime.permissions.authorize(user, session, { resource: 'trivium.private', target: database })) {
                throw new Error(`Permission not granted: trivium.private for ${database}`);
            }
            const dbPath = resolvePrivateTriviumDatabasePath(user, session.extension.id, database);
            const result = await runtime.core.statTrivium(dbPath, {
                ...payload,
                database,
            });
            await runtime.audit.logUsage(user, session.extension.id, 'Trivium stat', {
                database,
                nodeCount: result.nodeCount,
            });
            ok(res, result);
        }
        catch (error) {
            fail(runtime, req, res, 'trivium.private', error);
        }
    });
    router.get('/trivium/databases', async (req, res) => {
        try {
            const user = (0,_utils_js__WEBPACK_IMPORTED_MODULE_5__.getUserContext)(req);
            const session = await runtime.sessions.assertSession((0,_utils_js__WEBPACK_IMPORTED_MODULE_5__.getSessionToken)(req), user);
            if (!await runtime.permissions.authorize(user, session, { resource: 'trivium.private' }, false)) {
                throw new Error('Permission not granted: trivium.private');
            }
            const result = listPrivateTriviumDatabases(user, session.extension.id);
            await runtime.audit.logUsage(user, session.extension.id, 'Trivium list databases', {
                count: result.databases.length,
            });
            ok(res, result);
        }
        catch (error) {
            fail(runtime, req, res, 'trivium.private', error);
        }
    });
    router.post('/http/fetch', async (req, res) => {
        try {
            const user = (0,_utils_js__WEBPACK_IMPORTED_MODULE_5__.getUserContext)(req);
            const session = await runtime.sessions.assertSession((0,_utils_js__WEBPACK_IMPORTED_MODULE_5__.getSessionToken)(req), user);
            const hostname = (0,_utils_js__WEBPACK_IMPORTED_MODULE_5__.normalizeHostname)(String(req.body?.url ?? ''));
            if (!await runtime.permissions.authorize(user, session, { resource: 'http.fetch', target: hostname })) {
                throw new Error(`Permission not granted: http.fetch for ${hostname}`);
            }
            const result = await runtime.http.fetch(user, req.body);
            await runtime.audit.logUsage(user, session.extension.id, 'HTTP fetch', { hostname });
            ok(res, result);
        }
        catch (error) {
            fail(runtime, req, res, 'http.fetch', error);
        }
    });
    router.post('/http/fetch-open', async (req, res) => {
        const payload = (req.body ?? {});
        let user;
        let session;
        let bodyTransferIdToDiscard;
        let responseTransferIdToDiscard;
        try {
            user = (0,_utils_js__WEBPACK_IMPORTED_MODULE_5__.getUserContext)(req);
            session = await runtime.sessions.assertSession((0,_utils_js__WEBPACK_IMPORTED_MODULE_5__.getSessionToken)(req), user);
            const hostname = (0,_utils_js__WEBPACK_IMPORTED_MODULE_5__.normalizeHostname)(String(payload.url ?? ''));
            if (!await runtime.permissions.authorize(user, session, { resource: 'http.fetch', target: hostname })) {
                throw new Error(`Permission not granted: http.fetch for ${hostname}`);
            }
            if (payload.body !== undefined && payload.bodyTransferId) {
                throw new Error('HTTP fetch body and bodyTransferId cannot both be provided');
            }
            const bodyTransfer = payload.bodyTransferId
                ? runtime.transfers.get(user, session.extension.id, payload.bodyTransferId, 'http.fetch')
                : undefined;
            bodyTransferIdToDiscard = payload.bodyTransferId;
            const responseTransfer = await runtime.transfers.init(user, session.extension.id, { resource: 'http.fetch' });
            responseTransferIdToDiscard = responseTransfer.transferId;
            const responseTransferRecord = runtime.transfers.get(user, session.extension.id, responseTransfer.transferId, 'http.fetch');
            const result = await runtime.http.openFetch(user, {
                url: payload.url,
                ...(payload.method === undefined ? {} : { method: payload.method }),
                ...(payload.headers === undefined ? {} : { headers: payload.headers }),
                ...(bodyTransfer
                    ? { bodySourcePath: bodyTransfer.filePath }
                    : payload.body === undefined
                        ? {}
                        : {
                            body: payload.body,
                            ...(payload.bodyEncoding === undefined ? {} : { bodyEncoding: payload.bodyEncoding }),
                        }),
                responsePath: responseTransferRecord.filePath,
            });
            const finalizedTransfer = await runtime.transfers.promoteToDownload(user, session.extension.id, responseTransfer.transferId);
            await runtime.audit.logUsage(user, session.extension.id, 'HTTP fetch', {
                hostname,
                ...(bodyTransfer ? { requestVia: 'transfer' } : {}),
                ...(finalizedTransfer.sizeBytes > _constants_js__WEBPACK_IMPORTED_MODULE_2__.DATA_TRANSFER_INLINE_THRESHOLD_BYTES ? { responseVia: 'transfer' } : {}),
            });
            if (finalizedTransfer.sizeBytes <= _constants_js__WEBPACK_IMPORTED_MODULE_2__.DATA_TRANSFER_INLINE_THRESHOLD_BYTES) {
                const bytes = node_fs__WEBPACK_IMPORTED_MODULE_0___default().readFileSync(responseTransferRecord.filePath);
                await runtime.transfers.discard(user, session.extension.id, responseTransfer.transferId).catch(() => undefined);
                responseTransferIdToDiscard = undefined;
                ok(res, {
                    mode: 'inline',
                    url: result.url,
                    hostname: result.hostname,
                    status: result.status,
                    ok: result.ok,
                    headers: result.headers,
                    body: decodeHttpResponseBody(bytes, result.bodyEncoding),
                    bodyEncoding: result.bodyEncoding,
                    contentType: result.contentType,
                });
                return;
            }
            responseTransferIdToDiscard = undefined;
            ok(res, {
                mode: 'transfer',
                url: result.url,
                hostname: result.hostname,
                status: result.status,
                ok: result.ok,
                headers: result.headers,
                bodyEncoding: result.bodyEncoding,
                contentType: result.contentType,
                transfer: finalizedTransfer,
            });
        }
        catch (error) {
            fail(runtime, req, res, 'http.fetch', error);
        }
        finally {
            if (user && session && bodyTransferIdToDiscard) {
                await runtime.transfers.discard(user, session.extension.id, bodyTransferIdToDiscard).catch(() => undefined);
            }
            if (user && session && responseTransferIdToDiscard) {
                await runtime.transfers.discard(user, session.extension.id, responseTransferIdToDiscard).catch(() => undefined);
            }
        }
    });
    router.post('/jobs/create', async (req, res) => {
        try {
            const user = (0,_utils_js__WEBPACK_IMPORTED_MODULE_5__.getUserContext)(req);
            const session = await runtime.sessions.assertSession((0,_utils_js__WEBPACK_IMPORTED_MODULE_5__.getSessionToken)(req), user);
            const jobType = String(req.body?.type ?? '');
            if (!await runtime.permissions.authorize(user, session, { resource: 'jobs.background', target: jobType })) {
                throw new Error(`Permission not granted: jobs.background for ${jobType}`);
            }
            const jobOptions = {};
            if (typeof req.body?.timeoutMs === 'number')
                jobOptions.timeoutMs = req.body.timeoutMs;
            if (typeof req.body?.idempotencyKey === 'string')
                jobOptions.idempotencyKey = req.body.idempotencyKey;
            if (typeof req.body?.maxAttempts === 'number')
                jobOptions.maxAttempts = req.body.maxAttempts;
            const job = await runtime.jobs.create(user, session.extension.id, jobType, req.body?.payload ?? {}, jobOptions);
            await runtime.audit.logUsage(user, session.extension.id, 'Job created', { jobId: job.id, jobType });
            ok(res, job);
        }
        catch (error) {
            fail(runtime, req, res, 'jobs.background', error);
        }
    });
    router.get('/jobs', async (req, res) => {
        try {
            const user = (0,_utils_js__WEBPACK_IMPORTED_MODULE_5__.getUserContext)(req);
            const session = await runtime.sessions.assertSession((0,_utils_js__WEBPACK_IMPORTED_MODULE_5__.getSessionToken)(req), user);
            ok(res, await runtime.jobs.list(user, session.extension.id));
        }
        catch (error) {
            fail(runtime, req, res, 'jobs.background', error);
        }
    });
    router.get('/jobs/:id', async (req, res) => {
        try {
            const user = (0,_utils_js__WEBPACK_IMPORTED_MODULE_5__.getUserContext)(req);
            const session = await runtime.sessions.assertSession((0,_utils_js__WEBPACK_IMPORTED_MODULE_5__.getSessionToken)(req), user);
            const job = await runtime.jobs.get(user, String(req.params?.id ?? ''));
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
            const user = (0,_utils_js__WEBPACK_IMPORTED_MODULE_5__.getUserContext)(req);
            const session = await runtime.sessions.assertSession((0,_utils_js__WEBPACK_IMPORTED_MODULE_5__.getSessionToken)(req), user);
            const job = await runtime.jobs.cancel(user, session.extension.id, String(req.params?.id ?? ''));
            await runtime.audit.logUsage(user, session.extension.id, 'Job cancelled', { jobId: job.id });
            ok(res, job);
        }
        catch (error) {
            fail(runtime, req, res, 'jobs.background', error);
        }
    });
    router.get('/events/stream', async (req, res) => {
        try {
            const user = (0,_utils_js__WEBPACK_IMPORTED_MODULE_5__.getUserContext)(req);
            const session = await runtime.sessions.assertSession((0,_utils_js__WEBPACK_IMPORTED_MODULE_5__.getSessionToken)(req), user);
            const channel = String(req.query?.channel ?? `extension:${session.extension.id}`);
            if (!await runtime.permissions.authorize(user, session, { resource: 'events.stream', target: channel })) {
                throw new Error(`Permission not granted: events.stream for ${channel}`);
            }
            res.setHeader('Content-Type', 'text/event-stream');
            res.setHeader('Cache-Control', 'no-cache');
            res.setHeader('Connection', 'keep-alive');
            res.write(': connected\n\n');
            const paths = (0,_store_authority_paths_js__WEBPACK_IMPORTED_MODULE_4__.getUserAuthorityPaths)(user);
            const cleanup = runtime.events.register(paths.controlDbFile, user.handle, channel, res);
            req.on?.('close', cleanup);
            req.on?.('end', cleanup);
        }
        catch (error) {
            fail(runtime, req, res, 'events.stream', error);
        }
    });
    router.get('/admin/policies', async (req, res) => {
        try {
            const user = (0,_utils_js__WEBPACK_IMPORTED_MODULE_5__.getUserContext)(req);
            if (!user.isAdmin) {
                throw new Error('Forbidden');
            }
            ok(res, await runtime.policies.getPolicies(user));
        }
        catch (error) {
            fail(runtime, req, res, 'third-party/st-authority-sdk', error);
        }
    });
    router.post('/admin/policies', async (req, res) => {
        try {
            const user = (0,_utils_js__WEBPACK_IMPORTED_MODULE_5__.getUserContext)(req);
            const result = await runtime.policies.saveGlobalPolicies(user, req.body ?? {});
            await runtime.audit.logUsage(user, 'third-party/st-authority-sdk', 'Policies updated');
            ok(res, result);
        }
        catch (error) {
            fail(runtime, req, res, 'third-party/st-authority-sdk', error);
        }
    });
    router.post('/admin/update', async (req, res) => {
        try {
            const user = (0,_utils_js__WEBPACK_IMPORTED_MODULE_5__.getUserContext)(req);
            if (!user.isAdmin) {
                throw new Error('Forbidden');
            }
            const action = parseAdminUpdateAction(req.body?.action);
            const before = runtime.install.getStatus();
            const coreBefore = runtime.core.getStatus();
            const shouldStopCore = action === 'git-pull' && (coreBefore.state === 'running' || coreBefore.state === 'starting' || coreBefore.state === 'error');
            let git = null;
            if (shouldStopCore) {
                await runtime.core.stop();
            }
            try {
                if (action === 'git-pull') {
                    git = runtime.install.pullLatestFromGit();
                }
                const after = await runtime.install.redeployBundledSdk();
                const core = await runtime.core.start();
                const coreRestarted = shouldStopCore && core.state === 'running';
                const requiresRestart = action === 'git-pull' && Boolean(git?.changed);
                const message = action === 'git-pull'
                    ? requiresRestart
                        ? '服务端插件已拉取最新提交，并已重新部署携带的前端插件。要应用新的 Node 服务端代码，请重启 SillyTavern 并刷新页面。'
                        : '服务端插件已经是最新版本，已重新校验并部署携带的前端插件。'
                    : '已重新部署携带的前端插件，并重新校验 Authority 后台服务状态。';
                const response = {
                    action,
                    message,
                    requiresRestart,
                    before,
                    after,
                    git,
                    core,
                    coreRestarted,
                    coreRestartMessage: coreRestarted
                        ? null
                        : core.state === 'running'
                            ? 'Authority 后台服务已保持运行。'
                            : `Authority 后台服务当前状态：${core.state}`,
                    updatedAt: new Date().toISOString(),
                };
                await runtime.audit.logUsage(user, 'third-party/st-authority-sdk', action === 'git-pull' ? 'Authority plugin updated' : 'Authority SDK redeployed');
                ok(res, response);
            }
            catch (error) {
                let recoveryMessage = '';
                try {
                    const recovery = await runtime.core.start();
                    recoveryMessage = recovery.state === 'running'
                        ? '更新失败后后台服务已恢复。'
                        : `更新失败后后台服务状态为 ${recovery.state}。`;
                }
                catch (recoveryError) {
                    recoveryMessage = `更新失败且后台服务恢复失败：${(0,_utils_js__WEBPACK_IMPORTED_MODULE_5__.asErrorMessage)(recoveryError)}`;
                }
                throw new Error(`${(0,_utils_js__WEBPACK_IMPORTED_MODULE_5__.asErrorMessage)(error)} ${recoveryMessage}`.trim());
            }
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
/* harmony import */ var _services_data_transfer_service_js__WEBPACK_IMPORTED_MODULE_3__ = __webpack_require__(/*! ./services/data-transfer-service.js */ "./src/services/data-transfer-service.ts");
/* harmony import */ var _services_extension_service_js__WEBPACK_IMPORTED_MODULE_4__ = __webpack_require__(/*! ./services/extension-service.js */ "./src/services/extension-service.ts");
/* harmony import */ var _services_http_service_js__WEBPACK_IMPORTED_MODULE_5__ = __webpack_require__(/*! ./services/http-service.js */ "./src/services/http-service.ts");
/* harmony import */ var _services_install_service_js__WEBPACK_IMPORTED_MODULE_6__ = __webpack_require__(/*! ./services/install-service.js */ "./src/services/install-service.ts");
/* harmony import */ var _services_job_service_js__WEBPACK_IMPORTED_MODULE_7__ = __webpack_require__(/*! ./services/job-service.js */ "./src/services/job-service.ts");
/* harmony import */ var _services_permission_service_js__WEBPACK_IMPORTED_MODULE_8__ = __webpack_require__(/*! ./services/permission-service.js */ "./src/services/permission-service.ts");
/* harmony import */ var _services_policy_service_js__WEBPACK_IMPORTED_MODULE_9__ = __webpack_require__(/*! ./services/policy-service.js */ "./src/services/policy-service.ts");
/* harmony import */ var _services_private_fs_service_js__WEBPACK_IMPORTED_MODULE_10__ = __webpack_require__(/*! ./services/private-fs-service.js */ "./src/services/private-fs-service.ts");
/* harmony import */ var _services_session_service_js__WEBPACK_IMPORTED_MODULE_11__ = __webpack_require__(/*! ./services/session-service.js */ "./src/services/session-service.ts");
/* harmony import */ var _services_storage_service_js__WEBPACK_IMPORTED_MODULE_12__ = __webpack_require__(/*! ./services/storage-service.js */ "./src/services/storage-service.ts");













function createAuthorityRuntime() {
    const core = new _services_core_service_js__WEBPACK_IMPORTED_MODULE_2__.CoreService();
    const events = new _events_sse_broker_js__WEBPACK_IMPORTED_MODULE_0__.SseBroker(core);
    const audit = new _services_audit_service_js__WEBPACK_IMPORTED_MODULE_1__.AuditService(core);
    const transfers = new _services_data_transfer_service_js__WEBPACK_IMPORTED_MODULE_3__.DataTransferService();
    const extensions = new _services_extension_service_js__WEBPACK_IMPORTED_MODULE_4__.ExtensionService(core);
    const install = new _services_install_service_js__WEBPACK_IMPORTED_MODULE_6__.InstallService();
    const policies = new _services_policy_service_js__WEBPACK_IMPORTED_MODULE_9__.PolicyService(core);
    const permissions = new _services_permission_service_js__WEBPACK_IMPORTED_MODULE_8__.PermissionService(policies, core);
    const sessions = new _services_session_service_js__WEBPACK_IMPORTED_MODULE_11__.SessionService(core);
    const storage = new _services_storage_service_js__WEBPACK_IMPORTED_MODULE_12__.StorageService(core);
    const files = new _services_private_fs_service_js__WEBPACK_IMPORTED_MODULE_10__.PrivateFsService(core);
    const http = new _services_http_service_js__WEBPACK_IMPORTED_MODULE_5__.HttpService(core);
    const jobs = new _services_job_service_js__WEBPACK_IMPORTED_MODULE_7__.JobService(core);
    return {
        events,
        audit,
        core,
        transfers,
        extensions,
        install,
        policies,
        permissions,
        sessions,
        storage,
        files,
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
    core;
    constructor(core) {
        this.core = core;
    }
    async logPermission(user, extensionId, message, details) {
        await this.log(user, {
            timestamp: (0,_utils_js__WEBPACK_IMPORTED_MODULE_2__.nowIso)(),
            kind: 'permission',
            extensionId,
            message,
            ...(details ? { details } : {}),
        });
    }
    async logUsage(user, extensionId, message, details) {
        await this.log(user, {
            timestamp: (0,_utils_js__WEBPACK_IMPORTED_MODULE_2__.nowIso)(),
            kind: 'usage',
            extensionId,
            message,
            ...(details ? { details } : {}),
        });
    }
    async logError(user, extensionId, message, details) {
        await this.log(user, {
            timestamp: (0,_utils_js__WEBPACK_IMPORTED_MODULE_2__.nowIso)(),
            kind: 'error',
            extensionId,
            message,
            ...(details ? { details } : {}),
        });
    }
    async getRecentActivity(user, extensionId) {
        const paths = (0,_store_authority_paths_js__WEBPACK_IMPORTED_MODULE_1__.getUserAuthorityPaths)(user);
        return await this.core.getRecentControlAudit(paths.controlDbFile, {
            userHandle: user.handle,
            extensionId,
            limit: _constants_js__WEBPACK_IMPORTED_MODULE_0__.MAX_AUDIT_LINES,
        });
    }
    async log(user, record) {
        const paths = (0,_store_authority_paths_js__WEBPACK_IMPORTED_MODULE_1__.getUserAuthorityPaths)(user);
        await this.core.logControlAudit(paths.controlDbFile, {
            userHandle: user.handle,
            record,
        });
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
/* harmony import */ var node_crypto__WEBPACK_IMPORTED_MODULE_1__ = __webpack_require__(/*! node:crypto */ "node:crypto");
/* harmony import */ var node_crypto__WEBPACK_IMPORTED_MODULE_1___default = /*#__PURE__*/__webpack_require__.n(node_crypto__WEBPACK_IMPORTED_MODULE_1__);
/* harmony import */ var node_net__WEBPACK_IMPORTED_MODULE_2__ = __webpack_require__(/*! node:net */ "node:net");
/* harmony import */ var node_net__WEBPACK_IMPORTED_MODULE_2___default = /*#__PURE__*/__webpack_require__.n(node_net__WEBPACK_IMPORTED_MODULE_2__);
/* harmony import */ var node_path__WEBPACK_IMPORTED_MODULE_3__ = __webpack_require__(/*! node:path */ "node:path");
/* harmony import */ var node_path__WEBPACK_IMPORTED_MODULE_3___default = /*#__PURE__*/__webpack_require__.n(node_path__WEBPACK_IMPORTED_MODULE_3__);
/* harmony import */ var node_process__WEBPACK_IMPORTED_MODULE_4__ = __webpack_require__(/*! node:process */ "node:process");
/* harmony import */ var node_process__WEBPACK_IMPORTED_MODULE_4___default = /*#__PURE__*/__webpack_require__.n(node_process__WEBPACK_IMPORTED_MODULE_4__);
/* harmony import */ var node_child_process__WEBPACK_IMPORTED_MODULE_5__ = __webpack_require__(/*! node:child_process */ "node:child_process");
/* harmony import */ var node_child_process__WEBPACK_IMPORTED_MODULE_5___default = /*#__PURE__*/__webpack_require__.n(node_child_process__WEBPACK_IMPORTED_MODULE_5__);
/* harmony import */ var _constants_js__WEBPACK_IMPORTED_MODULE_6__ = __webpack_require__(/*! ../constants.js */ "./src/constants.ts");
/* harmony import */ var _utils_js__WEBPACK_IMPORTED_MODULE_7__ = __webpack_require__(/*! ../utils.js */ "./src/utils.ts");








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
        this.runtimeDir = node_path__WEBPACK_IMPORTED_MODULE_3___default().resolve(options.runtimeDir ?? __dirname);
        this.cwd = node_path__WEBPACK_IMPORTED_MODULE_3___default().resolve(options.cwd ?? node_process__WEBPACK_IMPORTED_MODULE_4___default().cwd());
        this.env = options.env ?? (node_process__WEBPACK_IMPORTED_MODULE_4___default().env);
        this.logger = options.logger ?? console;
        this.status = {
            enabled: true,
            state: 'stopped',
            platform: (node_process__WEBPACK_IMPORTED_MODULE_4___default().platform),
            arch: (node_process__WEBPACK_IMPORTED_MODULE_4___default().arch),
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
                lastError: `Authority core binary not found under ${_constants_js__WEBPACK_IMPORTED_MODULE_6__.AUTHORITY_MANAGED_CORE_DIR}`,
                port: null,
                pid: null,
                startedAt: null,
                health: null,
            });
            return this.getStatus();
        }
        const port = await getAvailablePort();
        const token = (0,_utils_js__WEBPACK_IMPORTED_MODULE_7__.randomToken)();
        const child = (0,node_child_process__WEBPACK_IMPORTED_MODULE_5__.spawn)(artifact.binaryPath, [], {
            cwd: node_path__WEBPACK_IMPORTED_MODULE_3___default().dirname(artifact.binaryPath),
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
            const message = (0,_utils_js__WEBPACK_IMPORTED_MODULE_7__.asErrorMessage)(error);
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
            const message = (0,_utils_js__WEBPACK_IMPORTED_MODULE_7__.asErrorMessage)(error);
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
    async transactionSql(dbPath, request) {
        return await this.request('/v1/sql/transaction', {
            dbPath,
            statements: request.statements,
        });
    }
    async migrateSql(dbPath, request) {
        return await this.request('/v1/sql/migrate', {
            dbPath,
            migrations: request.migrations,
            tableName: request.tableName,
        });
    }
    async insertTrivium(dbPath, request) {
        return await this.request('/v1/trivium/insert', {
            ...buildTriviumOpenPayload(dbPath, request),
            vector: request.vector,
            payload: request.payload,
        });
    }
    async insertTriviumWithId(dbPath, request) {
        await this.request('/v1/trivium/insert-with-id', {
            ...buildTriviumOpenPayload(dbPath, request),
            id: request.id,
            vector: request.vector,
            payload: request.payload,
        });
    }
    async getTrivium(dbPath, request) {
        const response = await this.request('/v1/trivium/get', {
            ...buildTriviumOpenPayload(dbPath, request),
            id: request.id,
        });
        return response.node;
    }
    async updateTriviumPayload(dbPath, request) {
        await this.request('/v1/trivium/update-payload', {
            ...buildTriviumOpenPayload(dbPath, request),
            id: request.id,
            payload: request.payload,
        });
    }
    async updateTriviumVector(dbPath, request) {
        await this.request('/v1/trivium/update-vector', {
            ...buildTriviumOpenPayload(dbPath, request),
            id: request.id,
            vector: request.vector,
        });
    }
    async deleteTrivium(dbPath, request) {
        await this.request('/v1/trivium/delete', {
            ...buildTriviumOpenPayload(dbPath, request),
            id: request.id,
        });
    }
    async linkTrivium(dbPath, request) {
        await this.request('/v1/trivium/link', {
            ...buildTriviumOpenPayload(dbPath, request),
            src: request.src,
            dst: request.dst,
            label: request.label,
            weight: request.weight,
        });
    }
    async unlinkTrivium(dbPath, request) {
        await this.request('/v1/trivium/unlink', {
            ...buildTriviumOpenPayload(dbPath, request),
            src: request.src,
            dst: request.dst,
        });
    }
    async neighborsTrivium(dbPath, request) {
        return await this.request('/v1/trivium/neighbors', {
            ...buildTriviumOpenPayload(dbPath, request),
            id: request.id,
            depth: request.depth,
        });
    }
    async searchTrivium(dbPath, request) {
        const response = await this.request('/v1/trivium/search', {
            ...buildTriviumOpenPayload(dbPath, request),
            vector: request.vector,
            topK: request.topK,
            expandDepth: request.expandDepth,
            minScore: request.minScore,
        });
        return response.hits;
    }
    async searchAdvancedTrivium(dbPath, request) {
        const response = await this.request('/v1/trivium/search-advanced', {
            ...buildTriviumOpenPayload(dbPath, request),
            vector: request.vector,
            ...(request.queryText === undefined ? {} : { queryText: request.queryText }),
            ...(request.topK === undefined ? {} : { topK: request.topK }),
            ...(request.expandDepth === undefined ? {} : { expandDepth: request.expandDepth }),
            ...(request.minScore === undefined ? {} : { minScore: request.minScore }),
            ...(request.teleportAlpha === undefined ? {} : { teleportAlpha: request.teleportAlpha }),
            ...(request.enableAdvancedPipeline === undefined ? {} : { enableAdvancedPipeline: request.enableAdvancedPipeline }),
            ...(request.enableSparseResidual === undefined ? {} : { enableSparseResidual: request.enableSparseResidual }),
            ...(request.fistaLambda === undefined ? {} : { fistaLambda: request.fistaLambda }),
            ...(request.fistaThreshold === undefined ? {} : { fistaThreshold: request.fistaThreshold }),
            ...(request.enableDpp === undefined ? {} : { enableDpp: request.enableDpp }),
            ...(request.dppQualityWeight === undefined ? {} : { dppQualityWeight: request.dppQualityWeight }),
            ...(request.enableRefractoryFatigue === undefined ? {} : { enableRefractoryFatigue: request.enableRefractoryFatigue }),
            ...(request.enableInverseInhibition === undefined ? {} : { enableInverseInhibition: request.enableInverseInhibition }),
            ...(request.lateralInhibitionThreshold === undefined ? {} : { lateralInhibitionThreshold: request.lateralInhibitionThreshold }),
            ...(request.enableBqCoarseSearch === undefined ? {} : { enableBqCoarseSearch: request.enableBqCoarseSearch }),
            ...(request.bqCandidateRatio === undefined ? {} : { bqCandidateRatio: request.bqCandidateRatio }),
            ...(request.textBoost === undefined ? {} : { textBoost: request.textBoost }),
            ...(request.enableTextHybridSearch === undefined ? {} : { enableTextHybridSearch: request.enableTextHybridSearch }),
            ...(request.bm25K1 === undefined ? {} : { bm25K1: request.bm25K1 }),
            ...(request.bm25B === undefined ? {} : { bm25B: request.bm25B }),
            ...(request.payloadFilter === undefined ? {} : { payloadFilter: request.payloadFilter }),
        });
        return response.hits;
    }
    async searchHybridTrivium(dbPath, request) {
        const response = await this.request('/v1/trivium/search-hybrid', {
            ...buildTriviumOpenPayload(dbPath, request),
            vector: request.vector,
            queryText: request.queryText,
            ...(request.topK === undefined ? {} : { topK: request.topK }),
            ...(request.expandDepth === undefined ? {} : { expandDepth: request.expandDepth }),
            ...(request.minScore === undefined ? {} : { minScore: request.minScore }),
            ...(request.hybridAlpha === undefined ? {} : { hybridAlpha: request.hybridAlpha }),
            ...(request.payloadFilter === undefined ? {} : { payloadFilter: request.payloadFilter }),
        });
        return response.hits;
    }
    async filterWhereTrivium(dbPath, request) {
        const response = await this.request('/v1/trivium/filter-where', {
            ...buildTriviumOpenPayload(dbPath, request),
            condition: request.condition,
        });
        return response.nodes;
    }
    async queryTrivium(dbPath, request) {
        const response = await this.request('/v1/trivium/query', {
            ...buildTriviumOpenPayload(dbPath, request),
            cypher: request.cypher,
        });
        return response.rows;
    }
    async indexTextTrivium(dbPath, request) {
        await this.request('/v1/trivium/index-text', {
            ...buildTriviumOpenPayload(dbPath, request),
            id: request.id,
            text: request.text,
        });
    }
    async indexKeywordTrivium(dbPath, request) {
        await this.request('/v1/trivium/index-keyword', {
            ...buildTriviumOpenPayload(dbPath, request),
            id: request.id,
            keyword: request.keyword,
        });
    }
    async buildTextIndexTrivium(dbPath, request = {}) {
        await this.request('/v1/trivium/build-text-index', buildTriviumOpenPayload(dbPath, request));
    }
    async flushTrivium(dbPath, request = {}) {
        await this.request('/v1/trivium/flush', buildTriviumOpenPayload(dbPath, request));
    }
    async statTrivium(dbPath, request = {}) {
        return await this.request('/v1/trivium/stat', buildTriviumOpenPayload(dbPath, request));
    }
    async initializeControlSession(dbPath, sessionToken, timestamp, user, config) {
        return await this.request('/v1/control/session/init', {
            dbPath,
            sessionToken,
            timestamp,
            user,
            config,
        });
    }
    async getControlSession(dbPath, userHandle, sessionToken) {
        const response = await this.request('/v1/control/session/get', {
            dbPath,
            userHandle,
            sessionToken,
        });
        return response.session;
    }
    async listControlExtensions(dbPath, userHandle) {
        const response = await this.request('/v1/control/extensions/list', {
            dbPath,
            userHandle,
        });
        return response.extensions;
    }
    async getControlExtension(dbPath, request) {
        const response = await this.request('/v1/control/extensions/get', {
            dbPath,
            ...request,
        });
        return response.extension;
    }
    async logControlAudit(dbPath, request) {
        await this.request('/v1/control/audit/log', {
            dbPath,
            ...request,
        });
    }
    async getRecentControlAudit(dbPath, request) {
        return await this.request('/v1/control/audit/recent', {
            dbPath,
            ...request,
        });
    }
    async listControlGrants(dbPath, request) {
        const response = await this.request('/v1/control/grants/list', {
            dbPath,
            ...request,
        });
        return response.grants;
    }
    async getControlGrant(dbPath, request) {
        const response = await this.request('/v1/control/grants/get', {
            dbPath,
            ...request,
        });
        return response.grant;
    }
    async upsertControlGrant(dbPath, request) {
        const response = await this.request('/v1/control/grants/upsert', {
            dbPath,
            ...request,
        });
        if (!response.grant) {
            throw new Error('Control grant upsert returned no grant');
        }
        return response.grant;
    }
    async resetControlGrants(dbPath, request) {
        await this.request('/v1/control/grants/reset', {
            dbPath,
            ...request,
        });
    }
    async getControlPolicies(dbPath, request) {
        return await this.request('/v1/control/policies/get', {
            dbPath,
            ...request,
        });
    }
    async saveControlPolicies(dbPath, request) {
        return await this.request('/v1/control/policies/save', {
            dbPath,
            ...request,
        });
    }
    async getStorageKv(dbPath, request) {
        const response = await this.request('/v1/storage/kv/get', {
            dbPath,
            ...request,
        });
        return response.value;
    }
    async setStorageKv(dbPath, request) {
        await this.request('/v1/storage/kv/set', {
            dbPath,
            ...request,
        });
    }
    async deleteStorageKv(dbPath, request) {
        await this.request('/v1/storage/kv/delete', {
            dbPath,
            ...request,
        });
    }
    async listStorageKv(dbPath, request = {}) {
        const response = await this.request('/v1/storage/kv/list', {
            dbPath,
            ...request,
        });
        return response.entries;
    }
    async putStorageBlob(dbPath, request) {
        return await this.request('/v1/storage/blob/put', {
            dbPath,
            ...request,
        });
    }
    async getStorageBlob(dbPath, request) {
        return await this.request('/v1/storage/blob/get', {
            dbPath,
            ...request,
        });
    }
    async openStorageBlobRead(dbPath, request) {
        return await this.request('/v1/storage/blob/open-read', {
            dbPath,
            ...request,
        });
    }
    async deleteStorageBlob(dbPath, request) {
        await this.request('/v1/storage/blob/delete', {
            dbPath,
            ...request,
        });
    }
    async listStorageBlobs(dbPath, request) {
        const response = await this.request('/v1/storage/blob/list', {
            dbPath,
            ...request,
        });
        return response.entries;
    }
    async mkdirPrivateFile(request) {
        const response = await this.request('/v1/fs/private/mkdir', request);
        return response.entry;
    }
    async readPrivateDir(request) {
        const response = await this.request('/v1/fs/private/read-dir', request);
        return response.entries;
    }
    async writePrivateFile(request) {
        const response = await this.request('/v1/fs/private/write-file', request);
        return response.entry;
    }
    async readPrivateFile(request) {
        return await this.request('/v1/fs/private/read-file', request);
    }
    async openPrivateFileRead(request) {
        return await this.request('/v1/fs/private/open-read', request);
    }
    async deletePrivateFile(request) {
        const response = await this.request('/v1/fs/private/delete', request);
        if (!response.ok) {
            throw new Error('Private file delete returned unsuccessful response');
        }
    }
    async statPrivateFile(request) {
        const response = await this.request('/v1/fs/private/stat', request);
        return response.entry;
    }
    async fetchHttp(request) {
        return await this.request('/v1/http/fetch', request);
    }
    async openHttpFetch(request) {
        return await this.request('/v1/http/fetch-open', request);
    }
    async listControlJobs(dbPath, request) {
        const response = await this.request('/v1/control/jobs/list', {
            dbPath,
            ...request,
        });
        return response.jobs;
    }
    async getControlJob(dbPath, request) {
        const response = await this.request('/v1/control/jobs/get', {
            dbPath,
            ...request,
        });
        return response.job;
    }
    async createControlJob(dbPath, request) {
        const response = await this.request('/v1/control/jobs/create', {
            dbPath,
            ...request,
        });
        if (!response.job) {
            throw new Error('Control job create returned no job');
        }
        return response.job;
    }
    async cancelControlJob(dbPath, request) {
        const response = await this.request('/v1/control/jobs/cancel', {
            dbPath,
            ...request,
        });
        if (!response.job) {
            throw new Error('Control job cancel returned no job');
        }
        return response.job;
    }
    async upsertControlJob(dbPath, request) {
        const response = await this.request('/v1/control/jobs/upsert', {
            dbPath,
            ...request,
        });
        if (!response.job) {
            throw new Error('Control job upsert returned no job');
        }
        return response.job;
    }
    async pollControlEvents(dbPath, request) {
        const response = await this.request('/v1/control/events/poll', {
            dbPath,
            ...request,
        });
        return {
            events: response.events,
            cursor: response.cursor,
        };
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
            candidates.add(node_path__WEBPACK_IMPORTED_MODULE_3___default().resolve(explicitRoot));
        }
        for (const origin of [this.runtimeDir, this.cwd]) {
            let current = node_path__WEBPACK_IMPORTED_MODULE_3___default().resolve(origin);
            while (true) {
                candidates.add(node_path__WEBPACK_IMPORTED_MODULE_3___default().join(current, _constants_js__WEBPACK_IMPORTED_MODULE_6__.AUTHORITY_MANAGED_CORE_DIR));
                const parent = node_path__WEBPACK_IMPORTED_MODULE_3___default().dirname(current);
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
    const platformDir = node_path__WEBPACK_IMPORTED_MODULE_3___default().join(root, `${(node_process__WEBPACK_IMPORTED_MODULE_4___default().platform)}-${(node_process__WEBPACK_IMPORTED_MODULE_4___default().arch)}`);
    const metadataPath = node_path__WEBPACK_IMPORTED_MODULE_3___default().join(platformDir, 'authority-core.json');
    if (!node_fs__WEBPACK_IMPORTED_MODULE_0___default().existsSync(metadataPath)) {
        return null;
    }
    let metadata;
    try {
        metadata = JSON.parse(node_fs__WEBPACK_IMPORTED_MODULE_0___default().readFileSync(metadataPath, 'utf8'));
    }
    catch {
        return null;
    }
    if (metadata.managedBy !== 'authority' || metadata.platform !== (node_process__WEBPACK_IMPORTED_MODULE_4___default().platform) || metadata.arch !== (node_process__WEBPACK_IMPORTED_MODULE_4___default().arch)) {
        return null;
    }
    const binaryPath = node_path__WEBPACK_IMPORTED_MODULE_3___default().join(platformDir, metadata.binaryName);
    if (!node_fs__WEBPACK_IMPORTED_MODULE_0___default().existsSync(binaryPath)) {
        return null;
    }
    const binarySha256 = node_crypto__WEBPACK_IMPORTED_MODULE_1___default().createHash('sha256').update(node_fs__WEBPACK_IMPORTED_MODULE_0___default().readFileSync(binaryPath)).digest('hex');
    if (metadata.binarySha256 !== binarySha256) {
        return null;
    }
    return {
        binaryPath,
        metadata,
    };
}
function buildTriviumOpenPayload(dbPath, request) {
    return {
        dbPath,
        ...(request.dim === undefined ? {} : { dim: request.dim }),
        ...(request.dtype === undefined ? {} : { dtype: request.dtype }),
        ...(request.syncMode === undefined ? {} : { syncMode: request.syncMode }),
        ...(request.storageMode === undefined ? {} : { storageMode: request.storageMode }),
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
        const server = node_net__WEBPACK_IMPORTED_MODULE_2___default().createServer();
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

/***/ "./src/services/data-transfer-service.ts"
/*!***********************************************!*\
  !*** ./src/services/data-transfer-service.ts ***!
  \***********************************************/
(__unused_webpack_module, __webpack_exports__, __webpack_require__) {

__webpack_require__.r(__webpack_exports__);
/* harmony export */ __webpack_require__.d(__webpack_exports__, {
/* harmony export */   DataTransferService: () => (/* binding */ DataTransferService)
/* harmony export */ });
/* harmony import */ var node_crypto__WEBPACK_IMPORTED_MODULE_0__ = __webpack_require__(/*! node:crypto */ "node:crypto");
/* harmony import */ var node_crypto__WEBPACK_IMPORTED_MODULE_0___default = /*#__PURE__*/__webpack_require__.n(node_crypto__WEBPACK_IMPORTED_MODULE_0__);
/* harmony import */ var node_fs__WEBPACK_IMPORTED_MODULE_1__ = __webpack_require__(/*! node:fs */ "node:fs");
/* harmony import */ var node_fs__WEBPACK_IMPORTED_MODULE_1___default = /*#__PURE__*/__webpack_require__.n(node_fs__WEBPACK_IMPORTED_MODULE_1__);
/* harmony import */ var node_path__WEBPACK_IMPORTED_MODULE_2__ = __webpack_require__(/*! node:path */ "node:path");
/* harmony import */ var node_path__WEBPACK_IMPORTED_MODULE_2___default = /*#__PURE__*/__webpack_require__.n(node_path__WEBPACK_IMPORTED_MODULE_2__);
/* harmony import */ var _constants_js__WEBPACK_IMPORTED_MODULE_3__ = __webpack_require__(/*! ../constants.js */ "./src/constants.ts");
/* harmony import */ var _store_authority_paths_js__WEBPACK_IMPORTED_MODULE_4__ = __webpack_require__(/*! ../store/authority-paths.js */ "./src/store/authority-paths.ts");
/* harmony import */ var _utils_js__WEBPACK_IMPORTED_MODULE_5__ = __webpack_require__(/*! ../utils.js */ "./src/utils.ts");






class DataTransferService {
    transfers = new Map();
    async init(user, extensionId, request) {
        const resource = normalizeTransferResource(request.resource);
        const transferId = node_crypto__WEBPACK_IMPORTED_MODULE_0___default().randomUUID();
        const timestamp = new Date().toISOString();
        const dirPath = this.getTransferDir(user, extensionId, resource);
        node_fs__WEBPACK_IMPORTED_MODULE_1___default().mkdirSync(dirPath, { recursive: true });
        const filePath = node_path__WEBPACK_IMPORTED_MODULE_2___default().join(dirPath, `${transferId}.part`);
        node_fs__WEBPACK_IMPORTED_MODULE_1___default().writeFileSync(filePath, Buffer.alloc(0));
        const record = {
            transferId,
            userHandle: user.handle,
            extensionId,
            resource,
            filePath,
            sizeBytes: 0,
            maxBytes: _constants_js__WEBPACK_IMPORTED_MODULE_3__.MAX_DATA_TRANSFER_BYTES,
            createdAt: timestamp,
            updatedAt: timestamp,
            direction: 'upload',
            ownedFile: true,
        };
        this.transfers.set(transferId, record);
        return toInitResponse(record);
    }
    async append(user, extensionId, transferId, request) {
        const record = this.get(user, extensionId, transferId);
        if (record.direction !== 'upload') {
            throw new Error('Transfer does not accept append operations');
        }
        if (request.offset !== record.sizeBytes) {
            throw new Error(`Transfer offset mismatch: expected ${record.sizeBytes}, received ${request.offset}`);
        }
        const chunk = decodeTransferChunk(request.content);
        const nextSize = record.sizeBytes + chunk.byteLength;
        if (nextSize > record.maxBytes) {
            throw new Error(`Transfer exceeds ${record.maxBytes} bytes`);
        }
        node_fs__WEBPACK_IMPORTED_MODULE_1___default().appendFileSync(record.filePath, chunk);
        record.sizeBytes = nextSize;
        record.updatedAt = new Date().toISOString();
        return {
            transferId: record.transferId,
            sizeBytes: record.sizeBytes,
            updatedAt: record.updatedAt,
        };
    }
    async openRead(user, extensionId, request) {
        const resource = normalizeTransferResource(request.resource);
        const { filePath, sizeBytes } = validateReadableTransferFile(request.sourcePath);
        if (sizeBytes > _constants_js__WEBPACK_IMPORTED_MODULE_3__.MAX_DATA_TRANSFER_BYTES) {
            throw new Error(`Transfer exceeds ${_constants_js__WEBPACK_IMPORTED_MODULE_3__.MAX_DATA_TRANSFER_BYTES} bytes`);
        }
        const transferId = node_crypto__WEBPACK_IMPORTED_MODULE_0___default().randomUUID();
        const timestamp = new Date().toISOString();
        const record = {
            transferId,
            userHandle: user.handle,
            extensionId,
            resource,
            filePath,
            sizeBytes,
            maxBytes: sizeBytes,
            createdAt: timestamp,
            updatedAt: timestamp,
            direction: 'download',
            ownedFile: false,
        };
        this.transfers.set(transferId, record);
        return toInitResponse(record);
    }
    async promoteToDownload(user, extensionId, transferId) {
        const record = this.get(user, extensionId, transferId);
        if (record.direction !== 'upload') {
            throw new Error('Transfer is already readable');
        }
        const { filePath, sizeBytes } = validateReadableTransferFile(record.filePath);
        if (sizeBytes > _constants_js__WEBPACK_IMPORTED_MODULE_3__.MAX_DATA_TRANSFER_BYTES) {
            throw new Error(`Transfer exceeds ${_constants_js__WEBPACK_IMPORTED_MODULE_3__.MAX_DATA_TRANSFER_BYTES} bytes`);
        }
        record.filePath = filePath;
        record.sizeBytes = sizeBytes;
        record.maxBytes = sizeBytes;
        record.direction = 'download';
        record.updatedAt = new Date().toISOString();
        return toInitResponse(record);
    }
    async read(user, extensionId, transferId, request) {
        const record = this.get(user, extensionId, transferId);
        if (record.direction !== 'download') {
            throw new Error('Transfer does not support read operations');
        }
        if (!Number.isInteger(request.offset) || request.offset < 0) {
            throw new Error('Transfer offset must be a non-negative integer');
        }
        if (request.offset > record.sizeBytes) {
            throw new Error(`Transfer offset exceeds size ${record.sizeBytes}`);
        }
        const remaining = record.sizeBytes - request.offset;
        const requestedLimit = request.limit ?? _constants_js__WEBPACK_IMPORTED_MODULE_3__.DATA_TRANSFER_CHUNK_BYTES;
        if (!Number.isInteger(requestedLimit) || requestedLimit < 0) {
            throw new Error('Transfer limit must be a non-negative integer');
        }
        const limit = Math.min(requestedLimit, _constants_js__WEBPACK_IMPORTED_MODULE_3__.DATA_TRANSFER_CHUNK_BYTES, remaining);
        if (limit === 0) {
            return {
                transferId: record.transferId,
                offset: request.offset,
                content: '',
                encoding: 'base64',
                sizeBytes: record.sizeBytes,
                eof: true,
                updatedAt: record.updatedAt,
            };
        }
        const handle = node_fs__WEBPACK_IMPORTED_MODULE_1___default().openSync(record.filePath, 'r');
        try {
            const buffer = Buffer.alloc(limit);
            const bytesRead = node_fs__WEBPACK_IMPORTED_MODULE_1___default().readSync(handle, buffer, 0, limit, request.offset);
            return {
                transferId: record.transferId,
                offset: request.offset,
                content: buffer.subarray(0, bytesRead).toString('base64'),
                encoding: 'base64',
                sizeBytes: record.sizeBytes,
                eof: request.offset + bytesRead >= record.sizeBytes,
                updatedAt: record.updatedAt,
            };
        }
        finally {
            node_fs__WEBPACK_IMPORTED_MODULE_1___default().closeSync(handle);
        }
    }
    get(user, extensionId, transferId, resource) {
        const record = this.transfers.get(transferId);
        if (!record || record.userHandle !== user.handle || record.extensionId !== extensionId) {
            throw new Error('Transfer not found');
        }
        if (resource && record.resource !== resource) {
            throw new Error(`Transfer resource mismatch: expected ${resource}, received ${record.resource}`);
        }
        return record;
    }
    async discard(user, extensionId, transferId) {
        const record = this.get(user, extensionId, transferId);
        this.transfers.delete(transferId);
        if (!record.ownedFile) {
            return;
        }
        try {
            node_fs__WEBPACK_IMPORTED_MODULE_1___default().rmSync(record.filePath, { force: true });
        }
        finally {
            pruneEmptyTransferDirs(node_path__WEBPACK_IMPORTED_MODULE_2___default().dirname(record.filePath));
        }
    }
    getTransferDir(user, extensionId, resource) {
        const paths = (0,_store_authority_paths_js__WEBPACK_IMPORTED_MODULE_4__.getUserAuthorityPaths)(user);
        const stateDir = node_path__WEBPACK_IMPORTED_MODULE_2___default().dirname(paths.controlDbFile);
        return node_path__WEBPACK_IMPORTED_MODULE_2___default().join(stateDir, 'transfers', (0,_utils_js__WEBPACK_IMPORTED_MODULE_5__.sanitizeFileSegment)(extensionId), (0,_utils_js__WEBPACK_IMPORTED_MODULE_5__.sanitizeFileSegment)(resource));
    }
}
function toInitResponse(record) {
    return {
        transferId: record.transferId,
        resource: record.resource,
        chunkSize: _constants_js__WEBPACK_IMPORTED_MODULE_3__.DATA_TRANSFER_CHUNK_BYTES,
        maxBytes: record.maxBytes,
        createdAt: record.createdAt,
        updatedAt: record.updatedAt,
        sizeBytes: record.sizeBytes,
    };
}
function normalizeTransferResource(resource) {
    if (resource === 'storage.blob' || resource === 'fs.private' || resource === 'http.fetch') {
        return resource;
    }
    throw new Error(`Unsupported transfer resource: ${String(resource)}`);
}
function decodeTransferChunk(content) {
    try {
        return Buffer.from(content, 'base64');
    }
    catch {
        throw new Error('Invalid transfer chunk encoding');
    }
}
function validateReadableTransferFile(sourcePath) {
    const filePath = sourcePath.trim();
    if (!filePath) {
        throw new Error('Transfer source path is required');
    }
    let metadata;
    try {
        metadata = node_fs__WEBPACK_IMPORTED_MODULE_1___default().lstatSync(filePath);
    }
    catch {
        throw new Error('Transfer source file not found');
    }
    if (metadata.isSymbolicLink()) {
        throw new Error('Transfer source symlink is not allowed');
    }
    if (!metadata.isFile()) {
        throw new Error('Transfer source must be a file');
    }
    return {
        filePath,
        sizeBytes: metadata.size,
    };
}
function pruneEmptyTransferDirs(dirPath) {
    let current = dirPath;
    for (let index = 0; index < 3; index += 1) {
        try {
            node_fs__WEBPACK_IMPORTED_MODULE_1___default().rmdirSync(current);
        }
        catch {
            return;
        }
        const parent = node_path__WEBPACK_IMPORTED_MODULE_2___default().dirname(current);
        if (parent === current) {
            return;
        }
        current = parent;
    }
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

class ExtensionService {
    core;
    constructor(core) {
        this.core = core;
    }
    async listExtensions(user) {
        const paths = (0,_store_authority_paths_js__WEBPACK_IMPORTED_MODULE_0__.getUserAuthorityPaths)(user);
        return await this.core.listControlExtensions(paths.controlDbFile, user.handle);
    }
    async getExtension(user, extensionId) {
        const paths = (0,_store_authority_paths_js__WEBPACK_IMPORTED_MODULE_0__.getUserAuthorityPaths)(user);
        return await this.core.getControlExtension(paths.controlDbFile, {
            userHandle: user.handle,
            extensionId,
        });
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
class HttpService {
    core;
    constructor(core) {
        this.core = core;
    }
    async fetch(_user, input) {
        return await this.core.fetchHttp(input);
    }
    async openFetch(_user, input) {
        return await this.core.openHttpFetch(input);
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
/* harmony import */ var node_child_process__WEBPACK_IMPORTED_MODULE_1__ = __webpack_require__(/*! node:child_process */ "node:child_process");
/* harmony import */ var node_child_process__WEBPACK_IMPORTED_MODULE_1___default = /*#__PURE__*/__webpack_require__.n(node_child_process__WEBPACK_IMPORTED_MODULE_1__);
/* harmony import */ var node_fs__WEBPACK_IMPORTED_MODULE_2__ = __webpack_require__(/*! node:fs */ "node:fs");
/* harmony import */ var node_fs__WEBPACK_IMPORTED_MODULE_2___default = /*#__PURE__*/__webpack_require__.n(node_fs__WEBPACK_IMPORTED_MODULE_2__);
/* harmony import */ var node_path__WEBPACK_IMPORTED_MODULE_3__ = __webpack_require__(/*! node:path */ "node:path");
/* harmony import */ var node_path__WEBPACK_IMPORTED_MODULE_3___default = /*#__PURE__*/__webpack_require__.n(node_path__WEBPACK_IMPORTED_MODULE_3__);
/* harmony import */ var _constants_js__WEBPACK_IMPORTED_MODULE_4__ = __webpack_require__(/*! ../constants.js */ "./src/constants.ts");
/* harmony import */ var _utils_js__WEBPACK_IMPORTED_MODULE_5__ = __webpack_require__(/*! ../utils.js */ "./src/utils.ts");






const DEFAULT_VERSION = '0.0.0-dev';
const TEXT_HASH_EXTENSIONS = new Set([
    '.cjs',
    '.css',
    '.html',
    '.js',
    '.json',
    '.map',
    '.md',
    '.mjs',
    '.svg',
    '.txt',
    '.yaml',
    '.yml',
]);
class InstallService {
    runtimeDir;
    pluginRoot;
    cwd;
    env;
    logger;
    releaseMetadata;
    status;
    constructor(options = {}) {
        this.runtimeDir = node_path__WEBPACK_IMPORTED_MODULE_3___default().resolve(options.runtimeDir ?? __dirname);
        this.pluginRoot = resolvePluginRoot(this.runtimeDir);
        this.cwd = node_path__WEBPACK_IMPORTED_MODULE_3___default().resolve(options.cwd ?? process.cwd());
        this.env = options.env ?? process.env;
        this.logger = options.logger ?? console;
        this.releaseMetadata = readReleaseMetadata(this.pluginRoot);
        const expectedCorePlatform = getCurrentCorePlatform();
        this.status = {
            installStatus: 'missing',
            installMessage: 'Authority SDK deployment has not run yet.',
            pluginVersion: this.getPluginVersion(),
            sdkBundledVersion: this.getBundledSdkVersion(),
            sdkDeployedVersion: null,
            coreBundledVersion: this.releaseMetadata?.coreVersion ?? null,
            coreArtifactPlatform: this.getCoreArtifactPlatforms().includes(expectedCorePlatform)
                ? expectedCorePlatform
                : this.releaseMetadata?.coreArtifactPlatform ?? null,
            coreArtifactPlatforms: this.getCoreArtifactPlatforms(),
            coreArtifactHash: this.releaseMetadata?.coreArtifactHash ?? null,
            coreBinarySha256: this.releaseMetadata?.coreArtifacts?.[expectedCorePlatform]?.binarySha256
                ?? this.releaseMetadata?.coreBinarySha256
                ?? null,
            coreVerified: false,
            coreMessage: null,
        };
    }
    getStatus() {
        return {
            ...this.status,
            coreArtifactPlatforms: [...this.status.coreArtifactPlatforms],
        };
    }
    async bootstrap() {
        this.refreshReleaseMetadata();
        const bundledDir = node_path__WEBPACK_IMPORTED_MODULE_3___default().join(this.pluginRoot, _constants_js__WEBPACK_IMPORTED_MODULE_4__.AUTHORITY_MANAGED_SDK_DIR);
        try {
            if (!this.releaseMetadata || !node_fs__WEBPACK_IMPORTED_MODULE_2___default().existsSync(bundledDir)) {
                return this.setStatus('missing', 'Managed Authority SDK bundle is not embedded in this plugin build.', {
                    sdkDeployedVersion: null,
                    coreVerified: false,
                    coreMessage: 'Managed Authority SDK bundle is not embedded in this plugin build.',
                });
            }
            const coreCheck = this.verifyBundledCore();
            const coreVerified = coreCheck.ok;
            const coreMessage = coreCheck.ok ? coreCheck.message : coreCheck.message;
            const sillyTavernRoot = this.resolveSillyTavernRoot();
            if (!sillyTavernRoot) {
                return this.setStatus('missing', 'Unable to resolve the SillyTavern root for managed SDK deployment.', {
                    sdkDeployedVersion: null,
                    coreVerified,
                    coreMessage,
                });
            }
            const targetDir = node_path__WEBPACK_IMPORTED_MODULE_3___default().join(sillyTavernRoot, 'public', 'scripts', 'extensions', 'third-party', 'st-authority-sdk');
            const managedFile = node_path__WEBPACK_IMPORTED_MODULE_3___default().join(targetDir, _constants_js__WEBPACK_IMPORTED_MODULE_4__.AUTHORITY_MANAGED_FILE);
            const existingManaged = (0,_utils_js__WEBPACK_IMPORTED_MODULE_5__.readJsonFile)(managedFile, null);
            if (!node_fs__WEBPACK_IMPORTED_MODULE_2___default().existsSync(targetDir)) {
                this.deployBundledSdk(bundledDir, targetDir);
                return this.setStatus('installed', buildInstallMessage('deployed', targetDir, coreCheck), {
                    sdkDeployedVersion: this.releaseMetadata.sdkVersion,
                    coreVerified,
                    coreMessage,
                });
            }
            if (!existingManaged || existingManaged.managedBy !== _constants_js__WEBPACK_IMPORTED_MODULE_4__.AUTHORITY_PLUGIN_ID) {
                return this.setStatus('conflict', `Authority SDK target already exists and is not managed by ${_constants_js__WEBPACK_IMPORTED_MODULE_4__.AUTHORITY_PLUGIN_ID}.`, {
                    sdkDeployedVersion: null,
                    coreVerified,
                    coreMessage,
                });
            }
            const currentHash = hashDirectory(targetDir, new Set([_constants_js__WEBPACK_IMPORTED_MODULE_4__.AUTHORITY_MANAGED_FILE]));
            const needsUpdate = existingManaged.sdkVersion !== this.releaseMetadata.sdkVersion
                || existingManaged.assetHash !== this.releaseMetadata.assetHash
                || currentHash !== this.releaseMetadata.assetHash;
            if (needsUpdate) {
                this.deployBundledSdk(bundledDir, targetDir);
                return this.setStatus('updated', buildInstallMessage('updated', targetDir, coreCheck), {
                    sdkDeployedVersion: this.releaseMetadata.sdkVersion,
                    coreVerified,
                    coreMessage,
                });
            }
            return this.setStatus('ready', buildInstallMessage('ready', targetDir, coreCheck), {
                sdkDeployedVersion: existingManaged.sdkVersion,
                coreVerified,
                coreMessage,
            });
        }
        catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            this.logger.error(`[authority] Managed SDK deployment failed: ${message}`);
            return this.setStatus('error', message, {
                sdkDeployedVersion: null,
                coreVerified: false,
                coreMessage: message,
            });
        }
    }
    getPluginRoot() {
        return this.pluginRoot;
    }
    redeployBundledSdk() {
        return this.bootstrap();
    }
    pullLatestFromGit() {
        if (!node_fs__WEBPACK_IMPORTED_MODULE_2___default().existsSync(node_path__WEBPACK_IMPORTED_MODULE_3___default().join(this.pluginRoot, '.git'))) {
            throw new Error('当前 Authority 插件目录不是 Git 仓库，无法执行服务端插件更新。');
        }
        const branch = runGit(this.pluginRoot, ['rev-parse', '--abbrev-ref', 'HEAD'], this.env).stdout || null;
        const previousRevision = runGit(this.pluginRoot, ['rev-parse', 'HEAD'], this.env).stdout || null;
        const pullResult = runGit(this.pluginRoot, ['pull', '--ff-only'], this.env, true);
        const currentRevision = runGit(this.pluginRoot, ['rev-parse', 'HEAD'], this.env).stdout || null;
        this.refreshReleaseMetadata();
        return {
            pluginRoot: this.pluginRoot,
            branch,
            previousRevision,
            currentRevision,
            changed: previousRevision !== currentRevision,
            stdout: pullResult.stdout || null,
            stderr: pullResult.stderr || null,
        };
    }
    refreshReleaseMetadata() {
        this.releaseMetadata = readReleaseMetadata(this.pluginRoot);
        this.status = {
            ...this.status,
            pluginVersion: this.getPluginVersion(),
            sdkBundledVersion: this.getBundledSdkVersion(),
            coreBundledVersion: this.releaseMetadata?.coreVersion ?? null,
            coreArtifactPlatform: this.getResolvedCoreArtifactPlatform(),
            coreArtifactPlatforms: this.getCoreArtifactPlatforms(),
            coreArtifactHash: this.releaseMetadata?.coreArtifactHash ?? null,
            coreBinarySha256: this.getCoreBinarySha256(),
        };
    }
    getPluginVersion() {
        return this.releaseMetadata?.pluginVersion ?? readPackageVersion(this.pluginRoot) ?? DEFAULT_VERSION;
    }
    getBundledSdkVersion() {
        return this.releaseMetadata?.sdkVersion ?? readBundledSdkVersion(this.pluginRoot) ?? this.getPluginVersion();
    }
    getCoreArtifactPlatforms() {
        return getReleaseCorePlatforms(this.releaseMetadata);
    }
    getResolvedCoreArtifactPlatform() {
        const expectedCorePlatform = getCurrentCorePlatform();
        const coreArtifactPlatforms = this.getCoreArtifactPlatforms();
        return coreArtifactPlatforms.includes(expectedCorePlatform)
            ? expectedCorePlatform
            : this.releaseMetadata?.coreArtifactPlatform ?? null;
    }
    getCoreBinarySha256() {
        const expectedCorePlatform = getCurrentCorePlatform();
        return this.releaseMetadata?.coreArtifacts?.[expectedCorePlatform]?.binarySha256
            ?? this.releaseMetadata?.coreBinarySha256
            ?? null;
    }
    resolveSillyTavernRoot() {
        const envRoot = this.env.AUTHORITY_ST_ROOT?.trim();
        const candidates = [
            this.cwd,
            node_path__WEBPACK_IMPORTED_MODULE_3___default().resolve(this.pluginRoot, '..', '..'),
            envRoot ? node_path__WEBPACK_IMPORTED_MODULE_3___default().resolve(envRoot) : null,
        ];
        for (const candidate of candidates) {
            if (candidate && isSillyTavernRoot(candidate)) {
                return candidate;
            }
        }
        return null;
    }
    deployBundledSdk(bundledDir, targetDir) {
        const parentDir = node_path__WEBPACK_IMPORTED_MODULE_3___default().dirname(targetDir);
        node_fs__WEBPACK_IMPORTED_MODULE_2___default().mkdirSync(parentDir, { recursive: true });
        const backupDir = node_fs__WEBPACK_IMPORTED_MODULE_2___default().existsSync(targetDir)
            ? node_path__WEBPACK_IMPORTED_MODULE_3___default().join(parentDir, `${node_path__WEBPACK_IMPORTED_MODULE_3___default().basename(targetDir)}.authority-backup-${Date.now()}-${node_crypto__WEBPACK_IMPORTED_MODULE_0___default().randomUUID()}`)
            : null;
        if (backupDir) {
            node_fs__WEBPACK_IMPORTED_MODULE_2___default().renameSync(targetDir, backupDir);
        }
        try {
            node_fs__WEBPACK_IMPORTED_MODULE_2___default().cpSync(bundledDir, targetDir, { recursive: true, force: true });
            const metadata = {
                managedBy: _constants_js__WEBPACK_IMPORTED_MODULE_4__.AUTHORITY_PLUGIN_ID,
                pluginVersion: this.releaseMetadata?.pluginVersion ?? this.status.pluginVersion,
                sdkVersion: this.releaseMetadata?.sdkVersion ?? this.status.sdkBundledVersion,
                assetHash: this.releaseMetadata?.assetHash ?? hashDirectory(targetDir, new Set([_constants_js__WEBPACK_IMPORTED_MODULE_4__.AUTHORITY_MANAGED_FILE])),
                installedAt: (0,_utils_js__WEBPACK_IMPORTED_MODULE_5__.nowIso)(),
                targetPath: targetDir,
            };
            (0,_utils_js__WEBPACK_IMPORTED_MODULE_5__.atomicWriteJson)(node_path__WEBPACK_IMPORTED_MODULE_3___default().join(targetDir, _constants_js__WEBPACK_IMPORTED_MODULE_4__.AUTHORITY_MANAGED_FILE), metadata);
            if (backupDir) {
                node_fs__WEBPACK_IMPORTED_MODULE_2___default().rmSync(backupDir, { recursive: true, force: true });
            }
            this.logger.info(`[authority] Managed SDK deployed to ${targetDir}`);
        }
        catch (error) {
            node_fs__WEBPACK_IMPORTED_MODULE_2___default().rmSync(targetDir, { recursive: true, force: true });
            if (backupDir && node_fs__WEBPACK_IMPORTED_MODULE_2___default().existsSync(backupDir)) {
                node_fs__WEBPACK_IMPORTED_MODULE_2___default().renameSync(backupDir, targetDir);
            }
            throw error;
        }
    }
    verifyBundledCore() {
        const release = this.releaseMetadata;
        if (!release) {
            return { ok: false, message: 'Authority release metadata is missing.' };
        }
        const expectedPlatform = getCurrentCorePlatform();
        const releasePlatforms = getReleaseCorePlatforms(release);
        if (releasePlatforms.length > 0 && !releasePlatforms.includes(expectedPlatform)) {
            return {
                ok: false,
                message: `Managed authority-core artifacts target ${releasePlatforms.join(', ')}, but this runtime needs ${expectedPlatform}.`,
            };
        }
        const platformDir = node_path__WEBPACK_IMPORTED_MODULE_3___default().join(this.pluginRoot, _constants_js__WEBPACK_IMPORTED_MODULE_4__.AUTHORITY_MANAGED_CORE_DIR, expectedPlatform);
        const metadataPath = node_path__WEBPACK_IMPORTED_MODULE_3___default().join(platformDir, 'authority-core.json');
        if (!node_fs__WEBPACK_IMPORTED_MODULE_2___default().existsSync(metadataPath)) {
            return {
                ok: false,
                message: `Managed authority-core metadata is missing for ${expectedPlatform}.`,
            };
        }
        const metadata = (0,_utils_js__WEBPACK_IMPORTED_MODULE_5__.readJsonFile)(metadataPath, null);
        if (!metadata || metadata.managedBy !== _constants_js__WEBPACK_IMPORTED_MODULE_4__.AUTHORITY_PLUGIN_ID) {
            return {
                ok: false,
                message: `Managed authority-core metadata for ${expectedPlatform} is invalid.`,
            };
        }
        if (metadata.platform !== process.platform || metadata.arch !== process.arch) {
            return {
                ok: false,
                message: `Managed authority-core metadata platform mismatch: ${metadata.platform}-${metadata.arch}.`,
            };
        }
        if (release.coreVersion && metadata.version !== release.coreVersion) {
            return {
                ok: false,
                message: `Managed authority-core version mismatch: expected ${release.coreVersion}, found ${metadata.version}.`,
            };
        }
        const binaryPath = node_path__WEBPACK_IMPORTED_MODULE_3___default().join(platformDir, metadata.binaryName);
        if (!node_fs__WEBPACK_IMPORTED_MODULE_2___default().existsSync(binaryPath)) {
            return {
                ok: false,
                message: `Managed authority-core binary is missing: ${binaryPath}.`,
            };
        }
        const binarySha256 = hashFile(binaryPath);
        if (metadata.binarySha256 !== binarySha256) {
            return {
                ok: false,
                message: 'Managed authority-core binary hash does not match its metadata.',
            };
        }
        const releaseArtifact = release.coreArtifacts?.[expectedPlatform];
        if (releaseArtifact && releaseArtifact.binarySha256 !== binarySha256) {
            return {
                ok: false,
                message: 'Managed authority-core binary hash does not match platform release metadata.',
            };
        }
        if (!releaseArtifact && release.coreBinarySha256 && release.coreBinarySha256 !== binarySha256) {
            return {
                ok: false,
                message: 'Managed authority-core binary hash does not match release metadata.',
            };
        }
        const warnings = [];
        if (releaseArtifact) {
            const platformArtifactHash = hashDirectory(platformDir);
            if (releaseArtifact.artifactHash !== platformArtifactHash) {
                warnings.push('Managed authority-core platform artifact hash drift detected. SDK deployment remains enabled because the core binary itself is verified.');
            }
        }
        if (release.coreArtifactHash) {
            const artifactHash = hashDirectory(node_path__WEBPACK_IMPORTED_MODULE_3___default().join(this.pluginRoot, _constants_js__WEBPACK_IMPORTED_MODULE_4__.AUTHORITY_MANAGED_CORE_DIR));
            if (artifactHash !== release.coreArtifactHash) {
                warnings.push('Managed authority-core artifact directory hash drift detected. SDK deployment remains enabled because the current platform binary is verified.');
            }
        }
        return {
            ok: true,
            platform: expectedPlatform,
            message: warnings.length > 0 ? warnings.join(' ') : null,
        };
    }
    setStatus(installStatus, installMessage, patch = {}) {
        this.status = {
            ...this.status,
            ...patch,
            installStatus,
            installMessage,
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
function buildInstallMessage(kind, targetDir, coreCheck) {
    const prefix = kind === 'deployed'
        ? `Authority SDK deployed to ${targetDir}.`
        : kind === 'updated'
            ? `Authority SDK refreshed at ${targetDir}.`
            : `Authority SDK is already available at ${targetDir}.`;
    if (!coreCheck.ok) {
        return `${prefix} Core verification warning: ${coreCheck.message}`;
    }
    if (coreCheck.message) {
        return `${prefix} Core verified for ${coreCheck.platform} with warnings: ${coreCheck.message}`;
    }
    return `${prefix} Core artifact verified for ${coreCheck.platform}.`;
}
function resolvePluginRoot(runtimeDir) {
    let current = runtimeDir;
    while (true) {
        if (node_fs__WEBPACK_IMPORTED_MODULE_2___default().existsSync(node_path__WEBPACK_IMPORTED_MODULE_3___default().join(current, _constants_js__WEBPACK_IMPORTED_MODULE_4__.AUTHORITY_RELEASE_FILE))) {
            return current;
        }
        const packageJsonPath = node_path__WEBPACK_IMPORTED_MODULE_3___default().join(current, 'package.json');
        if (node_fs__WEBPACK_IMPORTED_MODULE_2___default().existsSync(packageJsonPath)) {
            const packageJson = (0,_utils_js__WEBPACK_IMPORTED_MODULE_5__.readJsonFile)(packageJsonPath, {});
            if (packageJson.name === _constants_js__WEBPACK_IMPORTED_MODULE_4__.AUTHORITY_PLUGIN_ID) {
                return current;
            }
        }
        const parent = node_path__WEBPACK_IMPORTED_MODULE_3___default().dirname(current);
        if (parent === current) {
            return runtimeDir;
        }
        current = parent;
    }
}
function readReleaseMetadata(pluginRoot) {
    return (0,_utils_js__WEBPACK_IMPORTED_MODULE_5__.readJsonFile)(node_path__WEBPACK_IMPORTED_MODULE_3___default().join(pluginRoot, _constants_js__WEBPACK_IMPORTED_MODULE_4__.AUTHORITY_RELEASE_FILE), null);
}
function runGit(cwd, args, env, allowNoisyOutput = false) {
    const result = (0,node_child_process__WEBPACK_IMPORTED_MODULE_1__.spawnSync)('git', args, {
        cwd,
        env,
        encoding: 'utf8',
        windowsHide: true,
    });
    const stdout = (result.stdout ?? '').trim();
    const stderr = (result.stderr ?? '').trim();
    if (result.error) {
        throw result.error;
    }
    if (typeof result.status === 'number' && result.status !== 0) {
        const message = [stderr, stdout].filter(Boolean).join('\n') || `git ${args.join(' ')} failed with exit code ${result.status}`;
        throw new Error(message);
    }
    if (!allowNoisyOutput && stderr) {
        return { stdout, stderr: '' };
    }
    return { stdout, stderr };
}
function getCurrentCorePlatform() {
    return `${process.platform}-${process.arch}`;
}
function getReleaseCorePlatforms(release) {
    if (!release) {
        return [];
    }
    if (Array.isArray(release.coreArtifactPlatforms) && release.coreArtifactPlatforms.length > 0) {
        return [...release.coreArtifactPlatforms].sort();
    }
    if (release.coreArtifacts && Object.keys(release.coreArtifacts).length > 0) {
        return Object.keys(release.coreArtifacts).sort();
    }
    return release.coreArtifactPlatform ? [release.coreArtifactPlatform] : [];
}
function readPackageVersion(pluginRoot) {
    const packageJsonPath = node_path__WEBPACK_IMPORTED_MODULE_3___default().join(pluginRoot, 'package.json');
    if (!node_fs__WEBPACK_IMPORTED_MODULE_2___default().existsSync(packageJsonPath)) {
        return null;
    }
    return (0,_utils_js__WEBPACK_IMPORTED_MODULE_5__.readJsonFile)(packageJsonPath, {}).version ?? null;
}
function readBundledSdkVersion(pluginRoot) {
    const manifestPath = node_path__WEBPACK_IMPORTED_MODULE_3___default().join(pluginRoot, _constants_js__WEBPACK_IMPORTED_MODULE_4__.AUTHORITY_MANAGED_SDK_DIR, 'manifest.json');
    if (!node_fs__WEBPACK_IMPORTED_MODULE_2___default().existsSync(manifestPath)) {
        return null;
    }
    return (0,_utils_js__WEBPACK_IMPORTED_MODULE_5__.readJsonFile)(manifestPath, {}).version ?? null;
}
function isSillyTavernRoot(candidate) {
    return node_fs__WEBPACK_IMPORTED_MODULE_2___default().existsSync(node_path__WEBPACK_IMPORTED_MODULE_3___default().join(candidate, 'plugins'))
        && node_fs__WEBPACK_IMPORTED_MODULE_2___default().existsSync(node_path__WEBPACK_IMPORTED_MODULE_3___default().join(candidate, 'public', 'scripts', 'extensions'));
}
function hashDirectory(rootDir, ignoreNames = new Set()) {
    const hash = node_crypto__WEBPACK_IMPORTED_MODULE_0___default().createHash('sha256');
    for (const filePath of listFiles(rootDir, ignoreNames)) {
        const relativePath = node_path__WEBPACK_IMPORTED_MODULE_3___default().relative(rootDir, filePath).replace(/\\/g, '/');
        hash.update(relativePath);
        hash.update('\0');
        hash.update(readStableHashContent(filePath));
        hash.update('\0');
    }
    return hash.digest('hex');
}
function hashFile(filePath) {
    return node_crypto__WEBPACK_IMPORTED_MODULE_0___default().createHash('sha256').update(node_fs__WEBPACK_IMPORTED_MODULE_2___default().readFileSync(filePath)).digest('hex');
}
function readStableHashContent(filePath) {
    const content = node_fs__WEBPACK_IMPORTED_MODULE_2___default().readFileSync(filePath);
    if (!TEXT_HASH_EXTENSIONS.has(node_path__WEBPACK_IMPORTED_MODULE_3___default().extname(filePath).toLowerCase())) {
        return content;
    }
    return Buffer.from(content.toString('utf8').replace(/\r\n?/g, '\n'), 'utf8');
}
function listFiles(rootDir, ignoreNames) {
    const files = [];
    if (!node_fs__WEBPACK_IMPORTED_MODULE_2___default().existsSync(rootDir)) {
        return files;
    }
    const visit = (currentDir) => {
        const entries = node_fs__WEBPACK_IMPORTED_MODULE_2___default().readdirSync(currentDir, { withFileTypes: true })
            .filter(entry => !ignoreNames.has(entry.name))
            .sort((left, right) => left.name.localeCompare(right.name));
        for (const entry of entries) {
            const fullPath = node_path__WEBPACK_IMPORTED_MODULE_3___default().join(currentDir, entry.name);
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


class JobService {
    core;
    constructor(core) {
        this.core = core;
    }
    async list(user, extensionId) {
        const paths = (0,_store_authority_paths_js__WEBPACK_IMPORTED_MODULE_1__.getUserAuthorityPaths)(user);
        return await this.core.listControlJobs(paths.controlDbFile, {
            userHandle: user.handle,
            ...(extensionId ? { extensionId } : {}),
        });
    }
    async get(user, jobId) {
        const paths = (0,_store_authority_paths_js__WEBPACK_IMPORTED_MODULE_1__.getUserAuthorityPaths)(user);
        return await this.core.getControlJob(paths.controlDbFile, {
            userHandle: user.handle,
            jobId,
        });
    }
    async create(user, extensionId, type, payload, options = {}) {
        if (!_constants_js__WEBPACK_IMPORTED_MODULE_0__.BUILTIN_JOB_TYPES.includes(type)) {
            throw new Error(`Unsupported job type: ${type}`);
        }
        const paths = (0,_store_authority_paths_js__WEBPACK_IMPORTED_MODULE_1__.getUserAuthorityPaths)(user);
        const request = {
            userHandle: user.handle,
            extensionId,
            type,
            payload,
        };
        if (typeof options.timeoutMs === 'number')
            request.timeoutMs = options.timeoutMs;
        if (typeof options.idempotencyKey === 'string')
            request.idempotencyKey = options.idempotencyKey;
        if (typeof options.maxAttempts === 'number')
            request.maxAttempts = options.maxAttempts;
        return await this.core.createControlJob(paths.controlDbFile, request);
    }
    async cancel(user, extensionId, jobId) {
        const paths = (0,_store_authority_paths_js__WEBPACK_IMPORTED_MODULE_1__.getUserAuthorityPaths)(user);
        return await this.core.cancelControlJob(paths.controlDbFile, {
            userHandle: user.handle,
            extensionId,
            jobId,
        });
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
    core;
    constructor(policyService, core) {
        this.policyService = policyService;
        this.core = core;
    }
    async listPersistentGrants(user, extensionId) {
        const paths = (0,_store_authority_paths_js__WEBPACK_IMPORTED_MODULE_1__.getUserAuthorityPaths)(user);
        return await this.core.listControlGrants(paths.controlDbFile, {
            userHandle: user.handle,
            extensionId,
        });
    }
    async getPolicyEntries(user, extensionId) {
        return await this.policyService.getExtensionPolicies(user, extensionId);
    }
    async evaluate(user, session, request) {
        const descriptor = (0,_utils_js__WEBPACK_IMPORTED_MODULE_2__.buildPermissionDescriptor)(request.resource, request.target);
        const policy = await this.getPolicyGrant(user, session.extension.id, descriptor.key);
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
        const persistentGrant = await this.getPersistentGrant(user, session.extension.id, descriptor.key);
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
    async authorize(user, session, request, consume = true) {
        const evaluation = await this.evaluate(user, session, request);
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
    async resolve(user, session, request, choice) {
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
            await this.writePersistentGrant(user, session.extension.id, {
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
    async resetPersistentGrants(user, extensionId, keys) {
        const paths = (0,_store_authority_paths_js__WEBPACK_IMPORTED_MODULE_1__.getUserAuthorityPaths)(user);
        const request = {
            userHandle: user.handle,
            extensionId,
            ...(keys ? { keys } : {}),
        };
        await this.core.resetControlGrants(paths.controlDbFile, request);
    }
    async getPolicyGrant(user, extensionId, key) {
        const file = await this.policyService.getPolicies(user);
        return file.extensions[extensionId]?.[key] ?? null;
    }
    async getPersistentGrant(user, extensionId, key) {
        const paths = (0,_store_authority_paths_js__WEBPACK_IMPORTED_MODULE_1__.getUserAuthorityPaths)(user);
        return await this.core.getControlGrant(paths.controlDbFile, {
            userHandle: user.handle,
            extensionId,
            key,
        });
    }
    async writePersistentGrant(user, extensionId, grant) {
        const paths = (0,_store_authority_paths_js__WEBPACK_IMPORTED_MODULE_1__.getUserAuthorityPaths)(user);
        await this.core.upsertControlGrant(paths.controlDbFile, {
            userHandle: user.handle,
            extensionId,
            grant,
        });
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
    core;
    constructor(core) {
        this.core = core;
    }
    async getPolicies(user) {
        const globalPaths = (0,_store_authority_paths_js__WEBPACK_IMPORTED_MODULE_1__.getGlobalAuthorityPaths)();
        const globalFile = await this.core.getControlPolicies(globalPaths.controlDbFile, {
            userHandle: user.handle,
        });
        return {
            ...globalFile,
            defaults: {
                ..._constants_js__WEBPACK_IMPORTED_MODULE_0__.DEFAULT_POLICY_STATUS,
                ...globalFile.defaults,
            },
            updatedAt: globalFile.updatedAt || (0,_utils_js__WEBPACK_IMPORTED_MODULE_2__.nowIso)(),
        };
    }
    async getExtensionPolicies(user, extensionId) {
        return Object.values((await this.getPolicies(user)).extensions[extensionId] ?? {});
    }
    async saveGlobalPolicies(actor, partial) {
        if (!actor.isAdmin) {
            throw new Error('Forbidden');
        }
        const paths = (0,_store_authority_paths_js__WEBPACK_IMPORTED_MODULE_1__.getGlobalAuthorityPaths)();
        return await this.core.saveControlPolicies(paths.controlDbFile, {
            actor: {
                handle: actor.handle,
                isAdmin: actor.isAdmin,
            },
            partial: {
                ...(partial.defaults ? { defaults: partial.defaults } : {}),
                ...(partial.extensions ? { extensions: partial.extensions } : {}),
            },
        });
    }
}


/***/ },

/***/ "./src/services/private-fs-service.ts"
/*!********************************************!*\
  !*** ./src/services/private-fs-service.ts ***!
  \********************************************/
(__unused_webpack_module, __webpack_exports__, __webpack_require__) {

__webpack_require__.r(__webpack_exports__);
/* harmony export */ __webpack_require__.d(__webpack_exports__, {
/* harmony export */   PrivateFsService: () => (/* binding */ PrivateFsService)
/* harmony export */ });
/* harmony import */ var node_fs__WEBPACK_IMPORTED_MODULE_0__ = __webpack_require__(/*! node:fs */ "node:fs");
/* harmony import */ var node_fs__WEBPACK_IMPORTED_MODULE_0___default = /*#__PURE__*/__webpack_require__.n(node_fs__WEBPACK_IMPORTED_MODULE_0__);
/* harmony import */ var node_path__WEBPACK_IMPORTED_MODULE_1__ = __webpack_require__(/*! node:path */ "node:path");
/* harmony import */ var node_path__WEBPACK_IMPORTED_MODULE_1___default = /*#__PURE__*/__webpack_require__.n(node_path__WEBPACK_IMPORTED_MODULE_1__);
/* harmony import */ var _store_authority_paths_js__WEBPACK_IMPORTED_MODULE_2__ = __webpack_require__(/*! ../store/authority-paths.js */ "./src/store/authority-paths.ts");
/* harmony import */ var _utils_js__WEBPACK_IMPORTED_MODULE_3__ = __webpack_require__(/*! ../utils.js */ "./src/utils.ts");




class PrivateFsService {
    core;
    constructor(core) {
        this.core = core;
    }
    async mkdir(user, extensionId, request) {
        return await this.core.mkdirPrivateFile({
            rootDir: this.getRootDir(user, extensionId),
            ...request,
        });
    }
    async readDir(user, extensionId, request) {
        const rootDir = this.getRootDir(user, extensionId);
        if (isRootPath(request.path) && !node_fs__WEBPACK_IMPORTED_MODULE_0___default().existsSync(rootDir)) {
            return [];
        }
        return await this.core.readPrivateDir({
            rootDir,
            ...request,
        });
    }
    async writeFile(user, extensionId, request) {
        return await this.core.writePrivateFile({
            rootDir: this.getRootDir(user, extensionId),
            ...request,
        });
    }
    async writeFileFromSource(user, extensionId, request) {
        return await this.core.writePrivateFile({
            rootDir: this.getRootDir(user, extensionId),
            path: request.path,
            content: '',
            sourcePath: request.sourcePath,
            ...(request.createParents === undefined ? {} : { createParents: request.createParents }),
        });
    }
    async readFile(user, extensionId, request) {
        return await this.core.readPrivateFile({
            rootDir: this.getRootDir(user, extensionId),
            ...request,
        });
    }
    async openRead(user, extensionId, request) {
        return await this.core.openPrivateFileRead({
            rootDir: this.getRootDir(user, extensionId),
            ...request,
        });
    }
    async delete(user, extensionId, request) {
        await this.core.deletePrivateFile({
            rootDir: this.getRootDir(user, extensionId),
            ...request,
        });
    }
    async stat(user, extensionId, request) {
        return await this.core.statPrivateFile({
            rootDir: this.getRootDir(user, extensionId),
            ...request,
        });
    }
    async getUsageSummary(user, extensionId) {
        const rootDir = this.getRootDir(user, extensionId);
        if (!node_fs__WEBPACK_IMPORTED_MODULE_0___default().existsSync(rootDir)) {
            return emptyUsageSummary();
        }
        try {
            const rootStats = node_fs__WEBPACK_IMPORTED_MODULE_0___default().lstatSync(rootDir);
            if (rootStats.isSymbolicLink() || !rootStats.isDirectory()) {
                return emptyUsageSummary();
            }
        }
        catch {
            return emptyUsageSummary();
        }
        let fileCount = 0;
        let directoryCount = 0;
        let totalSizeBytes = 0;
        let latestUpdatedAtMs = 0;
        const stack = [rootDir];
        while (stack.length > 0) {
            const currentDir = stack.pop();
            let entries;
            try {
                entries = node_fs__WEBPACK_IMPORTED_MODULE_0___default().readdirSync(currentDir, { withFileTypes: true });
            }
            catch {
                continue;
            }
            for (const entry of entries) {
                const fullPath = node_path__WEBPACK_IMPORTED_MODULE_1___default().join(currentDir, entry.name);
                let stats;
                try {
                    stats = node_fs__WEBPACK_IMPORTED_MODULE_0___default().lstatSync(fullPath);
                }
                catch {
                    continue;
                }
                if (stats.isSymbolicLink()) {
                    continue;
                }
                latestUpdatedAtMs = Math.max(latestUpdatedAtMs, stats.mtimeMs);
                if (entry.isDirectory()) {
                    directoryCount += 1;
                    stack.push(fullPath);
                    continue;
                }
                if (entry.isFile()) {
                    fileCount += 1;
                    totalSizeBytes += stats.size;
                }
            }
        }
        return {
            fileCount,
            directoryCount,
            totalSizeBytes,
            latestUpdatedAt: latestUpdatedAtMs > 0 ? new Date(latestUpdatedAtMs).toISOString() : null,
        };
    }
    getRootDir(user, extensionId) {
        const paths = (0,_store_authority_paths_js__WEBPACK_IMPORTED_MODULE_2__.getUserAuthorityPaths)(user);
        return node_path__WEBPACK_IMPORTED_MODULE_1___default().join(paths.filesDir, (0,_utils_js__WEBPACK_IMPORTED_MODULE_3__.sanitizeFileSegment)(extensionId));
    }
}
function isRootPath(value) {
    const trimmed = value.trim();
    return trimmed === '' || trimmed === '/' || trimmed === '.';
}
function emptyUsageSummary() {
    return {
        fileCount: 0,
        directoryCount: 0,
        totalSizeBytes: 0,
        latestUpdatedAt: null,
    };
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
/* harmony import */ var _store_authority_paths_js__WEBPACK_IMPORTED_MODULE_0__ = __webpack_require__(/*! ../store/authority-paths.js */ "./src/store/authority-paths.ts");
/* harmony import */ var _utils_js__WEBPACK_IMPORTED_MODULE_1__ = __webpack_require__(/*! ../utils.js */ "./src/utils.ts");


class SessionService {
    core;
    sessions = new Map();
    constructor(core) {
        this.core = core;
    }
    async createSession(user, config) {
        const token = (0,_utils_js__WEBPACK_IMPORTED_MODULE_1__.randomToken)();
        const paths = (0,_store_authority_paths_js__WEBPACK_IMPORTED_MODULE_0__.getUserAuthorityPaths)(user);
        const snapshot = await this.core.initializeControlSession(paths.controlDbFile, token, (0,_utils_js__WEBPACK_IMPORTED_MODULE_1__.nowIso)(), { handle: user.handle, isAdmin: user.isAdmin }, config);
        const session = this.sessionFromSnapshot(snapshot);
        this.sessions.set(token, session);
        return session;
    }
    async getSession(token, user) {
        if (!token) {
            return null;
        }
        const cached = this.sessions.get(token);
        if (cached) {
            return cached;
        }
        const paths = (0,_store_authority_paths_js__WEBPACK_IMPORTED_MODULE_0__.getUserAuthorityPaths)(user);
        const snapshot = await this.core.getControlSession(paths.controlDbFile, user.handle, token);
        if (!snapshot) {
            return null;
        }
        const session = this.sessionFromSnapshot(snapshot);
        this.sessions.set(token, session);
        return session;
    }
    async assertSession(token, user) {
        const session = await this.getSession(token, user);
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
    sessionFromSnapshot(snapshot) {
        return {
            token: snapshot.sessionToken,
            createdAt: snapshot.createdAt,
            userHandle: snapshot.user.handle,
            isAdmin: snapshot.user.isAdmin,
            extension: snapshot.extension,
            declaredPermissions: snapshot.declaredPermissions,
            sessionGrants: new Map(),
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
/* harmony import */ var node_path__WEBPACK_IMPORTED_MODULE_0__ = __webpack_require__(/*! node:path */ "node:path");
/* harmony import */ var node_path__WEBPACK_IMPORTED_MODULE_0___default = /*#__PURE__*/__webpack_require__.n(node_path__WEBPACK_IMPORTED_MODULE_0__);
/* harmony import */ var _store_authority_paths_js__WEBPACK_IMPORTED_MODULE_1__ = __webpack_require__(/*! ../store/authority-paths.js */ "./src/store/authority-paths.ts");
/* harmony import */ var _utils_js__WEBPACK_IMPORTED_MODULE_2__ = __webpack_require__(/*! ../utils.js */ "./src/utils.ts");



class StorageService {
    core;
    constructor(core) {
        this.core = core;
    }
    async getKv(user, extensionId, key) {
        const paths = (0,_store_authority_paths_js__WEBPACK_IMPORTED_MODULE_1__.getUserAuthorityPaths)(user);
        return await this.core.getStorageKv(this.getKvDbPath(paths.kvDir, extensionId), { key });
    }
    async setKv(user, extensionId, key, value) {
        const paths = (0,_store_authority_paths_js__WEBPACK_IMPORTED_MODULE_1__.getUserAuthorityPaths)(user);
        await this.core.setStorageKv(this.getKvDbPath(paths.kvDir, extensionId), { key, value });
    }
    async deleteKv(user, extensionId, key) {
        const paths = (0,_store_authority_paths_js__WEBPACK_IMPORTED_MODULE_1__.getUserAuthorityPaths)(user);
        await this.core.deleteStorageKv(this.getKvDbPath(paths.kvDir, extensionId), { key });
    }
    async listKv(user, extensionId) {
        const paths = (0,_store_authority_paths_js__WEBPACK_IMPORTED_MODULE_1__.getUserAuthorityPaths)(user);
        return await this.core.listStorageKv(this.getKvDbPath(paths.kvDir, extensionId));
    }
    async putBlob(user, extensionId, name, content, encoding = 'utf8', contentType = 'application/octet-stream') {
        const paths = (0,_store_authority_paths_js__WEBPACK_IMPORTED_MODULE_1__.getUserAuthorityPaths)(user);
        return await this.core.putStorageBlob(paths.controlDbFile, {
            userHandle: user.handle,
            extensionId,
            blobDir: paths.blobDir,
            name,
            content,
            encoding,
            contentType,
        });
    }
    async putBlobFromSource(user, extensionId, name, sourcePath, contentType = 'application/octet-stream') {
        const paths = (0,_store_authority_paths_js__WEBPACK_IMPORTED_MODULE_1__.getUserAuthorityPaths)(user);
        return await this.core.putStorageBlob(paths.controlDbFile, {
            userHandle: user.handle,
            extensionId,
            blobDir: paths.blobDir,
            name,
            content: '',
            contentType,
            sourcePath,
        });
    }
    async getBlob(user, extensionId, blobId) {
        const paths = (0,_store_authority_paths_js__WEBPACK_IMPORTED_MODULE_1__.getUserAuthorityPaths)(user);
        return await this.core.getStorageBlob(paths.controlDbFile, {
            userHandle: user.handle,
            extensionId,
            blobDir: paths.blobDir,
            id: blobId,
        });
    }
    async openBlobRead(user, extensionId, blobId) {
        const paths = (0,_store_authority_paths_js__WEBPACK_IMPORTED_MODULE_1__.getUserAuthorityPaths)(user);
        return await this.core.openStorageBlobRead(paths.controlDbFile, {
            userHandle: user.handle,
            extensionId,
            blobDir: paths.blobDir,
            id: blobId,
        });
    }
    async deleteBlob(user, extensionId, blobId) {
        const paths = (0,_store_authority_paths_js__WEBPACK_IMPORTED_MODULE_1__.getUserAuthorityPaths)(user);
        await this.core.deleteStorageBlob(paths.controlDbFile, {
            userHandle: user.handle,
            extensionId,
            blobDir: paths.blobDir,
            id: blobId,
        });
    }
    async listBlobs(user, extensionId) {
        const paths = (0,_store_authority_paths_js__WEBPACK_IMPORTED_MODULE_1__.getUserAuthorityPaths)(user);
        return await this.core.listStorageBlobs(paths.controlDbFile, {
            userHandle: user.handle,
            extensionId,
            blobDir: paths.blobDir,
        });
    }
    getKvDbPath(kvDir, extensionId) {
        return node_path__WEBPACK_IMPORTED_MODULE_0___default().join(kvDir, `${(0,_utils_js__WEBPACK_IMPORTED_MODULE_2__.sanitizeFileSegment)(extensionId)}.sqlite`);
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
    const storageDir = node_path__WEBPACK_IMPORTED_MODULE_0___default().join(baseDir, 'storage');
    const sqlDir = node_path__WEBPACK_IMPORTED_MODULE_0___default().join(baseDir, 'sql');
    const triviumDir = node_path__WEBPACK_IMPORTED_MODULE_0___default().join(storageDir, 'trivium');
    return {
        sqlPrivateDir: node_path__WEBPACK_IMPORTED_MODULE_0___default().join(sqlDir, 'private'),
        triviumPrivateDir: node_path__WEBPACK_IMPORTED_MODULE_0___default().join(triviumDir, 'private'),
        kvDir: node_path__WEBPACK_IMPORTED_MODULE_0___default().join(storageDir, 'kv'),
        blobDir: node_path__WEBPACK_IMPORTED_MODULE_0___default().join(storageDir, 'blobs'),
        filesDir: node_path__WEBPACK_IMPORTED_MODULE_0___default().join(storageDir, 'files'),
        controlDbFile: node_path__WEBPACK_IMPORTED_MODULE_0___default().join(stateDir, 'control.sqlite'),
    };
}
function getGlobalAuthorityPaths() {
    const globalState = globalThis;
    const dataRoot = String(globalState.DATA_ROOT ?? process.cwd());
    const baseDir = node_path__WEBPACK_IMPORTED_MODULE_0___default().join(dataRoot, '_authority-global', 'authority');
    const stateDir = node_path__WEBPACK_IMPORTED_MODULE_0___default().join(baseDir, 'state');
    return {
        controlDbFile: node_path__WEBPACK_IMPORTED_MODULE_0___default().join(stateDir, 'control.sqlite'),
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
/* harmony export */   sanitizeFileSegment: () => (/* binding */ sanitizeFileSegment)
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
    await runtime.install.bootstrap();
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
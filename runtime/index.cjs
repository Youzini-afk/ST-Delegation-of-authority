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
/* harmony export */   BUILTIN_JOB_REGISTRY_SUMMARY: () => (/* binding */ BUILTIN_JOB_REGISTRY_SUMMARY),
/* harmony export */   BUILTIN_JOB_TYPES: () => (/* binding */ BUILTIN_JOB_TYPES),
/* harmony export */   DATA_TRANSFER_CHUNK_BYTES: () => (/* binding */ DATA_TRANSFER_CHUNK_BYTES),
/* harmony export */   DATA_TRANSFER_INLINE_THRESHOLD_BYTES: () => (/* binding */ DATA_TRANSFER_INLINE_THRESHOLD_BYTES),
/* harmony export */   DEFAULT_POLICY_STATUS: () => (/* binding */ DEFAULT_POLICY_STATUS),
/* harmony export */   MAX_AUDIT_LINES: () => (/* binding */ MAX_AUDIT_LINES),
/* harmony export */   MAX_BLOB_BYTES: () => (/* binding */ MAX_BLOB_BYTES),
/* harmony export */   MAX_KV_VALUE_BYTES: () => (/* binding */ MAX_KV_VALUE_BYTES),
/* harmony export */   RESOURCE_RISK: () => (/* binding */ RESOURCE_RISK),
/* harmony export */   SESSION_HEADER: () => (/* binding */ SESSION_HEADER),
/* harmony export */   SESSION_QUERY: () => (/* binding */ SESSION_QUERY),
/* harmony export */   SUPPORTED_RESOURCES: () => (/* binding */ SUPPORTED_RESOURCES),
/* harmony export */   UNMANAGED_TRANSFER_MAX_BYTES: () => (/* binding */ UNMANAGED_TRANSFER_MAX_BYTES),
/* harmony export */   buildAuthorityFeatureFlags: () => (/* binding */ buildAuthorityFeatureFlags)
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
const MAX_AUDIT_LINES = 200;
const DATA_TRANSFER_CHUNK_BYTES = 256 * 1024;
const DATA_TRANSFER_INLINE_THRESHOLD_BYTES = 256 * 1024;
const UNMANAGED_TRANSFER_MAX_BYTES = Number.MAX_SAFE_INTEGER;
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
    'storage.kv': 'granted',
    'storage.blob': 'granted',
    'fs.private': 'granted',
    'sql.private': 'granted',
    'trivium.private': 'granted',
    'http.fetch': 'granted',
    'jobs.background': 'granted',
    'events.stream': 'granted',
};
const BUILTIN_JOB_TYPES = ['delay', 'sql.backup', 'trivium.flush', 'fs.import-jsonl'];
const BUILTIN_JOB_REGISTRY_SUMMARY = {
    registered: BUILTIN_JOB_TYPES.length,
    jobTypes: [...BUILTIN_JOB_TYPES],
    entries: [
        {
            type: 'delay',
            description: 'Waits for a duration and emits progress updates until completion.',
            defaultTimeoutMs: null,
            defaultMaxAttempts: 1,
            cancellable: true,
            payloadFields: [
                { name: 'durationMs', type: 'number', required: false, description: 'Delay duration in milliseconds. Defaults to 3000.' },
                { name: 'message', type: 'string', required: false, description: 'Completion message. Defaults to "Delay completed".' },
                { name: 'failAttempts', type: 'number', required: false, description: 'Testing hook that forces the first N attempts to fail.' },
            ],
            progressFields: [
                { name: 'progress', type: 'number', required: true, description: 'Percent complete from 0 to 100.' },
                { name: 'summary', type: 'string', required: false, description: 'Human-readable progress summary.' },
                { name: 'result.elapsedMs', type: 'number', required: false, description: 'Elapsed duration reported on completion.' },
                { name: 'result.message', type: 'string', required: false, description: 'Completion message reported on success.' },
            ],
        },
        {
            type: 'sql.backup',
            description: 'Copies a private SQL database into the managed __backup__ folder.',
            defaultTimeoutMs: null,
            defaultMaxAttempts: 1,
            cancellable: true,
            payloadFields: [
                { name: 'database', type: 'string', required: false, description: 'Private SQL database name. Defaults to "default".' },
                { name: 'targetName', type: 'string', required: false, description: 'Optional backup filename. Defaults to a timestamped sqlite filename.' },
            ],
            progressFields: [
                { name: 'summary', type: 'string', required: false, description: 'Current backup stage.' },
                { name: 'result.database', type: 'string', required: false, description: 'Database name that was backed up.' },
                { name: 'result.backupPath', type: 'string', required: false, description: 'Filesystem path to the generated backup file.' },
                { name: 'result.sizeBytes', type: 'number', required: false, description: 'Backup file size in bytes.' },
            ],
        },
        {
            type: 'trivium.flush',
            description: 'Flushes a private Trivium database to durable storage.',
            defaultTimeoutMs: null,
            defaultMaxAttempts: 1,
            cancellable: true,
            payloadFields: [
                { name: 'database', type: 'string', required: false, description: 'Private Trivium database name. Defaults to "default".' },
            ],
            progressFields: [
                { name: 'summary', type: 'string', required: false, description: 'Current flush stage.' },
                { name: 'result.database', type: 'string', required: false, description: 'Database name that was flushed.' },
            ],
        },
        {
            type: 'fs.import-jsonl',
            description: 'Imports a JSONL blob into the private filesystem after validating each line.',
            defaultTimeoutMs: null,
            defaultMaxAttempts: 1,
            cancellable: true,
            payloadFields: [
                { name: 'blobId', type: 'string', required: true, description: 'Source blob containing UTF-8 JSONL content.' },
                { name: 'targetPath', type: 'string', required: true, description: 'Destination private file path for the imported JSONL file.' },
            ],
            progressFields: [
                { name: 'summary', type: 'string', required: false, description: 'Current import stage.' },
                { name: 'result.blobId', type: 'string', required: false, description: 'Imported source blob id.' },
                { name: 'result.targetPath', type: 'string', required: false, description: 'Written private file path.' },
                { name: 'result.lineCount', type: 'number', required: false, description: 'Number of JSONL records imported.' },
                { name: 'result.entry', type: 'object', required: false, description: 'Private file entry metadata for the imported file.' },
            ],
        },
    ],
};
function buildAuthorityFeatureFlags(isAdmin) {
    return {
        securityCenter: true,
        admin: isAdmin,
        sql: {
            queryPage: true,
            stat: true,
            migrations: true,
            schemaManifest: true,
        },
        trivium: {
            resolveId: true,
            resolveMany: true,
            upsert: true,
            bulkMutations: true,
            tql: true,
            tqlMut: true,
            propertyIndex: true,
            searchContext: true,
            mappingPages: true,
            mappingIntegrity: true,
        },
        transfers: {
            blob: true,
            fs: true,
            httpFetch: true,
        },
        jobs: {
            background: true,
            safeRequeue: true,
            builtinTypes: [...BUILTIN_JOB_TYPES],
        },
        diagnostics: {
            warnings: true,
            activityPages: true,
            jobsPage: true,
            benchmarkCore: true,
        },
    };
}


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






const ADMIN_PACKAGE_MAX_BYTES = 256 * 1024 * 1024;
function ok(res, data) {
    res.json(data);
}
function fail(runtime, req, res, extensionId, error) {
    const normalized = normalizeAuthorityError(error);
    try {
        const user = (0,_utils_js__WEBPACK_IMPORTED_MODULE_5__.getUserContext)(req);
        if (normalized.payload.category === 'permission' && isPermissionErrorDetails(normalized.payload.details)) {
            void runtime.audit.logPermission(user, extensionId, 'Permission denied', {
                ...normalized.payload.details,
                message: normalized.payload.error,
            }).catch(() => undefined);
        }
        else {
            void runtime.audit.logError(user, extensionId, normalized.payload.error).catch(() => undefined);
        }
    }
    catch {
    }
    res.status(normalized.status).json(normalized.payload);
}
function buildPermissionErrorPayload(message) {
    const match = /^Permission not granted: ([a-z.]+)(?: for (.+))?$/.exec(message);
    if (!match) {
        return null;
    }
    const resource = match[1]?.trim();
    if (!resource || !isPermissionResource(resource)) {
        return null;
    }
    const target = match[2]?.trim();
    const descriptor = (0,_utils_js__WEBPACK_IMPORTED_MODULE_5__.buildPermissionDescriptor)(resource, target);
    return {
        error: message,
        code: 'permission_not_granted',
        category: 'permission',
        details: {
            resource: descriptor.resource,
            target: descriptor.target,
            key: descriptor.key,
            riskLevel: descriptor.riskLevel,
        },
    };
}
function isPermissionResource(value) {
    return value === 'storage.kv'
        || value === 'storage.blob'
        || value === 'fs.private'
        || value === 'sql.private'
        || value === 'trivium.private'
        || value === 'http.fetch'
        || value === 'jobs.background'
        || value === 'events.stream';
}
function isPermissionErrorDetails(value) {
    return typeof value === 'object'
        && value !== null
        && 'resource' in value
        && 'target' in value
        && 'key' in value
        && 'riskLevel' in value;
}
function normalizeAuthorityError(error) {
    if ((0,_utils_js__WEBPACK_IMPORTED_MODULE_5__.isAuthorityServiceError)(error)) {
        return {
            status: error.status,
            payload: error.toPayload(),
        };
    }
    const message = (0,_utils_js__WEBPACK_IMPORTED_MODULE_5__.asErrorMessage)(error);
    const permissionErrorPayload = buildPermissionErrorPayload(message);
    if (permissionErrorPayload) {
        return {
            status: 403,
            payload: permissionErrorPayload,
        };
    }
    if (message === 'Unauthorized') {
        return {
            status: 401,
            payload: {
                error: message,
                code: 'unauthorized',
                category: 'auth',
            },
        };
    }
    if (message === 'Invalid authority session') {
        return {
            status: 401,
            payload: {
                error: message,
                code: 'invalid_session',
                category: 'session',
            },
        };
    }
    if (message === 'Authority session does not belong to current user') {
        return {
            status: 403,
            payload: {
                error: message,
                code: 'session_user_mismatch',
                category: 'session',
            },
        };
    }
    if (/timed?\s*out|timeout/i.test(message)) {
        return {
            status: 504,
            payload: {
                error: message,
                code: 'timeout',
                category: 'timeout',
            },
        };
    }
    if (/exceeds|too large|queue_full|max(?:imum)?|too many/i.test(message)) {
        return {
            status: 413,
            payload: {
                error: message,
                code: 'limit_exceeded',
                category: 'limit',
            },
        };
    }
    if (/must\b|required\b|invalid\b|unsupported\b|not[_ ]found\b|is not\b|cannot both be provided|mismatch|symlink is not allowed/i.test(message)) {
        return {
            status: 400,
            payload: {
                error: message,
                code: 'validation_error',
                category: 'validation',
            },
        };
    }
    return {
        status: 500,
        payload: {
            error: message,
            code: 'core_request_failed',
            category: 'core',
        },
    };
}
function buildEffectiveInlineThresholds() {
    return {
        storageBlobWrite: { bytes: _constants_js__WEBPACK_IMPORTED_MODULE_2__.DATA_TRANSFER_INLINE_THRESHOLD_BYTES, source: 'runtime' },
        storageBlobRead: { bytes: _constants_js__WEBPACK_IMPORTED_MODULE_2__.DATA_TRANSFER_INLINE_THRESHOLD_BYTES, source: 'runtime' },
        privateFileWrite: { bytes: _constants_js__WEBPACK_IMPORTED_MODULE_2__.DATA_TRANSFER_INLINE_THRESHOLD_BYTES, source: 'runtime' },
        privateFileRead: { bytes: _constants_js__WEBPACK_IMPORTED_MODULE_2__.DATA_TRANSFER_INLINE_THRESHOLD_BYTES, source: 'runtime' },
        httpFetchRequest: { bytes: _constants_js__WEBPACK_IMPORTED_MODULE_2__.DATA_TRANSFER_INLINE_THRESHOLD_BYTES, source: 'runtime' },
        httpFetchResponse: { bytes: _constants_js__WEBPACK_IMPORTED_MODULE_2__.DATA_TRANSFER_INLINE_THRESHOLD_BYTES, source: 'runtime' },
    };
}
function buildEffectiveTransferMaxBytes() {
    return {
        storageBlobWrite: { bytes: _constants_js__WEBPACK_IMPORTED_MODULE_2__.UNMANAGED_TRANSFER_MAX_BYTES, source: 'runtime' },
        storageBlobRead: { bytes: _constants_js__WEBPACK_IMPORTED_MODULE_2__.UNMANAGED_TRANSFER_MAX_BYTES, source: 'runtime' },
        privateFileWrite: { bytes: _constants_js__WEBPACK_IMPORTED_MODULE_2__.UNMANAGED_TRANSFER_MAX_BYTES, source: 'runtime' },
        privateFileRead: { bytes: _constants_js__WEBPACK_IMPORTED_MODULE_2__.UNMANAGED_TRANSFER_MAX_BYTES, source: 'runtime' },
        httpFetchRequest: { bytes: _constants_js__WEBPACK_IMPORTED_MODULE_2__.UNMANAGED_TRANSFER_MAX_BYTES, source: 'runtime' },
        httpFetchResponse: { bytes: _constants_js__WEBPACK_IMPORTED_MODULE_2__.UNMANAGED_TRANSFER_MAX_BYTES, source: 'runtime' },
    };
}
function parseAdminUpdateAction(value) {
    return value === 'redeploy-sdk' ? 'redeploy-sdk' : 'git-pull';
}
function getSqlDatabaseName(value) {
    return typeof value === 'string' && value.trim() ? value.trim() : 'default';
}
function getSqlMigrationTableName(value) {
    const candidate = typeof value === 'string' && value.trim() ? value.trim() : '_authority_migrations';
    if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(candidate)) {
        throw new Error('SQL migration tableName must be a valid identifier');
    }
    return candidate;
}
function buildEmptySqlCursorPage(page) {
    const limit = Number.isInteger(page.limit) && Number(page.limit) > 0
        ? Math.min(Number(page.limit), 1000)
        : 100;
    const cursor = page.cursor?.trim();
    if (cursor) {
        const offset = Number(cursor);
        if (!Number.isSafeInteger(offset) || offset < 0) {
            throw new Error('invalid_page_cursor');
        }
    }
    return {
        nextCursor: null,
        limit,
        hasMore: false,
        totalCount: 0,
    };
}
function readSqlMigrationRecord(row) {
    if (typeof row.id !== 'string' || !row.id.trim()) {
        throw new Error('SQL migration row is missing id');
    }
    return {
        id: row.id,
        appliedAt: typeof row.appliedAt === 'string' ? row.appliedAt : '',
    };
}
function getSqlSchemaObjectType(value) {
    if (value == null || value === '') {
        return null;
    }
    if (value === 'table' || value === 'index' || value === 'view' || value === 'trigger') {
        return value;
    }
    throw new Error('SQL schema type must be table, index, view, or trigger');
}
function readSqlSchemaObjectRecord(row) {
    const type = getSqlSchemaObjectType(row.type);
    if (!type) {
        throw new Error('SQL schema row is missing type');
    }
    if (typeof row.name !== 'string' || !row.name.trim()) {
        throw new Error('SQL schema row is missing name');
    }
    return {
        type,
        name: row.name,
        tableName: typeof row.tableName === 'string' && row.tableName.trim() ? row.tableName : null,
        sql: typeof row.sql === 'string' ? row.sql : null,
    };
}
function resolvePrivateSqlDatabaseDir(user, extensionId) {
    const paths = (0,_store_authority_paths_js__WEBPACK_IMPORTED_MODULE_4__.getUserAuthorityPaths)(user);
    return node_path__WEBPACK_IMPORTED_MODULE_1___default().join(paths.sqlPrivateDir, (0,_utils_js__WEBPACK_IMPORTED_MODULE_5__.sanitizeFileSegment)(extensionId));
}
function resolvePrivateSqlDatabasePath(user, extensionId, databaseName) {
    return node_path__WEBPACK_IMPORTED_MODULE_1___default().join(resolvePrivateSqlDatabaseDir(user, extensionId), `${(0,_utils_js__WEBPACK_IMPORTED_MODULE_5__.sanitizeFileSegment)(databaseName)}.sqlite`);
}
async function sqlMigrationTableExists(runtime, dbPath, tableName) {
    const result = await runtime.core.querySql(dbPath, {
        statement: 'SELECT name FROM sqlite_master WHERE type = ?1 AND name = ?2 LIMIT 1',
        params: ['table', tableName],
    });
    return result.rows.length > 0;
}
async function listSqlMigrationsPage(runtime, user, extensionId, request) {
    const database = getSqlDatabaseName(request.database);
    const tableName = getSqlMigrationTableName(request.tableName);
    const dbPath = resolvePrivateSqlDatabasePath(user, extensionId, database);
    if (!node_fs__WEBPACK_IMPORTED_MODULE_0___default().existsSync(dbPath) || !await sqlMigrationTableExists(runtime, dbPath, tableName)) {
        return {
            tableName,
            migrations: [],
            ...(request.page ? { page: buildEmptySqlCursorPage(request.page) } : {}),
        };
    }
    const result = await runtime.core.querySql(dbPath, {
        statement: `SELECT id, applied_at AS appliedAt FROM ${tableName} ORDER BY applied_at ASC, id ASC`,
        ...(request.page ? { page: request.page } : {}),
    });
    return {
        tableName,
        migrations: result.rows.map(row => readSqlMigrationRecord(row)),
        ...(result.page ? { page: result.page } : {}),
    };
}
async function listSqlSchemaPage(runtime, user, extensionId, request) {
    const database = getSqlDatabaseName(request.database);
    const type = getSqlSchemaObjectType(request.type);
    const dbPath = resolvePrivateSqlDatabasePath(user, extensionId, database);
    if (!node_fs__WEBPACK_IMPORTED_MODULE_0___default().existsSync(dbPath)) {
        return {
            objects: [],
            ...(request.page ? { page: buildEmptySqlCursorPage(request.page) } : {}),
        };
    }
    const params = type ? [type] : [];
    const result = await runtime.core.querySql(dbPath, {
        statement: `SELECT type, name, tbl_name AS tableName, sql
            FROM sqlite_master
            WHERE type IN ('table', 'index', 'view', 'trigger')
                AND name NOT LIKE 'sqlite_%'${type ? ' AND type = ?1' : ''}
            ORDER BY type ASC, name ASC`,
        ...(params.length > 0 ? { params } : {}),
        ...(request.page ? { page: request.page } : {}),
    });
    return {
        objects: result.rows.map(row => readSqlSchemaObjectRecord(row)),
        ...(result.page ? { page: result.page } : {}),
    };
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
async function listPrivateTriviumDatabases(runtime, user, extensionId) {
    return await runtime.trivium.listDatabases(user, extensionId);
}
async function statPrivateSqlDatabase(runtime, user, extensionId, databaseName) {
    const dbPath = resolvePrivateSqlDatabasePath(user, extensionId, databaseName);
    return await runtime.core.statSql(dbPath, { database: databaseName });
}
async function listPrivateSqlDatabases(runtime, user, extensionId) {
    const databaseDir = resolvePrivateSqlDatabaseDir(user, extensionId);
    if (!node_fs__WEBPACK_IMPORTED_MODULE_0___default().existsSync(databaseDir)) {
        return { databases: [] };
    }
    const databases = (await Promise.all(node_fs__WEBPACK_IMPORTED_MODULE_0___default().readdirSync(databaseDir, { withFileTypes: true })
        .filter(entry => entry.isFile() && entry.name.endsWith('.sqlite'))
        .map(async (entry) => {
        const databaseName = entry.name.slice(0, -'.sqlite'.length);
        const stat = await statPrivateSqlDatabase(runtime, user, extensionId, databaseName);
        return {
            name: stat.name,
            fileName: stat.fileName,
            sizeBytes: stat.sizeBytes,
            updatedAt: stat.updatedAt,
            runtimeConfig: stat.runtimeConfig,
            slowQuery: stat.slowQuery,
        };
    })))
        .sort((left, right) => (right.updatedAt ?? '').localeCompare(left.updatedAt ?? ''));
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
async function buildExtensionStorageSummary(runtime, user, extensionId, sqlDatabases, triviumDatabases) {
    const [kvEntries, blobs, files] = await Promise.all([
        runtime.storage.listKv(user, extensionId),
        runtime.storage.listBlobs(user, extensionId),
        runtime.files.getUsageSummary(user, extensionId),
    ]);
    const resolvedSqlDatabases = sqlDatabases ?? (await listPrivateSqlDatabases(runtime, user, extensionId)).databases;
    const resolvedTriviumDatabases = triviumDatabases ?? (await listPrivateTriviumDatabases(runtime, user, extensionId)).databases;
    const blobSummary = summarizeBlobRecords(blobs);
    const sqlDatabaseSummary = summarizeDatabases(resolvedSqlDatabases);
    const triviumDatabaseSummary = summarizeTriviumDatabases(resolvedTriviumDatabases);
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
async function buildProbeResponse(runtime, user) {
    await runtime.core.refreshHealth();
    const install = runtime.install.getStatus();
    const core = runtime.core.getStatus();
    const features = (0,_constants_js__WEBPACK_IMPORTED_MODULE_2__.buildAuthorityFeatureFlags)(user.isAdmin);
    const effectiveInlineThresholdBytes = buildEffectiveInlineThresholds();
    const effectiveTransferMaxBytes = buildEffectiveTransferMaxBytes();
    return {
        id: 'authority',
        online: true,
        version: install.pluginVersion,
        pluginId: _constants_js__WEBPACK_IMPORTED_MODULE_2__.AUTHORITY_PLUGIN_ID,
        sdkExtensionId: _constants_js__WEBPACK_IMPORTED_MODULE_2__.AUTHORITY_SDK_EXTENSION_ID,
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
        storageRoot: node_path__WEBPACK_IMPORTED_MODULE_1___default().join(user.rootDir, _constants_js__WEBPACK_IMPORTED_MODULE_2__.AUTHORITY_DATA_FOLDER, 'storage'),
        features,
        limits: {
            maxRequestBytes: core.health?.limits.maxRequestBytes ?? null,
            maxKvValueBytes: _constants_js__WEBPACK_IMPORTED_MODULE_2__.MAX_KV_VALUE_BYTES,
            maxBlobBytes: _constants_js__WEBPACK_IMPORTED_MODULE_2__.MAX_BLOB_BYTES,
            maxHttpBodyBytes: core.health?.limits.maxHttpBodyBytes ?? _constants_js__WEBPACK_IMPORTED_MODULE_2__.MAX_BLOB_BYTES,
            maxHttpResponseBytes: core.health?.limits.maxHttpResponseBytes ?? _constants_js__WEBPACK_IMPORTED_MODULE_2__.MAX_BLOB_BYTES,
            maxEventPollLimit: core.health?.limits.maxEventPollLimit ?? null,
            maxDataTransferBytes: _constants_js__WEBPACK_IMPORTED_MODULE_2__.UNMANAGED_TRANSFER_MAX_BYTES,
            dataTransferChunkBytes: _constants_js__WEBPACK_IMPORTED_MODULE_2__.DATA_TRANSFER_CHUNK_BYTES,
            dataTransferInlineThresholdBytes: _constants_js__WEBPACK_IMPORTED_MODULE_2__.DATA_TRANSFER_INLINE_THRESHOLD_BYTES,
            effectiveInlineThresholdBytes,
            effectiveTransferMaxBytes,
        },
        jobs: {
            builtinTypes: [..._constants_js__WEBPACK_IMPORTED_MODULE_2__.BUILTIN_JOB_TYPES],
            registry: core.health?.jobRegistrySummary ?? _constants_js__WEBPACK_IMPORTED_MODULE_2__.BUILTIN_JOB_REGISTRY_SUMMARY,
        },
        core,
    };
}
async function buildUsageSummaryExtension(runtime, user, extension, sqlDatabases, triviumDatabases) {
    const grants = await runtime.permissions.listPersistentGrants(user, extension.id);
    return {
        extension,
        grantedCount: grants.filter(grant => grant.status === 'granted').length,
        deniedCount: grants.filter(grant => grant.status === 'denied').length,
        storage: await buildExtensionStorageSummary(runtime, user, extension.id, sqlDatabases, triviumDatabases),
    };
}
function buildUsageSummaryTotals(extensions) {
    const initialTotals = {
        extensionCount: 0,
        kvEntries: 0,
        blobCount: 0,
        blobBytes: 0,
        databaseCount: 0,
        databaseBytes: 0,
        sqlDatabaseCount: 0,
        sqlDatabaseBytes: 0,
        triviumDatabaseCount: 0,
        triviumDatabaseBytes: 0,
        files: {
            fileCount: 0,
            directoryCount: 0,
            totalSizeBytes: 0,
            latestUpdatedAt: null,
        },
    };
    return extensions.reduce((totals, entry) => ({
        extensionCount: totals.extensionCount + 1,
        kvEntries: totals.kvEntries + entry.storage.kvEntries,
        blobCount: totals.blobCount + entry.storage.blobCount,
        blobBytes: totals.blobBytes + entry.storage.blobBytes,
        databaseCount: totals.databaseCount + entry.storage.databaseCount,
        databaseBytes: totals.databaseBytes + entry.storage.databaseBytes,
        sqlDatabaseCount: totals.sqlDatabaseCount + entry.storage.sqlDatabaseCount,
        sqlDatabaseBytes: totals.sqlDatabaseBytes + entry.storage.sqlDatabaseBytes,
        triviumDatabaseCount: totals.triviumDatabaseCount + entry.storage.triviumDatabaseCount,
        triviumDatabaseBytes: totals.triviumDatabaseBytes + entry.storage.triviumDatabaseBytes,
        files: {
            fileCount: totals.files.fileCount + entry.storage.files.fileCount,
            directoryCount: totals.files.directoryCount + entry.storage.files.directoryCount,
            totalSizeBytes: totals.files.totalSizeBytes + entry.storage.files.totalSizeBytes,
            latestUpdatedAt: pickLatestIsoTimestamp(totals.files.latestUpdatedAt, entry.storage.files.latestUpdatedAt),
        },
    }), initialTotals);
}
function pickLatestIsoTimestamp(left, right) {
    if (!left) {
        return right;
    }
    if (!right) {
        return left;
    }
    return left >= right ? left : right;
}
async function buildUsageSummary(runtime, user) {
    const extensions = await runtime.extensions.listExtensions(user);
    const summaries = await Promise.all(extensions.map(async (extension) => {
        const sqlDatabases = (await listPrivateSqlDatabases(runtime, user, extension.id)).databases;
        const triviumDatabases = (await listPrivateTriviumDatabases(runtime, user, extension.id)).databases;
        return await buildUsageSummaryExtension(runtime, user, extension, sqlDatabases, triviumDatabases);
    }));
    return {
        generatedAt: new Date().toISOString(),
        totals: buildUsageSummaryTotals(summaries),
        extensions: summaries,
    };
}
async function buildExtensionDiagnosticSnapshot(runtime, user, extensionId, extension) {
    const resolvedExtension = extension ?? await runtime.extensions.getExtension(user, extensionId);
    if (!resolvedExtension) {
        throw new Error('Extension not found');
    }
    const databases = (await listPrivateSqlDatabases(runtime, user, extensionId)).databases;
    const triviumDatabases = (await listPrivateTriviumDatabases(runtime, user, extensionId)).databases;
    const activity = await runtime.audit.getRecentActivityPage(user, extensionId);
    const jobsPage = await runtime.jobs.listPage(user, extensionId);
    return {
        extension: resolvedExtension,
        grants: await runtime.permissions.listPersistentGrants(user, extensionId),
        policies: await runtime.permissions.getPolicyEntries(user, extensionId),
        activity,
        jobs: jobsPage.jobs,
        jobsPage: jobsPage.page,
        databases,
        triviumDatabases,
        storage: await buildExtensionStorageSummary(runtime, user, extensionId, databases, triviumDatabases),
    };
}
async function buildDiagnosticBundle(runtime, user) {
    const [probe, policies, usageSummary, jobs] = await Promise.all([
        buildProbeResponse(runtime, user),
        runtime.policies.getPolicies(user),
        buildUsageSummary(runtime, user),
        runtime.jobs.listPage(user),
    ]);
    const extensions = await Promise.all(usageSummary.extensions.map(async (entry) => await buildExtensionDiagnosticSnapshot(runtime, user, entry.extension.id, entry.extension)));
    return sanitizeDiagnosticPayload({
        generatedAt: new Date().toISOString(),
        probe,
        policies,
        usageSummary,
        jobs,
        releaseMetadata: readReleaseMetadataSnapshot(runtime),
        extensions,
    });
}
function readReleaseMetadataSnapshot(runtime) {
    const filePath = node_path__WEBPACK_IMPORTED_MODULE_1___default().join(runtime.install.getPluginRoot(), _constants_js__WEBPACK_IMPORTED_MODULE_2__.AUTHORITY_RELEASE_FILE);
    if (!node_fs__WEBPACK_IMPORTED_MODULE_0___default().existsSync(filePath)) {
        return null;
    }
    try {
        const parsed = JSON.parse(node_fs__WEBPACK_IMPORTED_MODULE_0___default().readFileSync(filePath, 'utf8'));
        return parsed && typeof parsed === 'object' ? parsed : null;
    }
    catch {
        return null;
    }
}
function sanitizeDiagnosticPayload(value) {
    return sanitizeDiagnosticValue(undefined, value);
}
function assertAdminUser(user) {
    if (!user.isAdmin) {
        throw new Error('Forbidden');
    }
}
function parseAdminPackageSizeBytes(value) {
    const sizeBytes = Number(value ?? 0);
    if (!Number.isFinite(sizeBytes) || sizeBytes <= 0) {
        throw new Error('sizeBytes must be a positive number');
    }
    if (sizeBytes > ADMIN_PACKAGE_MAX_BYTES) {
        throw new Error(`Admin package upload exceeds ${ADMIN_PACKAGE_MAX_BYTES} bytes`);
    }
    return Math.floor(sizeBytes);
}
async function openAdminArtifactDownload(runtime, user, filePath, sizeBytes, artifact) {
    return {
        artifact,
        transfer: await runtime.transfers.openRead(user, _constants_js__WEBPACK_IMPORTED_MODULE_2__.AUTHORITY_SDK_EXTENSION_ID, {
            resource: 'fs.private',
            purpose: 'privateFileRead',
            sourcePath: filePath,
        }, Math.max(1, sizeBytes)),
    };
}
function sanitizeDiagnosticValue(key, value) {
    if (typeof value === 'string') {
        return shouldRedactDiagnosticKey(key) ? '<redacted>' : value;
    }
    if (Array.isArray(value)) {
        return value.map(item => sanitizeDiagnosticValue(undefined, item));
    }
    if (!value || typeof value !== 'object') {
        return value;
    }
    return Object.fromEntries(Object.entries(value).map(([entryKey, entryValue]) => [
        entryKey,
        sanitizeDiagnosticValue(entryKey, entryValue),
    ]));
}
function shouldRedactDiagnosticKey(key) {
    const normalized = key?.toLowerCase() ?? '';
    return normalized.includes('path')
        || normalized.includes('root')
        || normalized.includes('token')
        || normalized.includes('secret');
}
function registerRoutes(router, runtime = (0,_runtime_js__WEBPACK_IMPORTED_MODULE_3__.createAuthorityRuntime)()) {
    router.post('/probe', async (req, res) => {
        const user = (0,_utils_js__WEBPACK_IMPORTED_MODULE_5__.getUserContext)(req);
        ok(res, await buildProbeResponse(runtime, user));
    });
    router.post('/session/init', async (req, res) => {
        try {
            const user = (0,_utils_js__WEBPACK_IMPORTED_MODULE_5__.getUserContext)(req);
            const config = (req.body ?? {});
            const session = await runtime.sessions.createSession(user, config);
            const grants = await runtime.permissions.listPersistentGrants(user, session.extension.id);
            const policies = await runtime.permissions.getPolicyEntries(user, session.extension.id);
            const limits = await runtime.permissions.getEffectiveSessionLimits(user, session.extension.id);
            await runtime.audit.logUsage(user, session.extension.id, 'Session initialized');
            ok(res, runtime.sessions.buildSessionResponse(session, grants, policies, limits));
        }
        catch (error) {
            fail(runtime, req, res, 'third-party/st-authority-sdk', error);
        }
    });
    router.get('/session/current', async (req, res) => {
        try {
            const user = (0,_utils_js__WEBPACK_IMPORTED_MODULE_5__.getUserContext)(req);
            const session = await runtime.sessions.assertSession((0,_utils_js__WEBPACK_IMPORTED_MODULE_5__.getSessionToken)(req), user);
            const limits = await runtime.permissions.getEffectiveSessionLimits(user, session.extension.id);
            ok(res, runtime.sessions.buildSessionResponse(session, await runtime.permissions.listPersistentGrants(user, session.extension.id), await runtime.permissions.getPolicyEntries(user, session.extension.id), limits));
        }
        catch (error) {
            fail(runtime, req, res, 'third-party/st-authority-sdk', error);
        }
    });
    router.post('/permissions/evaluate', async (req, res) => {
        try {
            const user = (0,_utils_js__WEBPACK_IMPORTED_MODULE_5__.getUserContext)(req);
            const session = await runtime.sessions.assertSession((0,_utils_js__WEBPACK_IMPORTED_MODULE_5__.getSessionToken)(req), user);
            const evaluation = await runtime.permissions.evaluate(user, session, req.body);
            if (evaluation.decision === 'denied' || evaluation.decision === 'blocked') {
                await runtime.audit.logPermission(user, session.extension.id, 'Permission denied', {
                    key: evaluation.key,
                    resource: evaluation.resource,
                    target: evaluation.target,
                    decision: evaluation.decision,
                });
            }
            ok(res, evaluation);
        }
        catch (error) {
            fail(runtime, req, res, 'third-party/st-authority-sdk', error);
        }
    });
    router.post('/permissions/evaluate-batch', async (req, res) => {
        try {
            const user = (0,_utils_js__WEBPACK_IMPORTED_MODULE_5__.getUserContext)(req);
            const session = await runtime.sessions.assertSession((0,_utils_js__WEBPACK_IMPORTED_MODULE_5__.getSessionToken)(req), user);
            const payload = (req.body ?? {});
            if (payload.requests !== undefined && !Array.isArray(payload.requests)) {
                throw new _utils_js__WEBPACK_IMPORTED_MODULE_5__.AuthorityServiceError('Permission batch requests must be an array', 400, 'validation_error', 'validation');
            }
            const results = await runtime.permissions.evaluateBatch(user, session, payload.requests ?? []);
            const response = { results };
            ok(res, response);
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
            await runtime.audit.logPermission(user, session.extension.id, grant.status === 'denied' ? 'Permission denied' : 'Permission granted', {
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
                const sqlDatabases = (await listPrivateSqlDatabases(runtime, user, extension.id)).databases;
                const triviumDatabases = (await listPrivateTriviumDatabases(runtime, user, extension.id)).databases;
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
            const databases = (await listPrivateSqlDatabases(runtime, user, extensionId)).databases;
            const triviumDatabases = (await listPrivateTriviumDatabases(runtime, user, extensionId)).databases;
            const activity = await runtime.audit.getRecentActivityPage(user, extensionId);
            const jobsPage = await runtime.jobs.listPage(user, extensionId);
            ok(res, {
                extension,
                grants: await runtime.permissions.listPersistentGrants(user, extensionId),
                policies: await runtime.permissions.getPolicyEntries(user, extensionId),
                activity,
                jobs: jobsPage.jobs,
                jobsPage: jobsPage.page,
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
    router.post('/transfers/:id/status', async (req, res) => {
        try {
            const user = (0,_utils_js__WEBPACK_IMPORTED_MODULE_5__.getUserContext)(req);
            const session = await runtime.sessions.assertSession((0,_utils_js__WEBPACK_IMPORTED_MODULE_5__.getSessionToken)(req), user);
            ok(res, runtime.transfers.status(user, session.extension.id, String(req.params?.id ?? '')));
        }
        catch (error) {
            fail(runtime, req, res, 'third-party/st-authority-sdk', error);
        }
    });
    router.post('/transfers/:id/manifest', async (req, res) => {
        try {
            const user = (0,_utils_js__WEBPACK_IMPORTED_MODULE_5__.getUserContext)(req);
            const session = await runtime.sessions.assertSession((0,_utils_js__WEBPACK_IMPORTED_MODULE_5__.getSessionToken)(req), user);
            const manifest = runtime.transfers.manifest(user, session.extension.id, String(req.params?.id ?? ''));
            ok(res, manifest);
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
            if (payload.expectedChecksumSha256) {
                runtime.transfers.assertChecksum(user, session.extension.id, payload.transferId, payload.expectedChecksumSha256);
            }
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
            const inlineThreshold = await runtime.permissions.getEffectiveInlineThresholdBytes(user, session.extension.id, 'storageBlobRead');
            if (opened.record.size <= inlineThreshold) {
                ok(res, {
                    mode: 'inline',
                    ...(await runtime.storage.getBlob(user, session.extension.id, blobId)),
                });
                return;
            }
            const transfer = await runtime.transfers.openRead(user, session.extension.id, {
                resource: 'storage.blob',
                purpose: 'storageBlobRead',
                sourcePath: opened.sourcePath,
            });
            await runtime.audit.logUsage(user, session.extension.id, 'Blob read via transfer', { id: blobId, sizeBytes: opened.record.size });
            ok(res, {
                mode: 'transfer',
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
            if (payload.expectedChecksumSha256) {
                runtime.transfers.assertChecksum(user, session.extension.id, payload.transferId, payload.expectedChecksumSha256);
            }
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
            const inlineThreshold = await runtime.permissions.getEffectiveInlineThresholdBytes(user, session.extension.id, 'privateFileRead');
            if (opened.entry.sizeBytes <= inlineThreshold) {
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
                purpose: 'privateFileRead',
                sourcePath: opened.sourcePath,
            });
            await runtime.audit.logUsage(user, session.extension.id, 'Private file read via transfer', { path: payload.path, sizeBytes: opened.entry.sizeBytes });
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
    router.post('/sql/list-migrations', async (req, res) => {
        try {
            const user = (0,_utils_js__WEBPACK_IMPORTED_MODULE_5__.getUserContext)(req);
            const session = await runtime.sessions.assertSession((0,_utils_js__WEBPACK_IMPORTED_MODULE_5__.getSessionToken)(req), user);
            const payload = (req.body ?? {});
            const database = getSqlDatabaseName(payload.database);
            if (!await runtime.permissions.authorize(user, session, { resource: 'sql.private', target: database })) {
                throw new Error(`Permission not granted: sql.private for ${database}`);
            }
            const result = await listSqlMigrationsPage(runtime, user, session.extension.id, payload);
            await runtime.audit.logUsage(user, session.extension.id, 'SQL list migrations', {
                database,
                tableName: result.tableName,
                count: result.migrations.length,
                limit: result.page?.limit ?? null,
            });
            ok(res, result);
        }
        catch (error) {
            fail(runtime, req, res, 'sql.private', error);
        }
    });
    router.post('/sql/list-schema', async (req, res) => {
        try {
            const user = (0,_utils_js__WEBPACK_IMPORTED_MODULE_5__.getUserContext)(req);
            const session = await runtime.sessions.assertSession((0,_utils_js__WEBPACK_IMPORTED_MODULE_5__.getSessionToken)(req), user);
            const payload = (req.body ?? {});
            const database = getSqlDatabaseName(payload.database);
            if (!await runtime.permissions.authorize(user, session, { resource: 'sql.private', target: database })) {
                throw new Error(`Permission not granted: sql.private for ${database}`);
            }
            const result = await listSqlSchemaPage(runtime, user, session.extension.id, payload);
            await runtime.audit.logUsage(user, session.extension.id, 'SQL list schema', {
                database,
                type: payload.type ?? null,
                count: result.objects.length,
                limit: result.page?.limit ?? null,
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
            const result = await listPrivateSqlDatabases(runtime, user, session.extension.id);
            await runtime.audit.logUsage(user, session.extension.id, 'SQL list databases', {
                count: result.databases.length,
            });
            ok(res, result);
        }
        catch (error) {
            fail(runtime, req, res, 'sql.private', error);
        }
    });
    router.post('/sql/stat', async (req, res) => {
        try {
            const user = (0,_utils_js__WEBPACK_IMPORTED_MODULE_5__.getUserContext)(req);
            const session = await runtime.sessions.assertSession((0,_utils_js__WEBPACK_IMPORTED_MODULE_5__.getSessionToken)(req), user);
            const payload = (req.body ?? {});
            const database = getSqlDatabaseName(payload.database);
            if (!await runtime.permissions.authorize(user, session, { resource: 'sql.private', target: database })) {
                throw new Error(`Permission not granted: sql.private for ${database}`);
            }
            const result = await statPrivateSqlDatabase(runtime, user, session.extension.id, database);
            await runtime.audit.logUsage(user, session.extension.id, 'SQL stat', {
                database,
                exists: result.exists,
                sizeBytes: result.sizeBytes,
                slowQueryCount: result.slowQuery.count,
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
            const response = await runtime.trivium.insert(user, session.extension.id, payload);
            await runtime.audit.logUsage(user, session.extension.id, 'Trivium insert', {
                database,
                id: response.id,
            });
            ok(res, response);
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
            await runtime.trivium.insertWithId(user, session.extension.id, payload);
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
    router.post('/trivium/resolve-id', async (req, res) => {
        try {
            const user = (0,_utils_js__WEBPACK_IMPORTED_MODULE_5__.getUserContext)(req);
            const session = await runtime.sessions.assertSession((0,_utils_js__WEBPACK_IMPORTED_MODULE_5__.getSessionToken)(req), user);
            const payload = (req.body ?? {});
            const database = getTriviumDatabaseName(payload.database);
            if (!await runtime.permissions.authorize(user, session, { resource: 'trivium.private', target: database })) {
                throw new Error(`Permission not granted: trivium.private for ${database}`);
            }
            const result = await runtime.trivium.resolveId(user, session.extension.id, payload);
            await runtime.audit.logUsage(user, session.extension.id, 'Trivium resolve id', {
                database,
                externalId: result.externalId,
                namespace: result.namespace,
                id: result.id,
            });
            ok(res, result);
        }
        catch (error) {
            fail(runtime, req, res, 'trivium.private', error);
        }
    });
    router.post('/trivium/resolve-many', async (req, res) => {
        try {
            const user = (0,_utils_js__WEBPACK_IMPORTED_MODULE_5__.getUserContext)(req);
            const session = await runtime.sessions.assertSession((0,_utils_js__WEBPACK_IMPORTED_MODULE_5__.getSessionToken)(req), user);
            const payload = (req.body ?? {});
            const database = getTriviumDatabaseName(payload.database);
            if (!await runtime.permissions.authorize(user, session, { resource: 'trivium.private', target: database })) {
                throw new Error(`Permission not granted: trivium.private for ${database}`);
            }
            const result = await runtime.trivium.resolveMany(user, session.extension.id, payload);
            await runtime.audit.logUsage(user, session.extension.id, 'Trivium resolve many', {
                database,
                totalCount: result.items.length,
            });
            ok(res, result);
        }
        catch (error) {
            fail(runtime, req, res, 'trivium.private', error);
        }
    });
    router.post('/trivium/upsert', async (req, res) => {
        try {
            const user = (0,_utils_js__WEBPACK_IMPORTED_MODULE_5__.getUserContext)(req);
            const session = await runtime.sessions.assertSession((0,_utils_js__WEBPACK_IMPORTED_MODULE_5__.getSessionToken)(req), user);
            const payload = (req.body ?? {});
            const database = getTriviumDatabaseName(payload.database);
            if (!await runtime.permissions.authorize(user, session, { resource: 'trivium.private', target: database })) {
                throw new Error(`Permission not granted: trivium.private for ${database}`);
            }
            const result = await runtime.trivium.upsert(user, session.extension.id, payload);
            await runtime.audit.logUsage(user, session.extension.id, 'Trivium upsert', {
                database,
                id: result.id,
                action: result.action,
                externalId: result.externalId,
                namespace: result.namespace,
            });
            ok(res, result);
        }
        catch (error) {
            fail(runtime, req, res, 'trivium.private', error);
        }
    });
    router.post('/trivium/bulk-upsert', async (req, res) => {
        try {
            const user = (0,_utils_js__WEBPACK_IMPORTED_MODULE_5__.getUserContext)(req);
            const session = await runtime.sessions.assertSession((0,_utils_js__WEBPACK_IMPORTED_MODULE_5__.getSessionToken)(req), user);
            const payload = (req.body ?? {});
            const database = getTriviumDatabaseName(payload.database);
            if (!await runtime.permissions.authorize(user, session, { resource: 'trivium.private', target: database })) {
                throw new Error(`Permission not granted: trivium.private for ${database}`);
            }
            const result = await runtime.trivium.bulkUpsert(user, session.extension.id, payload);
            await runtime.audit.logUsage(user, session.extension.id, 'Trivium bulk upsert', {
                database,
                totalCount: result.totalCount,
                successCount: result.successCount,
                failureCount: result.failureCount,
            });
            ok(res, result);
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
            const node = await runtime.trivium.get(user, session.extension.id, payload);
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
            await runtime.trivium.updatePayload(user, session.extension.id, payload);
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
            await runtime.trivium.delete(user, session.extension.id, payload);
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
    router.post('/trivium/bulk-delete', async (req, res) => {
        try {
            const user = (0,_utils_js__WEBPACK_IMPORTED_MODULE_5__.getUserContext)(req);
            const session = await runtime.sessions.assertSession((0,_utils_js__WEBPACK_IMPORTED_MODULE_5__.getSessionToken)(req), user);
            const payload = (req.body ?? {});
            const database = getTriviumDatabaseName(payload.database);
            if (!await runtime.permissions.authorize(user, session, { resource: 'trivium.private', target: database })) {
                throw new Error(`Permission not granted: trivium.private for ${database}`);
            }
            const result = await runtime.trivium.bulkDelete(user, session.extension.id, payload);
            await runtime.audit.logUsage(user, session.extension.id, 'Trivium bulk delete', {
                database,
                totalCount: result.totalCount,
                successCount: result.successCount,
                failureCount: result.failureCount,
            });
            ok(res, result);
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
    router.post('/trivium/bulk-link', async (req, res) => {
        try {
            const user = (0,_utils_js__WEBPACK_IMPORTED_MODULE_5__.getUserContext)(req);
            const session = await runtime.sessions.assertSession((0,_utils_js__WEBPACK_IMPORTED_MODULE_5__.getSessionToken)(req), user);
            const payload = (req.body ?? {});
            const database = getTriviumDatabaseName(payload.database);
            if (!await runtime.permissions.authorize(user, session, { resource: 'trivium.private', target: database })) {
                throw new Error(`Permission not granted: trivium.private for ${database}`);
            }
            const result = await runtime.trivium.bulkLink(user, session.extension.id, payload);
            await runtime.audit.logUsage(user, session.extension.id, 'Trivium bulk link', {
                database,
                totalCount: result.totalCount,
                successCount: result.successCount,
                failureCount: result.failureCount,
            });
            ok(res, result);
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
    router.post('/trivium/bulk-unlink', async (req, res) => {
        try {
            const user = (0,_utils_js__WEBPACK_IMPORTED_MODULE_5__.getUserContext)(req);
            const session = await runtime.sessions.assertSession((0,_utils_js__WEBPACK_IMPORTED_MODULE_5__.getSessionToken)(req), user);
            const payload = (req.body ?? {});
            const database = getTriviumDatabaseName(payload.database);
            if (!await runtime.permissions.authorize(user, session, { resource: 'trivium.private', target: database })) {
                throw new Error(`Permission not granted: trivium.private for ${database}`);
            }
            const result = await runtime.trivium.bulkUnlink(user, session.extension.id, payload);
            await runtime.audit.logUsage(user, session.extension.id, 'Trivium bulk unlink', {
                database,
                totalCount: result.totalCount,
                successCount: result.successCount,
                failureCount: result.failureCount,
            });
            ok(res, result);
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
            const result = await runtime.trivium.neighbors(user, session.extension.id, payload);
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
            const hits = await runtime.trivium.search(user, session.extension.id, payload);
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
            const hits = await runtime.trivium.searchAdvanced(user, session.extension.id, payload);
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
            const hits = await runtime.trivium.searchHybrid(user, session.extension.id, payload);
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
    router.post('/trivium/search-hybrid-context', async (req, res) => {
        try {
            const user = (0,_utils_js__WEBPACK_IMPORTED_MODULE_5__.getUserContext)(req);
            const session = await runtime.sessions.assertSession((0,_utils_js__WEBPACK_IMPORTED_MODULE_5__.getSessionToken)(req), user);
            const payload = (req.body ?? {});
            const database = getTriviumDatabaseName(payload.database);
            if (!await runtime.permissions.authorize(user, session, { resource: 'trivium.private', target: database })) {
                throw new Error(`Permission not granted: trivium.private for ${database}`);
            }
            const response = await runtime.trivium.searchHybridWithContext(user, session.extension.id, payload);
            await runtime.audit.logUsage(user, session.extension.id, 'Trivium hybrid search context', {
                database,
                hitCount: response.hits.length,
            });
            ok(res, response);
        }
        catch (error) {
            fail(runtime, req, res, 'trivium.private', error);
        }
    });
    router.post('/trivium/tql', async (req, res) => {
        try {
            const user = (0,_utils_js__WEBPACK_IMPORTED_MODULE_5__.getUserContext)(req);
            const session = await runtime.sessions.assertSession((0,_utils_js__WEBPACK_IMPORTED_MODULE_5__.getSessionToken)(req), user);
            const payload = (req.body ?? {});
            const database = getTriviumDatabaseName(payload.database);
            if (!await runtime.permissions.authorize(user, session, { resource: 'trivium.private', target: database })) {
                throw new Error(`Permission not granted: trivium.private for ${database}`);
            }
            const response = await runtime.trivium.tqlPage(user, session.extension.id, payload);
            await runtime.audit.logUsage(user, session.extension.id, 'Trivium TQL query', {
                database,
                rowCount: response.rows.length,
            });
            ok(res, response);
        }
        catch (error) {
            fail(runtime, req, res, 'trivium.private', error);
        }
    });
    router.post('/trivium/tql-mut', async (req, res) => {
        try {
            const user = (0,_utils_js__WEBPACK_IMPORTED_MODULE_5__.getUserContext)(req);
            const session = await runtime.sessions.assertSession((0,_utils_js__WEBPACK_IMPORTED_MODULE_5__.getSessionToken)(req), user);
            const payload = (req.body ?? {});
            const database = getTriviumDatabaseName(payload.database);
            if (!await runtime.permissions.authorize(user, session, { resource: 'trivium.private', target: database })) {
                throw new Error(`Permission not granted: trivium.private for ${database}`);
            }
            const response = await runtime.trivium.tqlMut(user, session.extension.id, payload);
            await runtime.audit.logUsage(user, session.extension.id, 'Trivium TQL mutation', {
                database,
                affected: response.affected,
                createdCount: response.createdIds.length,
            });
            ok(res, response);
        }
        catch (error) {
            fail(runtime, req, res, 'trivium.private', error);
        }
    });
    router.post('/trivium/create-index', async (req, res) => {
        try {
            const user = (0,_utils_js__WEBPACK_IMPORTED_MODULE_5__.getUserContext)(req);
            const session = await runtime.sessions.assertSession((0,_utils_js__WEBPACK_IMPORTED_MODULE_5__.getSessionToken)(req), user);
            const payload = (req.body ?? {});
            const database = getTriviumDatabaseName(payload.database);
            if (!await runtime.permissions.authorize(user, session, { resource: 'trivium.private', target: database })) {
                throw new Error(`Permission not granted: trivium.private for ${database}`);
            }
            await runtime.trivium.createIndex(user, session.extension.id, payload);
            await runtime.audit.logUsage(user, session.extension.id, 'Trivium create index', {
                database,
                field: payload.field,
            });
            ok(res, { ok: true });
        }
        catch (error) {
            fail(runtime, req, res, 'trivium.private', error);
        }
    });
    router.post('/trivium/drop-index', async (req, res) => {
        try {
            const user = (0,_utils_js__WEBPACK_IMPORTED_MODULE_5__.getUserContext)(req);
            const session = await runtime.sessions.assertSession((0,_utils_js__WEBPACK_IMPORTED_MODULE_5__.getSessionToken)(req), user);
            const payload = (req.body ?? {});
            const database = getTriviumDatabaseName(payload.database);
            if (!await runtime.permissions.authorize(user, session, { resource: 'trivium.private', target: database })) {
                throw new Error(`Permission not granted: trivium.private for ${database}`);
            }
            await runtime.trivium.dropIndex(user, session.extension.id, payload);
            await runtime.audit.logUsage(user, session.extension.id, 'Trivium drop index', {
                database,
                field: payload.field,
            });
            ok(res, { ok: true });
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
            await runtime.trivium.indexText(user, session.extension.id, payload);
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
            await runtime.trivium.indexKeyword(user, session.extension.id, payload);
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
            await runtime.trivium.buildTextIndex(user, session.extension.id, payload);
            await runtime.audit.logUsage(user, session.extension.id, 'Trivium build text index', {
                database,
            });
            ok(res, { ok: true });
        }
        catch (error) {
            fail(runtime, req, res, 'trivium.private', error);
        }
    });
    router.post('/trivium/compact', async (req, res) => {
        try {
            const user = (0,_utils_js__WEBPACK_IMPORTED_MODULE_5__.getUserContext)(req);
            const session = await runtime.sessions.assertSession((0,_utils_js__WEBPACK_IMPORTED_MODULE_5__.getSessionToken)(req), user);
            const payload = (req.body ?? {});
            const database = getTriviumDatabaseName(payload.database);
            if (!await runtime.permissions.authorize(user, session, { resource: 'trivium.private', target: database })) {
                throw new Error(`Permission not granted: trivium.private for ${database}`);
            }
            await runtime.trivium.compact(user, session.extension.id, payload);
            await runtime.audit.logUsage(user, session.extension.id, 'Trivium compact', {
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
            await runtime.trivium.flush(user, session.extension.id, payload);
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
            if (payload.includeMappingIntegrity === true) {
                await runtime.audit.logWarning(user, session.extension.id, 'Trivium mapping integrity stat requested', {
                    database,
                    route: '/trivium/stat',
                    hotPathRisk: true,
                });
            }
            const result = await runtime.trivium.stat(user, session.extension.id, payload);
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
    router.post('/trivium/check-mappings-integrity', async (req, res) => {
        try {
            const user = (0,_utils_js__WEBPACK_IMPORTED_MODULE_5__.getUserContext)(req);
            const session = await runtime.sessions.assertSession((0,_utils_js__WEBPACK_IMPORTED_MODULE_5__.getSessionToken)(req), user);
            const payload = (req.body ?? {});
            const database = getTriviumDatabaseName(payload.database);
            if (!await runtime.permissions.authorize(user, session, { resource: 'trivium.private', target: database })) {
                throw new Error(`Permission not granted: trivium.private for ${database}`);
            }
            await runtime.audit.logWarning(user, session.extension.id, 'Trivium mapping integrity check requested', {
                database,
                route: '/trivium/check-mappings-integrity',
                hotPathRisk: true,
            });
            const result = await runtime.trivium.checkMappingsIntegrity(user, session.extension.id, payload);
            await runtime.audit.logUsage(user, session.extension.id, 'Trivium check mappings integrity', {
                database,
                mappingCount: result.mappingCount,
                orphanMappingCount: result.orphanMappingCount,
                missingMappingCount: result.missingMappingCount,
                issueCount: result.issues.length,
            });
            ok(res, result);
        }
        catch (error) {
            fail(runtime, req, res, 'trivium.private', error);
        }
    });
    router.post('/trivium/delete-orphan-mappings', async (req, res) => {
        try {
            const user = (0,_utils_js__WEBPACK_IMPORTED_MODULE_5__.getUserContext)(req);
            const session = await runtime.sessions.assertSession((0,_utils_js__WEBPACK_IMPORTED_MODULE_5__.getSessionToken)(req), user);
            const payload = (req.body ?? {});
            const database = getTriviumDatabaseName(payload.database);
            if (!await runtime.permissions.authorize(user, session, { resource: 'trivium.private', target: database })) {
                throw new Error(`Permission not granted: trivium.private for ${database}`);
            }
            await runtime.audit.logWarning(user, session.extension.id, 'Trivium orphan mapping cleanup requested', {
                database,
                route: '/trivium/delete-orphan-mappings',
                dryRun: payload.dryRun === true,
                hotPathRisk: true,
            });
            const result = await runtime.trivium.deleteOrphanMappings(user, session.extension.id, payload);
            await runtime.audit.logUsage(user, session.extension.id, 'Trivium delete orphan mappings', {
                database,
                dryRun: payload.dryRun === true,
                orphanCount: result.orphanCount,
                deletedCount: result.deletedCount,
                hasMore: result.hasMore,
            });
            ok(res, result);
        }
        catch (error) {
            fail(runtime, req, res, 'trivium.private', error);
        }
    });
    router.post('/trivium/list-mappings', async (req, res) => {
        try {
            const user = (0,_utils_js__WEBPACK_IMPORTED_MODULE_5__.getUserContext)(req);
            const session = await runtime.sessions.assertSession((0,_utils_js__WEBPACK_IMPORTED_MODULE_5__.getSessionToken)(req), user);
            const payload = (req.body ?? {});
            const database = getTriviumDatabaseName(payload.database);
            if (!await runtime.permissions.authorize(user, session, { resource: 'trivium.private', target: database })) {
                throw new Error(`Permission not granted: trivium.private for ${database}`);
            }
            const result = await runtime.trivium.listMappingsPage(user, session.extension.id, payload);
            await runtime.audit.logUsage(user, session.extension.id, 'Trivium list mappings', {
                database,
                namespace: typeof payload.namespace === 'string' && payload.namespace.trim() ? payload.namespace.trim() : null,
                count: result.mappings.length,
                limit: result.page?.limit ?? null,
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
            const result = await listPrivateTriviumDatabases(runtime, user, session.extension.id);
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
            const responseTransfer = await runtime.transfers.init(user, session.extension.id, {
                resource: 'http.fetch',
                purpose: 'httpFetchResponse',
            });
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
            const responseInlineThreshold = await runtime.permissions.getEffectiveInlineThresholdBytes(user, session.extension.id, 'httpFetchResponse');
            await runtime.audit.logUsage(user, session.extension.id, 'HTTP fetch', {
                hostname,
                ...(bodyTransfer ? { requestVia: 'transfer' } : {}),
                ...(finalizedTransfer.sizeBytes > responseInlineThreshold ? { responseVia: 'transfer' } : {}),
            });
            if (finalizedTransfer.sizeBytes <= responseInlineThreshold) {
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
    router.post('/jobs/list', async (req, res) => {
        try {
            const user = (0,_utils_js__WEBPACK_IMPORTED_MODULE_5__.getUserContext)(req);
            const session = await runtime.sessions.assertSession((0,_utils_js__WEBPACK_IMPORTED_MODULE_5__.getSessionToken)(req), user);
            const payload = (req.body ?? {});
            ok(res, await runtime.jobs.listPage(user, session.extension.id, payload));
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
    router.post('/jobs/:id/requeue', async (req, res) => {
        try {
            const user = (0,_utils_js__WEBPACK_IMPORTED_MODULE_5__.getUserContext)(req);
            const session = await runtime.sessions.assertSession((0,_utils_js__WEBPACK_IMPORTED_MODULE_5__.getSessionToken)(req), user);
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
    router.get('/admin/usage-summary', async (req, res) => {
        try {
            const user = (0,_utils_js__WEBPACK_IMPORTED_MODULE_5__.getUserContext)(req);
            assertAdminUser(user);
            ok(res, await buildUsageSummary(runtime, user));
        }
        catch (error) {
            fail(runtime, req, res, 'third-party/st-authority-sdk', error);
        }
    });
    router.get('/admin/import-export/operations', async (req, res) => {
        try {
            const user = (0,_utils_js__WEBPACK_IMPORTED_MODULE_5__.getUserContext)(req);
            assertAdminUser(user);
            ok(res, {
                operations: runtime.adminPackages.listOperations(user),
            });
        }
        catch (error) {
            fail(runtime, req, res, 'third-party/st-authority-sdk', error);
        }
    });
    router.post('/admin/import-export/export', async (req, res) => {
        try {
            const user = (0,_utils_js__WEBPACK_IMPORTED_MODULE_5__.getUserContext)(req);
            assertAdminUser(user);
            const operation = runtime.adminPackages.startExport(user, (req.body ?? {}));
            await runtime.audit.logUsage(user, _constants_js__WEBPACK_IMPORTED_MODULE_2__.AUTHORITY_SDK_EXTENSION_ID, 'Export package started', {
                operationId: operation.id,
                kind: operation.kind,
            });
            ok(res, operation);
        }
        catch (error) {
            fail(runtime, req, res, 'third-party/st-authority-sdk', error);
        }
    });
    router.post('/admin/import-export/import-transfer/init', async (req, res) => {
        try {
            const user = (0,_utils_js__WEBPACK_IMPORTED_MODULE_5__.getUserContext)(req);
            assertAdminUser(user);
            ok(res, await runtime.transfers.init(user, _constants_js__WEBPACK_IMPORTED_MODULE_2__.AUTHORITY_SDK_EXTENSION_ID, {
                resource: 'fs.private',
                purpose: 'privateFileWrite',
            }, parseAdminPackageSizeBytes(req.body?.sizeBytes)));
        }
        catch (error) {
            fail(runtime, req, res, 'third-party/st-authority-sdk', error);
        }
    });
    router.post('/admin/import-export/import', async (req, res) => {
        try {
            const user = (0,_utils_js__WEBPACK_IMPORTED_MODULE_5__.getUserContext)(req);
            assertAdminUser(user);
            const payload = (req.body ?? {});
            const transfer = runtime.transfers.get(user, _constants_js__WEBPACK_IMPORTED_MODULE_2__.AUTHORITY_SDK_EXTENSION_ID, String(payload.transferId ?? ''), 'fs.private');
            const operation = runtime.adminPackages.startImport(user, payload, transfer.filePath);
            await runtime.audit.logUsage(user, _constants_js__WEBPACK_IMPORTED_MODULE_2__.AUTHORITY_SDK_EXTENSION_ID, 'Import package started', {
                operationId: operation.id,
                transferId: transfer.transferId,
                mode: operation.importMode,
            });
            await runtime.transfers.discard(user, _constants_js__WEBPACK_IMPORTED_MODULE_2__.AUTHORITY_SDK_EXTENSION_ID, transfer.transferId).catch(() => undefined);
            ok(res, operation);
        }
        catch (error) {
            fail(runtime, req, res, 'third-party/st-authority-sdk', error);
        }
    });
    router.post('/admin/import-export/operations/:id/resume', async (req, res) => {
        try {
            const user = (0,_utils_js__WEBPACK_IMPORTED_MODULE_5__.getUserContext)(req);
            assertAdminUser(user);
            const operation = runtime.adminPackages.resume(user, String(req.params?.id ?? ''));
            await runtime.audit.logUsage(user, _constants_js__WEBPACK_IMPORTED_MODULE_2__.AUTHORITY_SDK_EXTENSION_ID, 'Import/export operation resumed', {
                operationId: operation.id,
                kind: operation.kind,
            });
            ok(res, operation);
        }
        catch (error) {
            fail(runtime, req, res, 'third-party/st-authority-sdk', error);
        }
    });
    router.post('/admin/import-export/operations/:id/open-download', async (req, res) => {
        try {
            const user = (0,_utils_js__WEBPACK_IMPORTED_MODULE_5__.getUserContext)(req);
            assertAdminUser(user);
            const artifact = runtime.adminPackages.getArtifact(user, String(req.params?.id ?? ''));
            await runtime.audit.logUsage(user, _constants_js__WEBPACK_IMPORTED_MODULE_2__.AUTHORITY_SDK_EXTENSION_ID, 'Import/export artifact opened', {
                fileName: artifact.artifact.fileName,
                sizeBytes: artifact.artifact.sizeBytes,
            });
            ok(res, await openAdminArtifactDownload(runtime, user, artifact.filePath, artifact.artifact.sizeBytes, artifact.artifact));
        }
        catch (error) {
            fail(runtime, req, res, 'third-party/st-authority-sdk', error);
        }
    });
    router.get('/admin/diagnostic-bundle', async (req, res) => {
        try {
            const user = (0,_utils_js__WEBPACK_IMPORTED_MODULE_5__.getUserContext)(req);
            assertAdminUser(user);
            ok(res, await buildDiagnosticBundle(runtime, user));
        }
        catch (error) {
            fail(runtime, req, res, 'third-party/st-authority-sdk', error);
        }
    });
    router.post('/admin/diagnostic-bundle/archive', async (req, res) => {
        try {
            const user = (0,_utils_js__WEBPACK_IMPORTED_MODULE_5__.getUserContext)(req);
            assertAdminUser(user);
            const artifact = runtime.adminPackages.createDiagnosticArchive(user, await buildDiagnosticBundle(runtime, user));
            await runtime.audit.logUsage(user, _constants_js__WEBPACK_IMPORTED_MODULE_2__.AUTHORITY_SDK_EXTENSION_ID, 'Diagnostic archive created', {
                fileName: artifact.artifact.fileName,
                sizeBytes: artifact.artifact.sizeBytes,
            });
            ok(res, await openAdminArtifactDownload(runtime, user, artifact.filePath, artifact.artifact.sizeBytes, artifact.artifact));
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
/* harmony import */ var _services_admin_package_service_js__WEBPACK_IMPORTED_MODULE_1__ = __webpack_require__(/*! ./services/admin-package-service.js */ "./src/services/admin-package-service.ts");
/* harmony import */ var _services_audit_service_js__WEBPACK_IMPORTED_MODULE_2__ = __webpack_require__(/*! ./services/audit-service.js */ "./src/services/audit-service.ts");
/* harmony import */ var _services_core_service_js__WEBPACK_IMPORTED_MODULE_3__ = __webpack_require__(/*! ./services/core-service.js */ "./src/services/core-service.ts");
/* harmony import */ var _services_data_transfer_service_js__WEBPACK_IMPORTED_MODULE_4__ = __webpack_require__(/*! ./services/data-transfer-service.js */ "./src/services/data-transfer-service.ts");
/* harmony import */ var _services_extension_service_js__WEBPACK_IMPORTED_MODULE_5__ = __webpack_require__(/*! ./services/extension-service.js */ "./src/services/extension-service.ts");
/* harmony import */ var _services_http_service_js__WEBPACK_IMPORTED_MODULE_6__ = __webpack_require__(/*! ./services/http-service.js */ "./src/services/http-service.ts");
/* harmony import */ var _services_install_service_js__WEBPACK_IMPORTED_MODULE_7__ = __webpack_require__(/*! ./services/install-service.js */ "./src/services/install-service.ts");
/* harmony import */ var _services_job_service_js__WEBPACK_IMPORTED_MODULE_8__ = __webpack_require__(/*! ./services/job-service.js */ "./src/services/job-service.ts");
/* harmony import */ var _services_permission_service_js__WEBPACK_IMPORTED_MODULE_9__ = __webpack_require__(/*! ./services/permission-service.js */ "./src/services/permission-service.ts");
/* harmony import */ var _services_policy_service_js__WEBPACK_IMPORTED_MODULE_10__ = __webpack_require__(/*! ./services/policy-service.js */ "./src/services/policy-service.ts");
/* harmony import */ var _services_private_fs_service_js__WEBPACK_IMPORTED_MODULE_11__ = __webpack_require__(/*! ./services/private-fs-service.js */ "./src/services/private-fs-service.ts");
/* harmony import */ var _services_session_service_js__WEBPACK_IMPORTED_MODULE_12__ = __webpack_require__(/*! ./services/session-service.js */ "./src/services/session-service.ts");
/* harmony import */ var _services_storage_service_js__WEBPACK_IMPORTED_MODULE_13__ = __webpack_require__(/*! ./services/storage-service.js */ "./src/services/storage-service.ts");
/* harmony import */ var _services_trivium_service_js__WEBPACK_IMPORTED_MODULE_14__ = __webpack_require__(/*! ./services/trivium-service.js */ "./src/services/trivium-service.ts");















function createAuthorityRuntime() {
    const core = new _services_core_service_js__WEBPACK_IMPORTED_MODULE_3__.CoreService();
    const events = new _events_sse_broker_js__WEBPACK_IMPORTED_MODULE_0__.SseBroker(core);
    const audit = new _services_audit_service_js__WEBPACK_IMPORTED_MODULE_2__.AuditService(core);
    const transfers = new _services_data_transfer_service_js__WEBPACK_IMPORTED_MODULE_4__.DataTransferService();
    const extensions = new _services_extension_service_js__WEBPACK_IMPORTED_MODULE_5__.ExtensionService(core);
    const install = new _services_install_service_js__WEBPACK_IMPORTED_MODULE_7__.InstallService();
    const policies = new _services_policy_service_js__WEBPACK_IMPORTED_MODULE_10__.PolicyService(core);
    const permissions = new _services_permission_service_js__WEBPACK_IMPORTED_MODULE_9__.PermissionService(policies, core);
    const sessions = new _services_session_service_js__WEBPACK_IMPORTED_MODULE_12__.SessionService(core);
    const storage = new _services_storage_service_js__WEBPACK_IMPORTED_MODULE_13__.StorageService(core);
    const files = new _services_private_fs_service_js__WEBPACK_IMPORTED_MODULE_11__.PrivateFsService(core);
    const http = new _services_http_service_js__WEBPACK_IMPORTED_MODULE_6__.HttpService(core);
    const jobs = new _services_job_service_js__WEBPACK_IMPORTED_MODULE_8__.JobService(core);
    const trivium = new _services_trivium_service_js__WEBPACK_IMPORTED_MODULE_14__.TriviumService(core);
    const adminPackages = new _services_admin_package_service_js__WEBPACK_IMPORTED_MODULE_1__.AdminPackageService(core, extensions, permissions, policies, storage, files, trivium);
    return {
        adminPackages,
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
        trivium,
    };
}


/***/ },

/***/ "./src/services/admin-package-service.ts"
/*!***********************************************!*\
  !*** ./src/services/admin-package-service.ts ***!
  \***********************************************/
(__unused_webpack_module, __webpack_exports__, __webpack_require__) {

__webpack_require__.r(__webpack_exports__);
/* harmony export */ __webpack_require__.d(__webpack_exports__, {
/* harmony export */   AdminPackageService: () => (/* binding */ AdminPackageService)
/* harmony export */ });
/* harmony import */ var node_crypto__WEBPACK_IMPORTED_MODULE_0__ = __webpack_require__(/*! node:crypto */ "node:crypto");
/* harmony import */ var node_crypto__WEBPACK_IMPORTED_MODULE_0___default = /*#__PURE__*/__webpack_require__.n(node_crypto__WEBPACK_IMPORTED_MODULE_0__);
/* harmony import */ var node_fs__WEBPACK_IMPORTED_MODULE_1__ = __webpack_require__(/*! node:fs */ "node:fs");
/* harmony import */ var node_fs__WEBPACK_IMPORTED_MODULE_1___default = /*#__PURE__*/__webpack_require__.n(node_fs__WEBPACK_IMPORTED_MODULE_1__);
/* harmony import */ var node_path__WEBPACK_IMPORTED_MODULE_2__ = __webpack_require__(/*! node:path */ "node:path");
/* harmony import */ var node_path__WEBPACK_IMPORTED_MODULE_2___default = /*#__PURE__*/__webpack_require__.n(node_path__WEBPACK_IMPORTED_MODULE_2__);
/* harmony import */ var node_zlib__WEBPACK_IMPORTED_MODULE_3__ = __webpack_require__(/*! node:zlib */ "node:zlib");
/* harmony import */ var node_zlib__WEBPACK_IMPORTED_MODULE_3___default = /*#__PURE__*/__webpack_require__.n(node_zlib__WEBPACK_IMPORTED_MODULE_3__);
/* harmony import */ var _store_authority_paths_js__WEBPACK_IMPORTED_MODULE_4__ = __webpack_require__(/*! ../store/authority-paths.js */ "./src/store/authority-paths.ts");
/* harmony import */ var _utils_js__WEBPACK_IMPORTED_MODULE_5__ = __webpack_require__(/*! ../utils.js */ "./src/utils.ts");
/* harmony import */ var _zip_archive_js__WEBPACK_IMPORTED_MODULE_6__ = __webpack_require__(/*! ./zip-archive.js */ "./src/services/zip-archive.ts");







const PORTABLE_PACKAGE_FORMAT = 'authority-portable-package-v1';
const PORTABLE_PACKAGE_ARCHIVE_FORMAT = 'authority-portable-package-archive-v2';
const PORTABLE_PACKAGE_ARCHIVE_MANIFEST_PATH = 'manifest.json';
const DIAGNOSTIC_ARCHIVE_FORMAT = 'authority-diagnostic-bundle-archive-v1';
const OPERATION_RECOVERY_ERROR = 'operation_recovery_required';
class AdminPackageService {
    core;
    extensions;
    permissions;
    policies;
    storage;
    files;
    trivium;
    recoveredUsers = new Set();
    constructor(core, extensions, permissions, policies, storage, files, trivium) {
        this.core = core;
        this.extensions = extensions;
        this.permissions = permissions;
        this.policies = policies;
        this.storage = storage;
        this.files = files;
        this.trivium = trivium;
    }
    listOperations(user) {
        this.recoverUserOperations(user);
        return this.loadOperations(user)
            .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt))
            .map(operation => this.toPublicOperation(operation));
    }
    getOperation(user, operationId) {
        this.recoverUserOperations(user);
        const operation = this.loadOperation(user, operationId);
        return operation ? this.toPublicOperation(operation) : null;
    }
    startExport(user, request = {}) {
        this.recoverUserOperations(user);
        const timestamp = (0,_utils_js__WEBPACK_IMPORTED_MODULE_5__.nowIso)();
        const operation = {
            id: node_crypto__WEBPACK_IMPORTED_MODULE_0___default().randomUUID(),
            kind: 'export',
            status: 'queued',
            progress: 0,
            createdAt: timestamp,
            updatedAt: timestamp,
            exportRequest: normalizeExportRequest(request),
            warnings: [],
        };
        this.saveOperation(user, operation);
        this.runOperation(user, operation.id);
        return this.toPublicOperation(operation);
    }
    startImport(user, request, sourcePath) {
        this.recoverUserOperations(user);
        const timestamp = (0,_utils_js__WEBPACK_IMPORTED_MODULE_5__.nowIso)();
        const operationId = node_crypto__WEBPACK_IMPORTED_MODULE_0___default().randomUUID();
        const workDir = this.getOperationWorkDir(user, operationId);
        (0,_utils_js__WEBPACK_IMPORTED_MODULE_5__.ensureDir)(workDir);
        const sourceFileName = sanitizeArtifactFileName((request.fileName ?? node_path__WEBPACK_IMPORTED_MODULE_2___default().basename(sourcePath)) || 'authority-package.authoritypkg.zip');
        const storedSourcePath = node_path__WEBPACK_IMPORTED_MODULE_2___default().join(workDir, sourceFileName);
        node_fs__WEBPACK_IMPORTED_MODULE_1___default().copyFileSync(sourcePath, storedSourcePath);
        const operation = {
            id: operationId,
            kind: 'import',
            status: 'queued',
            progress: 0,
            createdAt: timestamp,
            updatedAt: timestamp,
            importMode: request.mode === 'merge' ? 'merge' : 'replace',
            sourceFileName,
            sourcePath: storedSourcePath,
            warnings: [],
        };
        this.saveOperation(user, operation);
        this.runOperation(user, operation.id);
        return this.toPublicOperation(operation);
    }
    resume(user, operationId) {
        this.recoverUserOperations(user);
        const operation = this.requireOperation(user, operationId);
        if (operation.status !== 'failed') {
            throw new Error('Only failed import/export operations can be resumed');
        }
        const resetOperation = {
            ...operation,
            status: 'queued',
            progress: 0,
            updatedAt: (0,_utils_js__WEBPACK_IMPORTED_MODULE_5__.nowIso)(),
            warnings: [],
        };
        delete resetOperation.summary;
        delete resetOperation.error;
        delete resetOperation.startedAt;
        delete resetOperation.finishedAt;
        if (operation.kind === 'export') {
            delete resetOperation.artifact;
            delete resetOperation.artifactPath;
            delete resetOperation.importSummary;
            delete resetOperation.sourceFileName;
        }
        if (operation.artifactPath) {
            node_fs__WEBPACK_IMPORTED_MODULE_1___default().rmSync(operation.artifactPath, { force: true });
        }
        this.saveOperation(user, resetOperation);
        this.runOperation(user, operationId);
        return this.toPublicOperation(resetOperation);
    }
    getArtifact(user, operationId) {
        this.recoverUserOperations(user);
        const operation = this.requireOperation(user, operationId);
        if (!operation.artifact || !operation.artifactPath || !node_fs__WEBPACK_IMPORTED_MODULE_1___default().existsSync(operation.artifactPath)) {
            throw new Error('Operation artifact is not available');
        }
        return {
            artifact: operation.artifact,
            filePath: operation.artifactPath,
        };
    }
    createDiagnosticArchive(user, bundle) {
        this.recoverUserOperations(user);
        const generatedAt = bundle.generatedAt || (0,_utils_js__WEBPACK_IMPORTED_MODULE_5__.nowIso)();
        const archive = {
            format: DIAGNOSTIC_ARCHIVE_FORMAT,
            generatedAt,
            files: this.buildDiagnosticArchiveFiles(bundle),
        };
        const fileName = `authority-diagnostic-bundle-${sanitizeTimestamp(generatedAt)}.json.gz`;
        return this.writeStandaloneArtifact(user, 'diagnostic', fileName, archive);
    }
    runOperation(user, operationId) {
        void Promise.resolve().then(async () => {
            const current = this.requireOperation(user, operationId);
            if (current.kind === 'export') {
                await this.executeExport(user, current);
                return;
            }
            await this.executeImport(user, current);
        }).catch(() => undefined);
    }
    async executeExport(user, operation) {
        let current = this.markRunning(user, operation);
        try {
            const request = normalizeExportRequest(current.exportRequest);
            const extensions = await this.resolveExportExtensions(user, request.extensionIds);
            const totalSteps = Math.max(3, extensions.length * 6 + 2);
            let completedSteps = 0;
            current = this.updateProgress(user, current.id, completedSteps, totalSteps, '正在收集高层导出包元数据');
            const nextPackage = {
                manifest: {
                    format: PORTABLE_PACKAGE_FORMAT,
                    generatedAt: (0,_utils_js__WEBPACK_IMPORTED_MODULE_5__.nowIso)(),
                    extensionIds: extensions.map(extension => extension.id),
                    includesPolicies: request.includePolicies !== false,
                    includesUsageSummary: request.includeUsageSummary !== false,
                },
                extensions: [],
            };
            if (request.includePolicies !== false) {
                nextPackage.policies = await this.policies.getPolicies(user);
            }
            completedSteps += 1;
            current = this.updateProgress(user, current.id, completedSteps, totalSteps, '已读取管理员策略');
            if (request.includeUsageSummary !== false) {
                nextPackage.usageSummary = await this.buildUsageSummary(user, extensions);
            }
            completedSteps += 1;
            current = this.updateProgress(user, current.id, completedSteps, totalSteps, '已读取 usage summary');
            for (const extension of extensions) {
                const extensionPackage = await this.exportExtensionPackage(user, extension, phase => {
                    completedSteps += 1;
                    current = this.updateProgress(user, current.id, completedSteps, totalSteps, `${extension.displayName || extension.id} · ${phase}`);
                });
                nextPackage.extensions.push(extensionPackage);
            }
            const artifact = this.writePortablePackageArtifact(user, current.id, nextPackage);
            current = this.completeOperation(user, current.id, {
                progress: 100,
                summary: `已生成 ${nextPackage.extensions.length} 个扩展的高层导出包`,
                artifact: artifact.artifact,
                artifactPath: artifact.filePath,
            });
        }
        catch (error) {
            this.failOperation(user, current.id, error);
        }
    }
    async executeImport(user, operation) {
        let current = this.markRunning(user, operation);
        try {
            if (!current.sourcePath || !node_fs__WEBPACK_IMPORTED_MODULE_1___default().existsSync(current.sourcePath)) {
                throw new Error('Import source package is not available');
            }
            const readResult = this.readPortablePackage(current.sourcePath);
            const portablePackage = readResult.portablePackage;
            const totalSteps = Math.max(2, portablePackage.extensions.length * 5 + (portablePackage.policies ? 1 : 0));
            let completedSteps = 0;
            const mode = current.importMode === 'merge' ? 'merge' : 'replace';
            const summary = {
                extensionCount: portablePackage.extensions.length,
                grantCount: 0,
                kvEntryCount: 0,
                blobCount: 0,
                fileCount: 0,
                sqlDatabaseCount: 0,
                triviumDatabaseCount: 0,
                policyExtensionCount: portablePackage.policies ? Object.keys(portablePackage.policies.extensions).length : 0,
            };
            const warnings = [...readResult.warnings];
            if (portablePackage.policies) {
                if (mode === 'replace') {
                    await this.replacePolicies(user, portablePackage.policies);
                }
                else {
                    await this.mergePolicies(user, portablePackage.policies);
                }
                completedSteps += 1;
                current = this.updateProgress(user, current.id, completedSteps, totalSteps, '已回放管理员策略');
            }
            for (const extensionPackage of portablePackage.extensions) {
                if (mode === 'replace') {
                    await this.clearExtensionState(user, extensionPackage.extension.id);
                }
                await this.importExtensionPackage(user, extensionPackage, summary, warnings);
                completedSteps += 5;
                current = this.updateProgress(user, current.id, completedSteps, totalSteps, `${extensionPackage.extension.displayName || extensionPackage.extension.id} · 已回放`);
            }
            this.completeOperation(user, current.id, {
                progress: 100,
                summary: `已导入 ${summary.extensionCount} 个扩展的高层包`,
                importSummary: summary,
                warnings,
            });
        }
        catch (error) {
            this.failOperation(user, current.id, error);
        }
    }
    async exportExtensionPackage(user, extension, advance) {
        const grants = await this.permissions.listPersistentGrants(user, extension.id);
        advance('grants');
        const kvEntries = await this.storage.listKv(user, extension.id);
        advance('kv');
        const blobs = await this.exportBlobs(user, extension.id, await this.storage.listBlobs(user, extension.id));
        advance('blobs');
        const files = this.exportPrivateFiles(user, extension.id);
        advance('files');
        const sqlDatabases = await this.exportSqlDatabases(user, extension.id, await this.listPrivateSqlDatabases(user, extension.id));
        advance('sql');
        const triviumDatabases = await this.exportTriviumDatabases(user, extension.id, (await this.trivium.listDatabases(user, extension.id)).databases);
        advance('trivium');
        return {
            extension,
            grants,
            kvEntries,
            blobs,
            files,
            sqlDatabases,
            triviumDatabases,
        };
    }
    async importExtensionPackage(user, extensionPackage, summary, warnings) {
        const extensionId = extensionPackage.extension.id;
        const paths = (0,_store_authority_paths_js__WEBPACK_IMPORTED_MODULE_4__.getUserAuthorityPaths)(user);
        for (const grant of extensionPackage.grants) {
            await this.core.upsertControlGrant(paths.controlDbFile, {
                userHandle: user.handle,
                extensionId,
                grant,
            });
        }
        summary.grantCount += extensionPackage.grants.length;
        for (const [key, value] of Object.entries(extensionPackage.kvEntries)) {
            await this.storage.setKv(user, extensionId, key, value);
        }
        summary.kvEntryCount += Object.keys(extensionPackage.kvEntries).length;
        for (const blob of extensionPackage.blobs) {
            const payload = decodeBase64Checked(blob.contentBase64, blob.checksumSha256, `blob ${blob.record.name}`);
            await this.storage.putBlob(user, extensionId, blob.record.name, payload.toString('base64'), 'base64', blob.record.contentType);
        }
        summary.blobCount += extensionPackage.blobs.length;
        for (const file of extensionPackage.files) {
            decodeBase64Checked(file.contentBase64, file.checksumSha256, `private file ${file.path}`);
            await this.files.writeFile(user, extensionId, {
                path: file.path,
                content: file.contentBase64,
                encoding: 'base64',
                createParents: true,
            });
        }
        summary.fileCount += extensionPackage.files.length;
        for (const database of extensionPackage.sqlDatabases) {
            const bytes = decodeBase64Checked(database.contentBase64, database.checksumSha256, `sql database ${database.record.name}`);
            const dbPath = this.resolvePrivateSqlDatabasePath(user, extensionId, database.record.name);
            (0,_utils_js__WEBPACK_IMPORTED_MODULE_5__.ensureDir)(node_path__WEBPACK_IMPORTED_MODULE_2___default().dirname(dbPath));
            node_fs__WEBPACK_IMPORTED_MODULE_1___default().writeFileSync(dbPath, bytes);
        }
        summary.sqlDatabaseCount += extensionPackage.sqlDatabases.length;
        for (const database of extensionPackage.triviumDatabases) {
            const bytes = decodeBase64Checked(database.databaseContentBase64, database.databaseChecksumSha256, `trivium database ${database.record.name}`);
            const dbPath = this.resolvePrivateTriviumDatabasePath(user, extensionId, database.record.name);
            (0,_utils_js__WEBPACK_IMPORTED_MODULE_5__.ensureDir)(node_path__WEBPACK_IMPORTED_MODULE_2___default().dirname(dbPath));
            node_fs__WEBPACK_IMPORTED_MODULE_1___default().writeFileSync(dbPath, bytes);
            const mappingPath = this.resolvePrivateTriviumMappingPath(user, extensionId, database.record.name);
            if (database.mappingContentBase64 && database.mappingChecksumSha256) {
                const mappingBytes = decodeBase64Checked(database.mappingContentBase64, database.mappingChecksumSha256, `trivium mapping ${database.record.name}`);
                (0,_utils_js__WEBPACK_IMPORTED_MODULE_5__.ensureDir)(node_path__WEBPACK_IMPORTED_MODULE_2___default().dirname(mappingPath));
                node_fs__WEBPACK_IMPORTED_MODULE_1___default().writeFileSync(mappingPath, mappingBytes);
            }
            else {
                node_fs__WEBPACK_IMPORTED_MODULE_1___default().rmSync(mappingPath, { force: true });
            }
        }
        summary.triviumDatabaseCount += extensionPackage.triviumDatabases.length;
        if (!extensionPackage.extension.displayName?.trim()) {
            warnings.push(`扩展 ${extensionId} 在导出包中没有 displayName，导入后会等待扩展自身再次上报元数据。`);
        }
    }
    async buildUsageSummary(user, extensions) {
        const generatedAt = (0,_utils_js__WEBPACK_IMPORTED_MODULE_5__.nowIso)();
        const entries = await Promise.all(extensions.map(async (extension) => {
            const grants = await this.permissions.listPersistentGrants(user, extension.id);
            const sqlDatabases = await this.listPrivateSqlDatabases(user, extension.id);
            const triviumDatabases = (await this.trivium.listDatabases(user, extension.id)).databases;
            const storage = await this.buildExtensionStorageSummary(user, extension.id, sqlDatabases, triviumDatabases);
            return {
                extension,
                grantedCount: grants.filter(grant => grant.status === 'granted').length,
                deniedCount: grants.filter(grant => grant.status === 'denied' || grant.status === 'blocked').length,
                storage,
            };
        }));
        const totals = entries.reduce((aggregate, entry) => ({
            extensionCount: aggregate.extensionCount + 1,
            kvEntries: aggregate.kvEntries + entry.storage.kvEntries,
            blobCount: aggregate.blobCount + entry.storage.blobCount,
            blobBytes: aggregate.blobBytes + entry.storage.blobBytes,
            databaseCount: aggregate.databaseCount + entry.storage.databaseCount,
            databaseBytes: aggregate.databaseBytes + entry.storage.databaseBytes,
            sqlDatabaseCount: aggregate.sqlDatabaseCount + entry.storage.sqlDatabaseCount,
            sqlDatabaseBytes: aggregate.sqlDatabaseBytes + entry.storage.sqlDatabaseBytes,
            triviumDatabaseCount: aggregate.triviumDatabaseCount + entry.storage.triviumDatabaseCount,
            triviumDatabaseBytes: aggregate.triviumDatabaseBytes + entry.storage.triviumDatabaseBytes,
            files: {
                fileCount: aggregate.files.fileCount + entry.storage.files.fileCount,
                directoryCount: aggregate.files.directoryCount + entry.storage.files.directoryCount,
                totalSizeBytes: aggregate.files.totalSizeBytes + entry.storage.files.totalSizeBytes,
                latestUpdatedAt: newestTimestamp(aggregate.files.latestUpdatedAt, entry.storage.files.latestUpdatedAt),
            },
        }), {
            extensionCount: 0,
            kvEntries: 0,
            blobCount: 0,
            blobBytes: 0,
            databaseCount: 0,
            databaseBytes: 0,
            sqlDatabaseCount: 0,
            sqlDatabaseBytes: 0,
            triviumDatabaseCount: 0,
            triviumDatabaseBytes: 0,
            files: {
                fileCount: 0,
                directoryCount: 0,
                totalSizeBytes: 0,
                latestUpdatedAt: null,
            },
        });
        return {
            generatedAt,
            totals,
            extensions: entries,
        };
    }
    async buildExtensionStorageSummary(user, extensionId, sqlDatabases, triviumDatabases) {
        const [kvEntries, blobs, files] = await Promise.all([
            this.storage.listKv(user, extensionId),
            this.storage.listBlobs(user, extensionId),
            this.files.getUsageSummary(user, extensionId),
        ]);
        return {
            kvEntries: Object.keys(kvEntries).length,
            blobCount: blobs.length,
            blobBytes: blobs.reduce((sum, blob) => sum + blob.size, 0),
            databaseCount: sqlDatabases.length + triviumDatabases.length,
            databaseBytes: sqlDatabases.reduce((sum, database) => sum + database.sizeBytes, 0)
                + triviumDatabases.reduce((sum, database) => sum + database.totalSizeBytes, 0),
            sqlDatabaseCount: sqlDatabases.length,
            sqlDatabaseBytes: sqlDatabases.reduce((sum, database) => sum + database.sizeBytes, 0),
            triviumDatabaseCount: triviumDatabases.length,
            triviumDatabaseBytes: triviumDatabases.reduce((sum, database) => sum + database.totalSizeBytes, 0),
            files,
        };
    }
    async exportBlobs(user, extensionId, records) {
        return await Promise.all(records.map(async (record) => {
            const opened = await this.storage.openBlobRead(user, extensionId, record.id);
            const bytes = node_fs__WEBPACK_IMPORTED_MODULE_1___default().readFileSync(opened.sourcePath);
            return {
                record,
                contentBase64: bytes.toString('base64'),
                checksumSha256: hashBytes(bytes),
            };
        }));
    }
    exportPrivateFiles(user, extensionId) {
        const rootDir = this.resolvePrivateFilesRoot(user, extensionId);
        if (!node_fs__WEBPACK_IMPORTED_MODULE_1___default().existsSync(rootDir)) {
            return [];
        }
        const entries = [];
        const walk = (currentDir, virtualPrefix) => {
            for (const entry of node_fs__WEBPACK_IMPORTED_MODULE_1___default().readdirSync(currentDir, { withFileTypes: true })) {
                const fullPath = node_path__WEBPACK_IMPORTED_MODULE_2___default().join(currentDir, entry.name);
                const stats = node_fs__WEBPACK_IMPORTED_MODULE_1___default().lstatSync(fullPath);
                if (stats.isSymbolicLink()) {
                    continue;
                }
                const virtualPath = `${virtualPrefix}/${entry.name}`.replace(/\\/g, '/');
                if (entry.isDirectory()) {
                    walk(fullPath, virtualPath);
                    continue;
                }
                if (!entry.isFile()) {
                    continue;
                }
                const bytes = node_fs__WEBPACK_IMPORTED_MODULE_1___default().readFileSync(fullPath);
                entries.push({
                    path: virtualPath,
                    sizeBytes: bytes.byteLength,
                    updatedAt: new Date(stats.mtimeMs).toISOString(),
                    contentBase64: bytes.toString('base64'),
                    checksumSha256: hashBytes(bytes),
                });
            }
        };
        walk(rootDir, '');
        entries.sort((left, right) => left.path.localeCompare(right.path));
        return entries;
    }
    async exportSqlDatabases(user, extensionId, records) {
        return await Promise.all(records.map(async (record) => {
            const filePath = this.resolvePrivateSqlDatabasePath(user, extensionId, record.name);
            const bytes = node_fs__WEBPACK_IMPORTED_MODULE_1___default().existsSync(filePath) ? node_fs__WEBPACK_IMPORTED_MODULE_1___default().readFileSync(filePath) : Buffer.alloc(0);
            return {
                record,
                contentBase64: bytes.toString('base64'),
                checksumSha256: hashBytes(bytes),
            };
        }));
    }
    async exportTriviumDatabases(user, extensionId, records) {
        return await Promise.all(records.map(async (record) => {
            const dbPath = this.resolvePrivateTriviumDatabasePath(user, extensionId, record.name);
            const mappingPath = this.resolvePrivateTriviumMappingPath(user, extensionId, record.name);
            const databaseBytes = node_fs__WEBPACK_IMPORTED_MODULE_1___default().existsSync(dbPath) ? node_fs__WEBPACK_IMPORTED_MODULE_1___default().readFileSync(dbPath) : Buffer.alloc(0);
            const mappingBytes = node_fs__WEBPACK_IMPORTED_MODULE_1___default().existsSync(mappingPath) ? node_fs__WEBPACK_IMPORTED_MODULE_1___default().readFileSync(mappingPath) : null;
            return {
                record,
                databaseContentBase64: databaseBytes.toString('base64'),
                databaseChecksumSha256: hashBytes(databaseBytes),
                ...(mappingBytes
                    ? {
                        mappingContentBase64: mappingBytes.toString('base64'),
                        mappingChecksumSha256: hashBytes(mappingBytes),
                    }
                    : {}),
            };
        }));
    }
    async listPrivateSqlDatabases(user, extensionId) {
        const databaseDir = this.resolvePrivateSqlDatabaseDir(user, extensionId);
        if (!node_fs__WEBPACK_IMPORTED_MODULE_1___default().existsSync(databaseDir)) {
            return [];
        }
        const databases = await Promise.all(node_fs__WEBPACK_IMPORTED_MODULE_1___default().readdirSync(databaseDir, { withFileTypes: true })
            .filter(entry => entry.isFile() && entry.name.endsWith('.sqlite'))
            .map(async (entry) => {
            const databaseName = entry.name.slice(0, -'.sqlite'.length);
            const stat = await this.core.statSql(this.resolvePrivateSqlDatabasePath(user, extensionId, databaseName), {
                database: databaseName,
            });
            return {
                name: stat.name,
                fileName: stat.fileName,
                sizeBytes: stat.sizeBytes,
                updatedAt: stat.updatedAt,
                runtimeConfig: stat.runtimeConfig,
                slowQuery: stat.slowQuery,
            };
        }));
        databases.sort((left, right) => (right.updatedAt ?? '').localeCompare(left.updatedAt ?? ''));
        return databases;
    }
    async clearExtensionState(user, extensionId) {
        const paths = (0,_store_authority_paths_js__WEBPACK_IMPORTED_MODULE_4__.getUserAuthorityPaths)(user);
        await this.permissions.resetPersistentGrants(user, extensionId);
        const blobs = await this.storage.listBlobs(user, extensionId);
        for (const blob of blobs) {
            await this.storage.deleteBlob(user, extensionId, blob.id);
        }
        node_fs__WEBPACK_IMPORTED_MODULE_1___default().rmSync(this.resolvePrivateFilesRoot(user, extensionId), { recursive: true, force: true });
        node_fs__WEBPACK_IMPORTED_MODULE_1___default().rmSync(node_path__WEBPACK_IMPORTED_MODULE_2___default().join(paths.kvDir, `${(0,_utils_js__WEBPACK_IMPORTED_MODULE_5__.sanitizeFileSegment)(extensionId)}.sqlite`), { force: true });
        node_fs__WEBPACK_IMPORTED_MODULE_1___default().rmSync(this.resolvePrivateSqlDatabaseDir(user, extensionId), { recursive: true, force: true });
        node_fs__WEBPACK_IMPORTED_MODULE_1___default().rmSync(this.resolvePrivateTriviumDatabaseDir(user, extensionId), { recursive: true, force: true });
    }
    async mergePolicies(user, document) {
        await this.policies.saveGlobalPolicies(user, {
            defaults: document.defaults,
            extensions: document.extensions,
            limits: document.limits,
        });
    }
    async replacePolicies(user, document) {
        await this.core.getControlPolicies((0,_store_authority_paths_js__WEBPACK_IMPORTED_MODULE_4__.getGlobalAuthorityPaths)().controlDbFile, { userHandle: user.handle });
        await this.core.execSql((0,_store_authority_paths_js__WEBPACK_IMPORTED_MODULE_4__.getGlobalAuthorityPaths)().controlDbFile, {
            statement: `DELETE FROM authority_policy_documents WHERE name = 'global'`,
        });
        await this.mergePolicies(user, document);
    }
    readPortablePackage(filePath) {
        const rawBytes = node_fs__WEBPACK_IMPORTED_MODULE_1___default().readFileSync(filePath);
        if ((0,_zip_archive_js__WEBPACK_IMPORTED_MODULE_6__.isZipArchive)(rawBytes)) {
            return this.readPortablePackageArchive(rawBytes);
        }
        const text = tryGunzip(rawBytes).toString('utf8');
        const payload = JSON.parse(text);
        if (payload?.manifest?.format !== PORTABLE_PACKAGE_FORMAT) {
            throw new Error(`Unsupported package format: ${String(payload?.manifest?.format ?? 'unknown')}`);
        }
        return {
            portablePackage: payload,
            warnings: ['导入源包使用 legacy 单文件 .json.gz 格式；建议重新导出为新的 .authoritypkg.zip 多文件包。'],
        };
    }
    readPortablePackageArchive(rawBytes) {
        const archiveFiles = (0,_zip_archive_js__WEBPACK_IMPORTED_MODULE_6__.readZipArchive)(rawBytes);
        const manifest = this.parseArchiveJson(archiveFiles, PORTABLE_PACKAGE_ARCHIVE_MANIFEST_PATH, 'portable package archive manifest');
        if (manifest?.format !== PORTABLE_PACKAGE_ARCHIVE_FORMAT) {
            throw new Error(`Unsupported package archive format: ${String(manifest?.format ?? 'unknown')}`);
        }
        if (manifest.packageManifest?.format !== PORTABLE_PACKAGE_FORMAT) {
            throw new Error(`Unsupported logical package format inside archive: ${String(manifest.packageManifest?.format ?? 'unknown')}`);
        }
        this.validatePortablePackageArchiveManifest(manifest, archiveFiles);
        const portablePackage = {
            manifest: manifest.packageManifest,
            extensions: [],
        };
        if (manifest.policiesPath) {
            portablePackage.policies = this.parseArchiveJson(archiveFiles, manifest.policiesPath, 'portable package policies');
        }
        if (manifest.usageSummaryPath) {
            portablePackage.usageSummary = this.parseArchiveJson(archiveFiles, manifest.usageSummaryPath, 'portable package usage summary');
        }
        for (const extensionRef of manifest.extensions) {
            const extension = this.parseArchiveJson(archiveFiles, extensionRef.extensionPath, `extension ${extensionRef.extensionId} metadata`);
            if (extension.id !== extensionRef.extensionId) {
                throw new Error(`Portable package extension metadata mismatch: expected ${extensionRef.extensionId}, received ${extension.id}`);
            }
            const grants = this.parseArchiveJson(archiveFiles, extensionRef.grantsPath, `extension ${extension.id} grants`);
            const kvEntries = this.parseArchiveJson(archiveFiles, extensionRef.kvEntriesPath, `extension ${extension.id} kv entries`);
            const blobs = extensionRef.blobs.map(blob => {
                const bytes = this.requireArchiveBinary(archiveFiles, blob.archivePath, blob.checksumSha256, `blob ${blob.record.name}`);
                return {
                    record: blob.record,
                    contentBase64: bytes.toString('base64'),
                    checksumSha256: blob.checksumSha256,
                };
            });
            const files = extensionRef.files.map(file => {
                const bytes = this.requireArchiveBinary(archiveFiles, file.archivePath, file.checksumSha256, `private file ${file.path}`);
                return {
                    path: file.path,
                    sizeBytes: file.sizeBytes,
                    updatedAt: file.updatedAt,
                    contentBase64: bytes.toString('base64'),
                    checksumSha256: file.checksumSha256,
                };
            });
            const sqlDatabases = extensionRef.sqlDatabases.map(database => {
                const bytes = this.requireArchiveBinary(archiveFiles, database.archivePath, database.checksumSha256, `sql database ${database.record.name}`);
                return {
                    record: database.record,
                    contentBase64: bytes.toString('base64'),
                    checksumSha256: database.checksumSha256,
                };
            });
            const triviumDatabases = extensionRef.triviumDatabases.map(database => {
                const databaseBytes = this.requireArchiveBinary(archiveFiles, database.databaseArchivePath, database.databaseChecksumSha256, `trivium database ${database.record.name}`);
                const nextDatabase = {
                    record: database.record,
                    databaseContentBase64: databaseBytes.toString('base64'),
                    databaseChecksumSha256: database.databaseChecksumSha256,
                };
                if (database.mappingArchivePath && database.mappingChecksumSha256) {
                    const mappingBytes = this.requireArchiveBinary(archiveFiles, database.mappingArchivePath, database.mappingChecksumSha256, `trivium mapping ${database.record.name}`);
                    nextDatabase.mappingContentBase64 = mappingBytes.toString('base64');
                    nextDatabase.mappingChecksumSha256 = database.mappingChecksumSha256;
                }
                return nextDatabase;
            });
            portablePackage.extensions.push({
                extension,
                grants,
                kvEntries,
                blobs,
                files,
                sqlDatabases,
                triviumDatabases,
            });
        }
        return {
            portablePackage,
            warnings: [],
        };
    }
    validatePortablePackageArchiveManifest(manifest, archiveFiles) {
        const seen = new Set();
        for (const entry of manifest.entries) {
            if (seen.has(entry.path)) {
                throw new Error(`Portable package archive contains duplicate manifest entry: ${entry.path}`);
            }
            seen.add(entry.path);
            const bytes = archiveFiles.get(entry.path);
            if (!bytes) {
                throw new Error(`Portable package archive is missing file: ${entry.path}`);
            }
            if (bytes.byteLength !== entry.sizeBytes) {
                throw new Error(`Portable package archive file size mismatch: ${entry.path}`);
            }
            const checksum = hashBytes(bytes);
            if (checksum !== entry.checksumSha256) {
                throw new Error(`Portable package archive file checksum mismatch: ${entry.path}`);
            }
        }
        const referencedPaths = new Set();
        if (manifest.policiesPath) {
            referencedPaths.add(manifest.policiesPath);
        }
        if (manifest.usageSummaryPath) {
            referencedPaths.add(manifest.usageSummaryPath);
        }
        for (const extension of manifest.extensions) {
            referencedPaths.add(extension.extensionPath);
            referencedPaths.add(extension.grantsPath);
            referencedPaths.add(extension.kvEntriesPath);
            for (const blob of extension.blobs) {
                referencedPaths.add(blob.archivePath);
            }
            for (const file of extension.files) {
                referencedPaths.add(file.archivePath);
            }
            for (const database of extension.sqlDatabases) {
                referencedPaths.add(database.archivePath);
            }
            for (const database of extension.triviumDatabases) {
                referencedPaths.add(database.databaseArchivePath);
                if (database.mappingArchivePath) {
                    referencedPaths.add(database.mappingArchivePath);
                }
            }
        }
        for (const referencedPath of referencedPaths) {
            if (!seen.has(referencedPath)) {
                throw new Error(`Portable package archive manifest is missing entry metadata for: ${referencedPath}`);
            }
        }
    }
    parseArchiveJson(archiveFiles, archivePath, label) {
        const bytes = archiveFiles.get(archivePath);
        if (!bytes) {
            throw new Error(`${label} is missing from the portable package archive`);
        }
        return JSON.parse(bytes.toString('utf8'));
    }
    requireArchiveBinary(archiveFiles, archivePath, checksumSha256, label) {
        const bytes = archiveFiles.get(archivePath);
        if (!bytes) {
            throw new Error(`${label} is missing from the portable package archive`);
        }
        const checksum = hashBytes(bytes);
        if (checksum !== checksumSha256) {
            throw new Error(`${label} checksum mismatch: expected ${checksumSha256}, received ${checksum}`);
        }
        return bytes;
    }
    writePortablePackageArtifact(user, operationId, portablePackage) {
        const filePath = node_path__WEBPACK_IMPORTED_MODULE_2___default().join(this.getOperationWorkDir(user, operationId), sanitizeArtifactFileName(`authority-export-package-${sanitizeTimestamp(portablePackage.manifest.generatedAt)}.authoritypkg.zip`));
        (0,_utils_js__WEBPACK_IMPORTED_MODULE_5__.ensureDir)(node_path__WEBPACK_IMPORTED_MODULE_2___default().dirname(filePath));
        const { manifest, files } = this.buildPortablePackageArchive(portablePackage);
        const archiveBytes = (0,_zip_archive_js__WEBPACK_IMPORTED_MODULE_6__.createZipArchive)([
            {
                path: PORTABLE_PACKAGE_ARCHIVE_MANIFEST_PATH,
                bytes: Buffer.from(JSON.stringify(manifest, null, 2), 'utf8'),
                compression: 'deflate',
            },
            ...files.map(file => ({
                path: file.path,
                bytes: file.bytes,
                compression: file.mediaType === 'application/json' ? 'deflate' : 'auto',
            })),
        ]);
        node_fs__WEBPACK_IMPORTED_MODULE_1___default().writeFileSync(filePath, archiveBytes);
        return {
            artifact: buildArtifactSummary(node_path__WEBPACK_IMPORTED_MODULE_2___default().basename(filePath), archiveBytes, 'application/zip'),
            filePath,
        };
    }
    buildPortablePackageArchive(portablePackage) {
        const files = [];
        const pushJsonFile = (archivePath, value) => {
            files.push({
                path: archivePath,
                mediaType: 'application/json',
                bytes: Buffer.from(JSON.stringify(value, null, 2), 'utf8'),
            });
            return archivePath;
        };
        const pushBinaryFile = (archivePath, bytes, mediaType = 'application/octet-stream') => {
            files.push({
                path: archivePath,
                mediaType,
                bytes,
            });
            return archivePath;
        };
        const policiesPath = portablePackage.policies ? pushJsonFile('policies.json', portablePackage.policies) : undefined;
        const usageSummaryPath = portablePackage.usageSummary ? pushJsonFile('usage-summary.json', portablePackage.usageSummary) : undefined;
        const extensions = portablePackage.extensions.map((extensionPackage, extensionIndex) => {
            const extensionDir = `extensions/${String(extensionIndex).padStart(3, '0')}-${(0,_utils_js__WEBPACK_IMPORTED_MODULE_5__.sanitizeFileSegment)(extensionPackage.extension.id)}`;
            const extensionPath = pushJsonFile(`${extensionDir}/extension.json`, extensionPackage.extension);
            const grantsPath = pushJsonFile(`${extensionDir}/grants.json`, extensionPackage.grants);
            const kvEntriesPath = pushJsonFile(`${extensionDir}/kv.json`, extensionPackage.kvEntries);
            const blobs = extensionPackage.blobs.map((blob, blobIndex) => {
                const bytes = decodeBase64Checked(blob.contentBase64, blob.checksumSha256, `blob ${blob.record.name}`);
                const archivePath = pushBinaryFile(buildIndexedArchivePath(`${extensionDir}/blobs`, blobIndex, blob.record.name || blob.record.id || 'blob.bin'), bytes, blob.record.contentType || 'application/octet-stream');
                return {
                    record: blob.record,
                    archivePath,
                    sizeBytes: bytes.byteLength,
                    checksumSha256: hashBytes(bytes),
                };
            });
            const privateFiles = extensionPackage.files.map((file, fileIndex) => {
                const bytes = decodeBase64Checked(file.contentBase64, file.checksumSha256, `private file ${file.path}`);
                const archivePath = pushBinaryFile(buildIndexedArchivePath(`${extensionDir}/files`, fileIndex, file.path || 'file.bin'), bytes);
                return {
                    path: file.path,
                    archivePath,
                    sizeBytes: bytes.byteLength,
                    updatedAt: file.updatedAt,
                    checksumSha256: hashBytes(bytes),
                };
            });
            const sqlDatabases = extensionPackage.sqlDatabases.map((database, databaseIndex) => {
                const bytes = decodeBase64Checked(database.contentBase64, database.checksumSha256, `sql database ${database.record.name}`);
                const archivePath = pushBinaryFile(buildIndexedArchivePath(`${extensionDir}/sql`, databaseIndex, database.record.fileName || `${database.record.name}.sqlite`), bytes);
                return {
                    record: database.record,
                    archivePath,
                    sizeBytes: bytes.byteLength,
                    checksumSha256: hashBytes(bytes),
                };
            });
            const triviumDatabases = extensionPackage.triviumDatabases.map((database, databaseIndex) => {
                const databaseBytes = decodeBase64Checked(database.databaseContentBase64, database.databaseChecksumSha256, `trivium database ${database.record.name}`);
                const databaseArchivePath = pushBinaryFile(buildIndexedArchivePath(`${extensionDir}/trivium`, databaseIndex, database.record.fileName || `${database.record.name}.tdb`), databaseBytes);
                const nextDatabase = {
                    record: database.record,
                    databaseArchivePath,
                    databaseSizeBytes: databaseBytes.byteLength,
                    databaseChecksumSha256: hashBytes(databaseBytes),
                };
                if (database.mappingContentBase64 && database.mappingChecksumSha256) {
                    const mappingBytes = decodeBase64Checked(database.mappingContentBase64, database.mappingChecksumSha256, `trivium mapping ${database.record.name}`);
                    nextDatabase.mappingArchivePath = pushBinaryFile(buildIndexedArchivePath(`${extensionDir}/trivium`, databaseIndex, `${database.record.name}.mapping.sqlite`), mappingBytes);
                    nextDatabase.mappingSizeBytes = mappingBytes.byteLength;
                    nextDatabase.mappingChecksumSha256 = hashBytes(mappingBytes);
                }
                return nextDatabase;
            });
            return {
                extensionId: extensionPackage.extension.id,
                extensionPath,
                grantsPath,
                kvEntriesPath,
                blobs,
                files: privateFiles,
                sqlDatabases,
                triviumDatabases,
            };
        });
        const manifest = {
            format: PORTABLE_PACKAGE_ARCHIVE_FORMAT,
            generatedAt: portablePackage.manifest.generatedAt,
            packageManifest: portablePackage.manifest,
            entries: files.map(file => buildArchiveFileEntry(file)),
            ...(policiesPath ? { policiesPath } : {}),
            ...(usageSummaryPath ? { usageSummaryPath } : {}),
            extensions,
        };
        return {
            manifest,
            files,
        };
    }
    buildDiagnosticArchiveFiles(bundle) {
        const files = [];
        files.push(this.buildUtf8ArchiveFile('bundle.json', bundle));
        files.push(this.buildUtf8ArchiveFile('probe.json', bundle.probe));
        files.push(this.buildUtf8ArchiveFile('policies.json', bundle.policies));
        files.push(this.buildUtf8ArchiveFile('usage-summary.json', bundle.usageSummary));
        files.push(this.buildUtf8ArchiveFile('jobs.json', bundle.jobs));
        files.push(this.buildUtf8ArchiveFile('extensions/index.json', bundle.extensions.map(extension => ({
            id: extension.extension.id,
            displayName: extension.extension.displayName,
            storage: extension.storage,
            jobs: extension.jobsPage,
        }))));
        for (const extension of bundle.extensions) {
            files.push(this.buildUtf8ArchiveFile(`extensions/${(0,_utils_js__WEBPACK_IMPORTED_MODULE_5__.sanitizeFileSegment)(extension.extension.id)}.json`, extension));
        }
        if (bundle.releaseMetadata) {
            files.push(this.buildUtf8ArchiveFile('release-metadata.json', bundle.releaseMetadata));
        }
        return files;
    }
    buildUtf8ArchiveFile(pathName, value) {
        const content = JSON.stringify(value, null, 2);
        return {
            path: pathName,
            mediaType: 'application/json',
            encoding: 'utf8',
            content,
            sizeBytes: Buffer.byteLength(content),
            checksumSha256: hashText(content),
        };
    }
    resolveExportExtensions(user, extensionIds) {
        return extensionIds && extensionIds.length > 0
            ? Promise.all(extensionIds.map(async (extensionId) => {
                const extension = await this.extensions.getExtension(user, extensionId);
                if (!extension) {
                    throw new Error(`Extension not found: ${extensionId}`);
                }
                return extension;
            }))
            : this.extensions.listExtensions(user);
    }
    recoverUserOperations(user) {
        const recoveryKey = `${user.handle}\u0000${user.rootDir}`;
        if (this.recoveredUsers.has(recoveryKey)) {
            return;
        }
        for (const operation of this.loadOperations(user)) {
            if (operation.status !== 'queued' && operation.status !== 'running') {
                continue;
            }
            const recovered = {
                ...operation,
                status: 'failed',
                progress: 0,
                summary: '运行中的导入导出任务在服务重启后需要手动恢复',
                error: OPERATION_RECOVERY_ERROR,
                updatedAt: (0,_utils_js__WEBPACK_IMPORTED_MODULE_5__.nowIso)(),
                finishedAt: (0,_utils_js__WEBPACK_IMPORTED_MODULE_5__.nowIso)(),
            };
            this.saveOperation(user, recovered);
        }
        this.recoveredUsers.add(recoveryKey);
    }
    markRunning(user, operation) {
        const running = {
            ...operation,
            status: 'running',
            progress: 1,
            summary: operation.kind === 'export' ? '正在构建高层导出包' : '正在回放高层导入包',
            startedAt: (0,_utils_js__WEBPACK_IMPORTED_MODULE_5__.nowIso)(),
            updatedAt: (0,_utils_js__WEBPACK_IMPORTED_MODULE_5__.nowIso)(),
            warnings: [],
        };
        delete running.error;
        delete running.finishedAt;
        this.saveOperation(user, running);
        return running;
    }
    updateProgress(user, operationId, completedSteps, totalSteps, summary) {
        const operation = this.requireOperation(user, operationId);
        const next = {
            ...operation,
            progress: Math.max(1, Math.min(99, Math.round((completedSteps / Math.max(1, totalSteps)) * 100))),
            summary,
            updatedAt: (0,_utils_js__WEBPACK_IMPORTED_MODULE_5__.nowIso)(),
        };
        this.saveOperation(user, next);
        return next;
    }
    completeOperation(user, operationId, patch) {
        const operation = this.requireOperation(user, operationId);
        const completed = {
            ...operation,
            ...patch,
            status: 'completed',
            progress: 100,
            updatedAt: (0,_utils_js__WEBPACK_IMPORTED_MODULE_5__.nowIso)(),
            finishedAt: (0,_utils_js__WEBPACK_IMPORTED_MODULE_5__.nowIso)(),
        };
        delete completed.error;
        this.saveOperation(user, completed);
        return completed;
    }
    failOperation(user, operationId, error) {
        const operation = this.requireOperation(user, operationId);
        const failed = {
            ...operation,
            status: 'failed',
            updatedAt: (0,_utils_js__WEBPACK_IMPORTED_MODULE_5__.nowIso)(),
            finishedAt: (0,_utils_js__WEBPACK_IMPORTED_MODULE_5__.nowIso)(),
            error: (0,_utils_js__WEBPACK_IMPORTED_MODULE_5__.asErrorMessage)(error),
            summary: operation.kind === 'export' ? '高层导出包生成失败' : '高层导入包回放失败',
        };
        this.saveOperation(user, failed);
    }
    writeOperationArtifact(user, operationId, fileName, payload) {
        const filePath = node_path__WEBPACK_IMPORTED_MODULE_2___default().join(this.getOperationWorkDir(user, operationId), sanitizeArtifactFileName(fileName));
        (0,_utils_js__WEBPACK_IMPORTED_MODULE_5__.ensureDir)(node_path__WEBPACK_IMPORTED_MODULE_2___default().dirname(filePath));
        const bytes = node_zlib__WEBPACK_IMPORTED_MODULE_3___default().gzipSync(Buffer.from(JSON.stringify(payload), 'utf8'));
        node_fs__WEBPACK_IMPORTED_MODULE_1___default().writeFileSync(filePath, bytes);
        return {
            artifact: buildArtifactSummary(node_path__WEBPACK_IMPORTED_MODULE_2___default().basename(filePath), bytes, 'application/gzip'),
            filePath,
        };
    }
    writeStandaloneArtifact(user, prefix, fileName, payload) {
        const artifactId = `${prefix}-${node_crypto__WEBPACK_IMPORTED_MODULE_0___default().randomUUID()}`;
        const filePath = node_path__WEBPACK_IMPORTED_MODULE_2___default().join(this.getStandaloneArtifactsDir(user), artifactId, sanitizeArtifactFileName(fileName));
        (0,_utils_js__WEBPACK_IMPORTED_MODULE_5__.ensureDir)(node_path__WEBPACK_IMPORTED_MODULE_2___default().dirname(filePath));
        const bytes = node_zlib__WEBPACK_IMPORTED_MODULE_3___default().gzipSync(Buffer.from(JSON.stringify(payload), 'utf8'));
        node_fs__WEBPACK_IMPORTED_MODULE_1___default().writeFileSync(filePath, bytes);
        return {
            artifact: buildArtifactSummary(node_path__WEBPACK_IMPORTED_MODULE_2___default().basename(filePath), bytes, 'application/gzip'),
            filePath,
        };
    }
    loadOperations(user) {
        const dirPath = this.getOperationsDir(user);
        if (!node_fs__WEBPACK_IMPORTED_MODULE_1___default().existsSync(dirPath)) {
            return [];
        }
        return node_fs__WEBPACK_IMPORTED_MODULE_1___default().readdirSync(dirPath)
            .filter(entry => entry.endsWith('.json'))
            .map(entry => (0,_utils_js__WEBPACK_IMPORTED_MODULE_5__.readJsonFile)(node_path__WEBPACK_IMPORTED_MODULE_2___default().join(dirPath, entry), null))
            .filter((entry) => Boolean(entry));
    }
    loadOperation(user, operationId) {
        return (0,_utils_js__WEBPACK_IMPORTED_MODULE_5__.readJsonFile)(this.getOperationStatePath(user, operationId), null);
    }
    requireOperation(user, operationId) {
        const operation = this.loadOperation(user, operationId);
        if (!operation) {
            throw new Error('Import/export operation not found');
        }
        return operation;
    }
    saveOperation(user, operation) {
        (0,_utils_js__WEBPACK_IMPORTED_MODULE_5__.atomicWriteJson)(this.getOperationStatePath(user, operation.id), operation);
    }
    toPublicOperation(operation) {
        const { artifactPath: _artifactPath, sourcePath: _sourcePath, ...publicOperation } = operation;
        return publicOperation;
    }
    getOperationsDir(user) {
        return node_path__WEBPACK_IMPORTED_MODULE_2___default().join(this.getPackagesRoot(user), 'operations');
    }
    getStandaloneArtifactsDir(user) {
        return node_path__WEBPACK_IMPORTED_MODULE_2___default().join(this.getPackagesRoot(user), 'standalone');
    }
    getOperationStatePath(user, operationId) {
        return node_path__WEBPACK_IMPORTED_MODULE_2___default().join(this.getOperationsDir(user), `${(0,_utils_js__WEBPACK_IMPORTED_MODULE_5__.sanitizeFileSegment)(operationId)}.json`);
    }
    getOperationWorkDir(user, operationId) {
        return node_path__WEBPACK_IMPORTED_MODULE_2___default().join(this.getPackagesRoot(user), 'work', (0,_utils_js__WEBPACK_IMPORTED_MODULE_5__.sanitizeFileSegment)(operationId));
    }
    getPackagesRoot(user) {
        return node_path__WEBPACK_IMPORTED_MODULE_2___default().join(node_path__WEBPACK_IMPORTED_MODULE_2___default().dirname((0,_store_authority_paths_js__WEBPACK_IMPORTED_MODULE_4__.getUserAuthorityPaths)(user).controlDbFile), 'admin-packages');
    }
    resolvePrivateFilesRoot(user, extensionId) {
        return node_path__WEBPACK_IMPORTED_MODULE_2___default().join((0,_store_authority_paths_js__WEBPACK_IMPORTED_MODULE_4__.getUserAuthorityPaths)(user).filesDir, (0,_utils_js__WEBPACK_IMPORTED_MODULE_5__.sanitizeFileSegment)(extensionId));
    }
    resolvePrivateSqlDatabaseDir(user, extensionId) {
        return node_path__WEBPACK_IMPORTED_MODULE_2___default().join((0,_store_authority_paths_js__WEBPACK_IMPORTED_MODULE_4__.getUserAuthorityPaths)(user).sqlPrivateDir, (0,_utils_js__WEBPACK_IMPORTED_MODULE_5__.sanitizeFileSegment)(extensionId));
    }
    resolvePrivateSqlDatabasePath(user, extensionId, databaseName) {
        return node_path__WEBPACK_IMPORTED_MODULE_2___default().join(this.resolvePrivateSqlDatabaseDir(user, extensionId), `${(0,_utils_js__WEBPACK_IMPORTED_MODULE_5__.sanitizeFileSegment)(databaseName)}.sqlite`);
    }
    resolvePrivateTriviumDatabaseDir(user, extensionId) {
        return node_path__WEBPACK_IMPORTED_MODULE_2___default().join((0,_store_authority_paths_js__WEBPACK_IMPORTED_MODULE_4__.getUserAuthorityPaths)(user).triviumPrivateDir, (0,_utils_js__WEBPACK_IMPORTED_MODULE_5__.sanitizeFileSegment)(extensionId));
    }
    resolvePrivateTriviumDatabasePath(user, extensionId, databaseName) {
        return node_path__WEBPACK_IMPORTED_MODULE_2___default().join(this.resolvePrivateTriviumDatabaseDir(user, extensionId), `${(0,_utils_js__WEBPACK_IMPORTED_MODULE_5__.sanitizeFileSegment)(databaseName)}.tdb`);
    }
    resolvePrivateTriviumMappingPath(user, extensionId, databaseName) {
        return node_path__WEBPACK_IMPORTED_MODULE_2___default().join(this.resolvePrivateTriviumDatabaseDir(user, extensionId), '__mapping__', `${(0,_utils_js__WEBPACK_IMPORTED_MODULE_5__.sanitizeFileSegment)(databaseName)}.sqlite`);
    }
}
function normalizeExportRequest(request) {
    return {
        ...(request?.extensionIds?.length ? { extensionIds: [...new Set(request.extensionIds.map(value => value.trim()).filter(Boolean))] } : {}),
        includePolicies: request?.includePolicies !== false,
        includeUsageSummary: request?.includeUsageSummary !== false,
    };
}
function sanitizeArtifactFileName(value) {
    const trimmed = value.trim();
    return trimmed ? trimmed.replace(/[^a-zA-Z0-9._-]/g, '_') : `artifact-${node_crypto__WEBPACK_IMPORTED_MODULE_0___default().randomUUID()}.json.gz`;
}
function sanitizeTimestamp(value) {
    return value.replace(/[:.]/g, '-');
}
function buildArtifactSummary(fileName, bytes, mediaType) {
    return {
        fileName,
        mediaType,
        sizeBytes: bytes.byteLength,
        checksumSha256: hashBytes(bytes),
    };
}
function buildArchiveFileEntry(file) {
    return {
        path: file.path,
        mediaType: file.mediaType,
        sizeBytes: file.bytes.byteLength,
        checksumSha256: hashBytes(file.bytes),
    };
}
function buildIndexedArchivePath(directory, index, sourceName) {
    const normalizedSource = sourceName.replace(/\\/g, '/');
    const baseName = node_path__WEBPACK_IMPORTED_MODULE_2___default().posix.basename(normalizedSource) || 'entry.bin';
    const safeBaseName = (0,_utils_js__WEBPACK_IMPORTED_MODULE_5__.sanitizeFileSegment)(baseName) || 'entry.bin';
    return `${directory}/${String(index).padStart(4, '0')}-${safeBaseName}`;
}
function hashBytes(value) {
    return node_crypto__WEBPACK_IMPORTED_MODULE_0___default().createHash('sha256').update(value).digest('hex');
}
function hashText(value) {
    return node_crypto__WEBPACK_IMPORTED_MODULE_0___default().createHash('sha256').update(value, 'utf8').digest('hex');
}
function tryGunzip(value) {
    try {
        return node_zlib__WEBPACK_IMPORTED_MODULE_3___default().gunzipSync(value);
    }
    catch {
        return value;
    }
}
function decodeBase64Checked(contentBase64, checksumSha256, label) {
    const bytes = Buffer.from(contentBase64, 'base64');
    const actual = hashBytes(bytes);
    if (actual !== checksumSha256) {
        throw new Error(`${label} checksum mismatch: expected ${checksumSha256}, received ${actual}`);
    }
    return bytes;
}
function newestTimestamp(left, right) {
    if (!left) {
        return right;
    }
    if (!right) {
        return left;
    }
    return left.localeCompare(right) >= 0 ? left : right;
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
    async logWarning(user, extensionId, message, details) {
        await this.log(user, {
            timestamp: (0,_utils_js__WEBPACK_IMPORTED_MODULE_2__.nowIso)(),
            kind: 'warning',
            extensionId,
            message,
            ...(details ? { details } : {}),
        });
    }
    async getRecentActivity(user, extensionId) {
        const response = await this.getRecentActivityPage(user, extensionId);
        return {
            permissions: response.permissions,
            usage: response.usage,
            errors: response.errors,
            warnings: response.warnings,
        };
    }
    async getRecentActivityPage(user, extensionId) {
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
            ...(request.page === undefined ? {} : { page: request.page }),
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
    async statSql(dbPath, _request = {}) {
        return await this.request('/v1/sql/stat', {
            dbPath,
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
    async bulkUpsertTrivium(dbPath, request) {
        return await this.request('/v1/trivium/bulk-upsert', {
            ...buildTriviumOpenPayload(dbPath, request),
            items: request.items,
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
    async bulkLinkTrivium(dbPath, request) {
        return await this.request('/v1/trivium/bulk-link', {
            ...buildTriviumOpenPayload(dbPath, request),
            items: request.items,
        });
    }
    async unlinkTrivium(dbPath, request) {
        await this.request('/v1/trivium/unlink', {
            ...buildTriviumOpenPayload(dbPath, request),
            src: request.src,
            dst: request.dst,
        });
    }
    async bulkUnlinkTrivium(dbPath, request) {
        return await this.request('/v1/trivium/bulk-unlink', {
            ...buildTriviumOpenPayload(dbPath, request),
            items: request.items,
        });
    }
    async bulkDeleteTrivium(dbPath, request) {
        return await this.request('/v1/trivium/bulk-delete', {
            ...buildTriviumOpenPayload(dbPath, request),
            items: request.items,
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
    async searchHybridWithContextTrivium(dbPath, request) {
        return await this.request('/v1/trivium/search-hybrid-context', {
            ...buildTriviumOpenPayload(dbPath, request),
            vector: request.vector,
            queryText: request.queryText,
            ...(request.topK === undefined ? {} : { topK: request.topK }),
            ...(request.expandDepth === undefined ? {} : { expandDepth: request.expandDepth }),
            ...(request.minScore === undefined ? {} : { minScore: request.minScore }),
            ...(request.hybridAlpha === undefined ? {} : { hybridAlpha: request.hybridAlpha }),
            ...(request.payloadFilter === undefined ? {} : { payloadFilter: request.payloadFilter }),
        });
    }
    async tqlTrivium(dbPath, request) {
        const response = await this.tqlTriviumPage(dbPath, request);
        return response.rows;
    }
    async tqlTriviumPage(dbPath, request) {
        return await this.request('/v1/trivium/tql', {
            ...buildTriviumOpenPayload(dbPath, request),
            query: request.query,
            ...(request.page === undefined ? {} : { page: request.page }),
        });
    }
    async tqlMutTrivium(dbPath, request) {
        return await this.request('/v1/trivium/tql-mut', {
            ...buildTriviumOpenPayload(dbPath, request),
            query: request.query,
        });
    }
    async createIndexTrivium(dbPath, request) {
        await this.request('/v1/trivium/create-index', {
            ...buildTriviumOpenPayload(dbPath, request),
            field: request.field,
        });
    }
    async dropIndexTrivium(dbPath, request) {
        await this.request('/v1/trivium/drop-index', {
            ...buildTriviumOpenPayload(dbPath, request),
            field: request.field,
        });
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
    async compactTrivium(dbPath, request = {}) {
        await this.request('/v1/trivium/compact', buildTriviumOpenPayload(dbPath, request));
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
        const response = await this.listControlJobsPage(dbPath, request);
        return response.jobs;
    }
    async listControlJobsPage(dbPath, request) {
        const response = await this.request('/v1/control/jobs/list', {
            dbPath,
            ...request,
        });
        return response;
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
    async requeueControlJob(dbPath, request) {
        const response = await this.request('/v1/control/jobs/requeue', {
            dbPath,
            ...request,
        });
        if (!response.job) {
            throw new Error('Control job requeue returned no job');
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
            throw new _utils_js__WEBPACK_IMPORTED_MODULE_7__.AuthorityServiceError(status.lastError ?? 'Authority core is not available', 503, 'core_unavailable', 'core', {
                state: status.state,
                lastError: status.lastError,
            });
        }
        let response;
        try {
            response = await fetch(`http://127.0.0.1:${status.port}${requestPath}`, {
                method: 'POST',
                headers: {
                    'content-type': 'application/json',
                    'x-authority-core-token': this.token,
                },
                body: JSON.stringify(body),
            });
        }
        catch (error) {
            throw new _utils_js__WEBPACK_IMPORTED_MODULE_7__.AuthorityServiceError((0,_utils_js__WEBPACK_IMPORTED_MODULE_7__.asErrorMessage)(error), 503, 'core_unavailable', 'core', {
                requestPath,
                state: status.state,
            });
        }
        const payload = await readCorePayload(response);
        if (!response.ok) {
            throw buildCoreRequestError(requestPath, payload, response.status);
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
function buildCoreRequestError(requestPath, payload, statusCode) {
    const message = extractCoreErrorMessage(payload, statusCode);
    if (statusCode === 408 || statusCode === 504 || /timed?\s*out|timeout/i.test(message)) {
        return new _utils_js__WEBPACK_IMPORTED_MODULE_7__.AuthorityServiceError(message, statusCode, 'timeout', 'timeout', {
            requestPath,
            source: 'core',
            statusCode,
        });
    }
    if (statusCode === 413 || statusCode === 429 || /exceeds|too large|queue_full|max/i.test(message)) {
        return new _utils_js__WEBPACK_IMPORTED_MODULE_7__.AuthorityServiceError(message, statusCode, 'limit_exceeded', 'limit', {
            requestPath,
            source: 'core',
            statusCode,
        });
    }
    if (statusCode >= 400 && statusCode < 500) {
        return new _utils_js__WEBPACK_IMPORTED_MODULE_7__.AuthorityServiceError(message, statusCode, 'validation_error', 'validation', {
            requestPath,
            source: 'core',
            statusCode,
        });
    }
    return new _utils_js__WEBPACK_IMPORTED_MODULE_7__.AuthorityServiceError(message, statusCode >= 500 ? statusCode : 500, 'core_request_failed', 'core', {
        requestPath,
        source: 'core',
        statusCode,
    });
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






const EMPTY_FILE_SHA256 = node_crypto__WEBPACK_IMPORTED_MODULE_0___default().createHash('sha256').update('').digest('hex');
class DataTransferService {
    transfers = new Map();
    async init(user, extensionId, request, maxBytesOverride) {
        const resource = normalizeTransferResource(request.resource);
        const purpose = normalizeTransferPurpose(resource, request.purpose);
        const transferId = node_crypto__WEBPACK_IMPORTED_MODULE_0___default().randomUUID();
        const timestamp = new Date().toISOString();
        const dirPath = this.getTransferDataDir(user, extensionId, resource);
        node_fs__WEBPACK_IMPORTED_MODULE_1___default().mkdirSync(dirPath, { recursive: true });
        node_fs__WEBPACK_IMPORTED_MODULE_1___default().mkdirSync(this.getTransferRecordDir(user, extensionId), { recursive: true });
        const filePath = node_path__WEBPACK_IMPORTED_MODULE_2___default().join(dirPath, `${transferId}.part`);
        node_fs__WEBPACK_IMPORTED_MODULE_1___default().writeFileSync(filePath, Buffer.alloc(0));
        const record = {
            transferId,
            userHandle: user.handle,
            extensionId,
            resource,
            ...(purpose ? { purpose } : {}),
            filePath,
            sizeBytes: 0,
            maxBytes: resolveTransferMaxBytes(maxBytesOverride),
            createdAt: timestamp,
            updatedAt: timestamp,
            direction: 'upload',
            ownedFile: true,
            checksumSha256: EMPTY_FILE_SHA256,
        };
        this.storeRecord(user, extensionId, record);
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
        record.checksumSha256 = computeFileSha256(record.filePath);
        this.storeRecord(user, extensionId, record);
        return {
            transferId: record.transferId,
            sizeBytes: record.sizeBytes,
            updatedAt: record.updatedAt,
            checksumSha256: record.checksumSha256,
        };
    }
    async openRead(user, extensionId, request, maxBytesOverride) {
        const resource = normalizeTransferResource(request.resource);
        const purpose = normalizeTransferPurpose(resource, request.purpose);
        const maxBytes = resolveTransferMaxBytes(maxBytesOverride);
        const { filePath, sizeBytes } = validateReadableTransferFile(request.sourcePath);
        if (sizeBytes > maxBytes) {
            throw new Error(`Transfer exceeds ${maxBytes} bytes`);
        }
        const transferId = node_crypto__WEBPACK_IMPORTED_MODULE_0___default().randomUUID();
        const timestamp = new Date().toISOString();
        node_fs__WEBPACK_IMPORTED_MODULE_1___default().mkdirSync(this.getTransferRecordDir(user, extensionId), { recursive: true });
        const record = {
            transferId,
            userHandle: user.handle,
            extensionId,
            resource,
            ...(purpose ? { purpose } : {}),
            filePath,
            sizeBytes,
            maxBytes: sizeBytes,
            createdAt: timestamp,
            updatedAt: timestamp,
            direction: 'download',
            ownedFile: false,
            checksumSha256: computeFileSha256(filePath),
        };
        this.storeRecord(user, extensionId, record);
        return toInitResponse(record);
    }
    async promoteToDownload(user, extensionId, transferId) {
        const record = this.get(user, extensionId, transferId);
        if (record.direction !== 'upload') {
            throw new Error('Transfer is already readable');
        }
        const { filePath, sizeBytes } = validateReadableTransferFile(record.filePath);
        if (sizeBytes > record.maxBytes) {
            throw new Error(`Transfer exceeds ${record.maxBytes} bytes`);
        }
        record.filePath = filePath;
        record.sizeBytes = sizeBytes;
        record.maxBytes = sizeBytes;
        record.direction = 'download';
        record.updatedAt = new Date().toISOString();
        record.checksumSha256 = computeFileSha256(filePath);
        this.storeRecord(user, extensionId, record);
        return toInitResponse(record);
    }
    status(user, extensionId, transferId, resource) {
        return toInitResponse(this.get(user, extensionId, transferId, resource));
    }
    manifest(user, extensionId, transferId, resource) {
        return toManifestResponse(this.get(user, extensionId, transferId, resource));
    }
    assertChecksum(user, extensionId, transferId, expectedChecksumSha256) {
        const record = this.get(user, extensionId, transferId);
        const expected = normalizeChecksumSha256(expectedChecksumSha256);
        if (!expected) {
            throw new Error('Transfer checksum must be a 64-character sha256 hex string');
        }
        if (record.checksumSha256.toLowerCase() !== expected) {
            throw new Error(`Transfer checksum mismatch: expected ${expected}, received ${record.checksumSha256}`);
        }
        return record.checksumSha256;
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
                checksumSha256: record.checksumSha256,
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
                checksumSha256: record.checksumSha256,
            };
        }
        finally {
            node_fs__WEBPACK_IMPORTED_MODULE_1___default().closeSync(handle);
        }
    }
    get(user, extensionId, transferId, resource) {
        const record = this.transfers.get(transferId) ?? this.loadRecord(user, extensionId, transferId);
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
        node_fs__WEBPACK_IMPORTED_MODULE_1___default().rmSync(this.getTransferRecordPath(user, extensionId, transferId), { force: true });
        if (!record.ownedFile) {
            pruneEmptyTransferDirs(this.getTransferRecordDir(user, extensionId));
            return;
        }
        try {
            node_fs__WEBPACK_IMPORTED_MODULE_1___default().rmSync(record.filePath, { force: true });
        }
        finally {
            pruneEmptyTransferDirs(node_path__WEBPACK_IMPORTED_MODULE_2___default().dirname(record.filePath));
            pruneEmptyTransferDirs(this.getTransferRecordDir(user, extensionId));
        }
    }
    loadRecord(user, extensionId, transferId) {
        const recordPath = this.getTransferRecordPath(user, extensionId, transferId);
        let parsed;
        try {
            parsed = JSON.parse(node_fs__WEBPACK_IMPORTED_MODULE_1___default().readFileSync(recordPath, 'utf8'));
        }
        catch {
            return null;
        }
        try {
            const readable = validateReadableTransferFile(parsed.filePath);
            parsed.sizeBytes = readable.sizeBytes;
            if (!parsed.checksumSha256) {
                parsed.checksumSha256 = computeFileSha256(parsed.filePath);
            }
        }
        catch {
            return null;
        }
        this.transfers.set(transferId, parsed);
        return parsed;
    }
    storeRecord(user, extensionId, record) {
        node_fs__WEBPACK_IMPORTED_MODULE_1___default().mkdirSync(this.getTransferRecordDir(user, extensionId), { recursive: true });
        node_fs__WEBPACK_IMPORTED_MODULE_1___default().writeFileSync(this.getTransferRecordPath(user, extensionId, record.transferId), JSON.stringify(record, null, 2));
        this.transfers.set(record.transferId, record);
    }
    getTransferBaseDir(user, extensionId) {
        const paths = (0,_store_authority_paths_js__WEBPACK_IMPORTED_MODULE_4__.getUserAuthorityPaths)(user);
        const stateDir = node_path__WEBPACK_IMPORTED_MODULE_2___default().dirname(paths.controlDbFile);
        return node_path__WEBPACK_IMPORTED_MODULE_2___default().join(stateDir, 'transfers', (0,_utils_js__WEBPACK_IMPORTED_MODULE_5__.sanitizeFileSegment)(extensionId));
    }
    getTransferDataDir(user, extensionId, resource) {
        return node_path__WEBPACK_IMPORTED_MODULE_2___default().join(this.getTransferBaseDir(user, extensionId), (0,_utils_js__WEBPACK_IMPORTED_MODULE_5__.sanitizeFileSegment)(resource));
    }
    getTransferRecordDir(user, extensionId) {
        return node_path__WEBPACK_IMPORTED_MODULE_2___default().join(this.getTransferBaseDir(user, extensionId), 'records');
    }
    getTransferRecordPath(user, extensionId, transferId) {
        return node_path__WEBPACK_IMPORTED_MODULE_2___default().join(this.getTransferRecordDir(user, extensionId), `${transferId}.json`);
    }
}
function toInitResponse(record) {
    return {
        transferId: record.transferId,
        resource: record.resource,
        ...(record.purpose ? { purpose: record.purpose } : {}),
        chunkSize: _constants_js__WEBPACK_IMPORTED_MODULE_3__.DATA_TRANSFER_CHUNK_BYTES,
        maxBytes: record.maxBytes,
        createdAt: record.createdAt,
        updatedAt: record.updatedAt,
        sizeBytes: record.sizeBytes,
        direction: record.direction,
        checksumSha256: record.checksumSha256,
        resumable: true,
    };
}
function toManifestResponse(record) {
    const chunkSize = _constants_js__WEBPACK_IMPORTED_MODULE_3__.DATA_TRANSFER_CHUNK_BYTES;
    const chunkCount = Math.ceil(record.sizeBytes / chunkSize);
    return {
        ...toInitResponse(record),
        chunkCount,
        chunks: Array.from({ length: chunkCount }, (_, index) => {
            const offset = index * chunkSize;
            const sizeBytes = Math.min(chunkSize, record.sizeBytes - offset);
            return {
                index,
                offset,
                sizeBytes,
                checksumSha256: computeFileSliceSha256(record.filePath, offset, sizeBytes),
            };
        }),
    };
}
function normalizeTransferResource(resource) {
    if (resource === 'storage.blob' || resource === 'fs.private' || resource === 'http.fetch') {
        return resource;
    }
    throw new Error(`Unsupported transfer resource: ${String(resource)}`);
}
function normalizeTransferPurpose(resource, purpose) {
    if (!purpose) {
        return undefined;
    }
    if (resource === 'storage.blob' && (purpose === 'storageBlobWrite' || purpose === 'storageBlobRead')) {
        return purpose;
    }
    if (resource === 'fs.private' && (purpose === 'privateFileWrite' || purpose === 'privateFileRead')) {
        return purpose;
    }
    if (resource === 'http.fetch' && (purpose === 'httpFetchRequest' || purpose === 'httpFetchResponse')) {
        return purpose;
    }
    throw new Error(`Unsupported transfer purpose ${purpose} for resource ${resource}`);
}
function resolveTransferMaxBytes(maxBytesOverride) {
    if (typeof maxBytesOverride !== 'number' || !Number.isFinite(maxBytesOverride)) {
        return Number.MAX_SAFE_INTEGER;
    }
    if (maxBytesOverride <= 0) {
        throw new Error('Transfer maxBytes must be a positive integer');
    }
    return Math.floor(maxBytesOverride);
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
function computeFileSha256(filePath) {
    return node_crypto__WEBPACK_IMPORTED_MODULE_0___default().createHash('sha256').update(node_fs__WEBPACK_IMPORTED_MODULE_1___default().readFileSync(filePath)).digest('hex');
}
function computeFileSliceSha256(filePath, offset, sizeBytes) {
    if (sizeBytes <= 0) {
        return EMPTY_FILE_SHA256;
    }
    const handle = node_fs__WEBPACK_IMPORTED_MODULE_1___default().openSync(filePath, 'r');
    try {
        const buffer = Buffer.alloc(sizeBytes);
        const bytesRead = node_fs__WEBPACK_IMPORTED_MODULE_1___default().readSync(handle, buffer, 0, sizeBytes, offset);
        return node_crypto__WEBPACK_IMPORTED_MODULE_0___default().createHash('sha256').update(buffer.subarray(0, bytesRead)).digest('hex');
    }
    finally {
        node_fs__WEBPACK_IMPORTED_MODULE_1___default().closeSync(handle);
    }
}
function normalizeChecksumSha256(value) {
    const candidate = value.trim().toLowerCase();
    return /^[a-f0-9]{64}$/.test(candidate) ? candidate : null;
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
        const response = await this.listPage(user, extensionId);
        return response.jobs;
    }
    async listPage(user, extensionId, request = {}) {
        const paths = (0,_store_authority_paths_js__WEBPACK_IMPORTED_MODULE_1__.getUserAuthorityPaths)(user);
        return await this.core.listControlJobsPage(paths.controlDbFile, {
            userHandle: user.handle,
            ...(extensionId ? { extensionId } : {}),
            ...(request.page ? { page: request.page } : {}),
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
    async requeue(user, extensionId, jobId) {
        const paths = (0,_store_authority_paths_js__WEBPACK_IMPORTED_MODULE_1__.getUserAuthorityPaths)(user);
        return await this.core.requeueControlJob(paths.controlDbFile, {
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



const INLINE_THRESHOLD_KEYS = [
    'storageBlobWrite',
    'storageBlobRead',
    'privateFileWrite',
    'privateFileRead',
    'httpFetchRequest',
    'httpFetchResponse',
];
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
    async getEffectiveSessionLimits(user, extensionId) {
        return {
            effectiveInlineThresholdBytes: this.buildEffectiveInlineThresholds(),
            effectiveTransferMaxBytes: this.buildEffectiveTransferMaxBytes(),
        };
    }
    async getEffectiveInlineThresholdBytes(user, extensionId, key) {
        return (await this.getEffectiveSessionLimits(user, extensionId)).effectiveInlineThresholdBytes[key].bytes;
    }
    async getEffectiveTransferMaxBytes(user, extensionId, key) {
        return (await this.getEffectiveSessionLimits(user, extensionId)).effectiveTransferMaxBytes[key].bytes;
    }
    async evaluate(user, session, request) {
        const descriptor = (0,_utils_js__WEBPACK_IMPORTED_MODULE_2__.buildPermissionDescriptor)(request.resource, request.target);
        const declarationDecision = this.getDeclarationDecision(session.declaredPermissions, descriptor);
        if (declarationDecision) {
            return declarationDecision;
        }
        const extensionPolicy = await this.getExtensionPolicyGrant(user, session.extension.id, descriptor.key);
        if (extensionPolicy) {
            return {
                decision: extensionPolicy.status,
                key: descriptor.key,
                riskLevel: descriptor.riskLevel,
                target: descriptor.target,
                resource: descriptor.resource,
                grant: extensionPolicy,
            };
        }
        const defaultPolicy = await this.getDefaultPolicyGrant(user, descriptor);
        if (defaultPolicy && defaultPolicy.status !== 'prompt') {
            return {
                decision: defaultPolicy.status,
                key: descriptor.key,
                riskLevel: descriptor.riskLevel,
                target: descriptor.target,
                resource: descriptor.resource,
                grant: defaultPolicy,
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
        if (defaultPolicy) {
            return {
                decision: defaultPolicy.status,
                key: descriptor.key,
                riskLevel: descriptor.riskLevel,
                target: descriptor.target,
                resource: descriptor.resource,
                grant: defaultPolicy,
            };
        }
        const defaultGrant = this.buildSystemDefaultPolicy(descriptor);
        return {
            decision: defaultGrant.status,
            key: descriptor.key,
            riskLevel: descriptor.riskLevel,
            target: descriptor.target,
            resource: descriptor.resource,
            grant: defaultGrant,
        };
    }
    async evaluateBatch(user, session, requests) {
        return await Promise.all(requests.map(async (request) => await this.evaluate(user, session, request)));
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
    async getExtensionPolicyGrant(user, extensionId, key) {
        const file = await this.policyService.getStoredPolicies(user);
        return file.extensions[extensionId]?.[key] ?? null;
    }
    async getDefaultPolicyGrant(user, descriptor) {
        const file = await this.policyService.getStoredPolicies(user);
        const defaultStatus = file.defaults[descriptor.resource];
        if (!defaultStatus) {
            return null;
        }
        return {
            key: descriptor.key,
            resource: descriptor.resource,
            target: descriptor.target,
            status: defaultStatus,
            riskLevel: descriptor.riskLevel,
            updatedAt: file.updatedAt || (0,_utils_js__WEBPACK_IMPORTED_MODULE_2__.nowIso)(),
            source: 'admin',
        };
    }
    buildSystemDefaultPolicy(descriptor) {
        return {
            key: descriptor.key,
            resource: descriptor.resource,
            target: descriptor.target,
            status: _constants_js__WEBPACK_IMPORTED_MODULE_0__.DEFAULT_POLICY_STATUS[descriptor.resource],
            riskLevel: descriptor.riskLevel,
            updatedAt: (0,_utils_js__WEBPACK_IMPORTED_MODULE_2__.nowIso)(),
            source: 'system',
        };
    }
    async getPersistentGrant(user, extensionId, key) {
        const paths = (0,_store_authority_paths_js__WEBPACK_IMPORTED_MODULE_1__.getUserAuthorityPaths)(user);
        return await this.core.getControlGrant(paths.controlDbFile, {
            userHandle: user.handle,
            extensionId,
            key,
        });
    }
    buildEffectiveInlineThresholds() {
        return this.buildRuntimeInlineThresholds();
    }
    buildRuntimeInlineThresholds() {
        return {
            storageBlobWrite: { bytes: _constants_js__WEBPACK_IMPORTED_MODULE_0__.DATA_TRANSFER_INLINE_THRESHOLD_BYTES, source: 'runtime' },
            storageBlobRead: { bytes: _constants_js__WEBPACK_IMPORTED_MODULE_0__.DATA_TRANSFER_INLINE_THRESHOLD_BYTES, source: 'runtime' },
            privateFileWrite: { bytes: _constants_js__WEBPACK_IMPORTED_MODULE_0__.DATA_TRANSFER_INLINE_THRESHOLD_BYTES, source: 'runtime' },
            privateFileRead: { bytes: _constants_js__WEBPACK_IMPORTED_MODULE_0__.DATA_TRANSFER_INLINE_THRESHOLD_BYTES, source: 'runtime' },
            httpFetchRequest: { bytes: _constants_js__WEBPACK_IMPORTED_MODULE_0__.DATA_TRANSFER_INLINE_THRESHOLD_BYTES, source: 'runtime' },
            httpFetchResponse: { bytes: _constants_js__WEBPACK_IMPORTED_MODULE_0__.DATA_TRANSFER_INLINE_THRESHOLD_BYTES, source: 'runtime' },
        };
    }
    buildEffectiveTransferMaxBytes() {
        return {
            storageBlobWrite: { bytes: _constants_js__WEBPACK_IMPORTED_MODULE_0__.UNMANAGED_TRANSFER_MAX_BYTES, source: 'runtime' },
            storageBlobRead: { bytes: _constants_js__WEBPACK_IMPORTED_MODULE_0__.UNMANAGED_TRANSFER_MAX_BYTES, source: 'runtime' },
            privateFileWrite: { bytes: _constants_js__WEBPACK_IMPORTED_MODULE_0__.UNMANAGED_TRANSFER_MAX_BYTES, source: 'runtime' },
            privateFileRead: { bytes: _constants_js__WEBPACK_IMPORTED_MODULE_0__.UNMANAGED_TRANSFER_MAX_BYTES, source: 'runtime' },
            httpFetchRequest: { bytes: _constants_js__WEBPACK_IMPORTED_MODULE_0__.UNMANAGED_TRANSFER_MAX_BYTES, source: 'runtime' },
            httpFetchResponse: { bytes: _constants_js__WEBPACK_IMPORTED_MODULE_0__.UNMANAGED_TRANSFER_MAX_BYTES, source: 'runtime' },
        };
    }
    getDeclarationDecision(declaredPermissions, descriptor) {
        if (!this.hasDeclaredPermissions(declaredPermissions)) {
            return null;
        }
        if (this.isDeclaredPermissionAllowed(declaredPermissions, descriptor.resource, descriptor.target)) {
            return null;
        }
        return {
            decision: 'blocked',
            key: descriptor.key,
            riskLevel: descriptor.riskLevel,
            target: descriptor.target,
            resource: descriptor.resource,
        };
    }
    hasDeclaredPermissions(declaredPermissions) {
        return Boolean(declaredPermissions.storage?.kv
            || declaredPermissions.storage?.blob
            || declaredPermissions.fs?.private
            || declaredPermissions.sql?.private
            || declaredPermissions.trivium?.private
            || declaredPermissions.http?.allow?.length
            || declaredPermissions.jobs?.background
            || declaredPermissions.events?.channels);
    }
    isDeclaredPermissionAllowed(declaredPermissions, resource, target) {
        switch (resource) {
            case 'storage.kv':
                return declaredPermissions.storage?.kv === true;
            case 'storage.blob':
                return declaredPermissions.storage?.blob === true;
            case 'fs.private':
                return declaredPermissions.fs?.private === true;
            case 'sql.private':
                return this.matchesDeclaredTarget(declaredPermissions.sql?.private, resource, target);
            case 'trivium.private':
                return this.matchesDeclaredTarget(declaredPermissions.trivium?.private, resource, target);
            case 'http.fetch':
                return this.matchesDeclaredTarget(declaredPermissions.http?.allow, resource, target);
            case 'jobs.background':
                return this.matchesDeclaredTarget(declaredPermissions.jobs?.background, resource, target);
            case 'events.stream':
                return this.matchesDeclaredTarget(declaredPermissions.events?.channels, resource, target);
            default:
                return false;
        }
    }
    matchesDeclaredTarget(declared, resource, target) {
        if (declared === true) {
            return true;
        }
        if (!Array.isArray(declared) || declared.length === 0) {
            return false;
        }
        const normalizedTarget = (0,_utils_js__WEBPACK_IMPORTED_MODULE_2__.normalizePermissionTarget)(resource, target);
        return declared.some(candidate => {
            const normalizedCandidate = (0,_utils_js__WEBPACK_IMPORTED_MODULE_2__.normalizePermissionTarget)(resource, candidate);
            if (normalizedCandidate === '*' || normalizedCandidate === normalizedTarget) {
                return true;
            }
            if (resource === 'http.fetch' && normalizedCandidate.startsWith('*.')) {
                const suffix = normalizedCandidate.slice(1);
                return normalizedTarget.endsWith(suffix) && normalizedTarget.length > suffix.length;
            }
            return false;
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
        const globalFile = await this.getStoredPolicies(user);
        return {
            ...globalFile,
            defaults: {
                ..._constants_js__WEBPACK_IMPORTED_MODULE_0__.DEFAULT_POLICY_STATUS,
                ...globalFile.defaults,
            },
            limits: {
                extensions: {
                    ...(globalFile.limits?.extensions ?? {}),
                },
            },
            updatedAt: globalFile.updatedAt || (0,_utils_js__WEBPACK_IMPORTED_MODULE_2__.nowIso)(),
        };
    }
    async getStoredPolicies(user) {
        const globalPaths = (0,_store_authority_paths_js__WEBPACK_IMPORTED_MODULE_1__.getGlobalAuthorityPaths)();
        const globalFile = await this.core.getControlPolicies(globalPaths.controlDbFile, {
            userHandle: user.handle,
        });
        return {
            ...globalFile,
            defaults: {
                ...(globalFile.defaults ?? {}),
            },
            limits: {
                extensions: {
                    ...(globalFile.limits?.extensions ?? {}),
                },
            },
            updatedAt: globalFile.updatedAt || (0,_utils_js__WEBPACK_IMPORTED_MODULE_2__.nowIso)(),
        };
    }
    async getExtensionPolicies(user, extensionId) {
        return Object.values((await this.getPolicies(user)).extensions[extensionId] ?? {});
    }
    async getExtensionLimitPolicy(user, extensionId) {
        return (await this.getPolicies(user)).limits.extensions[extensionId] ?? null;
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
                ...(partial.limits ? { limits: partial.limits } : {}),
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
/* harmony import */ var _constants_js__WEBPACK_IMPORTED_MODULE_0__ = __webpack_require__(/*! ../constants.js */ "./src/constants.ts");
/* harmony import */ var _store_authority_paths_js__WEBPACK_IMPORTED_MODULE_1__ = __webpack_require__(/*! ../store/authority-paths.js */ "./src/store/authority-paths.ts");
/* harmony import */ var _utils_js__WEBPACK_IMPORTED_MODULE_2__ = __webpack_require__(/*! ../utils.js */ "./src/utils.ts");



class SessionService {
    core;
    sessions = new Map();
    constructor(core) {
        this.core = core;
    }
    async createSession(user, config) {
        const token = (0,_utils_js__WEBPACK_IMPORTED_MODULE_2__.randomToken)();
        const paths = (0,_store_authority_paths_js__WEBPACK_IMPORTED_MODULE_1__.getUserAuthorityPaths)(user);
        const snapshot = await this.core.initializeControlSession(paths.controlDbFile, token, (0,_utils_js__WEBPACK_IMPORTED_MODULE_2__.nowIso)(), { handle: user.handle, isAdmin: user.isAdmin }, config);
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
        const paths = (0,_store_authority_paths_js__WEBPACK_IMPORTED_MODULE_1__.getUserAuthorityPaths)(user);
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
            throw new _utils_js__WEBPACK_IMPORTED_MODULE_2__.AuthorityServiceError('Invalid authority session', 401, 'invalid_session', 'session');
        }
        if (session.userHandle !== user.handle) {
            throw new _utils_js__WEBPACK_IMPORTED_MODULE_2__.AuthorityServiceError('Authority session does not belong to current user', 403, 'session_user_mismatch', 'session');
        }
        return session;
    }
    buildSessionResponse(session, grants, policies, limits) {
        return {
            sessionToken: session.token,
            user: {
                handle: session.userHandle,
                isAdmin: session.isAdmin,
            },
            extension: session.extension,
            grants,
            policies,
            limits,
            features: (0,_constants_js__WEBPACK_IMPORTED_MODULE_0__.buildAuthorityFeatureFlags)(session.isAdmin),
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

/***/ "./src/services/trivium-internal.ts"
/*!******************************************!*\
  !*** ./src/services/trivium-internal.ts ***!
  \******************************************/
(__unused_webpack_module, __webpack_exports__, __webpack_require__) {

__webpack_require__.r(__webpack_exports__);
/* harmony export */ __webpack_require__.d(__webpack_exports__, {
/* harmony export */   DATABASE_DIM_META_KEY: () => (/* binding */ DATABASE_DIM_META_KEY),
/* harmony export */   DATABASE_DTYPE_META_KEY: () => (/* binding */ DATABASE_DTYPE_META_KEY),
/* harmony export */   DATABASE_STORAGE_MODE_META_KEY: () => (/* binding */ DATABASE_STORAGE_MODE_META_KEY),
/* harmony export */   DATABASE_SYNC_MODE_META_KEY: () => (/* binding */ DATABASE_SYNC_MODE_META_KEY),
/* harmony export */   DEFAULT_CURSOR_PAGE_LIMIT: () => (/* binding */ DEFAULT_CURSOR_PAGE_LIMIT),
/* harmony export */   DEFAULT_INTEGRITY_SAMPLE_LIMIT: () => (/* binding */ DEFAULT_INTEGRITY_SAMPLE_LIMIT),
/* harmony export */   DEFAULT_ORPHAN_DELETE_LIMIT: () => (/* binding */ DEFAULT_ORPHAN_DELETE_LIMIT),
/* harmony export */   EXTERNAL_IDS_TABLE: () => (/* binding */ EXTERNAL_IDS_TABLE),
/* harmony export */   LAST_COMPACTION_META_KEY: () => (/* binding */ LAST_COMPACTION_META_KEY),
/* harmony export */   LAST_CONTENT_MUTATION_META_KEY: () => (/* binding */ LAST_CONTENT_MUTATION_META_KEY),
/* harmony export */   LAST_FLUSH_META_KEY: () => (/* binding */ LAST_FLUSH_META_KEY),
/* harmony export */   LAST_INDEX_LIFECYCLE_EVENT_META_KEY: () => (/* binding */ LAST_INDEX_LIFECYCLE_EVENT_META_KEY),
/* harmony export */   LAST_TEXT_INDEX_REBUILD_META_KEY: () => (/* binding */ LAST_TEXT_INDEX_REBUILD_META_KEY),
/* harmony export */   LAST_TEXT_INDEX_WRITE_META_KEY: () => (/* binding */ LAST_TEXT_INDEX_WRITE_META_KEY),
/* harmony export */   MAX_CURSOR_PAGE_LIMIT: () => (/* binding */ MAX_CURSOR_PAGE_LIMIT),
/* harmony export */   META_TABLE: () => (/* binding */ META_TABLE),
/* harmony export */   PROPERTY_INDEXES_TABLE: () => (/* binding */ PROPERTY_INDEXES_TABLE),
/* harmony export */   buildEmptyCursorPage: () => (/* binding */ buildEmptyCursorPage),
/* harmony export */   buildTriviumDatabaseRecord: () => (/* binding */ buildTriviumDatabaseRecord),
/* harmony export */   getBoundedPositiveInteger: () => (/* binding */ getBoundedPositiveInteger),
/* harmony export */   getNonNegativeInteger: () => (/* binding */ getNonNegativeInteger),
/* harmony export */   getOptionalPayloadExternalId: () => (/* binding */ getOptionalPayloadExternalId),
/* harmony export */   getOptionalPayloadNamespace: () => (/* binding */ getOptionalPayloadNamespace),
/* harmony export */   getOptionalTriviumNamespace: () => (/* binding */ getOptionalTriviumNamespace),
/* harmony export */   getReferenceExternalId: () => (/* binding */ getReferenceExternalId),
/* harmony export */   getRequiredExternalId: () => (/* binding */ getRequiredExternalId),
/* harmony export */   getRequiredNumericId: () => (/* binding */ getRequiredNumericId),
/* harmony export */   getTriviumDatabaseName: () => (/* binding */ getTriviumDatabaseName),
/* harmony export */   getTriviumNamespace: () => (/* binding */ getTriviumNamespace),
/* harmony export */   parseOptionalPositiveInteger: () => (/* binding */ parseOptionalPositiveInteger),
/* harmony export */   parseOptionalTriviumDType: () => (/* binding */ parseOptionalTriviumDType),
/* harmony export */   parseOptionalTriviumStorageMode: () => (/* binding */ parseOptionalTriviumStorageMode),
/* harmony export */   parseOptionalTriviumSyncMode: () => (/* binding */ parseOptionalTriviumSyncMode),
/* harmony export */   readMappingRecord: () => (/* binding */ readMappingRecord),
/* harmony export */   readResolvedReference: () => (/* binding */ readResolvedReference)
/* harmony export */ });
/* harmony import */ var node_fs__WEBPACK_IMPORTED_MODULE_0__ = __webpack_require__(/*! node:fs */ "node:fs");
/* harmony import */ var node_fs__WEBPACK_IMPORTED_MODULE_0___default = /*#__PURE__*/__webpack_require__.n(node_fs__WEBPACK_IMPORTED_MODULE_0__);

const EXTERNAL_IDS_TABLE = 'authority_trivium_external_ids';
const META_TABLE = 'authority_trivium_meta';
const PROPERTY_INDEXES_TABLE = 'authority_trivium_property_indexes';
const LAST_FLUSH_META_KEY = 'last_flush_at';
const DATABASE_DIM_META_KEY = 'database_dim';
const DATABASE_DTYPE_META_KEY = 'database_dtype';
const DATABASE_SYNC_MODE_META_KEY = 'database_sync_mode';
const DATABASE_STORAGE_MODE_META_KEY = 'database_storage_mode';
const LAST_CONTENT_MUTATION_META_KEY = 'last_content_mutation_at';
const LAST_TEXT_INDEX_WRITE_META_KEY = 'last_text_index_write_at';
const LAST_TEXT_INDEX_REBUILD_META_KEY = 'last_text_index_rebuild_at';
const LAST_COMPACTION_META_KEY = 'last_compaction_at';
const LAST_INDEX_LIFECYCLE_EVENT_META_KEY = 'last_index_lifecycle_event_at';
const DEFAULT_CURSOR_PAGE_LIMIT = 50;
const MAX_CURSOR_PAGE_LIMIT = 500;
const DEFAULT_INTEGRITY_SAMPLE_LIMIT = 100;
const DEFAULT_ORPHAN_DELETE_LIMIT = 100;
function getTriviumDatabaseName(value) {
    return typeof value === 'string' && value.trim() ? value.trim() : 'default';
}
function buildTriviumDatabaseRecord(filePath, entryName, meta, indexHealth) {
    const mainStats = node_fs__WEBPACK_IMPORTED_MODULE_0___default().statSync(filePath);
    const walPath = `${filePath}.wal`;
    const vecPath = `${filePath}.vec`;
    const walStats = node_fs__WEBPACK_IMPORTED_MODULE_0___default().existsSync(walPath) ? node_fs__WEBPACK_IMPORTED_MODULE_0___default().statSync(walPath) : null;
    const vecStats = node_fs__WEBPACK_IMPORTED_MODULE_0___default().existsSync(vecPath) ? node_fs__WEBPACK_IMPORTED_MODULE_0___default().statSync(vecPath) : null;
    const timestamps = [mainStats, walStats, vecStats]
        .filter((value) => value !== null)
        .map(stats => stats.mtime.toISOString())
        .sort((left, right) => left.localeCompare(right));
    return {
        name: entryName.slice(0, -'.tdb'.length),
        fileName: entryName,
        dim: readTriviumDimension(filePath) ?? meta.dim,
        dtype: meta.dtype,
        syncMode: meta.syncMode,
        storageMode: meta.storageMode ?? (vecStats ? 'mmap' : 'rom'),
        sizeBytes: mainStats.size,
        walSizeBytes: walStats?.size ?? 0,
        vecSizeBytes: vecStats?.size ?? 0,
        totalSizeBytes: mainStats.size + (walStats?.size ?? 0) + (vecStats?.size ?? 0),
        updatedAt: timestamps.at(-1) ?? null,
        indexHealth,
    };
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
function getTriviumNamespace(value) {
    return typeof value === 'string' && value.trim() ? value.trim() : 'default';
}
function getOptionalTriviumNamespace(value) {
    return typeof value === 'string' && value.trim() ? value.trim() : null;
}
function getRequiredExternalId(value) {
    if (typeof value === 'string' && value.trim()) {
        return value.trim();
    }
    throw new Error('Trivium externalId must not be empty');
}
function getOptionalPayloadExternalId(value) {
    if (value && typeof value === 'object' && typeof value.externalId === 'string') {
        const externalId = value.externalId.trim();
        return externalId ? externalId : null;
    }
    return null;
}
function getOptionalPayloadNamespace(value) {
    if (value && typeof value === 'object' && typeof value.namespace === 'string') {
        const namespace = value.namespace.trim();
        return namespace ? namespace : null;
    }
    return null;
}
function getRequiredNumericId(value, label = 'id') {
    if (typeof value === 'number' && Number.isSafeInteger(value) && value > 0) {
        return value;
    }
    throw new Error(`Trivium ${label} must be a positive safe integer`);
}
function getNonNegativeInteger(value) {
    if (typeof value === 'number' && Number.isSafeInteger(value) && value >= 0) {
        return value;
    }
    if (typeof value === 'string' && value.trim()) {
        const parsed = Number(value);
        if (Number.isSafeInteger(parsed) && parsed >= 0) {
            return parsed;
        }
    }
    return 0;
}
function parseOptionalPositiveInteger(value) {
    if (!value) {
        return null;
    }
    const parsed = Number(value);
    return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : null;
}
function parseOptionalTriviumDType(value) {
    return value === 'f32' || value === 'f16' || value === 'u64' ? value : null;
}
function parseOptionalTriviumSyncMode(value) {
    return value === 'full' || value === 'normal' || value === 'off' ? value : null;
}
function parseOptionalTriviumStorageMode(value) {
    return value === 'mmap' || value === 'rom' ? value : null;
}
function getBoundedPositiveInteger(value, defaultValue, maxValue, label) {
    if (value == null) {
        return defaultValue;
    }
    if (typeof value === 'number' && Number.isSafeInteger(value) && value > 0) {
        return Math.min(value, maxValue);
    }
    throw new Error(`Trivium ${label} must be a positive safe integer`);
}
function buildEmptyCursorPage(page) {
    const limit = Number.isInteger(page.limit) && Number(page.limit) > 0
        ? Math.min(Number(page.limit), MAX_CURSOR_PAGE_LIMIT)
        : DEFAULT_CURSOR_PAGE_LIMIT;
    const cursor = page.cursor?.trim();
    if (cursor) {
        const offset = Number(cursor);
        if (!Number.isSafeInteger(offset) || offset < 0) {
            throw new Error('invalid_page_cursor');
        }
    }
    return {
        nextCursor: null,
        limit,
        hasMore: false,
        totalCount: 0,
    };
}
function readMappingRecord(row) {
    return {
        id: getRequiredNumericId(row.internalId, 'internalId'),
        externalId: getRequiredExternalId(row.externalId),
        namespace: getTriviumNamespace(row.namespace),
        createdAt: typeof row.createdAt === 'string' ? row.createdAt : '',
        updatedAt: typeof row.updatedAt === 'string' ? row.updatedAt : '',
    };
}
function readResolvedReference(row) {
    return {
        id: getRequiredNumericId(row.internalId, 'internalId'),
        externalId: typeof row.externalId === 'string' ? row.externalId : null,
        namespace: typeof row.namespace === 'string' ? row.namespace : null,
    };
}
function getReferenceExternalId(reference) {
    return reference.externalId?.trim() ? reference.externalId.trim() : null;
}


/***/ },

/***/ "./src/services/trivium-mapping-meta-store.ts"
/*!****************************************************!*\
  !*** ./src/services/trivium-mapping-meta-store.ts ***!
  \****************************************************/
(__unused_webpack_module, __webpack_exports__, __webpack_require__) {

__webpack_require__.r(__webpack_exports__);
/* harmony export */ __webpack_require__.d(__webpack_exports__, {
/* harmony export */   TriviumMappingMetaStore: () => (/* binding */ TriviumMappingMetaStore)
/* harmony export */ });
/* harmony import */ var node_fs__WEBPACK_IMPORTED_MODULE_0__ = __webpack_require__(/*! node:fs */ "node:fs");
/* harmony import */ var node_fs__WEBPACK_IMPORTED_MODULE_0___default = /*#__PURE__*/__webpack_require__.n(node_fs__WEBPACK_IMPORTED_MODULE_0__);
/* harmony import */ var _utils_js__WEBPACK_IMPORTED_MODULE_1__ = __webpack_require__(/*! ../utils.js */ "./src/utils.ts");
/* harmony import */ var _trivium_internal_js__WEBPACK_IMPORTED_MODULE_2__ = __webpack_require__(/*! ./trivium-internal.js */ "./src/services/trivium-internal.ts");



class TriviumMappingMetaStore {
    core;
    schemaReady = new Map();
    constructor(core) {
        this.core = core;
    }
    async ensureSchema(mappingDbPath) {
        const existing = this.schemaReady.get(mappingDbPath);
        if (existing) {
            await existing;
            return;
        }
        const schemaPromise = this.core.migrateSql(mappingDbPath, {
            migrations: [{
                    id: '001_authority_trivium_mapping',
                    statement: `CREATE TABLE IF NOT EXISTS ${_trivium_internal_js__WEBPACK_IMPORTED_MODULE_2__.EXTERNAL_IDS_TABLE} (
                    internal_id INTEGER PRIMARY KEY AUTOINCREMENT,
                    namespace TEXT NOT NULL,
                    external_id TEXT NOT NULL,
                    created_at TEXT NOT NULL,
                    updated_at TEXT NOT NULL,
                    UNIQUE (namespace, external_id)
                );
                CREATE INDEX IF NOT EXISTS idx_${_trivium_internal_js__WEBPACK_IMPORTED_MODULE_2__.EXTERNAL_IDS_TABLE}_external ON ${_trivium_internal_js__WEBPACK_IMPORTED_MODULE_2__.EXTERNAL_IDS_TABLE}(namespace, external_id);
                CREATE INDEX IF NOT EXISTS idx_${_trivium_internal_js__WEBPACK_IMPORTED_MODULE_2__.EXTERNAL_IDS_TABLE}_internal ON ${_trivium_internal_js__WEBPACK_IMPORTED_MODULE_2__.EXTERNAL_IDS_TABLE}(internal_id);
                CREATE TABLE IF NOT EXISTS ${_trivium_internal_js__WEBPACK_IMPORTED_MODULE_2__.META_TABLE} (
                    key TEXT PRIMARY KEY,
                    value TEXT NOT NULL,
                    updated_at TEXT NOT NULL
                );
                CREATE TABLE IF NOT EXISTS ${_trivium_internal_js__WEBPACK_IMPORTED_MODULE_2__.PROPERTY_INDEXES_TABLE} (
                    field TEXT PRIMARY KEY,
                    source TEXT NOT NULL,
                    created_at TEXT NOT NULL,
                    updated_at TEXT NOT NULL,
                    last_used_at TEXT
                );`,
                }],
        }).then(() => undefined);
        this.schemaReady.set(mappingDbPath, schemaPromise);
        try {
            await schemaPromise;
        }
        catch (error) {
            this.schemaReady.delete(mappingDbPath);
            throw error;
        }
    }
    async resolveReference(mappingDbPath, reference, allowCreate) {
        const externalId = (0,_trivium_internal_js__WEBPACK_IMPORTED_MODULE_2__.getReferenceExternalId)(reference);
        const hasId = reference.id != null;
        if (!hasId && !externalId) {
            throw new Error('Trivium reference must include id or externalId');
        }
        if (externalId === null) {
            return {
                id: (0,_trivium_internal_js__WEBPACK_IMPORTED_MODULE_2__.getRequiredNumericId)(reference.id),
                externalId: null,
                namespace: null,
                createdMapping: false,
            };
        }
        const namespace = (0,_trivium_internal_js__WEBPACK_IMPORTED_MODULE_2__.getTriviumNamespace)(reference.namespace);
        await this.ensureSchema(mappingDbPath);
        const existing = await this.fetchMappingByExternal(mappingDbPath, externalId, namespace);
        if (existing) {
            if (hasId && existing.id !== (0,_trivium_internal_js__WEBPACK_IMPORTED_MODULE_2__.getRequiredNumericId)(reference.id)) {
                throw new Error(`Trivium externalId ${namespace}:${externalId} is already mapped to ${existing.id}`);
            }
            return { ...existing, createdMapping: false };
        }
        if (!allowCreate) {
            throw new Error(`Trivium externalId ${namespace}:${externalId} is not mapped`);
        }
        const explicitId = hasId ? (0,_trivium_internal_js__WEBPACK_IMPORTED_MODULE_2__.getRequiredNumericId)(reference.id) : null;
        try {
            if (explicitId != null) {
                await this.insertMappingWithId(mappingDbPath, explicitId, externalId, namespace);
                return { id: explicitId, externalId, namespace, createdMapping: true };
            }
            const id = await this.insertMappingAuto(mappingDbPath, externalId, namespace);
            return { id, externalId, namespace, createdMapping: true };
        }
        catch (error) {
            const raced = await this.fetchMappingByExternal(mappingDbPath, externalId, namespace);
            if (raced) {
                if (explicitId != null && raced.id !== explicitId) {
                    throw new Error(`Trivium externalId ${namespace}:${externalId} is already mapped to ${raced.id}`);
                }
                return { ...raced, createdMapping: false };
            }
            throw new Error(`Failed to create Trivium externalId mapping: ${(0,_utils_js__WEBPACK_IMPORTED_MODULE_1__.asErrorMessage)(error)}`);
        }
    }
    async fetchMappingByExternal(mappingDbPath, externalId, namespace) {
        if (!node_fs__WEBPACK_IMPORTED_MODULE_0___default().existsSync(mappingDbPath)) {
            return null;
        }
        const result = await this.core.querySql(mappingDbPath, {
            statement: `SELECT internal_id AS internalId, external_id AS externalId, namespace FROM ${_trivium_internal_js__WEBPACK_IMPORTED_MODULE_2__.EXTERNAL_IDS_TABLE} WHERE namespace = ?1 AND external_id = ?2 LIMIT 1`,
            params: [namespace, externalId],
        });
        const [row] = result.rows;
        return row ? (0,_trivium_internal_js__WEBPACK_IMPORTED_MODULE_2__.readResolvedReference)(row) : null;
    }
    async resolveMappingsByInternalIds(mappingDbPath, ids) {
        const mappings = await this.fetchMappingsByInternalIds(mappingDbPath, ids);
        return ids.map(id => mappings.get(id) ?? { id, externalId: null, namespace: null });
    }
    async fetchMappingsByInternalIds(mappingDbPath, ids) {
        const uniqueIds = [...new Set(ids.filter(value => Number.isSafeInteger(value) && value > 0))];
        if (uniqueIds.length === 0 || !node_fs__WEBPACK_IMPORTED_MODULE_0___default().existsSync(mappingDbPath)) {
            return new Map();
        }
        const statement = `SELECT internal_id AS internalId, external_id AS externalId, namespace FROM ${_trivium_internal_js__WEBPACK_IMPORTED_MODULE_2__.EXTERNAL_IDS_TABLE} WHERE internal_id IN (${uniqueIds.map((_, index) => `?${index + 1}`).join(', ')})`;
        const result = await this.core.querySql(mappingDbPath, {
            statement,
            params: uniqueIds,
        });
        return new Map(result.rows.map(row => {
            const resolved = (0,_trivium_internal_js__WEBPACK_IMPORTED_MODULE_2__.readResolvedReference)(row);
            return [resolved.id, resolved];
        }));
    }
    async countMappings(mappingDbPath) {
        if (!node_fs__WEBPACK_IMPORTED_MODULE_0___default().existsSync(mappingDbPath)) {
            return 0;
        }
        const result = await this.core.querySql(mappingDbPath, {
            statement: `SELECT COUNT(*) AS count FROM ${_trivium_internal_js__WEBPACK_IMPORTED_MODULE_2__.EXTERNAL_IDS_TABLE}`,
        });
        return (0,_trivium_internal_js__WEBPACK_IMPORTED_MODULE_2__.getNonNegativeInteger)(result.rows[0]?.count);
    }
    async countOrphanMappings(dbPath, mappingDbPath, database) {
        if (!node_fs__WEBPACK_IMPORTED_MODULE_0___default().existsSync(mappingDbPath)) {
            return 0;
        }
        const result = await this.core.querySql(mappingDbPath, {
            statement: `SELECT internal_id AS internalId FROM ${_trivium_internal_js__WEBPACK_IMPORTED_MODULE_2__.EXTERNAL_IDS_TABLE} ORDER BY internal_id ASC`,
        });
        let orphanCount = 0;
        for (const row of result.rows) {
            const id = (0,_trivium_internal_js__WEBPACK_IMPORTED_MODULE_2__.getRequiredNumericId)(row.internalId, 'internalId');
            const node = await this.core.getTrivium(dbPath, {
                database,
                id,
            });
            if (!node) {
                orphanCount += 1;
            }
        }
        return orphanCount;
    }
    async analyzeMappingsIntegrity(dbPath, mappingDbPath, database) {
        const mappings = await this.listAllMappings(mappingDbPath);
        const nodeIds = await this.listAllNodeIds(dbPath, database);
        const nodeIdSet = new Set(nodeIds);
        const mappedIdSet = new Set();
        const byInternalId = new Map();
        const byExternalId = new Map();
        for (const mapping of mappings) {
            mappedIdSet.add(mapping.id);
            const internalGroup = byInternalId.get(mapping.id);
            if (internalGroup) {
                internalGroup.push(mapping);
            }
            else {
                byInternalId.set(mapping.id, [mapping]);
            }
            const externalKey = `${mapping.namespace}\u0000${mapping.externalId}`;
            const externalGroup = byExternalId.get(externalKey);
            if (externalGroup) {
                externalGroup.push(mapping);
            }
            else {
                byExternalId.set(externalKey, [mapping]);
            }
        }
        return {
            mappings,
            nodeIds,
            orphanMappings: mappings.filter(mapping => !nodeIdSet.has(mapping.id)),
            missingNodeIds: nodeIds.filter(id => !mappedIdSet.has(id)),
            duplicateInternalGroups: [...byInternalId.entries()]
                .filter(([, group]) => group.length > 1)
                .sort((left, right) => left[0] - right[0])
                .map(([, group]) => group),
            duplicateExternalGroups: [...byExternalId.entries()]
                .filter(([, group]) => group.length > 1)
                .sort((left, right) => left[0].localeCompare(right[0]))
                .map(([, group]) => group),
        };
    }
    async deleteMappingsByInternalIds(mappingDbPath, ids) {
        const uniqueIds = [...new Set(ids.filter(value => Number.isSafeInteger(value) && value > 0))];
        if (uniqueIds.length === 0 || !node_fs__WEBPACK_IMPORTED_MODULE_0___default().existsSync(mappingDbPath)) {
            return;
        }
        await this.core.execSql(mappingDbPath, {
            statement: `DELETE FROM ${_trivium_internal_js__WEBPACK_IMPORTED_MODULE_2__.EXTERNAL_IDS_TABLE} WHERE internal_id IN (${uniqueIds.map((_, index) => `?${index + 1}`).join(', ')})`,
            params: uniqueIds,
        });
    }
    async reconcileMappingsAfterTqlMutation(dbPath, mappingDbPath, database, createdIds) {
        await this.ensureSchema(mappingDbPath);
        const uniqueCreatedIds = [...new Set(createdIds.filter(value => Number.isSafeInteger(value) && value > 0))];
        if (uniqueCreatedIds.length > 0) {
            const existingById = await this.fetchMappingsByInternalIds(mappingDbPath, uniqueCreatedIds);
            for (const id of uniqueCreatedIds) {
                const node = await this.core.getTrivium(dbPath, { database, id });
                const externalId = (0,_trivium_internal_js__WEBPACK_IMPORTED_MODULE_2__.getOptionalPayloadExternalId)(node?.payload);
                if (!externalId) {
                    continue;
                }
                const namespace = (0,_trivium_internal_js__WEBPACK_IMPORTED_MODULE_2__.getTriviumNamespace)((0,_trivium_internal_js__WEBPACK_IMPORTED_MODULE_2__.getOptionalPayloadNamespace)(node?.payload));
                const mappedByExternal = await this.fetchMappingByExternal(mappingDbPath, externalId, namespace);
                if (mappedByExternal && mappedByExternal.id !== id) {
                    continue;
                }
                const mappedById = existingById.get(id) ?? null;
                if (mappedById?.externalId === externalId && mappedById.namespace === namespace) {
                    continue;
                }
                if (mappedById) {
                    await this.deleteMappingsByInternalIds(mappingDbPath, [id]);
                }
                await this.insertMappingWithId(mappingDbPath, id, externalId, namespace);
            }
        }
        const analysis = await this.analyzeMappingsIntegrity(dbPath, mappingDbPath, database);
        if (analysis.orphanMappings.length > 0) {
            await this.deleteMappingsByInternalIds(mappingDbPath, analysis.orphanMappings.map(item => item.id));
        }
    }
    async upsertPropertyIndexMetadata(mappingDbPath, field, source) {
        await this.ensureSchema(mappingDbPath);
        const timestamp = new Date().toISOString();
        await this.core.execSql(mappingDbPath, {
            statement: `INSERT INTO ${_trivium_internal_js__WEBPACK_IMPORTED_MODULE_2__.PROPERTY_INDEXES_TABLE} (field, source, created_at, updated_at, last_used_at) VALUES (?1, ?2, ?3, ?4, NULL)
                ON CONFLICT(field) DO UPDATE SET source = excluded.source, updated_at = excluded.updated_at`,
            params: [field, source, timestamp, timestamp],
        });
    }
    async deletePropertyIndexMetadata(mappingDbPath, field) {
        if (!node_fs__WEBPACK_IMPORTED_MODULE_0___default().existsSync(mappingDbPath)) {
            return;
        }
        await this.core.execSql(mappingDbPath, {
            statement: `DELETE FROM ${_trivium_internal_js__WEBPACK_IMPORTED_MODULE_2__.PROPERTY_INDEXES_TABLE} WHERE field = ?1`,
            params: [field],
        });
    }
    async listMappingsPage(mappingDbPath, request = {}) {
        const namespace = (0,_trivium_internal_js__WEBPACK_IMPORTED_MODULE_2__.getOptionalTriviumNamespace)(request.namespace);
        if (!node_fs__WEBPACK_IMPORTED_MODULE_0___default().existsSync(mappingDbPath)) {
            return {
                mappings: [],
                ...(request.page ? { page: (0,_trivium_internal_js__WEBPACK_IMPORTED_MODULE_2__.buildEmptyCursorPage)(request.page) } : {}),
            };
        }
        const params = namespace ? [namespace] : [];
        const result = await this.core.querySql(mappingDbPath, {
            statement: `SELECT internal_id AS internalId, external_id AS externalId, namespace, created_at AS createdAt, updated_at AS updatedAt
                FROM ${_trivium_internal_js__WEBPACK_IMPORTED_MODULE_2__.EXTERNAL_IDS_TABLE}${namespace ? ' WHERE namespace = ?1' : ''}
                ORDER BY namespace ASC, external_id ASC, internal_id ASC`,
            params,
            ...(request.page ? { page: request.page } : {}),
        });
        return {
            mappings: result.rows.map(row => (0,_trivium_internal_js__WEBPACK_IMPORTED_MODULE_2__.readMappingRecord)(row)),
            ...(result.page ? { page: result.page } : {}),
        };
    }
    async readMetaValue(mappingDbPath, key) {
        if (!node_fs__WEBPACK_IMPORTED_MODULE_0___default().existsSync(mappingDbPath)) {
            return null;
        }
        const result = await this.core.querySql(mappingDbPath, {
            statement: `SELECT value FROM ${_trivium_internal_js__WEBPACK_IMPORTED_MODULE_2__.META_TABLE} WHERE key = ?1 LIMIT 1`,
            params: [key],
        });
        const [row] = result.rows;
        return typeof row?.value === 'string' ? row.value : null;
    }
    async writeMetaValue(mappingDbPath, key, value) {
        const timestamp = new Date().toISOString();
        await this.core.execSql(mappingDbPath, {
            statement: `INSERT INTO ${_trivium_internal_js__WEBPACK_IMPORTED_MODULE_2__.META_TABLE} (key, value, updated_at) VALUES (?1, ?2, ?3)
                ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`,
            params: [key, value, timestamp],
        });
    }
    async rememberDatabaseConfig(mappingDbPath, request) {
        await this.ensureSchema(mappingDbPath);
        const writes = [];
        if (request.dim !== undefined) {
            writes.push(this.writeMetaValue(mappingDbPath, _trivium_internal_js__WEBPACK_IMPORTED_MODULE_2__.DATABASE_DIM_META_KEY, String(request.dim)));
        }
        if (request.dtype !== undefined) {
            writes.push(this.writeMetaValue(mappingDbPath, _trivium_internal_js__WEBPACK_IMPORTED_MODULE_2__.DATABASE_DTYPE_META_KEY, request.dtype));
        }
        if (request.syncMode !== undefined) {
            writes.push(this.writeMetaValue(mappingDbPath, _trivium_internal_js__WEBPACK_IMPORTED_MODULE_2__.DATABASE_SYNC_MODE_META_KEY, request.syncMode));
        }
        if (request.storageMode !== undefined) {
            writes.push(this.writeMetaValue(mappingDbPath, _trivium_internal_js__WEBPACK_IMPORTED_MODULE_2__.DATABASE_STORAGE_MODE_META_KEY, request.storageMode));
        }
        await Promise.all(writes);
    }
    async readDatabaseConfigMeta(mappingDbPath) {
        const [dim, dtype, syncMode, storageMode] = await Promise.all([
            this.readMetaValue(mappingDbPath, _trivium_internal_js__WEBPACK_IMPORTED_MODULE_2__.DATABASE_DIM_META_KEY),
            this.readMetaValue(mappingDbPath, _trivium_internal_js__WEBPACK_IMPORTED_MODULE_2__.DATABASE_DTYPE_META_KEY),
            this.readMetaValue(mappingDbPath, _trivium_internal_js__WEBPACK_IMPORTED_MODULE_2__.DATABASE_SYNC_MODE_META_KEY),
            this.readMetaValue(mappingDbPath, _trivium_internal_js__WEBPACK_IMPORTED_MODULE_2__.DATABASE_STORAGE_MODE_META_KEY),
        ]);
        return {
            dim: (0,_trivium_internal_js__WEBPACK_IMPORTED_MODULE_2__.parseOptionalPositiveInteger)(dim),
            dtype: (0,_trivium_internal_js__WEBPACK_IMPORTED_MODULE_2__.parseOptionalTriviumDType)(dtype),
            syncMode: (0,_trivium_internal_js__WEBPACK_IMPORTED_MODULE_2__.parseOptionalTriviumSyncMode)(syncMode),
            storageMode: (0,_trivium_internal_js__WEBPACK_IMPORTED_MODULE_2__.parseOptionalTriviumStorageMode)(storageMode),
        };
    }
    async readIndexHealth(mappingDbPath, exists) {
        if (!exists) {
            return null;
        }
        const lifecycle = await this.readIndexLifecycleMeta(mappingDbPath);
        const requiresRebuild = lifecycle.lastContentMutationAt != null
            && (lifecycle.lastTextRebuildAt == null || lifecycle.lastContentMutationAt > lifecycle.lastTextRebuildAt);
        const hasIndexSignal = lifecycle.lastTextRebuildAt != null || lifecycle.lastTextWriteAt != null;
        if (requiresRebuild) {
            return {
                status: 'stale',
                reason: lifecycle.lastTextRebuildAt
                    ? 'Trivium payload 数据在最近一次全文索引重建之后发生了变化'
                    : 'Trivium 已发生内容变更，但尚未执行全文索引重建',
                requiresRebuild: true,
                staleSince: lifecycle.lastContentMutationAt,
                lastContentMutationAt: lifecycle.lastContentMutationAt,
                lastTextWriteAt: lifecycle.lastTextWriteAt,
                lastTextRebuildAt: lifecycle.lastTextRebuildAt,
                lastCompactionAt: lifecycle.lastCompactionAt,
            };
        }
        if (hasIndexSignal) {
            return {
                status: 'fresh',
                reason: null,
                requiresRebuild: false,
                staleSince: null,
                lastContentMutationAt: lifecycle.lastContentMutationAt,
                lastTextWriteAt: lifecycle.lastTextWriteAt,
                lastTextRebuildAt: lifecycle.lastTextRebuildAt,
                lastCompactionAt: lifecycle.lastCompactionAt,
            };
        }
        return {
            status: 'missing',
            reason: 'Trivium 尚未建立全文索引',
            requiresRebuild: false,
            staleSince: null,
            lastContentMutationAt: lifecycle.lastContentMutationAt,
            lastTextWriteAt: lifecycle.lastTextWriteAt,
            lastTextRebuildAt: lifecycle.lastTextRebuildAt,
            lastCompactionAt: lifecycle.lastCompactionAt,
        };
    }
    async markContentMutation(mappingDbPath) {
        await this.writeMetaTimestamp(mappingDbPath, _trivium_internal_js__WEBPACK_IMPORTED_MODULE_2__.LAST_CONTENT_MUTATION_META_KEY);
    }
    async markTextIndexWrite(mappingDbPath) {
        await this.writeMetaTimestamp(mappingDbPath, _trivium_internal_js__WEBPACK_IMPORTED_MODULE_2__.LAST_TEXT_INDEX_WRITE_META_KEY);
    }
    async markTextIndexRebuild(mappingDbPath) {
        await this.writeMetaTimestamp(mappingDbPath, _trivium_internal_js__WEBPACK_IMPORTED_MODULE_2__.LAST_TEXT_INDEX_REBUILD_META_KEY);
    }
    async markCompaction(mappingDbPath) {
        await this.writeMetaTimestamp(mappingDbPath, _trivium_internal_js__WEBPACK_IMPORTED_MODULE_2__.LAST_COMPACTION_META_KEY);
    }
    async enrichSearchHits(mappingDbPath, hits) {
        const mappings = await this.fetchMappingsByInternalIds(mappingDbPath, hits.map(hit => hit.id));
        return hits.map(hit => ({
            ...hit,
            externalId: mappings.get(hit.id)?.externalId ?? null,
            namespace: mappings.get(hit.id)?.namespace ?? null,
        }));
    }
    async enrichNodes(mappingDbPath, nodes) {
        const ids = nodes.flatMap(node => [node.id, ...node.edges.map(edge => edge.targetId)]);
        const mappings = await this.fetchMappingsByInternalIds(mappingDbPath, ids);
        return nodes.map(node => ({
            ...node,
            externalId: mappings.get(node.id)?.externalId ?? null,
            namespace: mappings.get(node.id)?.namespace ?? null,
            edges: node.edges.map(edge => ({
                ...edge,
                targetExternalId: mappings.get(edge.targetId)?.externalId ?? null,
                targetNamespace: mappings.get(edge.targetId)?.namespace ?? null,
            })),
        }));
    }
    async enrichRows(mappingDbPath, rows) {
        const ids = rows.flatMap(row => Object.values(row).flatMap(node => [node.id, ...node.edges.map(edge => edge.targetId)]));
        const mappings = await this.fetchMappingsByInternalIds(mappingDbPath, ids);
        return rows.map(row => Object.fromEntries(Object.entries(row).map(([key, node]) => [key, {
                ...node,
                externalId: mappings.get(node.id)?.externalId ?? null,
                namespace: mappings.get(node.id)?.namespace ?? null,
                edges: node.edges.map(edge => ({
                    ...edge,
                    targetExternalId: mappings.get(edge.targetId)?.externalId ?? null,
                    targetNamespace: mappings.get(edge.targetId)?.namespace ?? null,
                })),
            }])));
    }
    async listAllMappings(mappingDbPath) {
        if (!node_fs__WEBPACK_IMPORTED_MODULE_0___default().existsSync(mappingDbPath)) {
            return [];
        }
        const result = await this.core.querySql(mappingDbPath, {
            statement: `SELECT internal_id AS internalId, external_id AS externalId, namespace, created_at AS createdAt, updated_at AS updatedAt
                FROM ${_trivium_internal_js__WEBPACK_IMPORTED_MODULE_2__.EXTERNAL_IDS_TABLE}
                ORDER BY internal_id ASC, namespace ASC, external_id ASC`,
        });
        return result.rows.map(row => (0,_trivium_internal_js__WEBPACK_IMPORTED_MODULE_2__.readMappingRecord)(row));
    }
    async listAllNodeIds(dbPath, database) {
        if (!node_fs__WEBPACK_IMPORTED_MODULE_0___default().existsSync(dbPath)) {
            return [];
        }
        const ids = [];
        let cursor = null;
        do {
            const response = await this.core.tqlTriviumPage(dbPath, {
                database,
                query: 'MATCH (n) RETURN n',
                page: {
                    ...(cursor ? { cursor } : {}),
                    limit: _trivium_internal_js__WEBPACK_IMPORTED_MODULE_2__.MAX_CURSOR_PAGE_LIMIT,
                },
            });
            for (const row of response.rows) {
                ids.push((0,_trivium_internal_js__WEBPACK_IMPORTED_MODULE_2__.getRequiredNumericId)(row.n?.id, 'id'));
            }
            cursor = response.page?.nextCursor ?? null;
        } while (cursor);
        return [...new Set(ids)].sort((left, right) => left - right);
    }
    async insertMappingAuto(mappingDbPath, externalId, namespace) {
        const timestamp = new Date().toISOString();
        const result = await this.core.execSql(mappingDbPath, {
            statement: `INSERT INTO ${_trivium_internal_js__WEBPACK_IMPORTED_MODULE_2__.EXTERNAL_IDS_TABLE} (namespace, external_id, created_at, updated_at) VALUES (?1, ?2, ?3, ?4)`,
            params: [namespace, externalId, timestamp, timestamp],
        });
        return (0,_trivium_internal_js__WEBPACK_IMPORTED_MODULE_2__.getRequiredNumericId)(result.lastInsertRowid, 'lastInsertRowid');
    }
    async insertMappingWithId(mappingDbPath, id, externalId, namespace) {
        const timestamp = new Date().toISOString();
        await this.core.execSql(mappingDbPath, {
            statement: `INSERT INTO ${_trivium_internal_js__WEBPACK_IMPORTED_MODULE_2__.EXTERNAL_IDS_TABLE} (internal_id, namespace, external_id, created_at, updated_at) VALUES (?1, ?2, ?3, ?4, ?5)`,
            params: [id, namespace, externalId, timestamp, timestamp],
        });
    }
    async readIndexLifecycleMeta(mappingDbPath) {
        const [lastContentMutationAt, lastTextWriteAt, lastTextRebuildAt, lastCompactionAt] = await Promise.all([
            this.readMetaValue(mappingDbPath, _trivium_internal_js__WEBPACK_IMPORTED_MODULE_2__.LAST_CONTENT_MUTATION_META_KEY),
            this.readMetaValue(mappingDbPath, _trivium_internal_js__WEBPACK_IMPORTED_MODULE_2__.LAST_TEXT_INDEX_WRITE_META_KEY),
            this.readMetaValue(mappingDbPath, _trivium_internal_js__WEBPACK_IMPORTED_MODULE_2__.LAST_TEXT_INDEX_REBUILD_META_KEY),
            this.readMetaValue(mappingDbPath, _trivium_internal_js__WEBPACK_IMPORTED_MODULE_2__.LAST_COMPACTION_META_KEY),
        ]);
        return {
            lastContentMutationAt,
            lastTextWriteAt,
            lastTextRebuildAt,
            lastCompactionAt,
        };
    }
    async writeMetaTimestamp(mappingDbPath, key) {
        await this.ensureSchema(mappingDbPath);
        const timestamp = await this.nextLifecycleTimestamp(mappingDbPath);
        await Promise.all([
            this.writeMetaValue(mappingDbPath, key, timestamp),
            this.writeMetaValue(mappingDbPath, _trivium_internal_js__WEBPACK_IMPORTED_MODULE_2__.LAST_INDEX_LIFECYCLE_EVENT_META_KEY, timestamp),
        ]);
    }
    async nextLifecycleTimestamp(mappingDbPath) {
        const current = new Date();
        const last = await this.readMetaValue(mappingDbPath, _trivium_internal_js__WEBPACK_IMPORTED_MODULE_2__.LAST_INDEX_LIFECYCLE_EVENT_META_KEY);
        const lastMs = last ? Date.parse(last) : Number.NaN;
        if (Number.isFinite(lastMs) && current.getTime() <= lastMs) {
            return new Date(lastMs + 1).toISOString();
        }
        return current.toISOString();
    }
}


/***/ },

/***/ "./src/services/trivium-repository.ts"
/*!********************************************!*\
  !*** ./src/services/trivium-repository.ts ***!
  \********************************************/
(__unused_webpack_module, __webpack_exports__, __webpack_require__) {

__webpack_require__.r(__webpack_exports__);
/* harmony export */ __webpack_require__.d(__webpack_exports__, {
/* harmony export */   TriviumRepository: () => (/* binding */ TriviumRepository)
/* harmony export */ });
/* harmony import */ var node_fs__WEBPACK_IMPORTED_MODULE_0__ = __webpack_require__(/*! node:fs */ "node:fs");
/* harmony import */ var node_fs__WEBPACK_IMPORTED_MODULE_0___default = /*#__PURE__*/__webpack_require__.n(node_fs__WEBPACK_IMPORTED_MODULE_0__);
/* harmony import */ var node_path__WEBPACK_IMPORTED_MODULE_1__ = __webpack_require__(/*! node:path */ "node:path");
/* harmony import */ var node_path__WEBPACK_IMPORTED_MODULE_1___default = /*#__PURE__*/__webpack_require__.n(node_path__WEBPACK_IMPORTED_MODULE_1__);
/* harmony import */ var _store_authority_paths_js__WEBPACK_IMPORTED_MODULE_2__ = __webpack_require__(/*! ../store/authority-paths.js */ "./src/store/authority-paths.ts");
/* harmony import */ var _utils_js__WEBPACK_IMPORTED_MODULE_3__ = __webpack_require__(/*! ../utils.js */ "./src/utils.ts");




class TriviumRepository {
    core;
    constructor(core) {
        this.core = core;
    }
    listDatabaseEntries(user, extensionId) {
        const directory = this.getDatabaseDirectory(user, extensionId);
        if (!node_fs__WEBPACK_IMPORTED_MODULE_0___default().existsSync(directory)) {
            return [];
        }
        return node_fs__WEBPACK_IMPORTED_MODULE_0___default().readdirSync(directory, { withFileTypes: true })
            .filter(entry => entry.isFile() && entry.name.endsWith('.tdb'))
            .map(entry => {
            const database = entry.name.slice(0, -'.tdb'.length);
            const paths = this.resolvePaths(user, extensionId, database);
            return {
                database,
                entryName: entry.name,
                ...paths,
            };
        });
    }
    resolvePaths(user, extensionId, database) {
        const directory = this.getDatabaseDirectory(user, extensionId);
        return {
            dbPath: node_path__WEBPACK_IMPORTED_MODULE_1___default().join(directory, `${(0,_utils_js__WEBPACK_IMPORTED_MODULE_3__.sanitizeFileSegment)(database)}.tdb`),
            mappingDbPath: node_path__WEBPACK_IMPORTED_MODULE_1___default().join(directory, '__mapping__', `${(0,_utils_js__WEBPACK_IMPORTED_MODULE_3__.sanitizeFileSegment)(database)}.sqlite`),
        };
    }
    getMappingDbPath(user, extensionId, database) {
        return this.resolvePaths(user, extensionId, database).mappingDbPath;
    }
    async insert(dbPath, request) {
        return await this.core.insertTrivium(dbPath, request);
    }
    async insertWithId(dbPath, request) {
        await this.core.insertTriviumWithId(dbPath, request);
    }
    async updatePayload(dbPath, request) {
        await this.core.updateTriviumPayload(dbPath, request);
    }
    async indexText(dbPath, request) {
        await this.core.indexTextTrivium(dbPath, request);
    }
    async indexKeyword(dbPath, request) {
        await this.core.indexKeywordTrivium(dbPath, request);
    }
    async buildTextIndex(dbPath, request = {}) {
        await this.core.buildTextIndexTrivium(dbPath, request);
    }
    async compact(dbPath, request = {}) {
        await this.core.compactTrivium(dbPath, request);
    }
    async bulkUpsert(dbPath, request) {
        return await this.core.bulkUpsertTrivium(dbPath, request);
    }
    async bulkLink(dbPath, request) {
        return await this.core.bulkLinkTrivium(dbPath, request);
    }
    async bulkUnlink(dbPath, request) {
        return await this.core.bulkUnlinkTrivium(dbPath, request);
    }
    async bulkDelete(dbPath, request) {
        return await this.core.bulkDeleteTrivium(dbPath, request);
    }
    async delete(dbPath, request) {
        await this.core.deleteTrivium(dbPath, request);
    }
    async get(dbPath, request) {
        return await this.core.getTrivium(dbPath, request);
    }
    async neighbors(dbPath, request) {
        return await this.core.neighborsTrivium(dbPath, request);
    }
    async search(dbPath, request) {
        return await this.core.searchTrivium(dbPath, request);
    }
    async searchAdvanced(dbPath, request) {
        return await this.core.searchAdvancedTrivium(dbPath, request);
    }
    async searchHybrid(dbPath, request) {
        return await this.core.searchHybridTrivium(dbPath, request);
    }
    async searchHybridWithContext(dbPath, request) {
        return await this.core.searchHybridWithContextTrivium(dbPath, request);
    }
    async tqlPage(dbPath, request) {
        return await this.core.tqlTriviumPage(dbPath, request);
    }
    async tqlMut(dbPath, request) {
        return await this.core.tqlMutTrivium(dbPath, request);
    }
    async createIndex(dbPath, request) {
        await this.core.createIndexTrivium(dbPath, request);
    }
    async dropIndex(dbPath, request) {
        await this.core.dropIndexTrivium(dbPath, request);
    }
    async flush(dbPath, request = {}) {
        await this.core.flushTrivium(dbPath, request);
    }
    async stat(dbPath, request = {}) {
        return await this.core.statTrivium(dbPath, request);
    }
    getDatabaseDirectory(user, extensionId) {
        const paths = (0,_store_authority_paths_js__WEBPACK_IMPORTED_MODULE_2__.getUserAuthorityPaths)(user);
        return node_path__WEBPACK_IMPORTED_MODULE_1___default().join(paths.triviumPrivateDir, (0,_utils_js__WEBPACK_IMPORTED_MODULE_3__.sanitizeFileSegment)(extensionId));
    }
}


/***/ },

/***/ "./src/services/trivium-service.ts"
/*!*****************************************!*\
  !*** ./src/services/trivium-service.ts ***!
  \*****************************************/
(__unused_webpack_module, __webpack_exports__, __webpack_require__) {

__webpack_require__.r(__webpack_exports__);
/* harmony export */ __webpack_require__.d(__webpack_exports__, {
/* harmony export */   TriviumService: () => (/* binding */ TriviumService)
/* harmony export */ });
/* harmony import */ var node_fs__WEBPACK_IMPORTED_MODULE_0__ = __webpack_require__(/*! node:fs */ "node:fs");
/* harmony import */ var node_fs__WEBPACK_IMPORTED_MODULE_0___default = /*#__PURE__*/__webpack_require__.n(node_fs__WEBPACK_IMPORTED_MODULE_0__);
/* harmony import */ var _utils_js__WEBPACK_IMPORTED_MODULE_1__ = __webpack_require__(/*! ../utils.js */ "./src/utils.ts");
/* harmony import */ var _trivium_internal_js__WEBPACK_IMPORTED_MODULE_2__ = __webpack_require__(/*! ./trivium-internal.js */ "./src/services/trivium-internal.ts");
/* harmony import */ var _trivium_mapping_meta_store_js__WEBPACK_IMPORTED_MODULE_3__ = __webpack_require__(/*! ./trivium-mapping-meta-store.js */ "./src/services/trivium-mapping-meta-store.ts");
/* harmony import */ var _trivium_repository_js__WEBPACK_IMPORTED_MODULE_4__ = __webpack_require__(/*! ./trivium-repository.js */ "./src/services/trivium-repository.ts");





class TriviumService {
    repository;
    mappingStore;
    constructor(core) {
        this.repository = new _trivium_repository_js__WEBPACK_IMPORTED_MODULE_4__.TriviumRepository(core);
        this.mappingStore = new _trivium_mapping_meta_store_js__WEBPACK_IMPORTED_MODULE_3__.TriviumMappingMetaStore(core);
    }
    async listDatabases(user, extensionId) {
        const databases = await Promise.all(this.repository.listDatabaseEntries(user, extensionId)
            .map(async (entry) => {
            const [meta, indexHealth] = await Promise.all([
                this.readDatabaseConfigMeta(entry.mappingDbPath),
                this.readIndexHealth(entry.mappingDbPath, true),
            ]);
            return (0,_trivium_internal_js__WEBPACK_IMPORTED_MODULE_2__.buildTriviumDatabaseRecord)(entry.dbPath, entry.entryName, meta, indexHealth);
        }));
        databases.sort((left, right) => (right.updatedAt ?? '').localeCompare(left.updatedAt ?? ''));
        return { databases };
    }
    async insert(user, extensionId, request) {
        const database = (0,_trivium_internal_js__WEBPACK_IMPORTED_MODULE_2__.getTriviumDatabaseName)(request.database);
        const { dbPath, mappingDbPath } = this.resolvePaths(user, extensionId, database);
        await this.rememberDatabaseConfig(mappingDbPath, request);
        const response = await this.repository.insert(dbPath, { ...request, database });
        await this.markContentMutation(mappingDbPath);
        return response;
    }
    async insertWithId(user, extensionId, request) {
        const database = (0,_trivium_internal_js__WEBPACK_IMPORTED_MODULE_2__.getTriviumDatabaseName)(request.database);
        const { dbPath, mappingDbPath } = this.resolvePaths(user, extensionId, database);
        await this.rememberDatabaseConfig(mappingDbPath, request);
        await this.repository.insertWithId(dbPath, { ...request, database });
        await this.markContentMutation(mappingDbPath);
    }
    async updatePayload(user, extensionId, request) {
        const database = (0,_trivium_internal_js__WEBPACK_IMPORTED_MODULE_2__.getTriviumDatabaseName)(request.database);
        const { dbPath, mappingDbPath } = this.resolvePaths(user, extensionId, database);
        await this.repository.updatePayload(dbPath, { ...request, database });
        await this.markContentMutation(mappingDbPath);
    }
    async indexText(user, extensionId, request) {
        const database = (0,_trivium_internal_js__WEBPACK_IMPORTED_MODULE_2__.getTriviumDatabaseName)(request.database);
        const { dbPath, mappingDbPath } = this.resolvePaths(user, extensionId, database);
        await this.rememberDatabaseConfig(mappingDbPath, request);
        await this.repository.indexText(dbPath, { ...request, database });
        await this.markTextIndexWrite(mappingDbPath);
    }
    async indexKeyword(user, extensionId, request) {
        const database = (0,_trivium_internal_js__WEBPACK_IMPORTED_MODULE_2__.getTriviumDatabaseName)(request.database);
        const { dbPath, mappingDbPath } = this.resolvePaths(user, extensionId, database);
        await this.rememberDatabaseConfig(mappingDbPath, request);
        await this.repository.indexKeyword(dbPath, { ...request, database });
        await this.markTextIndexWrite(mappingDbPath);
    }
    async buildTextIndex(user, extensionId, request = {}) {
        const database = (0,_trivium_internal_js__WEBPACK_IMPORTED_MODULE_2__.getTriviumDatabaseName)(request.database);
        const { dbPath, mappingDbPath } = this.resolvePaths(user, extensionId, database);
        await this.rememberDatabaseConfig(mappingDbPath, request);
        await this.repository.buildTextIndex(dbPath, { ...request, database });
        await this.markTextIndexRebuild(mappingDbPath);
    }
    async compact(user, extensionId, request = {}) {
        const database = (0,_trivium_internal_js__WEBPACK_IMPORTED_MODULE_2__.getTriviumDatabaseName)(request.database);
        const { dbPath, mappingDbPath } = this.resolvePaths(user, extensionId, database);
        await this.rememberDatabaseConfig(mappingDbPath, request);
        await this.repository.compact(dbPath, { ...request, database });
        await this.markCompaction(mappingDbPath);
    }
    async resolveId(user, extensionId, request) {
        const database = (0,_trivium_internal_js__WEBPACK_IMPORTED_MODULE_2__.getTriviumDatabaseName)(request.database);
        const namespace = (0,_trivium_internal_js__WEBPACK_IMPORTED_MODULE_2__.getTriviumNamespace)(request.namespace);
        const externalId = (0,_trivium_internal_js__WEBPACK_IMPORTED_MODULE_2__.getRequiredExternalId)(request.externalId);
        const mapping = await this.fetchMappingByExternal(this.getMappingDbPath(user, extensionId, database), externalId, namespace);
        return {
            id: mapping?.id ?? null,
            externalId,
            namespace,
        };
    }
    async resolveMany(user, extensionId, request) {
        const database = (0,_trivium_internal_js__WEBPACK_IMPORTED_MODULE_2__.getTriviumDatabaseName)(request.database);
        const mappingDbPath = this.getMappingDbPath(user, extensionId, database);
        const byInternalId = await this.fetchMappingsByInternalIds(mappingDbPath, request.items.map(item => Number(item.id ?? 0)));
        return {
            items: await Promise.all(request.items.map(async (item, index) => {
                const rawExternalId = typeof item.externalId === 'string' && item.externalId.trim() ? item.externalId.trim() : null;
                if (rawExternalId) {
                    const namespace = (0,_trivium_internal_js__WEBPACK_IMPORTED_MODULE_2__.getTriviumNamespace)(item.namespace);
                    const mapping = await this.fetchMappingByExternal(mappingDbPath, rawExternalId, namespace);
                    const explicitId = item.id == null ? null : Number(item.id);
                    if (explicitId != null && Number.isSafeInteger(explicitId) && explicitId > 0 && mapping && mapping.id !== explicitId) {
                        return {
                            index,
                            id: mapping.id,
                            externalId: mapping.externalId,
                            namespace: mapping.namespace,
                            error: `Trivium externalId ${namespace}:${rawExternalId} is already mapped to ${mapping.id}`,
                        };
                    }
                    return {
                        index,
                        id: mapping?.id ?? null,
                        externalId: rawExternalId,
                        namespace,
                    };
                }
                try {
                    const id = (0,_trivium_internal_js__WEBPACK_IMPORTED_MODULE_2__.getRequiredNumericId)(item.id);
                    const mapping = byInternalId.get(id);
                    return {
                        index,
                        id,
                        externalId: mapping?.externalId ?? null,
                        namespace: mapping?.namespace ?? null,
                    };
                }
                catch (error) {
                    return {
                        index,
                        id: null,
                        externalId: null,
                        namespace: null,
                        error: (0,_utils_js__WEBPACK_IMPORTED_MODULE_1__.asErrorMessage)(error),
                    };
                }
            })),
        };
    }
    async upsert(user, extensionId, request) {
        const response = await this.bulkUpsert(user, extensionId, {
            ...request,
            items: [
                {
                    ...(request.id === undefined ? {} : { id: request.id }),
                    ...(request.externalId === undefined ? {} : { externalId: request.externalId }),
                    ...(request.namespace === undefined ? {} : { namespace: request.namespace }),
                    vector: request.vector,
                    payload: request.payload,
                },
            ],
        });
        if (response.items.length > 0) {
            const item = response.items[0];
            return {
                id: item.id,
                action: item.action,
                externalId: item.externalId,
                namespace: item.namespace,
            };
        }
        throw new Error(response.failures[0]?.message ?? 'Trivium upsert failed');
    }
    async bulkUpsert(user, extensionId, request) {
        const database = (0,_trivium_internal_js__WEBPACK_IMPORTED_MODULE_2__.getTriviumDatabaseName)(request.database);
        const { dbPath, mappingDbPath } = this.resolvePaths(user, extensionId, database);
        await this.ensureSchema(mappingDbPath);
        await this.rememberDatabaseConfig(mappingDbPath, request);
        const failures = [];
        const prepared = [];
        for (const [index, item] of request.items.entries()) {
            try {
                const mapping = await this.resolveReference(mappingDbPath, item, true);
                prepared.push({
                    originalIndex: index,
                    mapping,
                    request: {
                        id: mapping.id,
                        vector: item.vector,
                        payload: item.payload,
                    },
                });
            }
            catch (error) {
                failures.push({ index, message: (0,_utils_js__WEBPACK_IMPORTED_MODULE_1__.asErrorMessage)(error) });
            }
        }
        let successItems = [];
        if (prepared.length > 0) {
            const coreResponse = await this.repository.bulkUpsert(dbPath, {
                ...request,
                database,
                items: prepared.map(item => item.request),
            });
            const failedPreparedIndexes = new Set(coreResponse.failures.map(item => item.index));
            const cleanupIds = prepared
                .filter((item, index) => item.mapping.createdMapping && failedPreparedIndexes.has(index))
                .map(item => item.mapping.id);
            if (cleanupIds.length > 0) {
                await this.deleteMappingsByInternalIds(mappingDbPath, cleanupIds);
            }
            failures.push(...coreResponse.failures.map(item => ({
                index: prepared[item.index]?.originalIndex ?? item.index,
                message: item.message,
            })));
            successItems = coreResponse.items
                .map((item) => {
                const preparedItem = prepared[item.index];
                if (!preparedItem) {
                    return null;
                }
                return {
                    index: preparedItem.originalIndex,
                    id: item.id,
                    action: item.action,
                    externalId: preparedItem.mapping.externalId,
                    namespace: preparedItem.mapping.namespace,
                };
            })
                .filter((item) => item !== null)
                .sort((left, right) => left.index - right.index);
            if (successItems.length > 0) {
                await this.markContentMutation(mappingDbPath);
            }
        }
        return {
            totalCount: request.items.length,
            successCount: successItems.length,
            failureCount: failures.length,
            failures: failures.sort((left, right) => left.index - right.index),
            items: successItems,
        };
    }
    async bulkLink(user, extensionId, request) {
        const database = (0,_trivium_internal_js__WEBPACK_IMPORTED_MODULE_2__.getTriviumDatabaseName)(request.database);
        const { dbPath, mappingDbPath } = this.resolvePaths(user, extensionId, database);
        const failures = [];
        const prepared = [];
        for (const [index, item] of request.items.entries()) {
            try {
                const src = await this.resolveReference(mappingDbPath, item.src, false);
                const dst = await this.resolveReference(mappingDbPath, item.dst, false);
                prepared.push({
                    originalIndex: index,
                    request: {
                        src: src.id,
                        dst: dst.id,
                        ...(item.label === undefined ? {} : { label: item.label }),
                        ...(item.weight === undefined ? {} : { weight: item.weight }),
                    },
                });
            }
            catch (error) {
                failures.push({ index, message: (0,_utils_js__WEBPACK_IMPORTED_MODULE_1__.asErrorMessage)(error) });
            }
        }
        return await this.runBulkMutation(prepared, failures, request.items.length, items => this.repository.bulkLink(dbPath, {
            ...request,
            database,
            items,
        }));
    }
    async bulkUnlink(user, extensionId, request) {
        const database = (0,_trivium_internal_js__WEBPACK_IMPORTED_MODULE_2__.getTriviumDatabaseName)(request.database);
        const { dbPath, mappingDbPath } = this.resolvePaths(user, extensionId, database);
        const failures = [];
        const prepared = [];
        for (const [index, item] of request.items.entries()) {
            try {
                const src = await this.resolveReference(mappingDbPath, item.src, false);
                const dst = await this.resolveReference(mappingDbPath, item.dst, false);
                prepared.push({
                    originalIndex: index,
                    request: {
                        src: src.id,
                        dst: dst.id,
                    },
                });
            }
            catch (error) {
                failures.push({ index, message: (0,_utils_js__WEBPACK_IMPORTED_MODULE_1__.asErrorMessage)(error) });
            }
        }
        return await this.runBulkMutation(prepared, failures, request.items.length, items => this.repository.bulkUnlink(dbPath, {
            ...request,
            database,
            items,
        }));
    }
    async bulkDelete(user, extensionId, request) {
        const database = (0,_trivium_internal_js__WEBPACK_IMPORTED_MODULE_2__.getTriviumDatabaseName)(request.database);
        const { dbPath, mappingDbPath } = this.resolvePaths(user, extensionId, database);
        const failures = [];
        const prepared = [];
        for (const [index, item] of request.items.entries()) {
            try {
                const resolved = await this.resolveReference(mappingDbPath, item, false);
                prepared.push({
                    originalIndex: index,
                    id: resolved.id,
                    request: { id: resolved.id },
                });
            }
            catch (error) {
                failures.push({ index, message: (0,_utils_js__WEBPACK_IMPORTED_MODULE_1__.asErrorMessage)(error) });
            }
        }
        const response = await this.runBulkMutation(prepared, failures, request.items.length, items => this.repository.bulkDelete(dbPath, {
            ...request,
            database,
            items,
        }));
        const failedOriginalIndexes = new Set(response.failures.map(item => item.index));
        const deletedIds = prepared
            .filter(item => !failedOriginalIndexes.has(item.originalIndex))
            .map(item => item.id);
        if (deletedIds.length > 0) {
            await this.deleteMappingsByInternalIds(mappingDbPath, deletedIds);
            await this.markContentMutation(mappingDbPath);
        }
        return response;
    }
    async delete(user, extensionId, request) {
        const response = await this.bulkDelete(user, extensionId, {
            ...request,
            items: [{ id: request.id }],
        });
        if (response.failureCount > 0) {
            throw new Error(response.failures[0]?.message ?? 'Trivium delete failed');
        }
    }
    async get(user, extensionId, request) {
        const database = (0,_trivium_internal_js__WEBPACK_IMPORTED_MODULE_2__.getTriviumDatabaseName)(request.database);
        const { dbPath, mappingDbPath } = this.resolvePaths(user, extensionId, database);
        const node = await this.repository.get(dbPath, { ...request, database });
        if (!node) {
            return null;
        }
        const [enriched] = await this.enrichNodes(mappingDbPath, [node]);
        return enriched ?? node;
    }
    async neighbors(user, extensionId, request) {
        const database = (0,_trivium_internal_js__WEBPACK_IMPORTED_MODULE_2__.getTriviumDatabaseName)(request.database);
        const { dbPath, mappingDbPath } = this.resolvePaths(user, extensionId, database);
        const response = await this.repository.neighbors(dbPath, { ...request, database });
        return {
            ...response,
            nodes: await this.resolveMappingsByInternalIds(mappingDbPath, response.ids),
        };
    }
    async search(user, extensionId, request) {
        const database = (0,_trivium_internal_js__WEBPACK_IMPORTED_MODULE_2__.getTriviumDatabaseName)(request.database);
        const { dbPath, mappingDbPath } = this.resolvePaths(user, extensionId, database);
        return await this.enrichSearchHits(mappingDbPath, await this.repository.search(dbPath, { ...request, database }));
    }
    async searchAdvanced(user, extensionId, request) {
        const database = (0,_trivium_internal_js__WEBPACK_IMPORTED_MODULE_2__.getTriviumDatabaseName)(request.database);
        const { dbPath, mappingDbPath } = this.resolvePaths(user, extensionId, database);
        return await this.enrichSearchHits(mappingDbPath, await this.repository.searchAdvanced(dbPath, { ...request, database }));
    }
    async searchHybrid(user, extensionId, request) {
        const database = (0,_trivium_internal_js__WEBPACK_IMPORTED_MODULE_2__.getTriviumDatabaseName)(request.database);
        const { dbPath, mappingDbPath } = this.resolvePaths(user, extensionId, database);
        return await this.enrichSearchHits(mappingDbPath, await this.repository.searchHybrid(dbPath, { ...request, database }));
    }
    async searchHybridWithContext(user, extensionId, request) {
        const database = (0,_trivium_internal_js__WEBPACK_IMPORTED_MODULE_2__.getTriviumDatabaseName)(request.database);
        const { dbPath, mappingDbPath } = this.resolvePaths(user, extensionId, database);
        const response = await this.repository.searchHybridWithContext(dbPath, { ...request, database });
        return {
            ...response,
            hits: await this.enrichSearchHits(mappingDbPath, response.hits),
        };
    }
    async tql(user, extensionId, request) {
        const response = await this.tqlPage(user, extensionId, request);
        return response.rows;
    }
    async tqlPage(user, extensionId, request) {
        const database = (0,_trivium_internal_js__WEBPACK_IMPORTED_MODULE_2__.getTriviumDatabaseName)(request.database);
        const { dbPath, mappingDbPath } = this.resolvePaths(user, extensionId, database);
        const response = await this.repository.tqlPage(dbPath, { ...request, database });
        return {
            ...response,
            rows: await this.enrichRows(mappingDbPath, response.rows),
        };
    }
    async tqlMut(user, extensionId, request) {
        const database = (0,_trivium_internal_js__WEBPACK_IMPORTED_MODULE_2__.getTriviumDatabaseName)(request.database);
        const { dbPath, mappingDbPath } = this.resolvePaths(user, extensionId, database);
        await this.rememberDatabaseConfig(mappingDbPath, request);
        const response = await this.repository.tqlMut(dbPath, { ...request, database });
        if (response.affected > 0 || response.createdIds.length > 0) {
            await this.markContentMutation(mappingDbPath);
            await this.reconcileMappingsAfterTqlMutation(dbPath, mappingDbPath, database, response.createdIds);
        }
        return response;
    }
    async createIndex(user, extensionId, request) {
        const database = (0,_trivium_internal_js__WEBPACK_IMPORTED_MODULE_2__.getTriviumDatabaseName)(request.database);
        const { dbPath, mappingDbPath } = this.resolvePaths(user, extensionId, database);
        await this.rememberDatabaseConfig(mappingDbPath, request);
        await this.repository.createIndex(dbPath, { ...request, database });
        await this.upsertPropertyIndexMetadata(mappingDbPath, request.field, 'manual');
    }
    async dropIndex(user, extensionId, request) {
        const database = (0,_trivium_internal_js__WEBPACK_IMPORTED_MODULE_2__.getTriviumDatabaseName)(request.database);
        const { dbPath, mappingDbPath } = this.resolvePaths(user, extensionId, database);
        await this.rememberDatabaseConfig(mappingDbPath, request);
        await this.repository.dropIndex(dbPath, { ...request, database });
        await this.deletePropertyIndexMetadata(mappingDbPath, request.field);
    }
    async flush(user, extensionId, request = {}) {
        const database = (0,_trivium_internal_js__WEBPACK_IMPORTED_MODULE_2__.getTriviumDatabaseName)(request.database);
        const { dbPath, mappingDbPath } = this.resolvePaths(user, extensionId, database);
        await this.repository.flush(dbPath, { ...request, database });
        await this.ensureSchema(mappingDbPath);
        if (node_fs__WEBPACK_IMPORTED_MODULE_0___default().existsSync(dbPath)) {
            await this.rememberDatabaseConfig(mappingDbPath, request);
        }
        await this.writeMetaValue(mappingDbPath, _trivium_internal_js__WEBPACK_IMPORTED_MODULE_2__.LAST_FLUSH_META_KEY, new Date().toISOString());
    }
    async stat(user, extensionId, request = {}) {
        const database = (0,_trivium_internal_js__WEBPACK_IMPORTED_MODULE_2__.getTriviumDatabaseName)(request.database);
        const { dbPath, mappingDbPath } = this.resolvePaths(user, extensionId, database);
        if (node_fs__WEBPACK_IMPORTED_MODULE_0___default().existsSync(dbPath)) {
            await this.rememberDatabaseConfig(mappingDbPath, request);
        }
        const stat = await this.repository.stat(dbPath, { ...request, database });
        const lastFlushAt = await this.readMetaValue(mappingDbPath, _trivium_internal_js__WEBPACK_IMPORTED_MODULE_2__.LAST_FLUSH_META_KEY);
        const mappingCount = await this.countMappings(mappingDbPath);
        const indexHealth = await this.readIndexHealth(mappingDbPath, stat.exists);
        const orphanMappingCount = request.includeMappingIntegrity
            ? await this.countOrphanMappings(dbPath, mappingDbPath, database)
            : null;
        return {
            ...stat,
            lastFlushAt,
            mappingCount,
            orphanMappingCount,
            indexHealth,
        };
    }
    async checkMappingsIntegrity(user, extensionId, request = {}) {
        const database = (0,_trivium_internal_js__WEBPACK_IMPORTED_MODULE_2__.getTriviumDatabaseName)(request.database);
        const { dbPath, mappingDbPath } = this.resolvePaths(user, extensionId, database);
        const sampleLimit = (0,_trivium_internal_js__WEBPACK_IMPORTED_MODULE_2__.getBoundedPositiveInteger)(request.sampleLimit, _trivium_internal_js__WEBPACK_IMPORTED_MODULE_2__.DEFAULT_INTEGRITY_SAMPLE_LIMIT, _trivium_internal_js__WEBPACK_IMPORTED_MODULE_2__.MAX_CURSOR_PAGE_LIMIT, 'sampleLimit');
        const analysis = await this.analyzeMappingsIntegrity(dbPath, mappingDbPath, database);
        const issues = [];
        const pushIssue = (issue) => {
            if (issues.length < sampleLimit) {
                issues.push(issue);
            }
        };
        for (const mapping of analysis.orphanMappings) {
            pushIssue({
                type: 'orphanMapping',
                message: `Trivium mapping ${mapping.namespace}:${mapping.externalId} points to missing node ${mapping.id}`,
                id: mapping.id,
                externalId: mapping.externalId,
                namespace: mapping.namespace,
            });
        }
        for (const id of analysis.missingNodeIds) {
            pushIssue({
                type: 'missingMapping',
                message: `Trivium node ${id} has no externalId mapping`,
                id,
                externalId: null,
                namespace: null,
            });
        }
        for (const group of analysis.duplicateInternalGroups) {
            const first = group[0];
            if (!first) {
                continue;
            }
            pushIssue({
                type: 'duplicateInternalId',
                message: `Trivium internalId ${first.id} appears in ${group.length} mapping rows`,
                id: first.id,
                externalId: first.externalId,
                namespace: first.namespace,
            });
        }
        for (const group of analysis.duplicateExternalGroups) {
            const first = group[0];
            if (!first) {
                continue;
            }
            pushIssue({
                type: 'duplicateExternalId',
                message: `Trivium externalId ${first.namespace}:${first.externalId} appears in ${group.length} mapping rows`,
                id: first.id,
                externalId: first.externalId,
                namespace: first.namespace,
            });
        }
        const totalIssues = analysis.orphanMappings.length
            + analysis.missingNodeIds.length
            + analysis.duplicateInternalGroups.length
            + analysis.duplicateExternalGroups.length;
        return {
            ok: totalIssues === 0,
            mappingCount: analysis.mappings.length,
            nodeCount: analysis.nodeIds.length,
            orphanMappingCount: analysis.orphanMappings.length,
            missingMappingCount: analysis.missingNodeIds.length,
            duplicateInternalIdCount: analysis.duplicateInternalGroups.length,
            duplicateExternalIdCount: analysis.duplicateExternalGroups.length,
            issues,
            sampled: totalIssues > issues.length,
        };
    }
    async deleteOrphanMappings(user, extensionId, request = {}) {
        const database = (0,_trivium_internal_js__WEBPACK_IMPORTED_MODULE_2__.getTriviumDatabaseName)(request.database);
        const { dbPath, mappingDbPath } = this.resolvePaths(user, extensionId, database);
        const limit = (0,_trivium_internal_js__WEBPACK_IMPORTED_MODULE_2__.getBoundedPositiveInteger)(request.limit, _trivium_internal_js__WEBPACK_IMPORTED_MODULE_2__.DEFAULT_ORPHAN_DELETE_LIMIT, _trivium_internal_js__WEBPACK_IMPORTED_MODULE_2__.MAX_CURSOR_PAGE_LIMIT, 'limit');
        const analysis = await this.analyzeMappingsIntegrity(dbPath, mappingDbPath, database);
        const orphans = analysis.orphanMappings.slice(0, limit);
        if (!request.dryRun && orphans.length > 0) {
            await this.deleteMappingsByInternalIds(mappingDbPath, orphans.map(item => item.id));
        }
        return {
            scannedCount: analysis.mappings.length,
            orphanCount: analysis.orphanMappings.length,
            deletedCount: request.dryRun ? 0 : orphans.length,
            hasMore: analysis.orphanMappings.length > orphans.length,
            orphans,
        };
    }
    async listMappingsPage(user, extensionId, request = {}) {
        const database = (0,_trivium_internal_js__WEBPACK_IMPORTED_MODULE_2__.getTriviumDatabaseName)(request.database);
        const mappingDbPath = this.getMappingDbPath(user, extensionId, database);
        return await this.mappingStore.listMappingsPage(mappingDbPath, request);
    }
    async ensureSchema(mappingDbPath) {
        await this.mappingStore.ensureSchema(mappingDbPath);
    }
    resolvePaths(user, extensionId, database) {
        return this.repository.resolvePaths(user, extensionId, database);
    }
    getMappingDbPath(user, extensionId, database) {
        return this.repository.getMappingDbPath(user, extensionId, database);
    }
    async runBulkMutation(prepared, failures, totalCount, execute) {
        if (prepared.length > 0) {
            const coreResponse = await execute(prepared.map(item => item.request));
            failures.push(...coreResponse.failures.map(item => ({
                index: prepared[item.index]?.originalIndex ?? item.index,
                message: item.message,
            })));
            return {
                totalCount,
                successCount: prepared.length - coreResponse.failureCount,
                failureCount: failures.length,
                failures: failures.sort((left, right) => left.index - right.index),
            };
        }
        return {
            totalCount,
            successCount: 0,
            failureCount: failures.length,
            failures: failures.sort((left, right) => left.index - right.index),
        };
    }
    async resolveReference(mappingDbPath, reference, allowCreate) {
        return await this.mappingStore.resolveReference(mappingDbPath, reference, allowCreate);
    }
    async fetchMappingByExternal(mappingDbPath, externalId, namespace) {
        return await this.mappingStore.fetchMappingByExternal(mappingDbPath, externalId, namespace);
    }
    async resolveMappingsByInternalIds(mappingDbPath, ids) {
        return await this.mappingStore.resolveMappingsByInternalIds(mappingDbPath, ids);
    }
    async fetchMappingsByInternalIds(mappingDbPath, ids) {
        return await this.mappingStore.fetchMappingsByInternalIds(mappingDbPath, ids);
    }
    async countMappings(mappingDbPath) {
        return await this.mappingStore.countMappings(mappingDbPath);
    }
    async countOrphanMappings(dbPath, mappingDbPath, database) {
        return await this.mappingStore.countOrphanMappings(dbPath, mappingDbPath, database);
    }
    async analyzeMappingsIntegrity(dbPath, mappingDbPath, database) {
        return await this.mappingStore.analyzeMappingsIntegrity(dbPath, mappingDbPath, database);
    }
    async deleteMappingsByInternalIds(mappingDbPath, ids) {
        await this.mappingStore.deleteMappingsByInternalIds(mappingDbPath, ids);
    }
    async reconcileMappingsAfterTqlMutation(dbPath, mappingDbPath, database, createdIds) {
        await this.mappingStore.reconcileMappingsAfterTqlMutation(dbPath, mappingDbPath, database, createdIds);
    }
    async upsertPropertyIndexMetadata(mappingDbPath, field, source) {
        await this.mappingStore.upsertPropertyIndexMetadata(mappingDbPath, field, source);
    }
    async deletePropertyIndexMetadata(mappingDbPath, field) {
        await this.mappingStore.deletePropertyIndexMetadata(mappingDbPath, field);
    }
    async readMetaValue(mappingDbPath, key) {
        return await this.mappingStore.readMetaValue(mappingDbPath, key);
    }
    async writeMetaValue(mappingDbPath, key, value) {
        await this.mappingStore.writeMetaValue(mappingDbPath, key, value);
    }
    async rememberDatabaseConfig(mappingDbPath, request) {
        await this.mappingStore.rememberDatabaseConfig(mappingDbPath, request);
    }
    async readDatabaseConfigMeta(mappingDbPath) {
        return await this.mappingStore.readDatabaseConfigMeta(mappingDbPath);
    }
    async readIndexHealth(mappingDbPath, exists) {
        return await this.mappingStore.readIndexHealth(mappingDbPath, exists);
    }
    async markContentMutation(mappingDbPath) {
        await this.mappingStore.markContentMutation(mappingDbPath);
    }
    async markTextIndexWrite(mappingDbPath) {
        await this.mappingStore.markTextIndexWrite(mappingDbPath);
    }
    async markTextIndexRebuild(mappingDbPath) {
        await this.mappingStore.markTextIndexRebuild(mappingDbPath);
    }
    async markCompaction(mappingDbPath) {
        await this.mappingStore.markCompaction(mappingDbPath);
    }
    async enrichSearchHits(mappingDbPath, hits) {
        return await this.mappingStore.enrichSearchHits(mappingDbPath, hits);
    }
    async enrichNodes(mappingDbPath, nodes) {
        return await this.mappingStore.enrichNodes(mappingDbPath, nodes);
    }
    async enrichRows(mappingDbPath, rows) {
        return await this.mappingStore.enrichRows(mappingDbPath, rows);
    }
}


/***/ },

/***/ "./src/services/zip-archive.ts"
/*!*************************************!*\
  !*** ./src/services/zip-archive.ts ***!
  \*************************************/
(__unused_webpack_module, __webpack_exports__, __webpack_require__) {

__webpack_require__.r(__webpack_exports__);
/* harmony export */ __webpack_require__.d(__webpack_exports__, {
/* harmony export */   createZipArchive: () => (/* binding */ createZipArchive),
/* harmony export */   isZipArchive: () => (/* binding */ isZipArchive),
/* harmony export */   readZipArchive: () => (/* binding */ readZipArchive)
/* harmony export */ });
/* harmony import */ var node_path__WEBPACK_IMPORTED_MODULE_0__ = __webpack_require__(/*! node:path */ "node:path");
/* harmony import */ var node_path__WEBPACK_IMPORTED_MODULE_0___default = /*#__PURE__*/__webpack_require__.n(node_path__WEBPACK_IMPORTED_MODULE_0__);
/* harmony import */ var node_zlib__WEBPACK_IMPORTED_MODULE_1__ = __webpack_require__(/*! node:zlib */ "node:zlib");
/* harmony import */ var node_zlib__WEBPACK_IMPORTED_MODULE_1___default = /*#__PURE__*/__webpack_require__.n(node_zlib__WEBPACK_IMPORTED_MODULE_1__);


const ZIP_LOCAL_FILE_HEADER_SIGNATURE = 0x04034b50;
const ZIP_CENTRAL_DIRECTORY_SIGNATURE = 0x02014b50;
const ZIP_END_OF_CENTRAL_DIRECTORY_SIGNATURE = 0x06054b50;
const ZIP_UTF8_FLAG = 0x0800;
const ZIP_STORE_METHOD = 0;
const ZIP_DEFLATE_METHOD = 8;
const ZIP_VERSION = 20;
const ZIP_MAX_EOCD_SEARCH = 0xffff + 22;
const CRC32_TABLE = buildCrc32Table();
function isZipArchive(bytes) {
    const buffer = Buffer.from(bytes);
    return buffer.byteLength >= 4 && buffer.readUInt32LE(0) === ZIP_LOCAL_FILE_HEADER_SIGNATURE;
}
function createZipArchive(files) {
    const normalizedFiles = files.map(file => normalizeInputFile(file));
    const seen = new Set();
    const localParts = [];
    const centralParts = [];
    let offset = 0;
    for (const file of normalizedFiles) {
        if (seen.has(file.path)) {
            throw new Error(`Duplicate zip entry path: ${file.path}`);
        }
        seen.add(file.path);
        const encodedPath = Buffer.from(file.path, 'utf8');
        const rawBytes = Buffer.from(file.bytes);
        const compressed = selectCompressedBytes(rawBytes, file.compression);
        const crc = crc32(rawBytes);
        const { date, time } = toDosDateTime(file.modifiedAt ?? new Date());
        const localHeader = Buffer.alloc(30);
        localHeader.writeUInt32LE(ZIP_LOCAL_FILE_HEADER_SIGNATURE, 0);
        localHeader.writeUInt16LE(ZIP_VERSION, 4);
        localHeader.writeUInt16LE(ZIP_UTF8_FLAG, 6);
        localHeader.writeUInt16LE(compressed.method, 8);
        localHeader.writeUInt16LE(time, 10);
        localHeader.writeUInt16LE(date, 12);
        localHeader.writeUInt32LE(crc >>> 0, 14);
        localHeader.writeUInt32LE(compressed.bytes.byteLength, 18);
        localHeader.writeUInt32LE(rawBytes.byteLength, 22);
        localHeader.writeUInt16LE(encodedPath.byteLength, 26);
        localHeader.writeUInt16LE(0, 28);
        localParts.push(localHeader, encodedPath, compressed.bytes);
        const centralHeader = Buffer.alloc(46);
        centralHeader.writeUInt32LE(ZIP_CENTRAL_DIRECTORY_SIGNATURE, 0);
        centralHeader.writeUInt16LE(ZIP_VERSION, 4);
        centralHeader.writeUInt16LE(ZIP_VERSION, 6);
        centralHeader.writeUInt16LE(ZIP_UTF8_FLAG, 8);
        centralHeader.writeUInt16LE(compressed.method, 10);
        centralHeader.writeUInt16LE(time, 12);
        centralHeader.writeUInt16LE(date, 14);
        centralHeader.writeUInt32LE(crc >>> 0, 16);
        centralHeader.writeUInt32LE(compressed.bytes.byteLength, 20);
        centralHeader.writeUInt32LE(rawBytes.byteLength, 24);
        centralHeader.writeUInt16LE(encodedPath.byteLength, 28);
        centralHeader.writeUInt16LE(0, 30);
        centralHeader.writeUInt16LE(0, 32);
        centralHeader.writeUInt16LE(0, 34);
        centralHeader.writeUInt16LE(0, 36);
        centralHeader.writeUInt32LE(0, 38);
        centralHeader.writeUInt32LE(offset, 42);
        centralParts.push(centralHeader, encodedPath);
        offset += localHeader.byteLength + encodedPath.byteLength + compressed.bytes.byteLength;
    }
    const centralDirectory = Buffer.concat(centralParts);
    const end = Buffer.alloc(22);
    end.writeUInt32LE(ZIP_END_OF_CENTRAL_DIRECTORY_SIGNATURE, 0);
    end.writeUInt16LE(0, 4);
    end.writeUInt16LE(0, 6);
    end.writeUInt16LE(normalizedFiles.length, 8);
    end.writeUInt16LE(normalizedFiles.length, 10);
    end.writeUInt32LE(centralDirectory.byteLength, 12);
    end.writeUInt32LE(offset, 16);
    end.writeUInt16LE(0, 20);
    return Buffer.concat([...localParts, centralDirectory, end]);
}
function readZipArchive(bytes) {
    const buffer = Buffer.from(bytes);
    const endRecordOffset = findEndOfCentralDirectoryOffset(buffer);
    const entryCount = buffer.readUInt16LE(endRecordOffset + 10);
    const centralDirectoryOffset = buffer.readUInt32LE(endRecordOffset + 16);
    const files = new Map();
    let offset = centralDirectoryOffset;
    for (let index = 0; index < entryCount; index += 1) {
        if (offset + 46 > buffer.byteLength || buffer.readUInt32LE(offset) !== ZIP_CENTRAL_DIRECTORY_SIGNATURE) {
            throw new Error('Invalid zip central directory');
        }
        const flags = buffer.readUInt16LE(offset + 8);
        if ((flags & 0x0001) !== 0) {
            throw new Error('Encrypted zip entries are not supported');
        }
        const method = buffer.readUInt16LE(offset + 10);
        const crc = buffer.readUInt32LE(offset + 16);
        const compressedSize = buffer.readUInt32LE(offset + 20);
        const uncompressedSize = buffer.readUInt32LE(offset + 24);
        const fileNameLength = buffer.readUInt16LE(offset + 28);
        const extraLength = buffer.readUInt16LE(offset + 30);
        const commentLength = buffer.readUInt16LE(offset + 32);
        const localHeaderOffset = buffer.readUInt32LE(offset + 42);
        const fileNameStart = offset + 46;
        const fileNameEnd = fileNameStart + fileNameLength;
        const fileName = buffer.subarray(fileNameStart, fileNameEnd).toString('utf8');
        const normalizedPath = normalizeArchivePath(fileName);
        offset = fileNameEnd + extraLength + commentLength;
        if (!normalizedPath) {
            continue;
        }
        if (files.has(normalizedPath)) {
            throw new Error(`Duplicate zip entry path: ${normalizedPath}`);
        }
        if (localHeaderOffset + 30 > buffer.byteLength || buffer.readUInt32LE(localHeaderOffset) !== ZIP_LOCAL_FILE_HEADER_SIGNATURE) {
            throw new Error(`Invalid zip local header for entry: ${normalizedPath}`);
        }
        const localFileNameLength = buffer.readUInt16LE(localHeaderOffset + 26);
        const localExtraLength = buffer.readUInt16LE(localHeaderOffset + 28);
        const compressedStart = localHeaderOffset + 30 + localFileNameLength + localExtraLength;
        const compressedEnd = compressedStart + compressedSize;
        if (compressedEnd > buffer.byteLength) {
            throw new Error(`Zip entry exceeds archive size: ${normalizedPath}`);
        }
        const compressed = buffer.subarray(compressedStart, compressedEnd);
        const rawBytes = decompressZipEntry(compressed, method, normalizedPath);
        if (rawBytes.byteLength !== uncompressedSize) {
            throw new Error(`Zip entry size mismatch: ${normalizedPath}`);
        }
        if ((crc32(rawBytes) >>> 0) !== (crc >>> 0)) {
            throw new Error(`Zip entry checksum mismatch: ${normalizedPath}`);
        }
        files.set(normalizedPath, rawBytes);
    }
    return files;
}
function normalizeInputFile(file) {
    return {
        path: requireArchivePath(file.path),
        bytes: Buffer.from(file.bytes),
        modifiedAt: file.modifiedAt ?? new Date(),
        compression: file.compression ?? 'auto',
    };
}
function requireArchivePath(value) {
    const normalized = normalizeArchivePath(value);
    if (!normalized) {
        throw new Error(`Invalid zip entry path: ${value}`);
    }
    return normalized;
}
function normalizeArchivePath(value) {
    const replaced = value.replace(/\\/g, '/').trim();
    if (!replaced) {
        return null;
    }
    const trimmedLeading = replaced.replace(/^\/+/, '');
    if (!trimmedLeading) {
        return null;
    }
    if (trimmedLeading.endsWith('/')) {
        const directoryPath = trimmedLeading.replace(/\/+$/, '');
        return directoryPath ? null : null;
    }
    const normalized = node_path__WEBPACK_IMPORTED_MODULE_0___default().posix.normalize(trimmedLeading);
    if (!normalized || normalized === '.' || normalized === '..' || normalized.startsWith('../') || normalized.includes('/../')) {
        throw new Error(`Invalid zip entry path: ${value}`);
    }
    return normalized;
}
function selectCompressedBytes(bytes, compression) {
    if (compression === 'store') {
        return {
            method: ZIP_STORE_METHOD,
            bytes,
        };
    }
    const deflated = node_zlib__WEBPACK_IMPORTED_MODULE_1___default().deflateRawSync(bytes);
    if (compression === 'deflate' || deflated.byteLength < bytes.byteLength) {
        return {
            method: ZIP_DEFLATE_METHOD,
            bytes: deflated,
        };
    }
    return {
        method: ZIP_STORE_METHOD,
        bytes,
    };
}
function decompressZipEntry(bytes, method, pathName) {
    if (method === ZIP_STORE_METHOD) {
        return Buffer.from(bytes);
    }
    if (method === ZIP_DEFLATE_METHOD) {
        return node_zlib__WEBPACK_IMPORTED_MODULE_1___default().inflateRawSync(bytes);
    }
    throw new Error(`Unsupported zip compression method ${method} for entry: ${pathName}`);
}
function findEndOfCentralDirectoryOffset(buffer) {
    const start = Math.max(0, buffer.byteLength - ZIP_MAX_EOCD_SEARCH);
    for (let offset = buffer.byteLength - 22; offset >= start; offset -= 1) {
        if (buffer.readUInt32LE(offset) === ZIP_END_OF_CENTRAL_DIRECTORY_SIGNATURE) {
            return offset;
        }
    }
    throw new Error('Zip end of central directory not found');
}
function toDosDateTime(value) {
    const year = Math.min(2107, Math.max(1980, value.getFullYear()));
    return {
        date: ((year - 1980) << 9) | ((value.getMonth() + 1) << 5) | value.getDate(),
        time: (value.getHours() << 11) | (value.getMinutes() << 5) | Math.floor(value.getSeconds() / 2),
    };
}
function crc32(bytes) {
    let crc = 0xffffffff;
    for (const byte of bytes) {
        crc = (crc >>> 8) ^ CRC32_TABLE[(crc ^ byte) & 0xff];
    }
    return (crc ^ 0xffffffff) >>> 0;
}
function buildCrc32Table() {
    const table = new Uint32Array(256);
    for (let index = 0; index < 256; index += 1) {
        let value = index;
        for (let bit = 0; bit < 8; bit += 1) {
            value = (value & 1) !== 0 ? (0xedb88320 ^ (value >>> 1)) : (value >>> 1);
        }
        table[index] = value >>> 0;
    }
    return table;
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
/* harmony export */   AuthorityServiceError: () => (/* binding */ AuthorityServiceError),
/* harmony export */   asErrorMessage: () => (/* binding */ asErrorMessage),
/* harmony export */   atomicWriteJson: () => (/* binding */ atomicWriteJson),
/* harmony export */   buildPermissionDescriptor: () => (/* binding */ buildPermissionDescriptor),
/* harmony export */   ensureDir: () => (/* binding */ ensureDir),
/* harmony export */   getHttpFetchNetworkClass: () => (/* binding */ getHttpFetchNetworkClass),
/* harmony export */   getSessionToken: () => (/* binding */ getSessionToken),
/* harmony export */   getUserContext: () => (/* binding */ getUserContext),
/* harmony export */   isAuthorityServiceError: () => (/* binding */ isAuthorityServiceError),
/* harmony export */   isRestrictedHttpFetchTarget: () => (/* binding */ isRestrictedHttpFetchTarget),
/* harmony export */   normalizeHostname: () => (/* binding */ normalizeHostname),
/* harmony export */   normalizeHttpFetchTarget: () => (/* binding */ normalizeHttpFetchTarget),
/* harmony export */   normalizePermissionTarget: () => (/* binding */ normalizePermissionTarget),
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
/* harmony import */ var node_net__WEBPACK_IMPORTED_MODULE_2__ = __webpack_require__(/*! node:net */ "node:net");
/* harmony import */ var node_net__WEBPACK_IMPORTED_MODULE_2___default = /*#__PURE__*/__webpack_require__.n(node_net__WEBPACK_IMPORTED_MODULE_2__);
/* harmony import */ var node_path__WEBPACK_IMPORTED_MODULE_3__ = __webpack_require__(/*! node:path */ "node:path");
/* harmony import */ var node_path__WEBPACK_IMPORTED_MODULE_3___default = /*#__PURE__*/__webpack_require__.n(node_path__WEBPACK_IMPORTED_MODULE_3__);
/* harmony import */ var _constants_js__WEBPACK_IMPORTED_MODULE_4__ = __webpack_require__(/*! ./constants.js */ "./src/constants.ts");





class AuthorityServiceError extends Error {
    status;
    code;
    category;
    details;
    constructor(message, status, code, category, details) {
        super(message);
        this.status = status;
        this.code = code;
        this.category = category;
        this.details = details;
        this.name = 'AuthorityServiceError';
    }
    toPayload() {
        return {
            error: this.message,
            code: this.code,
            category: this.category,
            ...(this.details === undefined ? {} : { details: this.details }),
        };
    }
}
function isAuthorityServiceError(error) {
    return error instanceof AuthorityServiceError;
}
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
    ensureDir(node_path__WEBPACK_IMPORTED_MODULE_3___default().dirname(filePath));
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
        throw new AuthorityServiceError('Unauthorized', 401, 'unauthorized', 'auth');
    }
    return {
        handle: request.user.profile.handle,
        isAdmin: Boolean(request.user.profile.admin),
        rootDir: request.user.directories.root,
    };
}
function getSessionToken(request) {
    const headerValue = request.headers[_constants_js__WEBPACK_IMPORTED_MODULE_4__.SESSION_HEADER];
    if (typeof headerValue === 'string' && headerValue.trim()) {
        return headerValue.trim();
    }
    const queryValue = request.query?.[_constants_js__WEBPACK_IMPORTED_MODULE_4__.SESSION_QUERY];
    if (typeof queryValue === 'string' && queryValue.trim()) {
        return queryValue.trim();
    }
    return null;
}
function normalizeHostname(input) {
    const url = new URL(input);
    return stripTrailingDot(url.hostname.toLowerCase());
}
function normalizeHttpFetchTarget(input) {
    const trimmed = input.trim();
    if (!trimmed) {
        return '*';
    }
    if (looksLikeAbsoluteUrl(trimmed)) {
        return normalizeHostname(trimmed);
    }
    return stripTrailingDot(trimmed.toLowerCase());
}
function normalizePermissionTarget(resource, target) {
    const trimmedTarget = typeof target === 'string' ? target.trim() : '';
    switch (resource) {
        case 'storage.kv':
        case 'storage.blob':
        case 'fs.private':
            return '*';
        case 'sql.private':
        case 'trivium.private':
            return trimmedTarget || 'default';
        case 'http.fetch':
            return normalizeHttpFetchTarget(trimmedTarget);
        case 'jobs.background':
        case 'events.stream':
            return trimmedTarget || '*';
        default:
            return trimmedTarget || '*';
    }
}
function getHttpFetchNetworkClass(target) {
    const normalized = normalizeHttpFetchTarget(target);
    if (normalized === '*' || !normalized) {
        return 'hostname';
    }
    if (normalized === 'localhost' || normalized.endsWith('.localhost')) {
        return 'localhost';
    }
    const ipVersion = node_net__WEBPACK_IMPORTED_MODULE_2___default().isIP(normalized);
    if (ipVersion === 4) {
        const octets = normalized.split('.').map(segment => Number(segment));
        const first = octets[0] ?? -1;
        const second = octets[1] ?? -1;
        if (first === 0) {
            return 'unspecified';
        }
        if (first === 127) {
            return 'loopback';
        }
        if (first === 10 || (first === 172 && second >= 16 && second <= 31) || (first === 192 && second === 168)) {
            return 'private';
        }
        if (first === 169 && second === 254) {
            return 'link-local';
        }
        if (first >= 224 && first <= 239) {
            return 'multicast';
        }
        return 'public';
    }
    if (ipVersion === 6) {
        const lowered = normalized.toLowerCase();
        if (lowered === '::') {
            return 'unspecified';
        }
        if (lowered === '::1') {
            return 'loopback';
        }
        if (lowered.startsWith('fe8:') || lowered.startsWith('fe9:') || lowered.startsWith('fea:') || lowered.startsWith('feb:')) {
            return 'link-local';
        }
        if (lowered.startsWith('fc') || lowered.startsWith('fd')) {
            return 'private';
        }
        if (lowered.startsWith('ff')) {
            return 'multicast';
        }
        return 'public';
    }
    return 'hostname';
}
function isRestrictedHttpFetchTarget(target) {
    return getHttpFetchNetworkClass(target) !== 'hostname' && getHttpFetchNetworkClass(target) !== 'public';
}
function buildPermissionDescriptor(resource, target) {
    if (!_constants_js__WEBPACK_IMPORTED_MODULE_4__.SUPPORTED_RESOURCES.includes(resource)) {
        throw new Error(`Unsupported resource: ${resource}`);
    }
    const normalizedTarget = normalizePermissionTarget(resource, target);
    return {
        key: `${resource}:${normalizedTarget}`,
        resource,
        target: normalizedTarget,
        riskLevel: resource === 'http.fetch' && isRestrictedHttpFetchTarget(normalizedTarget)
            ? 'high'
            : _constants_js__WEBPACK_IMPORTED_MODULE_4__.RESOURCE_RISK[resource],
    };
}
function asErrorMessage(error) {
    if (error instanceof Error) {
        return error.message;
    }
    return String(error);
}
function stripTrailingDot(value) {
    return value.replace(/\.+$/, '');
}
function looksLikeAbsoluteUrl(value) {
    return /^[a-zA-Z][a-zA-Z\d+.-]*:/.test(value);
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

/***/ },

/***/ "node:zlib"
/*!****************************!*\
  !*** external "node:zlib" ***!
  \****************************/
(module) {

module.exports = require("node:zlib");

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
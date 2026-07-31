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
/* harmony export */   AUTHORITY_MODULE_PROTOCOL_VERSION: () => (/* binding */ AUTHORITY_MODULE_PROTOCOL_VERSION),
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
/* harmony export */   MAX_SQL_BATCH_STATEMENTS: () => (/* binding */ MAX_SQL_BATCH_STATEMENTS),
/* harmony export */   NATIVE_MIGRATION_MAX_COMPRESSED_BYTES: () => (/* binding */ NATIVE_MIGRATION_MAX_COMPRESSED_BYTES),
/* harmony export */   NATIVE_MIGRATION_MAX_ENTRY_COUNT: () => (/* binding */ NATIVE_MIGRATION_MAX_ENTRY_COUNT),
/* harmony export */   NATIVE_MIGRATION_MAX_PATH_BYTES: () => (/* binding */ NATIVE_MIGRATION_MAX_PATH_BYTES),
/* harmony export */   NATIVE_MIGRATION_MAX_PATH_DEPTH: () => (/* binding */ NATIVE_MIGRATION_MAX_PATH_DEPTH),
/* harmony export */   NATIVE_MIGRATION_MAX_UNCOMPRESSED_BYTES: () => (/* binding */ NATIVE_MIGRATION_MAX_UNCOMPRESSED_BYTES),
/* harmony export */   NATIVE_MIGRATION_TRANSFER_CHUNK_BYTES: () => (/* binding */ NATIVE_MIGRATION_TRANSFER_CHUNK_BYTES),
/* harmony export */   RESOURCE_RISK: () => (/* binding */ RESOURCE_RISK),
/* harmony export */   SESSION_HEADER: () => (/* binding */ SESSION_HEADER),
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
const MAX_KV_VALUE_BYTES = 128 * 1024;
const MAX_BLOB_BYTES = 16 * 1024 * 1024;
const MAX_AUDIT_LINES = 200;
const DATA_TRANSFER_CHUNK_BYTES = 256 * 1024;
const DATA_TRANSFER_INLINE_THRESHOLD_BYTES = 256 * 1024;
const UNMANAGED_TRANSFER_MAX_BYTES = 256 * 1024 * 1024;
const NATIVE_MIGRATION_MAX_COMPRESSED_BYTES = 12 * 1024 * 1024 * 1024;
const NATIVE_MIGRATION_TRANSFER_CHUNK_BYTES = 4 * 1024 * 1024;
const NATIVE_MIGRATION_MAX_UNCOMPRESSED_BYTES = 48 * 1024 * 1024 * 1024;
const NATIVE_MIGRATION_MAX_ENTRY_COUNT = 300_000;
const NATIVE_MIGRATION_MAX_PATH_BYTES = 1024;
const NATIVE_MIGRATION_MAX_PATH_DEPTH = 32;
const MAX_SQL_BATCH_STATEMENTS = 100;
const SUPPORTED_RESOURCES = [
    'storage.kv',
    'storage.blob',
    'fs.private',
    'sql.private',
    'trivium.private',
    'http.fetch',
    'jobs.background',
    'events.stream',
    'module.execute',
    'agent.run',
    'agent.browser',
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
    'module.execute': 'medium',
    'agent.run': 'high',
    'agent.browser': 'high',
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
    'module.execute': 'granted',
    'agent.run': 'prompt',
    'agent.browser': 'prompt',
};
/** Authority module host protocol version. Bump when manifest/handler contract changes. */
const AUTHORITY_MODULE_PROTOCOL_VERSION = 1;
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
function buildAuthorityFeatureFlags(isAdmin, moduleCount = 0) {
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
        modules: {
            enabled: true,
            registryVersion: AUTHORITY_MODULE_PROTOCOL_VERSION,
            count: moduleCount,
        },
    };
}


/***/ },

/***/ "./src/services/workspace-history-service.ts"
/*!***************************************************!*\
  !*** ./src/services/workspace-history-service.ts ***!
  \***************************************************/
(__unused_webpack_module, __webpack_exports__, __webpack_require__) {

__webpack_require__.r(__webpack_exports__);
/* harmony export */ __webpack_require__.d(__webpack_exports__, {
/* harmony export */   WorkspaceHistoryService: () => (/* binding */ WorkspaceHistoryService),
/* harmony export */   resolveWorkspaceHistoryStore: () => (/* binding */ resolveWorkspaceHistoryStore)
/* harmony export */ });
/* harmony import */ var node_crypto__WEBPACK_IMPORTED_MODULE_0__ = __webpack_require__(/*! node:crypto */ "node:crypto");
/* harmony import */ var node_crypto__WEBPACK_IMPORTED_MODULE_0___default = /*#__PURE__*/__webpack_require__.n(node_crypto__WEBPACK_IMPORTED_MODULE_0__);
/* harmony import */ var node_fs__WEBPACK_IMPORTED_MODULE_1__ = __webpack_require__(/*! node:fs */ "node:fs");
/* harmony import */ var node_fs__WEBPACK_IMPORTED_MODULE_1___default = /*#__PURE__*/__webpack_require__.n(node_fs__WEBPACK_IMPORTED_MODULE_1__);
/* harmony import */ var node_os__WEBPACK_IMPORTED_MODULE_2__ = __webpack_require__(/*! node:os */ "node:os");
/* harmony import */ var node_os__WEBPACK_IMPORTED_MODULE_2___default = /*#__PURE__*/__webpack_require__.n(node_os__WEBPACK_IMPORTED_MODULE_2__);
/* harmony import */ var node_path__WEBPACK_IMPORTED_MODULE_3__ = __webpack_require__(/*! node:path */ "node:path");
/* harmony import */ var node_path__WEBPACK_IMPORTED_MODULE_3___default = /*#__PURE__*/__webpack_require__.n(node_path__WEBPACK_IMPORTED_MODULE_3__);
/* harmony import */ var _utils_js__WEBPACK_IMPORTED_MODULE_4__ = __webpack_require__(/*! ../utils.js */ "./src/utils.ts");
/* harmony import */ var _workspace_text_diff_js__WEBPACK_IMPORTED_MODULE_5__ = __webpack_require__(/*! ./workspace-text-diff.js */ "./src/services/workspace-text-diff.ts");






const STORE_FORMAT = 'authority-workspaces/v1';
const REF_JOURNAL_FORMAT = 'authority-workspace-ref-journal/v1';
const ROLLBACK_JOURNAL_FORMAT = 'authority-workspace-rollback-journal/v1';
const COMPLETED_ROLLBACK_FORMAT = 'authority-workspace-rollback-completed/v1';
const SYMLINK_FORMAT = 'authority-workspace-symlink/v1';
const OID_PATTERN = /^[a-f0-9]{64}$/;
const SAFE_NAME_PATTERN = /^[a-zA-Z0-9._-]+$/;
const DEFAULT_REF = 'main';
const DEFAULT_LOCK_TIMEOUT_MS = 15_000;
const DEFAULT_STALE_LOCK_MS = 30 * 60_000;
const EXCLUDED_SEGMENTS = new Set(['.git', 'node_modules']);
const MAX_FILE_DIFF_BYTES = 512 * 1024;
function resolveWorkspaceHistoryStore(dataRoot) {
    return node_path__WEBPACK_IMPORTED_MODULE_3___default().resolve(dataRoot, '_authority-global', 'authority', 'state', 'agent-workspaces');
}
class WorkspaceHistoryService {
    storeDir;
    now;
    lockTimeoutMs;
    staleLockMs;
    constructor(storeDir, options = {}) {
        this.storeDir = storeDir;
        this.storeDir = node_path__WEBPACK_IMPORTED_MODULE_3___default().resolve(storeDir);
        this.now = options.now ?? (() => new Date().toISOString());
        this.lockTimeoutMs = options.lockTimeoutMs ?? DEFAULT_LOCK_TIMEOUT_MS;
        this.staleLockMs = options.staleLockMs ?? DEFAULT_STALE_LOCK_MS;
    }
    async registerWorkspace(input) {
        return await this.withLock('registry', async () => {
            if (typeof input.rootPath !== 'string' || !input.rootPath.trim()) {
                throw validationError('Workspace rootPath is required');
            }
            if (input.id !== undefined && typeof input.id !== 'string') {
                throw validationError('Workspace id must be a string');
            }
            if (input.displayName !== undefined && typeof input.displayName !== 'string') {
                throw validationError('Workspace displayName must be a string');
            }
            if (input.defaultRef !== undefined && typeof input.defaultRef !== 'string') {
                throw validationError('Workspace defaultRef must be a string');
            }
            const allowedUserHandles = normalizeAllowedUserHandles(input.allowedUserHandles);
            const rootPath = this.resolveWorkspaceRoot(input.rootPath);
            const registry = this.readRegistry();
            const existingByRoot = registry.workspaces.find(workspace => samePath(workspace.rootPath, rootPath));
            if (existingByRoot) {
                if (input.allowedUserHandles !== undefined) {
                    existingByRoot.allowedUserHandles = allowedUserHandles;
                    existingByRoot.updatedAt = this.now();
                    this.writeRegistry(registry);
                }
                return this.withCurrentHead(existingByRoot);
            }
            const id = input.id?.trim() || node_crypto__WEBPACK_IMPORTED_MODULE_0___default().randomUUID();
            if (id.length > 128 || !isSafeName(id)) {
                throw validationError('Workspace id contains invalid characters');
            }
            if (registry.workspaces.some(workspace => workspace.id === id)) {
                throw workspaceConflict(`Workspace already exists: ${id}`);
            }
            const defaultRef = input.defaultRef?.trim() || DEFAULT_REF;
            if (defaultRef.length > 128 || !isSafeName(defaultRef)) {
                throw validationError('Workspace ref contains invalid characters');
            }
            const timestamp = this.now();
            const workspace = {
                id,
                displayName: input.displayName?.trim() || node_path__WEBPACK_IMPORTED_MODULE_3___default().basename(rootPath),
                rootPath,
                allowedUserHandles,
                defaultRef,
                headCommitId: null,
                createdAt: timestamp,
                updatedAt: timestamp,
            };
            this.writeRef({
                format: 'authority-workspace-ref/v1',
                workspaceId: id,
                name: defaultRef,
                head: null,
                generation: 0,
                updatedAt: timestamp,
            });
            registry.workspaces.push(workspace);
            registry.workspaces.sort((left, right) => left.id.localeCompare(right.id));
            this.writeRegistry(registry);
            return workspace;
        });
    }
    listWorkspaces() {
        return this.readRegistry().workspaces.map(workspace => this.withCurrentHead(workspace));
    }
    getWorkspace(workspaceId) {
        return this.withCurrentHead(this.getStoredWorkspace(workspaceId));
    }
    assertWorkspaceAccess(workspaceId, userHandle, isAdmin) {
        const workspace = this.getWorkspace(workspaceId);
        const normalizedUserHandle = userHandle.trim();
        if (!isAdmin && !workspace.allowedUserHandles.includes(normalizedUserHandle)) {
            throw new _utils_js__WEBPACK_IMPORTED_MODULE_4__.AuthorityServiceError(`Workspace not found: ${workspaceId}`, 404, 'validation_error', 'validation');
        }
        return workspace;
    }
    async checkpoint(workspaceId, request, actor) {
        return await this.withLock(`workspace-${workspaceId}`, async () => {
            this.assertNoPendingRollback(workspaceId);
            const workspace = this.getStoredWorkspace(workspaceId);
            this.recoverRefJournal(workspace);
            return this.checkpointLocked(workspace, request, actor);
        });
    }
    async runMutation(workspaceId, request, actor, mutate, hooks = {}) {
        return await this.withLock(`workspace-${workspaceId}`, async () => {
            this.assertNoPendingRollback(workspaceId);
            const workspace = this.getStoredWorkspace(workspaceId);
            this.recoverRefJournal(workspace);
            const { beforeMessage, afterMessage, failureMessage, ...checkpoint } = request;
            const before = this.checkpointLocked(workspace, {
                ...checkpoint,
                message: beforeMessage,
                metadata: { ...checkpoint.metadata, mutationPhase: 'before' },
            }, actor);
            await hooks.beforeCheckpoint?.(before);
            let value;
            try {
                value = await mutate();
            }
            catch (error) {
                try {
                    const failure = this.checkpointLocked(workspace, {
                        ...checkpoint,
                        message: failureMessage ?? `${afterMessage} (failed)`,
                        metadata: { ...checkpoint.metadata, mutationFailed: true, mutationPhase: 'failure' },
                    }, actor);
                    await hooks.failureCheckpoint?.(failure);
                }
                catch (checkpointError) {
                    throw new AggregateError([error, checkpointError], 'Workspace mutation and failure checkpoint both failed');
                }
                throw error;
            }
            const after = this.checkpointLocked(workspace, {
                ...checkpoint,
                message: afterMessage,
                metadata: { ...checkpoint.metadata, mutationPhase: 'after' },
            }, actor);
            await hooks.afterCheckpoint?.(after);
            return { value, before, after };
        });
    }
    listCommits(workspaceId, limit = 100) {
        if (!Number.isSafeInteger(limit) || limit < 1) {
            throw validationError('Workspace commit limit must be a positive integer');
        }
        const workspace = this.getStoredWorkspace(workspaceId);
        const ref = this.readRef(workspace);
        const commits = [];
        let nextId = ref.head;
        while (nextId && commits.length < limit) {
            const commit = this.readCommit(nextId, workspace.id);
            commits.push(commit);
            nextId = commit.parents[0] ?? null;
        }
        return commits;
    }
    findCommitsForToolCall(workspaceId, runId, toolCallId) {
        const workspace = this.getStoredWorkspace(workspaceId);
        const ref = this.readRef(workspace);
        const matches = [];
        const phases = new Set();
        const visited = new Set();
        let nextId = ref.head;
        while (nextId && !(phases.has('before') && (phases.has('after') || phases.has('failure')))) {
            if (visited.has(nextId))
                throw new Error(`Workspace commit cycle detected: ${nextId}`);
            visited.add(nextId);
            const commit = this.readCommit(nextId, workspace.id);
            if (commit.runId === runId && commit.toolCallId === toolCallId) {
                matches.push(commit);
                const phase = commit.metadata?.mutationPhase;
                if (phase === 'before' || phase === 'after' || phase === 'failure')
                    phases.add(phase);
            }
            nextId = commit.parents[0] ?? null;
        }
        return matches;
    }
    diff(workspaceId, fromCommitId, toCommitId) {
        const workspace = this.getStoredWorkspace(workspaceId);
        if ((fromCommitId !== null && !OID_PATTERN.test(fromCommitId)) || (toCommitId !== null && !OID_PATTERN.test(toCommitId))) {
            throw validationError('Workspace diff commit ids must be SHA-256 commit ids');
        }
        const before = fromCommitId ? this.loadCommitTree(this.readCommit(fromCommitId, workspace.id)) : emptyTree();
        const after = toCommitId ? this.loadCommitTree(this.readCommit(toCommitId, workspace.id)) : emptyTree();
        return {
            workspaceId,
            fromCommitId,
            toCommitId,
            entries: diffNodes(before, after),
        };
    }
    async diffFile(workspaceId, fromCommitId, toCommitId, requestedPath) {
        const relativePath = normalizeRelativePath(requestedPath);
        if (relativePath === '.') {
            throw validationError('Workspace file diff path must identify a file');
        }
        if ((fromCommitId !== null && !OID_PATTERN.test(fromCommitId))
            || (toCommitId !== null && toCommitId !== 'working' && !OID_PATTERN.test(toCommitId))) {
            throw validationError('Workspace file diff commit ids must be SHA-256 commit ids');
        }
        const createResponse = () => {
            const workspace = this.getStoredWorkspace(workspaceId);
            const beforeTree = fromCommitId
                ? this.loadCommitTree(this.readCommit(fromCommitId, workspace.id))
                : emptyTree();
            const before = exactTreeNode(beforeTree, relativePath);
            let after;
            let workingContent;
            let resolvedToCommitId;
            if (toCommitId === 'working') {
                this.recoverRefJournal(workspace);
                const captured = this.captureWorkingNodeForDiff(workspace, relativePath);
                after = captured?.node;
                workingContent = captured?.content;
                resolvedToCommitId = null;
            }
            else {
                const afterTree = toCommitId
                    ? this.loadCommitTree(this.readCommit(toCommitId, workspace.id))
                    : emptyTree();
                after = exactTreeNode(afterTree, relativePath);
                resolvedToCommitId = toCommitId;
            }
            if (toCommitId === 'working'
                && after?.kind === 'blob'
                && (after.sizeBytes ?? 0) > MAX_FILE_DIFF_BYTES) {
                const afterSize = after.sizeBytes;
                const beforeSize = before?.kind === 'blob' ? this.objectSize(before.oid) : undefined;
                const status = !before ? 'added'
                    : before.kind !== 'blob' ? 'type_changed'
                        : before.mode !== after.mode || beforeSize !== afterSize ? 'modified'
                            : 'unknown';
                return {
                    workspaceId,
                    path: relativePath,
                    status,
                    fromCommitId,
                    toCommitId: null,
                    toWorkingTree: true,
                    ...(before ? { beforeKind: before.kind } : {}),
                    afterKind: 'blob',
                    ...(beforeSize === undefined ? {} : { beforeSizeBytes: beforeSize }),
                    afterSizeBytes: afterSize,
                    kind: 'unavailable',
                    reason: 'file_too_large',
                    hunks: [],
                    truncated: false,
                };
            }
            const entries = [];
            diffNode(before, after, relativePath, entries);
            const entry = entries.find(item => item.path === relativePath);
            if (!entry) {
                throw validationError(`Workspace file is unchanged in the selected diff: ${relativePath}`);
            }
            const base = {
                workspaceId,
                path: relativePath,
                status: entry.status,
                fromCommitId,
                toCommitId: resolvedToCommitId,
                toWorkingTree: toCommitId === 'working',
                ...(entry.beforeKind ? { beforeKind: entry.beforeKind } : {}),
                ...(entry.afterKind ? { afterKind: entry.afterKind } : {}),
                ...(entry.beforeSizeBytes === undefined ? {} : { beforeSizeBytes: entry.beforeSizeBytes }),
                ...(entry.afterSizeBytes === undefined ? {} : { afterSizeBytes: entry.afterSizeBytes }),
            };
            if ((before && before.kind !== 'blob') || (after && after.kind !== 'blob')) {
                return { ...base, kind: 'unavailable', reason: 'unsupported_kind', hunks: [], truncated: false };
            }
            const beforeSize = before ? this.objectSize(before.oid) : 0;
            const afterSize = after
                ? toCommitId === 'working'
                    ? after.sizeBytes ?? 0
                    : this.objectSize(after.oid)
                : 0;
            const sizedBase = {
                ...base,
                ...(before ? { beforeSizeBytes: beforeSize } : {}),
                ...(after ? { afterSizeBytes: afterSize } : {}),
            };
            if (beforeSize > MAX_FILE_DIFF_BYTES || afterSize > MAX_FILE_DIFF_BYTES) {
                return { ...sizedBase, kind: 'unavailable', reason: 'file_too_large', hunks: [], truncated: false };
            }
            return {
                ...sizedBase,
                ...(0,_workspace_text_diff_js__WEBPACK_IMPORTED_MODULE_5__.createWorkspaceTextDiff)(before ? this.readObject(before.oid) : Buffer.alloc(0), after
                    ? toCommitId === 'working'
                        ? workingContent ?? Buffer.alloc(0)
                        : this.readObject(after.oid)
                    : Buffer.alloc(0)),
            };
        };
        return toCommitId === 'working'
            ? await this.withLock(`workspace-${workspaceId}`, async () => createResponse())
            : createResponse();
    }
    async status(workspaceId) {
        return await this.withLock(`workspace-${workspaceId}`, async () => {
            const workspace = this.getStoredWorkspace(workspaceId);
            this.recoverRefJournal(workspace);
            const ref = this.readRef(workspace);
            const head = ref.head ? this.readCommit(ref.head, workspace.id) : null;
            const trackedPaths = head ? trackedPathsFromCommit(head) : [];
            const expected = head ? scopeTree(this.loadCommitTree(head), trackedPaths) : emptyTree();
            const actual = this.captureTrackedWorkspace(workspace, trackedPaths, createObjectStats());
            const changes = diffNodes(expected, actual);
            const pending = this.readRollbackJournal(workspace.id);
            return {
                workspace: this.withCurrentHead(workspace),
                dirty: changes.length > 0,
                changes,
                pendingRollback: pending ? {
                    operationId: pending.operationId,
                    targetCommitId: pending.targetCommitId,
                    rollbackCommitId: pending.rollbackCommitId,
                    startedAt: pending.startedAt,
                } : null,
            };
        });
    }
    async rollback(workspaceId, request, actor) {
        return await this.withLock(`workspace-${workspaceId}`, async () => {
            if (typeof request.targetCommitId !== 'string' || !OID_PATTERN.test(request.targetCommitId)) {
                throw validationError('Rollback targetCommitId must be a SHA-256 commit id');
            }
            if (request.force !== undefined && typeof request.force !== 'boolean') {
                throw validationError('Rollback force must be a boolean');
            }
            if (request.message !== undefined && typeof request.message !== 'string') {
                throw validationError('Rollback message must be a string');
            }
            if (request.operationId !== undefined && typeof request.operationId !== 'string') {
                throw validationError('Rollback operationId must be a string');
            }
            const operationId = request.operationId || node_crypto__WEBPACK_IMPORTED_MODULE_0___default().randomUUID();
            if (operationId.length > 128 || !isSafeName(operationId)) {
                throw validationError('Rollback operationId contains invalid characters');
            }
            const workspace = this.getStoredWorkspace(workspaceId);
            this.recoverRefJournal(workspace);
            const completed = this.readCompletedRollback(workspace.id, operationId);
            if (completed) {
                if (completed.targetCommitId !== request.targetCommitId) {
                    throw workspaceConflict(`Rollback operation id was already used: ${operationId}`);
                }
                this.removeMatchingRollbackJournal(workspace.id, operationId);
                return this.completedRollbackResponse(workspace, completed);
            }
            const pending = this.readRollbackJournal(workspace.id);
            if (pending) {
                if (pending.operationId !== operationId || pending.targetCommitId !== request.targetCommitId) {
                    throw workspaceConflict(`Workspace rollback requires recovery: ${workspace.id}`);
                }
                return this.resumeRollbackLocked(workspace, pending);
            }
            const ref = this.readRef(workspace);
            const target = this.readCommit(request.targetCommitId, workspace.id);
            const head = ref.head ? this.readCommit(ref.head, workspace.id) : null;
            const headPaths = head ? trackedPathsFromCommit(head) : [];
            const restorePaths = trackedPathsFromCommit(target);
            const safetyPaths = minimizePaths([
                ...headPaths,
                ...restorePaths,
            ]);
            const expected = head ? scopeTree(this.loadCommitTree(head), headPaths) : emptyTree();
            const actualHead = this.captureTrackedWorkspace(workspace, headPaths, createObjectStats());
            const targetTree = scopeTree(this.loadCommitTree(target), restorePaths);
            const currentTree = this.captureTrackedWorkspace(workspace, restorePaths, createObjectStats());
            const dirtyChanges = mergeDiffEntries(diffNodes(expected, actualHead), diffNodes(currentTree, targetTree).filter(change => !isTrackedPath(change.path, headPaths)));
            if (dirtyChanges.length > 0 && request.force !== true) {
                throw workspaceConflict('Workspace differs from its current history head', dirtyChanges);
            }
            const stats = createObjectStats();
            const actual = this.captureTrackedWorkspace(workspace, safetyPaths, stats);
            const safetyCommit = this.createCommit({
                workspace,
                tree: this.finalizeTree(actual, stats),
                parents: ref.head ? [ref.head] : [],
                message: `Before rollback to ${target.id.slice(0, 12)}`,
                actor,
                metadata: { authorityTrackedPaths: safetyPaths, rollbackSafetyFor: target.id, operationId },
            });
            this.writeCommit(safetyCommit);
            const rollbackCommit = this.createCommit({
                workspace,
                tree: target.tree,
                parents: [safetyCommit.id],
                message: request.message?.trim() || `Rollback to ${target.id.slice(0, 12)}`,
                actor,
                metadata: { authorityTrackedPaths: restorePaths, rollbackOf: target.id, operationId },
            });
            this.writeCommit(rollbackCommit);
            const journal = {
                format: ROLLBACK_JOURNAL_FORMAT,
                workspaceId: workspace.id,
                operationId,
                targetCommitId: target.id,
                previousHead: ref.head,
                previousGeneration: ref.generation,
                safetyCommitId: safetyCommit.id,
                safetyGeneration: ref.generation + 1,
                rollbackCommitId: rollbackCommit.id,
                trackedPaths: safetyPaths,
                changedPaths: diffNodes(currentTree, targetTree).length,
                startedAt: this.now(),
            };
            (0,_utils_js__WEBPACK_IMPORTED_MODULE_4__.atomicWriteJson)(this.rollbackJournalPath(workspace.id), journal);
            return this.resumeRollbackLocked(workspace, journal);
        });
    }
    async resumeRollback(workspaceId) {
        return await this.withLock(`workspace-${workspaceId}`, async () => {
            const workspace = this.getStoredWorkspace(workspaceId);
            this.recoverRefJournal(workspace);
            const journal = this.readRollbackJournal(workspace.id);
            if (!journal) {
                throw validationError(`Workspace has no pending rollback: ${workspace.id}`);
            }
            const completed = this.readCompletedRollback(workspace.id, journal.operationId);
            if (completed) {
                this.removeRollbackJournal(workspace.id);
                return this.completedRollbackResponse(workspace, completed);
            }
            return this.resumeRollbackLocked(workspace, journal);
        });
    }
    resumeRollbackLocked(workspace, initialJournal) {
        let journal = initialJournal;
        const target = this.readCommit(journal.targetCommitId, workspace.id);
        let rollbackCommit = this.readCommit(journal.rollbackCommitId, workspace.id);
        let ref = this.readRef(workspace);
        if (ref.head === rollbackCommit.id && ref.generation === journal.safetyGeneration + 1) {
            return this.finishRollback(workspace, journal, rollbackCommit, []);
        }
        if (ref.head === journal.previousHead && ref.generation === journal.previousGeneration) {
            ref = this.publishRef(workspace, ref, journal.safetyCommitId);
        }
        else if (ref.head !== journal.safetyCommitId || ref.generation !== journal.safetyGeneration) {
            throw workspaceConflict('Pending rollback no longer matches the workspace head');
        }
        let stable = false;
        for (let attempt = 0; attempt < 3; attempt += 1) {
            const safetyCommit = this.readCommit(journal.safetyCommitId, workspace.id);
            const expectedSafety = scopeTree(this.loadCommitTree(safetyCommit), journal.trackedPaths);
            const actualSafety = this.captureTrackedWorkspace(workspace, journal.trackedPaths, createObjectStats());
            if (diffNodes(expectedSafety, actualSafety).length === 0) {
                stable = true;
                break;
            }
            if (attempt === 2) {
                break;
            }
            journal = this.restageRollbackSafety(workspace, journal, ref, actualSafety);
            rollbackCommit = this.readCommit(journal.rollbackCommitId, workspace.id);
            ref = this.publishRef(workspace, ref, journal.safetyCommitId);
        }
        if (!stable) {
            throw workspaceConflict('Workspace kept changing while preparing rollback; retry recovery when writes are idle');
        }
        const restorePaths = trackedPathsFromCommit(target);
        this.ensureWorkspaceRootForRollback(workspace);
        const currentTree = this.captureTrackedWorkspace(workspace, restorePaths, createObjectStats());
        const targetTree = scopeTree(this.loadCommitTree(target), restorePaths);
        const warnings = this.applyTree(workspace, currentTree, targetTree);
        this.publishRef(workspace, ref, rollbackCommit.id);
        return this.finishRollback(workspace, journal, rollbackCommit, warnings);
    }
    restageRollbackSafety(workspace, journal, ref, actual) {
        const previousSafety = this.readCommit(journal.safetyCommitId, workspace.id);
        const previousRollback = this.readCommit(journal.rollbackCommitId, workspace.id);
        const stats = createObjectStats();
        const safetyCommit = this.createCommit({
            workspace,
            tree: this.finalizeTree(actual, stats),
            parents: ref.head ? [ref.head] : [],
            message: previousSafety.message,
            actor: previousSafety.actor,
            ...(previousSafety.runId ? { runId: previousSafety.runId } : {}),
            ...(previousSafety.toolCallId ? { toolCallId: previousSafety.toolCallId } : {}),
            ...(previousSafety.metadata ? { metadata: previousSafety.metadata } : {}),
        });
        this.writeCommit(safetyCommit);
        const rollbackCommit = this.createCommit({
            workspace,
            tree: previousRollback.tree,
            parents: [safetyCommit.id],
            message: previousRollback.message,
            actor: previousRollback.actor,
            ...(previousRollback.runId ? { runId: previousRollback.runId } : {}),
            ...(previousRollback.toolCallId ? { toolCallId: previousRollback.toolCallId } : {}),
            ...(previousRollback.metadata ? { metadata: previousRollback.metadata } : {}),
        });
        this.writeCommit(rollbackCommit);
        const next = {
            ...journal,
            previousHead: ref.head,
            previousGeneration: ref.generation,
            safetyCommitId: safetyCommit.id,
            safetyGeneration: ref.generation + 1,
            rollbackCommitId: rollbackCommit.id,
        };
        (0,_utils_js__WEBPACK_IMPORTED_MODULE_4__.atomicWriteJson)(this.rollbackJournalPath(workspace.id), next);
        return next;
    }
    finishRollback(workspace, journal, rollbackCommit, warnings) {
        const completed = {
            format: COMPLETED_ROLLBACK_FORMAT,
            workspaceId: workspace.id,
            operationId: journal.operationId,
            targetCommitId: journal.targetCommitId,
            rollbackCommitId: rollbackCommit.id,
            changedPaths: journal.changedPaths,
            warnings,
            completedAt: this.now(),
        };
        this.writeCompletedRollback(completed);
        this.removeRollbackJournal(workspace.id);
        return this.completedRollbackResponse(workspace, completed);
    }
    completedRollbackResponse(workspace, completed) {
        return {
            operationId: completed.operationId,
            workspace: this.withCurrentHead(workspace),
            restoredCommitId: completed.targetCommitId,
            rollbackCommit: this.readCommit(completed.rollbackCommitId, workspace.id),
            changedPaths: completed.changedPaths,
            warnings: completed.warnings,
        };
    }
    checkpointLocked(workspace, request, actor) {
        if (typeof request.message !== 'string') {
            throw validationError('Checkpoint message is required');
        }
        if (request.paths !== undefined && (!Array.isArray(request.paths) || request.paths.some(entry => typeof entry !== 'string'))) {
            throw validationError('Checkpoint paths must be an array of strings');
        }
        if ((request.paths?.length ?? 0) > 1_000) {
            throw validationError('Checkpoint paths exceed the 1000 item limit');
        }
        if (request.metadata !== undefined && (!request.metadata || typeof request.metadata !== 'object' || Array.isArray(request.metadata))) {
            throw validationError('Checkpoint metadata must be an object');
        }
        if (request.runId !== undefined && typeof request.runId !== 'string') {
            throw validationError('Checkpoint runId must be a string');
        }
        if (request.toolCallId !== undefined && typeof request.toolCallId !== 'string') {
            throw validationError('Checkpoint toolCallId must be a string');
        }
        const message = request.message.trim();
        if (!message) {
            throw validationError('Checkpoint message is required');
        }
        if (message.length > 1_000) {
            throw validationError('Checkpoint message exceeds 1000 characters');
        }
        const ref = this.readRef(workspace);
        const parent = ref.head ? this.readCommit(ref.head, workspace.id) : null;
        let tree = parent ? this.loadCommitTree(parent) : emptyTree();
        const requestedPaths = normalizeRequestedPaths(request.paths);
        const trackedPaths = minimizePaths([
            ...(parent ? trackedPathsFromCommit(parent) : []),
            ...requestedPaths,
        ]);
        const stats = createObjectStats();
        for (const relativePath of requestedPaths) {
            const captured = this.capturePath(workspace, relativePath, stats);
            tree = setTreePath(tree, relativePath, captured);
        }
        const treeId = this.finalizeTree(tree, stats);
        const metadata = {
            ...(request.metadata ?? {}),
            authorityTrackedPaths: trackedPaths,
        };
        const commit = this.createCommit({
            workspace,
            tree: treeId,
            parents: ref.head ? [ref.head] : [],
            message,
            actor,
            ...(request.runId ? { runId: request.runId } : {}),
            ...(request.toolCallId ? { toolCallId: request.toolCallId } : {}),
            metadata,
        });
        this.writeCommit(commit);
        this.publishRef(workspace, ref, commit.id);
        return {
            workspace: this.withCurrentHead(workspace),
            commit,
            changedPaths: diffNodes(parent ? this.loadCommitTree(parent) : emptyTree(), tree).length,
            storedBytes: stats.storedBytes,
            reusedBytes: stats.reusedBytes,
        };
    }
    captureTrackedWorkspace(workspace, trackedPaths, stats) {
        try {
            this.assertWorkspaceRoot(workspace);
        }
        catch (error) {
            if (isFsError(error, 'ENOENT')) {
                return emptyTree();
            }
            throw error;
        }
        let tree = emptyTree();
        for (const relativePath of trackedPaths) {
            const captured = this.captureScopedPath(workspace, relativePath, stats);
            tree = captured.node
                ? setTreePath(tree, captured.path, captured.node)
                : ensureTreeAncestors(tree, relativePath);
        }
        return tree;
    }
    captureScopedPath(workspace, relativePath, stats) {
        if (relativePath === '.') {
            return { path: '.', node: this.scanNode(workspace, workspace.rootPath, '.', stats) };
        }
        const segments = relativePath.split('/');
        let absolutePath = workspace.rootPath;
        for (let index = 0; index < segments.length; index += 1) {
            absolutePath = node_path__WEBPACK_IMPORTED_MODULE_3___default().join(absolutePath, segments[index]);
            const currentPath = segments.slice(0, index + 1).join('/');
            if (this.isExcluded(workspace, currentPath, absolutePath)) {
                throw new Error(`Workspace history excludes path: ${currentPath}`);
            }
            let stat;
            try {
                stat = node_fs__WEBPACK_IMPORTED_MODULE_1___default().lstatSync(absolutePath);
            }
            catch (error) {
                if (isFsError(error, 'ENOENT') || isFsError(error, 'ENOTDIR')) {
                    return { path: relativePath };
                }
                throw error;
            }
            if (index === segments.length - 1 || !stat.isDirectory() || stat.isSymbolicLink()) {
                return { path: currentPath, node: this.scanNode(workspace, absolutePath, currentPath, stats) };
            }
        }
        return { path: relativePath };
    }
    capturePath(workspace, relativePath, stats) {
        const absolutePath = this.resolveSafeWorkspacePath(workspace, relativePath);
        if (this.isExcluded(workspace, relativePath, absolutePath)) {
            throw new Error(`Workspace history excludes path: ${relativePath}`);
        }
        try {
            return this.scanNode(workspace, absolutePath, relativePath, stats);
        }
        catch (error) {
            if (isFsError(error, 'ENOENT')) {
                return undefined;
            }
            throw error;
        }
    }
    captureWorkingNodeForDiff(workspace, relativePath) {
        const absolutePath = this.resolveSafeWorkspacePath(workspace, relativePath);
        if (this.isExcluded(workspace, relativePath, absolutePath)) {
            throw new Error(`Workspace history excludes path: ${relativePath}`);
        }
        try {
            const stat = node_fs__WEBPACK_IMPORTED_MODULE_1___default().lstatSync(absolutePath);
            const mode = stat.mode & 0o777;
            if (stat.isSymbolicLink()) {
                const payload = { format: SYMLINK_FORMAT, target: node_fs__WEBPACK_IMPORTED_MODULE_1___default().readlinkSync(absolutePath) };
                assertSameFile(stat, node_fs__WEBPACK_IMPORTED_MODULE_1___default().lstatSync(absolutePath), relativePath);
                const content = Buffer.from(canonicalJson(payload), 'utf8');
                return { node: { kind: 'symlink', mode, oid: sha256(content), sizeBytes: content.byteLength } };
            }
            if (stat.isFile()) {
                if (stat.size > MAX_FILE_DIFF_BYTES) {
                    assertSameFile(stat, node_fs__WEBPACK_IMPORTED_MODULE_1___default().lstatSync(absolutePath), relativePath);
                    const identity = Buffer.from(canonicalJson({
                        format: 'authority-working-large-file/v1',
                        device: String(stat.dev),
                        inode: String(stat.ino),
                        size: stat.size,
                        modifiedAtMs: stat.mtimeMs,
                    }), 'utf8');
                    return { node: { kind: 'blob', mode, oid: sha256(identity), sizeBytes: stat.size } };
                }
                const descriptor = node_fs__WEBPACK_IMPORTED_MODULE_1___default().openSync(absolutePath, (node_fs__WEBPACK_IMPORTED_MODULE_1___default().constants).O_RDONLY | ((node_fs__WEBPACK_IMPORTED_MODULE_1___default().constants).O_NOFOLLOW ?? 0));
                let content;
                try {
                    assertSameFile(stat, node_fs__WEBPACK_IMPORTED_MODULE_1___default().fstatSync(descriptor), relativePath);
                    content = node_fs__WEBPACK_IMPORTED_MODULE_1___default().readFileSync(descriptor);
                    assertSameFile(stat, node_fs__WEBPACK_IMPORTED_MODULE_1___default().fstatSync(descriptor), relativePath);
                }
                finally {
                    node_fs__WEBPACK_IMPORTED_MODULE_1___default().closeSync(descriptor);
                }
                assertSameFile(stat, node_fs__WEBPACK_IMPORTED_MODULE_1___default().lstatSync(absolutePath), relativePath);
                return {
                    node: { kind: 'blob', mode, oid: sha256(content), sizeBytes: stat.size },
                    content,
                };
            }
            if (stat.isDirectory()) {
                return { node: { kind: 'tree', mode, children: new Map() } };
            }
            throw new Error(`Unsupported workspace entry: ${relativePath}`);
        }
        catch (error) {
            if (isFsError(error, 'ENOENT') || isFsError(error, 'ENOTDIR')) {
                return undefined;
            }
            throw error;
        }
    }
    scanNode(workspace, absolutePath, relativePath, stats) {
        const stat = node_fs__WEBPACK_IMPORTED_MODULE_1___default().lstatSync(absolutePath);
        const mode = stat.mode & 0o777;
        if (stat.isSymbolicLink()) {
            const payload = { format: SYMLINK_FORMAT, target: node_fs__WEBPACK_IMPORTED_MODULE_1___default().readlinkSync(absolutePath) };
            assertSameFile(stat, node_fs__WEBPACK_IMPORTED_MODULE_1___default().lstatSync(absolutePath), relativePath);
            const object = Buffer.from(canonicalJson(payload), 'utf8');
            return { kind: 'symlink', mode, oid: this.writeObject(object, stats), sizeBytes: object.byteLength };
        }
        if (stat.isFile()) {
            const descriptor = node_fs__WEBPACK_IMPORTED_MODULE_1___default().openSync(absolutePath, (node_fs__WEBPACK_IMPORTED_MODULE_1___default().constants).O_RDONLY | ((node_fs__WEBPACK_IMPORTED_MODULE_1___default().constants).O_NOFOLLOW ?? 0));
            let content;
            try {
                assertSameFile(stat, node_fs__WEBPACK_IMPORTED_MODULE_1___default().fstatSync(descriptor), relativePath);
                content = node_fs__WEBPACK_IMPORTED_MODULE_1___default().readFileSync(descriptor);
                assertSameFile(stat, node_fs__WEBPACK_IMPORTED_MODULE_1___default().fstatSync(descriptor), relativePath);
            }
            finally {
                node_fs__WEBPACK_IMPORTED_MODULE_1___default().closeSync(descriptor);
            }
            return { kind: 'blob', mode, oid: this.writeObject(content, stats), sizeBytes: content.byteLength };
        }
        if (!stat.isDirectory()) {
            throw new Error(`Unsupported workspace entry: ${relativePath}`);
        }
        const children = new Map();
        const childKeys = new Set();
        const entries = node_fs__WEBPACK_IMPORTED_MODULE_1___default().readdirSync(absolutePath, { withFileTypes: true })
            .sort((left, right) => left.name.localeCompare(right.name));
        for (const entry of entries) {
            validateEntryName(entry.name);
            const childKey = fileNameKey(entry.name);
            if (childKeys.has(childKey)) {
                throw new Error(`Workspace contains colliding names: ${relativePath}/${entry.name}`);
            }
            childKeys.add(childKey);
            const childRelative = relativePath === '.' ? entry.name : `${relativePath}/${entry.name}`;
            const childAbsolute = node_path__WEBPACK_IMPORTED_MODULE_3___default().join(absolutePath, entry.name);
            if (this.isExcluded(workspace, childRelative, childAbsolute)) {
                continue;
            }
            children.set(entry.name, this.scanNode(workspace, childAbsolute, childRelative, stats));
        }
        assertSameFile(stat, node_fs__WEBPACK_IMPORTED_MODULE_1___default().lstatSync(absolutePath), relativePath);
        return { kind: 'tree', mode, children };
    }
    finalizeTree(tree, stats) {
        return this.finalizeNode(tree, stats);
    }
    finalizeNode(node, stats) {
        if (node.kind !== 'tree') {
            return node.oid;
        }
        if (node.oid) {
            return node.oid;
        }
        const entries = [...node.children.entries()]
            .sort(([left], [right]) => left.localeCompare(right))
            .map(([name, child]) => ({
            name,
            kind: child.kind,
            oid: this.finalizeNode(child, stats),
            mode: child.mode,
            ...(child.kind !== 'tree' && child.sizeBytes !== undefined ? { sizeBytes: child.sizeBytes } : {}),
        }));
        const treeObject = { format: 'authority-workspace-tree/v1', entries };
        node.oid = this.writeObject(Buffer.from(canonicalJson(treeObject), 'utf8'), stats);
        return node.oid;
    }
    loadCommitTree(commit) {
        return this.loadTree(commit.tree, new Set());
    }
    loadTree(oid, ancestors) {
        if (ancestors.has(oid)) {
            throw new Error(`Workspace tree cycle detected at ${oid}`);
        }
        const nextAncestors = new Set(ancestors);
        nextAncestors.add(oid);
        const value = parseJson(this.readObject(oid).toString('utf8'), `tree object ${oid}`);
        if (value.format !== 'authority-workspace-tree/v1' || !Array.isArray(value.entries)) {
            throw new Error(`Invalid workspace tree object: ${oid}`);
        }
        const children = new Map();
        const childKeys = new Set();
        for (const entry of value.entries) {
            validateTreeEntry(entry);
            const childKey = fileNameKey(entry.name);
            if (childKeys.has(childKey)) {
                throw new Error(`Duplicate workspace tree entry: ${entry.name}`);
            }
            childKeys.add(childKey);
            if (entry.kind === 'tree') {
                const childTree = this.loadTree(entry.oid, nextAncestors);
                childTree.mode = entry.mode;
                children.set(entry.name, childTree);
            }
            else {
                children.set(entry.name, {
                    kind: entry.kind,
                    mode: entry.mode,
                    oid: entry.oid,
                    ...(entry.sizeBytes === undefined ? {} : { sizeBytes: entry.sizeBytes }),
                });
            }
        }
        return { kind: 'tree', mode: 0o755, oid, children };
    }
    applyTree(workspace, current, target) {
        // ponytail: Node has no portable openat/renameat; use native dirfd operations if hostile same-account path swaps enter the threat model.
        const warnings = [];
        for (const name of childNames(current, target)) {
            this.applyNode(workspace, name, getTreeChild(current, name), getTreeChild(target, name), warnings);
        }
        return warnings;
    }
    applyNode(workspace, relativePath, current, target, warnings) {
        if (nodesEqual(current, target)) {
            return;
        }
        this.assertWorkspaceNodeUnchanged(workspace, relativePath, current);
        const absolutePath = this.resolveSafeWorkspacePath(workspace, relativePath);
        if (!target) {
            this.removeWorkspaceNode(workspace, relativePath, current, warnings);
            return;
        }
        if (current?.kind === 'tree' && target.kind === 'tree') {
            (0,_utils_js__WEBPACK_IMPORTED_MODULE_4__.ensureDir)(absolutePath);
            this.assertWorkspaceDirectory(workspace, relativePath);
            for (const name of childNames(current, target)) {
                this.applyNode(workspace, `${relativePath}/${name}`, getTreeChild(current, name), getTreeChild(target, name), warnings);
            }
            if (!target.synthetic) {
                applyMode(absolutePath, target.mode);
            }
            return;
        }
        if (current) {
            this.removeWorkspaceNode(workspace, relativePath, current, warnings);
        }
        ;(0,_utils_js__WEBPACK_IMPORTED_MODULE_4__.ensureDir)(node_path__WEBPACK_IMPORTED_MODULE_3___default().dirname(absolutePath));
        this.resolveSafeWorkspacePath(workspace, relativePath);
        if (target.kind === 'tree') {
            (0,_utils_js__WEBPACK_IMPORTED_MODULE_4__.ensureDir)(absolutePath);
            this.assertWorkspaceDirectory(workspace, relativePath);
            for (const [name, child] of [...target.children.entries()].sort(([left], [right]) => left.localeCompare(right))) {
                this.applyNode(workspace, `${relativePath}/${name}`, undefined, child, warnings);
            }
            if (!target.synthetic) {
                applyMode(absolutePath, target.mode);
            }
            return;
        }
        if (target.kind === 'blob') {
            this.assertWorkspaceNodeUnchanged(workspace, relativePath, undefined);
            (0,_utils_js__WEBPACK_IMPORTED_MODULE_4__.atomicWriteFile)(absolutePath, this.readObject(target.oid));
            applyMode(absolutePath, target.mode);
            return;
        }
        const symlink = parseJson(this.readObject(target.oid).toString('utf8'), `symlink object ${target.oid}`);
        if (symlink.format !== SYMLINK_FORMAT || typeof symlink.target !== 'string' || symlink.target.includes('\0')) {
            throw new Error(`Invalid workspace symlink object: ${target.oid}`);
        }
        try {
            this.assertWorkspaceNodeUnchanged(workspace, relativePath, undefined);
            node_fs__WEBPACK_IMPORTED_MODULE_1___default().symlinkSync(symlink.target, absolutePath);
        }
        catch (error) {
            warnings.push(`Could not restore symlink ${relativePath}: ${error instanceof Error ? error.message : String(error)}`);
            throw error;
        }
    }
    removeWorkspaceNode(workspace, relativePath, current, warnings) {
        if (!current) {
            return;
        }
        this.assertWorkspaceNodeUnchanged(workspace, relativePath, current);
        const absolutePath = this.resolveSafeWorkspacePath(workspace, relativePath);
        if (!(0,_utils_js__WEBPACK_IMPORTED_MODULE_4__.isPathInside)(workspace.rootPath, absolutePath) || samePath(workspace.rootPath, absolutePath)) {
            throw new Error(`Refusing to remove path outside workspace: ${absolutePath}`);
        }
        if (current.kind !== 'tree') {
            node_fs__WEBPACK_IMPORTED_MODULE_1___default().rmSync(absolutePath, { force: true });
            return;
        }
        for (const [name, child] of [...current.children.entries()].sort(([left], [right]) => left.localeCompare(right))) {
            this.removeWorkspaceNode(workspace, `${relativePath}/${name}`, child, warnings);
        }
        try {
            node_fs__WEBPACK_IMPORTED_MODULE_1___default().rmdirSync(absolutePath);
        }
        catch (error) {
            if (isFsError(error, 'ENOENT')) {
                return;
            }
            if (isFsError(error, 'ENOTEMPTY') || isFsError(error, 'EEXIST')) {
                warnings.push(`Preserved non-empty directory outside the tracked snapshot: ${relativePath}`);
                return;
            }
            throw error;
        }
    }
    assertWorkspaceNodeUnchanged(workspace, relativePath, expected) {
        if (expected?.kind === 'tree') {
            this.assertWorkspaceDirectory(workspace, relativePath, expected.synthetic ? undefined : expected.mode);
            return;
        }
        let actual;
        try {
            actual = this.capturePath(workspace, relativePath, createObjectStats());
        }
        catch (error) {
            if (isFsError(error, 'ENOTDIR')) {
                actual = undefined;
            }
            else {
                throw error;
            }
        }
        if (!nodesEqual(expected, actual)) {
            throw workspaceConflict(`Workspace path changed while rollback was applying: ${relativePath}`);
        }
    }
    assertWorkspaceDirectory(workspace, relativePath, expectedMode) {
        const absolutePath = this.resolveSafeWorkspacePath(workspace, relativePath);
        const stat = node_fs__WEBPACK_IMPORTED_MODULE_1___default().lstatSync(absolutePath);
        if (stat.isSymbolicLink() || !stat.isDirectory() || (expectedMode !== undefined && (stat.mode & 0o777) !== expectedMode)) {
            throw workspaceConflict(`Workspace directory changed while rollback was applying: ${relativePath}`);
        }
    }
    resolveSafeWorkspacePath(workspace, relativePath) {
        this.assertWorkspaceRoot(workspace);
        const normalized = normalizeRelativePath(relativePath);
        const absolutePath = normalized === '.'
            ? workspace.rootPath
            : node_path__WEBPACK_IMPORTED_MODULE_3___default().resolve(workspace.rootPath, ...normalized.split('/'));
        if (!(0,_utils_js__WEBPACK_IMPORTED_MODULE_4__.isPathInside)(workspace.rootPath, absolutePath)) {
            throw new Error(`Path escapes workspace: ${relativePath}`);
        }
        if (normalized === '.') {
            return absolutePath;
        }
        let current = workspace.rootPath;
        const segments = normalized.split('/');
        for (const segment of segments.slice(0, -1)) {
            current = node_path__WEBPACK_IMPORTED_MODULE_3___default().join(current, segment);
            try {
                if (node_fs__WEBPACK_IMPORTED_MODULE_1___default().lstatSync(current).isSymbolicLink()) {
                    throw new Error(`Path traverses a symlink: ${relativePath}`);
                }
            }
            catch (error) {
                if (isFsError(error, 'ENOENT')) {
                    break;
                }
                throw error;
            }
        }
        return absolutePath;
    }
    assertWorkspaceRoot(workspace) {
        const stat = node_fs__WEBPACK_IMPORTED_MODULE_1___default().lstatSync(workspace.rootPath);
        if (!stat.isDirectory() || stat.isSymbolicLink() || !samePath(node_fs__WEBPACK_IMPORTED_MODULE_1___default().realpathSync.native(workspace.rootPath), workspace.rootPath)) {
            throw new Error(`Workspace root changed or is no longer a real directory: ${workspace.rootPath}`);
        }
    }
    ensureWorkspaceRootForRollback(workspace) {
        try {
            this.assertWorkspaceRoot(workspace);
            return;
        }
        catch (error) {
            if (!isFsError(error, 'ENOENT')) {
                throw error;
            }
        }
        const parent = node_path__WEBPACK_IMPORTED_MODULE_3___default().dirname(workspace.rootPath);
        const parentStat = node_fs__WEBPACK_IMPORTED_MODULE_1___default().lstatSync(parent);
        if (!parentStat.isDirectory() || parentStat.isSymbolicLink() || !samePath(node_fs__WEBPACK_IMPORTED_MODULE_1___default().realpathSync.native(parent), parent)) {
            throw workspaceConflict(`Cannot recreate workspace root because its parent changed: ${parent}`);
        }
        try {
            node_fs__WEBPACK_IMPORTED_MODULE_1___default().mkdirSync(workspace.rootPath);
        }
        catch (error) {
            if (!isFsError(error, 'EEXIST')) {
                throw error;
            }
        }
        this.assertWorkspaceRoot(workspace);
    }
    isExcluded(workspace, relativePath, absolutePath) {
        const segments = relativePath === '.' ? [] : relativePath.split('/');
        return segments.some(segment => EXCLUDED_SEGMENTS.has(process.platform === 'win32' ? segment.toLowerCase() : segment))
            || samePath(absolutePath, this.storeDir)
            || (0,_utils_js__WEBPACK_IMPORTED_MODULE_4__.isPathInside)(this.storeDir, absolutePath);
    }
    createCommit(input) {
        const unsigned = {
            format: 'authority-workspace-commit/v1',
            workspaceId: input.workspace.id,
            tree: input.tree,
            parents: input.parents,
            message: input.message,
            createdAt: this.now(),
            actor: input.actor,
            ...(input.runId ? { runId: input.runId } : {}),
            ...(input.toolCallId ? { toolCallId: input.toolCallId } : {}),
            ...(input.metadata ? { metadata: input.metadata } : {}),
        };
        return { ...unsigned, id: sha256(Buffer.from(canonicalJson(unsigned), 'utf8')) };
    }
    writeCommit(commit) {
        const filePath = this.commitPath(commit.id);
        if (node_fs__WEBPACK_IMPORTED_MODULE_1___default().existsSync(filePath)) {
            this.readCommit(commit.id, commit.workspaceId);
            return;
        }
        ;(0,_utils_js__WEBPACK_IMPORTED_MODULE_4__.atomicWriteJson)(filePath, commit);
    }
    readCommit(commitId, workspaceId) {
        assertOid(commitId);
        const filePath = this.commitPath(commitId);
        if (!node_fs__WEBPACK_IMPORTED_MODULE_1___default().existsSync(filePath)) {
            throw new Error(`Workspace commit not found: ${commitId}`);
        }
        const commit = parseJson(node_fs__WEBPACK_IMPORTED_MODULE_1___default().readFileSync(filePath, 'utf8'), `commit ${commitId}`);
        if (commit.format !== 'authority-workspace-commit/v1' || commit.id !== commitId || !Array.isArray(commit.parents)) {
            throw new Error(`Invalid workspace commit: ${commitId}`);
        }
        assertOid(commit.tree);
        for (const parent of commit.parents) {
            assertOid(parent);
        }
        if (workspaceId && commit.workspaceId !== workspaceId) {
            throw new Error(`Commit ${commitId} belongs to another workspace`);
        }
        const { id: _id, ...unsigned } = commit;
        if (sha256(Buffer.from(canonicalJson(unsigned), 'utf8')) !== commitId) {
            throw new Error(`Workspace commit hash mismatch: ${commitId}`);
        }
        return commit;
    }
    writeObject(content, stats) {
        const oid = sha256(content);
        const filePath = this.objectPath(oid);
        if (node_fs__WEBPACK_IMPORTED_MODULE_1___default().existsSync(filePath)) {
            stats.reusedBytes += content.byteLength;
            return oid;
        }
        ;(0,_utils_js__WEBPACK_IMPORTED_MODULE_4__.atomicWriteFile)(filePath, content);
        stats.storedBytes += content.byteLength;
        return oid;
    }
    readObject(oid) {
        assertOid(oid);
        const filePath = this.objectPath(oid);
        if (!node_fs__WEBPACK_IMPORTED_MODULE_1___default().existsSync(filePath)) {
            throw new Error(`Workspace object not found: ${oid}`);
        }
        const content = node_fs__WEBPACK_IMPORTED_MODULE_1___default().readFileSync(filePath);
        if (sha256(content) !== oid) {
            throw new Error(`Workspace object hash mismatch: ${oid}`);
        }
        return content;
    }
    objectSize(oid) {
        assertOid(oid);
        const filePath = this.objectPath(oid);
        if (!node_fs__WEBPACK_IMPORTED_MODULE_1___default().existsSync(filePath)) {
            throw new Error(`Workspace object not found: ${oid}`);
        }
        return node_fs__WEBPACK_IMPORTED_MODULE_1___default().statSync(filePath).size;
    }
    publishRef(workspace, expected, head) {
        const current = this.readRef(workspace);
        if (current.generation !== expected.generation || current.head !== expected.head) {
            throw workspaceConflict(`Workspace ref changed while updating ${workspace.id}`);
        }
        const next = {
            ...current,
            head,
            generation: current.generation + 1,
            updatedAt: this.now(),
        };
        const journal = {
            format: REF_JOURNAL_FORMAT,
            workspaceId: workspace.id,
            expectedGeneration: current.generation,
            next,
            createdAt: this.now(),
        };
        (0,_utils_js__WEBPACK_IMPORTED_MODULE_4__.atomicWriteJson)(this.refJournalPath(workspace.id), journal);
        this.writeRef(next);
        node_fs__WEBPACK_IMPORTED_MODULE_1___default().rmSync(this.refJournalPath(workspace.id), { force: true });
        return next;
    }
    recoverRefJournal(workspace) {
        const filePath = this.refJournalPath(workspace.id);
        if (!node_fs__WEBPACK_IMPORTED_MODULE_1___default().existsSync(filePath)) {
            return;
        }
        const journal = parseJson(node_fs__WEBPACK_IMPORTED_MODULE_1___default().readFileSync(filePath, 'utf8'), `ref journal ${workspace.id}`);
        if (journal.format !== REF_JOURNAL_FORMAT || journal.workspaceId !== workspace.id) {
            throw new Error(`Invalid workspace ref journal: ${workspace.id}`);
        }
        if (journal.next.format !== 'authority-workspace-ref/v1'
            || journal.next.workspaceId !== workspace.id
            || journal.next.name !== workspace.defaultRef
            || journal.next.generation !== journal.expectedGeneration + 1
            || !OID_PATTERN.test(journal.next.head ?? '')) {
            throw new Error(`Invalid workspace ref journal target: ${workspace.id}`);
        }
        const current = this.readRef(workspace);
        if (current.generation === journal.expectedGeneration) {
            this.writeRef(journal.next);
        }
        else if (current.generation === journal.next.generation && current.head !== journal.next.head) {
            throw workspaceConflict(`Workspace ref journal conflicts with current head: ${workspace.id}`);
        }
        else if (current.generation < journal.next.generation) {
            throw workspaceConflict(`Workspace ref generation moved backwards: ${workspace.id}`);
        }
        node_fs__WEBPACK_IMPORTED_MODULE_1___default().rmSync(filePath, { force: true });
    }
    readRef(workspace) {
        const filePath = this.refPath(workspace.id, workspace.defaultRef);
        if (!node_fs__WEBPACK_IMPORTED_MODULE_1___default().existsSync(filePath)) {
            return {
                format: 'authority-workspace-ref/v1',
                workspaceId: workspace.id,
                name: workspace.defaultRef,
                head: null,
                generation: 0,
                updatedAt: workspace.createdAt,
            };
        }
        const ref = parseJson(node_fs__WEBPACK_IMPORTED_MODULE_1___default().readFileSync(filePath, 'utf8'), `workspace ref ${workspace.id}`);
        if (ref.format !== 'authority-workspace-ref/v1'
            || ref.workspaceId !== workspace.id
            || ref.name !== workspace.defaultRef
            || !Number.isSafeInteger(ref.generation)
            || ref.generation < 0
            || (ref.head !== null && !OID_PATTERN.test(ref.head))) {
            throw new Error(`Invalid workspace ref: ${workspace.id}`);
        }
        return ref;
    }
    writeRef(ref) {
        ;(0,_utils_js__WEBPACK_IMPORTED_MODULE_4__.atomicWriteJson)(this.refPath(ref.workspaceId, ref.name), ref);
    }
    readRegistry() {
        this.ensureStore();
        const filePath = this.registryPath();
        if (!node_fs__WEBPACK_IMPORTED_MODULE_1___default().existsSync(filePath)) {
            return { format: STORE_FORMAT, workspaces: [] };
        }
        const registry = parseJson(node_fs__WEBPACK_IMPORTED_MODULE_1___default().readFileSync(filePath, 'utf8'), 'workspace registry');
        if (registry.format !== STORE_FORMAT || !Array.isArray(registry.workspaces)) {
            throw new Error('Invalid workspace registry');
        }
        for (const workspace of registry.workspaces) {
            if (workspace.allowedUserHandles === undefined) {
                workspace.allowedUserHandles = [];
            }
            validateWorkspaceRecord(workspace);
        }
        return registry;
    }
    writeRegistry(registry) {
        ;(0,_utils_js__WEBPACK_IMPORTED_MODULE_4__.atomicWriteJson)(this.registryPath(), registry);
    }
    getStoredWorkspace(workspaceId) {
        if (workspaceId.length > 128 || !isSafeName(workspaceId)) {
            throw validationError('Workspace id contains invalid characters');
        }
        const workspace = this.readRegistry().workspaces.find(entry => entry.id === workspaceId);
        if (!workspace) {
            throw new _utils_js__WEBPACK_IMPORTED_MODULE_4__.AuthorityServiceError(`Workspace not found: ${workspaceId}`, 404, 'validation_error', 'validation');
        }
        return workspace;
    }
    withCurrentHead(workspace) {
        const ref = this.readRef(workspace);
        return { ...workspace, headCommitId: ref.head, updatedAt: ref.updatedAt };
    }
    resolveWorkspaceRoot(rootPath) {
        const resolved = node_path__WEBPACK_IMPORTED_MODULE_3___default().resolve(rootPath);
        let stat;
        try {
            stat = node_fs__WEBPACK_IMPORTED_MODULE_1___default().statSync(resolved);
        }
        catch (error) {
            if (isFsError(error, 'ENOENT')) {
                throw validationError(`Workspace root does not exist: ${resolved}`);
            }
            throw error;
        }
        if (!stat.isDirectory()) {
            throw validationError(`Workspace root is not a directory: ${resolved}`);
        }
        return node_fs__WEBPACK_IMPORTED_MODULE_1___default().realpathSync.native(resolved);
    }
    readRollbackJournal(workspaceId) {
        const filePath = this.rollbackJournalPath(workspaceId);
        if (!node_fs__WEBPACK_IMPORTED_MODULE_1___default().existsSync(filePath)) {
            return null;
        }
        const journal = parseJson(node_fs__WEBPACK_IMPORTED_MODULE_1___default().readFileSync(filePath, 'utf8'), `rollback journal ${workspaceId}`);
        if (journal.format !== ROLLBACK_JOURNAL_FORMAT
            || journal.workspaceId !== workspaceId
            || typeof journal.operationId !== 'string'
            || !OID_PATTERN.test(journal.targetCommitId)
            || (journal.previousHead !== null && !OID_PATTERN.test(journal.previousHead))
            || !Number.isSafeInteger(journal.previousGeneration)
            || journal.previousGeneration < 0
            || !OID_PATTERN.test(journal.safetyCommitId)
            || journal.safetyGeneration !== journal.previousGeneration + 1
            || !OID_PATTERN.test(journal.rollbackCommitId)
            || !Array.isArray(journal.trackedPaths)
            || journal.trackedPaths.some(entry => typeof entry !== 'string')
            || !Number.isSafeInteger(journal.changedPaths)
            || journal.changedPaths < 0
            || typeof journal.startedAt !== 'string') {
            throw new Error(`Invalid workspace rollback journal: ${workspaceId}`);
        }
        assertSafeName(journal.operationId, 'rollback operation id');
        return journal;
    }
    readCompletedRollback(workspaceId, operationId) {
        const filePath = this.completedRollbackPath(workspaceId, operationId);
        if (!node_fs__WEBPACK_IMPORTED_MODULE_1___default().existsSync(filePath)) {
            return null;
        }
        const completed = parseJson(node_fs__WEBPACK_IMPORTED_MODULE_1___default().readFileSync(filePath, 'utf8'), `completed rollback ${workspaceId}/${operationId}`);
        if (completed.format !== COMPLETED_ROLLBACK_FORMAT
            || completed.workspaceId !== workspaceId
            || completed.operationId !== operationId
            || !OID_PATTERN.test(completed.targetCommitId)
            || !OID_PATTERN.test(completed.rollbackCommitId)
            || !Number.isSafeInteger(completed.changedPaths)
            || completed.changedPaths < 0
            || !Array.isArray(completed.warnings)
            || completed.warnings.some(entry => typeof entry !== 'string')
            || typeof completed.completedAt !== 'string') {
            throw new Error(`Invalid completed rollback: ${workspaceId}/${operationId}`);
        }
        return completed;
    }
    writeCompletedRollback(completed) {
        const filePath = this.completedRollbackPath(completed.workspaceId, completed.operationId);
        if (node_fs__WEBPACK_IMPORTED_MODULE_1___default().existsSync(filePath)) {
            const existing = this.readCompletedRollback(completed.workspaceId, completed.operationId);
            if (canonicalJson(existing) !== canonicalJson(completed)) {
                throw workspaceConflict(`Rollback operation id was already used: ${completed.operationId}`);
            }
            return;
        }
        ;(0,_utils_js__WEBPACK_IMPORTED_MODULE_4__.atomicWriteJson)(filePath, completed);
    }
    removeMatchingRollbackJournal(workspaceId, operationId) {
        const journal = this.readRollbackJournal(workspaceId);
        if (journal?.operationId === operationId) {
            this.removeRollbackJournal(workspaceId);
        }
    }
    assertNoPendingRollback(workspaceId) {
        if (this.readRollbackJournal(workspaceId)) {
            throw workspaceConflict(`Workspace rollback requires recovery: ${workspaceId}`);
        }
    }
    removeRollbackJournal(workspaceId) {
        node_fs__WEBPACK_IMPORTED_MODULE_1___default().rmSync(this.rollbackJournalPath(workspaceId), { force: true });
    }
    ensureStore() {
        for (const dir of ['objects', 'commits', 'refs', 'journals', 'rollbacks', 'operations', 'locks']) {
            ;(0,_utils_js__WEBPACK_IMPORTED_MODULE_4__.ensureDir)(node_path__WEBPACK_IMPORTED_MODULE_3___default().join(this.storeDir, dir));
        }
    }
    registryPath() {
        return node_path__WEBPACK_IMPORTED_MODULE_3___default().join(this.storeDir, 'workspaces.json');
    }
    objectPath(oid) {
        assertOid(oid);
        return node_path__WEBPACK_IMPORTED_MODULE_3___default().join(this.storeDir, 'objects', oid);
    }
    commitPath(commitId) {
        assertOid(commitId);
        return node_path__WEBPACK_IMPORTED_MODULE_3___default().join(this.storeDir, 'commits', `${commitId}.json`);
    }
    refPath(workspaceId, refName) {
        assertSafeName(workspaceId, 'workspace id');
        assertSafeName(refName, 'workspace ref');
        return node_path__WEBPACK_IMPORTED_MODULE_3___default().join(this.storeDir, 'refs', workspaceId, `${refName}.json`);
    }
    refJournalPath(workspaceId) {
        assertSafeName(workspaceId, 'workspace id');
        return node_path__WEBPACK_IMPORTED_MODULE_3___default().join(this.storeDir, 'journals', `${workspaceId}.json`);
    }
    rollbackJournalPath(workspaceId) {
        assertSafeName(workspaceId, 'workspace id');
        return node_path__WEBPACK_IMPORTED_MODULE_3___default().join(this.storeDir, 'rollbacks', `${workspaceId}.json`);
    }
    completedRollbackPath(workspaceId, operationId) {
        assertSafeName(workspaceId, 'workspace id');
        assertSafeName(operationId, 'rollback operation id');
        return node_path__WEBPACK_IMPORTED_MODULE_3___default().join(this.storeDir, 'operations', workspaceId, `${operationId}.json`);
    }
    async withLock(name, run) {
        this.ensureStore();
        assertSafeName(name, 'lock name');
        const lockPath = node_path__WEBPACK_IMPORTED_MODULE_3___default().join(this.storeDir, 'locks', `${name}.lock`);
        const token = node_crypto__WEBPACK_IMPORTED_MODULE_0___default().randomUUID();
        const deadline = Date.now() + this.lockTimeoutMs;
        while (true) {
            try {
                const descriptor = node_fs__WEBPACK_IMPORTED_MODULE_1___default().openSync(lockPath, 'wx');
                try {
                    const lock = { token, pid: process.pid, hostname: node_os__WEBPACK_IMPORTED_MODULE_2___default().hostname(), createdAt: Date.now() };
                    node_fs__WEBPACK_IMPORTED_MODULE_1___default().writeFileSync(descriptor, JSON.stringify(lock));
                    node_fs__WEBPACK_IMPORTED_MODULE_1___default().fsyncSync(descriptor);
                }
                finally {
                    node_fs__WEBPACK_IMPORTED_MODULE_1___default().closeSync(descriptor);
                }
                break;
            }
            catch (error) {
                if (!isFsError(error, 'EEXIST')) {
                    throw error;
                }
                if (this.isStaleLock(lockPath) && this.claimStaleLock(lockPath)) {
                    continue;
                }
                if (Date.now() >= deadline) {
                    throw new Error(`Timed out waiting for workspace history lock: ${name}`);
                }
                await delay(50);
            }
        }
        try {
            return await run();
        }
        finally {
            this.releaseOwnedLock(lockPath, token);
        }
    }
    isStaleLock(lockPath) {
        try {
            const lock = parseJson(node_fs__WEBPACK_IMPORTED_MODULE_1___default().readFileSync(lockPath, 'utf8'), 'workspace lock');
            if (lock.hostname === node_os__WEBPACK_IMPORTED_MODULE_2___default().hostname() && Number.isSafeInteger(lock.pid)) {
                return !isProcessAlive(lock.pid);
            }
            if (typeof lock.hostname === 'string' && lock.hostname) {
                return false;
            }
            return Date.now() - Number(lock.createdAt ?? node_fs__WEBPACK_IMPORTED_MODULE_1___default().statSync(lockPath).mtimeMs) > this.staleLockMs;
        }
        catch {
            try {
                return Date.now() - node_fs__WEBPACK_IMPORTED_MODULE_1___default().statSync(lockPath).mtimeMs > this.staleLockMs;
            }
            catch {
                return false;
            }
        }
    }
    claimStaleLock(lockPath) {
        const claimedPath = `${lockPath}.${node_crypto__WEBPACK_IMPORTED_MODULE_0___default().randomUUID()}.stale`;
        try {
            node_fs__WEBPACK_IMPORTED_MODULE_1___default().renameSync(lockPath, claimedPath);
            node_fs__WEBPACK_IMPORTED_MODULE_1___default().rmSync(claimedPath, { force: true });
            return true;
        }
        catch (error) {
            node_fs__WEBPACK_IMPORTED_MODULE_1___default().rmSync(claimedPath, { force: true });
            if (isFsError(error, 'ENOENT') || isFsError(error, 'EACCES') || isFsError(error, 'EPERM')) {
                return false;
            }
            throw error;
        }
    }
    releaseOwnedLock(lockPath, token) {
        try {
            const lock = parseJson(node_fs__WEBPACK_IMPORTED_MODULE_1___default().readFileSync(lockPath, 'utf8'), 'workspace lock');
            if (lock.token === token) {
                node_fs__WEBPACK_IMPORTED_MODULE_1___default().rmSync(lockPath, { force: true });
            }
        }
        catch (error) {
            if (!isFsError(error, 'ENOENT')) {
                throw error;
            }
        }
    }
}
function emptyTree(synthetic = false) {
    return { kind: 'tree', mode: 0o755, ...(synthetic ? { synthetic: true } : {}), children: new Map() };
}
function scopeTree(tree, trackedPaths) {
    if (trackedPaths.includes('.')) {
        return tree;
    }
    let scoped = emptyTree();
    for (const relativePath of trackedPaths) {
        const found = findScopedNode(tree, relativePath);
        scoped = found.node
            ? setTreePath(scoped, found.path, found.node)
            : ensureTreeAncestors(scoped, relativePath);
    }
    return scoped;
}
function findScopedNode(tree, relativePath) {
    if (relativePath === '.') {
        return { path: '.', node: tree };
    }
    const segments = relativePath.split('/');
    let current = tree;
    for (let index = 0; index < segments.length; index += 1) {
        if (current.kind !== 'tree') {
            return { path: segments.slice(0, index).join('/'), node: current };
        }
        const child = getTreeChild(current, segments[index]);
        if (!child) {
            return { path: relativePath };
        }
        current = child;
    }
    return { path: relativePath, node: current };
}
function exactTreeNode(tree, relativePath) {
    const found = findScopedNode(tree, relativePath);
    return found.path === relativePath ? found.node : undefined;
}
function ensureTreeAncestors(root, relativePath) {
    if (relativePath === '.') {
        return root;
    }
    let current = root;
    delete current.oid;
    for (const segment of relativePath.split('/').slice(0, -1)) {
        const existing = getTreeChild(current, segment);
        if (existing?.kind === 'tree') {
            current = existing;
        }
        else if (existing) {
            return root;
        }
        else {
            const created = emptyTree(true);
            setTreeChild(current, segment, created);
            current = created;
        }
        delete current.oid;
    }
    return root;
}
function createObjectStats() {
    return { storedBytes: 0, reusedBytes: 0 };
}
function setTreePath(root, relativePath, value) {
    if (relativePath === '.') {
        if (value && value.kind !== 'tree') {
            throw new Error('Workspace root must be a directory');
        }
        return value ?? emptyTree();
    }
    const segments = relativePath.split('/');
    let current = root;
    delete current.oid;
    for (const segment of segments.slice(0, -1)) {
        const existing = getTreeChild(current, segment);
        if (existing?.kind === 'tree') {
            current = existing;
        }
        else if (!value) {
            return root;
        }
        else {
            const created = emptyTree(true);
            setTreeChild(current, segment, created);
            current = created;
        }
        delete current.oid;
    }
    const name = segments[segments.length - 1];
    if (!name) {
        throw new Error(`Invalid workspace path: ${relativePath}`);
    }
    if (value) {
        setTreeChild(current, name, value);
    }
    else {
        deleteTreeChild(current, name);
    }
    return root;
}
function normalizeRequestedPaths(paths) {
    if (!paths || paths.length === 0) {
        return ['.'];
    }
    return minimizePaths(paths.map(normalizeRelativePath));
}
function normalizeRelativePath(value) {
    const input = value.replace(/\\/g, '/');
    if (!input) {
        throw validationError('Workspace path must not be empty');
    }
    if (input === '.') {
        return '.';
    }
    if (input.includes('\0') || node_path__WEBPACK_IMPORTED_MODULE_3___default().posix.isAbsolute(input) || /^[a-zA-Z]:\//.test(input)) {
        throw validationError(`Invalid workspace path: ${value}`);
    }
    const normalized = node_path__WEBPACK_IMPORTED_MODULE_3___default().posix.normalize(input).replace(/^\.\//, '').replace(/\/$/, '');
    if (!normalized || normalized === '.') {
        return '.';
    }
    if (normalized === '..' || normalized.startsWith('../')) {
        throw validationError(`Path escapes workspace: ${value}`);
    }
    for (const segment of normalized.split('/')) {
        try {
            validateEntryName(segment);
        }
        catch {
            throw validationError(`Invalid workspace path: ${value}`);
        }
    }
    return normalized;
}
function minimizePaths(paths) {
    const unique = [...new Set(paths.map(normalizeRelativePath))].sort((left, right) => {
        const depth = left.split('/').length - right.split('/').length;
        return depth || left.localeCompare(right);
    });
    const result = [];
    for (const candidate of unique) {
        const candidateKey = logicalPathKey(candidate);
        if (result.some(parent => {
            const parentKey = logicalPathKey(parent);
            return parent === '.' || candidateKey === parentKey || candidateKey.startsWith(`${parentKey}/`);
        })) {
            continue;
        }
        result.push(candidate);
    }
    return result.sort();
}
function trackedPathsFromCommit(commit) {
    const value = commit.metadata?.authorityTrackedPaths;
    if (!Array.isArray(value) || value.some(entry => typeof entry !== 'string')) {
        return [];
    }
    return minimizePaths(value);
}
function isTrackedPath(relativePath, trackedPaths) {
    const pathKey = logicalPathKey(relativePath);
    return trackedPaths.some(trackedPath => {
        const trackedKey = logicalPathKey(trackedPath);
        return trackedPath === '.' || pathKey === trackedKey || pathKey.startsWith(`${trackedKey}/`);
    });
}
function mergeDiffEntries(...groups) {
    const entries = new Map();
    for (const group of groups) {
        for (const entry of group) {
            entries.set(logicalPathKey(entry.path), entry);
        }
    }
    return [...entries.values()].sort((left, right) => left.path.localeCompare(right.path));
}
function getTreeChild(tree, name) {
    const key = fileNameKey(name);
    for (const [candidate, child] of tree.children) {
        if (fileNameKey(candidate) === key) {
            return child;
        }
    }
    return undefined;
}
function setTreeChild(tree, name, child) {
    const key = fileNameKey(name);
    for (const candidate of tree.children.keys()) {
        if (fileNameKey(candidate) === key) {
            tree.children.set(candidate, child);
            return;
        }
    }
    tree.children.set(name, child);
}
function deleteTreeChild(tree, name) {
    const key = fileNameKey(name);
    for (const candidate of tree.children.keys()) {
        if (fileNameKey(candidate) === key) {
            tree.children.delete(candidate);
            return;
        }
    }
}
function childNames(...trees) {
    const names = new Map();
    for (const tree of trees) {
        for (const name of tree.children.keys()) {
            const key = fileNameKey(name);
            if (!names.has(key)) {
                names.set(key, name);
            }
        }
    }
    return [...names.values()].sort((left, right) => left.localeCompare(right));
}
function diffNodes(before, after) {
    const entries = [];
    diffTreeChildren(before, after, '', entries);
    return entries.sort((left, right) => left.path.localeCompare(right.path));
}
function diffTreeChildren(before, after, prefix, output) {
    for (const name of childNames(before, after)) {
        const childPath = prefix ? `${prefix}/${name}` : name;
        diffNode(getTreeChild(before, name), getTreeChild(after, name), childPath, output);
    }
}
function diffNode(before, after, relativePath, output) {
    if (nodesEqual(before, after)) {
        return;
    }
    if (before?.kind === 'tree' && after?.kind === 'tree') {
        if (before.mode !== after.mode) {
            output.push({
                path: relativePath,
                status: 'modified',
                beforeKind: 'tree',
                afterKind: 'tree',
                ...(before.oid ? { beforeOid: before.oid } : {}),
                ...(after.oid ? { afterOid: after.oid } : {}),
            });
        }
        diffTreeChildren(before, after, relativePath, output);
        return;
    }
    if (!before && after?.kind === 'tree' && after.children.size > 0) {
        for (const [name, child] of after.children) {
            diffNode(undefined, child, `${relativePath}/${name}`, output);
        }
        return;
    }
    if (before?.kind === 'tree' && before.children.size > 0 && !after) {
        for (const [name, child] of before.children) {
            diffNode(child, undefined, `${relativePath}/${name}`, output);
        }
        return;
    }
    output.push({
        path: relativePath,
        status: !before ? 'added' : !after ? 'deleted' : before.kind === after.kind ? 'modified' : 'type_changed',
        ...(before ? { beforeKind: before.kind, beforeOid: before.oid } : {}),
        ...(after ? { afterKind: after.kind, afterOid: after.oid } : {}),
        ...(before?.kind !== 'tree' && before?.sizeBytes !== undefined ? { beforeSizeBytes: before.sizeBytes } : {}),
        ...(after?.kind !== 'tree' && after?.sizeBytes !== undefined ? { afterSizeBytes: after.sizeBytes } : {}),
    });
}
function nodesEqual(left, right) {
    if (!left || !right || left.kind !== right.kind || left.mode !== right.mode) {
        return left === right;
    }
    if (left.kind !== 'tree' && right.kind !== 'tree') {
        return left.oid === right.oid;
    }
    if (left.kind !== 'tree' || right.kind !== 'tree' || left.children.size !== right.children.size) {
        return false;
    }
    for (const [name, child] of left.children) {
        if (!nodesEqual(child, getTreeChild(right, name))) {
            return false;
        }
    }
    return true;
}
function validateTreeEntry(entry) {
    if (!entry
        || typeof entry.name !== 'string'
        || !isTreeKind(entry.kind)
        || !OID_PATTERN.test(entry.oid)
        || !Number.isSafeInteger(entry.mode)) {
        throw new Error('Invalid workspace tree entry');
    }
    validateEntryName(entry.name);
}
function validateEntryName(name) {
    if (!name || name === '.' || name === '..' || name.includes('/') || name.includes('\\') || name.includes('\0')) {
        throw new Error(`Invalid workspace entry name: ${name}`);
    }
    if (process.platform === 'win32') {
        const stem = name.split('.')[0]?.toUpperCase() ?? '';
        if (/[<>:"|?*]/.test(name)
            || /[ .]$/.test(name)
            || /^(CON|PRN|AUX|NUL|COM[1-9]|LPT[1-9])$/.test(stem)) {
            throw new Error(`Invalid Windows workspace entry name: ${name}`);
        }
    }
}
function fileNameKey(value) {
    return process.platform === 'win32' ? value.toLowerCase() : value;
}
function logicalPathKey(value) {
    return process.platform === 'win32' ? value.toLowerCase() : value;
}
function validateWorkspaceRecord(workspace) {
    if (!workspace || typeof workspace !== 'object') {
        throw new Error('Invalid workspace registry entry');
    }
    assertSafeName(workspace.id, 'workspace id');
    assertSafeName(workspace.defaultRef, 'workspace ref');
    if (typeof workspace.displayName !== 'string'
        || !workspace.displayName.trim()
        || typeof workspace.rootPath !== 'string'
        || !node_path__WEBPACK_IMPORTED_MODULE_3___default().isAbsolute(workspace.rootPath)
        || !Array.isArray(workspace.allowedUserHandles)
        || workspace.allowedUserHandles.length > 256
        || workspace.allowedUserHandles.some(userHandle => typeof userHandle !== 'string' || !userHandle.trim() || userHandle.length > 200)
        || (workspace.headCommitId !== null && !OID_PATTERN.test(workspace.headCommitId))
        || typeof workspace.createdAt !== 'string'
        || typeof workspace.updatedAt !== 'string') {
        throw new Error(`Invalid workspace registry entry: ${workspace.id}`);
    }
}
function normalizeAllowedUserHandles(value) {
    if (value === undefined) {
        return [];
    }
    if (!Array.isArray(value) || value.length > 256) {
        throw validationError('Workspace allowedUserHandles must be an array of at most 256 user handles');
    }
    const handles = value.map(userHandle => {
        if (typeof userHandle !== 'string' || !userHandle.trim() || userHandle.trim().length > 200) {
            throw validationError('Workspace allowedUserHandles contains an invalid user handle');
        }
        return userHandle.trim();
    });
    return [...new Set(handles)].sort((left, right) => left.localeCompare(right));
}
function isTreeKind(value) {
    return value === 'blob' || value === 'tree' || value === 'symlink';
}
function canonicalJson(value) {
    if (value === null || typeof value === 'string' || typeof value === 'boolean') {
        return JSON.stringify(value);
    }
    if (typeof value === 'number') {
        if (!Number.isFinite(value)) {
            throw new Error('Workspace history values must be finite numbers');
        }
        return JSON.stringify(value);
    }
    if (Array.isArray(value)) {
        return `[${value.map(item => canonicalJson(item)).join(',')}]`;
    }
    if (typeof value === 'object') {
        const entries = Object.entries(value)
            .filter(([, item]) => item !== undefined)
            .sort(([left], [right]) => left.localeCompare(right));
        return `{${entries.map(([key, item]) => `${JSON.stringify(key)}:${canonicalJson(item)}`).join(',')}}`;
    }
    throw new Error(`Unsupported workspace history value: ${typeof value}`);
}
function parseJson(value, label) {
    try {
        return JSON.parse(value);
    }
    catch (error) {
        throw new Error(`Invalid ${label}: ${error instanceof Error ? error.message : String(error)}`);
    }
}
function sha256(content) {
    return node_crypto__WEBPACK_IMPORTED_MODULE_0___default().createHash('sha256').update(content).digest('hex');
}
function assertOid(value) {
    if (!OID_PATTERN.test(value)) {
        throw new Error(`Invalid workspace object id: ${value}`);
    }
}
function assertSafeName(value, label) {
    if (!isSafeName(value)) {
        throw new Error(`Invalid ${label}: ${value}`);
    }
}
function isSafeName(value) {
    return SAFE_NAME_PATTERN.test(value) && value !== '.' && value !== '..';
}
function workspaceConflict(message, changes = []) {
    const error = new _utils_js__WEBPACK_IMPORTED_MODULE_4__.AuthorityServiceError(message, 409, 'workspace_conflict', 'concurrency', {
        changes: changes.slice(0, 100),
        totalChanges: changes.length,
    });
    error.name = 'WorkspaceConflictError';
    return error;
}
function validationError(message) {
    return new _utils_js__WEBPACK_IMPORTED_MODULE_4__.AuthorityServiceError(message, 400, 'validation_error', 'validation');
}
function samePath(left, right) {
    const normalize = (value) => process.platform === 'win32' ? node_path__WEBPACK_IMPORTED_MODULE_3___default().resolve(value).toLowerCase() : node_path__WEBPACK_IMPORTED_MODULE_3___default().resolve(value);
    return normalize(left) === normalize(right);
}
function isFsError(error, code) {
    return error instanceof Error && error.code === code;
}
function assertSameFile(before, after, relativePath) {
    const sameKind = before.isFile() === after.isFile()
        && before.isDirectory() === after.isDirectory()
        && before.isSymbolicLink() === after.isSymbolicLink();
    const unchangedFile = !before.isFile()
        || (before.size === after.size && before.mtimeMs === after.mtimeMs);
    if (before.dev !== after.dev || before.ino !== after.ino || !sameKind || !unchangedFile) {
        throw workspaceConflict(`Workspace path changed while it was being captured: ${relativePath}`);
    }
}
function isProcessAlive(pid) {
    try {
        process.kill(pid, 0);
        return true;
    }
    catch (error) {
        return !isFsError(error, 'ESRCH');
    }
}
function applyMode(filePath, mode) {
    if (process.platform !== 'win32') {
        node_fs__WEBPACK_IMPORTED_MODULE_1___default().chmodSync(filePath, mode);
    }
}
function delay(milliseconds) {
    return new Promise(resolve => setTimeout(resolve, milliseconds));
}


/***/ },

/***/ "./src/services/workspace-text-diff.ts"
/*!*********************************************!*\
  !*** ./src/services/workspace-text-diff.ts ***!
  \*********************************************/
(__unused_webpack_module, __webpack_exports__, __webpack_require__) {

__webpack_require__.r(__webpack_exports__);
/* harmony export */ __webpack_require__.d(__webpack_exports__, {
/* harmony export */   createWorkspaceTextDiff: () => (/* binding */ createWorkspaceTextDiff)
/* harmony export */ });
const MAX_COMBINED_LINES = 20_000;
const MAX_EDIT_DISTANCE = 512;
const MAX_OUTPUT_LINES = 4_000;
const CONTEXT_LINES = 3;
function createWorkspaceTextDiff(before, after) {
    const beforeText = decodeWorkspaceText(before);
    const afterText = decodeWorkspaceText(after);
    if (beforeText === null || afterText === null) {
        return { kind: 'binary', hunks: [], truncated: false };
    }
    const textMetadata = {
        before: analyzeText(beforeText),
        after: analyzeText(afterText),
    };
    const beforeLines = splitLines(beforeText);
    const afterLines = splitLines(afterText);
    if (beforeLines.length + afterLines.length > MAX_COMBINED_LINES) {
        return { kind: 'unavailable', reason: 'diff_too_complex', hunks: [], truncated: false };
    }
    const edits = createLineEdits(beforeLines, afterLines);
    if (!edits) {
        return { kind: 'unavailable', reason: 'diff_too_complex', hunks: [], truncated: false };
    }
    return { ...buildHunks(edits), textMetadata };
}
function analyzeText(value) {
    const endings = new Set(value.match(/\r\n|\r|\n/g) ?? []);
    const lineEnding = endings.size === 0 ? 'none'
        : endings.size > 1 ? 'mixed'
            : endings.has('\r\n') ? 'crlf'
                : endings.has('\r') ? 'cr'
                    : 'lf';
    return {
        lineEnding,
        endsWithNewline: /(?:\r\n|\r|\n)$/.test(value),
    };
}
function decodeWorkspaceText(content) {
    if (content.includes(0))
        return null;
    let value;
    try {
        value = new TextDecoder('utf-8', { fatal: true }).decode(content);
    }
    catch {
        return null;
    }
    let controls = 0;
    for (const character of value) {
        const code = character.charCodeAt(0);
        if (code < 32 && code !== 9 && code !== 10 && code !== 12 && code !== 13)
            controls += 1;
    }
    return controls > Math.max(8, Math.floor(value.length / 20)) ? null : value;
}
function splitLines(value) {
    const normalized = value.replace(/\r\n/g, '\n').replace(/\r/g, '\n');
    if (!normalized)
        return [];
    const lines = normalized.split('\n');
    if (normalized.endsWith('\n'))
        lines.pop();
    return lines;
}
function createLineEdits(before, after) {
    const maximum = before.length + after.length;
    let frontier = new Map([[1, 0]]);
    const trace = [];
    for (let distance = 0; distance <= Math.min(maximum, MAX_EDIT_DISTANCE); distance += 1) {
        trace.push(new Map(frontier));
        for (let diagonal = -distance; diagonal <= distance; diagonal += 2) {
            const down = frontier.get(diagonal + 1) ?? Number.NEGATIVE_INFINITY;
            const right = (frontier.get(diagonal - 1) ?? Number.NEGATIVE_INFINITY) + 1;
            let beforeIndex = diagonal === -distance || (diagonal !== distance && right < down)
                ? down
                : right;
            if (!Number.isFinite(beforeIndex))
                beforeIndex = 0;
            let afterIndex = beforeIndex - diagonal;
            while (beforeIndex < before.length && afterIndex < after.length && before[beforeIndex] === after[afterIndex]) {
                beforeIndex += 1;
                afterIndex += 1;
            }
            frontier.set(diagonal, beforeIndex);
            if (beforeIndex >= before.length && afterIndex >= after.length) {
                return backtrackLineEdits(trace, before, after, distance);
            }
        }
    }
    return null;
}
function backtrackLineEdits(trace, before, after, maximumDistance) {
    const edits = [];
    let beforeIndex = before.length;
    let afterIndex = after.length;
    for (let distance = maximumDistance; distance >= 0; distance -= 1) {
        const frontier = trace[distance];
        const diagonal = beforeIndex - afterIndex;
        const left = frontier.get(diagonal - 1) ?? Number.NEGATIVE_INFINITY;
        const down = frontier.get(diagonal + 1) ?? Number.NEGATIVE_INFINITY;
        const previousDiagonal = diagonal === -distance || (diagonal !== distance && left < down)
            ? diagonal + 1
            : diagonal - 1;
        const previousBefore = frontier.get(previousDiagonal) ?? 0;
        const previousAfter = previousBefore - previousDiagonal;
        while (beforeIndex > previousBefore && afterIndex > previousAfter) {
            edits.push({ kind: 'equal', text: before[beforeIndex - 1] });
            beforeIndex -= 1;
            afterIndex -= 1;
        }
        if (distance === 0)
            break;
        if (beforeIndex === previousBefore) {
            edits.push({ kind: 'added', text: after[afterIndex - 1] });
            afterIndex -= 1;
        }
        else {
            edits.push({ kind: 'deleted', text: before[beforeIndex - 1] });
            beforeIndex -= 1;
        }
    }
    return edits.reverse();
}
function buildHunks(edits) {
    const lines = [];
    let beforeLine = 1;
    let afterLine = 1;
    for (const edit of edits) {
        if (edit.kind === 'equal') {
            lines.push({ kind: 'context', beforeLine, afterLine, text: edit.text });
            beforeLine += 1;
            afterLine += 1;
        }
        else if (edit.kind === 'deleted') {
            lines.push({ kind: 'deleted', beforeLine, afterLine: null, text: edit.text });
            beforeLine += 1;
        }
        else {
            lines.push({ kind: 'added', beforeLine: null, afterLine, text: edit.text });
            afterLine += 1;
        }
    }
    const ranges = [];
    for (let index = 0; index < lines.length; index += 1) {
        if (lines[index].kind === 'context')
            continue;
        const start = Math.max(0, index - CONTEXT_LINES);
        const end = Math.min(lines.length, index + CONTEXT_LINES + 1);
        const current = ranges.at(-1);
        if (current && start <= current.end) {
            current.end = Math.max(current.end, end);
        }
        else {
            ranges.push({ start, end });
        }
    }
    const hunks = [];
    let remaining = MAX_OUTPUT_LINES;
    let truncated = false;
    for (const range of ranges) {
        if (remaining === 0) {
            truncated = true;
            break;
        }
        const available = range.end - range.start;
        const taken = Math.min(available, remaining);
        hunks.push({ lines: lines.slice(range.start, range.start + taken) });
        remaining -= taken;
        if (taken < available) {
            truncated = true;
            break;
        }
    }
    return { kind: 'text', hunks, truncated };
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
/* harmony export */   atomicWriteFile: () => (/* binding */ atomicWriteFile),
/* harmony export */   atomicWriteJson: () => (/* binding */ atomicWriteJson),
/* harmony export */   buildPermissionDescriptor: () => (/* binding */ buildPermissionDescriptor),
/* harmony export */   ensureDir: () => (/* binding */ ensureDir),
/* harmony export */   fsyncDirectory: () => (/* binding */ fsyncDirectory),
/* harmony export */   getHttpFetchNetworkClass: () => (/* binding */ getHttpFetchNetworkClass),
/* harmony export */   getSessionToken: () => (/* binding */ getSessionToken),
/* harmony export */   getUserContext: () => (/* binding */ getUserContext),
/* harmony export */   isAuthorityServiceError: () => (/* binding */ isAuthorityServiceError),
/* harmony export */   isPathInside: () => (/* binding */ isPathInside),
/* harmony export */   isRestrictedHttpFetchTarget: () => (/* binding */ isRestrictedHttpFetchTarget),
/* harmony export */   normalizeHostname: () => (/* binding */ normalizeHostname),
/* harmony export */   normalizeHttpFetchTarget: () => (/* binding */ normalizeHttpFetchTarget),
/* harmony export */   normalizePermissionTarget: () => (/* binding */ normalizePermissionTarget),
/* harmony export */   nowIso: () => (/* binding */ nowIso),
/* harmony export */   randomToken: () => (/* binding */ randomToken),
/* harmony export */   readJsonFile: () => (/* binding */ readJsonFile),
/* harmony export */   resolveContainedPath: () => (/* binding */ resolveContainedPath),
/* harmony export */   resolveRuntimePath: () => (/* binding */ resolveRuntimePath),
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
    atomicWriteFile(filePath, `${JSON.stringify(value, null, 2)}\n`);
}
function atomicWriteFile(filePath, value) {
    const parentDir = node_path__WEBPACK_IMPORTED_MODULE_3___default().dirname(filePath);
    ensureDir(parentDir);
    const tempPath = `${filePath}.${node_crypto__WEBPACK_IMPORTED_MODULE_0___default().randomUUID()}.tmp`;
    let fileDescriptor = null;
    try {
        fileDescriptor = node_fs__WEBPACK_IMPORTED_MODULE_1___default().openSync(tempPath, 'wx');
        node_fs__WEBPACK_IMPORTED_MODULE_1___default().writeFileSync(fileDescriptor, value);
        node_fs__WEBPACK_IMPORTED_MODULE_1___default().fsyncSync(fileDescriptor);
        node_fs__WEBPACK_IMPORTED_MODULE_1___default().closeSync(fileDescriptor);
        fileDescriptor = null;
        node_fs__WEBPACK_IMPORTED_MODULE_1___default().renameSync(tempPath, filePath);
        fsyncDirectory(parentDir);
    }
    finally {
        if (fileDescriptor !== null) {
            node_fs__WEBPACK_IMPORTED_MODULE_1___default().closeSync(fileDescriptor);
        }
        node_fs__WEBPACK_IMPORTED_MODULE_1___default().rmSync(tempPath, { force: true });
    }
}
function readJsonFile(filePath, fallback) {
    if (!node_fs__WEBPACK_IMPORTED_MODULE_1___default().existsSync(filePath)) {
        return fallback;
    }
    return safeJsonParse(node_fs__WEBPACK_IMPORTED_MODULE_1___default().readFileSync(filePath, 'utf8'), fallback);
}
function sanitizeFileSegment(input) {
    const sanitized = input
        .replace(/[^a-zA-Z0-9._-]/g, '_')
        .replace(/\.{2,}/g, match => '_'.repeat(match.length));
    return sanitized === '' || sanitized === '.' || sanitized === '..' ? '_' : sanitized;
}
function isPathInside(basePath, candidatePath) {
    const base = node_path__WEBPACK_IMPORTED_MODULE_3___default().resolve(basePath);
    const candidate = node_path__WEBPACK_IMPORTED_MODULE_3___default().resolve(candidatePath);
    const relative = node_path__WEBPACK_IMPORTED_MODULE_3___default().relative(base, candidate);
    return relative === '' || (relative !== '' && !relative.startsWith('..') && !node_path__WEBPACK_IMPORTED_MODULE_3___default().isAbsolute(relative));
}
function resolveContainedPath(basePath, ...segments) {
    const candidate = node_path__WEBPACK_IMPORTED_MODULE_3___default().resolve(basePath, ...segments);
    if (!isPathInside(basePath, candidate)) {
        throw new Error(`Path escapes base directory: ${candidate}`);
    }
    return candidate;
}
function resolveRuntimePath(value, baseDir = process.cwd()) {
    return node_path__WEBPACK_IMPORTED_MODULE_3___default().isAbsolute(value)
        ? node_path__WEBPACK_IMPORTED_MODULE_3___default().normalize(value)
        : node_path__WEBPACK_IMPORTED_MODULE_3___default().resolve(baseDir, value);
}
function getUserContext(request) {
    if (!request.user) {
        throw new AuthorityServiceError('Unauthorized', 401, 'unauthorized', 'auth');
    }
    const directories = resolveUserDirectories(request.user.directories);
    return {
        handle: request.user.profile.handle,
        isAdmin: Boolean(request.user.profile.admin),
        rootDir: directories.root,
        directories,
    };
}
function getSessionToken(request) {
    const headerValue = request.headers[_constants_js__WEBPACK_IMPORTED_MODULE_4__.SESSION_HEADER];
    if (typeof headerValue === 'string' && headerValue.trim()) {
        return headerValue.trim();
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
        case 'module.execute':
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
function fsyncDirectory(dirPath) {
    let fileDescriptor = null;
    try {
        fileDescriptor = node_fs__WEBPACK_IMPORTED_MODULE_1___default().openSync(dirPath, 'r');
        node_fs__WEBPACK_IMPORTED_MODULE_1___default().fsyncSync(fileDescriptor);
    }
    catch (error) {
        // Windows does not consistently allow directory handles to be fsynced.
        if (process.platform !== 'win32') {
            throw error;
        }
    }
    finally {
        if (fileDescriptor !== null) {
            node_fs__WEBPACK_IMPORTED_MODULE_1___default().closeSync(fileDescriptor);
        }
    }
}
function resolveUserDirectories(directories) {
    const resolved = {
        root: resolveRuntimePath(directories.root),
    };
    for (const [key, value] of Object.entries(directories)) {
        if (key === 'root') {
            continue;
        }
        if (typeof value === 'string' && value.trim()) {
            resolved[key] = resolveRuntimePath(value);
        }
    }
    return resolved;
}


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

/***/ "node:os"
/*!**************************!*\
  !*** external "node:os" ***!
  \**************************/
(module) {

module.exports = require("node:os");

/***/ },

/***/ "node:path"
/*!****************************!*\
  !*** external "node:path" ***!
  \****************************/
(module) {

module.exports = require("node:path");

/***/ }

/******/ 	});
/************************************************************************/
/******/ 	// The module cache
/******/ 	const __webpack_module_cache__ = {};
/******/ 	
/******/ 	// The require function
/******/ 	function __webpack_require__(moduleId) {
/******/ 		// Check if module is in cache
/******/ 		const cachedModule = __webpack_module_cache__[moduleId];
/******/ 		if (cachedModule !== undefined) {
/******/ 			return cachedModule.exports;
/******/ 		}
/******/ 		// Create a new module (and put it into the cache)
/******/ 		const module = __webpack_module_cache__[moduleId] = {
/******/ 			// no module.id needed
/******/ 			// no module.loaded needed
/******/ 			exports: {}
/******/ 		};
/******/ 	
/******/ 		// Execute the module function
/******/ 		if (!(moduleId in __webpack_modules__)) {
/******/ 			delete __webpack_module_cache__[moduleId];
/******/ 			const e = new Error("Cannot find module '" + moduleId + "'");
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
/******/ 			const getter = module && module.__esModule ?
/******/ 				() => (module['default']) :
/******/ 				() => (module);
/******/ 			__webpack_require__.d(getter, { a: getter });
/******/ 			return getter;
/******/ 		};
/******/ 	})();
/******/ 	
/******/ 	/* webpack/runtime/define property getters */
/******/ 	(() => {
/******/ 		// define getter/value functions for harmony exports
/******/ 		__webpack_require__.d = (exports, definition) => {
/******/ 			if(Array.isArray(definition)) {
/******/ 				var i = 0;
/******/ 				while(i < definition.length) {
/******/ 					var key = definition[i++];
/******/ 					var binding = definition[i++];
/******/ 					if(!__webpack_require__.o(exports, key)) {
/******/ 						if(binding === 0) {
/******/ 							Object.defineProperty(exports, key, { enumerable: true, value: definition[i++] });
/******/ 						} else {
/******/ 							Object.defineProperty(exports, key, { enumerable: true, get: binding });
/******/ 						}
/******/ 					} else if(binding === 0) { i++; }
/******/ 				}
/******/ 			} else {
/******/ 				for(var key in definition) {
/******/ 					if(__webpack_require__.o(definition, key) && !__webpack_require__.o(exports, key)) {
/******/ 						Object.defineProperty(exports, key, { enumerable: true, get: definition[key] });
/******/ 					}
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
/******/ 			if(Symbol.toStringTag) {
/******/ 				Object.defineProperty(exports, Symbol.toStringTag, { value: 'Module' });
/******/ 			}
/******/ 			Object.defineProperty(exports, '__esModule', { value: true });
/******/ 		};
/******/ 	})();
/******/ 	
/************************************************************************/
let __webpack_exports__ = {};
// This entry needs to be wrapped in an IIFE because it needs to be isolated against other modules in the chunk.
(() => {
/*!**************************!*\
  !*** ./src/agent-cli.ts ***!
  \**************************/
__webpack_require__.r(__webpack_exports__);
/* harmony export */ __webpack_require__.d(__webpack_exports__, {
/* harmony export */   runAgentCli: () => (/* binding */ runAgentCli)
/* harmony export */ });
/* harmony import */ var node_path__WEBPACK_IMPORTED_MODULE_0__ = __webpack_require__(/*! node:path */ "node:path");
/* harmony import */ var node_path__WEBPACK_IMPORTED_MODULE_0___default = /*#__PURE__*/__webpack_require__.n(node_path__WEBPACK_IMPORTED_MODULE_0__);
/* harmony import */ var _services_workspace_history_service_js__WEBPACK_IMPORTED_MODULE_1__ = __webpack_require__(/*! ./services/workspace-history-service.js */ "./src/services/workspace-history-service.ts");


async function runAgentCli(argv) {
    const args = parseArgs(argv);
    const storeDir = args.store
        ? node_path__WEBPACK_IMPORTED_MODULE_0___default().resolve(args.store)
        : (0,_services_workspace_history_service_js__WEBPACK_IMPORTED_MODULE_1__.resolveWorkspaceHistoryStore)(args.dataRoot ?? defaultDataRoot());
    const history = new _services_workspace_history_service_js__WEBPACK_IMPORTED_MODULE_1__.WorkspaceHistoryService(storeDir);
    if (args.command === 'workspaces') {
        return { storeDir, workspaces: history.listWorkspaces() };
    }
    if (args.command === 'status' && !args.workspaceId) {
        const workspaces = history.listWorkspaces();
        return {
            storeDir,
            workspaces: await Promise.all(workspaces.map(workspace => history.status(workspace.id))),
        };
    }
    const workspaceId = resolveWorkspaceId(history, args.workspaceId);
    switch (args.command) {
        case 'status':
            return await history.status(workspaceId);
        case 'log':
            return {
                workspace: history.getWorkspace(workspaceId),
                commits: history.listCommits(workspaceId, args.limit),
            };
        case 'diff': {
            const workspace = history.getWorkspace(workspaceId);
            const from = resolveCommit(args.positionals[0], workspace.headCommitId);
            const to = resolveCommit(args.positionals[1] ?? 'head', workspace.headCommitId);
            return history.diff(workspaceId, from, to);
        }
        case 'checkpoint':
            return await history.checkpoint(workspaceId, {
                message: 'Manual rescue checkpoint',
                ...(args.positionals.length > 0 ? { paths: args.positionals } : {}),
            }, { kind: 'rescue' });
        case 'rollback': {
            const targetCommitId = args.positionals[0];
            if (!targetCommitId) {
                throw new Error('rollback requires a target commit id');
            }
            return await history.rollback(workspaceId, {
                targetCommitId,
                ...(args.operationId ? { operationId: args.operationId } : {}),
                ...(args.force ? { force: true } : {}),
            }, { kind: 'rescue' });
        }
        case 'resume':
            return await history.resumeRollback(workspaceId);
        default:
            throw new Error(usage());
    }
}
function parseArgs(argv) {
    const values = argv[0] === 'rescue' ? argv.slice(1) : argv;
    const command = values.shift() ?? '';
    const positionals = [];
    let dataRoot;
    let store;
    let workspaceId;
    let operationId;
    let limit = 100;
    let force = false;
    for (let index = 0; index < values.length; index += 1) {
        const value = values[index];
        if (value === '--force') {
            force = true;
            continue;
        }
        if (value === '--data-root' || value === '--store' || value === '--workspace' || value === '--operation-id' || value === '--limit') {
            const optionValue = values[index + 1];
            if (!optionValue) {
                throw new Error(`${value} requires a value`);
            }
            index += 1;
            if (value === '--data-root')
                dataRoot = optionValue;
            if (value === '--store')
                store = optionValue;
            if (value === '--workspace')
                workspaceId = optionValue;
            if (value === '--operation-id')
                operationId = optionValue;
            if (value === '--limit')
                limit = Number(optionValue);
            continue;
        }
        if (value?.startsWith('--')) {
            throw new Error(`Unknown option: ${value}`);
        }
        if (value) {
            positionals.push(value);
        }
    }
    if (!Number.isSafeInteger(limit) || limit < 1 || limit > 500) {
        throw new Error('--limit must be an integer between 1 and 500');
    }
    return {
        command,
        positionals,
        limit,
        force,
        ...(dataRoot ? { dataRoot } : {}),
        ...(store ? { store } : {}),
        ...(workspaceId ? { workspaceId } : {}),
        ...(operationId ? { operationId } : {}),
    };
}
function resolveWorkspaceId(history, requested) {
    if (requested) {
        return requested;
    }
    const workspaces = history.listWorkspaces();
    if (workspaces.length === 1) {
        return workspaces[0].id;
    }
    throw new Error(`--workspace is required when ${workspaces.length} workspaces are registered`);
}
function resolveCommit(value, head) {
    if (!value || value === 'empty') {
        return null;
    }
    return value === 'head' ? head : value;
}
function defaultDataRoot() {
    const configured = process.env.SILLYTAVERN_DATA_ROOT?.trim() || process.env.DATA_ROOT?.trim();
    return node_path__WEBPACK_IMPORTED_MODULE_0___default().resolve(configured || node_path__WEBPACK_IMPORTED_MODULE_0___default().join(process.cwd(), 'data'));
}
function usage() {
    return [
        'Usage: node runtime/agent.cjs rescue <command> [options]',
        'Commands: workspaces, status, log, diff <from|empty> <to|head>, checkpoint [paths...], rollback <commit>, resume',
        'Options: --data-root <path>, --store <path>, --workspace <id>, --operation-id <id>, --limit <1-500>, --force',
    ].join('\n');
}
void runAgentCli(process.argv.slice(2))
    .then(result => console.log(JSON.stringify(result, null, 2)))
    .catch(error => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
});

})();

module.exports = __webpack_exports__;
/******/ })()
;
//# sourceMappingURL=agent.cjs.map
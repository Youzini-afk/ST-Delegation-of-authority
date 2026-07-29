import { authorityRequest, buildAgentSessionStreamUrl, buildEventStreamUrl, hostnameFromUrl, isInvalidSessionError, } from './api.js';
import { showPermissionPrompt } from './permission-prompt.js';
import { openSecurityCenter } from './security-center.js';
import { splitAuthorityItemsIntoChunks } from './client/chunking.js';
import { base64ToBytes, bytesToContent, bytesToHttpContent, bytesToBase64, contentToBytes } from './client/encoding.js';
import { getFeatureAvailability } from './client/feature-flags.js';
import { getAuthorityPermissionErrorCode, getPermissionEvaluationMessage, getPermissionFailureMessage, } from './client/permission-messages.js';
export { splitAuthorityItemsIntoChunks } from './client/chunking.js';
export class AuthorityPermissionError extends Error {
    details;
    code;
    decision;
    key;
    riskLevel;
    target;
    resource;
    constructor(message, details) {
        super(message);
        this.details = details;
        this.name = 'AuthorityPermissionError';
        this.code = details.code;
        this.decision = details.decision;
        this.key = details.key;
        this.riskLevel = details.riskLevel;
        this.target = details.target;
        this.resource = details.resource;
    }
}
export function isAuthorityPermissionError(error) {
    return error instanceof AuthorityPermissionError;
}
function isTerminalJobStatus(status) {
    return status === 'completed' || status === 'failed' || status === 'cancelled';
}
function isTerminalAgentSessionRunStatus(status) {
    return status === 'completed' || status === 'failed' || status === 'cancelled';
}
function isJobRecord(value) {
    return typeof value === 'object'
        && value !== null
        && typeof value.id === 'string'
        && typeof value.status === 'string';
}
function getJobSubscriptionSnapshot(job) {
    return JSON.stringify(job);
}
function getWaitPollInterval(value, subject) {
    if (value == null) {
        return 1000;
    }
    if (typeof value === 'number' && Number.isSafeInteger(value) && value > 0) {
        return value;
    }
    throw new Error(`Authority ${subject} pollIntervalMs must be a positive safe integer`);
}
function getOptionalWaitTimeout(value, subject) {
    if (value == null) {
        return null;
    }
    if (typeof value === 'number' && Number.isSafeInteger(value) && value > 0) {
        return value;
    }
    throw new Error(`Authority ${subject} timeoutMs must be a positive safe integer`);
}
function getSqlPageAllPageSize(value) {
    if (value == null) {
        return 100;
    }
    if (typeof value === 'number' && Number.isSafeInteger(value) && value > 0) {
        return value;
    }
    throw new Error('Authority sql.pageAll pageSize must be a positive safe integer');
}
function getOptionalMaxPages(value) {
    if (value == null) {
        return null;
    }
    if (typeof value === 'number' && Number.isSafeInteger(value) && value > 0) {
        return value;
    }
    throw new Error('Authority sql.pageAll maxPages must be a positive safe integer');
}
function throwIfAborted(signal, subject) {
    if (signal?.aborted) {
        throw new Error(`Authority ${subject} wait aborted`);
    }
}
function waitForDelay(ms, signal, subject) {
    return new Promise((resolve, reject) => {
        if (signal?.aborted) {
            reject(new Error(`Authority ${subject} wait aborted`));
            return;
        }
        const timer = setTimeout(() => {
            cleanup();
            resolve();
        }, ms);
        const onAbort = () => {
            clearTimeout(timer);
            cleanup();
            reject(new Error(`Authority ${subject} wait aborted`));
        };
        const cleanup = () => {
            signal?.removeEventListener('abort', onAbort);
        };
        signal?.addEventListener('abort', onAbort, { once: true });
    });
}
function waitForSignal(promise, signal) {
    if (!signal) {
        return promise;
    }
    if (signal.aborted) {
        return Promise.reject(signal.reason ?? new Error('Authority request aborted'));
    }
    return new Promise((resolve, reject) => {
        const onAbort = () => reject(signal.reason ?? new Error('Authority request aborted'));
        signal.addEventListener('abort', onAbort, { once: true });
        promise.then(resolve, reject).finally(() => signal.removeEventListener('abort', onAbort));
    });
}
function stringifyJsonValue(value, label, space) {
    const serialized = JSON.stringify(value, null, space);
    if (typeof serialized !== 'string') {
        throw new Error(`${label} could not serialize value to JSON`);
    }
    return serialized;
}
const SDK_TRANSFER_INLINE_THRESHOLD_BYTES = 256 * 1024;
export class AuthorityClient {
    config;
    storage;
    fs;
    sql;
    trivium;
    http;
    transfers;
    permissions;
    jobs;
    events;
    modules;
    agent;
    session = null;
    sessionPromise = null;
    probeSnapshot = null;
    probePromise = null;
    runtimeGrants = new Map();
    moduleManifests = new Map();
    agentSessionWorkspaces = new Map();
    constructor(config) {
        this.config = config;
        this.storage = {
            kv: {
                get: async (key) => {
                    await this.ensurePermission({ resource: 'storage.kv', reason: `读取键 ${key}` });
                    const response = await this.requestWithSession('/storage/kv/get', {
                        method: 'POST',
                        body: { key },
                    });
                    return response.value;
                },
                set: async (key, value) => {
                    await this.ensurePermission({ resource: 'storage.kv', reason: `写入键 ${key}` });
                    await this.requestWithSession('/storage/kv/set', {
                        method: 'POST',
                        body: { key, value },
                    });
                },
                delete: async (key) => {
                    await this.ensurePermission({ resource: 'storage.kv', reason: `删除键 ${key}` });
                    await this.requestWithSession('/storage/kv/delete', {
                        method: 'POST',
                        body: { key },
                    });
                },
                list: async () => {
                    await this.ensurePermission({ resource: 'storage.kv', reason: '列出 KV 存储' });
                    const response = await this.requestWithSession('/storage/kv/list', {
                        method: 'POST',
                    });
                    return response.entries;
                },
            },
            blob: {
                put: async (input) => {
                    await this.ensurePermission({ resource: 'storage.blob', reason: `写入 Blob ${input.name}` });
                    const bytes = contentToBytes(input.content, input.encoding ?? 'utf8');
                    const inlineThreshold = await this.getEffectiveInlineThresholdBytes('storageBlobWrite');
                    if (bytes.byteLength > inlineThreshold) {
                        return await this.putBlobWithTransfer(input, bytes);
                    }
                    return await this.requestWithSession('/storage/blob/put', {
                        method: 'POST',
                        body: input,
                    });
                },
                putJsonLarge: async (input) => {
                    return await this.storage.blob.put({
                        name: input.name,
                        content: stringifyJsonValue(input.value, 'Authority blob.putJsonLarge', input.space),
                        encoding: 'utf8',
                        contentType: input.contentType ?? 'application/json',
                    });
                },
                get: async (id) => {
                    await this.ensurePermission({ resource: 'storage.blob', reason: `读取 Blob ${id}` });
                    return await this.getBlobWithTransfer(id);
                },
                delete: async (id) => {
                    await this.ensurePermission({ resource: 'storage.blob', reason: `删除 Blob ${id}` });
                    await this.requestWithSession('/storage/blob/delete', {
                        method: 'POST',
                        body: { id },
                    });
                },
                list: async () => {
                    await this.ensurePermission({ resource: 'storage.blob', reason: '列出 Blob 存储' });
                    const response = await this.requestWithSession('/storage/blob/list', {
                        method: 'POST',
                    });
                    return response.entries;
                },
            },
        };
        this.fs = {
            mkdir: async (path, options = {}) => {
                await this.ensurePermission({ resource: 'fs.private', reason: `在私有文件夹中创建目录 ${path}` });
                const response = await this.requestWithSession('/fs/private/mkdir', {
                    method: 'POST',
                    body: {
                        path,
                        recursive: options.recursive,
                    },
                });
                return response.entry;
            },
            readDir: async (path = '/', options = {}) => {
                await this.ensurePermission({ resource: 'fs.private', reason: `列出私有目录 ${path}` });
                const response = await this.requestWithSession('/fs/private/read-dir', {
                    method: 'POST',
                    body: {
                        path,
                        limit: options.limit,
                    },
                });
                return response.entries;
            },
            writeFile: async (path, content, options = {}) => {
                await this.ensurePermission({ resource: 'fs.private', reason: `写入私有文件 ${path}` });
                const bytes = contentToBytes(content, options.encoding ?? 'utf8');
                const inlineThreshold = await this.getEffectiveInlineThresholdBytes('privateFileWrite');
                if (bytes.byteLength > inlineThreshold) {
                    return await this.writePrivateFileWithTransfer(path, bytes, options);
                }
                const response = await this.requestWithSession('/fs/private/write-file', {
                    method: 'POST',
                    body: {
                        path,
                        content,
                        encoding: options.encoding,
                        createParents: options.createParents,
                    },
                });
                return response.entry;
            },
            writeJson: async (path, value, options = {}) => {
                return await this.fs.writeFile(path, stringifyJsonValue(value, 'Authority fs.writeJson', options.space), {
                    encoding: 'utf8',
                    ...(options.createParents !== undefined ? { createParents: options.createParents } : {}),
                });
            },
            readFile: async (path, options = {}) => {
                await this.ensurePermission({ resource: 'fs.private', reason: `读取私有文件 ${path}` });
                return await this.readPrivateFileWithTransfer(path, options);
            },
            delete: async (path, options = {}) => {
                await this.ensurePermission({ resource: 'fs.private', reason: `删除私有路径 ${path}` });
                await this.requestWithSession('/fs/private/delete', {
                    method: 'POST',
                    body: {
                        path,
                        recursive: options.recursive,
                    },
                });
            },
            stat: async (path) => {
                await this.ensurePermission({ resource: 'fs.private', reason: `查看私有路径 ${path}` });
                const response = await this.requestWithSession('/fs/private/stat', {
                    method: 'POST',
                    body: { path },
                });
                return response.entry;
            },
        };
        this.sql = {
            query: async (input) => {
                const database = getSqlDatabaseName(input.database);
                await this.ensurePermission({
                    resource: 'sql.private',
                    target: database,
                    reason: `查询 SQL 数据库 ${database}`,
                });
                return await this.requestWithSession('/sql/query', {
                    method: 'POST',
                    body: {
                        ...input,
                        database,
                    },
                });
            },
            pageAll: async (input, options = {}) => {
                await this.requireFeature('sql.queryPage', 'Authority 当前版本尚未提供 SQL 分页查询能力');
                const pageSize = getSqlPageAllPageSize(options.pageSize ?? input.page?.limit);
                const maxPages = getOptionalMaxPages(options.maxPages);
                const rows = [];
                let columns = null;
                let pageCount = 0;
                let cursor = input.page?.cursor ?? null;
                let lastPageInfo;
                while (true) {
                    if (maxPages != null && pageCount >= maxPages) {
                        throw new Error(`Authority sql.pageAll exceeded maxPages=${maxPages}`);
                    }
                    const page = await this.sql.query({
                        ...input,
                        page: {
                            ...(cursor ? { cursor } : {}),
                            limit: pageSize,
                        },
                    });
                    pageCount += 1;
                    await options.onPage?.(page);
                    if (!columns) {
                        columns = [...page.columns];
                    }
                    else if (JSON.stringify(columns) !== JSON.stringify(page.columns)) {
                        throw new Error('Authority sql.pageAll encountered inconsistent columns across pages');
                    }
                    rows.push(...page.rows);
                    lastPageInfo = page.page;
                    if (!page.page?.hasMore || !page.page.nextCursor) {
                        return {
                            kind: 'query',
                            columns: columns ?? [],
                            rows,
                            rowCount: rows.length,
                            ...(lastPageInfo
                                ? {
                                    page: {
                                        nextCursor: null,
                                        limit: lastPageInfo.limit,
                                        hasMore: false,
                                        totalCount: lastPageInfo.totalCount,
                                    },
                                }
                                : {}),
                        };
                    }
                    cursor = page.page.nextCursor;
                }
            },
            exec: async (input) => {
                const database = getSqlDatabaseName(input.database);
                await this.ensurePermission({
                    resource: 'sql.private',
                    target: database,
                    reason: `执行 SQL 数据库 ${database}`,
                });
                return await this.requestWithSession('/sql/exec', {
                    method: 'POST',
                    body: {
                        ...input,
                        database,
                    },
                });
            },
            batch: async (input) => {
                const database = getSqlDatabaseName(input.database);
                await this.ensurePermission({
                    resource: 'sql.private',
                    target: database,
                    reason: `批量执行 SQL 数据库 ${database}`,
                });
                return await this.requestWithSession('/sql/batch', {
                    method: 'POST',
                    body: {
                        ...input,
                        database,
                    },
                });
            },
            transaction: async (input) => {
                const database = getSqlDatabaseName(input.database);
                await this.ensurePermission({
                    resource: 'sql.private',
                    target: database,
                    reason: `事务执行 SQL 数据库 ${database}`,
                });
                return await this.requestWithSession('/sql/transaction', {
                    method: 'POST',
                    body: {
                        ...input,
                        database,
                    },
                });
            },
            migrate: async (input) => {
                const database = getSqlDatabaseName(input.database);
                await this.ensurePermission({
                    resource: 'sql.private',
                    target: database,
                    reason: `迁移 SQL 数据库 ${database}`,
                });
                return await this.requestWithSession('/sql/migrate', {
                    method: 'POST',
                    body: {
                        ...input,
                        database,
                    },
                });
            },
            stat: async (input = {}) => {
                const database = getSqlDatabaseName(input.database);
                await this.requireFeature('sql.stat', 'Authority 当前版本尚未提供 SQL 运行时诊断能力');
                await this.ensurePermission({
                    resource: 'sql.private',
                    target: database,
                    reason: `查看 SQL 数据库诊断 ${database}`,
                });
                return await this.requestWithSession('/sql/stat', {
                    method: 'POST',
                    body: {
                        ...input,
                        database,
                    },
                });
            },
            listMigrationsPage: async (input = {}) => {
                const database = getSqlDatabaseName(input.database);
                await this.requireFeature('sql.migrations', 'Authority 当前版本尚未提供 SQL migration introspection 能力');
                await this.ensurePermission({
                    resource: 'sql.private',
                    target: database,
                    reason: `列出 SQL 迁移记录 ${database}`,
                });
                return await this.requestWithSession('/sql/list-migrations', {
                    method: 'POST',
                    body: {
                        ...input,
                        database,
                    },
                });
            },
            listSchemaPage: async (input = {}) => {
                const database = getSqlDatabaseName(input.database);
                await this.requireFeature('sql.schemaManifest', 'Authority 当前版本尚未提供 SQL schema manifest introspection 能力');
                await this.ensurePermission({
                    resource: 'sql.private',
                    target: database,
                    reason: `列出 SQL schema 清单 ${database}`,
                });
                return await this.requestWithSession('/sql/list-schema', {
                    method: 'POST',
                    body: {
                        ...input,
                        database,
                    },
                });
            },
            listDatabases: async () => {
                await this.ensurePermission({
                    resource: 'sql.private',
                    reason: '列出私有 SQL 数据库',
                });
                return await this.requestWithSession('/sql/databases');
            },
        };
        this.trivium = {
            insert: async (input) => {
                const database = getTriviumDatabaseName(input.database);
                await this.ensurePermission({
                    resource: 'trivium.private',
                    target: database,
                    reason: `写入 Trivium 数据库 ${database}`,
                });
                return await this.requestWithSession('/trivium/insert', {
                    method: 'POST',
                    body: {
                        ...input,
                        database,
                    },
                });
            },
            insertWithId: async (input) => {
                const database = getTriviumDatabaseName(input.database);
                await this.ensurePermission({
                    resource: 'trivium.private',
                    target: database,
                    reason: `写入指定 ID 的 Trivium 节点到 ${database}`,
                });
                await this.requestWithSession('/trivium/insert-with-id', {
                    method: 'POST',
                    body: {
                        ...input,
                        database,
                    },
                });
            },
            resolveId: async (input) => {
                const database = getTriviumDatabaseName(input.database);
                await this.ensurePermission({
                    resource: 'trivium.private',
                    target: database,
                    reason: `解析 Trivium externalId（${database}）`,
                });
                return await this.requestWithSession('/trivium/resolve-id', {
                    method: 'POST',
                    body: {
                        ...input,
                        database,
                    },
                });
            },
            resolveMany: async (input) => {
                const database = getTriviumDatabaseName(input.database);
                await this.requireFeature('trivium.resolveMany', 'Authority 当前版本尚未提供 Trivium 批量映射解析能力');
                await this.ensurePermission({
                    resource: 'trivium.private',
                    target: database,
                    reason: `批量解析 Trivium externalId 或内部 ID（${database}）`,
                });
                return await this.requestWithSession('/trivium/resolve-many', {
                    method: 'POST',
                    body: {
                        ...input,
                        database,
                    },
                });
            },
            upsert: async (input) => {
                const database = getTriviumDatabaseName(input.database);
                await this.ensurePermission({
                    resource: 'trivium.private',
                    target: database,
                    reason: `写入或更新 Trivium 节点（${database}）`,
                });
                return await this.requestWithSession('/trivium/upsert', {
                    method: 'POST',
                    body: {
                        ...input,
                        database,
                    },
                });
            },
            bulkUpsert: async (input) => {
                const database = getTriviumDatabaseName(input.database);
                await this.ensurePermission({
                    resource: 'trivium.private',
                    target: database,
                    reason: `批量写入或更新 Trivium 节点（${database}）`,
                });
                return await this.bulkUpsertTriviumRequest({
                    ...input,
                    database,
                });
            },
            bulkUpsertChunked: async (input, options) => {
                return await this.bulkUpsertTriviumChunked(input, options);
            },
            get: async (input) => {
                const database = getTriviumDatabaseName(input.database);
                await this.ensurePermission({
                    resource: 'trivium.private',
                    target: database,
                    reason: `读取 Trivium 节点 ${input.id}（${database}）`,
                });
                const response = await this.requestWithSession('/trivium/get', {
                    method: 'POST',
                    body: {
                        ...input,
                        database,
                    },
                });
                return response.node;
            },
            updatePayload: async (input) => {
                const database = getTriviumDatabaseName(input.database);
                await this.ensurePermission({
                    resource: 'trivium.private',
                    target: database,
                    reason: `更新 Trivium 节点负载 ${input.id}（${database}）`,
                });
                await this.requestWithSession('/trivium/update-payload', {
                    method: 'POST',
                    body: {
                        ...input,
                        database,
                    },
                });
            },
            updateVector: async (input) => {
                const database = getTriviumDatabaseName(input.database);
                await this.ensurePermission({
                    resource: 'trivium.private',
                    target: database,
                    reason: `更新 Trivium 节点向量 ${input.id}（${database}）`,
                });
                await this.requestWithSession('/trivium/update-vector', {
                    method: 'POST',
                    body: {
                        ...input,
                        database,
                    },
                });
            },
            delete: async (input) => {
                const database = getTriviumDatabaseName(input.database);
                await this.ensurePermission({
                    resource: 'trivium.private',
                    target: database,
                    reason: `删除 Trivium 节点 ${input.id}（${database}）`,
                });
                await this.requestWithSession('/trivium/delete', {
                    method: 'POST',
                    body: {
                        ...input,
                        database,
                    },
                });
            },
            bulkDelete: async (input) => {
                const database = getTriviumDatabaseName(input.database);
                await this.ensurePermission({
                    resource: 'trivium.private',
                    target: database,
                    reason: `批量删除 Trivium 节点（${database}）`,
                });
                return await this.bulkDeleteTriviumRequest({
                    ...input,
                    database,
                });
            },
            bulkDeleteChunked: async (input, options) => {
                return await this.bulkDeleteTriviumChunked(input, options);
            },
            link: async (input) => {
                const database = getTriviumDatabaseName(input.database);
                await this.ensurePermission({
                    resource: 'trivium.private',
                    target: database,
                    reason: `建立 Trivium 图边 ${input.src} -> ${input.dst}（${database}）`,
                });
                await this.requestWithSession('/trivium/link', {
                    method: 'POST',
                    body: {
                        ...input,
                        database,
                    },
                });
            },
            bulkLink: async (input) => {
                const database = getTriviumDatabaseName(input.database);
                await this.ensurePermission({
                    resource: 'trivium.private',
                    target: database,
                    reason: `批量建立 Trivium 图边（${database}）`,
                });
                return await this.bulkLinkTriviumRequest({
                    ...input,
                    database,
                });
            },
            bulkLinkChunked: async (input, options) => {
                return await this.bulkLinkTriviumChunked(input, options);
            },
            unlink: async (input) => {
                const database = getTriviumDatabaseName(input.database);
                await this.ensurePermission({
                    resource: 'trivium.private',
                    target: database,
                    reason: `删除 Trivium 图边 ${input.src} -> ${input.dst}（${database}）`,
                });
                await this.requestWithSession('/trivium/unlink', {
                    method: 'POST',
                    body: {
                        ...input,
                        database,
                    },
                });
            },
            bulkUnlink: async (input) => {
                const database = getTriviumDatabaseName(input.database);
                await this.ensurePermission({
                    resource: 'trivium.private',
                    target: database,
                    reason: `批量删除 Trivium 图边（${database}）`,
                });
                return await this.bulkUnlinkTriviumRequest({
                    ...input,
                    database,
                });
            },
            bulkUnlinkChunked: async (input, options) => {
                return await this.bulkUnlinkTriviumChunked(input, options);
            },
            neighbors: async (input) => {
                const database = getTriviumDatabaseName(input.database);
                await this.ensurePermission({
                    resource: 'trivium.private',
                    target: database,
                    reason: `查询 Trivium 邻居 ${input.id}（${database}）`,
                });
                return await this.requestWithSession('/trivium/neighbors', {
                    method: 'POST',
                    body: {
                        ...input,
                        database,
                    },
                });
            },
            search: async (input) => {
                const database = getTriviumDatabaseName(input.database);
                await this.ensurePermission({
                    resource: 'trivium.private',
                    target: database,
                    reason: `检索 Trivium 数据库 ${database}`,
                });
                const response = await this.requestWithSession('/trivium/search', {
                    method: 'POST',
                    body: {
                        ...input,
                        database,
                    },
                });
                return response.hits;
            },
            searchAdvanced: async (input) => {
                const database = getTriviumDatabaseName(input.database);
                await this.ensurePermission({
                    resource: 'trivium.private',
                    target: database,
                    reason: `高级检索 Trivium 数据库 ${database}`,
                });
                const response = await this.requestWithSession('/trivium/search-advanced', {
                    method: 'POST',
                    body: {
                        ...input,
                        database,
                    },
                });
                return response.hits;
            },
            searchHybrid: async (input) => {
                const database = getTriviumDatabaseName(input.database);
                await this.ensurePermission({
                    resource: 'trivium.private',
                    target: database,
                    reason: `混合检索 Trivium 数据库 ${database}`,
                });
                const response = await this.requestWithSession('/trivium/search-hybrid', {
                    method: 'POST',
                    body: {
                        ...input,
                        database,
                    },
                });
                return response.hits;
            },
            searchHybridWithContext: async (input) => {
                await this.requireFeature('trivium.searchContext', 'Authority 当前版本尚未提供 Trivium 搜索上下文能力');
                const database = getTriviumDatabaseName(input.database);
                await this.ensurePermission({
                    resource: 'trivium.private',
                    target: database,
                    reason: `执行 Trivium 上下文化混合搜索 ${database}`,
                });
                return await this.requestWithSession('/trivium/search-hybrid-context', {
                    method: 'POST',
                    body: {
                        ...input,
                        database,
                    },
                });
            },
            tql: async (input) => {
                const response = await this.trivium.tqlPage(input);
                return response.rows;
            },
            tqlPage: async (input) => {
                await this.requireFeature('trivium.tql', 'Authority 当前版本尚未提供 Trivium TQL 查询能力');
                const database = getTriviumDatabaseName(input.database);
                await this.ensurePermission({
                    resource: 'trivium.private',
                    target: database,
                    reason: `执行 Trivium TQL 查询 ${database}`,
                });
                return await this.requestWithSession('/trivium/tql', {
                    method: 'POST',
                    body: {
                        ...input,
                        database,
                    },
                });
            },
            tqlMut: async (input) => {
                await this.requireFeature('trivium.tqlMut', 'Authority 当前版本尚未提供 Trivium TQL 变更能力');
                const database = getTriviumDatabaseName(input.database);
                await this.ensurePermission({
                    resource: 'trivium.private',
                    target: database,
                    reason: `执行 Trivium TQL 变更 ${database}`,
                });
                return await this.requestWithSession('/trivium/tql-mut', {
                    method: 'POST',
                    body: {
                        ...input,
                        database,
                    },
                });
            },
            createIndex: async (input) => {
                await this.requireFeature('trivium.propertyIndex', 'Authority 当前版本尚未提供 Trivium 属性索引能力');
                const database = getTriviumDatabaseName(input.database);
                await this.ensurePermission({
                    resource: 'trivium.private',
                    target: database,
                    reason: `创建 Trivium 属性索引 ${database}:${input.field}`,
                });
                await this.requestWithSession('/trivium/create-index', {
                    method: 'POST',
                    body: {
                        ...input,
                        database,
                    },
                });
            },
            dropIndex: async (input) => {
                await this.requireFeature('trivium.propertyIndex', 'Authority 当前版本尚未提供 Trivium 属性索引能力');
                const database = getTriviumDatabaseName(input.database);
                await this.ensurePermission({
                    resource: 'trivium.private',
                    target: database,
                    reason: `删除 Trivium 属性索引 ${database}:${input.field}`,
                });
                await this.requestWithSession('/trivium/drop-index', {
                    method: 'POST',
                    body: {
                        ...input,
                        database,
                    },
                });
            },
            listMappingsPage: async (input = {}) => {
                const database = getTriviumDatabaseName(input.database);
                await this.requireFeature('trivium.mappingPages', 'Authority 当前版本尚未提供 Trivium 映射分页能力');
                await this.ensurePermission({
                    resource: 'trivium.private',
                    target: database,
                    reason: `分页列出 Trivium externalId 映射（${database}）`,
                });
                return await this.requestWithSession('/trivium/list-mappings', {
                    method: 'POST',
                    body: {
                        ...input,
                        database,
                    },
                });
            },
            checkMappingsIntegrity: async (input = {}) => {
                const database = getTriviumDatabaseName(input.database);
                await this.requireFeature('trivium.mappingIntegrity', 'Authority 当前版本尚未提供 Trivium 映射完整性检查能力');
                await this.ensurePermission({
                    resource: 'trivium.private',
                    target: database,
                    reason: `检查 Trivium externalId 映射完整性（${database}）`,
                });
                this.warnHeavyTriviumDiagnostics('checkMappingsIntegrity', database);
                return await this.requestWithSession('/trivium/check-mappings-integrity', {
                    method: 'POST',
                    body: {
                        ...input,
                        database,
                    },
                });
            },
            deleteOrphanMappings: async (input = {}) => {
                const database = getTriviumDatabaseName(input.database);
                await this.requireFeature('trivium.mappingIntegrity', 'Authority 当前版本尚未提供 Trivium orphan mapping 清理能力');
                await this.ensurePermission({
                    resource: 'trivium.private',
                    target: database,
                    reason: `清理 Trivium orphan externalId 映射（${database}）`,
                });
                this.warnHeavyTriviumDiagnostics('deleteOrphanMappings', database);
                return await this.requestWithSession('/trivium/delete-orphan-mappings', {
                    method: 'POST',
                    body: {
                        ...input,
                        database,
                    },
                });
            },
            indexText: async (input) => {
                const database = getTriviumDatabaseName(input.database);
                await this.ensurePermission({
                    resource: 'trivium.private',
                    target: database,
                    reason: `写入 Trivium 文本索引 ${database}`,
                });
                await this.requestWithSession('/trivium/index-text', {
                    method: 'POST',
                    body: {
                        ...input,
                        database,
                    },
                });
            },
            indexKeyword: async (input) => {
                const database = getTriviumDatabaseName(input.database);
                await this.ensurePermission({
                    resource: 'trivium.private',
                    target: database,
                    reason: `写入 Trivium 关键词索引 ${database}`,
                });
                await this.requestWithSession('/trivium/index-keyword', {
                    method: 'POST',
                    body: {
                        ...input,
                        database,
                    },
                });
            },
            buildTextIndex: async (input = {}) => {
                const database = getTriviumDatabaseName(input.database);
                await this.ensurePermission({
                    resource: 'trivium.private',
                    target: database,
                    reason: `构建 Trivium 文本索引 ${database}`,
                });
                await this.requestWithSession('/trivium/build-text-index', {
                    method: 'POST',
                    body: {
                        ...input,
                        database,
                    },
                });
            },
            compact: async (input = {}) => {
                const database = getTriviumDatabaseName(input.database);
                await this.ensurePermission({
                    resource: 'trivium.private',
                    target: database,
                    reason: `压实 Trivium 数据库 ${database}`,
                });
                await this.requestWithSession('/trivium/compact', {
                    method: 'POST',
                    body: {
                        ...input,
                        database,
                    },
                });
            },
            flush: async (input = {}) => {
                const database = getTriviumDatabaseName(input.database);
                await this.ensurePermission({
                    resource: 'trivium.private',
                    target: database,
                    reason: `刷新 Trivium 数据库 ${database}`,
                });
                await this.requestWithSession('/trivium/flush', {
                    method: 'POST',
                    body: {
                        ...input,
                        database,
                    },
                });
            },
            stat: async (input = {}) => {
                const database = getTriviumDatabaseName(input.database);
                await this.ensurePermission({
                    resource: 'trivium.private',
                    target: database,
                    reason: `查看 Trivium 数据库状态 ${database}`,
                });
                if (input.includeMappingIntegrity === true) {
                    this.warnHeavyTriviumDiagnostics('stat.includeMappingIntegrity', database);
                }
                return await this.requestWithSession('/trivium/stat', {
                    method: 'POST',
                    body: {
                        ...input,
                        database,
                    },
                });
            },
            listDatabases: async () => {
                await this.ensurePermission({
                    resource: 'trivium.private',
                    reason: '列出私有 Trivium 数据库',
                });
                return await this.requestWithSession('/trivium/databases');
            },
        };
        this.http = {
            fetch: async (input) => {
                const hostname = hostnameFromUrl(input.url);
                await this.ensurePermission({
                    resource: 'http.fetch',
                    target: hostname,
                    reason: `访问主机 ${hostname}`,
                });
                return await this.fetchHttpWithTransfer(input);
            },
        };
        this.transfers = {
            init: async (request) => {
                if (request.resource === 'storage.blob' || request.resource === 'fs.private') {
                    await this.ensurePermission({ resource: request.resource, reason: `初始化分块传输 ${request.resource}` });
                }
                if (request.resource === 'http.fetch') {
                    await this.ensurePermission({ resource: 'http.fetch', reason: '初始化 HTTP 分块传输' });
                }
                return await this.requestWithSession('/transfers/init', {
                    method: 'POST',
                    body: request,
                });
            },
            status: async (transferId) => {
                return await this.getTransferStatus(transferId);
            },
            manifest: async (transferId) => {
                return await this.requestWithSession(`/transfers/${encodeURIComponent(transferId)}/manifest`, {
                    method: 'POST',
                });
            },
            append: async (transferId, bytes, options = {}) => {
                const offset = options.offset ?? (await this.getTransferStatus(transferId)).sizeBytes;
                return await this.requestWithSession(`/transfers/${encodeURIComponent(transferId)}/append`, {
                    method: 'POST',
                    body: {
                        offset,
                        content: bytesToBase64(bytes),
                    },
                });
            },
            read: async (transferId, options = {}) => {
                const chunk = await this.requestWithSession(`/transfers/${encodeURIComponent(transferId)}/read`, {
                    method: 'POST',
                    body: {
                        offset: options.offset ?? 0,
                        ...(options.limit === undefined ? {} : { limit: options.limit }),
                    },
                });
                return {
                    transferId: chunk.transferId,
                    offset: chunk.offset,
                    bytes: base64ToBytes(chunk.content),
                    sizeBytes: chunk.sizeBytes,
                    eof: chunk.eof,
                    updatedAt: chunk.updatedAt,
                    ...(chunk.checksumSha256 ? { checksumSha256: chunk.checksumSha256 } : {}),
                };
            },
            discard: async (transferId) => {
                await this.discardTransferQuietly(transferId);
            },
        };
        this.permissions = {
            evaluate: async (request) => await this.evaluatePermission(request),
            evaluateBatch: async (requests) => await this.evaluatePermissions(requests),
            explain: async (request) => await this.explainPermission(request),
        };
        this.jobs = {
            create: async (type, payload = {}, options = {}) => {
                await this.requireFeature('jobs.background', 'Authority 当前版本尚未提供后台任务能力');
                await this.ensurePermission({ resource: 'jobs.background', target: type, reason: `创建后台任务 ${type}` });
                return await this.requestWithSession('/jobs/create', {
                    method: 'POST',
                    body: {
                        type,
                        payload,
                        ...(options?.timeoutMs != null ? { timeoutMs: options.timeoutMs } : {}),
                        ...(options?.idempotencyKey ? { idempotencyKey: options.idempotencyKey } : {}),
                        ...(options?.maxAttempts != null ? { maxAttempts: options.maxAttempts } : {}),
                    },
                });
            },
            get: async (id) => {
                return await this.requestWithSession(`/jobs/${encodeURIComponent(id)}`);
            },
            list: async () => {
                return await this.requestWithSession('/jobs');
            },
            listPage: async (input = {}) => {
                await this.requireFeature('diagnostics.jobsPage', 'Authority 当前版本尚未提供后台任务分页能力');
                return await this.requestWithSession('/jobs/list', {
                    method: 'POST',
                    body: input,
                });
            },
            cancel: async (id) => {
                return await this.requestWithSession(`/jobs/${encodeURIComponent(id)}/cancel`, {
                    method: 'POST',
                });
            },
            requeue: async (id) => {
                await this.requireFeature('jobs.safeRequeue', 'Authority 当前版本尚未提供后台任务安全重排能力');
                const job = await this.jobs.get(id);
                await this.ensurePermission({
                    resource: 'jobs.background',
                    target: job.type,
                    reason: `安全重新排队后台任务 ${job.type}`,
                });
                return await this.requestWithSession(`/jobs/${encodeURIComponent(id)}/requeue`, {
                    method: 'POST',
                });
            },
            waitForCompletion: async (id, options = {}) => {
                const pollIntervalMs = getWaitPollInterval(options.pollIntervalMs, 'job');
                const timeoutMs = getOptionalWaitTimeout(options.timeoutMs, 'job');
                const startedAt = Date.now();
                while (true) {
                    throwIfAborted(options.signal, 'job');
                    const job = await this.jobs.get(id);
                    await options.onProgress?.(job);
                    if (isTerminalJobStatus(job.status)) {
                        return job;
                    }
                    if (timeoutMs != null && Date.now() - startedAt >= timeoutMs) {
                        throw new Error(`Authority job ${id} did not complete within ${timeoutMs}ms`);
                    }
                    await waitForDelay(pollIntervalMs, options.signal, 'job');
                }
            },
            subscribe: async (id, options = {}) => {
                const pollIntervalMs = getWaitPollInterval(options.pollIntervalMs, 'job');
                let closed = false;
                let pollTimer = null;
                let lastSnapshot = null;
                const close = (subscription) => {
                    if (closed) {
                        return;
                    }
                    closed = true;
                    if (pollTimer) {
                        clearTimeout(pollTimer);
                        pollTimer = null;
                    }
                    subscription?.close();
                };
                const emitIfMatch = async (value, subscription) => {
                    if (!isJobRecord(value) || value.id !== id) {
                        return;
                    }
                    const snapshot = getJobSubscriptionSnapshot(value);
                    if (snapshot === lastSnapshot) {
                        return;
                    }
                    lastSnapshot = snapshot;
                    await options.onUpdate?.(value);
                    if (isTerminalJobStatus(value.status)) {
                        close(subscription);
                    }
                };
                const subscription = await this.events.subscribe({
                    eventNames: ['authority.job'],
                    onEvent: event => {
                        void emitIfMatch(event.data, subscription);
                    },
                });
                const poll = async () => {
                    if (closed) {
                        return;
                    }
                    try {
                        const job = await this.jobs.get(id);
                        await emitIfMatch(job, subscription);
                    }
                    finally {
                        if (!closed) {
                            pollTimer = setTimeout(() => {
                                void poll();
                            }, pollIntervalMs);
                        }
                    }
                };
                if (options.emitCurrent !== false) {
                    const job = await this.jobs.get(id);
                    await emitIfMatch(job, subscription);
                }
                if (!closed) {
                    pollTimer = setTimeout(() => {
                        void poll();
                    }, pollIntervalMs);
                }
                return {
                    close: () => close(subscription),
                };
            },
        };
        this.events = {
            subscribe: async (channelOrOptions, handler) => {
                const options = typeof channelOrOptions === 'string'
                    ? {
                        channel: channelOrOptions,
                        onEvent: handler,
                    }
                    : {
                        channel: channelOrOptions?.channel,
                        eventNames: channelOrOptions?.eventNames,
                        onEvent: channelOrOptions?.onEvent ?? handler,
                    };
                const channel = options.channel ?? `extension:${this.config.extensionId}`;
                const eventNames = options.eventNames ?? ['authority.connected', 'authority.job'];
                await this.ensurePermission({
                    resource: 'events.stream',
                    target: channel,
                    reason: `订阅事件流 ${channel}`,
                });
                const notify = (name, data) => {
                    options.onEvent?.({ name, data });
                };
                let closed = false;
                let source = null;
                let reconnectTimer = null;
                let connectController = null;
                let openSource;
                const scheduleReconnect = () => {
                    if (closed || reconnectTimer !== null)
                        return;
                    reconnectTimer = setTimeout(() => {
                        reconnectTimer = null;
                        void openSource().catch(error => {
                            if (closed)
                                return;
                            console.warn('Authority event stream reconnect failed', error);
                            scheduleReconnect();
                        });
                    }, 1_000);
                };
                openSource = async () => {
                    const controller = new AbortController();
                    connectController = controller;
                    let ticket;
                    try {
                        const response = await this.requestWithSession('/events/ticket', {
                            method: 'POST',
                            body: { channel },
                            signal: controller.signal,
                        });
                        ticket = oneTimeTicket(response.ticket);
                    }
                    finally {
                        if (connectController === controller)
                            connectController = null;
                    }
                    if (closed)
                        return;
                    const nextSource = new EventSource(buildEventStreamUrl(ticket), { withCredentials: true });
                    source = nextSource;
                    for (const name of eventNames) {
                        nextSource.addEventListener(name, event => {
                            const payload = event instanceof MessageEvent ? safeParse(event.data) : undefined;
                            notify(name, payload);
                        });
                    }
                    nextSource.onmessage = event => {
                        notify('message', safeParse(event.data));
                    };
                    nextSource.onerror = () => {
                        if (closed || source !== nextSource)
                            return;
                        nextSource.close();
                        source = null;
                        console.warn('Authority event stream disconnected for', this.config.extensionId, channel);
                        scheduleReconnect();
                    };
                };
                await openSource();
                return {
                    close: () => {
                        if (closed)
                            return;
                        closed = true;
                        connectController?.abort();
                        connectController = null;
                        if (reconnectTimer !== null)
                            clearTimeout(reconnectTimer);
                        reconnectTimer = null;
                        source?.close();
                        source = null;
                    },
                };
            },
        };
        this.modules = {
            list: async () => {
                await this.requireFeature('modules.enabled', 'Authority 当前版本尚未提供模块事务能力');
                const response = await this.requestWithSession('/modules');
                for (const manifest of response.modules) {
                    this.moduleManifests.set(manifest.id, structuredClone(manifest));
                }
                return response;
            },
            get: async (moduleId) => {
                const trimmedModuleId = trimModuleIdentifier(moduleId);
                await this.requireFeature('modules.enabled', 'Authority 当前版本尚未提供模块事务能力');
                const cached = this.moduleManifests.get(trimmedModuleId);
                if (cached) {
                    return structuredClone(cached);
                }
                const response = await this.requestWithSession(`/modules/${encodeURIComponent(trimmedModuleId)}`);
                this.moduleManifests.set(trimmedModuleId, structuredClone(response.module));
                return response.module;
            },
            execute: async (moduleId, transactionName, input, options) => {
                const trimmedModuleId = trimModuleIdentifier(moduleId);
                const trimmedTransactionName = trimModuleTransactionName(transactionName);
                // All local request shaping/validation must run before the
                // permission prompt so invalid local inputs never trigger a
                // user-facing permission request.
                const trimmedIdempotencyKey = options?.idempotencyKey?.trim();
                const timeoutMs = options?.timeoutMs;
                if (timeoutMs !== undefined && !(typeof timeoutMs === 'number' && Number.isSafeInteger(timeoutMs) && timeoutMs > 0 && timeoutMs <= 600_000)) {
                    throw new Error('Authority modules.execute timeoutMs must be an integer between 1 and 600000');
                }
                const body = {
                    ...(input !== undefined ? { input } : {}),
                    ...(trimmedIdempotencyKey ? { idempotencyKey: trimmedIdempotencyKey } : {}),
                    ...(timeoutMs !== undefined ? { options: { timeoutMs } } : {}),
                };
                await this.requireFeature('modules.enabled', 'Authority 当前版本尚未提供模块事务能力');
                const manifest = await this.modules.get(trimmedModuleId);
                const transaction = manifest.transactions[trimmedTransactionName];
                if (!transaction) {
                    throw new Error(`Authority module transaction not found: ${trimmedModuleId}:${trimmedTransactionName}`);
                }
                await this.ensurePermission({
                    resource: 'module.execute',
                    target: modulePermissionTarget(trimmedModuleId, trimmedTransactionName, transaction),
                    reason: `执行模块事务 ${trimmedModuleId}:${trimmedTransactionName}`,
                });
                for (const required of transaction.requiredResources) {
                    await this.ensurePermission({
                        resource: required.resource,
                        ...(required.target === undefined ? {} : { target: required.target }),
                        reason: required.reason ?? `模块事务 ${trimmedModuleId}:${trimmedTransactionName} 需要此能力`,
                    });
                }
                return await this.requestWithSession(`/modules/${encodeURIComponent(trimmedModuleId)}/transactions/${encodeURIComponent(trimmedTransactionName)}`, {
                    method: 'POST',
                    body,
                });
            },
        };
        this.agent = {
            listTools: async () => {
                const response = await this.requestWithSession('/agent/tools');
                return response.tools;
            },
            sessions: {
                create: async (request) => {
                    const workspaceId = request.workspaceId?.trim();
                    if (!workspaceId)
                        throw new Error('Agent workspaceId is required');
                    await this.ensurePermission({
                        resource: 'agent.run',
                        target: workspaceId,
                        reason: `在工作区 ${workspaceId} 创建 Agent 会话`,
                    });
                    const snapshot = await this.requestWithSession('/agent/sessions', {
                        method: 'POST',
                        body: { ...request, workspaceId },
                    });
                    this.rememberAgentSession(snapshot);
                    return snapshot;
                },
                listPage: async (request = {}) => {
                    const response = await this.requestWithSession('/agent/sessions/list', {
                        method: 'POST',
                        body: request,
                    });
                    this.rememberAgentSessionSummaries(response.sessions);
                    return response;
                },
                get: async (sessionId) => {
                    const snapshot = await this.requestWithSession(`/agent/sessions/${agentPathId(sessionId, 'sessionId')}`);
                    this.rememberAgentSession(snapshot);
                    return snapshot;
                },
                update: async (sessionId, request) => {
                    const snapshot = await this.requestWithSession(`/agent/sessions/${agentPathId(sessionId, 'sessionId')}/update`, { method: 'POST', body: request });
                    this.rememberAgentSession(snapshot);
                    return snapshot;
                },
                send: async (sessionId, request) => {
                    await this.ensureAgentSessionRunPermission(sessionId, '继续 Agent 会话');
                    const response = await this.requestWithSession(`/agent/sessions/${agentPathId(sessionId, 'sessionId')}/messages`, { method: 'POST', body: request });
                    this.rememberAgentSession(response.snapshot);
                    return response;
                },
                cancelRun: async (sessionId, runId) => {
                    const snapshot = await this.requestWithSession(`/agent/sessions/${agentPathId(sessionId, 'sessionId')}/runs/${agentPathId(runId, 'runId')}/cancel`, { method: 'POST' });
                    this.rememberAgentSession(snapshot);
                    return snapshot;
                },
                resumeRun: async (sessionId, runId) => {
                    await this.ensureAgentSessionRunPermission(sessionId, '恢复 Agent 运行');
                    const snapshot = await this.requestWithSession(`/agent/sessions/${agentPathId(sessionId, 'sessionId')}/runs/${agentPathId(runId, 'runId')}/resume`, { method: 'POST' });
                    this.rememberAgentSession(snapshot);
                    return snapshot;
                },
                waitForRun: async (sessionId, runId, options = {}) => {
                    const pollIntervalMs = getWaitPollInterval(options.pollIntervalMs, 'agent run');
                    const timeoutMs = getOptionalWaitTimeout(options.timeoutMs, 'agent run');
                    const startedAt = Date.now();
                    while (true) {
                        throwIfAborted(options.signal, 'agent run');
                        const elapsedMs = Date.now() - startedAt;
                        if (timeoutMs != null && elapsedMs >= timeoutMs) {
                            throw new Error(`Authority agent run ${runId} did not complete within ${timeoutMs}ms`);
                        }
                        const timeoutSignal = timeoutMs == null
                            ? undefined
                            : AbortSignal.timeout(Math.max(1, timeoutMs - elapsedMs));
                        const signal = options.signal && timeoutSignal
                            ? AbortSignal.any([options.signal, timeoutSignal])
                            : options.signal ?? timeoutSignal;
                        let snapshot;
                        try {
                            snapshot = await this.requestWithSession(`/agent/sessions/${agentPathId(sessionId, 'sessionId')}`, signal ? { signal } : {});
                        }
                        catch (error) {
                            if (options.signal?.aborted)
                                throw new Error('Authority agent run wait aborted');
                            if (timeoutSignal?.aborted && !options.signal?.aborted) {
                                throw new Error(`Authority agent run ${runId} did not complete within ${timeoutMs}ms`);
                            }
                            throw error;
                        }
                        this.rememberAgentSession(snapshot);
                        await options.onProgress?.(snapshot);
                        const run = snapshot.runs.find(item => item.id === runId);
                        if (!run)
                            throw new Error(`Authority agent run not found: ${runId}`);
                        if (isTerminalAgentSessionRunStatus(run.status) || run.status === 'suspended')
                            return snapshot;
                        const remainingMs = timeoutMs == null ? pollIntervalMs : timeoutMs - (Date.now() - startedAt);
                        await waitForDelay(Math.max(1, Math.min(pollIntervalMs, remainingMs)), options.signal, 'agent run');
                    }
                },
                subscribe: async (sessionId, options) => {
                    if (typeof options?.onSnapshot !== 'function') {
                        throw new Error('Authority Agent session subscriptions require an onSnapshot handler');
                    }
                    const id = agentValueId(sessionId, 'sessionId');
                    let closed = false;
                    let source = null;
                    let reconnectTimer = null;
                    let connectController = null;
                    let openSource;
                    const notifyError = () => {
                        try {
                            options.onError?.();
                        }
                        catch (error) {
                            console.warn('Authority Agent session error handler failed', error);
                        }
                    };
                    const scheduleReconnect = () => {
                        if (closed || reconnectTimer !== null)
                            return;
                        reconnectTimer = setTimeout(() => {
                            reconnectTimer = null;
                            void openSource().catch(error => {
                                if (closed)
                                    return;
                                console.warn('Authority Agent session reconnect failed', error);
                                notifyError();
                                scheduleReconnect();
                            });
                        }, 1_000);
                    };
                    openSource = async () => {
                        const controller = new AbortController();
                        connectController = controller;
                        let ticket;
                        try {
                            const response = await this.requestWithSession(`/agent/sessions/${agentPathId(id, 'sessionId')}/events-ticket`, { method: 'POST', signal: controller.signal });
                            ticket = agentValueId(response.ticket, 'stream ticket');
                        }
                        finally {
                            if (connectController === controller)
                                connectController = null;
                        }
                        if (closed)
                            return;
                        const nextSource = new EventSource(buildAgentSessionStreamUrl(ticket, id), {
                            withCredentials: true,
                        });
                        source = nextSource;
                        nextSource.addEventListener('authority.agent.session.snapshot', event => {
                            const snapshot = event instanceof MessageEvent ? safeParse(event.data) : undefined;
                            if (!isAgentSessionSnapshot(snapshot))
                                return;
                            this.rememberAgentSession(snapshot);
                            void Promise.resolve(options.onSnapshot(snapshot)).catch(error => {
                                console.warn('Authority Agent session snapshot handler failed', error);
                            });
                        });
                        nextSource.addEventListener('authority.agent.session.event', event => {
                            const update = event instanceof MessageEvent ? safeParse(event.data) : undefined;
                            if (!isAgentSessionEvent(update))
                                return;
                            void Promise.resolve(options.onEvent?.(update)).catch(error => {
                                console.warn('Authority Agent session event handler failed', error);
                            });
                        });
                        nextSource.onerror = () => {
                            if (closed || source !== nextSource)
                                return;
                            nextSource.close();
                            source = null;
                            notifyError();
                            scheduleReconnect();
                        };
                    };
                    await openSource();
                    return {
                        close: () => {
                            if (closed)
                                return;
                            closed = true;
                            connectController?.abort();
                            connectController = null;
                            if (reconnectTimer !== null)
                                clearTimeout(reconnectTimer);
                            reconnectTimer = null;
                            source?.close();
                            source = null;
                        },
                    };
                },
            },
            browser: {
                registerTools: async (request) => {
                    const browserInstanceId = request.browserInstanceId?.trim();
                    if (!browserInstanceId) {
                        throw new Error('Browser instance id is required');
                    }
                    await this.ensurePermission({
                        resource: 'agent.browser',
                        target: browserInstanceId,
                        reason: '向 Agent 注册浏览器工具',
                    });
                    return await this.requestWithSession('/agent/browser-tools/register', {
                        method: 'POST',
                        body: { ...request, browserInstanceId },
                    });
                },
                claim: async (request) => {
                    const browserInstanceId = agentValueId(request.browserInstanceId, 'browserInstanceId');
                    await this.ensurePermission({
                        resource: 'agent.browser',
                        target: browserInstanceId,
                        reason: '领取 Agent 浏览器工具任务',
                    });
                    return await this.requestWithSession('/agent/browser-tools/claim', {
                        method: 'POST',
                        body: { ...request, browserInstanceId },
                    });
                },
                submitResult: async (request) => {
                    const browserInstanceId = agentValueId(request.browserInstanceId, 'browserInstanceId');
                    await this.ensurePermission({
                        resource: 'agent.browser',
                        target: browserInstanceId,
                        reason: '提交 Agent 浏览器工具结果',
                    });
                    return await this.requestWithSession('/agent/browser-tools/result', {
                        method: 'POST',
                        body: { ...request, browserInstanceId },
                    });
                },
            },
            admin: {
                profiles: {
                    list: async () => {
                        const response = await this.requestWithSession('/admin/agent/profiles');
                        return response.profiles;
                    },
                    get: async (profileId) => {
                        return await this.requestWithSession(`/admin/agent/profiles/${agentPathId(profileId, 'profileId')}`);
                    },
                    upsert: async (profile) => {
                        return await this.requestWithSession('/admin/agent/profiles', {
                            method: 'POST',
                            body: profile,
                        });
                    },
                    delete: async (profileId) => {
                        const response = await this.requestWithSession(`/admin/agent/profiles/${agentPathId(profileId, 'profileId')}/delete`, { method: 'POST' });
                        return response.deleted;
                    },
                },
                sessions: {
                    listPage: async (request = {}) => {
                        const response = await this.requestWithSession('/admin/agent/sessions/list', {
                            method: 'POST',
                            body: request,
                        });
                        this.rememberAgentSessionSummaries(response.sessions);
                        return response;
                    },
                    get: async (sessionId) => {
                        const snapshot = await this.requestWithSession(`/admin/agent/sessions/${agentPathId(sessionId, 'sessionId')}`);
                        this.rememberAgentSession(snapshot);
                        return snapshot;
                    },
                    cancelRun: async (sessionId, runId) => {
                        const snapshot = await this.requestWithSession(`/admin/agent/sessions/${agentPathId(sessionId, 'sessionId')}/runs/${agentPathId(runId, 'runId')}/cancel`, {
                            method: 'POST',
                        });
                        this.rememberAgentSession(snapshot);
                        return snapshot;
                    },
                    resolveApproval: async (sessionId, approvalId, request) => {
                        const snapshot = await this.requestWithSession(`/admin/agent/sessions/${agentPathId(sessionId, 'sessionId')}/approvals/${agentPathId(approvalId, 'approvalId')}/resolve`, { method: 'POST', body: request });
                        this.rememberAgentSession(snapshot);
                        return snapshot;
                    },
                },
                workspaces: {
                    list: async () => {
                        const response = await this.requestWithSession('/admin/agent/workspaces');
                        return response.workspaces;
                    },
                    register: async (request) => {
                        return await this.requestWithSession('/admin/agent/workspaces', {
                            method: 'POST',
                            body: request,
                        });
                    },
                    get: async (workspaceId) => {
                        return await this.requestWithSession(`/admin/agent/workspaces/${agentPathId(workspaceId, 'workspaceId')}`);
                    },
                    status: async (workspaceId) => {
                        return await this.requestWithSession(`/admin/agent/workspaces/${agentPathId(workspaceId, 'workspaceId')}/status`);
                    },
                    commits: async (workspaceId, limit = 100) => {
                        if (!Number.isSafeInteger(limit) || limit < 1 || limit > 500) {
                            throw new Error('Authority agent workspace commit limit must be an integer between 1 and 500');
                        }
                        return await this.requestWithSession(`/admin/agent/workspaces/${agentPathId(workspaceId, 'workspaceId')}/commits?limit=${limit}`);
                    },
                    diff: async (workspaceId, options = {}) => {
                        const query = new URLSearchParams();
                        if (options.from !== undefined)
                            query.set('from', options.from === null ? 'empty' : options.from);
                        if (options.to !== undefined)
                            query.set('to', options.to === null ? 'empty' : options.to);
                        const suffix = query.size > 0 ? `?${query.toString()}` : '';
                        return await this.requestWithSession(`/admin/agent/workspaces/${agentPathId(workspaceId, 'workspaceId')}/diff${suffix}`);
                    },
                    checkpoint: async (workspaceId, request) => {
                        return await this.requestWithSession(`/admin/agent/workspaces/${agentPathId(workspaceId, 'workspaceId')}/checkpoints`, { method: 'POST', body: request });
                    },
                    rollback: async (workspaceId, request) => {
                        return await this.requestWithSession(`/admin/agent/workspaces/${agentPathId(workspaceId, 'workspaceId')}/rollback`, { method: 'POST', body: request });
                    },
                    resumeRollback: async (workspaceId) => {
                        return await this.requestWithSession(`/admin/agent/workspaces/${agentPathId(workspaceId, 'workspaceId')}/rollback/resume`, { method: 'POST' });
                    },
                },
            },
        };
    }
    async init(force = false) {
        if (force) {
            this.session = null;
            this.sessionPromise = null;
        }
        return await this.ensureInitialized();
    }
    setConfig(config) {
        this.config = cloneInitConfig(config);
    }
    async probe(force = false) {
        if (force) {
            this.probeSnapshot = null;
            this.probePromise = null;
        }
        return cloneAuthorityProbe(await this.ensureProbe());
    }
    getProbe() {
        return this.probeSnapshot ? cloneAuthorityProbe(this.probeSnapshot) : null;
    }
    hasFeature(feature) {
        if (this.probeSnapshot) {
            return getFeatureAvailability(this.probeSnapshot.features, feature);
        }
        if (this.session) {
            return getFeatureAvailability(this.session.features, feature);
        }
        return false;
    }
    async requireFeature(feature, message) {
        if (this.hasFeature(feature)) {
            return;
        }
        const probe = await this.ensureProbe();
        if (getFeatureAvailability(probe.features, feature)) {
            return;
        }
        throw new Error(message ?? `Authority feature not available: ${feature}`);
    }
    /**
     * Colon-form shorthand for {@link AuthorityClient.modules.execute}:
     * `<moduleId>:<transactionName>`. The shorthand is parsed on the first
     * colon so transaction names are free to use other delimiters; a
     * transaction name that itself contains `:` is rejected as ambiguous.
     * All validation runs before any permission prompt is shown.
     */
    async tx(name, input, options) {
        if (typeof name !== 'string' || !name.includes(':')) {
            throw new Error('Authority tx shorthand must be colon form: `<moduleId>:<transactionName>`');
        }
        const colonIndex = name.indexOf(':');
        const moduleId = name.slice(0, colonIndex).trim();
        const transactionName = name.slice(colonIndex + 1);
        if (!moduleId) {
            throw new Error('Authority tx shorthand moduleId must be non-empty');
        }
        if (!transactionName.trim()) {
            throw new Error('Authority tx shorthand transactionName must be non-empty');
        }
        if (transactionName.includes(':')) {
            throw new Error('Authority tx shorthand transactionName must not contain \':\'');
        }
        return await this.modules.execute(moduleId, transactionName, input, options);
    }
    getSession() {
        if (!this.session) {
            return null;
        }
        return {
            ...this.session,
            grants: this.buildGrantSnapshot(),
            policies: [...this.session.policies],
        };
    }
    getCapabilities() {
        const session = this.getSession();
        if (!session) {
            return null;
        }
        return {
            declaredPermissions: this.config.declaredPermissions,
            features: session.features,
            grants: groupByResource(session.grants),
            policies: groupByResource(session.policies),
            probe: this.getProbe(),
        };
    }
    async ensurePermission(request) {
        const evaluation = await this.evaluatePermission(request);
        const resolved = evaluation.decision === 'prompt'
            ? await this.requestPermission(request, evaluation)
            : evaluation;
        if (resolved.decision !== 'granted') {
            const message = getPermissionFailureMessage(this.config.displayName, resolved.resource, resolved.target, resolved.decision);
            toastr.warning(message, 'Authority');
            if (resolved.decision === 'denied' || resolved.decision === 'blocked') {
                void openSecurityCenter({ focusExtensionId: this.config.extensionId });
            }
            throw new AuthorityPermissionError(message, {
                code: getAuthorityPermissionErrorCode(resolved.decision),
                decision: resolved.decision,
                key: resolved.key,
                riskLevel: resolved.riskLevel,
                target: resolved.target,
                resource: resolved.resource,
            });
        }
        return resolved;
    }
    async requestPermission(request, evaluation) {
        const current = evaluation ?? await this.evaluatePermission(request);
        if (current.decision === 'granted') {
            return current;
        }
        if (current.decision === 'denied' || current.decision === 'blocked') {
            return current;
        }
        const promptContext = {
            extensionDisplayName: this.config.displayName,
            extensionId: this.config.extensionId,
            resource: current.resource,
            target: current.target,
            riskLevel: current.riskLevel,
        };
        if (request.reason) {
            promptContext.reason = request.reason;
        }
        const choice = await showPermissionPrompt(promptContext);
        if (!choice) {
            return current;
        }
        const grant = await this.requestWithSession('/permissions/resolve', {
            method: 'POST',
            body: {
                ...request,
                choice,
            },
        });
        this.mergeGrant(grant);
        return {
            decision: grant.status,
            key: grant.key,
            riskLevel: grant.riskLevel,
            target: grant.target,
            resource: grant.resource,
            grant,
        };
    }
    async evaluatePermissions(requests) {
        if (requests.length === 0) {
            return [];
        }
        const response = await this.requestWithSession('/permissions/evaluate-batch', {
            method: 'POST',
            body: { requests },
        });
        return response.results;
    }
    async explainPermission(request) {
        const evaluation = await this.evaluatePermission(request);
        return {
            evaluation,
            message: getPermissionEvaluationMessage(this.config.displayName, evaluation.resource, evaluation.target, evaluation.decision),
        };
    }
    warnHeavyTriviumDiagnostics(operation, database) {
        console.warn(`[Authority] Trivium ${operation} on ${database} is a diagnostics/maintenance path and may scan mapping or node sets. Avoid using it on hot user-interaction paths.`);
    }
    async openSecurityCenter() {
        await openSecurityCenter({ focusExtensionId: this.config.extensionId });
    }
    async evaluatePermission(request) {
        return await this.requestWithSession('/permissions/evaluate', {
            method: 'POST',
            body: request,
        });
    }
    async getEffectiveInlineThresholdBytes(key) {
        const sessionThreshold = this.session?.limits.effectiveInlineThresholdBytes[key]?.bytes;
        if (typeof sessionThreshold === 'number' && Number.isFinite(sessionThreshold) && sessionThreshold > 0) {
            return sessionThreshold;
        }
        try {
            const probe = this.probeSnapshot ?? await this.ensureProbe();
            return probe.limits.effectiveInlineThresholdBytes[key].bytes;
        }
        catch {
            return SDK_TRANSFER_INLINE_THRESHOLD_BYTES;
        }
    }
    async getTransferStatus(transferId) {
        return await this.requestWithSession(`/transfers/${encodeURIComponent(transferId)}/status`, {
            method: 'POST',
        });
    }
    async ensureInitialized() {
        if (this.session) {
            return this.session;
        }
        if (!this.sessionPromise) {
            this.sessionPromise = authorityRequest('/session/init', {
                method: 'POST',
                body: cloneInitConfig(this.config),
            }).then(session => {
                this.session = {
                    ...session,
                    grants: [...session.grants],
                    policies: [...session.policies],
                };
                return session;
            }).finally(() => {
                this.sessionPromise = null;
            });
        }
        return await this.sessionPromise;
    }
    async ensureProbe() {
        if (this.probeSnapshot) {
            return this.probeSnapshot;
        }
        if (!this.probePromise) {
            this.probePromise = authorityRequest('/probe', {
                method: 'POST',
            }).then(probe => {
                this.probeSnapshot = cloneAuthorityProbe(probe);
                return this.probeSnapshot;
            }).finally(() => {
                this.probePromise = null;
            });
        }
        return await this.probePromise;
    }
    async bulkUpsertTriviumRequest(input) {
        return await this.requestWithSession('/trivium/bulk-upsert', {
            method: 'POST',
            body: input,
        });
    }
    async bulkDeleteTriviumRequest(input) {
        return await this.requestWithSession('/trivium/bulk-delete', {
            method: 'POST',
            body: input,
        });
    }
    async bulkLinkTriviumRequest(input) {
        return await this.requestWithSession('/trivium/bulk-link', {
            method: 'POST',
            body: input,
        });
    }
    async bulkUnlinkTriviumRequest(input) {
        return await this.requestWithSession('/trivium/bulk-unlink', {
            method: 'POST',
            body: input,
        });
    }
    async bulkUpsertTriviumChunked(input, options = {}) {
        const database = getTriviumDatabaseName(input.database);
        await this.requireFeature('trivium.bulkMutations', 'Authority 当前版本尚未提供 Trivium 分块批量写入能力');
        await this.ensurePermission({
            resource: 'trivium.private',
            target: database,
            reason: `分块批量写入或更新 Trivium 节点（${database}）`,
        });
        const result = await this.runTriviumChunkedMutation({
            ...input,
            database,
        }, options, async (chunkInput) => await this.bulkUpsertTriviumRequest(chunkInput));
        const items = result.chunks.flatMap(chunk => {
            const response = chunk.response;
            if (!response) {
                return [];
            }
            return response.items.map(item => {
                const globalIndex = chunk.itemOffset + item.index;
                return {
                    ...item,
                    index: globalIndex,
                    globalIndex,
                    chunkIndex: chunk.chunkIndex,
                    chunkItemIndex: item.index,
                };
            });
        });
        return {
            ...result,
            items,
        };
    }
    async bulkDeleteTriviumChunked(input, options = {}) {
        const database = getTriviumDatabaseName(input.database);
        await this.requireFeature('trivium.bulkMutations', 'Authority 当前版本尚未提供 Trivium 分块批量删除能力');
        await this.ensurePermission({
            resource: 'trivium.private',
            target: database,
            reason: `分块批量删除 Trivium 节点（${database}）`,
        });
        return await this.runTriviumChunkedMutation({
            ...input,
            database,
        }, options, async (chunkInput) => await this.bulkDeleteTriviumRequest(chunkInput));
    }
    async bulkLinkTriviumChunked(input, options = {}) {
        const database = getTriviumDatabaseName(input.database);
        await this.requireFeature('trivium.bulkMutations', 'Authority 当前版本尚未提供 Trivium 分块批量建边能力');
        await this.ensurePermission({
            resource: 'trivium.private',
            target: database,
            reason: `分块批量建立 Trivium 图边（${database}）`,
        });
        return await this.runTriviumChunkedMutation({
            ...input,
            database,
        }, options, async (chunkInput) => await this.bulkLinkTriviumRequest(chunkInput));
    }
    async bulkUnlinkTriviumChunked(input, options = {}) {
        const database = getTriviumDatabaseName(input.database);
        await this.requireFeature('trivium.bulkMutations', 'Authority 当前版本尚未提供 Trivium 分块批量删边能力');
        await this.ensurePermission({
            resource: 'trivium.private',
            target: database,
            reason: `分块批量删除 Trivium 图边（${database}）`,
        });
        return await this.runTriviumChunkedMutation({
            ...input,
            database,
        }, options, async (chunkInput) => await this.bulkUnlinkTriviumRequest(chunkInput));
    }
    async runTriviumChunkedMutation(input, options, execute) {
        const chunks = splitAuthorityItemsIntoChunks(input.items, options);
        const startedAt = Date.now();
        const results = [];
        const failures = [];
        let successCount = 0;
        let failureCount = 0;
        let completedItems = 0;
        for (const chunk of chunks) {
            const chunkStartedAt = Date.now();
            try {
                const response = await execute({
                    ...input,
                    items: chunk.items,
                });
                const normalizedFailures = response.failures.map(failure => {
                    const globalIndex = chunk.itemOffset + failure.index;
                    return {
                        index: globalIndex,
                        globalIndex,
                        chunkIndex: chunk.chunkIndex,
                        chunkItemIndex: failure.index,
                        itemOffset: chunk.itemOffset,
                        kind: 'item',
                        message: failure.message,
                    };
                });
                const chunkResult = {
                    chunkIndex: chunk.chunkIndex,
                    itemOffset: chunk.itemOffset,
                    itemCount: chunk.itemCount,
                    estimatedBytes: chunk.estimatedBytes,
                    elapsedMs: Date.now() - chunkStartedAt,
                    successCount: response.successCount,
                    failureCount: response.failureCount,
                    response,
                };
                results.push(chunkResult);
                failures.push(...normalizedFailures);
                successCount += response.successCount;
                failureCount += response.failureCount;
                completedItems += chunk.itemCount;
                if (options.onProgress) {
                    await options.onProgress({
                        totalChunks: chunks.length,
                        completedChunks: results.length,
                        totalItems: input.items.length,
                        completedItems,
                        successCount,
                        failureCount,
                        elapsedMs: Date.now() - startedAt,
                        lastChunk: chunkResult,
                    });
                }
            }
            catch (error) {
                const message = error instanceof Error ? error.message : String(error);
                const chunkFailures = chunk.items.map((_, index) => {
                    const globalIndex = chunk.itemOffset + index;
                    return {
                        index: globalIndex,
                        globalIndex,
                        chunkIndex: chunk.chunkIndex,
                        chunkItemIndex: index,
                        itemOffset: chunk.itemOffset,
                        kind: 'chunk',
                        message,
                    };
                });
                const chunkResult = {
                    chunkIndex: chunk.chunkIndex,
                    itemOffset: chunk.itemOffset,
                    itemCount: chunk.itemCount,
                    estimatedBytes: chunk.estimatedBytes,
                    elapsedMs: Date.now() - chunkStartedAt,
                    successCount: 0,
                    failureCount: chunk.itemCount,
                    error: message,
                };
                results.push(chunkResult);
                failures.push(...chunkFailures);
                failureCount += chunk.itemCount;
                completedItems += chunk.itemCount;
                if (options.onProgress) {
                    await options.onProgress({
                        totalChunks: chunks.length,
                        completedChunks: results.length,
                        totalItems: input.items.length,
                        completedItems,
                        successCount,
                        failureCount,
                        elapsedMs: Date.now() - startedAt,
                        lastChunk: chunkResult,
                    });
                }
                if (options.continueOnChunkError === false) {
                    throw new Error(`${message} (chunk ${chunk.chunkIndex + 1}/${chunks.length})`);
                }
            }
        }
        return {
            totalCount: input.items.length,
            successCount,
            failureCount,
            failures,
            chunkCount: chunks.length,
            elapsedMs: Date.now() - startedAt,
            chunks: results,
        };
    }
    rememberAgentSession(snapshot) {
        this.agentSessionWorkspaces.set(snapshot.session.id, snapshot.session.workspaceId);
    }
    rememberAgentSessionSummaries(sessions) {
        for (const session of sessions) {
            this.agentSessionWorkspaces.set(session.id, session.workspaceId);
        }
    }
    async ensureAgentSessionRunPermission(sessionId, reason) {
        const id = agentValueId(sessionId, 'sessionId');
        let workspaceId = this.agentSessionWorkspaces.get(id);
        if (!workspaceId) {
            const snapshot = await this.requestWithSession(`/agent/sessions/${agentPathId(id, 'sessionId')}`);
            this.rememberAgentSession(snapshot);
            workspaceId = snapshot.session.workspaceId;
        }
        await this.ensurePermission({
            resource: 'agent.run',
            target: workspaceId,
            reason: `${reason}（${workspaceId}）`,
        });
    }
    async requestWithSession(path, options = {}, retried = false) {
        const session = await waitForSignal(this.ensureInitialized(), options.signal);
        try {
            const requestOptions = {
                body: options.body,
                sessionToken: session.sessionToken,
                ...(options.signal ? { signal: options.signal } : {}),
            };
            if (options.method) {
                return await authorityRequest(path, {
                    ...requestOptions,
                    method: options.method,
                });
            }
            return await authorityRequest(path, requestOptions);
        }
        catch (error) {
            if (!retried && isInvalidSessionError(error)) {
                await waitForSignal(this.init(true), options.signal);
                return await this.requestWithSession(path, options, true);
            }
            throw error;
        }
    }
    async putBlobWithTransfer(input, bytes) {
        const transfer = await this.initializeTransfer('storage.blob', 'storageBlobWrite');
        try {
            await this.appendTransferBytes(transfer, bytes);
            const status = await this.getTransferStatus(transfer.transferId);
            const request = {
                transferId: transfer.transferId,
                name: input.name,
                ...(input.contentType ? { contentType: input.contentType } : {}),
                ...(status.checksumSha256 ? { expectedChecksumSha256: status.checksumSha256 } : {}),
            };
            return await this.requestWithSession('/storage/blob/commit-transfer', {
                method: 'POST',
                body: request,
            });
        }
        catch (error) {
            await this.discardTransferQuietly(transfer.transferId);
            throw error;
        }
    }
    async getBlobWithTransfer(id) {
        const opened = await this.requestWithSession('/storage/blob/open-read', {
            method: 'POST',
            body: { id },
        });
        if (opened.mode === 'inline') {
            return {
                record: opened.record,
                content: opened.content,
                encoding: opened.encoding,
            };
        }
        try {
            const bytes = await this.readTransferBytes(opened.transfer);
            return {
                record: opened.record,
                content: bytesToBase64(bytes),
                encoding: opened.encoding,
            };
        }
        finally {
            await this.discardTransferQuietly(opened.transfer.transferId);
        }
    }
    async fetchHttpWithTransfer(input) {
        const bodyEncoding = input.bodyEncoding ?? 'utf8';
        const bodyBytes = input.body === undefined ? undefined : contentToBytes(input.body, bodyEncoding);
        const requestInlineThreshold = await this.getEffectiveInlineThresholdBytes('httpFetchRequest');
        if (!bodyBytes || bodyBytes.byteLength <= requestInlineThreshold) {
            const opened = await this.requestWithSession('/http/fetch-open', {
                method: 'POST',
                body: input,
            });
            return await this.resolveHttpFetchOpenResponse(opened);
        }
        const transfer = await this.initializeTransfer('http.fetch', 'httpFetchRequest');
        try {
            await this.appendTransferBytes(transfer, bodyBytes);
            const opened = await this.requestWithSession('/http/fetch-open', {
                method: 'POST',
                body: {
                    url: input.url,
                    ...(input.method === undefined ? {} : { method: input.method }),
                    ...(input.headers === undefined ? {} : { headers: input.headers }),
                    ...(input.bodyEncoding === undefined ? {} : { bodyEncoding: input.bodyEncoding }),
                    bodyTransferId: transfer.transferId,
                },
            });
            return await this.resolveHttpFetchOpenResponse(opened);
        }
        catch (error) {
            await this.discardTransferQuietly(transfer.transferId);
            throw error;
        }
    }
    async resolveHttpFetchOpenResponse(opened) {
        if (opened.mode === 'inline') {
            return {
                url: opened.url,
                hostname: opened.hostname,
                status: opened.status,
                ok: opened.ok,
                headers: opened.headers,
                body: opened.body,
                bodyEncoding: opened.bodyEncoding,
                contentType: opened.contentType,
            };
        }
        try {
            const bytes = await this.readTransferBytes(opened.transfer);
            return {
                url: opened.url,
                hostname: opened.hostname,
                status: opened.status,
                ok: opened.ok,
                headers: opened.headers,
                body: bytesToHttpContent(bytes, opened.bodyEncoding),
                bodyEncoding: opened.bodyEncoding,
                contentType: opened.contentType,
            };
        }
        finally {
            await this.discardTransferQuietly(opened.transfer.transferId);
        }
    }
    async writePrivateFileWithTransfer(path, bytes, options) {
        const transfer = await this.initializeTransfer('fs.private', 'privateFileWrite');
        try {
            await this.appendTransferBytes(transfer, bytes);
            const status = await this.getTransferStatus(transfer.transferId);
            const request = {
                transferId: transfer.transferId,
                path,
                ...(options.createParents === undefined ? {} : { createParents: options.createParents }),
                ...(status.checksumSha256 ? { expectedChecksumSha256: status.checksumSha256 } : {}),
            };
            const response = await this.requestWithSession('/fs/private/write-file-transfer', {
                method: 'POST',
                body: request,
            });
            return response.entry;
        }
        catch (error) {
            await this.discardTransferQuietly(transfer.transferId);
            throw error;
        }
    }
    async readPrivateFileWithTransfer(path, options) {
        const opened = await this.requestWithSession('/fs/private/open-read', {
            method: 'POST',
            body: {
                path,
                ...(options.encoding === undefined ? {} : { encoding: options.encoding }),
            },
        });
        if (opened.mode === 'inline') {
            return {
                entry: opened.entry,
                content: opened.content,
                encoding: opened.encoding,
            };
        }
        try {
            const bytes = await this.readTransferBytes(opened.transfer);
            return {
                entry: opened.entry,
                content: bytesToContent(bytes, opened.encoding),
                encoding: opened.encoding,
            };
        }
        finally {
            await this.discardTransferQuietly(opened.transfer.transferId);
        }
    }
    async initializeTransfer(resource, purpose) {
        return await this.requestWithSession('/transfers/init', {
            method: 'POST',
            body: {
                resource,
                ...(purpose ? { purpose } : {}),
            },
        });
    }
    async appendTransferBytes(transfer, bytes) {
        const status = await this.getTransferStatus(transfer.transferId);
        if (status.sizeBytes > bytes.byteLength) {
            throw new Error(`Transfer status size ${status.sizeBytes} exceeds payload size ${bytes.byteLength}`);
        }
        const chunkSize = status.chunkSize > 0
            ? status.chunkSize
            : transfer.chunkSize > 0
                ? transfer.chunkSize
                : SDK_TRANSFER_INLINE_THRESHOLD_BYTES;
        let offset = status.sizeBytes;
        while (offset < bytes.byteLength) {
            const chunk = bytes.subarray(offset, offset + chunkSize);
            await this.requestWithSession(`/transfers/${encodeURIComponent(transfer.transferId)}/append`, {
                method: 'POST',
                body: {
                    offset,
                    content: bytesToBase64(chunk),
                },
            });
            offset += chunk.byteLength;
        }
    }
    async readTransferBytes(transfer) {
        const status = await this.getTransferStatus(transfer.transferId);
        if (status.sizeBytes <= 0) {
            return new Uint8Array(0);
        }
        const chunkSize = status.chunkSize > 0
            ? status.chunkSize
            : transfer.chunkSize > 0
                ? transfer.chunkSize
                : SDK_TRANSFER_INLINE_THRESHOLD_BYTES;
        const result = new Uint8Array(status.sizeBytes);
        let offset = 0;
        while (offset < status.sizeBytes) {
            const chunk = await this.requestWithSession(`/transfers/${encodeURIComponent(transfer.transferId)}/read`, {
                method: 'POST',
                body: {
                    offset,
                    limit: chunkSize,
                },
            });
            const bytes = base64ToBytes(chunk.content);
            if (bytes.byteLength === 0 && !chunk.eof) {
                throw new Error('Transfer read stalled before EOF');
            }
            result.set(bytes, offset);
            offset += bytes.byteLength;
            if (chunk.eof) {
                return offset === result.length ? result : result.subarray(0, offset);
            }
        }
        return result;
    }
    async discardTransferQuietly(transferId) {
        try {
            await this.requestWithSession(`/transfers/${encodeURIComponent(transferId)}/discard`, {
                method: 'POST',
            });
        }
        catch {
            return;
        }
    }
    mergeGrant(grant) {
        this.runtimeGrants.set(grant.key, grant);
        if (!this.session) {
            return;
        }
        if (grant.scope === 'persistent') {
            this.session = {
                ...this.session,
                grants: [
                    ...this.session.grants.filter(item => item.key !== grant.key),
                    grant,
                ],
            };
        }
    }
    buildGrantSnapshot() {
        if (!this.session) {
            return [];
        }
        const grants = new Map();
        for (const grant of this.session.grants) {
            grants.set(grant.key, grant);
        }
        for (const grant of this.runtimeGrants.values()) {
            grants.set(grant.key, grant);
        }
        return [...grants.values()].sort((left, right) => left.key.localeCompare(right.key));
    }
}
function cloneInitConfig(config) {
    const clone = {
        extensionId: config.extensionId,
        displayName: config.displayName,
        version: config.version,
        installType: config.installType,
        declaredPermissions: JSON.parse(JSON.stringify(config.declaredPermissions ?? {})),
    };
    if (config.uiLabel) {
        clone.uiLabel = config.uiLabel;
    }
    return clone;
}
function cloneAuthorityProbe(probe) {
    return JSON.parse(JSON.stringify(probe));
}
function groupByResource(items) {
    const result = {
        'storage.kv': [],
        'storage.blob': [],
        'fs.private': [],
        'sql.private': [],
        'trivium.private': [],
        'http.fetch': [],
        'jobs.background': [],
        'events.stream': [],
        'module.execute': [],
        'agent.run': [],
        'agent.browser': [],
    };
    for (const item of items) {
        result[item.resource].push(item);
    }
    return result;
}
function safeParse(value) {
    try {
        return JSON.parse(value);
    }
    catch {
        return value;
    }
}
function isAgentSessionSnapshot(value) {
    if (!isObjectRecord(value) || !isObjectRecord(value.session))
        return false;
    return typeof value.session.id === 'string'
        && typeof value.session.workspaceId === 'string'
        && typeof value.lastSequence === 'number'
        && Array.isArray(value.refs)
        && Array.isArray(value.conversation)
        && Array.isArray(value.runs)
        && Array.isArray(value.steps)
        && Array.isArray(value.generations)
        && Array.isArray(value.invocations)
        && Array.isArray(value.approvals)
        && Array.isArray(value.pendingMessages);
}
function isAgentSessionEvent(value) {
    return isObjectRecord(value)
        && typeof value.sessionId === 'string'
        && typeof value.sequence === 'number'
        && typeof value.type === 'string'
        && typeof value.timestamp === 'string';
}
function isObjectRecord(value) {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
}
function oneTimeTicket(value) {
    if (typeof value !== 'string' || !/^[A-Za-z0-9_-]{32,128}$/.test(value)) {
        throw new Error('Authority event stream returned an invalid one-time ticket');
    }
    return value;
}
function agentPathId(value, label) {
    return encodeURIComponent(agentValueId(value, label));
}
function agentValueId(value, label) {
    if (typeof value !== 'string' || !value.trim()) {
        throw new Error(`Authority agent ${label} must be a non-empty string`);
    }
    return value.trim();
}
function getSqlDatabaseName(value) {
    return typeof value === 'string' && value.trim() ? value.trim() : 'default';
}
function getTriviumDatabaseName(value) {
    return typeof value === 'string' && value.trim() ? value.trim() : 'default';
}
/**
 * Module identifier pattern mirroring the server-side
 * `MODULE_ID_PATTERN` (see `module-host-service.ts`). Lowercase alphanumeric
 * start, followed by up to 63 lowercase alphanumeric / `.` / `_` / `-`
 * characters. Rejects `:` and `/` (and any other path/permission-target
 * delimiter) before any permission prompt is shown.
 */
const MODULE_ID_PATTERN = /^[a-z0-9][a-z0-9._-]{0,63}$/;
/**
 * Validates and normalizes a module identifier for SDK-side module routes.
 * Mirrors the server-side `MODULE_ID_PATTERN` so callers cannot build
 * malformed `/modules/:moduleId` routes or ambiguous permission targets.
 */
function trimModuleIdentifier(value) {
    if (typeof value !== 'string') {
        throw new Error('Authority modules moduleId must be a non-empty string');
    }
    const trimmed = value.trim();
    if (!trimmed) {
        throw new Error('Authority modules moduleId must be a non-empty string');
    }
    if (!MODULE_ID_PATTERN.test(trimmed)) {
        throw new Error('Authority modules moduleId must match /^[a-z0-9][a-z0-9._-]{0,63}$/ and must not contain \':\' or \'/\'');
    }
    return trimmed;
}
/**
 * Validates and normalizes a module transaction name. Rejects non-strings,
 * empty-after-trim values, and names containing `:` so the combined
 * `${moduleId}:${transactionName}` permission target stays unambiguous.
 */
function trimModuleTransactionName(value) {
    if (typeof value !== 'string') {
        throw new Error('Authority modules transactionName must be a non-empty string');
    }
    if (value.includes(':')) {
        throw new Error('Authority modules transactionName must not contain \':\'');
    }
    const trimmed = value.trim();
    if (!trimmed) {
        throw new Error('Authority modules transactionName must be a non-empty string');
    }
    return trimmed;
}
function modulePermissionTarget(moduleId, transactionName, transaction) {
    switch (transaction.permissionTarget.kind) {
        case 'module':
            return moduleId;
        case 'transaction':
            return `${moduleId}:${transactionName}`;
        case 'custom':
            return transaction.permissionTarget.target;
    }
}
//# sourceMappingURL=client.js.map
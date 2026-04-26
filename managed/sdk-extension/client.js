import { authorityRequest, buildEventStreamUrl, hostnameFromUrl, isInvalidSessionError } from './api.js';
import { showPermissionPrompt } from './permission-prompt.js';
import { openSecurityCenter } from './security-center.js';
const SDK_TRANSFER_INLINE_THRESHOLD_BYTES = 256 * 1024;
const DEFAULT_TRIVIUM_CHUNK_ITEMS = 128;
const DEFAULT_TRIVIUM_CHUNK_BYTES = 256 * 1024;
const UTF8_ENCODER = new TextEncoder();
export class AuthorityClient {
    config;
    storage;
    fs;
    sql;
    trivium;
    http;
    jobs;
    events;
    session = null;
    sessionPromise = null;
    probeSnapshot = null;
    probePromise = null;
    runtimeGrants = new Map();
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
                    if (bytes.byteLength > SDK_TRANSFER_INLINE_THRESHOLD_BYTES) {
                        return await this.putBlobWithTransfer(input, bytes);
                    }
                    return await this.requestWithSession('/storage/blob/put', {
                        method: 'POST',
                        body: input,
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
                if (bytes.byteLength > SDK_TRANSFER_INLINE_THRESHOLD_BYTES) {
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
            filterWhere: async (input) => {
                const response = await this.trivium.filterWherePage(input);
                return response.nodes;
            },
            filterWherePage: async (input) => {
                await this.requireFeature('trivium.filterWherePage', 'Authority 当前版本尚未提供 Trivium 分页过滤能力');
                const database = getTriviumDatabaseName(input.database);
                await this.ensurePermission({
                    resource: 'trivium.private',
                    target: database,
                    reason: `过滤查询 Trivium 数据库 ${database}`,
                });
                return await this.requestWithSession('/trivium/filter-where', {
                    method: 'POST',
                    body: {
                        ...input,
                        database,
                    },
                });
            },
            query: async (input) => {
                const response = await this.trivium.queryPage(input);
                return response.rows;
            },
            queryPage: async (input) => {
                await this.requireFeature('trivium.queryPage', 'Authority 当前版本尚未提供 Trivium 图查询分页能力');
                const database = getTriviumDatabaseName(input.database);
                await this.ensurePermission({
                    resource: 'trivium.private',
                    target: database,
                    reason: `图查询 Trivium 数据库 ${database}`,
                });
                return await this.requestWithSession('/trivium/query', {
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
        this.jobs = {
            create: async (type, payload = {}, options) => {
                await this.ensurePermission({
                    resource: 'jobs.background',
                    target: type,
                    reason: `创建后台任务 ${type}`,
                });
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
            cancel: async (id) => {
                return await this.requestWithSession(`/jobs/${encodeURIComponent(id)}/cancel`, {
                    method: 'POST',
                });
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
                const session = await this.ensureInitialized();
                const channel = options.channel ?? `extension:${this.config.extensionId}`;
                const eventNames = options.eventNames ?? ['authority.connected', 'authority.job'];
                await this.ensurePermission({
                    resource: 'events.stream',
                    target: channel,
                    reason: `订阅事件流 ${channel}`,
                });
                const source = new EventSource(buildEventStreamUrl(session.sessionToken, channel), {
                    withCredentials: true,
                });
                const notify = (name, data) => {
                    options.onEvent?.({ name, data });
                };
                for (const name of eventNames) {
                    source.addEventListener(name, event => {
                        const payload = event instanceof MessageEvent ? safeParse(event.data) : undefined;
                        notify(name, payload);
                    });
                }
                source.onmessage = event => {
                    notify('message', safeParse(event.data));
                };
                source.onerror = () => {
                    console.warn('Authority event stream disconnected for', this.config.extensionId, channel);
                };
                return {
                    close: () => source.close(),
                };
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
            throw new Error(message);
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
    async openSecurityCenter() {
        await openSecurityCenter({ focusExtensionId: this.config.extensionId });
    }
    async evaluatePermission(request) {
        return await this.requestWithSession('/permissions/evaluate', {
            method: 'POST',
            body: request,
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
    async requestWithSession(path, options = {}, retried = false) {
        const session = await this.ensureInitialized();
        try {
            const requestOptions = {
                body: options.body,
                sessionToken: session.sessionToken,
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
                await this.init(true);
                return await this.requestWithSession(path, options, true);
            }
            throw error;
        }
    }
    async putBlobWithTransfer(input, bytes) {
        const transfer = await this.initializeTransfer('storage.blob');
        try {
            await this.appendTransferBytes(transfer, bytes);
            const request = {
                transferId: transfer.transferId,
                name: input.name,
                ...(input.contentType ? { contentType: input.contentType } : {}),
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
        if (!bodyBytes || bodyBytes.byteLength <= SDK_TRANSFER_INLINE_THRESHOLD_BYTES) {
            const opened = await this.requestWithSession('/http/fetch-open', {
                method: 'POST',
                body: input,
            });
            return await this.resolveHttpFetchOpenResponse(opened);
        }
        const transfer = await this.initializeTransfer('http.fetch');
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
        const transfer = await this.initializeTransfer('fs.private');
        try {
            await this.appendTransferBytes(transfer, bytes);
            const request = {
                transferId: transfer.transferId,
                path,
                ...(options.createParents === undefined ? {} : { createParents: options.createParents }),
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
    async initializeTransfer(resource) {
        return await this.requestWithSession('/transfers/init', {
            method: 'POST',
            body: { resource },
        });
    }
    async appendTransferBytes(transfer, bytes) {
        const chunkSize = transfer.chunkSize > 0 ? transfer.chunkSize : SDK_TRANSFER_INLINE_THRESHOLD_BYTES;
        let offset = 0;
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
        if (transfer.sizeBytes <= 0) {
            return new Uint8Array(0);
        }
        const result = new Uint8Array(transfer.sizeBytes);
        let offset = 0;
        while (offset < transfer.sizeBytes) {
            const chunk = await this.requestWithSession(`/transfers/${encodeURIComponent(transfer.transferId)}/read`, {
                method: 'POST',
                body: {
                    offset,
                    limit: transfer.chunkSize,
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
export function splitAuthorityItemsIntoChunks(items, options = {}) {
    const maxItemsPerChunk = normalizePositiveInteger(options.maxItemsPerChunk, DEFAULT_TRIVIUM_CHUNK_ITEMS, 'maxItemsPerChunk');
    const maxBytesPerChunk = normalizePositiveInteger(options.maxBytesPerChunk, DEFAULT_TRIVIUM_CHUNK_BYTES, 'maxBytesPerChunk');
    if (items.length === 0) {
        return [];
    }
    const chunks = [];
    let current = [];
    let currentBytes = 2;
    let itemOffset = 0;
    for (const item of items) {
        const itemBytes = estimateJsonBytes(item);
        if (itemBytes + 2 > maxBytesPerChunk) {
            throw new Error(`Chunk item exceeds maxBytesPerChunk (${itemBytes} > ${maxBytesPerChunk})`);
        }
        const nextBytes = current.length === 0 ? currentBytes + itemBytes : currentBytes + itemBytes + 1;
        if (current.length > 0 && (current.length >= maxItemsPerChunk || nextBytes > maxBytesPerChunk)) {
            chunks.push({
                chunkIndex: chunks.length,
                itemOffset,
                itemCount: current.length,
                estimatedBytes: currentBytes,
                items: current,
            });
            itemOffset += current.length;
            current = [];
            currentBytes = 2;
        }
        current.push(item);
        currentBytes = current.length === 1 ? 2 + itemBytes : currentBytes + itemBytes + 1;
    }
    if (current.length > 0) {
        chunks.push({
            chunkIndex: chunks.length,
            itemOffset,
            itemCount: current.length,
            estimatedBytes: currentBytes,
            items: current,
        });
    }
    return chunks;
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
    };
    for (const item of items) {
        result[item.resource].push(item);
    }
    return result;
}
function getFeatureAvailability(features, feature) {
    switch (feature) {
        case 'securityCenter':
            return features.securityCenter;
        case 'admin':
            return features.admin;
        case 'sql.queryPage':
            return features.sql.queryPage;
        case 'sql.migrations':
            return features.sql.migrations;
        case 'trivium.resolveId':
            return features.trivium.resolveId;
        case 'trivium.upsert':
            return features.trivium.upsert;
        case 'trivium.bulkMutations':
            return features.trivium.bulkMutations;
        case 'trivium.filterWherePage':
            return features.trivium.filterWherePage;
        case 'trivium.queryPage':
            return features.trivium.queryPage;
        case 'transfers.blob':
            return features.transfers.blob;
        case 'transfers.fs':
            return features.transfers.fs;
        case 'transfers.httpFetch':
            return features.transfers.httpFetch;
        case 'jobs.background':
            return features.jobs.background;
        case 'diagnostics.warnings':
            return features.diagnostics.warnings;
        case 'diagnostics.activityPages':
            return features.diagnostics.activityPages;
        case 'diagnostics.jobsPage':
            return features.diagnostics.jobsPage;
        case 'diagnostics.benchmarkCore':
            return features.diagnostics.benchmarkCore;
    }
}
function normalizePositiveInteger(value, fallback, label) {
    if (value === undefined) {
        return fallback;
    }
    if (!Number.isInteger(value) || value <= 0) {
        throw new Error(`${label} must be a positive integer`);
    }
    return value;
}
function estimateJsonBytes(value) {
    return UTF8_ENCODER.encode(JSON.stringify(value)).length;
}
function safeParse(value) {
    try {
        return JSON.parse(value);
    }
    catch {
        return value;
    }
}
function getPermissionFailureMessage(displayName, resource, target, decision) {
    const resourceName = getPermissionResourceLabel(resource);
    const resourceLabel = target && target !== '*' ? `${resourceName} (${target})` : resourceName;
    if (decision === 'denied') {
        return `${displayName} 对 ${resourceLabel} 的请求已被拒绝，请在安全中心手动重置。`;
    }
    if (decision === 'blocked') {
        return `${displayName} 对 ${resourceLabel} 的请求被平台安全规则或管理员策略封锁。`;
    }
    return `${displayName} 没有获得 ${resourceLabel} 的访问授权。`;
}
function getPermissionResourceLabel(resource) {
    switch (resource) {
        case 'storage.kv':
            return 'KV 存储';
        case 'storage.blob':
            return 'Blob 存储';
        case 'fs.private':
            return '私有文件夹';
        case 'sql.private':
            return '私有 SQL 数据库';
        case 'trivium.private':
            return '私有记忆数据库';
        case 'http.fetch':
            return 'HTTP 访问';
        case 'jobs.background':
            return '后台任务';
        case 'events.stream':
            return '事件流';
        default:
            return resource;
    }
}
function getSqlDatabaseName(value) {
    return typeof value === 'string' && value.trim() ? value.trim() : 'default';
}
function getTriviumDatabaseName(value) {
    return typeof value === 'string' && value.trim() ? value.trim() : 'default';
}
function contentToBytes(content, encoding) {
    if (encoding === 'base64') {
        return base64ToBytes(content);
    }
    return new TextEncoder().encode(content);
}
function base64ToBytes(content) {
    const binary = globalThis.atob(content);
    const bytes = new Uint8Array(binary.length);
    for (let index = 0; index < binary.length; index += 1) {
        bytes[index] = binary.charCodeAt(index);
    }
    return bytes;
}
function bytesToBase64(bytes) {
    const segments = [];
    for (let offset = 0; offset < bytes.length; offset += 0x8000) {
        const chunk = bytes.subarray(offset, offset + 0x8000);
        let binary = '';
        for (let index = 0; index < chunk.length; index += 1) {
            binary += String.fromCharCode(chunk[index] ?? 0);
        }
        segments.push(binary);
    }
    return globalThis.btoa(segments.join(''));
}
function bytesToContent(bytes, encoding) {
    if (encoding === 'base64') {
        return bytesToBase64(bytes);
    }
    return bytesToUtf8(bytes);
}
function bytesToHttpContent(bytes, encoding) {
    if (encoding === 'base64') {
        return bytesToBase64(bytes);
    }
    return new TextDecoder('utf-8').decode(bytes);
}
function bytesToUtf8(bytes) {
    try {
        return new TextDecoder('utf-8', { fatal: true }).decode(bytes);
    }
    catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        throw new Error(`invalid_utf8_private_file: ${message}`);
    }
}
//# sourceMappingURL=client.js.map
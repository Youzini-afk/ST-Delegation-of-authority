import type {
    AuthorityGrant,
    AuthorityInitConfig,
    AuthorityPolicyEntry,
    BlobGetResponse,
    BlobOpenReadResponse,
    BlobPutRequest,
    BlobRecord,
    BlobTransferCommitRequest,
    DataTransferInitResponse,
    DataTransferReadResponse,
    DataTransferResource,
    DeclaredPermissions,
    HttpBodyEncoding,
    HttpFetchOpenResponse,
    HttpFetchResponse,
    JobRecord,
    PermissionEvaluateRequest,
    PermissionEvaluateResponse,
    PermissionResource,
    PrivateFileDeleteRequest,
    PrivateFileEntry,
    PrivateFileOpenReadResponse,
    PrivateFileReadDirRequest,
    PrivateFileReadRequest,
    PrivateFileReadResponse,
    PrivateFileTransferCommitRequest,
    PrivateFileWriteRequest,
    SessionInitResponse,
    SqlBatchRequest,
    SqlBatchResponse,
    SqlListDatabasesResponse,
    SqlMigrateRequest,
    SqlMigrateResponse,
    SqlExecRequest,
    SqlExecResult,
    SqlQueryRequest,
    SqlQueryResult,
    SqlTransactionRequest,
    SqlTransactionResponse,
    TriviumBulkDeleteRequest,
    TriviumBulkLinkRequest,
    TriviumBulkMutationResponse,
    TriviumBulkUnlinkRequest,
    TriviumBulkUpsertRequest,
    TriviumBulkUpsertResponse,
    TriviumBuildTextIndexRequest,
    TriviumDeleteRequest,
    TriviumFilterWhereRequest,
    TriviumFilterWhereResponse,
    TriviumFlushRequest,
    TriviumGetRequest,
    TriviumIndexKeywordRequest,
    TriviumIndexTextRequest,
    TriviumInsertRequest,
    TriviumInsertResponse,
    TriviumInsertWithIdRequest,
    TriviumLinkRequest,
    TriviumListDatabasesResponse,
    TriviumNeighborsRequest,
    TriviumNeighborsResponse,
    TriviumNodeView,
    TriviumQueryRequest,
    TriviumQueryResponse,
    TriviumQueryRow,
    TriviumResolveIdRequest,
    TriviumResolveIdResponse,
    TriviumSearchHit,
    TriviumSearchAdvancedRequest,
    TriviumSearchHybridRequest,
    TriviumSearchRequest,
    TriviumStatRequest,
    TriviumStatResponse,
    TriviumUnlinkRequest,
    TriviumUpsertRequest,
    TriviumUpsertResponse,
    TriviumUpdatePayloadRequest,
    TriviumUpdateVectorRequest,
} from '@stdo/shared-types';
import { authorityRequest, buildEventStreamUrl, hostnameFromUrl, isInvalidSessionError } from './api.js';
import { showPermissionPrompt, type PermissionPromptContext } from './permission-prompt.js';
import { openSecurityCenter } from './security-center.js';

export interface AuthorityPermissionRequest extends PermissionEvaluateRequest {
    promptTitle?: string;
}

export interface JobCreateOptions {
    timeoutMs?: number;
    idempotencyKey?: string;
    maxAttempts?: number;
}

export interface AuthorityHttpRequest {
    url: string;
    method?: string;
    headers?: Record<string, string>;
    body?: string;
    bodyEncoding?: HttpBodyEncoding;
}

export interface AuthorityEventEnvelope {
    name: string;
    data: unknown;
}

export interface AuthorityEventsSubscribeOptions {
    channel?: string;
    eventNames?: string[];
    onEvent?: (event: AuthorityEventEnvelope) => void;
}

export interface AuthorityEventsSubscription {
    close(): void;
}

export interface AuthorityCapabilities {
    declaredPermissions: DeclaredPermissions;
    features: SessionInitResponse['features'];
    grants: Record<PermissionResource, AuthorityGrant[]>;
    policies: Record<PermissionResource, AuthorityPolicyEntry[]>;
}

interface SessionRequestOptions {
    method?: 'GET' | 'POST';
    body?: unknown;
}

const SDK_TRANSFER_INLINE_THRESHOLD_BYTES = 256 * 1024;

export class AuthorityClient {
    readonly storage: {
        kv: {
            get: (key: string) => Promise<unknown>;
            set: (key: string, value: unknown) => Promise<void>;
            delete: (key: string) => Promise<void>;
            list: () => Promise<Record<string, unknown>>;
        };
        blob: {
            put: (input: BlobPutRequest) => Promise<BlobRecord>;
            get: (id: string) => Promise<BlobGetResponse>;
            delete: (id: string) => Promise<void>;
            list: () => Promise<BlobRecord[]>;
        };
    };

    readonly fs: {
        mkdir: (path: string, options?: { recursive?: boolean }) => Promise<PrivateFileEntry>;
        readDir: (path?: string, options?: Omit<PrivateFileReadDirRequest, 'path'>) => Promise<PrivateFileEntry[]>;
        writeFile: (path: string, content: string, options?: Omit<PrivateFileWriteRequest, 'path' | 'content'>) => Promise<PrivateFileEntry>;
        readFile: (path: string, options?: Omit<PrivateFileReadRequest, 'path'>) => Promise<PrivateFileReadResponse>;
        delete: (path: string, options?: Omit<PrivateFileDeleteRequest, 'path'>) => Promise<void>;
        stat: (path: string) => Promise<PrivateFileEntry>;
    };

    readonly sql: {
        query: (input: SqlQueryRequest) => Promise<SqlQueryResult>;
        exec: (input: SqlExecRequest) => Promise<SqlExecResult>;
        batch: (input: SqlBatchRequest) => Promise<SqlBatchResponse>;
        transaction: (input: SqlTransactionRequest) => Promise<SqlTransactionResponse>;
        migrate: (input: SqlMigrateRequest) => Promise<SqlMigrateResponse>;
        listDatabases: () => Promise<SqlListDatabasesResponse>;
    };

    readonly trivium: {
        insert: (input: TriviumInsertRequest) => Promise<TriviumInsertResponse>;
        insertWithId: (input: TriviumInsertWithIdRequest) => Promise<void>;
        resolveId: (input: TriviumResolveIdRequest) => Promise<TriviumResolveIdResponse>;
        upsert: (input: TriviumUpsertRequest) => Promise<TriviumUpsertResponse>;
        bulkUpsert: (input: TriviumBulkUpsertRequest) => Promise<TriviumBulkUpsertResponse>;
        get: (input: TriviumGetRequest) => Promise<TriviumNodeView | null>;
        updatePayload: (input: TriviumUpdatePayloadRequest) => Promise<void>;
        updateVector: (input: TriviumUpdateVectorRequest) => Promise<void>;
        delete: (input: TriviumDeleteRequest) => Promise<void>;
        bulkDelete: (input: TriviumBulkDeleteRequest) => Promise<TriviumBulkMutationResponse>;
        link: (input: TriviumLinkRequest) => Promise<void>;
        bulkLink: (input: TriviumBulkLinkRequest) => Promise<TriviumBulkMutationResponse>;
        unlink: (input: TriviumUnlinkRequest) => Promise<void>;
        bulkUnlink: (input: TriviumBulkUnlinkRequest) => Promise<TriviumBulkMutationResponse>;
        neighbors: (input: TriviumNeighborsRequest) => Promise<TriviumNeighborsResponse>;
        search: (input: TriviumSearchRequest) => Promise<TriviumSearchHit[]>;
        searchAdvanced: (input: TriviumSearchAdvancedRequest) => Promise<TriviumSearchHit[]>;
        searchHybrid: (input: TriviumSearchHybridRequest) => Promise<TriviumSearchHit[]>;
        filterWhere: (input: TriviumFilterWhereRequest) => Promise<TriviumNodeView[]>;
        filterWherePage: (input: TriviumFilterWhereRequest) => Promise<TriviumFilterWhereResponse>;
        query: (input: TriviumQueryRequest) => Promise<TriviumQueryRow[]>;
        queryPage: (input: TriviumQueryRequest) => Promise<TriviumQueryResponse>;
        indexText: (input: TriviumIndexTextRequest) => Promise<void>;
        indexKeyword: (input: TriviumIndexKeywordRequest) => Promise<void>;
        buildTextIndex: (input?: TriviumBuildTextIndexRequest) => Promise<void>;
        flush: (input?: TriviumFlushRequest) => Promise<void>;
        stat: (input?: TriviumStatRequest) => Promise<TriviumStatResponse>;
        listDatabases: () => Promise<TriviumListDatabasesResponse>;
    };

    readonly http: {
        fetch: (input: AuthorityHttpRequest) => Promise<HttpFetchResponse>;
    };

    readonly jobs: {
        create: (type: string, payload?: Record<string, unknown>, options?: JobCreateOptions) => Promise<JobRecord>;
        get: (id: string) => Promise<JobRecord>;
        list: () => Promise<JobRecord[]>;
        cancel: (id: string) => Promise<JobRecord>;
    };

    readonly events: {
        subscribe: (channelOrOptions?: string | AuthorityEventsSubscribeOptions, handler?: (event: AuthorityEventEnvelope) => void) => Promise<AuthorityEventsSubscription>;
    };

    private session: SessionInitResponse | null = null;
    private sessionPromise: Promise<SessionInitResponse> | null = null;
    private readonly runtimeGrants = new Map<string, AuthorityGrant>();

    constructor(private config: AuthorityInitConfig) {
        this.storage = {
            kv: {
                get: async key => {
                    await this.ensurePermission({ resource: 'storage.kv', reason: `读取键 ${key}` });
                    const response = await this.requestWithSession<{ value: unknown }>('/storage/kv/get', {
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
                delete: async key => {
                    await this.ensurePermission({ resource: 'storage.kv', reason: `删除键 ${key}` });
                    await this.requestWithSession('/storage/kv/delete', {
                        method: 'POST',
                        body: { key },
                    });
                },
                list: async () => {
                    await this.ensurePermission({ resource: 'storage.kv', reason: '列出 KV 存储' });
                    const response = await this.requestWithSession<{ entries: Record<string, unknown> }>('/storage/kv/list', {
                        method: 'POST',
                    });
                    return response.entries;
                },
            },
            blob: {
                put: async input => {
                    await this.ensurePermission({ resource: 'storage.blob', reason: `写入 Blob ${input.name}` });
                    const bytes = contentToBytes(input.content, input.encoding ?? 'utf8');
                    if (bytes.byteLength > SDK_TRANSFER_INLINE_THRESHOLD_BYTES) {
                        return await this.putBlobWithTransfer(input, bytes);
                    }
                    return await this.requestWithSession<BlobRecord>('/storage/blob/put', {
                        method: 'POST',
                        body: input,
                    });
                },
                get: async id => {
                    await this.ensurePermission({ resource: 'storage.blob', reason: `读取 Blob ${id}` });
                    return await this.getBlobWithTransfer(id);
                },
                delete: async id => {
                    await this.ensurePermission({ resource: 'storage.blob', reason: `删除 Blob ${id}` });
                    await this.requestWithSession('/storage/blob/delete', {
                        method: 'POST',
                        body: { id },
                    });
                },
                list: async () => {
                    await this.ensurePermission({ resource: 'storage.blob', reason: '列出 Blob 存储' });
                    const response = await this.requestWithSession<{ entries: BlobRecord[] }>('/storage/blob/list', {
                        method: 'POST',
                    });
                    return response.entries;
                },
            },
        };

        this.fs = {
            mkdir: async (path, options = {}) => {
                await this.ensurePermission({ resource: 'fs.private', reason: `在私有文件夹中创建目录 ${path}` });
                const response = await this.requestWithSession<{ entry: PrivateFileEntry }>('/fs/private/mkdir', {
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
                const response = await this.requestWithSession<{ entries: PrivateFileEntry[] }>('/fs/private/read-dir', {
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
                const response = await this.requestWithSession<{ entry: PrivateFileEntry }>('/fs/private/write-file', {
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
            stat: async path => {
                await this.ensurePermission({ resource: 'fs.private', reason: `查看私有路径 ${path}` });
                const response = await this.requestWithSession<{ entry: PrivateFileEntry }>('/fs/private/stat', {
                    method: 'POST',
                    body: { path },
                });
                return response.entry;
            },
        };

        this.sql = {
            query: async input => {
                const database = getSqlDatabaseName(input.database);
                await this.ensurePermission({
                    resource: 'sql.private',
                    target: database,
                    reason: `查询 SQL 数据库 ${database}`,
                });
                return await this.requestWithSession<SqlQueryResult>('/sql/query', {
                    method: 'POST',
                    body: {
                        ...input,
                        database,
                    },
                });
            },
            exec: async input => {
                const database = getSqlDatabaseName(input.database);
                await this.ensurePermission({
                    resource: 'sql.private',
                    target: database,
                    reason: `执行 SQL 数据库 ${database}`,
                });
                return await this.requestWithSession<SqlExecResult>('/sql/exec', {
                    method: 'POST',
                    body: {
                        ...input,
                        database,
                    },
                });
            },
            batch: async input => {
                const database = getSqlDatabaseName(input.database);
                await this.ensurePermission({
                    resource: 'sql.private',
                    target: database,
                    reason: `批量执行 SQL 数据库 ${database}`,
                });
                return await this.requestWithSession<SqlBatchResponse>('/sql/batch', {
                    method: 'POST',
                    body: {
                        ...input,
                        database,
                    },
                });
            },
            transaction: async input => {
                const database = getSqlDatabaseName(input.database);
                await this.ensurePermission({
                    resource: 'sql.private',
                    target: database,
                    reason: `事务执行 SQL 数据库 ${database}`,
                });
                return await this.requestWithSession<SqlTransactionResponse>('/sql/transaction', {
                    method: 'POST',
                    body: {
                        ...input,
                        database,
                    },
                });
            },
            migrate: async input => {
                const database = getSqlDatabaseName(input.database);
                await this.ensurePermission({
                    resource: 'sql.private',
                    target: database,
                    reason: `迁移 SQL 数据库 ${database}`,
                });
                return await this.requestWithSession<SqlMigrateResponse>('/sql/migrate', {
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
                return await this.requestWithSession<SqlListDatabasesResponse>('/sql/databases');
            },
        };

        this.trivium = {
            insert: async input => {
                const database = getTriviumDatabaseName(input.database);
                await this.ensurePermission({
                    resource: 'trivium.private',
                    target: database,
                    reason: `写入 Trivium 数据库 ${database}`,
                });
                return await this.requestWithSession<TriviumInsertResponse>('/trivium/insert', {
                    method: 'POST',
                    body: {
                        ...input,
                        database,
                    },
                });
            },
            insertWithId: async input => {
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
            resolveId: async input => {
                const database = getTriviumDatabaseName(input.database);
                await this.ensurePermission({
                    resource: 'trivium.private',
                    target: database,
                    reason: `解析 Trivium externalId（${database}）`,
                });
                return await this.requestWithSession<TriviumResolveIdResponse>('/trivium/resolve-id', {
                    method: 'POST',
                    body: {
                        ...input,
                        database,
                    },
                });
            },
            upsert: async input => {
                const database = getTriviumDatabaseName(input.database);
                await this.ensurePermission({
                    resource: 'trivium.private',
                    target: database,
                    reason: `写入或更新 Trivium 节点（${database}）`,
                });
                return await this.requestWithSession<TriviumUpsertResponse>('/trivium/upsert', {
                    method: 'POST',
                    body: {
                        ...input,
                        database,
                    },
                });
            },
            bulkUpsert: async input => {
                const database = getTriviumDatabaseName(input.database);
                await this.ensurePermission({
                    resource: 'trivium.private',
                    target: database,
                    reason: `批量写入或更新 Trivium 节点（${database}）`,
                });
                return await this.requestWithSession<TriviumBulkUpsertResponse>('/trivium/bulk-upsert', {
                    method: 'POST',
                    body: {
                        ...input,
                        database,
                    },
                });
            },
            get: async input => {
                const database = getTriviumDatabaseName(input.database);
                await this.ensurePermission({
                    resource: 'trivium.private',
                    target: database,
                    reason: `读取 Trivium 节点 ${input.id}（${database}）`,
                });
                const response = await this.requestWithSession<{ node: TriviumNodeView | null }>('/trivium/get', {
                    method: 'POST',
                    body: {
                        ...input,
                        database,
                    },
                });
                return response.node;
            },
            updatePayload: async input => {
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
            updateVector: async input => {
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
            delete: async input => {
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
            bulkDelete: async input => {
                const database = getTriviumDatabaseName(input.database);
                await this.ensurePermission({
                    resource: 'trivium.private',
                    target: database,
                    reason: `批量删除 Trivium 节点（${database}）`,
                });
                return await this.requestWithSession<TriviumBulkMutationResponse>('/trivium/bulk-delete', {
                    method: 'POST',
                    body: {
                        ...input,
                        database,
                    },
                });
            },
            link: async input => {
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
            bulkLink: async input => {
                const database = getTriviumDatabaseName(input.database);
                await this.ensurePermission({
                    resource: 'trivium.private',
                    target: database,
                    reason: `批量建立 Trivium 图边（${database}）`,
                });
                return await this.requestWithSession<TriviumBulkMutationResponse>('/trivium/bulk-link', {
                    method: 'POST',
                    body: {
                        ...input,
                        database,
                    },
                });
            },
            unlink: async input => {
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
            bulkUnlink: async input => {
                const database = getTriviumDatabaseName(input.database);
                await this.ensurePermission({
                    resource: 'trivium.private',
                    target: database,
                    reason: `批量删除 Trivium 图边（${database}）`,
                });
                return await this.requestWithSession<TriviumBulkMutationResponse>('/trivium/bulk-unlink', {
                    method: 'POST',
                    body: {
                        ...input,
                        database,
                    },
                });
            },
            neighbors: async input => {
                const database = getTriviumDatabaseName(input.database);
                await this.ensurePermission({
                    resource: 'trivium.private',
                    target: database,
                    reason: `查询 Trivium 邻居 ${input.id}（${database}）`,
                });
                return await this.requestWithSession<TriviumNeighborsResponse>('/trivium/neighbors', {
                    method: 'POST',
                    body: {
                        ...input,
                        database,
                    },
                });
            },
            search: async input => {
                const database = getTriviumDatabaseName(input.database);
                await this.ensurePermission({
                    resource: 'trivium.private',
                    target: database,
                    reason: `检索 Trivium 数据库 ${database}`,
                });
                const response = await this.requestWithSession<{ hits: TriviumSearchHit[] }>('/trivium/search', {
                    method: 'POST',
                    body: {
                        ...input,
                        database,
                    },
                });
                return response.hits;
            },
            searchAdvanced: async input => {
                const database = getTriviumDatabaseName(input.database);
                await this.ensurePermission({
                    resource: 'trivium.private',
                    target: database,
                    reason: `高级检索 Trivium 数据库 ${database}`,
                });
                const response = await this.requestWithSession<{ hits: TriviumSearchHit[] }>('/trivium/search-advanced', {
                    method: 'POST',
                    body: {
                        ...input,
                        database,
                    },
                });
                return response.hits;
            },
            searchHybrid: async input => {
                const database = getTriviumDatabaseName(input.database);
                await this.ensurePermission({
                    resource: 'trivium.private',
                    target: database,
                    reason: `混合检索 Trivium 数据库 ${database}`,
                });
                const response = await this.requestWithSession<{ hits: TriviumSearchHit[] }>('/trivium/search-hybrid', {
                    method: 'POST',
                    body: {
                        ...input,
                        database,
                    },
                });
                return response.hits;
            },
            filterWhere: async input => {
                const response = await this.trivium.filterWherePage(input);
                return response.nodes;
            },
            filterWherePage: async input => {
                const database = getTriviumDatabaseName(input.database);
                await this.ensurePermission({
                    resource: 'trivium.private',
                    target: database,
                    reason: `过滤查询 Trivium 数据库 ${database}`,
                });
                return await this.requestWithSession<TriviumFilterWhereResponse>('/trivium/filter-where', {
                    method: 'POST',
                    body: {
                        ...input,
                        database,
                    },
                });
            },
            query: async input => {
                const response = await this.trivium.queryPage(input);
                return response.rows;
            },
            queryPage: async input => {
                const database = getTriviumDatabaseName(input.database);
                await this.ensurePermission({
                    resource: 'trivium.private',
                    target: database,
                    reason: `图查询 Trivium 数据库 ${database}`,
                });
                return await this.requestWithSession<TriviumQueryResponse>('/trivium/query', {
                    method: 'POST',
                    body: {
                        ...input,
                        database,
                    },
                });
            },
            indexText: async input => {
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
            indexKeyword: async input => {
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
                return await this.requestWithSession<TriviumStatResponse>('/trivium/stat', {
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
                return await this.requestWithSession<TriviumListDatabasesResponse>('/trivium/databases');
            },
        };

        this.http = {
            fetch: async input => {
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
                return await this.requestWithSession<JobRecord>('/jobs/create', {
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
            get: async id => {
                return await this.requestWithSession<JobRecord>(`/jobs/${encodeURIComponent(id)}`);
            },
            list: async () => {
                return await this.requestWithSession<JobRecord[]>('/jobs');
            },
            cancel: async id => {
                return await this.requestWithSession<JobRecord>(`/jobs/${encodeURIComponent(id)}/cancel`, {
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

                const notify = (name: string, data: unknown) => {
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

    async init(force = false): Promise<SessionInitResponse> {
        if (force) {
            this.session = null;
            this.sessionPromise = null;
        }

        return await this.ensureInitialized();
    }

    setConfig(config: AuthorityInitConfig): void {
        this.config = cloneInitConfig(config);
    }

    getSession(): SessionInitResponse | null {
        if (!this.session) {
            return null;
        }

        return {
            ...this.session,
            grants: this.buildGrantSnapshot(),
            policies: [...this.session.policies],
        };
    }

    getCapabilities(): AuthorityCapabilities | null {
        const session = this.getSession();
        if (!session) {
            return null;
        }

        return {
            declaredPermissions: this.config.declaredPermissions,
            features: session.features,
            grants: groupByResource(session.grants),
            policies: groupByResource(session.policies),
        };
    }

    async ensurePermission(request: AuthorityPermissionRequest): Promise<PermissionEvaluateResponse> {
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

    async requestPermission(request: AuthorityPermissionRequest, evaluation?: PermissionEvaluateResponse): Promise<PermissionEvaluateResponse> {
        const current = evaluation ?? await this.evaluatePermission(request);
        if (current.decision === 'granted') {
            return current;
        }

        if (current.decision === 'denied' || current.decision === 'blocked') {
            return current;
        }

        const promptContext: PermissionPromptContext = {
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

        const grant = await this.requestWithSession<AuthorityGrant>('/permissions/resolve', {
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

    async openSecurityCenter(): Promise<void> {
        await openSecurityCenter({ focusExtensionId: this.config.extensionId });
    }

    private async evaluatePermission(request: AuthorityPermissionRequest): Promise<PermissionEvaluateResponse> {
        return await this.requestWithSession<PermissionEvaluateResponse>('/permissions/evaluate', {
            method: 'POST',
            body: request,
        });
    }

    private async ensureInitialized(): Promise<SessionInitResponse> {
        if (this.session) {
            return this.session;
        }

        if (!this.sessionPromise) {
            this.sessionPromise = authorityRequest<SessionInitResponse>('/session/init', {
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

    private async requestWithSession<T>(path: string, options: SessionRequestOptions = {}, retried = false): Promise<T> {
        const session = await this.ensureInitialized();

        try {
            const requestOptions = {
                body: options.body,
                sessionToken: session.sessionToken,
            } as const;

            if (options.method) {
                return await authorityRequest<T>(path, {
                    ...requestOptions,
                    method: options.method,
                });
            }

            return await authorityRequest<T>(path, requestOptions);
        } catch (error) {
            if (!retried && isInvalidSessionError(error)) {
                await this.init(true);
                return await this.requestWithSession<T>(path, options, true);
            }

            throw error;
        }
    }

    private async putBlobWithTransfer(input: BlobPutRequest, bytes: Uint8Array): Promise<BlobRecord> {
        const transfer = await this.initializeTransfer('storage.blob');
        try {
            await this.appendTransferBytes(transfer, bytes);
            const request: BlobTransferCommitRequest = {
                transferId: transfer.transferId,
                name: input.name,
                ...(input.contentType ? { contentType: input.contentType } : {}),
            };
            return await this.requestWithSession<BlobRecord>('/storage/blob/commit-transfer', {
                method: 'POST',
                body: request,
            });
        } catch (error) {
            await this.discardTransferQuietly(transfer.transferId);
            throw error;
        }
    }

    private async getBlobWithTransfer(id: string): Promise<BlobGetResponse> {
        const opened = await this.requestWithSession<BlobOpenReadResponse>('/storage/blob/open-read', {
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
        } finally {
            await this.discardTransferQuietly(opened.transfer.transferId);
        }
    }

    private async fetchHttpWithTransfer(input: AuthorityHttpRequest): Promise<HttpFetchResponse> {
        const bodyEncoding = input.bodyEncoding ?? 'utf8';
        const bodyBytes = input.body === undefined ? undefined : contentToBytes(input.body, bodyEncoding);
        if (!bodyBytes || bodyBytes.byteLength <= SDK_TRANSFER_INLINE_THRESHOLD_BYTES) {
            const opened = await this.requestWithSession<HttpFetchOpenResponse>('/http/fetch-open', {
                method: 'POST',
                body: input,
            });
            return await this.resolveHttpFetchOpenResponse(opened);
        }

        const transfer = await this.initializeTransfer('http.fetch');
        try {
            await this.appendTransferBytes(transfer, bodyBytes);
            const opened = await this.requestWithSession<HttpFetchOpenResponse>('/http/fetch-open', {
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
        } catch (error) {
            await this.discardTransferQuietly(transfer.transferId);
            throw error;
        }
    }

    private async resolveHttpFetchOpenResponse(opened: HttpFetchOpenResponse): Promise<HttpFetchResponse> {
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
        } finally {
            await this.discardTransferQuietly(opened.transfer.transferId);
        }
    }

    private async writePrivateFileWithTransfer(
        path: string,
        bytes: Uint8Array,
        options: Omit<PrivateFileWriteRequest, 'path' | 'content'>,
    ): Promise<PrivateFileEntry> {
        const transfer = await this.initializeTransfer('fs.private');
        try {
            await this.appendTransferBytes(transfer, bytes);
            const request: PrivateFileTransferCommitRequest = {
                transferId: transfer.transferId,
                path,
                ...(options.createParents === undefined ? {} : { createParents: options.createParents }),
            };
            const response = await this.requestWithSession<{ entry: PrivateFileEntry }>('/fs/private/write-file-transfer', {
                method: 'POST',
                body: request,
            });
            return response.entry;
        } catch (error) {
            await this.discardTransferQuietly(transfer.transferId);
            throw error;
        }
    }

    private async readPrivateFileWithTransfer(
        path: string,
        options: Omit<PrivateFileReadRequest, 'path'>,
    ): Promise<PrivateFileReadResponse> {
        const opened = await this.requestWithSession<PrivateFileOpenReadResponse>('/fs/private/open-read', {
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
        } finally {
            await this.discardTransferQuietly(opened.transfer.transferId);
        }
    }

    private async initializeTransfer(resource: DataTransferResource): Promise<DataTransferInitResponse> {
        return await this.requestWithSession<DataTransferInitResponse>('/transfers/init', {
            method: 'POST',
            body: { resource },
        });
    }

    private async appendTransferBytes(transfer: DataTransferInitResponse, bytes: Uint8Array): Promise<void> {
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

    private async readTransferBytes(transfer: DataTransferInitResponse): Promise<Uint8Array> {
        if (transfer.sizeBytes <= 0) {
            return new Uint8Array(0);
        }

        const result = new Uint8Array(transfer.sizeBytes);
        let offset = 0;
        while (offset < transfer.sizeBytes) {
            const chunk = await this.requestWithSession<DataTransferReadResponse>(`/transfers/${encodeURIComponent(transfer.transferId)}/read`, {
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

    private async discardTransferQuietly(transferId: string): Promise<void> {
        try {
            await this.requestWithSession(`/transfers/${encodeURIComponent(transferId)}/discard`, {
                method: 'POST',
            });
        } catch {
            return;
        }
    }

    private mergeGrant(grant: AuthorityGrant): void {
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

    private buildGrantSnapshot(): AuthorityGrant[] {
        if (!this.session) {
            return [];
        }

        const grants = new Map<string, AuthorityGrant>();
        for (const grant of this.session.grants) {
            grants.set(grant.key, grant);
        }
        for (const grant of this.runtimeGrants.values()) {
            grants.set(grant.key, grant);
        }

        return [...grants.values()].sort((left, right) => left.key.localeCompare(right.key));
    }
}

function cloneInitConfig(config: AuthorityInitConfig): AuthorityInitConfig {
    const clone: AuthorityInitConfig = {
        extensionId: config.extensionId,
        displayName: config.displayName,
        version: config.version,
        installType: config.installType,
        declaredPermissions: JSON.parse(JSON.stringify(config.declaredPermissions ?? {})) as DeclaredPermissions,
    };

    if (config.uiLabel) {
        clone.uiLabel = config.uiLabel;
    }

    return clone;
}

function groupByResource<T extends AuthorityGrant | AuthorityPolicyEntry>(items: T[]): Record<PermissionResource, T[]> {
    const result = {
        'storage.kv': [],
        'storage.blob': [],
        'fs.private': [],
        'sql.private': [],
        'trivium.private': [],
        'http.fetch': [],
        'jobs.background': [],
        'events.stream': [],
    } as Record<PermissionResource, T[]>;

    for (const item of items) {
        result[item.resource].push(item);
    }

    return result;
}

function safeParse(value: string): unknown {
    try {
        return JSON.parse(value);
    } catch {
        return value;
    }
}

function getPermissionFailureMessage(
    displayName: string,
    resource: PermissionResource,
    target: string,
    decision: PermissionEvaluateResponse['decision'],
): string {
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

function getPermissionResourceLabel(resource: PermissionResource): string {
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

function getSqlDatabaseName(value: unknown): string {
    return typeof value === 'string' && value.trim() ? value.trim() : 'default';
}

function getTriviumDatabaseName(value: unknown): string {
    return typeof value === 'string' && value.trim() ? value.trim() : 'default';
}

function contentToBytes(content: string, encoding: 'utf8' | 'base64'): Uint8Array {
    if (encoding === 'base64') {
        return base64ToBytes(content);
    }
    return new TextEncoder().encode(content);
}

function base64ToBytes(content: string): Uint8Array {
    const binary = globalThis.atob(content);
    const bytes = new Uint8Array(binary.length);
    for (let index = 0; index < binary.length; index += 1) {
        bytes[index] = binary.charCodeAt(index);
    }
    return bytes;
}

function bytesToBase64(bytes: Uint8Array): string {
    const segments: string[] = [];
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

function bytesToContent(bytes: Uint8Array, encoding: 'utf8' | 'base64'): string {
    if (encoding === 'base64') {
        return bytesToBase64(bytes);
    }
    return bytesToUtf8(bytes);
}

function bytesToHttpContent(bytes: Uint8Array, encoding: HttpBodyEncoding): string {
    if (encoding === 'base64') {
        return bytesToBase64(bytes);
    }
    return new TextDecoder('utf-8').decode(bytes);
}

function bytesToUtf8(bytes: Uint8Array): string {
    try {
        return new TextDecoder('utf-8', { fatal: true }).decode(bytes);
    } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        throw new Error(`invalid_utf8_private_file: ${message}`);
    }
}

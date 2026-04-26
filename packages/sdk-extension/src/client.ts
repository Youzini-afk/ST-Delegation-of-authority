import type {
    AuthorityGrant,
    AuthorityFeatureFlags,
    AuthorityInitConfig,
    AuthorityPolicyEntry,
    AuthorityProbeResponse,
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
    JobListRequest,
    JobListResponse,
    PermissionDecision,
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
    SqlListMigrationsRequest,
    SqlListMigrationsResponse,
    SqlListSchemaRequest,
    SqlListSchemaResponse,
    SqlMigrateRequest,
    SqlMigrateResponse,
    SqlExecRequest,
    SqlExecResult,
    SqlQueryRequest,
    SqlQueryResult,
    SqlTransactionRequest,
    SqlTransactionResponse,
    TriviumBulkFailure,
    TriviumBulkDeleteRequest,
    TriviumBulkLinkRequest,
    TriviumBulkMutationResponse,
    TriviumBulkUnlinkRequest,
    TriviumBulkUpsertRequest,
    TriviumBulkUpsertResponse,
    TriviumBulkUpsertResponseItem,
    TriviumBuildTextIndexRequest,
    TriviumCheckMappingsIntegrityRequest,
    TriviumCheckMappingsIntegrityResponse,
    TriviumCompactRequest,
    TriviumDeleteRequest,
    TriviumDeleteOrphanMappingsRequest,
    TriviumDeleteOrphanMappingsResponse,
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
    TriviumListMappingsRequest,
    TriviumListMappingsResponse,
    TriviumNeighborsRequest,
    TriviumNeighborsResponse,
    TriviumNodeView,
    TriviumQueryRequest,
    TriviumQueryResponse,
    TriviumQueryRow,
    TriviumResolveIdRequest,
    TriviumResolveIdResponse,
    TriviumResolveManyRequest,
    TriviumResolveManyResponse,
    TriviumSearchAdvancedRequest,
    TriviumSearchHit,
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

export type AuthorityPermissionErrorDecision = Exclude<PermissionEvaluateResponse['decision'], 'granted'>;
export type AuthorityPermissionErrorCode = 'permission_not_granted' | 'permission_denied' | 'permission_blocked';

export interface AuthorityPermissionErrorDetails {
    code: AuthorityPermissionErrorCode;
    decision: AuthorityPermissionErrorDecision;
    key: string;
    riskLevel: PermissionEvaluateResponse['riskLevel'];
    target: string;
    resource: PermissionResource;
}

export class AuthorityPermissionError extends Error {
    readonly code: AuthorityPermissionErrorCode;
    readonly decision: AuthorityPermissionErrorDecision;
    readonly key: string;
    readonly riskLevel: PermissionEvaluateResponse['riskLevel'];
    readonly target: string;
    readonly resource: PermissionResource;

    constructor(message: string, public readonly details: AuthorityPermissionErrorDetails) {
        super(message);
        this.name = 'AuthorityPermissionError';
        this.code = details.code;
        this.decision = details.decision;
        this.key = details.key;
        this.riskLevel = details.riskLevel;
        this.target = details.target;
        this.resource = details.resource;
    }
}

export function isAuthorityPermissionError(error: unknown): error is AuthorityPermissionError {
    return error instanceof AuthorityPermissionError;
}

function isTerminalJobStatus(status: JobRecord['status']): boolean {
    return status === 'completed' || status === 'failed' || status === 'cancelled';
}

function isJobRecord(value: unknown): value is JobRecord {
    return typeof value === 'object'
        && value !== null
        && typeof (value as { id?: unknown }).id === 'string'
        && typeof (value as { status?: unknown }).status === 'string';
}

function getJobSubscriptionSnapshot(job: JobRecord): string {
    return JSON.stringify(job);
}

function getJobWaitPollInterval(value: unknown): number {
    if (value == null) {
        return 1000;
    }
    if (typeof value === 'number' && Number.isSafeInteger(value) && value > 0) {
        return value;
    }
    throw new Error('Authority job pollIntervalMs must be a positive safe integer');
}

function getOptionalJobWaitTimeout(value: unknown): number | null {
    if (value == null) {
        return null;
    }
    if (typeof value === 'number' && Number.isSafeInteger(value) && value > 0) {
        return value;
    }
    throw new Error('Authority job timeoutMs must be a positive safe integer');
}

function getSqlPageAllPageSize(value: unknown): number {
    if (value == null) {
        return 100;
    }
    if (typeof value === 'number' && Number.isSafeInteger(value) && value > 0) {
        return value;
    }
    throw new Error('Authority sql.pageAll pageSize must be a positive safe integer');
}

function getOptionalMaxPages(value: unknown): number | null {
    if (value == null) {
        return null;
    }
    if (typeof value === 'number' && Number.isSafeInteger(value) && value > 0) {
        return value;
    }
    throw new Error('Authority sql.pageAll maxPages must be a positive safe integer');
}

function throwIfAborted(signal: AbortSignal | undefined): void {
    if (signal?.aborted) {
        throw new Error('Authority job wait aborted');
    }
}

function waitForDelay(ms: number, signal?: AbortSignal): Promise<void> {
    return new Promise((resolve, reject) => {
        if (signal?.aborted) {
            reject(new Error('Authority job wait aborted'));
            return;
        }

        const timer = setTimeout(() => {
            cleanup();
            resolve();
        }, ms);

        const onAbort = () => {
            clearTimeout(timer);
            cleanup();
            reject(new Error('Authority job wait aborted'));
        };

        const cleanup = () => {
            signal?.removeEventListener('abort', onAbort);
        };

        signal?.addEventListener('abort', onAbort, { once: true });
    });
}

function stringifyJsonValue(value: unknown, label: string, space?: string | number): string {
    const serialized = JSON.stringify(value, null, space);
    if (typeof serialized !== 'string') {
        throw new Error(`${label} could not serialize value to JSON`);
    }
    return serialized;
}

export interface JobCreateOptions {
    timeoutMs?: number;
    idempotencyKey?: string;
    maxAttempts?: number;
}

export interface JobWaitForCompletionOptions {
    pollIntervalMs?: number;
    timeoutMs?: number;
    signal?: AbortSignal;
    onProgress?: (job: JobRecord) => void | Promise<void>;
}

export interface JobSubscribeOptions {
    pollIntervalMs?: number;
    emitCurrent?: boolean;
    onUpdate?: (job: JobRecord) => void | Promise<void>;
}

export interface BlobPutJsonRequest {
    name: string;
    value: unknown;
    contentType?: string;
    space?: string | number;
}

export interface PrivateFileWriteJsonOptions extends Omit<PrivateFileWriteRequest, 'path' | 'content' | 'encoding'> {
    space?: string | number;
}

export interface SqlPageAllOptions {
    pageSize?: number;
    maxPages?: number;
    onPage?: (page: SqlQueryResult) => void | Promise<void>;
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
    probe: AuthorityProbeResponse | null;
}

export type AuthorityFeaturePath =
    | 'securityCenter'
    | 'admin'
    | 'sql.queryPage'
    | 'sql.migrations'
    | 'sql.schemaManifest'
    | 'trivium.resolveId'
    | 'trivium.resolveMany'
    | 'trivium.upsert'
    | 'trivium.bulkMutations'
    | 'trivium.filterWherePage'
    | 'trivium.queryPage'
    | 'trivium.mappingPages'
    | 'trivium.mappingIntegrity'
    | 'transfers.blob'
    | 'transfers.fs'
    | 'transfers.httpFetch'
    | 'jobs.background'
    | 'diagnostics.warnings'
    | 'diagnostics.activityPages'
    | 'diagnostics.jobsPage'
    | 'diagnostics.benchmarkCore';

export interface AuthorityChunkSplitOptions {
    maxItemsPerChunk?: number;
    maxBytesPerChunk?: number;
}

export interface AuthorityChunk<T> {
    chunkIndex: number;
    itemOffset: number;
    itemCount: number;
    estimatedBytes: number;
    items: T[];
}

export interface AuthorityChunkedMutationChunkResult<Response extends TriviumBulkMutationResponse = TriviumBulkMutationResponse> {
    chunkIndex: number;
    itemOffset: number;
    itemCount: number;
    estimatedBytes: number;
    elapsedMs: number;
    successCount: number;
    failureCount: number;
    response?: Response;
    error?: string;
}

export interface AuthorityChunkedFailure extends TriviumBulkFailure {
    globalIndex: number;
    chunkIndex: number;
    chunkItemIndex: number;
    itemOffset: number;
    kind: 'item' | 'chunk';
}

export interface AuthorityChunkedTriviumProgress<Response extends TriviumBulkMutationResponse = TriviumBulkMutationResponse> {
    totalChunks: number;
    completedChunks: number;
    totalItems: number;
    completedItems: number;
    successCount: number;
    failureCount: number;
    elapsedMs: number;
    lastChunk: AuthorityChunkedMutationChunkResult<Response>;
}

export interface AuthorityChunkedTriviumOptions<Response extends TriviumBulkMutationResponse = TriviumBulkMutationResponse> extends AuthorityChunkSplitOptions {
    continueOnChunkError?: boolean;
    onProgress?: (progress: AuthorityChunkedTriviumProgress<Response>) => void | Promise<void>;
}

export interface AuthorityChunkedTriviumMutationResult<Response extends TriviumBulkMutationResponse = TriviumBulkMutationResponse> extends TriviumBulkMutationResponse {
    chunkCount: number;
    elapsedMs: number;
    chunks: AuthorityChunkedMutationChunkResult<Response>[];
    failures: AuthorityChunkedFailure[];
}

export interface AuthorityChunkedTriviumUpsertResponseItem extends TriviumBulkUpsertResponseItem {
    globalIndex: number;
    chunkIndex: number;
    chunkItemIndex: number;
}

export interface AuthorityChunkedTriviumUpsertResult extends AuthorityChunkedTriviumMutationResult<TriviumBulkUpsertResponse> {
    items: AuthorityChunkedTriviumUpsertResponseItem[];
}

interface SessionRequestOptions {
    method?: 'GET' | 'POST';
    body?: unknown;
}

const SDK_TRANSFER_INLINE_THRESHOLD_BYTES = 256 * 1024;
const DEFAULT_TRIVIUM_CHUNK_ITEMS = 128;
const DEFAULT_TRIVIUM_CHUNK_BYTES = 256 * 1024;
const UTF8_ENCODER = new TextEncoder();

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
            putJsonLarge: (input: BlobPutJsonRequest) => Promise<BlobRecord>;
            get: (id: string) => Promise<BlobGetResponse>;
            delete: (id: string) => Promise<void>;
            list: () => Promise<BlobRecord[]>;
        };
    };

    readonly fs: {
        mkdir: (path: string, options?: { recursive?: boolean }) => Promise<PrivateFileEntry>;
        readDir: (path?: string, options?: Omit<PrivateFileReadDirRequest, 'path'>) => Promise<PrivateFileEntry[]>;
        writeFile: (path: string, content: string, options?: Omit<PrivateFileWriteRequest, 'path' | 'content'>) => Promise<PrivateFileEntry>;
        writeJson: (path: string, value: unknown, options?: PrivateFileWriteJsonOptions) => Promise<PrivateFileEntry>;
        readFile: (path: string, options?: Omit<PrivateFileReadRequest, 'path'>) => Promise<PrivateFileReadResponse>;
        delete: (path: string, options?: Omit<PrivateFileDeleteRequest, 'path'>) => Promise<void>;
        stat: (path: string) => Promise<PrivateFileEntry>;
    };

    readonly sql: {
        query: (input: SqlQueryRequest) => Promise<SqlQueryResult>;
        pageAll: (input: SqlQueryRequest, options?: SqlPageAllOptions) => Promise<SqlQueryResult>;
        exec: (input: SqlExecRequest) => Promise<SqlExecResult>;
        batch: (input: SqlBatchRequest) => Promise<SqlBatchResponse>;
        transaction: (input: SqlTransactionRequest) => Promise<SqlTransactionResponse>;
        migrate: (input: SqlMigrateRequest) => Promise<SqlMigrateResponse>;
        listMigrationsPage: (input?: SqlListMigrationsRequest) => Promise<SqlListMigrationsResponse>;
        listSchemaPage: (input?: SqlListSchemaRequest) => Promise<SqlListSchemaResponse>;
        listDatabases: () => Promise<SqlListDatabasesResponse>;
    };

    readonly trivium: {
        insert: (input: TriviumInsertRequest) => Promise<TriviumInsertResponse>;
        insertWithId: (input: TriviumInsertWithIdRequest) => Promise<void>;
        resolveId: (input: TriviumResolveIdRequest) => Promise<TriviumResolveIdResponse>;
        resolveMany: (input: TriviumResolveManyRequest) => Promise<TriviumResolveManyResponse>;
        upsert: (input: TriviumUpsertRequest) => Promise<TriviumUpsertResponse>;
        bulkUpsert: (input: TriviumBulkUpsertRequest) => Promise<TriviumBulkUpsertResponse>;
        bulkUpsertChunked: (input: TriviumBulkUpsertRequest, options?: AuthorityChunkedTriviumOptions<TriviumBulkUpsertResponse>) => Promise<AuthorityChunkedTriviumUpsertResult>;
        get: (input: TriviumGetRequest) => Promise<TriviumNodeView | null>;
        updatePayload: (input: TriviumUpdatePayloadRequest) => Promise<void>;
        updateVector: (input: TriviumUpdateVectorRequest) => Promise<void>;
        delete: (input: TriviumDeleteRequest) => Promise<void>;
        bulkDelete: (input: TriviumBulkDeleteRequest) => Promise<TriviumBulkMutationResponse>;
        bulkDeleteChunked: (input: TriviumBulkDeleteRequest, options?: AuthorityChunkedTriviumOptions) => Promise<AuthorityChunkedTriviumMutationResult>;
        link: (input: TriviumLinkRequest) => Promise<void>;
        bulkLink: (input: TriviumBulkLinkRequest) => Promise<TriviumBulkMutationResponse>;
        bulkLinkChunked: (input: TriviumBulkLinkRequest, options?: AuthorityChunkedTriviumOptions) => Promise<AuthorityChunkedTriviumMutationResult>;
        unlink: (input: TriviumUnlinkRequest) => Promise<void>;
        bulkUnlink: (input: TriviumBulkUnlinkRequest) => Promise<TriviumBulkMutationResponse>;
        bulkUnlinkChunked: (input: TriviumBulkUnlinkRequest, options?: AuthorityChunkedTriviumOptions) => Promise<AuthorityChunkedTriviumMutationResult>;
        neighbors: (input: TriviumNeighborsRequest) => Promise<TriviumNeighborsResponse>;
        search: (input: TriviumSearchRequest) => Promise<TriviumSearchHit[]>;
        searchAdvanced: (input: TriviumSearchAdvancedRequest) => Promise<TriviumSearchHit[]>;
        searchHybrid: (input: TriviumSearchHybridRequest) => Promise<TriviumSearchHit[]>;
        filterWhere: (input: TriviumFilterWhereRequest) => Promise<TriviumNodeView[]>;
        filterWherePage: (input: TriviumFilterWhereRequest) => Promise<TriviumFilterWhereResponse>;
        query: (input: TriviumQueryRequest) => Promise<TriviumQueryRow[]>;
        queryPage: (input: TriviumQueryRequest) => Promise<TriviumQueryResponse>;
        listMappingsPage: (input?: TriviumListMappingsRequest) => Promise<TriviumListMappingsResponse>;
        checkMappingsIntegrity: (input?: TriviumCheckMappingsIntegrityRequest) => Promise<TriviumCheckMappingsIntegrityResponse>;
        deleteOrphanMappings: (input?: TriviumDeleteOrphanMappingsRequest) => Promise<TriviumDeleteOrphanMappingsResponse>;
        indexText: (input: TriviumIndexTextRequest) => Promise<void>;
        indexKeyword: (input: TriviumIndexKeywordRequest) => Promise<void>;
        buildTextIndex: (input?: TriviumBuildTextIndexRequest) => Promise<void>;
        compact: (input?: TriviumCompactRequest) => Promise<void>;
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
        listPage: (input?: JobListRequest) => Promise<JobListResponse>;
        cancel: (id: string) => Promise<JobRecord>;
        waitForCompletion: (id: string, options?: JobWaitForCompletionOptions) => Promise<JobRecord>;
        subscribe: (id: string, options?: JobSubscribeOptions) => Promise<AuthorityEventsSubscription>;
    };

    readonly events: {
        subscribe: (channelOrOptions?: string | AuthorityEventsSubscribeOptions, handler?: (event: AuthorityEventEnvelope) => void) => Promise<AuthorityEventsSubscription>;
    };

    private session: SessionInitResponse | null = null;
    private sessionPromise: Promise<SessionInitResponse> | null = null;
    private probeSnapshot: AuthorityProbeResponse | null = null;
    private probePromise: Promise<AuthorityProbeResponse> | null = null;
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
                putJsonLarge: async input => {
                    return await this.storage.blob.put({
                        name: input.name,
                        content: stringifyJsonValue(input.value, 'Authority blob.putJsonLarge', input.space),
                        encoding: 'utf8',
                        contentType: input.contentType ?? 'application/json',
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
            pageAll: async (input, options = {}) => {
                await this.requireFeature('sql.queryPage', 'Authority 当前版本尚未提供 SQL 分页查询能力');
                const pageSize = getSqlPageAllPageSize(options.pageSize ?? input.page?.limit);
                const maxPages = getOptionalMaxPages(options.maxPages);
                const rows: SqlQueryResult['rows'] = [];
                let columns: SqlQueryResult['columns'] | null = null;
                let pageCount = 0;
                let cursor = input.page?.cursor ?? null;
                let lastPageInfo: SqlQueryResult['page'] | undefined;

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
                    } else if (JSON.stringify(columns) !== JSON.stringify(page.columns)) {
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
            listMigrationsPage: async (input = {}) => {
                const database = getSqlDatabaseName(input.database);
                await this.requireFeature('sql.migrations', 'Authority 当前版本尚未提供 SQL migration introspection 能力');
                await this.ensurePermission({
                    resource: 'sql.private',
                    target: database,
                    reason: `列出 SQL 迁移记录 ${database}`,
                });
                return await this.requestWithSession<SqlListMigrationsResponse>('/sql/list-migrations', {
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
                return await this.requestWithSession<SqlListSchemaResponse>('/sql/list-schema', {
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
            resolveMany: async input => {
                const database = getTriviumDatabaseName(input.database);
                await this.requireFeature('trivium.resolveMany', 'Authority 当前版本尚未提供 Trivium 批量映射解析能力');
                await this.ensurePermission({
                    resource: 'trivium.private',
                    target: database,
                    reason: `批量解析 Trivium externalId 或内部 ID（${database}）`,
                });
                return await this.requestWithSession<TriviumResolveManyResponse>('/trivium/resolve-many', {
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
                return await this.bulkUpsertTriviumRequest({
                    ...input,
                    database,
                });
            },
            bulkUpsertChunked: async (input, options) => {
                return await this.bulkUpsertTriviumChunked(input, options);
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
                return await this.bulkDeleteTriviumRequest({
                    ...input,
                    database,
                });
            },
            bulkDeleteChunked: async (input, options) => {
                return await this.bulkDeleteTriviumChunked(input, options);
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
                return await this.bulkLinkTriviumRequest({
                    ...input,
                    database,
                });
            },
            bulkLinkChunked: async (input, options) => {
                return await this.bulkLinkTriviumChunked(input, options);
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
                return await this.bulkUnlinkTriviumRequest({
                    ...input,
                    database,
                });
            },
            bulkUnlinkChunked: async (input, options) => {
                return await this.bulkUnlinkTriviumChunked(input, options);
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
                await this.requireFeature('trivium.filterWherePage', 'Authority 当前版本尚未提供 Trivium 分页过滤能力');
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
                await this.requireFeature('trivium.queryPage', 'Authority 当前版本尚未提供 Trivium 图查询分页能力');
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
            listMappingsPage: async (input = {}) => {
                const database = getTriviumDatabaseName(input.database);
                await this.requireFeature('trivium.mappingPages', 'Authority 当前版本尚未提供 Trivium 映射分页能力');
                await this.ensurePermission({
                    resource: 'trivium.private',
                    target: database,
                    reason: `分页列出 Trivium externalId 映射（${database}）`,
                });
                return await this.requestWithSession<TriviumListMappingsResponse>('/trivium/list-mappings', {
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
                return await this.requestWithSession<TriviumCheckMappingsIntegrityResponse>('/trivium/check-mappings-integrity', {
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
                return await this.requestWithSession<TriviumDeleteOrphanMappingsResponse>('/trivium/delete-orphan-mappings', {
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
            listPage: async (input = {}) => {
                await this.requireFeature('diagnostics.jobsPage', 'Authority 当前版本尚未提供后台任务分页能力');
                return await this.requestWithSession<JobListResponse>('/jobs/list', {
                    method: 'POST',
                    body: input,
                });
            },
            cancel: async id => {
                return await this.requestWithSession<JobRecord>(`/jobs/${encodeURIComponent(id)}/cancel`, {
                    method: 'POST',
                });
            },
            waitForCompletion: async (id, options = {}) => {
                const pollIntervalMs = getJobWaitPollInterval(options.pollIntervalMs);
                const timeoutMs = getOptionalJobWaitTimeout(options.timeoutMs);
                const startedAt = Date.now();

                while (true) {
                    throwIfAborted(options.signal);
                    const job = await this.jobs.get(id);
                    await options.onProgress?.(job);
                    if (isTerminalJobStatus(job.status)) {
                        return job;
                    }
                    if (timeoutMs != null && Date.now() - startedAt >= timeoutMs) {
                        throw new Error(`Authority job ${id} did not complete within ${timeoutMs}ms`);
                    }
                    await waitForDelay(pollIntervalMs, options.signal);
                }
            },
            subscribe: async (id, options = {}) => {
                const pollIntervalMs = getJobWaitPollInterval(options.pollIntervalMs);
                let closed = false;
                let pollTimer: ReturnType<typeof setTimeout> | null = null;
                let lastSnapshot: string | null = null;

                const close = (subscription?: AuthorityEventsSubscription) => {
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

                const emitIfMatch = async (value: unknown, subscription?: AuthorityEventsSubscription): Promise<void> => {
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

                const poll = async (): Promise<void> => {
                    if (closed) {
                        return;
                    }
                    try {
                        const job = await this.jobs.get(id);
                        await emitIfMatch(job, subscription);
                    } finally {
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

    async probe(force = false): Promise<AuthorityProbeResponse> {
        if (force) {
            this.probeSnapshot = null;
            this.probePromise = null;
        }

        return cloneAuthorityProbe(await this.ensureProbe());
    }

    getProbe(): AuthorityProbeResponse | null {
        return this.probeSnapshot ? cloneAuthorityProbe(this.probeSnapshot) : null;
    }

    hasFeature(feature: AuthorityFeaturePath): boolean {
        if (this.probeSnapshot) {
            return getFeatureAvailability(this.probeSnapshot.features, feature);
        }

        if (this.session) {
            return getFeatureAvailability(this.session.features, feature);
        }

        return false;
    }

    async requireFeature(feature: AuthorityFeaturePath, message?: string): Promise<void> {
        if (this.hasFeature(feature)) {
            return;
        }

        const probe = await this.ensureProbe();
        if (getFeatureAvailability(probe.features, feature)) {
            return;
        }

        throw new Error(message ?? `Authority feature not available: ${feature}`);
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
            probe: this.getProbe(),
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

    private async ensureProbe(): Promise<AuthorityProbeResponse> {
        if (this.probeSnapshot) {
            return this.probeSnapshot;
        }

        if (!this.probePromise) {
            this.probePromise = authorityRequest<AuthorityProbeResponse>('/probe', {
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

    private async bulkUpsertTriviumRequest(input: TriviumBulkUpsertRequest): Promise<TriviumBulkUpsertResponse> {
        return await this.requestWithSession<TriviumBulkUpsertResponse>('/trivium/bulk-upsert', {
            method: 'POST',
            body: input,
        });
    }

    private async bulkDeleteTriviumRequest(input: TriviumBulkDeleteRequest): Promise<TriviumBulkMutationResponse> {
        return await this.requestWithSession<TriviumBulkMutationResponse>('/trivium/bulk-delete', {
            method: 'POST',
            body: input,
        });
    }

    private async bulkLinkTriviumRequest(input: TriviumBulkLinkRequest): Promise<TriviumBulkMutationResponse> {
        return await this.requestWithSession<TriviumBulkMutationResponse>('/trivium/bulk-link', {
            method: 'POST',
            body: input,
        });
    }

    private async bulkUnlinkTriviumRequest(input: TriviumBulkUnlinkRequest): Promise<TriviumBulkMutationResponse> {
        return await this.requestWithSession<TriviumBulkMutationResponse>('/trivium/bulk-unlink', {
            method: 'POST',
            body: input,
        });
    }

    private async bulkUpsertTriviumChunked(
        input: TriviumBulkUpsertRequest,
        options: AuthorityChunkedTriviumOptions<TriviumBulkUpsertResponse> = {},
    ): Promise<AuthorityChunkedTriviumUpsertResult> {
        const database = getTriviumDatabaseName(input.database);
        await this.requireFeature('trivium.bulkMutations', 'Authority 当前版本尚未提供 Trivium 分块批量写入能力');
        await this.ensurePermission({
            resource: 'trivium.private',
            target: database,
            reason: `分块批量写入或更新 Trivium 节点（${database}）`,
        });

        const result = await this.runTriviumChunkedMutation<TriviumBulkUpsertRequest, TriviumBulkUpsertResponse>(
            {
                ...input,
                database,
            },
            options,
            async chunkInput => await this.bulkUpsertTriviumRequest(chunkInput),
        );

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

    private async bulkDeleteTriviumChunked(
        input: TriviumBulkDeleteRequest,
        options: AuthorityChunkedTriviumOptions = {},
    ): Promise<AuthorityChunkedTriviumMutationResult> {
        const database = getTriviumDatabaseName(input.database);
        await this.requireFeature('trivium.bulkMutations', 'Authority 当前版本尚未提供 Trivium 分块批量删除能力');
        await this.ensurePermission({
            resource: 'trivium.private',
            target: database,
            reason: `分块批量删除 Trivium 节点（${database}）`,
        });

        return await this.runTriviumChunkedMutation<TriviumBulkDeleteRequest, TriviumBulkMutationResponse>(
            {
                ...input,
                database,
            },
            options,
            async chunkInput => await this.bulkDeleteTriviumRequest(chunkInput),
        );
    }

    private async bulkLinkTriviumChunked(
        input: TriviumBulkLinkRequest,
        options: AuthorityChunkedTriviumOptions = {},
    ): Promise<AuthorityChunkedTriviumMutationResult> {
        const database = getTriviumDatabaseName(input.database);
        await this.requireFeature('trivium.bulkMutations', 'Authority 当前版本尚未提供 Trivium 分块批量建边能力');
        await this.ensurePermission({
            resource: 'trivium.private',
            target: database,
            reason: `分块批量建立 Trivium 图边（${database}）`,
        });

        return await this.runTriviumChunkedMutation<TriviumBulkLinkRequest, TriviumBulkMutationResponse>(
            {
                ...input,
                database,
            },
            options,
            async chunkInput => await this.bulkLinkTriviumRequest(chunkInput),
        );
    }

    private async bulkUnlinkTriviumChunked(
        input: TriviumBulkUnlinkRequest,
        options: AuthorityChunkedTriviumOptions = {},
    ): Promise<AuthorityChunkedTriviumMutationResult> {
        const database = getTriviumDatabaseName(input.database);
        await this.requireFeature('trivium.bulkMutations', 'Authority 当前版本尚未提供 Trivium 分块批量删边能力');
        await this.ensurePermission({
            resource: 'trivium.private',
            target: database,
            reason: `分块批量删除 Trivium 图边（${database}）`,
        });

        return await this.runTriviumChunkedMutation<TriviumBulkUnlinkRequest, TriviumBulkMutationResponse>(
            {
                ...input,
                database,
            },
            options,
            async chunkInput => await this.bulkUnlinkTriviumRequest(chunkInput),
        );
    }

    private async runTriviumChunkedMutation<Input extends { items: unknown[] }, Response extends TriviumBulkMutationResponse>(
        input: Input,
        options: AuthorityChunkedTriviumOptions<Response>,
        execute: (chunkInput: Input) => Promise<Response>,
    ): Promise<AuthorityChunkedTriviumMutationResult<Response>> {
        const chunks = splitAuthorityItemsIntoChunks(input.items, options);
        const startedAt = Date.now();
        const results: AuthorityChunkedMutationChunkResult<Response>[] = [];
        const failures: AuthorityChunkedFailure[] = [];
        let successCount = 0;
        let failureCount = 0;
        let completedItems = 0;

        for (const chunk of chunks) {
            const chunkStartedAt = Date.now();
            try {
                const response = await execute({
                    ...input,
                    items: chunk.items,
                } as Input);
                const normalizedFailures = response.failures.map(failure => {
                    const globalIndex = chunk.itemOffset + failure.index;
                    return {
                        index: globalIndex,
                        globalIndex,
                        chunkIndex: chunk.chunkIndex,
                        chunkItemIndex: failure.index,
                        itemOffset: chunk.itemOffset,
                        kind: 'item' as const,
                        message: failure.message,
                    };
                });
                const chunkResult: AuthorityChunkedMutationChunkResult<Response> = {
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
            } catch (error) {
                const message = error instanceof Error ? error.message : String(error);
                const chunkFailures = chunk.items.map((_, index) => {
                    const globalIndex = chunk.itemOffset + index;
                    return {
                        index: globalIndex,
                        globalIndex,
                        chunkIndex: chunk.chunkIndex,
                        chunkItemIndex: index,
                        itemOffset: chunk.itemOffset,
                        kind: 'chunk' as const,
                        message,
                    };
                });
                const chunkResult: AuthorityChunkedMutationChunkResult<Response> = {
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

function cloneAuthorityProbe(probe: AuthorityProbeResponse): AuthorityProbeResponse {
    return JSON.parse(JSON.stringify(probe)) as AuthorityProbeResponse;
}

export function splitAuthorityItemsIntoChunks<T>(items: T[], options: AuthorityChunkSplitOptions = {}): AuthorityChunk<T>[] {
    const maxItemsPerChunk = normalizePositiveInteger(options.maxItemsPerChunk, DEFAULT_TRIVIUM_CHUNK_ITEMS, 'maxItemsPerChunk');
    const maxBytesPerChunk = normalizePositiveInteger(options.maxBytesPerChunk, DEFAULT_TRIVIUM_CHUNK_BYTES, 'maxBytesPerChunk');
    if (items.length === 0) {
        return [];
    }

    const chunks: AuthorityChunk<T>[] = [];
    let current: T[] = [];
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

function getFeatureAvailability(features: AuthorityFeatureFlags, feature: AuthorityFeaturePath): boolean {
    switch (feature) {
        case 'securityCenter':
            return features.securityCenter;
        case 'admin':
            return features.admin;
        case 'sql.queryPage':
            return features.sql.queryPage;
        case 'sql.migrations':
            return features.sql.migrations;
        case 'sql.schemaManifest':
            return features.sql.schemaManifest;
        case 'trivium.resolveId':
            return features.trivium.resolveId;
        case 'trivium.resolveMany':
            return features.trivium.resolveMany;
        case 'trivium.upsert':
            return features.trivium.upsert;
        case 'trivium.bulkMutations':
            return features.trivium.bulkMutations;
        case 'trivium.filterWherePage':
            return features.trivium.filterWherePage;
        case 'trivium.queryPage':
            return features.trivium.queryPage;
        case 'trivium.mappingPages':
            return features.trivium.mappingPages;
        case 'trivium.mappingIntegrity':
            return features.trivium.mappingIntegrity;
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

function normalizePositiveInteger(value: number | undefined, fallback: number, label: string): number {
    if (value === undefined) {
        return fallback;
    }
    if (!Number.isInteger(value) || value <= 0) {
        throw new Error(`${label} must be a positive integer`);
    }
    return value;
}

function estimateJsonBytes(value: unknown): number {
    return UTF8_ENCODER.encode(JSON.stringify(value)).length;
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

function getAuthorityPermissionErrorCode(decision: AuthorityPermissionErrorDecision): AuthorityPermissionErrorCode {
    if (decision === 'denied') {
        return 'permission_denied';
    }

    if (decision === 'blocked') {
        return 'permission_blocked';
    }

    return 'permission_not_granted';
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

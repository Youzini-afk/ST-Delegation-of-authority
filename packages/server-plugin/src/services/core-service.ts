import fs from 'node:fs';
import crypto from 'node:crypto';
import net from 'node:net';
import path from 'node:path';
import process from 'node:process';
import { spawn, type ChildProcess } from 'node:child_process';
import type {
    AuthorityErrorCategory,
    AuthorityErrorCode,
    AuthorityInitConfig,
    BlobGetResponse,
    BlobRecord,
    ControlBlobDeleteRequest,
    ControlBlobGetRequest,
    ControlBlobListRequest,
    ControlBlobListResponse,
    ControlBlobOpenReadResponse,
    ControlBlobPutRequest,
    ControlAuditLogRequest,
    ControlAuditRecentRequest,
    ControlAuditRecentResponse,
    ControlEventRecord,
    ControlEventsPollRequest,
    ControlEventsPollResponse,
    ControlExtensionGetRequest,
    ControlExtensionRecord,
    ControlExtensionResponse,
    ControlExtensionsListResponse,
    ControlGrantGetRequest,
    ControlGrantListRequest,
    ControlGrantListResponse,
    ControlGrantRecord,
    ControlGrantResetRequest,
    ControlGrantResponse,
    ControlGrantUpsertRequest,
    ControlJobCancelRequest,
    ControlJobCreateRequest,
    ControlJobGetRequest,
    ControlJobRequeueRequest,
    ControlJobRecord,
    ControlJobResponse,
    ControlJobsListRequest,
    ControlJobsListResponse,
    ControlJobUpsertRequest,
    ControlKvDeleteRequest,
    ControlKvGetRequest,
    ControlKvListRequest,
    ControlKvListResponse,
    ControlKvResponse,
    ControlKvSetRequest,
    ControlPoliciesRequest,
    ControlPoliciesResponse,
    ControlPoliciesSaveRequest,
    ControlPrivateFileDeleteRequest,
    ControlHttpFetchOpenRequest,
    ControlHttpFetchOpenResponse,
    ControlPrivateFileMkdirRequest,
    ControlPrivateFileOpenReadResponse,
    ControlPrivateFileReadDirRequest,
    ControlPrivateFileReadRequest,
    ControlPrivateFileStatRequest,
    ControlPrivateFileWriteRequest,
    ControlSessionResponse,
    ControlSessionSnapshot,
    HttpFetchRequest,
    HttpFetchResponse,
    PrivateFileDeleteResponse,
    PrivateFileEntry,
    PrivateFileListResponse,
    PrivateFileReadResponse,
    PrivateFileResponse,
    SqlBatchRequest,
    SqlBatchResponse,
    SqlExecRequest,
    SqlExecResult,
    SqlMigrateRequest,
    SqlMigrateResponse,
    SqlQueryRequest,
    SqlQueryResult,
    SqlStatRequest,
    SqlStatResponse,
    SqlTransactionRequest,
    SqlTransactionResponse,
    ControlTriviumBulkDeleteRequest,
    ControlTriviumBulkLinkRequest,
    ControlTriviumBulkUnlinkRequest,
    ControlTriviumBulkUpsertRequest,
    ControlTriviumBulkUpsertResponse,
    TriviumDeleteRequest,
    TriviumBuildTextIndexRequest,
    TriviumBulkMutationResponse,
    TriviumCompactRequest,
    TriviumCreateIndexRequest,
    TriviumDropIndexRequest,
    TriviumFlushRequest,
    TriviumGetRequest,
    TriviumIndexKeywordRequest,
    TriviumIndexTextRequest,
    TriviumInsertRequest,
    TriviumInsertResponse,
    TriviumInsertWithIdRequest,
    TriviumLinkRequest,
    TriviumNeighborsRequest,
    TriviumNeighborsResponse,
    TriviumNodeView,
    TriviumSearchHit,
    TriviumSearchAdvancedRequest,
    TriviumSearchHybridRequest,
    TriviumSearchHybridWithContextRequest,
    TriviumSearchHybridWithContextResponse,
    TriviumSearchRequest,
    TriviumStatRequest,
    TriviumStatResponse,
    TriviumTqlMutRequest,
    TriviumTqlMutResponse,
    TriviumTqlRequest,
    TriviumTqlResponse,
    TriviumTqlRow,
    TriviumUnlinkRequest,
    TriviumUpdatePayloadRequest,
    TriviumUpdateVectorRequest,
} from '@stdo/shared-types';
import { AUTHORITY_MANAGED_CORE_DIR } from '../constants.js';
import type { AuthorityCoreHealthSnapshot, AuthorityCoreManagedMetadata, AuthorityCoreStatus, CoreRuntimeState } from '../types.js';
import { asErrorMessage, AuthorityServiceError, randomToken, resolveRuntimePath } from '../utils.js';

interface CoreArtifact {
    binaryPath: string;
    metadata: AuthorityCoreManagedMetadata;
}

interface CoreServiceOptions {
    runtimeDir?: string;
    cwd?: string;
    env?: NodeJS.ProcessEnv;
    logger?: Pick<typeof console, 'info' | 'warn' | 'error'>;
}

interface CoreSqlRequestPayload {
    dbPath: string;
    statement: string;
    params?: SqlQueryRequest['params'];
    page?: SqlQueryRequest['page'];
}

interface CoreSqlBatchRequestPayload {
    dbPath: string;
    statements: SqlBatchRequest['statements'];
}

interface CoreSqlMigrateRequestPayload {
    dbPath: string;
    migrations: SqlMigrateRequest['migrations'];
    tableName?: SqlMigrateRequest['tableName'];
}

interface CoreTriviumOpenRequestPayload {
    dbPath: string;
    dim?: number;
    dtype?: TriviumInsertRequest['dtype'];
    syncMode?: TriviumInsertRequest['syncMode'];
    storageMode?: TriviumInsertRequest['storageMode'];
}

const HEALTH_TIMEOUT_MS = 5000;
const HEALTH_POLL_INTERVAL_MS = 150;
const CORE_API_VERSION = 'authority-core/v1';

export class CoreService {
    private readonly runtimeDir: string;
    private readonly cwd: string;
    private readonly env: NodeJS.ProcessEnv;
    private readonly logger: Pick<typeof console, 'info' | 'warn' | 'error'>;
    private child: ChildProcess | null = null;
    private token: string | null = null;
    private stopping = false;
    private status: AuthorityCoreStatus;

    constructor(options: CoreServiceOptions = {}) {
        this.runtimeDir = path.resolve(options.runtimeDir ?? __dirname);
        this.cwd = path.resolve(options.cwd ?? process.cwd());
        this.env = options.env ?? process.env;
        this.logger = options.logger ?? console;
        this.status = {
            enabled: true,
            state: 'stopped',
            platform: process.platform,
            arch: process.arch,
            binaryPath: null,
            port: null,
            pid: null,
            version: null,
            startedAt: null,
            lastError: null,
            health: null,
        };
    }

    getStatus(): AuthorityCoreStatus {
        return {
            ...this.status,
            health: this.status.health ? { ...this.status.health } : null,
        };
    }

    async start(): Promise<AuthorityCoreStatus> {
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

        const managedCoreRoots = this.resolveManagedCoreRoots();
        const artifact = this.resolveArtifact(managedCoreRoots);
        if (!artifact) {
            this.setStatus('missing', {
                binaryPath: null,
                version: null,
                lastError: describeMissingManagedCore(managedCoreRoots, this.env),
                port: null,
                pid: null,
                startedAt: null,
                health: null,
            });
            return this.getStatus();
        }

        const port = await getAvailablePort();
        const token = randomToken();
        const child = spawn(artifact.binaryPath, [], {
            cwd: this.cwd,
            env: {
                ...this.env,
                AUTHORITY_CORE_HOST: '127.0.0.1',
                AUTHORITY_CORE_PORT: String(port),
                AUTHORITY_CORE_TOKEN: token,
                AUTHORITY_CORE_VERSION: artifact.metadata.version,
                AUTHORITY_CORE_API_VERSION: CORE_API_VERSION,
                AUTHORITY_CORE_DATA_ROOT: resolveCoreDataRoot(this.env.AUTHORITY_CORE_DATA_ROOT, this.cwd),
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
        } catch (error) {
            const message = asErrorMessage(error);
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

    async stop(): Promise<void> {
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

    async refreshHealth(): Promise<AuthorityCoreHealthSnapshot | null> {
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
        } catch (error) {
            const message = asErrorMessage(error);
            this.status = {
                ...this.status,
                state: 'error',
                health: null,
                lastError: message,
            };
            return null;
        }
    }

    async querySql(dbPath: string, request: SqlQueryRequest): Promise<SqlQueryResult> {
        return await this.request('/v1/sql/query', {
            dbPath,
            statement: request.statement,
            params: request.params ?? [],
            ...(request.page === undefined ? {} : { page: request.page }),
        } satisfies CoreSqlRequestPayload);
    }

    async execSql(dbPath: string, request: SqlExecRequest): Promise<SqlExecResult> {
        return await this.request('/v1/sql/exec', {
            dbPath,
            statement: request.statement,
            params: request.params ?? [],
        } satisfies CoreSqlRequestPayload);
    }

    async batchSql(dbPath: string, request: SqlBatchRequest): Promise<SqlBatchResponse> {
        return await this.request('/v1/sql/batch', {
            dbPath,
            statements: request.statements,
        } satisfies CoreSqlBatchRequestPayload);
    }

    async transactionSql(dbPath: string, request: SqlTransactionRequest): Promise<SqlTransactionResponse> {
        return await this.request('/v1/sql/transaction', {
            dbPath,
            statements: request.statements,
        } satisfies CoreSqlBatchRequestPayload);
    }

    async migrateSql(dbPath: string, request: SqlMigrateRequest): Promise<SqlMigrateResponse> {
        return await this.request('/v1/sql/migrate', {
            dbPath,
            migrations: request.migrations,
            tableName: request.tableName,
        } satisfies CoreSqlMigrateRequestPayload);
    }

    async statSql(dbPath: string, _request: SqlStatRequest = {}): Promise<SqlStatResponse> {
        return await this.request('/v1/sql/stat', {
            dbPath,
        });
    }

    async insertTrivium(dbPath: string, request: TriviumInsertRequest): Promise<TriviumInsertResponse> {
        return await this.request('/v1/trivium/insert', {
            ...buildTriviumOpenPayload(dbPath, request),
            vector: request.vector,
            payload: request.payload,
        });
    }

    async insertTriviumWithId(dbPath: string, request: TriviumInsertWithIdRequest): Promise<void> {
        await this.request('/v1/trivium/insert-with-id', {
            ...buildTriviumOpenPayload(dbPath, request),
            id: request.id,
            vector: request.vector,
            payload: request.payload,
        });
    }

    async bulkUpsertTrivium(dbPath: string, request: ControlTriviumBulkUpsertRequest): Promise<ControlTriviumBulkUpsertResponse> {
        return await this.request('/v1/trivium/bulk-upsert', {
            ...buildTriviumOpenPayload(dbPath, request),
            items: request.items,
        });
    }

    async getTrivium(dbPath: string, request: TriviumGetRequest): Promise<TriviumNodeView | null> {
        const response = await this.request<{ node: TriviumNodeView | null }>('/v1/trivium/get', {
            ...buildTriviumOpenPayload(dbPath, request),
            id: request.id,
        });
        return response.node;
    }

    async updateTriviumPayload(dbPath: string, request: TriviumUpdatePayloadRequest): Promise<void> {
        await this.request('/v1/trivium/update-payload', {
            ...buildTriviumOpenPayload(dbPath, request),
            id: request.id,
            payload: request.payload,
        });
    }

    async updateTriviumVector(dbPath: string, request: TriviumUpdateVectorRequest): Promise<void> {
        await this.request('/v1/trivium/update-vector', {
            ...buildTriviumOpenPayload(dbPath, request),
            id: request.id,
            vector: request.vector,
        });
    }

    async deleteTrivium(dbPath: string, request: TriviumDeleteRequest): Promise<void> {
        await this.request('/v1/trivium/delete', {
            ...buildTriviumOpenPayload(dbPath, request),
            id: request.id,
        });
    }

    async linkTrivium(dbPath: string, request: TriviumLinkRequest): Promise<void> {
        await this.request('/v1/trivium/link', {
            ...buildTriviumOpenPayload(dbPath, request),
            src: request.src,
            dst: request.dst,
            label: request.label,
            weight: request.weight,
        });
    }

    async bulkLinkTrivium(dbPath: string, request: ControlTriviumBulkLinkRequest): Promise<TriviumBulkMutationResponse> {
        return await this.request('/v1/trivium/bulk-link', {
            ...buildTriviumOpenPayload(dbPath, request),
            items: request.items,
        });
    }

    async unlinkTrivium(dbPath: string, request: TriviumUnlinkRequest): Promise<void> {
        await this.request('/v1/trivium/unlink', {
            ...buildTriviumOpenPayload(dbPath, request),
            src: request.src,
            dst: request.dst,
        });
    }

    async bulkUnlinkTrivium(dbPath: string, request: ControlTriviumBulkUnlinkRequest): Promise<TriviumBulkMutationResponse> {
        return await this.request('/v1/trivium/bulk-unlink', {
            ...buildTriviumOpenPayload(dbPath, request),
            items: request.items,
        });
    }

    async bulkDeleteTrivium(dbPath: string, request: ControlTriviumBulkDeleteRequest): Promise<TriviumBulkMutationResponse> {
        return await this.request('/v1/trivium/bulk-delete', {
            ...buildTriviumOpenPayload(dbPath, request),
            items: request.items,
        });
    }

    async neighborsTrivium(dbPath: string, request: TriviumNeighborsRequest): Promise<TriviumNeighborsResponse> {
        return await this.request('/v1/trivium/neighbors', {
            ...buildTriviumOpenPayload(dbPath, request),
            id: request.id,
            depth: request.depth,
        });
    }

    async searchTrivium(dbPath: string, request: TriviumSearchRequest): Promise<TriviumSearchHit[]> {
        const response = await this.request<{ hits: TriviumSearchHit[] }>('/v1/trivium/search', {
            ...buildTriviumOpenPayload(dbPath, request),
            vector: request.vector,
            topK: request.topK,
            expandDepth: request.expandDepth,
            minScore: request.minScore,
        });
        return response.hits;
    }

    async searchAdvancedTrivium(dbPath: string, request: TriviumSearchAdvancedRequest): Promise<TriviumSearchHit[]> {
        const response = await this.request<{ hits: TriviumSearchHit[] }>('/v1/trivium/search-advanced', {
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
            ...(request.forceBruteForce === undefined ? {} : { forceBruteForce: request.forceBruteForce }),
            ...(request.textBoost === undefined ? {} : { textBoost: request.textBoost }),
            ...(request.enableTextHybridSearch === undefined ? {} : { enableTextHybridSearch: request.enableTextHybridSearch }),
            ...(request.bm25K1 === undefined ? {} : { bm25K1: request.bm25K1 }),
            ...(request.bm25B === undefined ? {} : { bm25B: request.bm25B }),
            ...(request.payloadFilter === undefined ? {} : { payloadFilter: request.payloadFilter }),
        });
        return response.hits;
    }

    async searchHybridTrivium(dbPath: string, request: TriviumSearchHybridRequest): Promise<TriviumSearchHit[]> {
        const response = await this.request<{ hits: TriviumSearchHit[] }>('/v1/trivium/search-hybrid', {
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

    async searchHybridWithContextTrivium(
        dbPath: string,
        request: TriviumSearchHybridWithContextRequest,
    ): Promise<TriviumSearchHybridWithContextResponse> {
        return await this.request<TriviumSearchHybridWithContextResponse>('/v1/trivium/search-hybrid-context', {
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

    async tqlTrivium(dbPath: string, request: TriviumTqlRequest): Promise<TriviumTqlRow[]> {
        const response = await this.tqlTriviumPage(dbPath, request);
        return response.rows;
    }

    async tqlTriviumPage(dbPath: string, request: TriviumTqlRequest): Promise<TriviumTqlResponse> {
        return await this.request<TriviumTqlResponse>('/v1/trivium/tql', {
            ...buildTriviumOpenPayload(dbPath, request),
            query: request.query,
            ...(request.page === undefined ? {} : { page: request.page }),
        });
    }

    async tqlMutTrivium(dbPath: string, request: TriviumTqlMutRequest): Promise<TriviumTqlMutResponse> {
        return await this.request<TriviumTqlMutResponse>('/v1/trivium/tql-mut', {
            ...buildTriviumOpenPayload(dbPath, request),
            query: request.query,
        });
    }

    async createIndexTrivium(dbPath: string, request: TriviumCreateIndexRequest): Promise<void> {
        await this.request('/v1/trivium/create-index', {
            ...buildTriviumOpenPayload(dbPath, request),
            field: request.field,
        });
    }

    async dropIndexTrivium(dbPath: string, request: TriviumDropIndexRequest): Promise<void> {
        await this.request('/v1/trivium/drop-index', {
            ...buildTriviumOpenPayload(dbPath, request),
            field: request.field,
        });
    }

    async indexTextTrivium(dbPath: string, request: TriviumIndexTextRequest): Promise<void> {
        await this.request('/v1/trivium/index-text', {
            ...buildTriviumOpenPayload(dbPath, request),
            id: request.id,
            text: request.text,
        });
    }

    async indexKeywordTrivium(dbPath: string, request: TriviumIndexKeywordRequest): Promise<void> {
        await this.request('/v1/trivium/index-keyword', {
            ...buildTriviumOpenPayload(dbPath, request),
            id: request.id,
            keyword: request.keyword,
        });
    }

    async buildTextIndexTrivium(dbPath: string, request: TriviumBuildTextIndexRequest = {}): Promise<void> {
        await this.request('/v1/trivium/build-text-index', buildTriviumOpenPayload(dbPath, request));
    }

    async compactTrivium(dbPath: string, request: TriviumCompactRequest = {}): Promise<void> {
        await this.request('/v1/trivium/compact', buildTriviumOpenPayload(dbPath, request));
    }

    async flushTrivium(dbPath: string, request: TriviumFlushRequest = {}): Promise<void> {
        await this.request('/v1/trivium/flush', buildTriviumOpenPayload(dbPath, request));
    }

    async statTrivium(dbPath: string, request: TriviumStatRequest = {}): Promise<TriviumStatResponse> {
        return await this.request('/v1/trivium/stat', buildTriviumOpenPayload(dbPath, request));
    }

    async initializeControlSession(
        dbPath: string,
        sessionToken: string,
        timestamp: string,
        user: { handle: string; isAdmin: boolean },
        config: AuthorityInitConfig,
    ): Promise<ControlSessionSnapshot> {
        return await this.request('/v1/control/session/init', {
            dbPath,
            sessionToken,
            timestamp,
            user,
            config,
        });
    }

    async getControlSession(dbPath: string, userHandle: string, sessionToken: string): Promise<ControlSessionSnapshot | null> {
        const response = await this.request<ControlSessionResponse>('/v1/control/session/get', {
            dbPath,
            userHandle,
            sessionToken,
        });
        return response.session;
    }

    async listControlExtensions(dbPath: string, userHandle: string): Promise<ControlExtensionRecord[]> {
        const response = await this.request<ControlExtensionsListResponse>('/v1/control/extensions/list', {
            dbPath,
            userHandle,
        });
        return response.extensions;
    }

    async getControlExtension(dbPath: string, request: ControlExtensionGetRequest): Promise<ControlExtensionRecord | null> {
        const response = await this.request<ControlExtensionResponse>('/v1/control/extensions/get', {
            dbPath,
            ...request,
        });
        return response.extension;
    }

    async logControlAudit(dbPath: string, request: ControlAuditLogRequest): Promise<void> {
        await this.request('/v1/control/audit/log', {
            dbPath,
            ...request,
        });
    }

    async getRecentControlAudit(dbPath: string, request: ControlAuditRecentRequest): Promise<ControlAuditRecentResponse> {
        return await this.request('/v1/control/audit/recent', {
            dbPath,
            ...request,
        });
    }

    async listControlGrants(dbPath: string, request: ControlGrantListRequest): Promise<ControlGrantRecord[]> {
        const response = await this.request<ControlGrantListResponse>('/v1/control/grants/list', {
            dbPath,
            ...request,
        });
        return response.grants;
    }

    async getControlGrant(dbPath: string, request: ControlGrantGetRequest): Promise<ControlGrantRecord | null> {
        const response = await this.request<ControlGrantResponse>('/v1/control/grants/get', {
            dbPath,
            ...request,
        });
        return response.grant;
    }

    async upsertControlGrant(dbPath: string, request: ControlGrantUpsertRequest): Promise<ControlGrantRecord> {
        const response = await this.request<ControlGrantResponse>('/v1/control/grants/upsert', {
            dbPath,
            ...request,
        });
        if (!response.grant) {
            throw new Error('Control grant upsert returned no grant');
        }
        return response.grant;
    }

    async resetControlGrants(dbPath: string, request: ControlGrantResetRequest): Promise<void> {
        await this.request('/v1/control/grants/reset', {
            dbPath,
            ...request,
        });
    }

    async getControlPolicies(dbPath: string, request: ControlPoliciesRequest): Promise<ControlPoliciesResponse> {
        return await this.request('/v1/control/policies/get', {
            dbPath,
            ...request,
        });
    }

    async saveControlPolicies(dbPath: string, request: ControlPoliciesSaveRequest): Promise<ControlPoliciesResponse> {
        return await this.request('/v1/control/policies/save', {
            dbPath,
            ...request,
        });
    }

    async getStorageKv(dbPath: string, request: ControlKvGetRequest): Promise<unknown> {
        const response = await this.request<ControlKvResponse>('/v1/storage/kv/get', {
            dbPath,
            ...request,
        });
        return response.value;
    }

    async setStorageKv(dbPath: string, request: ControlKvSetRequest): Promise<void> {
        await this.request('/v1/storage/kv/set', {
            dbPath,
            ...request,
        });
    }

    async deleteStorageKv(dbPath: string, request: ControlKvDeleteRequest): Promise<void> {
        await this.request('/v1/storage/kv/delete', {
            dbPath,
            ...request,
        });
    }

    async listStorageKv(dbPath: string, request: ControlKvListRequest = {}): Promise<Record<string, unknown>> {
        const response = await this.request<ControlKvListResponse>('/v1/storage/kv/list', {
            dbPath,
            ...request,
        });
        return response.entries;
    }

    async putStorageBlob(dbPath: string, request: ControlBlobPutRequest): Promise<BlobRecord> {
        return await this.request('/v1/storage/blob/put', {
            dbPath,
            ...request,
        });
    }

    async getStorageBlob(dbPath: string, request: ControlBlobGetRequest): Promise<BlobGetResponse> {
        return await this.request('/v1/storage/blob/get', {
            dbPath,
            ...request,
        });
    }

    async openStorageBlobRead(dbPath: string, request: ControlBlobGetRequest): Promise<ControlBlobOpenReadResponse> {
        return await this.request('/v1/storage/blob/open-read', {
            dbPath,
            ...request,
        });
    }

    async deleteStorageBlob(dbPath: string, request: ControlBlobDeleteRequest): Promise<void> {
        await this.request('/v1/storage/blob/delete', {
            dbPath,
            ...request,
        });
    }

    async listStorageBlobs(dbPath: string, request: ControlBlobListRequest): Promise<BlobRecord[]> {
        const response = await this.request<ControlBlobListResponse>('/v1/storage/blob/list', {
            dbPath,
            ...request,
        });
        return response.entries;
    }

    async mkdirPrivateFile(request: ControlPrivateFileMkdirRequest): Promise<PrivateFileEntry> {
        const response = await this.request<PrivateFileResponse>('/v1/fs/private/mkdir', request);
        return response.entry;
    }

    async readPrivateDir(request: ControlPrivateFileReadDirRequest): Promise<PrivateFileEntry[]> {
        const response = await this.request<PrivateFileListResponse>('/v1/fs/private/read-dir', request);
        return response.entries;
    }

    async writePrivateFile(request: ControlPrivateFileWriteRequest): Promise<PrivateFileEntry> {
        const response = await this.request<PrivateFileResponse>('/v1/fs/private/write-file', request);
        return response.entry;
    }

    async readPrivateFile(request: ControlPrivateFileReadRequest): Promise<PrivateFileReadResponse> {
        return await this.request<PrivateFileReadResponse>('/v1/fs/private/read-file', request);
    }

    async openPrivateFileRead(request: ControlPrivateFileReadRequest): Promise<ControlPrivateFileOpenReadResponse> {
        return await this.request<ControlPrivateFileOpenReadResponse>('/v1/fs/private/open-read', request);
    }

    async deletePrivateFile(request: ControlPrivateFileDeleteRequest): Promise<void> {
        const response = await this.request<PrivateFileDeleteResponse>('/v1/fs/private/delete', request);
        if (!response.ok) {
            throw new Error('Private file delete returned unsuccessful response');
        }
    }

    async statPrivateFile(request: ControlPrivateFileStatRequest): Promise<PrivateFileEntry> {
        const response = await this.request<PrivateFileResponse>('/v1/fs/private/stat', request);
        return response.entry;
    }

    async fetchHttp(request: HttpFetchRequest): Promise<HttpFetchResponse> {
        return await this.request('/v1/http/fetch', request);
    }

    async openHttpFetch(request: ControlHttpFetchOpenRequest): Promise<ControlHttpFetchOpenResponse> {
        return await this.request('/v1/http/fetch-open', request);
    }

    async listControlJobs(dbPath: string, request: ControlJobsListRequest): Promise<ControlJobRecord[]> {
        const response = await this.listControlJobsPage(dbPath, request);
        return response.jobs;
    }

    async listControlJobsPage(dbPath: string, request: ControlJobsListRequest): Promise<ControlJobsListResponse> {
        const response = await this.request<ControlJobsListResponse>('/v1/control/jobs/list', {
            dbPath,
            ...request,
        });
        return response;
    }

    async getControlJob(dbPath: string, request: ControlJobGetRequest): Promise<ControlJobRecord | null> {
        const response = await this.request<ControlJobResponse>('/v1/control/jobs/get', {
            dbPath,
            ...request,
        });
        return response.job;
    }

    async createControlJob(dbPath: string, request: ControlJobCreateRequest): Promise<ControlJobRecord> {
        const response = await this.request<ControlJobResponse>('/v1/control/jobs/create', {
            dbPath,
            ...request,
        });
        if (!response.job) {
            throw new Error('Control job create returned no job');
        }
        return response.job;
    }

    async cancelControlJob(dbPath: string, request: ControlJobCancelRequest): Promise<ControlJobRecord> {
        const response = await this.request<ControlJobResponse>('/v1/control/jobs/cancel', {
            dbPath,
            ...request,
        });
        if (!response.job) {
            throw new Error('Control job cancel returned no job');
        }
        return response.job;
    }

    async requeueControlJob(dbPath: string, request: ControlJobRequeueRequest): Promise<ControlJobRecord> {
        const response = await this.request<ControlJobResponse>('/v1/control/jobs/requeue', {
            dbPath,
            ...request,
        });
        if (!response.job) {
            throw new Error('Control job requeue returned no job');
        }
        return response.job;
    }

    async upsertControlJob(dbPath: string, request: ControlJobUpsertRequest): Promise<ControlJobRecord> {
        const response = await this.request<ControlJobResponse>('/v1/control/jobs/upsert', {
            dbPath,
            ...request,
        });
        if (!response.job) {
            throw new Error('Control job upsert returned no job');
        }
        return response.job;
    }

    async pollControlEvents(dbPath: string, request: ControlEventsPollRequest): Promise<{ events: ControlEventRecord[]; cursor: number }> {
        const response = await this.request<ControlEventsPollResponse>('/v1/control/events/poll', {
            dbPath,
            ...request,
        });
        return {
            events: response.events,
            cursor: response.cursor,
        };
    }

    private attachProcessListeners(child: ChildProcess): void {
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
            const state: CoreRuntimeState = this.stopping ? 'stopped' : 'error';
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

    private async waitUntilReady(): Promise<AuthorityCoreStatus> {
        const startedAt = Date.now();
        while (Date.now() - startedAt < HEALTH_TIMEOUT_MS) {
            if (this.status.state !== 'starting') {
                return this.getStatus();
            }
            await delay(HEALTH_POLL_INTERVAL_MS);
        }
        return this.getStatus();
    }

    private async waitForHealth(port: number, token: string): Promise<AuthorityCoreHealthSnapshot> {
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
            } catch {
                await delay(HEALTH_POLL_INTERVAL_MS);
            }
        }
        throw new Error(`authority-core did not become healthy within ${HEALTH_TIMEOUT_MS}ms`);
    }

    private resolveArtifact(roots = this.resolveManagedCoreRoots()): CoreArtifact | null {
        for (const root of roots) {
            const artifact = readArtifact(root, this.env);
            if (artifact) {
                return artifact;
            }
        }
        return null;
    }

    private resolveManagedCoreRoots(): string[] {
        const explicitRoot = this.env.AUTHORITY_CORE_ROOT?.trim();
        const candidates = new Set<string>();
        if (explicitRoot) {
            candidates.add(path.resolve(explicitRoot));
        }

        for (const origin of [this.runtimeDir, this.cwd]) {
            let current = path.resolve(origin);
            while (true) {
                candidates.add(path.join(current, AUTHORITY_MANAGED_CORE_DIR));
                const parent = path.dirname(current);
                if (parent === current) {
                    break;
                }
                current = parent;
            }
        }

        return [...candidates];
    }

    private setStatus(state: CoreRuntimeState, patch: Partial<AuthorityCoreStatus>): void {
        this.status = {
            ...this.status,
            ...patch,
            state,
        };
    }

    private async request<T>(requestPath: string, body: unknown): Promise<T> {
        let status = this.getStatus();
        if (status.state !== 'running' || !this.token || !status.port) {
            status = await this.start();
        }

        if (status.state !== 'running' || !this.token || !status.port) {
            throw new AuthorityServiceError(
                status.lastError ?? 'Authority core is not available',
                503,
                'core_unavailable',
                'core',
                {
                    state: status.state,
                    lastError: status.lastError,
                },
            );
        }

        let response: Response;
        try {
            response = await fetch(`http://127.0.0.1:${status.port}${requestPath}`, {
                method: 'POST',
                headers: {
                    'content-type': 'application/json',
                    'x-authority-core-token': this.token,
                },
                body: JSON.stringify(body),
            });
        } catch (error) {
            throw new AuthorityServiceError(
                asErrorMessage(error),
                503,
                'core_unavailable',
                'core',
                {
                    requestPath,
                    state: status.state,
                },
            );
        }
        const payload = await readCorePayload(response);

        if (!response.ok) {
            throw buildCoreRequestError(requestPath, payload, response.status);
        }

        return payload as T;
    }
}

function readArtifact(root: string, env: NodeJS.ProcessEnv): CoreArtifact | null {
    const platformId = getCurrentCorePlatform(env);
    const expectedLibc = getCorePlatformLibc(platformId);
    const platformDir = path.join(root, platformId);
    const metadataPath = path.join(platformDir, 'authority-core.json');
    if (!fs.existsSync(metadataPath)) {
        return null;
    }

    let metadata: AuthorityCoreManagedMetadata;
    try {
        metadata = JSON.parse(fs.readFileSync(metadataPath, 'utf8')) as AuthorityCoreManagedMetadata;
    } catch {
        return null;
    }

    if (metadata.managedBy !== 'authority' || metadata.platform !== process.platform || metadata.arch !== process.arch || (metadata.libc ?? null) !== expectedLibc) {
        return null;
    }

    const binaryPath = path.join(platformDir, metadata.binaryName);
    if (!fs.existsSync(binaryPath)) {
        return null;
    }
    if (process.platform !== 'win32') {
        ensureExecutable(binaryPath);
    }

    const binarySha256 = crypto.createHash('sha256').update(fs.readFileSync(binaryPath)).digest('hex');
    if (metadata.binarySha256 !== binarySha256) {
        return null;
    }

    return {
        binaryPath,
        metadata,
    };
}

function ensureExecutable(filePath: string): void {
    try {
        const stat = fs.statSync(filePath);
        if ((stat.mode & 0o111) === 0) {
            fs.chmodSync(filePath, stat.mode | 0o755);
        }
    } catch {
    }
}

function describeMissingManagedCore(roots: string[], env: NodeJS.ProcessEnv): string {
    const expectedPlatform = getCurrentCorePlatform(env);
    const discoveredPlatforms = Array.from(new Set(
        roots.flatMap(root => listManagedCorePlatforms(root)),
    )).sort();
    const platformHint = discoveredPlatforms.length > 0
        ? `Found managed platforms: ${discoveredPlatforms.join(', ')}.`
        : 'No managed core platform directories were found.';
    const libcHint = expectedPlatform.endsWith('-musl')
        ? ' Detected Linux musl runtime; glibc Linux binaries are not compatible.'
        : '';
    return `Authority core binary for ${expectedPlatform} was not found under ${AUTHORITY_MANAGED_CORE_DIR}. ${platformHint}${libcHint} Install the multi-platform package, or run npm run build:core in a full source checkout for this platform.`;
}

function getCurrentCorePlatform(env: NodeJS.ProcessEnv): string {
    const basePlatform = `${process.platform}-${process.arch}`;
    return getCurrentLinuxLibc(env) === 'musl'
        ? `${basePlatform}-musl`
        : basePlatform;
}

function getCurrentLinuxLibc(env: NodeJS.ProcessEnv): 'musl' | 'gnu' | null {
    if (process.platform !== 'linux') {
        return null;
    }

    const override = env.AUTHORITY_CORE_LIBC?.trim().toLowerCase();
    if (override === 'musl') {
        return 'musl';
    }
    if (override === 'gnu' || override === 'glibc') {
        return 'gnu';
    }

    const report = process.report?.getReport?.() as { header?: { glibcVersionRuntime?: string; glibcVersionCompiler?: string } } | undefined;
    const header = report?.header;
    return header?.glibcVersionRuntime || header?.glibcVersionCompiler ? 'gnu' : 'musl';
}

function getCorePlatformLibc(platformId: string): string | null {
    return platformId.endsWith('-musl') ? 'musl' : null;
}

function listManagedCorePlatforms(root: string): string[] {
    if (!fs.existsSync(root)) {
        return [];
    }

    try {
        return fs.readdirSync(root, { withFileTypes: true })
            .filter(entry => entry.isDirectory())
            .map(entry => entry.name);
    } catch {
        return [];
    }
}

function resolveCoreDataRoot(value: string | undefined, cwd: string): string {
    const configuredRoot = typeof value === 'string' && value.trim()
        ? value
        : 'data';
    return resolveRuntimePath(configuredRoot, cwd);
}

function buildTriviumOpenPayload(dbPath: string, request: {
    dim?: number;
    dtype?: TriviumInsertRequest['dtype'];
    syncMode?: TriviumInsertRequest['syncMode'];
    storageMode?: TriviumInsertRequest['storageMode'];
}): CoreTriviumOpenRequestPayload {
    return {
        dbPath,
        ...(request.dim === undefined ? {} : { dim: request.dim }),
        ...(request.dtype === undefined ? {} : { dtype: request.dtype }),
        ...(request.syncMode === undefined ? {} : { syncMode: request.syncMode }),
        ...(request.storageMode === undefined ? {} : { storageMode: request.storageMode }),
    };
}

async function fetchHealth(port: number, token: string): Promise<AuthorityCoreHealthSnapshot> {
    const response = await fetch(`http://127.0.0.1:${port}/health`, {
        headers: {
            'x-authority-core-token': token,
        },
    });

    if (!response.ok) {
        throw new Error(`authority-core health check failed with ${response.status}`);
    }

    return await response.json() as AuthorityCoreHealthSnapshot;
}

async function getAvailablePort(): Promise<number> {
    return await new Promise((resolve, reject) => {
        const server = net.createServer();
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

function onceChildExit(child: ChildProcess): Promise<void> {
    return new Promise(resolve => {
        child.once('exit', () => resolve());
    });
}

async function readCorePayload(response: Response): Promise<unknown> {
    const contentType = response.headers.get('content-type') ?? '';
    if (contentType.includes('application/json')) {
        return await response.json();
    }

    const text = await response.text();
    return text || undefined;
}

function extractCoreErrorMessage(payload: unknown, statusCode: number): string {
    if (payload && typeof payload === 'object' && 'error' in payload) {
        return String((payload as { error: unknown }).error);
    }

    if (typeof payload === 'string' && payload.trim()) {
        return payload.trim();
    }

    return `authority-core request failed with ${statusCode}`;
}

function buildCoreRequestError(requestPath: string, payload: unknown, statusCode: number): AuthorityServiceError {
    const message = extractCoreErrorMessage(payload, statusCode);
    const coreCode = extractCoreErrorCode(payload, message);
    const backpressure = mapCoreBackpressureError(coreCode, statusCode);
    if (backpressure) {
        return new AuthorityServiceError(message, backpressure.status, backpressure.code, backpressure.category, {
            requestPath,
            source: 'core',
            statusCode,
        });
    }

    if (statusCode === 408 || statusCode === 504 || /timed?\s*out|timeout/i.test(message)) {
        return new AuthorityServiceError(message, statusCode, 'timeout', 'timeout', {
            requestPath,
            source: 'core',
            statusCode,
        });
    }

    if (statusCode === 413 || statusCode === 429 || /exceeds|too large|max/i.test(message)) {
        return new AuthorityServiceError(message, statusCode, 'limit_exceeded', 'limit', {
            requestPath,
            source: 'core',
            statusCode,
        });
    }

    if (statusCode >= 400 && statusCode < 500) {
        return new AuthorityServiceError(message, statusCode, 'validation_error', 'validation', {
            requestPath,
            source: 'core',
            statusCode,
        });
    }

    return new AuthorityServiceError(message, statusCode >= 500 ? statusCode : 500, 'core_request_failed', 'core', {
        requestPath,
        source: 'core',
        statusCode,
    });
}

function extractCoreErrorCode(payload: unknown, message: string): string | null {
    if (payload && typeof payload === 'object') {
        for (const key of ['code', 'errorCode', 'kind']) {
            if (key in payload) {
                const value = (payload as Record<string, unknown>)[key];
                if (typeof value === 'string' && value.trim()) {
                    return value.trim();
                }
            }
        }
    }

    if (/\bjob_queue_full\b|\bqueue_full\b/i.test(message)) {
        return 'job_queue_full';
    }
    if (/\bconcurrency_limit_exceeded\b/i.test(message)) {
        return 'concurrency_limit_exceeded';
    }

    return null;
}

function mapCoreBackpressureError(code: string | null, statusCode: number): { status: number; code: AuthorityErrorCode; category: AuthorityErrorCategory } | null {
    if (statusCode !== 503) {
        return null;
    }

    if (code === 'job_queue_full' || code === 'queue_full') {
        return { status: 503, code: 'job_queue_full', category: 'backpressure' };
    }

    if (code === 'concurrency_limit_exceeded') {
        return { status: 503, code: 'concurrency_limit_exceeded', category: 'backpressure' };
    }

    return null;
}

function delay(durationMs: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, durationMs));
}

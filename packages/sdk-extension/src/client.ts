import type {
    AgentApprovalResolveRequest,
    AgentBrowserToolClaimRequest,
    AgentBrowserToolRegistrationRequest,
    AgentBrowserToolRegistrationResponse,
    AgentLlmProfile,
    AgentLlmProfileInput,
    AgentLlmProfileTestRequest,
    AgentLlmProfileTestResponse,
    AgentSessionBrowserToolClaimResponse,
    AgentSessionCreateRequest,
    AgentSessionEvent,
    AgentSessionListRequest,
    AgentSessionListResponse,
    AgentSessionRunStatus,
    AgentSessionSendRequest,
    AgentSessionSendResponse,
    AgentSessionSnapshot,
    AgentSessionSummary,
    AgentSessionToolInvocation,
    AgentSessionUpdateRequest,
    AgentToolDescriptor,
    AgentBrowserToolResultRequest,
    AgentWorkspaceListResponse,
    AgentWorkspaceRecord,
    AgentWorkspaceRegisterRequest,
    AuthorityGrant,
    AuthorityInitConfig,
    AuthorityPolicyEntry,
    AuthorityProbeResponse,
    BlobGetResponse,
    BlobOpenReadResponse,
    BlobPutRequest,
    BlobRecord,
    BlobTransferCommitRequest,
    DataTransferAppendResponse,
    DataTransferInitRequest,
    DataTransferInitResponse,
    DataTransferManifestResponse,
    DataTransferReadResponse,
    DataTransferResource,
    DataTransferStatusResponse,
    DeclaredPermissions,
    HttpBodyEncoding,
    HttpFetchOpenResponse,
    HttpFetchResponse,
    JobRecord,
    JobListRequest,
    JobListResponse,
    AuthorityModuleManifest,
    ModuleGetResponse,
    ModuleListResponse,
    ModuleTransactionManifest,
    ModuleTransactionRequest,
    ModuleTransactionResponse,
    PermissionEvaluateBatchResponse,
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
    SqlStatRequest,
    SqlStatResponse,
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
    TriviumCreateIndexRequest,
    TriviumDeleteRequest,
    TriviumDeleteOrphanMappingsRequest,
    TriviumDeleteOrphanMappingsResponse,
    TriviumDropIndexRequest,
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
    TriviumResolveIdRequest,
    TriviumResolveIdResponse,
    TriviumResolveManyRequest,
    TriviumResolveManyResponse,
    TriviumSearchAdvancedRequest,
    TriviumSearchHit,
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
    TriviumUpsertRequest,
    TriviumUpsertResponse,
    TriviumUpdatePayloadRequest,
    TriviumUpdateVectorRequest,
    WorkspaceCheckpointRequest,
    WorkspaceCheckpointResponse,
    WorkspaceCommitListResponse,
    WorkspaceDiffResponse,
    WorkspaceFileDiffResponse,
    WorkspaceRollbackRequest,
    WorkspaceRollbackResponse,
    WorkspaceStatusResponse,
} from '@stdo/shared-types';
import {
    authorityRequest,
    buildAgentSessionStreamUrl,
    buildEventStreamUrl,
    hostnameFromUrl,
    isInvalidSessionError,
} from './api.js';
import { showPermissionPrompt, type PermissionPromptContext } from './permission-prompt.js';
import { openSecurityCenter } from './security-center.js';
import { splitAuthorityItemsIntoChunks } from './client/chunking.js';
import type { AuthorityChunkSplitOptions } from './client/chunking.js';
import { base64ToBytes, bytesToContent, bytesToHttpContent, bytesToBase64, contentToBytes } from './client/encoding.js';
import { getFeatureAvailability, type AuthorityFeaturePath } from './client/feature-flags.js';
import {
    getAuthorityPermissionErrorCode,
    getPermissionEvaluationMessage,
    getPermissionFailureMessage,
    type AuthorityPermissionErrorCode,
    type AuthorityPermissionErrorDecision,
} from './client/permission-messages.js';
export { splitAuthorityItemsIntoChunks } from './client/chunking.js';
export type { AuthorityChunk, AuthorityChunkSplitOptions } from './client/chunking.js';
export type { AuthorityFeaturePath } from './client/feature-flags.js';
export type { AuthorityPermissionErrorCode, AuthorityPermissionErrorDecision } from './client/permission-messages.js';

export interface AuthorityPermissionRequest extends PermissionEvaluateRequest {
    promptTitle?: string;
}

export interface AuthorityPermissionErrorDetails {
    code: AuthorityPermissionErrorCode;
    decision: AuthorityPermissionErrorDecision;
    key: string;
    riskLevel: PermissionEvaluateResponse['riskLevel'];
    target: string;
    resource: PermissionResource;
}

export interface AuthorityPermissionExplainResult {
    evaluation: PermissionEvaluateResponse;
    message: string;
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

function isTerminalAgentSessionRunStatus(status: AgentSessionRunStatus): boolean {
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

function getWaitPollInterval(value: unknown, subject: 'job' | 'agent run'): number {
    if (value == null) {
        return 1000;
    }
    if (typeof value === 'number' && Number.isSafeInteger(value) && value > 0) {
        return value;
    }
    throw new Error(`Authority ${subject} pollIntervalMs must be a positive safe integer`);
}

function getOptionalWaitTimeout(value: unknown, subject: 'job' | 'agent run'): number | null {
    if (value == null) {
        return null;
    }
    if (typeof value === 'number' && Number.isSafeInteger(value) && value > 0) {
        return value;
    }
    throw new Error(`Authority ${subject} timeoutMs must be a positive safe integer`);
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

function throwIfAborted(signal: AbortSignal | undefined, subject: 'job' | 'agent run'): void {
    if (signal?.aborted) {
        throw new Error(`Authority ${subject} wait aborted`);
    }
}

function waitForDelay(ms: number, signal: AbortSignal | undefined, subject: 'job' | 'agent run'): Promise<void> {
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

function waitForSignal<T>(promise: Promise<T>, signal: AbortSignal | undefined): Promise<T> {
    if (!signal) {
        return promise;
    }
    if (signal.aborted) {
        return Promise.reject(signal.reason ?? new Error('Authority request aborted'));
    }
    return new Promise<T>((resolve, reject) => {
        const onAbort = () => reject(signal.reason ?? new Error('Authority request aborted'));
        signal.addEventListener('abort', onAbort, { once: true });
        promise.then(resolve, reject).finally(() => signal.removeEventListener('abort', onAbort));
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

/**
 * Caller-provided options for invoking a module transaction through
 * {@link AuthorityClient.modules.execute} / {@link AuthorityClient.tx}.
 *
 * `dryRun` and `signal` are intentionally omitted until they are wired end
 * to end; do not silently forward unknown options to the module host.
 */
export interface AuthorityModuleTransactionOptions {
    idempotencyKey?: string;
    timeoutMs?: number;
}

/**
 * SDK-side generic view of {@link ModuleTransactionResponse} so callers can
 * narrow the opaque `result` payload to a typed shape via the generic
 * parameter on {@link AuthorityClient.modules.execute} / {@link AuthorityClient.tx}.
 */
export type AuthorityModuleTransactionResponse<TResult = unknown> = Omit<ModuleTransactionResponse, 'result'> & { result?: TResult };

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

export interface AgentSessionRunWaitOptions {
    pollIntervalMs?: number;
    timeoutMs?: number;
    signal?: AbortSignal;
    onProgress?: (snapshot: AgentSessionSnapshot) => void | Promise<void>;
}

export interface AgentSessionSubscribeOptions {
    /** Every connection and reconnection starts with an authoritative snapshot. */
    onSnapshot: (snapshot: AgentSessionSnapshot) => void | Promise<void>;
    onEvent?: (event: AgentSessionEvent) => void | Promise<void>;
    onError?: () => void;
}

export interface AgentWorkspaceDiffOptions {
    from?: string | null;
    to?: string | null;
}

export interface AgentWorkspaceFileDiffOptions extends AgentWorkspaceDiffOptions {
    path: string;
    to?: string | null | 'working';
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

export interface AuthorityTransferReadResult {
    transferId: string;
    offset: number;
    bytes: Uint8Array;
    sizeBytes: number;
    eof: boolean;
    updatedAt: string;
    checksumSha256?: string;
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
    signal?: AbortSignal;
}

type InlineThresholdKey =
    | 'storageBlobWrite'
    | 'storageBlobRead'
    | 'privateFileWrite'
    | 'privateFileRead'
    | 'httpFetchRequest'
    | 'httpFetchResponse';

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
        stat: (input?: SqlStatRequest) => Promise<SqlStatResponse>;
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
        searchHybridWithContext: (input: TriviumSearchHybridWithContextRequest) => Promise<TriviumSearchHybridWithContextResponse>;
        tql: (input: TriviumTqlRequest) => Promise<TriviumTqlRow[]>;
        tqlPage: (input: TriviumTqlRequest) => Promise<TriviumTqlResponse>;
        tqlMut: (input: TriviumTqlMutRequest) => Promise<TriviumTqlMutResponse>;
        createIndex: (input: TriviumCreateIndexRequest) => Promise<void>;
        dropIndex: (input: TriviumDropIndexRequest) => Promise<void>;
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

    readonly transfers: {
        init: (request: DataTransferInitRequest) => Promise<DataTransferInitResponse>;
        status: (transferId: string) => Promise<DataTransferStatusResponse>;
        manifest: (transferId: string) => Promise<DataTransferManifestResponse>;
        append: (transferId: string, bytes: Uint8Array, options?: { offset?: number }) => Promise<DataTransferAppendResponse>;
        read: (transferId: string, options?: { offset?: number; limit?: number }) => Promise<AuthorityTransferReadResult>;
        discard: (transferId: string) => Promise<void>;
    };

    readonly permissions: {
        evaluate: (request: AuthorityPermissionRequest) => Promise<PermissionEvaluateResponse>;
        evaluateBatch: (requests: AuthorityPermissionRequest[]) => Promise<PermissionEvaluateResponse[]>;
        explain: (request: AuthorityPermissionRequest) => Promise<AuthorityPermissionExplainResult>;
    };

    readonly jobs: {
        create: (type: string, payload?: Record<string, unknown>, options?: JobCreateOptions) => Promise<JobRecord>;
        get: (id: string) => Promise<JobRecord>;
        list: () => Promise<JobRecord[]>;
        listPage: (input?: JobListRequest) => Promise<JobListResponse>;
        cancel: (id: string) => Promise<JobRecord>;
        requeue: (id: string) => Promise<JobRecord>;
        waitForCompletion: (id: string, options?: JobWaitForCompletionOptions) => Promise<JobRecord>;
        subscribe: (id: string, options?: JobSubscribeOptions) => Promise<AuthorityEventsSubscription>;
    };

    readonly events: {
        subscribe: (channelOrOptions?: string | AuthorityEventsSubscribeOptions, handler?: (event: AuthorityEventEnvelope) => void) => Promise<AuthorityEventsSubscription>;
    };

    readonly modules: {
        list: () => Promise<ModuleListResponse>;
        get: (moduleId: string) => Promise<AuthorityModuleManifest>;
        execute: <TResult = unknown>(moduleId: string, transactionName: string, input?: unknown, options?: AuthorityModuleTransactionOptions) => Promise<AuthorityModuleTransactionResponse<TResult>>;
    };

    readonly agent: {
        listTools: () => Promise<AgentToolDescriptor[]>;
        sessions: {
            create: (request: AgentSessionCreateRequest) => Promise<AgentSessionSnapshot>;
            listPage: (request?: AgentSessionListRequest) => Promise<AgentSessionListResponse>;
            get: (sessionId: string) => Promise<AgentSessionSnapshot>;
            update: (sessionId: string, request: AgentSessionUpdateRequest) => Promise<AgentSessionSnapshot>;
            send: (sessionId: string, request: AgentSessionSendRequest) => Promise<AgentSessionSendResponse>;
            cancelRun: (sessionId: string, runId: string) => Promise<AgentSessionSnapshot>;
            resumeRun: (sessionId: string, runId: string) => Promise<AgentSessionSnapshot>;
            continueFailedRun: (sessionId: string, runId: string) => Promise<AgentSessionSendResponse>;
            waitForRun: (sessionId: string, runId: string, options?: AgentSessionRunWaitOptions) => Promise<AgentSessionSnapshot>;
            subscribe: (sessionId: string, options: AgentSessionSubscribeOptions) => Promise<AuthorityEventsSubscription>;
        };
        browser: {
            registerTools: (request: AgentBrowserToolRegistrationRequest) => Promise<AgentBrowserToolRegistrationResponse>;
            claim: (request: AgentBrowserToolClaimRequest) => Promise<AgentSessionBrowserToolClaimResponse>;
            submitResult: (request: AgentBrowserToolResultRequest) => Promise<AgentSessionToolInvocation>;
        };
        admin: {
            profiles: {
                list: () => Promise<AgentLlmProfile[]>;
                get: (profileId: string) => Promise<AgentLlmProfile>;
                upsert: (profile: AgentLlmProfileInput) => Promise<AgentLlmProfile>;
                test: (request: AgentLlmProfileTestRequest) => Promise<AgentLlmProfileTestResponse>;
                delete: (profileId: string) => Promise<boolean>;
            };
            sessions: {
                listPage: (request?: AgentSessionListRequest) => Promise<AgentSessionListResponse>;
                get: (sessionId: string) => Promise<AgentSessionSnapshot>;
                cancelRun: (sessionId: string, runId: string) => Promise<AgentSessionSnapshot>;
                resolveApproval: (sessionId: string, approvalId: string, request: AgentApprovalResolveRequest) => Promise<AgentSessionSnapshot>;
            };
            workspaces: {
                list: () => Promise<AgentWorkspaceRecord[]>;
                default: () => Promise<AgentWorkspaceRecord>;
                register: (request: AgentWorkspaceRegisterRequest) => Promise<AgentWorkspaceRecord>;
                get: (workspaceId: string) => Promise<AgentWorkspaceRecord>;
                status: (workspaceId: string) => Promise<WorkspaceStatusResponse>;
                commits: (workspaceId: string, limit?: number) => Promise<WorkspaceCommitListResponse>;
                diff: (workspaceId: string, options?: AgentWorkspaceDiffOptions) => Promise<WorkspaceDiffResponse>;
                fileDiff: (workspaceId: string, options: AgentWorkspaceFileDiffOptions) => Promise<WorkspaceFileDiffResponse>;
                checkpoint: (workspaceId: string, request: WorkspaceCheckpointRequest) => Promise<WorkspaceCheckpointResponse>;
                rollback: (workspaceId: string, request: WorkspaceRollbackRequest) => Promise<WorkspaceRollbackResponse>;
                resumeRollback: (workspaceId: string) => Promise<WorkspaceRollbackResponse>;
            };
        };
    };

    private session: SessionInitResponse | null = null;
    private sessionPromise: Promise<SessionInitResponse> | null = null;
    private probeSnapshot: AuthorityProbeResponse | null = null;
    private probePromise: Promise<AuthorityProbeResponse> | null = null;
    private readonly runtimeGrants = new Map<string, AuthorityGrant>();
    private readonly moduleManifests = new Map<string, AuthorityModuleManifest>();
    private readonly agentSessionWorkspaces = new Map<string, string>();

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
                    const inlineThreshold = await this.getEffectiveInlineThresholdBytes('storageBlobWrite');
                    if (bytes.byteLength > inlineThreshold) {
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
                const inlineThreshold = await this.getEffectiveInlineThresholdBytes('privateFileWrite');
                if (bytes.byteLength > inlineThreshold) {
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
            stat: async (input = {}) => {
                const database = getSqlDatabaseName(input.database);
                await this.requireFeature('sql.stat', 'Authority 当前版本尚未提供 SQL 运行时诊断能力');
                await this.ensurePermission({
                    resource: 'sql.private',
                    target: database,
                    reason: `查看 SQL 数据库诊断 ${database}`,
                });
                return await this.requestWithSession<SqlStatResponse>('/sql/stat', {
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
            searchHybridWithContext: async input => {
                await this.requireFeature('trivium.searchContext', 'Authority 当前版本尚未提供 Trivium 搜索上下文能力');
                const database = getTriviumDatabaseName(input.database);
                await this.ensurePermission({
                    resource: 'trivium.private',
                    target: database,
                    reason: `执行 Trivium 上下文化混合搜索 ${database}`,
                });
                return await this.requestWithSession<TriviumSearchHybridWithContextResponse>('/trivium/search-hybrid-context', {
                    method: 'POST',
                    body: {
                        ...input,
                        database,
                    },
                });
            },
            tql: async input => {
                const response = await this.trivium.tqlPage(input);
                return response.rows;
            },
            tqlPage: async input => {
                await this.requireFeature('trivium.tql', 'Authority 当前版本尚未提供 Trivium TQL 查询能力');
                const database = getTriviumDatabaseName(input.database);
                await this.ensurePermission({
                    resource: 'trivium.private',
                    target: database,
                    reason: `执行 Trivium TQL 查询 ${database}`,
                });
                return await this.requestWithSession<TriviumTqlResponse>('/trivium/tql', {
                    method: 'POST',
                    body: {
                        ...input,
                        database,
                    },
                });
            },
            tqlMut: async input => {
                await this.requireFeature('trivium.tqlMut', 'Authority 当前版本尚未提供 Trivium TQL 变更能力');
                const database = getTriviumDatabaseName(input.database);
                await this.ensurePermission({
                    resource: 'trivium.private',
                    target: database,
                    reason: `执行 Trivium TQL 变更 ${database}`,
                });
                return await this.requestWithSession<TriviumTqlMutResponse>('/trivium/tql-mut', {
                    method: 'POST',
                    body: {
                        ...input,
                        database,
                    },
                });
            },
            createIndex: async input => {
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
            dropIndex: async input => {
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
                this.warnHeavyTriviumDiagnostics('checkMappingsIntegrity', database);
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
                this.warnHeavyTriviumDiagnostics('deleteOrphanMappings', database);
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
                if (input.includeMappingIntegrity === true) {
                    this.warnHeavyTriviumDiagnostics('stat.includeMappingIntegrity', database);
                }
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

        this.transfers = {
            init: async request => {
                if (request.resource === 'storage.blob' || request.resource === 'fs.private') {
                    await this.ensurePermission({ resource: request.resource, reason: `初始化分块传输 ${request.resource}` });
                }
                if (request.resource === 'http.fetch') {
                    await this.ensurePermission({ resource: 'http.fetch', reason: '初始化 HTTP 分块传输' });
                }
                return await this.requestWithSession<DataTransferInitResponse>('/transfers/init', {
                    method: 'POST',
                    body: request,
                });
            },
            status: async transferId => {
                return await this.getTransferStatus(transferId);
            },
            manifest: async transferId => {
                return await this.requestWithSession<DataTransferManifestResponse>(`/transfers/${encodeURIComponent(transferId)}/manifest`, {
                    method: 'POST',
                });
            },
            append: async (transferId, bytes, options = {}) => {
                const offset = options.offset ?? (await this.getTransferStatus(transferId)).sizeBytes;
                return await this.requestWithSession<DataTransferAppendResponse>(`/transfers/${encodeURIComponent(transferId)}/append`, {
                    method: 'POST',
                    body: {
                        offset,
                        content: bytesToBase64(bytes),
                    },
                });
            },
            read: async (transferId, options = {}) => {
                const chunk = await this.requestWithSession<DataTransferReadResponse>(`/transfers/${encodeURIComponent(transferId)}/read`, {
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
            discard: async transferId => {
                await this.discardTransferQuietly(transferId);
            },
        };

        this.permissions = {
            evaluate: async request => await this.evaluatePermission(request),
            evaluateBatch: async requests => await this.evaluatePermissions(requests),
            explain: async request => await this.explainPermission(request),
        };

        this.jobs = {
            create: async (type, payload = {}, options = {}) => {
                await this.requireFeature('jobs.background', 'Authority 当前版本尚未提供后台任务能力');
                await this.ensurePermission({ resource: 'jobs.background', target: type, reason: `创建后台任务 ${type}` });
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
            requeue: async id => {
                await this.requireFeature('jobs.safeRequeue', 'Authority 当前版本尚未提供后台任务安全重排能力');
                const job = await this.jobs.get(id);
                await this.ensurePermission({
                    resource: 'jobs.background',
                    target: job.type,
                    reason: `安全重新排队后台任务 ${job.type}`,
                });
                return await this.requestWithSession<JobRecord>(`/jobs/${encodeURIComponent(id)}/requeue`, {
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

                const channel = options.channel ?? `extension:${this.config.extensionId}`;
                const eventNames = options.eventNames ?? ['authority.connected', 'authority.job'];

                await this.ensurePermission({
                    resource: 'events.stream',
                    target: channel,
                    reason: `订阅事件流 ${channel}`,
                });

                const notify = (name: string, data: unknown) => {
                    options.onEvent?.({ name, data });
                };
                let closed = false;
                let source: EventSource | null = null;
                let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
                let connectController: AbortController | null = null;
                let openSource!: () => Promise<void>;
                const scheduleReconnect = () => {
                    if (closed || reconnectTimer !== null) return;
                    reconnectTimer = setTimeout(() => {
                        reconnectTimer = null;
                        void openSource().catch(error => {
                            if (closed) return;
                            console.warn('Authority event stream reconnect failed', error);
                            scheduleReconnect();
                        });
                    }, 1_000);
                };
                openSource = async () => {
                    const controller = new AbortController();
                    connectController = controller;
                    let ticket: string;
                    try {
                        const response = await this.requestWithSession<{ ticket: string }>('/events/ticket', {
                            method: 'POST',
                            body: { channel },
                            signal: controller.signal,
                        });
                        ticket = oneTimeTicket(response.ticket);
                    } finally {
                        if (connectController === controller) connectController = null;
                    }
                    if (closed) return;
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
                        if (closed || source !== nextSource) return;
                        nextSource.close();
                        source = null;
                        console.warn('Authority event stream disconnected for', this.config.extensionId, channel);
                        scheduleReconnect();
                    };
                };

                await openSource();
                return {
                    close: () => {
                        if (closed) return;
                        closed = true;
                        connectController?.abort();
                        connectController = null;
                        if (reconnectTimer !== null) clearTimeout(reconnectTimer);
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
                const response = await this.requestWithSession<ModuleListResponse>('/modules');
                for (const manifest of response.modules) {
                    this.moduleManifests.set(manifest.id, structuredClone(manifest));
                }
                return response;
            },
            get: async moduleId => {
                const trimmedModuleId = trimModuleIdentifier(moduleId);
                await this.requireFeature('modules.enabled', 'Authority 当前版本尚未提供模块事务能力');
                const cached = this.moduleManifests.get(trimmedModuleId);
                if (cached) {
                    return structuredClone(cached);
                }
                const response = await this.requestWithSession<ModuleGetResponse>(`/modules/${encodeURIComponent(trimmedModuleId)}`);
                this.moduleManifests.set(trimmedModuleId, structuredClone(response.module));
                return response.module;
            },
            execute: async <TResult = unknown>(
                moduleId: string,
                transactionName: string,
                input?: unknown,
                options?: AuthorityModuleTransactionOptions,
            ): Promise<AuthorityModuleTransactionResponse<TResult>> => {
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

                const body: ModuleTransactionRequest = {
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

                return await this.requestWithSession<AuthorityModuleTransactionResponse<TResult>>(
                    `/modules/${encodeURIComponent(trimmedModuleId)}/transactions/${encodeURIComponent(trimmedTransactionName)}`,
                    {
                        method: 'POST',
                        body,
                    },
                );
            },
        };

        this.agent = {
            listTools: async () => {
                const response = await this.requestWithSession<{ tools: AgentToolDescriptor[] }>('/agent/tools');
                return response.tools;
            },
            sessions: {
                create: async request => {
                    const workspaceId = request.workspaceId?.trim();
                    if (!workspaceId) throw new Error('Agent workspaceId is required');
                    await this.ensurePermission({
                        resource: 'agent.run',
                        target: workspaceId,
                        reason: `在工作区 ${workspaceId} 创建 Agent 会话`,
                    });
                    const snapshot = await this.requestWithSession<AgentSessionSnapshot>('/agent/sessions', {
                        method: 'POST',
                        body: { ...request, workspaceId },
                    });
                    this.rememberAgentSession(snapshot);
                    return snapshot;
                },
                listPage: async (request = {}) => {
                    const response = await this.requestWithSession<AgentSessionListResponse>('/agent/sessions/list', {
                        method: 'POST',
                        body: request,
                    });
                    this.rememberAgentSessionSummaries(response.sessions);
                    return response;
                },
                get: async sessionId => {
                    const snapshot = await this.requestWithSession<AgentSessionSnapshot>(
                        `/agent/sessions/${agentPathId(sessionId, 'sessionId')}`,
                    );
                    this.rememberAgentSession(snapshot);
                    return snapshot;
                },
                update: async (sessionId, request) => {
                    const snapshot = await this.requestWithSession<AgentSessionSnapshot>(
                        `/agent/sessions/${agentPathId(sessionId, 'sessionId')}/update`,
                        { method: 'POST', body: request },
                    );
                    this.rememberAgentSession(snapshot);
                    return snapshot;
                },
                send: async (sessionId, request) => {
                    await this.ensureAgentSessionRunPermission(sessionId, '继续 Agent 会话');
                    const response = await this.requestWithSession<AgentSessionSendResponse>(
                        `/agent/sessions/${agentPathId(sessionId, 'sessionId')}/messages`,
                        { method: 'POST', body: request },
                    );
                    this.rememberAgentSession(response.snapshot);
                    return response;
                },
                cancelRun: async (sessionId, runId) => {
                    const snapshot = await this.requestWithSession<AgentSessionSnapshot>(
                        `/agent/sessions/${agentPathId(sessionId, 'sessionId')}/runs/${agentPathId(runId, 'runId')}/cancel`,
                        { method: 'POST' },
                    );
                    this.rememberAgentSession(snapshot);
                    return snapshot;
                },
                resumeRun: async (sessionId, runId) => {
                    await this.ensureAgentSessionRunPermission(sessionId, '恢复 Agent 运行');
                    const snapshot = await this.requestWithSession<AgentSessionSnapshot>(
                        `/agent/sessions/${agentPathId(sessionId, 'sessionId')}/runs/${agentPathId(runId, 'runId')}/resume`,
                        { method: 'POST' },
                    );
                    this.rememberAgentSession(snapshot);
                    return snapshot;
                },
                continueFailedRun: async (sessionId, runId) => {
                    await this.ensureAgentSessionRunPermission(sessionId, '继续失败的 Agent 运行');
                    const response = await this.requestWithSession<AgentSessionSendResponse>(
                        `/agent/sessions/${agentPathId(sessionId, 'sessionId')}/runs/${agentPathId(runId, 'runId')}/continue`,
                        { method: 'POST' },
                    );
                    this.rememberAgentSession(response.snapshot);
                    return response;
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
                        let snapshot: AgentSessionSnapshot;
                        try {
                            snapshot = await this.requestWithSession<AgentSessionSnapshot>(
                                `/agent/sessions/${agentPathId(sessionId, 'sessionId')}`,
                                signal ? { signal } : {},
                            );
                        } catch (error) {
                            if (options.signal?.aborted) throw new Error('Authority agent run wait aborted');
                            if (timeoutSignal?.aborted && !options.signal?.aborted) {
                                throw new Error(`Authority agent run ${runId} did not complete within ${timeoutMs}ms`);
                            }
                            throw error;
                        }
                        this.rememberAgentSession(snapshot);
                        await options.onProgress?.(snapshot);
                        const run = snapshot.runs.find(item => item.id === runId);
                        if (!run) throw new Error(`Authority agent run not found: ${runId}`);
                        if (isTerminalAgentSessionRunStatus(run.status) || run.status === 'suspended') return snapshot;
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
                    let source: EventSource | null = null;
                    let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
                    let connectController: AbortController | null = null;
                    let openSource!: () => Promise<void>;

                    const notifyError = () => {
                        try {
                            options.onError?.();
                        } catch (error) {
                            console.warn('Authority Agent session error handler failed', error);
                        }
                    };
                    const scheduleReconnect = () => {
                        if (closed || reconnectTimer !== null) return;
                        reconnectTimer = setTimeout(() => {
                            reconnectTimer = null;
                            void openSource().catch(error => {
                                if (closed) return;
                                console.warn('Authority Agent session reconnect failed', error);
                                notifyError();
                                scheduleReconnect();
                            });
                        }, 1_000);
                    };
                    openSource = async () => {
                        const controller = new AbortController();
                        connectController = controller;
                        let ticket: string;
                        try {
                            const response = await this.requestWithSession<{ ticket: string }>(
                                `/agent/sessions/${agentPathId(id, 'sessionId')}/events-ticket`,
                                { method: 'POST', signal: controller.signal },
                            );
                            ticket = agentValueId(response.ticket, 'stream ticket');
                        } finally {
                            if (connectController === controller) connectController = null;
                        }
                        if (closed) return;
                        const nextSource = new EventSource(buildAgentSessionStreamUrl(ticket, id), {
                            withCredentials: true,
                        });
                        source = nextSource;
                        nextSource.addEventListener('authority.agent.session.snapshot', event => {
                            const snapshot = event instanceof MessageEvent ? safeParse(event.data) : undefined;
                            if (!isAgentSessionSnapshot(snapshot)) return;
                            this.rememberAgentSession(snapshot);
                            void Promise.resolve(options.onSnapshot(snapshot)).catch(error => {
                                console.warn('Authority Agent session snapshot handler failed', error);
                            });
                        });
                        nextSource.addEventListener('authority.agent.session.event', event => {
                            const update = event instanceof MessageEvent ? safeParse(event.data) : undefined;
                            if (!isAgentSessionEvent(update)) return;
                            void Promise.resolve(options.onEvent?.(update)).catch(error => {
                                console.warn('Authority Agent session event handler failed', error);
                            });
                        });
                        nextSource.onerror = () => {
                            if (closed || source !== nextSource) return;
                            nextSource.close();
                            source = null;
                            notifyError();
                            scheduleReconnect();
                        };
                    };

                    await openSource();
                    return {
                        close: () => {
                            if (closed) return;
                            closed = true;
                            connectController?.abort();
                            connectController = null;
                            if (reconnectTimer !== null) clearTimeout(reconnectTimer);
                            reconnectTimer = null;
                            source?.close();
                            source = null;
                        },
                    };
                },
            },
            browser: {
                registerTools: async request => {
                    const browserInstanceId = request.browserInstanceId?.trim();
                    if (!browserInstanceId) {
                        throw new Error('Browser instance id is required');
                    }
                    await this.ensurePermission({
                        resource: 'agent.browser',
                        target: browserInstanceId,
                        reason: '向 Agent 注册浏览器工具',
                    });
                    return await this.requestWithSession<AgentBrowserToolRegistrationResponse>('/agent/browser-tools/register', {
                        method: 'POST',
                        body: { ...request, browserInstanceId },
                    });
                },
                claim: async request => {
                    const browserInstanceId = agentValueId(request.browserInstanceId, 'browserInstanceId');
                    await this.ensurePermission({
                        resource: 'agent.browser',
                        target: browserInstanceId,
                        reason: '领取 Agent 浏览器工具任务',
                    });
                    return await this.requestWithSession<AgentSessionBrowserToolClaimResponse>('/agent/browser-tools/claim', {
                        method: 'POST',
                        body: { ...request, browserInstanceId },
                    });
                },
                submitResult: async request => {
                    const browserInstanceId = agentValueId(request.browserInstanceId, 'browserInstanceId');
                    await this.ensurePermission({
                        resource: 'agent.browser',
                        target: browserInstanceId,
                        reason: '提交 Agent 浏览器工具结果',
                    });
                    return await this.requestWithSession<AgentSessionToolInvocation>('/agent/browser-tools/result', {
                        method: 'POST',
                        body: { ...request, browserInstanceId },
                    });
                },
            },
            admin: {
                profiles: {
                    list: async () => {
                        const response = await this.requestWithSession<{ profiles: AgentLlmProfile[] }>('/admin/agent/profiles');
                        return response.profiles;
                    },
                    get: async profileId => {
                        return await this.requestWithSession<AgentLlmProfile>(`/admin/agent/profiles/${agentPathId(profileId, 'profileId')}`);
                    },
                    upsert: async profile => {
                        return await this.requestWithSession<AgentLlmProfile>('/admin/agent/profiles', {
                            method: 'POST',
                            body: profile,
                        });
                    },
                    test: async request => {
                        return await this.requestWithSession<AgentLlmProfileTestResponse>('/admin/agent/profiles/test', {
                            method: 'POST',
                            body: request,
                        });
                    },
                    delete: async profileId => {
                        const response = await this.requestWithSession<{ deleted: boolean }>(
                            `/admin/agent/profiles/${agentPathId(profileId, 'profileId')}/delete`,
                            { method: 'POST' },
                        );
                        return response.deleted;
                    },
                },
                sessions: {
                    listPage: async (request = {}) => {
                        const response = await this.requestWithSession<AgentSessionListResponse>('/admin/agent/sessions/list', {
                            method: 'POST',
                            body: request,
                        });
                        this.rememberAgentSessionSummaries(response.sessions);
                        return response;
                    },
                    get: async sessionId => {
                        const snapshot = await this.requestWithSession<AgentSessionSnapshot>(
                            `/admin/agent/sessions/${agentPathId(sessionId, 'sessionId')}`,
                        );
                        this.rememberAgentSession(snapshot);
                        return snapshot;
                    },
                    cancelRun: async (sessionId, runId) => {
                        const snapshot = await this.requestWithSession<AgentSessionSnapshot>(
                            `/admin/agent/sessions/${agentPathId(sessionId, 'sessionId')}/runs/${agentPathId(runId, 'runId')}/cancel`,
                            {
                                method: 'POST',
                            },
                        );
                        this.rememberAgentSession(snapshot);
                        return snapshot;
                    },
                    resolveApproval: async (sessionId, approvalId, request) => {
                        const snapshot = await this.requestWithSession<AgentSessionSnapshot>(
                            `/admin/agent/sessions/${agentPathId(sessionId, 'sessionId')}/approvals/${agentPathId(approvalId, 'approvalId')}/resolve`,
                            { method: 'POST', body: request },
                        );
                        this.rememberAgentSession(snapshot);
                        return snapshot;
                    },
                },
                workspaces: {
                    list: async () => {
                        const response = await this.requestWithSession<AgentWorkspaceListResponse>('/admin/agent/workspaces');
                        return response.workspaces;
                    },
                    default: async () => {
                        return await this.requestWithSession<AgentWorkspaceRecord>('/admin/agent/workspaces/default');
                    },
                    register: async request => {
                        return await this.requestWithSession<AgentWorkspaceRecord>('/admin/agent/workspaces', {
                            method: 'POST',
                            body: request,
                        });
                    },
                    get: async workspaceId => {
                        return await this.requestWithSession<AgentWorkspaceRecord>(`/admin/agent/workspaces/${agentPathId(workspaceId, 'workspaceId')}`);
                    },
                    status: async workspaceId => {
                        return await this.requestWithSession<WorkspaceStatusResponse>(`/admin/agent/workspaces/${agentPathId(workspaceId, 'workspaceId')}/status`);
                    },
                    commits: async (workspaceId, limit = 100) => {
                        if (!Number.isSafeInteger(limit) || limit < 1 || limit > 500) {
                            throw new Error('Authority agent workspace commit limit must be an integer between 1 and 500');
                        }
                        return await this.requestWithSession<WorkspaceCommitListResponse>(
                            `/admin/agent/workspaces/${agentPathId(workspaceId, 'workspaceId')}/commits?limit=${limit}`,
                        );
                    },
                    diff: async (workspaceId, options = {}) => {
                        const query = new URLSearchParams();
                        if (options.from !== undefined) query.set('from', options.from === null ? 'empty' : options.from);
                        if (options.to !== undefined) query.set('to', options.to === null ? 'empty' : options.to);
                        const suffix = query.size > 0 ? `?${query.toString()}` : '';
                        return await this.requestWithSession<WorkspaceDiffResponse>(
                            `/admin/agent/workspaces/${agentPathId(workspaceId, 'workspaceId')}/diff${suffix}`,
                        );
                    },
                    fileDiff: async (workspaceId, options) => {
                        const query = new URLSearchParams({
                            path: agentWorkspacePath(options.path),
                        });
                        if (options.from !== undefined) query.set('from', options.from === null ? 'empty' : options.from);
                        if (options.to !== undefined) query.set('to', options.to === null ? 'empty' : options.to);
                        return await this.requestWithSession<WorkspaceFileDiffResponse>(
                            `/admin/agent/workspaces/${agentPathId(workspaceId, 'workspaceId')}/diff/file?${query.toString()}`,
                        );
                    },
                    checkpoint: async (workspaceId, request) => {
                        return await this.requestWithSession<WorkspaceCheckpointResponse>(
                            `/admin/agent/workspaces/${agentPathId(workspaceId, 'workspaceId')}/checkpoints`,
                            { method: 'POST', body: request },
                        );
                    },
                    rollback: async (workspaceId, request) => {
                        return await this.requestWithSession<WorkspaceRollbackResponse>(
                            `/admin/agent/workspaces/${agentPathId(workspaceId, 'workspaceId')}/rollback`,
                            { method: 'POST', body: request },
                        );
                    },
                    resumeRollback: async workspaceId => {
                        return await this.requestWithSession<WorkspaceRollbackResponse>(
                            `/admin/agent/workspaces/${agentPathId(workspaceId, 'workspaceId')}/rollback/resume`,
                            { method: 'POST' },
                        );
                    },
                },
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

    /**
     * Colon-form shorthand for {@link AuthorityClient.modules.execute}:
     * `<moduleId>:<transactionName>`. The shorthand is parsed on the first
     * colon so transaction names are free to use other delimiters; a
     * transaction name that itself contains `:` is rejected as ambiguous.
     * All validation runs before any permission prompt is shown.
     */
    async tx<TResult = unknown>(
        name: string,
        input?: unknown,
        options?: AuthorityModuleTransactionOptions,
    ): Promise<AuthorityModuleTransactionResponse<TResult>> {
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

        return await this.modules.execute<TResult>(moduleId, transactionName, input, options);
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

    async evaluatePermissions(requests: AuthorityPermissionRequest[]): Promise<PermissionEvaluateResponse[]> {
        if (requests.length === 0) {
            return [];
        }
        const response = await this.requestWithSession<PermissionEvaluateBatchResponse>('/permissions/evaluate-batch', {
            method: 'POST',
            body: { requests },
        });
        return response.results;
    }

    async explainPermission(request: AuthorityPermissionRequest): Promise<AuthorityPermissionExplainResult> {
        const evaluation = await this.evaluatePermission(request);
        return {
            evaluation,
            message: getPermissionEvaluationMessage(this.config.displayName, evaluation.resource, evaluation.target, evaluation.decision),
        };
    }

    private warnHeavyTriviumDiagnostics(operation: 'stat.includeMappingIntegrity' | 'checkMappingsIntegrity' | 'deleteOrphanMappings', database: string): void {
        console.warn(
            `[Authority] Trivium ${operation} on ${database} is a diagnostics/maintenance path and may scan mapping or node sets. Avoid using it on hot user-interaction paths.`,
        );
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

    private async getEffectiveInlineThresholdBytes(key: InlineThresholdKey): Promise<number> {
        const sessionThreshold = this.session?.limits.effectiveInlineThresholdBytes[key]?.bytes;
        if (typeof sessionThreshold === 'number' && Number.isFinite(sessionThreshold) && sessionThreshold > 0) {
            return sessionThreshold;
        }

        try {
            const probe = this.probeSnapshot ?? await this.ensureProbe();
            return probe.limits.effectiveInlineThresholdBytes[key].bytes;
        } catch {
            return SDK_TRANSFER_INLINE_THRESHOLD_BYTES;
        }
    }

    private async getTransferStatus(transferId: string): Promise<DataTransferStatusResponse> {
        return await this.requestWithSession<DataTransferStatusResponse>(`/transfers/${encodeURIComponent(transferId)}/status`, {
            method: 'POST',
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

    private rememberAgentSession(snapshot: AgentSessionSnapshot): void {
        this.agentSessionWorkspaces.set(snapshot.session.id, snapshot.session.workspaceId);
    }

    private rememberAgentSessionSummaries(sessions: AgentSessionSummary[]): void {
        for (const session of sessions) {
            this.agentSessionWorkspaces.set(session.id, session.workspaceId);
        }
    }

    private async ensureAgentSessionRunPermission(sessionId: string, reason: string): Promise<void> {
        const id = agentValueId(sessionId, 'sessionId');
        let workspaceId = this.agentSessionWorkspaces.get(id);
        if (!workspaceId) {
            const snapshot = await this.requestWithSession<AgentSessionSnapshot>(
                `/agent/sessions/${agentPathId(id, 'sessionId')}`,
            );
            this.rememberAgentSession(snapshot);
            workspaceId = snapshot.session.workspaceId;
        }
        await this.ensurePermission({
            resource: 'agent.run',
            target: workspaceId,
            reason: `${reason}（${workspaceId}）`,
        });
    }

    private async requestWithSession<T>(path: string, options: SessionRequestOptions = {}, retried = false): Promise<T> {
        const session = await waitForSignal(this.ensureInitialized(), options.signal);

        try {
            const requestOptions = {
                body: options.body,
                sessionToken: session.sessionToken,
                ...(options.signal ? { signal: options.signal } : {}),
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
                await waitForSignal(this.init(true), options.signal);
                return await this.requestWithSession<T>(path, options, true);
            }

            throw error;
        }
    }

    private async putBlobWithTransfer(input: BlobPutRequest, bytes: Uint8Array): Promise<BlobRecord> {
        const transfer = await this.initializeTransfer('storage.blob', 'storageBlobWrite');
        try {
            await this.appendTransferBytes(transfer, bytes);
            const status = await this.getTransferStatus(transfer.transferId);
            const request: BlobTransferCommitRequest = {
                transferId: transfer.transferId,
                name: input.name,
                ...(input.contentType ? { contentType: input.contentType } : {}),
                ...(status.checksumSha256 ? { expectedChecksumSha256: status.checksumSha256 } : {}),
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
        const requestInlineThreshold = await this.getEffectiveInlineThresholdBytes('httpFetchRequest');
        if (!bodyBytes || bodyBytes.byteLength <= requestInlineThreshold) {
            const opened = await this.requestWithSession<HttpFetchOpenResponse>('/http/fetch-open', {
                method: 'POST',
                body: input,
            });
            return await this.resolveHttpFetchOpenResponse(opened);
        }

        const transfer = await this.initializeTransfer('http.fetch', 'httpFetchRequest');
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
        const transfer = await this.initializeTransfer('fs.private', 'privateFileWrite');
        try {
            await this.appendTransferBytes(transfer, bytes);
            const status = await this.getTransferStatus(transfer.transferId);
            const request: PrivateFileTransferCommitRequest = {
                transferId: transfer.transferId,
                path,
                ...(options.createParents === undefined ? {} : { createParents: options.createParents }),
                ...(status.checksumSha256 ? { expectedChecksumSha256: status.checksumSha256 } : {}),
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

    private async initializeTransfer(resource: DataTransferResource, purpose?: InlineThresholdKey): Promise<DataTransferInitResponse> {
        return await this.requestWithSession<DataTransferInitResponse>('/transfers/init', {
            method: 'POST',
            body: {
                resource,
                ...(purpose ? { purpose } : {}),
            },
        });
    }

    private async appendTransferBytes(transfer: DataTransferInitResponse, bytes: Uint8Array): Promise<void> {
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

    private async readTransferBytes(transfer: DataTransferInitResponse): Promise<Uint8Array> {
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
            const chunk = await this.requestWithSession<DataTransferReadResponse>(`/transfers/${encodeURIComponent(transfer.transferId)}/read`, {
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
        'module.execute': [],
        'agent.run': [],
        'agent.browser': [],
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

function isAgentSessionSnapshot(value: unknown): value is AgentSessionSnapshot {
    if (!isObjectRecord(value) || !isObjectRecord(value.session)) return false;
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

function isAgentSessionEvent(value: unknown): value is AgentSessionEvent {
    return isObjectRecord(value)
        && typeof value.sessionId === 'string'
        && typeof value.sequence === 'number'
        && typeof value.type === 'string'
        && typeof value.timestamp === 'string';
}

function isObjectRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function oneTimeTicket(value: unknown): string {
    if (typeof value !== 'string' || !/^[A-Za-z0-9_-]{32,128}$/.test(value)) {
        throw new Error('Authority event stream returned an invalid one-time ticket');
    }
    return value;
}

function agentPathId(value: unknown, label: string): string {
    return encodeURIComponent(agentValueId(value, label));
}

function agentValueId(value: unknown, label: string): string {
    if (typeof value !== 'string' || !value.trim()) {
        throw new Error(`Authority agent ${label} must be a non-empty string`);
    }
    return value.trim();
}

function agentWorkspacePath(value: unknown): string {
    if (typeof value !== 'string' || value.length === 0) {
        throw new Error('Authority agent workspace file diff path must be a non-empty string');
    }
    return value;
}

function getSqlDatabaseName(value: unknown): string {
    return typeof value === 'string' && value.trim() ? value.trim() : 'default';
}

function getTriviumDatabaseName(value: unknown): string {
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
function trimModuleIdentifier(value: unknown): string {
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
function trimModuleTransactionName(value: unknown): string {
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

function modulePermissionTarget(
    moduleId: string,
    transactionName: string,
    transaction: ModuleTransactionManifest,
): string {
    switch (transaction.permissionTarget.kind) {
        case 'module':
            return moduleId;
        case 'transaction':
            return `${moduleId}:${transactionName}`;
        case 'custom':
            return transaction.permissionTarget.target;
    }
}

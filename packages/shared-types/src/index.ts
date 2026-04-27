export type InstallType = 'system' | 'local' | 'global';

export type PermissionResource =
    | 'storage.kv'
    | 'storage.blob'
    | 'fs.private'
    | 'sql.private'
    | 'trivium.private'
    | 'http.fetch'
    | 'jobs.background'
    | 'events.stream';

export type PermissionStatus = 'granted' | 'denied' | 'prompt' | 'blocked';
export type PermissionDecision = 'allow-once' | 'allow-session' | 'allow-always' | 'deny';
export type RiskLevel = 'low' | 'medium' | 'high';
export type GrantScope = 'session' | 'persistent' | 'policy';
export type AuthorityErrorCategory = 'permission' | 'auth' | 'session' | 'validation' | 'limit' | 'timeout' | 'core';
export type AuthorityErrorCode =
    | 'permission_not_granted'
    | 'permission_denied'
    | 'permission_blocked'
    | 'unauthorized'
    | 'invalid_session'
    | 'session_user_mismatch'
    | 'validation_error'
    | 'limit_exceeded'
    | 'timeout'
    | 'core_unavailable'
    | 'core_request_failed';
export type JobStatus = 'queued' | 'running' | 'completed' | 'failed' | 'cancelled';
export type PrivateFileKind = 'file' | 'directory';
export type PrivateFileEncoding = 'utf8' | 'base64';
export type HttpBodyEncoding = 'utf8' | 'base64';
export type DataTransferResource = 'storage.blob' | 'fs.private' | 'http.fetch';

export interface AuthorityPermissionErrorPayloadDetails {
    resource: PermissionResource;
    target: string;
    key: string;
    riskLevel: RiskLevel;
}

export interface AuthorityErrorPayload {
    error: string;
    code?: AuthorityErrorCode;
    category?: AuthorityErrorCategory;
    details?: Record<string, unknown> | AuthorityPermissionErrorPayloadDetails;
}

export interface DeclaredPermissions {
    storage?: {
        kv?: boolean;
        blob?: boolean;
    };
    fs?: {
        private?: boolean;
    };
    sql?: {
        private?: boolean | string[];
    };
    trivium?: {
        private?: boolean | string[];
    };
    http?: {
        allow?: string[];
    };
    jobs?: {
        background?: boolean | string[];
    };
    events?: {
        channels?: boolean | string[];
    };
}

export interface AuthorityInitConfig {
    extensionId: string;
    displayName: string;
    version: string;
    installType: InstallType;
    declaredPermissions: DeclaredPermissions;
    uiLabel?: string;
}

export interface AuthorityGrant {
    key: string;
    resource: PermissionResource;
    target: string;
    status: PermissionStatus;
    scope: GrantScope;
    riskLevel: RiskLevel;
    updatedAt: string;
    source: 'user' | 'admin' | 'system';
}

export interface AuthorityPolicyEntry {
    key: string;
    resource: PermissionResource;
    target: string;
    status: PermissionStatus;
    riskLevel: RiskLevel;
    updatedAt: string;
    source: 'admin' | 'system';
}

export interface SessionUserInfo {
    handle: string;
    isAdmin: boolean;
}

export interface SessionExtensionInfo {
    id: string;
    installType: InstallType;
    displayName: string;
    version: string;
    firstSeenAt: string;
}

export type AuthorityInstallStatusCode = 'ready' | 'installed' | 'updated' | 'conflict' | 'error' | 'missing';
export type AuthorityCoreRuntimeState = 'stopped' | 'starting' | 'running' | 'missing' | 'error';

export interface AuthorityFeatureFlags {
    securityCenter: boolean;
    admin: boolean;
    sql: {
        queryPage: boolean;
        stat: boolean;
        migrations: boolean;
        schemaManifest: boolean;
    };
    trivium: {
        resolveId: boolean;
        resolveMany: boolean;
        upsert: boolean;
        bulkMutations: boolean;
        filterWherePage: boolean;
        queryPage: boolean;
        mappingPages: boolean;
        mappingIntegrity: boolean;
    };
    transfers: {
        blob: boolean;
        fs: boolean;
        httpFetch: boolean;
    };
    jobs: {
        background: boolean;
        safeRequeue: boolean;
        builtinTypes: string[];
    };
    diagnostics: {
        warnings: boolean;
        activityPages: boolean;
        jobsPage: boolean;
        benchmarkCore: boolean;
    };
}

export interface AuthorityJobRegistrySummary {
    registered: number;
    jobTypes: string[];
    entries: AuthorityJobRegistryEntry[];
}

export interface AuthorityJobRegistryField {
    name: string;
    type: string;
    required: boolean;
    description: string;
}

export interface AuthorityJobRegistryEntry {
    type: string;
    description: string;
    defaultTimeoutMs: number | null;
    defaultMaxAttempts: number;
    cancellable: boolean;
    payloadFields: AuthorityJobRegistryField[];
    progressFields: AuthorityJobRegistryField[];
}

export interface AuthorityProbeLimits {
    maxRequestBytes: number | null;
    maxKvValueBytes: number;
    maxBlobBytes: number;
    maxHttpBodyBytes: number;
    maxHttpResponseBytes: number;
    maxEventPollLimit: number | null;
    maxDataTransferBytes: number;
    dataTransferChunkBytes: number;
    dataTransferInlineThresholdBytes: number;
}

export interface AuthorityProbeCoreHealth {
    name: string;
    apiVersion: string;
    version: string;
    buildHash: string | null;
    platform: string;
    pid: number;
    startedAt: string;
    uptimeMs: number;
    requestCount: number;
    errorCount: number;
    activeJobCount: number;
    queuedJobCount: number;
    queuedRequestCount: number;
    runtimeMode: string;
    maxConcurrency: number;
    currentConcurrency: number;
    workerCount: number;
    lastError: string | null;
    jobRegistrySummary: AuthorityJobRegistrySummary;
    timeoutMs: number;
    limits: {
        maxRequestBytes: number;
        maxKvValueBytes: number;
        maxBlobBytes: number;
        maxHttpBodyBytes: number;
        maxHttpResponseBytes: number;
        maxEventPollLimit: number;
    };
}

export interface AuthorityProbeCoreStatus {
    enabled: boolean;
    state: AuthorityCoreRuntimeState;
    port: number | null;
    pid: number | null;
    version: string | null;
    startedAt: string | null;
    lastError: string | null;
    health: AuthorityProbeCoreHealth | null;
}

export interface AuthorityProbeResponse {
    id: string;
    online: boolean;
    version: string;
    pluginId: string;
    sdkExtensionId: string;
    pluginVersion: string;
    sdkBundledVersion: string;
    sdkDeployedVersion: string | null;
    coreBundledVersion: string | null;
    coreArtifactPlatform: string | null;
    coreArtifactPlatforms: string[];
    coreArtifactHash: string | null;
    coreBinarySha256: string | null;
    coreVerified: boolean;
    coreMessage: string | null;
    installStatus: AuthorityInstallStatusCode;
    installMessage: string;
    storageRoot: string;
    features: AuthorityFeatureFlags;
    limits: AuthorityProbeLimits;
    jobs: {
        builtinTypes: string[];
        registry: AuthorityJobRegistrySummary;
    };
    core: AuthorityProbeCoreStatus;
}

export interface SessionInitResponse {
    sessionToken: string;
    user: SessionUserInfo;
    extension: SessionExtensionInfo;
    grants: AuthorityGrant[];
    policies: AuthorityPolicyEntry[];
    features: AuthorityFeatureFlags;
}

export interface ControlSessionSnapshot {
    sessionToken: string;
    createdAt: string;
    user: SessionUserInfo;
    extension: SessionExtensionInfo;
    declaredPermissions: DeclaredPermissions;
}

export interface ControlSessionInitRequest {
    sessionToken: string;
    timestamp: string;
    user: SessionUserInfo;
    config: AuthorityInitConfig;
}

export interface ControlSessionGetRequest {
    userHandle: string;
    sessionToken: string;
}

export interface ControlSessionResponse {
    session: ControlSessionSnapshot | null;
}

export interface ControlExtensionRecord extends SessionExtensionInfo {
    lastSeenAt: string;
    declaredPermissions: DeclaredPermissions;
    uiLabel?: string;
}

export interface ControlExtensionsListRequest {
    userHandle: string;
}

export interface ControlExtensionGetRequest {
    userHandle: string;
    extensionId: string;
}

export interface ControlExtensionsListResponse {
    extensions: ControlExtensionRecord[];
}

export interface ControlExtensionResponse {
    extension: ControlExtensionRecord | null;
}

export type ControlAuditKind = 'permission' | 'usage' | 'error' | 'warning';

export interface CursorPageRequest {
    cursor?: string;
    limit?: number;
}

export interface CursorPageInfo {
    nextCursor: string | null;
    limit: number;
    hasMore: boolean;
    totalCount: number;
}

export interface ControlAuditRecord {
    timestamp: string;
    kind: ControlAuditKind;
    extensionId: string;
    message: string;
    details?: Record<string, unknown>;
}

export interface ControlAuditLogRequest {
    userHandle: string;
    record: ControlAuditRecord;
}

export interface ControlAuditRecentRequest {
    userHandle: string;
    extensionId: string;
    limit?: number;
    page?: CursorPageRequest;
}

export interface ControlAuditRecentResponse {
    permissions: ControlAuditRecord[];
    usage: ControlAuditRecord[];
    errors: ControlAuditRecord[];
    warnings: ControlAuditRecord[];
    pages: {
        permissions: CursorPageInfo;
        usage: CursorPageInfo;
        errors: CursorPageInfo;
        warnings: CursorPageInfo;
    };
}

export interface ControlGrantRecord extends AuthorityGrant {
    choice?: PermissionDecision;
}

export interface ControlGrantListRequest {
    userHandle: string;
    extensionId: string;
}

export interface ControlGrantGetRequest {
    userHandle: string;
    extensionId: string;
    key: string;
}

export interface ControlGrantUpsertRequest {
    userHandle: string;
    extensionId: string;
    grant: ControlGrantRecord;
}

export interface ControlGrantResetRequest {
    userHandle: string;
    extensionId: string;
    keys?: string[];
}

export interface ControlGrantListResponse {
    grants: ControlGrantRecord[];
}

export interface ControlGrantResponse {
    grant: ControlGrantRecord | null;
}

export interface ControlPoliciesRequest {
    userHandle: string;
}

export interface ControlPoliciesSaveRequest {
    actor: SessionUserInfo;
    partial: Partial<{
        defaults: Record<PermissionResource, PermissionStatus>;
        extensions: Record<string, Record<string, AuthorityPolicyEntry>>;
        updatedAt: string;
    }>;
}

export interface ControlPoliciesResponse {
    defaults: Record<PermissionResource, PermissionStatus>;
    extensions: Record<string, Record<string, AuthorityPolicyEntry>>;
    updatedAt: string;
}

export interface ControlJobRecord extends JobRecord {
    payload?: Record<string, unknown>;
    result?: Record<string, unknown>;
    channel: string;
}

export interface ControlJobsListRequest {
    userHandle: string;
    extensionId?: string;
    page?: CursorPageRequest;
}

export interface ControlJobGetRequest {
    userHandle: string;
    jobId: string;
}

export interface ControlJobCreateRequest {
    userHandle: string;
    extensionId: string;
    type: string;
    payload?: Record<string, unknown>;
    timeoutMs?: number;
    idempotencyKey?: string;
    maxAttempts?: number;
}

export interface ControlJobCancelRequest {
    userHandle: string;
    extensionId: string;
    jobId: string;
}

export interface ControlJobRequeueRequest {
    userHandle: string;
    extensionId: string;
    jobId: string;
}

export interface ControlJobUpsertRequest {
    userHandle: string;
    job: ControlJobRecord;
}

export interface ControlJobsListResponse {
    jobs: ControlJobRecord[];
    page: CursorPageInfo;
}

export interface ControlJobResponse {
    job: ControlJobRecord | null;
}

export interface ControlKvGetRequest {
    key: string;
}

export interface ControlKvSetRequest {
    key: string;
    value: unknown;
}

export interface ControlKvDeleteRequest {
    key: string;
}

export interface ControlKvListRequest {}

export interface ControlKvResponse {
    value?: unknown;
}

export interface ControlKvListResponse {
    entries: Record<string, unknown>;
}

export interface ControlBlobScopeRequest {
    userHandle: string;
    extensionId: string;
    blobDir: string;
}

export interface ControlBlobPutRequest extends ControlBlobScopeRequest, BlobPutRequest {
    sourcePath?: string;
}

export interface ControlBlobGetRequest extends ControlBlobScopeRequest {
    id: string;
}

export interface ControlBlobOpenReadResponse {
    record: BlobRecord;
    sourcePath: string;
}

export interface ControlBlobDeleteRequest extends ControlBlobScopeRequest {
    id: string;
}

export interface ControlBlobListRequest extends ControlBlobScopeRequest {}

export interface ControlBlobListResponse {
    entries: BlobRecord[];
}

export interface PrivateFileEntry {
    name: string;
    path: string;
    kind: PrivateFileKind;
    sizeBytes: number;
    updatedAt: string;
}

export interface PrivateFileUsageSummary {
    fileCount: number;
    directoryCount: number;
    totalSizeBytes: number;
    latestUpdatedAt: string | null;
}

export interface PrivateFileScopeRequest {
    path: string;
}

export interface PrivateFileMkdirRequest extends PrivateFileScopeRequest {
    recursive?: boolean;
}

export interface PrivateFileReadDirRequest extends PrivateFileScopeRequest {
    limit?: number;
}

export interface PrivateFileWriteRequest extends PrivateFileScopeRequest {
    content: string;
    encoding?: PrivateFileEncoding;
    createParents?: boolean;
}

export interface PrivateFileReadRequest extends PrivateFileScopeRequest {
    encoding?: PrivateFileEncoding;
}

export interface PrivateFileDeleteRequest extends PrivateFileScopeRequest {
    recursive?: boolean;
}

export interface PrivateFileStatRequest extends PrivateFileScopeRequest {}

export interface PrivateFileResponse {
    entry: PrivateFileEntry;
}

export interface PrivateFileReadResponse {
    entry: PrivateFileEntry;
    content: string;
    encoding: PrivateFileEncoding;
}

export interface PrivateFileOpenReadInlineResponse extends PrivateFileReadResponse {
    mode: 'inline';
}

export interface PrivateFileOpenReadTransferResponse {
    mode: 'transfer';
    entry: PrivateFileEntry;
    encoding: PrivateFileEncoding;
    transfer: DataTransferInitResponse;
}

export type PrivateFileOpenReadResponse = PrivateFileOpenReadInlineResponse | PrivateFileOpenReadTransferResponse;

export interface PrivateFileListResponse {
    entries: PrivateFileEntry[];
}

export interface PrivateFileDeleteResponse {
    ok: true;
}

export interface ControlPrivateFileScopeRequest extends PrivateFileScopeRequest {
    rootDir: string;
}

export interface ControlPrivateFileMkdirRequest extends ControlPrivateFileScopeRequest {
    recursive?: boolean;
}

export interface ControlPrivateFileReadDirRequest extends ControlPrivateFileScopeRequest {
    limit?: number;
}

export interface ControlPrivateFileWriteRequest extends ControlPrivateFileScopeRequest {
    content: string;
    encoding?: PrivateFileEncoding;
    createParents?: boolean;
    sourcePath?: string;
}

export interface ControlPrivateFileReadRequest extends ControlPrivateFileScopeRequest {
    encoding?: PrivateFileEncoding;
}

export interface ControlPrivateFileOpenReadResponse {
    entry: PrivateFileEntry;
    sourcePath: string;
}

export interface ControlHttpFetchRequest {
    url: string;
    method?: string;
    headers?: Record<string, string>;
    body?: string;
    bodyEncoding?: HttpBodyEncoding;
    bodySourcePath?: string;
}

export interface ControlHttpFetchOpenRequest extends ControlHttpFetchRequest {
    responsePath: string;
}

export interface ControlHttpFetchOpenResponse {
    url: string;
    hostname: string;
    status: number;
    ok: boolean;
    headers: Record<string, string>;
    bodyEncoding: HttpBodyEncoding;
    contentType: string;
    sizeBytes: number;
}

export interface ControlPrivateFileDeleteRequest extends ControlPrivateFileScopeRequest {
    recursive?: boolean;
}

export interface ControlPrivateFileStatRequest extends ControlPrivateFileScopeRequest {}

export interface ControlEventRecord {
    id: number;
    timestamp: string;
    extensionId?: string;
    channel: string;
    name: string;
    payload?: unknown;
}

export interface ControlEventsPollRequest {
    userHandle: string;
    channel: string;
    afterId?: number;
    limit?: number;
    page?: CursorPageRequest;
}

export interface ControlEventsPollResponse {
    events: ControlEventRecord[];
    cursor: number;
    page: CursorPageInfo;
}

export interface PermissionEvaluateRequest {
    resource: PermissionResource;
    target?: string;
    reason?: string;
    meta?: Record<string, unknown>;
}

export interface PermissionEvaluateResponse {
    decision: PermissionStatus;
    key: string;
    riskLevel: RiskLevel;
    target: string;
    resource: PermissionResource;
    grant?: AuthorityGrant | AuthorityPolicyEntry;
}

export interface PermissionEvaluateBatchRequest {
    requests: PermissionEvaluateRequest[];
}

export interface PermissionEvaluateBatchResponse {
    results: PermissionEvaluateResponse[];
}

export interface PermissionResolveRequest extends PermissionEvaluateRequest {
    choice: PermissionDecision;
}

export interface BlobPutRequest {
    name: string;
    content: string;
    encoding?: 'utf8' | 'base64';
    contentType?: string;
}

export interface DataTransferInitRequest {
    resource: DataTransferResource;
}

export interface DataTransferInitResponse {
    transferId: string;
    resource: DataTransferResource;
    chunkSize: number;
    maxBytes: number;
    createdAt: string;
    updatedAt: string;
    sizeBytes: number;
}

export interface DataTransferAppendRequest {
    offset: number;
    content: string;
}

export interface DataTransferAppendResponse {
    transferId: string;
    sizeBytes: number;
    updatedAt: string;
}

export interface DataTransferReadRequest {
    offset: number;
    limit?: number;
}

export interface DataTransferReadResponse {
    transferId: string;
    offset: number;
    content: string;
    encoding: 'base64';
    sizeBytes: number;
    eof: boolean;
    updatedAt: string;
}

export interface BlobTransferCommitRequest {
    transferId: string;
    name: string;
    contentType?: string;
}

export interface PrivateFileTransferCommitRequest {
    transferId: string;
    path: string;
    createParents?: boolean;
}

export interface BlobRecord {
    id: string;
    name: string;
    contentType: string;
    size: number;
    updatedAt: string;
}

export interface BlobGetResponse {
    record: BlobRecord;
    content: string;
    encoding: 'base64';
}

export interface BlobOpenReadInlineResponse extends BlobGetResponse {
    mode: 'inline';
}

export interface BlobOpenReadTransferResponse {
    mode: 'transfer';
    record: BlobRecord;
    encoding: 'base64';
    transfer: DataTransferInitResponse;
}

export type BlobOpenReadResponse = BlobOpenReadInlineResponse | BlobOpenReadTransferResponse;

export type JobAttemptEvent = 'started' | 'retryScheduled' | 'completed' | 'failed' | 'cancelled' | 'recovered';

export interface JobAttemptRecord {
    attempt: number;
    event: JobAttemptEvent;
    timestamp: string;
    summary?: string;
    error?: string;
    backoffMs?: number;
}

export interface JobRecord {
    id: string;
    extensionId: string;
    type: string;
    status: JobStatus;
    createdAt: string;
    updatedAt: string;
    progress: number;
    summary?: string;
    error?: string;
    startedAt?: string;
    finishedAt?: string;
    timeoutMs?: number;
    idempotencyKey?: string;
    attempt?: number;
    maxAttempts?: number;
    cancelRequestedAt?: string;
    attemptHistory?: JobAttemptRecord[];
}

export interface JobListRequest {
    page?: CursorPageRequest;
}

export interface JobListResponse {
    jobs: JobRecord[];
    page: CursorPageInfo;
}

export type SqlValue = string | number | boolean | null;
export type SqlStatementMode = 'query' | 'exec';

export interface SqlRuntimeConfigDiagnostics {
    journalMode: string;
    synchronous: string;
    foreignKeys: boolean;
    busyTimeoutMs: number;
    pagedQueryRequiresOrderBy: boolean;
}

export interface SqlSlowQueryDiagnostics {
    count: number;
    lastOccurredAt: string | null;
    lastElapsedMs: number | null;
    lastStatementPreview: string | null;
}

export interface SqlQueryRequest {
    database?: string;
    statement: string;
    params?: SqlValue[];
    page?: CursorPageRequest;
}

export interface SqlStatRequest {
    database?: string;
}

export interface SqlExecRequest {
    database?: string;
    statement: string;
    params?: SqlValue[];
}

export interface SqlStatementInput {
    mode?: SqlStatementMode;
    statement: string;
    params?: SqlValue[];
}

export interface SqlBatchRequest {
    database?: string;
    statements: SqlStatementInput[];
}

export interface SqlQueryResult {
    kind: 'query';
    columns: string[];
    rows: Record<string, SqlValue>[];
    rowCount: number;
    page?: CursorPageInfo;
}

export interface SqlExecResult {
    kind: 'exec';
    rowsAffected: number;
    lastInsertRowid: number | null;
}

export type SqlStatementResult = SqlQueryResult | SqlExecResult;

export interface SqlBatchResponse {
    results: SqlStatementResult[];
}

export interface SqlTransactionRequest {
    database?: string;
    statements: SqlStatementInput[];
}

export interface SqlTransactionResponse {
    committed: boolean;
    results: SqlStatementResult[];
}

export interface SqlMigrationInput {
    id: string;
    statement: string;
}

export interface SqlMigrateRequest {
    database?: string;
    migrations: SqlMigrationInput[];
    tableName?: string;
}

export interface SqlMigrateResponse {
    tableName: string;
    applied: string[];
    skipped: string[];
    latestId: string | null;
}

export interface SqlMigrationRecord {
    id: string;
    appliedAt: string;
}

export interface SqlListMigrationsRequest {
    database?: string;
    tableName?: string;
    page?: CursorPageRequest;
}

export interface SqlListMigrationsResponse {
    tableName: string;
    migrations: SqlMigrationRecord[];
    page?: CursorPageInfo;
}

export type SqlSchemaObjectType = 'table' | 'index' | 'view' | 'trigger';

export interface SqlSchemaObjectRecord {
    type: SqlSchemaObjectType;
    name: string;
    tableName: string | null;
    sql: string | null;
}

export interface SqlListSchemaRequest {
    database?: string;
    type?: SqlSchemaObjectType;
    page?: CursorPageRequest;
}

export interface SqlListSchemaResponse {
    objects: SqlSchemaObjectRecord[];
    page?: CursorPageInfo;
}

export interface SqlDatabaseRecord {
    name: string;
    fileName: string;
    sizeBytes: number;
    updatedAt: string | null;
    runtimeConfig: SqlRuntimeConfigDiagnostics;
    slowQuery: SqlSlowQueryDiagnostics;
}

export interface SqlListDatabasesResponse {
    databases: SqlDatabaseRecord[];
}

export interface SqlStatResponse extends SqlDatabaseRecord {
    database: string;
    filePath: string;
    exists: boolean;
}

export type TriviumDType = 'f32' | 'f16' | 'u64';
export type TriviumSyncMode = 'full' | 'normal' | 'off';
export type TriviumStorageMode = 'mmap' | 'rom';

export interface TriviumOpenOptions {
    database?: string;
    dim?: number;
    dtype?: TriviumDType;
    syncMode?: TriviumSyncMode;
    storageMode?: TriviumStorageMode;
}

export interface TriviumNodeReference {
    id?: number;
    externalId?: string;
    namespace?: string;
}

export interface TriviumResolvedNodeReference {
    id: number;
    externalId: string | null;
    namespace: string | null;
}

export interface TriviumEdgeView {
    targetId: number;
    targetExternalId?: string | null;
    targetNamespace?: string | null;
    label: string;
    weight: number;
}

export interface TriviumNodeView {
    id: number;
    externalId?: string | null;
    namespace?: string | null;
    vector: number[];
    payload: unknown;
    edges: TriviumEdgeView[];
    numEdges: number;
}

export interface TriviumSearchHit {
    id: number;
    externalId?: string | null;
    namespace?: string | null;
    score: number;
    payload: unknown;
}

export interface TriviumInsertRequest extends TriviumOpenOptions {
    vector: number[];
    payload: unknown;
}

export interface TriviumInsertWithIdRequest extends TriviumOpenOptions {
    id: number;
    vector: number[];
    payload: unknown;
}

export interface TriviumGetRequest extends TriviumOpenOptions {
    id: number;
}

export interface TriviumUpdatePayloadRequest extends TriviumOpenOptions {
    id: number;
    payload: unknown;
}

export interface TriviumUpdateVectorRequest extends TriviumOpenOptions {
    id: number;
    vector: number[];
}

export interface TriviumDeleteRequest extends TriviumOpenOptions {
    id: number;
}

export interface TriviumLinkRequest extends TriviumOpenOptions {
    src: number;
    dst: number;
    label?: string;
    weight?: number;
}

export interface TriviumUnlinkRequest extends TriviumOpenOptions {
    src: number;
    dst: number;
}

export interface TriviumResolveIdRequest extends TriviumOpenOptions {
    externalId: string;
    namespace?: string;
}

export interface TriviumResolveManyRequest extends TriviumOpenOptions {
    items: TriviumNodeReference[];
}

export interface TriviumResolveManyItem {
    index: number;
    id: number | null;
    externalId: string | null;
    namespace: string | null;
    error?: string;
}

export interface TriviumResolveManyResponse {
    items: TriviumResolveManyItem[];
}

export interface TriviumUpsertRequest extends TriviumOpenOptions, TriviumNodeReference {
    vector: number[];
    payload: unknown;
}

export interface TriviumBulkUpsertItem extends TriviumNodeReference {
    vector: number[];
    payload: unknown;
}

export interface TriviumBulkUpsertRequest extends TriviumOpenOptions {
    items: TriviumBulkUpsertItem[];
}

export interface TriviumBulkLinkItem {
    src: TriviumNodeReference;
    dst: TriviumNodeReference;
    label?: string;
    weight?: number;
}

export interface TriviumBulkLinkRequest extends TriviumOpenOptions {
    items: TriviumBulkLinkItem[];
}

export interface TriviumBulkUnlinkItem {
    src: TriviumNodeReference;
    dst: TriviumNodeReference;
}

export interface TriviumBulkUnlinkRequest extends TriviumOpenOptions {
    items: TriviumBulkUnlinkItem[];
}

export interface TriviumBulkDeleteRequest extends TriviumOpenOptions {
    items: TriviumNodeReference[];
}

export interface TriviumNeighborsRequest extends TriviumOpenOptions {
    id: number;
    depth?: number;
}

export interface TriviumSearchRequest extends TriviumOpenOptions {
    vector: number[];
    topK?: number;
    expandDepth?: number;
    minScore?: number;
}

export type TriviumFilterCondition = Record<string, unknown>;

export interface TriviumSearchAdvancedRequest extends TriviumOpenOptions {
    vector: number[];
    queryText?: string;
    topK?: number;
    expandDepth?: number;
    minScore?: number;
    teleportAlpha?: number;
    enableAdvancedPipeline?: boolean;
    enableSparseResidual?: boolean;
    fistaLambda?: number;
    fistaThreshold?: number;
    enableDpp?: boolean;
    dppQualityWeight?: number;
    enableRefractoryFatigue?: boolean;
    enableInverseInhibition?: boolean;
    lateralInhibitionThreshold?: number;
    enableBqCoarseSearch?: boolean;
    bqCandidateRatio?: number;
    textBoost?: number;
    enableTextHybridSearch?: boolean;
    bm25K1?: number;
    bm25B?: number;
    payloadFilter?: TriviumFilterCondition;
}

export interface TriviumSearchHybridRequest extends TriviumOpenOptions {
    vector: number[];
    queryText: string;
    topK?: number;
    expandDepth?: number;
    minScore?: number;
    hybridAlpha?: number;
    payloadFilter?: TriviumFilterCondition;
}

export interface TriviumFilterWhereRequest extends TriviumOpenOptions {
    condition: TriviumFilterCondition;
    page?: CursorPageRequest;
}

export interface TriviumQueryRequest extends TriviumOpenOptions {
    cypher: string;
    page?: CursorPageRequest;
}

export interface TriviumIndexTextRequest extends TriviumOpenOptions {
    id: number;
    text: string;
}

export interface TriviumIndexKeywordRequest extends TriviumOpenOptions {
    id: number;
    keyword: string;
}

export interface TriviumBuildTextIndexRequest extends TriviumOpenOptions {}

export interface TriviumCompactRequest extends TriviumOpenOptions {}

export interface TriviumFlushRequest extends TriviumOpenOptions {}

export interface TriviumStatRequest extends TriviumOpenOptions {
    includeMappingIntegrity?: boolean;
}

export interface ControlTriviumBulkUpsertItem {
    id: number;
    vector: number[];
    payload: unknown;
}

export interface ControlTriviumBulkUpsertRequest extends TriviumOpenOptions {
    items: ControlTriviumBulkUpsertItem[];
}

export interface ControlTriviumBulkLinkItem {
    src: number;
    dst: number;
    label?: string;
    weight?: number;
}

export interface ControlTriviumBulkLinkRequest extends TriviumOpenOptions {
    items: ControlTriviumBulkLinkItem[];
}

export interface ControlTriviumBulkUnlinkItem {
    src: number;
    dst: number;
}

export interface ControlTriviumBulkUnlinkRequest extends TriviumOpenOptions {
    items: ControlTriviumBulkUnlinkItem[];
}

export interface ControlTriviumBulkDeleteItem {
    id: number;
}

export interface ControlTriviumBulkDeleteRequest extends TriviumOpenOptions {
    items: ControlTriviumBulkDeleteItem[];
}

export interface TriviumInsertResponse {
    id: number;
}

export interface TriviumResolveIdResponse {
    id: number | null;
    externalId: string;
    namespace: string;
}

export interface TriviumMappingRecord {
    id: number;
    externalId: string;
    namespace: string;
    createdAt: string;
    updatedAt: string;
}

export interface TriviumListMappingsRequest extends TriviumOpenOptions {
    namespace?: string;
    page?: CursorPageRequest;
}

export interface TriviumListMappingsResponse {
    mappings: TriviumMappingRecord[];
    page?: CursorPageInfo;
}

export type TriviumMappingIntegrityIssueType = 'orphanMapping' | 'missingMapping' | 'duplicateInternalId' | 'duplicateExternalId';

export interface TriviumMappingIntegrityIssue {
    type: TriviumMappingIntegrityIssueType;
    message: string;
    id: number | null;
    externalId: string | null;
    namespace: string | null;
}

export interface TriviumCheckMappingsIntegrityRequest extends TriviumOpenOptions {
    sampleLimit?: number;
}

export interface TriviumCheckMappingsIntegrityResponse {
    ok: boolean;
    mappingCount: number;
    nodeCount: number;
    orphanMappingCount: number;
    missingMappingCount: number;
    duplicateInternalIdCount: number;
    duplicateExternalIdCount: number;
    issues: TriviumMappingIntegrityIssue[];
    sampled: boolean;
}

export interface TriviumDeleteOrphanMappingsRequest extends TriviumOpenOptions {
    limit?: number;
    dryRun?: boolean;
}

export interface TriviumDeleteOrphanMappingsResponse {
    scannedCount: number;
    orphanCount: number;
    deletedCount: number;
    hasMore: boolean;
    orphans: TriviumMappingRecord[];
}

export type TriviumUpsertAction = 'inserted' | 'updated';

export interface TriviumUpsertResponse {
    id: number;
    action: TriviumUpsertAction;
    externalId: string | null;
    namespace: string | null;
}

export interface TriviumNeighborsResponse {
    ids: number[];
    nodes?: TriviumResolvedNodeReference[];
}

export interface TriviumBulkFailure {
    index: number;
    message: string;
}

export interface TriviumBulkMutationResponse {
    totalCount: number;
    successCount: number;
    failureCount: number;
    failures: TriviumBulkFailure[];
}

export interface ControlTriviumBulkUpsertResponseItem {
    index: number;
    id: number;
    action: TriviumUpsertAction;
}

export interface ControlTriviumBulkUpsertResponse extends TriviumBulkMutationResponse {
    items: ControlTriviumBulkUpsertResponseItem[];
}

export interface TriviumBulkUpsertResponseItem {
    index: number;
    id: number;
    action: TriviumUpsertAction;
    externalId: string | null;
    namespace: string | null;
}

export interface TriviumBulkUpsertResponse extends TriviumBulkMutationResponse {
    items: TriviumBulkUpsertResponseItem[];
}

export interface TriviumFilterWhereResponse {
    nodes: TriviumNodeView[];
    page?: CursorPageInfo;
}

export type TriviumQueryRow = Record<string, TriviumNodeView>;

export interface TriviumQueryResponse {
    rows: TriviumQueryRow[];
    page?: CursorPageInfo;
}

export interface TriviumDatabaseRecord {
    name: string;
    fileName: string;
    dim: number | null;
    dtype: TriviumDType | null;
    syncMode: TriviumSyncMode | null;
    storageMode: TriviumStorageMode | null;
    sizeBytes: number;
    walSizeBytes: number;
    vecSizeBytes: number;
    totalSizeBytes: number;
    updatedAt: string | null;
    indexHealth: TriviumIndexHealth | null;
}

export type TriviumIndexHealthStatus = 'missing' | 'fresh' | 'stale';

export interface TriviumIndexHealth {
    status: TriviumIndexHealthStatus;
    reason: string | null;
    requiresRebuild: boolean;
    staleSince: string | null;
    lastContentMutationAt: string | null;
    lastTextWriteAt: string | null;
    lastTextRebuildAt: string | null;
    lastCompactionAt: string | null;
}

export interface TriviumListDatabasesResponse {
    databases: TriviumDatabaseRecord[];
}

export interface TriviumStatResponse extends TriviumDatabaseRecord {
    database: string;
    filePath: string;
    exists: boolean;
    nodeCount: number;
    edgeCount: number;
    textIndexCount: number | null;
    lastFlushAt: string | null;
    mappingCount: number;
    orphanMappingCount: number | null;
    vectorDim: number | null;
    databaseSize: number;
    walSize: number;
    vecSize: number;
    estimatedMemoryBytes: number;
}

export interface HttpFetchRequest {
    url: string;
    method?: string;
    headers?: Record<string, string>;
    body?: string;
    bodyEncoding?: HttpBodyEncoding;
}

export interface HttpFetchResponse {
    url: string;
    hostname: string;
    status: number;
    ok: boolean;
    headers: Record<string, string>;
    body: string;
    bodyEncoding: HttpBodyEncoding;
    contentType: string;
}

export interface HttpFetchOpenRequest extends HttpFetchRequest {
    bodyTransferId?: string;
}

export interface HttpFetchOpenInlineResponse extends HttpFetchResponse {
    mode: 'inline';
}

export interface HttpFetchOpenTransferResponse {
    mode: 'transfer';
    url: string;
    hostname: string;
    status: number;
    ok: boolean;
    headers: Record<string, string>;
    bodyEncoding: HttpBodyEncoding;
    contentType: string;
    transfer: DataTransferInitResponse;
}

export type HttpFetchOpenResponse = HttpFetchOpenInlineResponse | HttpFetchOpenTransferResponse;

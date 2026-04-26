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
export type JobStatus = 'queued' | 'running' | 'completed' | 'failed' | 'cancelled';
export type PrivateFileKind = 'file' | 'directory';
export type PrivateFileEncoding = 'utf8' | 'base64';

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

export interface SessionInitResponse {
    sessionToken: string;
    user: SessionUserInfo;
    extension: SessionExtensionInfo;
    grants: AuthorityGrant[];
    policies: AuthorityPolicyEntry[];
    features: {
        securityCenter: boolean;
        admin: boolean;
    };
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

export type ControlAuditKind = 'permission' | 'usage' | 'error';

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
}

export interface ControlAuditRecentResponse {
    permissions: ControlAuditRecord[];
    usage: ControlAuditRecord[];
    errors: ControlAuditRecord[];
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
}

export interface ControlJobCancelRequest {
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

export interface ControlBlobPutRequest extends ControlBlobScopeRequest, BlobPutRequest {}

export interface ControlBlobGetRequest extends ControlBlobScopeRequest {
    id: string;
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
}

export interface ControlPrivateFileReadRequest extends ControlPrivateFileScopeRequest {
    encoding?: PrivateFileEncoding;
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
}

export interface ControlEventsPollResponse {
    events: ControlEventRecord[];
    cursor: number;
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

export interface PermissionResolveRequest extends PermissionEvaluateRequest {
    choice: PermissionDecision;
}

export interface BlobPutRequest {
    name: string;
    content: string;
    encoding?: 'utf8' | 'base64';
    contentType?: string;
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
}

export type SqlValue = string | number | boolean | null;
export type SqlStatementMode = 'query' | 'exec';

export interface SqlQueryRequest {
    database?: string;
    statement: string;
    params?: SqlValue[];
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

export interface SqlDatabaseRecord {
    name: string;
    fileName: string;
    sizeBytes: number;
    updatedAt: string;
}

export interface SqlListDatabasesResponse {
    databases: SqlDatabaseRecord[];
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

export interface TriviumEdgeView {
    targetId: number;
    label: string;
    weight: number;
}

export interface TriviumNodeView {
    id: number;
    vector: number[];
    payload: unknown;
    edges: TriviumEdgeView[];
    numEdges: number;
}

export interface TriviumSearchHit {
    id: number;
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
}

export interface TriviumQueryRequest extends TriviumOpenOptions {
    cypher: string;
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

export interface TriviumFlushRequest extends TriviumOpenOptions {}

export interface TriviumStatRequest extends TriviumOpenOptions {}

export interface TriviumInsertResponse {
    id: number;
}

export interface TriviumNeighborsResponse {
    ids: number[];
}

export interface TriviumFilterWhereResponse {
    nodes: TriviumNodeView[];
}

export type TriviumQueryRow = Record<string, TriviumNodeView>;

export interface TriviumQueryResponse {
    rows: TriviumQueryRow[];
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
}

export interface TriviumListDatabasesResponse {
    databases: TriviumDatabaseRecord[];
}

export interface TriviumStatResponse extends TriviumDatabaseRecord {
    database: string;
    filePath: string;
    exists: boolean;
    nodeCount: number;
    estimatedMemoryBytes: number;
}

export interface HttpFetchRequest {
    url: string;
    method?: string;
    headers?: Record<string, string>;
    body?: string;
}

export interface HttpFetchResponse {
    url: string;
    hostname: string;
    status: number;
    ok: boolean;
    headers: Record<string, string>;
    body: string;
    bodyEncoding: 'utf8' | 'base64';
    contentType: string;
}

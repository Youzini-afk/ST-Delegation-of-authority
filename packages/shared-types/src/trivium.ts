import type { CursorPageInfo, CursorPageRequest } from './common.js';

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
    forceBruteForce?: boolean;
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

export interface TriviumSearchStageTiming {
    stage: string;
    elapsedMs: number;
}

export interface TriviumSearchContext {
    customData: unknown;
    stageTimings: TriviumSearchStageTiming[];
    aborted: boolean;
}

export interface TriviumSearchHybridWithContextRequest extends TriviumSearchHybridRequest {}

export interface TriviumSearchHybridWithContextResponse {
    hits: TriviumSearchHit[];
    context: TriviumSearchContext;
}

export interface TriviumTqlRequest extends TriviumOpenOptions {
    query: string;
    page?: CursorPageRequest;
}

export interface TriviumTqlMutRequest extends TriviumOpenOptions {
    query: string;
}

export interface TriviumTqlMutResponse {
    affected: number;
    createdIds: number[];
}

export interface TriviumCreateIndexRequest extends TriviumOpenOptions {
    field: string;
}

export interface TriviumDropIndexRequest extends TriviumOpenOptions {
    field: string;
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

export type TriviumTqlRow = Record<string, TriviumNodeView>;

export interface TriviumTqlResponse {
    rows: TriviumTqlRow[];
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
    quiverSizeBytes: number;
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

export interface BmeVectorManifestRequest {
    database?: string;
}

export type BmeVectorManifestStatus = 'missing' | 'clean' | 'dirty' | 'failed' | 'stale' | 'unknown';

export interface BmeVectorManifestResponse {
    database: string;
    exists: boolean;
    status: BmeVectorManifestStatus;
    embeddingMode: 'client' | 'server' | 'unknown';
    serverEmbeddingSupported: boolean;
    vectorApplySupported: boolean;
    vectorManifestSupported: boolean;
    vectorDim: number | null;
    dtype: TriviumDType | null;
    storageMode: TriviumStorageMode | null;
    syncMode: TriviumSyncMode | null;
    mappingCount: number;
    nodeCount: number | null;
    lastFlushAt: string | null;
    updatedAt: string | null;
    vectorSpaceId?: string;
    observedDim?: number | null;
    graphRevision?: number;
    revision?: number;
    backend?: 'authority';
    collectionId?: string;
    chatId?: string;
    modelScope?: string;
}

export interface BmeVectorApplyRequest extends TriviumOpenOptions {
    collectionId?: string;
    chatId?: string;
    namespace?: string;
    graphRevision?: number;
    modelScope?: string;
    items: TriviumBulkUpsertItem[];
    links?: TriviumBulkLinkItem[];
    idempotencyKey?: string;
    vectorSpaceId?: string;
    observedDim?: number;
}

export interface BmeVectorApplyResponse {
    ok: boolean;
    appliedAt: string;
    database: string;
    manifest: BmeVectorManifestResponse;
    upsert: TriviumBulkUpsertResponse;
    links: TriviumBulkMutationResponse;
    skippedLinkCount: number;
}

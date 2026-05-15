import type { AuthorityEffectiveInlineThresholds, AuthorityEffectiveOperationByteLimits } from './common.js';

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
        tql: boolean;
        tqlMut: boolean;
        propertyIndex: boolean;
        searchContext: boolean;
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
    bme: {
        vectorManifest: boolean;
        vectorApply: boolean;
        vectorApplyJobs: boolean;
        serverEmbeddingProbe: boolean;
        candidateSearch: boolean;
        protocolVersion: number;
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
    effectiveInlineThresholdBytes: AuthorityEffectiveInlineThresholds;
    effectiveTransferMaxBytes: AuthorityEffectiveOperationByteLimits;
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

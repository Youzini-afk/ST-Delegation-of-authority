import type {
    ControlExtensionRecord,
    PrivateFileUsageSummary,
    SessionInitResponse,
    SqlDatabaseRecord,
} from '@stdo/shared-types';
import type { AuthorityGrant, AuthorityPolicyEntry, JobRecord, PermissionResource, PermissionStatus } from '@stdo/shared-types';

export type CenterTab = 'overview' | 'detail' | 'databases' | 'activity' | 'policies';
export type AuthorityRiskLevel = 'low' | 'medium' | 'high';

export interface ActivityRecord {
    timestamp: string;
    kind: 'permission' | 'usage' | 'error';
    extensionId: string;
    message: string;
    details?: Record<string, unknown>;
}

export interface ExtensionSummary extends ControlExtensionRecord {
    grantedCount: number;
    deniedCount: number;
    storage: ExtensionStorageSummary;
}

export interface ExtensionStorageSummary {
    kvEntries: number;
    blobCount: number;
    blobBytes: number;
    databaseCount: number;
    databaseBytes: number;
    files: PrivateFileUsageSummary;
}

export interface ProbeResponse {
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
    installStatus: string;
    installMessage: string;
    core: {
        enabled: boolean;
        state: string;
        port: number | null;
        pid: number | null;
        version: string | null;
        startedAt: string | null;
        lastError: string | null;
        health: {
            name: string;
            apiVersion: string;
            version: string;
            pid: number;
            startedAt: string;
            uptimeMs: number;
            requestCount: number;
            errorCount: number;
            activeJobCount: number;
            limits: {
                maxRequestBytes: number;
                maxKvValueBytes: number;
                maxBlobBytes: number;
                maxHttpBodyBytes: number;
                maxHttpResponseBytes: number;
                maxEventPollLimit: number;
            };
        } | null;
    };
}

export interface ExtensionDetailResponse {
    extension: ControlExtensionRecord;
    grants: AuthorityGrant[];
    policies: AuthorityPolicyEntry[];
    activity: {
        permissions: ActivityRecord[];
        usage: ActivityRecord[];
        errors: ActivityRecord[];
    };
    jobs: JobRecord[];
    databases: SqlDatabaseRecord[];
    storage: ExtensionStorageSummary;
}

export interface DatabaseGroupSummary {
    extension: ExtensionSummary;
    databases: SqlDatabaseRecord[];
    totalSizeBytes: number;
    latestUpdatedAt: string | null;
}

export interface PoliciesResponse {
    defaults: Record<PermissionResource, PermissionStatus>;
    extensions: Record<string, Record<string, AuthorityPolicyEntry>>;
    updatedAt: string;
}

export interface SecurityCenterState {
    loading: boolean;
    error: string | null;
    isAdmin: boolean;
    probe: ProbeResponse | null;
    session: SessionInitResponse | null;
    extensions: ExtensionSummary[];
    details: Map<string, ExtensionDetailResponse>;
    selectedExtensionId: string | null;
    selectedTab: CenterTab;
    extensionFilter: string;
    policies: PoliciesResponse | null;
    policyEditorExtensionId: string | null;
}

export interface SecurityCenterOpenOptions {
    focusExtensionId?: string;
}

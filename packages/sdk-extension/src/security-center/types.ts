import type {
    AuthorityLimitsPolicyState,
    AuthorityInstallStatusCode,
    AuthorityProbeResponse,
    ControlExtensionRecord,
    CursorPageInfo,
    PrivateFileUsageSummary,
    SessionInitResponse,
    SqlDatabaseRecord,
    TriviumDatabaseRecord,
} from '@stdo/shared-types';
import type { AuthorityGrant, AuthorityPolicyEntry, JobRecord, PermissionResource, PermissionStatus } from '@stdo/shared-types';

export type CenterTab = 'overview' | 'detail' | 'databases' | 'activity' | 'policies' | 'updates';
export type AuthorityRiskLevel = 'low' | 'medium' | 'high';
export type OverviewSectionKey = 'governance' | 'capabilityMatrix' | 'recentActivity';
export type OverviewSectionState = Record<OverviewSectionKey, boolean>;
export type AdminUpdateAction = 'git-pull' | 'redeploy-sdk';

export interface ActivityRecord {
    timestamp: string;
    kind: 'permission' | 'usage' | 'error' | 'warning';
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
    sqlDatabaseCount: number;
    sqlDatabaseBytes: number;
    triviumDatabaseCount: number;
    triviumDatabaseBytes: number;
    files: PrivateFileUsageSummary;
}

export type ProbeResponse = AuthorityProbeResponse;

export interface InstallSnapshot {
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
}

export interface AdminGitUpdateSummary {
    pluginRoot: string;
    branch: string | null;
    previousRevision: string | null;
    currentRevision: string | null;
    changed: boolean;
    stdout: string | null;
    stderr: string | null;
}

export interface AdminUpdateResponse {
    action: AdminUpdateAction;
    message: string;
    requiresRestart: boolean;
    before: InstallSnapshot;
    after: InstallSnapshot;
    git: AdminGitUpdateSummary | null;
    core: ProbeResponse['core'];
    coreRestarted: boolean;
    coreRestartMessage: string | null;
    updatedAt: string;
}

export interface ExtensionDetailResponse {
    extension: ControlExtensionRecord;
    grants: AuthorityGrant[];
    policies: AuthorityPolicyEntry[];
    activity: {
        permissions: ActivityRecord[];
        usage: ActivityRecord[];
        errors: ActivityRecord[];
        warnings: ActivityRecord[];
        pages: {
            permissions: CursorPageInfo;
            usage: CursorPageInfo;
            errors: CursorPageInfo;
            warnings: CursorPageInfo;
        };
    };
    jobs: JobRecord[];
    jobsPage: CursorPageInfo;
    databases: SqlDatabaseRecord[];
    triviumDatabases: TriviumDatabaseRecord[];
    storage: ExtensionStorageSummary;
}

export interface DatabaseGroupSummary {
    extension: ExtensionSummary;
    databases: SqlDatabaseRecord[];
    triviumDatabases: TriviumDatabaseRecord[];
    databaseCount: number;
    totalSizeBytes: number;
    latestUpdatedAt: string | null;
}

export interface PoliciesResponse {
    defaults: Record<PermissionResource, PermissionStatus>;
    extensions: Record<string, Record<string, AuthorityPolicyEntry>>;
    limits: AuthorityLimitsPolicyState;
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
    overviewSectionState: OverviewSectionState;
    extensionFilter: string;
    policies: PoliciesResponse | null;
    policyEditorExtensionId: string | null;
    updateResult: AdminUpdateResponse | null;
    updateInProgress: boolean;
}

export interface SecurityCenterOpenOptions {
    focusExtensionId?: string;
}

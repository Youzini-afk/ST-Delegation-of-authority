import type {
    AuthorityDiagnosticBundleResponse,
    AuthorityDiagnosticExtensionSnapshot,
    AuthorityExtensionStorageSummary,
    AuthorityLimitsPolicyState,
    AuthorityInstallStatusCode,
    AuthorityProbeResponse,
    ControlExtensionRecord,
    SessionInitResponse,
    AuthorityUsageSummaryResponse,
    SqlDatabaseRecord,
    TriviumDatabaseRecord,
} from '@stdo/shared-types';
import type { AuthorityPolicyEntry, PermissionResource, PermissionStatus } from '@stdo/shared-types';

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

export type ExtensionStorageSummary = AuthorityExtensionStorageSummary;

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

export type ExtensionDetailResponse = AuthorityDiagnosticExtensionSnapshot;
export type UsageSummaryResponse = AuthorityUsageSummaryResponse;
export type DiagnosticBundleResponse = AuthorityDiagnosticBundleResponse;

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

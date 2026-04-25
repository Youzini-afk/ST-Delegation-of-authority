import type {
    AuthorityGrant,
    AuthorityPolicyEntry,
    DeclaredPermissions,
    InstallType,
    JobRecord,
    PermissionDecision,
    PermissionResource,
    PermissionStatus,
    RiskLevel,
    SessionExtensionInfo,
} from '@stdo/shared-types';

export interface RequestUser {
    profile: {
        handle: string;
        admin: boolean;
    };
    directories: {
        root: string;
    };
}

export interface AuthorityRequest {
    user?: RequestUser;
    body?: any;
    params?: Record<string, string>;
    query?: Record<string, string>;
    headers: Record<string, string | string[] | undefined>;
    on?(event: string, listener: () => void): void;
}

export interface AuthorityResponse {
    status(code: number): AuthorityResponse;
    json(data: unknown): void;
    send(data?: unknown): void;
    setHeader(name: string, value: string): void;
    write(chunk: string): void;
    end(chunk?: string): void;
    sendStatus?(code: number): void;
}

export interface ExtensionRegistryEntry extends SessionExtensionInfo {
    lastSeenAt: string;
    declaredPermissions: DeclaredPermissions;
    uiLabel?: string;
}

export interface PoliciesState {
    defaults: Record<PermissionResource, PermissionStatus>;
    extensions: Record<string, Record<string, StoredPolicyEntry>>;
    updatedAt: string;
}

export interface StoredGrantEntry extends AuthorityGrant {
    choice?: PermissionDecision;
}

export interface StoredPolicyEntry extends AuthorityPolicyEntry {}

export interface StoredJobRecord extends JobRecord {
    payload?: Record<string, unknown>;
    result?: Record<string, unknown>;
    channel: string;
}

export interface PermissionDescriptor {
    key: string;
    resource: PermissionResource;
    target: string;
    riskLevel: RiskLevel;
}

export interface SessionGrantState {
    grant: AuthorityGrant;
    remainingUses?: number;
}

export interface SessionRecord {
    token: string;
    createdAt: string;
    userHandle: string;
    isAdmin: boolean;
    extension: SessionExtensionInfo;
    declaredPermissions: DeclaredPermissions;
    sessionGrants: Map<string, SessionGrantState>;
}

export interface UserContext {
    handle: string;
    isAdmin: boolean;
    rootDir: string;
}

export interface ActivityRecord {
    timestamp: string;
    kind: 'permission' | 'usage' | 'error';
    extensionId: string;
    message: string;
    details?: Record<string, unknown>;
}

export interface SessionInitInput {
    extensionId: string;
    displayName: string;
    version: string;
    installType: InstallType;
    declaredPermissions: DeclaredPermissions;
    uiLabel?: string;
}

export type InstallStatusCode = 'ready' | 'installed' | 'updated' | 'conflict' | 'error' | 'missing';
export type CoreRuntimeState = 'stopped' | 'starting' | 'running' | 'missing' | 'error';

export interface AuthorityReleaseMetadata {
    pluginId: string;
    pluginVersion: string;
    sdkExtensionId: string;
    sdkVersion: string;
    assetHash: string;
    coreVersion?: string;
    coreArtifactHash?: string;
    coreArtifactPlatform?: string;
    coreArtifactPlatforms?: string[];
    coreArtifacts?: Record<string, {
        platform: string;
        arch: string;
        binaryName: string;
        binarySha256: string;
        artifactHash: string;
    }>;
    coreBinarySha256?: string;
    buildTime: string;
}

export interface AuthorityManagedMetadata {
    managedBy: string;
    pluginVersion: string;
    sdkVersion: string;
    assetHash: string;
    installedAt: string;
    targetPath: string;
}

export interface AuthorityCoreManagedMetadata {
    managedBy: string;
    version: string;
    platform: string;
    arch: string;
    binaryName: string;
    binarySha256: string;
    builtAt: string;
}

export interface InstallStatusSnapshot {
    installStatus: InstallStatusCode;
    installMessage: string;
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
}

export interface AuthorityCoreHealthSnapshot {
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
}

export interface AuthorityCoreStatus {
    enabled: boolean;
    state: CoreRuntimeState;
    platform: string;
    arch: string;
    binaryPath: string | null;
    port: number | null;
    pid: number | null;
    version: string | null;
    startedAt: string | null;
    lastError: string | null;
    health: AuthorityCoreHealthSnapshot | null;
}

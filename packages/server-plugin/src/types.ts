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

export interface PermissionsFile {
    entries: Record<string, Record<string, StoredGrantEntry>>;
}

export interface PoliciesFile {
    defaults: Record<PermissionResource, PermissionStatus>;
    extensions: Record<string, Record<string, StoredPolicyEntry>>;
    updatedAt: string;
}

export interface ExtensionsFile {
    entries: Record<string, ExtensionRegistryEntry>;
}

export interface JobsFile {
    entries: Record<string, StoredJobRecord>;
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


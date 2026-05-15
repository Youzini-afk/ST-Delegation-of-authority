import type { AuthoritySessionLimits, InstallType } from './common.js';
import type { AuthorityGrant, AuthorityPolicyEntry, DeclaredPermissions } from './permissions.js';
import type { AuthorityFeatureFlags } from './probe.js';

export interface AuthorityInitConfig {
    extensionId: string;
    displayName: string;
    version: string;
    installType: InstallType;
    declaredPermissions: DeclaredPermissions;
    uiLabel?: string;
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
    limits: AuthoritySessionLimits;
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

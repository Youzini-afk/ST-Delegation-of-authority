export type InstallType = 'system' | 'local' | 'global';

export type PermissionResource =
    | 'storage.kv'
    | 'storage.blob'
    | 'sql.private'
    | 'http.fetch'
    | 'jobs.background'
    | 'events.stream';

export type PermissionStatus = 'granted' | 'denied' | 'prompt' | 'blocked';
export type PermissionDecision = 'allow-once' | 'allow-session' | 'allow-always' | 'deny';
export type RiskLevel = 'low' | 'medium' | 'high';
export type GrantScope = 'session' | 'persistent' | 'policy';
export type JobStatus = 'queued' | 'running' | 'completed' | 'failed' | 'cancelled';

export interface DeclaredPermissions {
    storage?: {
        kv?: boolean;
        blob?: boolean;
    };
    sql?: {
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


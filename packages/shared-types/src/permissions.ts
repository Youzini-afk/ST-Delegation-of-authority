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

export interface AuthorityPermissionErrorPayloadDetails {
    resource: PermissionResource;
    target: string;
    key: string;
    riskLevel: RiskLevel;
}

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

export interface PermissionEvaluateBatchRequest {
    requests: PermissionEvaluateRequest[];
}

export interface PermissionEvaluateBatchResponse {
    results: PermissionEvaluateResponse[];
}

export interface PermissionResolveRequest extends PermissionEvaluateRequest {
    choice: PermissionDecision;
}

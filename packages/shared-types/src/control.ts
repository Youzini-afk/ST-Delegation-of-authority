import type { AuthorityLimitsPolicyState, CursorPageInfo, CursorPageRequest } from './common.js';
import type { AuthorityGrant, AuthorityPolicyEntry, PermissionDecision, PermissionResource, PermissionStatus } from './permissions.js';
import type { JobRecord } from './jobs.js';
import type { SessionUserInfo } from './session.js';

export type ControlAuditKind = 'permission' | 'usage' | 'error' | 'warning';

export interface ControlAuditRecord {
    timestamp: string;
    kind: ControlAuditKind;
    extensionId: string;
    message: string;
    details?: Record<string, unknown>;
}

export interface ControlAuditLogRequest {
    userHandle: string;
    record: ControlAuditRecord;
}

export interface ControlAuditRecentRequest {
    userHandle: string;
    extensionId: string;
    limit?: number;
    page?: CursorPageRequest;
}

export interface ControlAuditRecentResponse {
    permissions: ControlAuditRecord[];
    usage: ControlAuditRecord[];
    errors: ControlAuditRecord[];
    warnings: ControlAuditRecord[];
    pages: {
        permissions: CursorPageInfo;
        usage: CursorPageInfo;
        errors: CursorPageInfo;
        warnings: CursorPageInfo;
    };
}

export interface ControlGrantRecord extends AuthorityGrant {
    choice?: PermissionDecision;
}

export interface ControlGrantListRequest {
    userHandle: string;
    extensionId: string;
}

export interface ControlGrantGetRequest {
    userHandle: string;
    extensionId: string;
    key: string;
}

export interface ControlGrantUpsertRequest {
    userHandle: string;
    extensionId: string;
    grant: ControlGrantRecord;
}

export interface ControlGrantResetRequest {
    userHandle: string;
    extensionId: string;
    keys?: string[];
}

export interface ControlGrantListResponse {
    grants: ControlGrantRecord[];
}

export interface ControlGrantResponse {
    grant: ControlGrantRecord | null;
}

export interface ControlPoliciesRequest {
    userHandle: string;
}

export interface ControlPoliciesSaveRequest {
    actor: SessionUserInfo;
    partial: Partial<{
        defaults: Record<PermissionResource, PermissionStatus>;
        extensions: Record<string, Record<string, AuthorityPolicyEntry>>;
        limits: AuthorityLimitsPolicyState;
        updatedAt: string;
    }>;
}

export interface ControlPoliciesResponse {
    defaults: Record<PermissionResource, PermissionStatus>;
    extensions: Record<string, Record<string, AuthorityPolicyEntry>>;
    limits: AuthorityLimitsPolicyState;
    updatedAt: string;
}

export interface ControlJobRecord extends JobRecord {
    payload?: Record<string, unknown>;
    result?: Record<string, unknown>;
    channel: string;
}

export interface ControlJobsListRequest {
    userHandle: string;
    extensionId?: string;
    page?: CursorPageRequest;
}

export interface ControlJobGetRequest {
    userHandle: string;
    jobId: string;
}

export interface ControlJobCreateRequest {
    userHandle: string;
    extensionId: string;
    type: string;
    payload?: Record<string, unknown>;
    timeoutMs?: number;
    idempotencyKey?: string;
    maxAttempts?: number;
}

export interface ControlJobCancelRequest {
    userHandle: string;
    extensionId: string;
    jobId: string;
}

export interface ControlJobRequeueRequest {
    userHandle: string;
    extensionId: string;
    jobId: string;
}

export interface ControlJobUpsertRequest {
    userHandle: string;
    job: ControlJobRecord;
}

export interface ControlJobsListResponse {
    jobs: ControlJobRecord[];
    page: CursorPageInfo;
}

export interface ControlJobResponse {
    job: ControlJobRecord | null;
}

export interface ControlEventRecord {
    id: number;
    timestamp: string;
    extensionId?: string;
    channel: string;
    name: string;
    payload?: unknown;
}

export interface ControlEventsPollRequest {
    userHandle: string;
    channel: string;
    afterId?: number;
    limit?: number;
    page?: CursorPageRequest;
}

export interface ControlEventsPollResponse {
    events: ControlEventRecord[];
    cursor: number;
    page: CursorPageInfo;
}

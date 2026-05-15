import type { AuthorityPermissionErrorPayloadDetails } from './permissions.js';

export type InstallType = 'system' | 'local' | 'global';

export type AuthorityLimitSource = 'runtime' | 'policy';

export type AuthorityErrorCategory = 'permission' | 'auth' | 'session' | 'validation' | 'limit' | 'timeout' | 'core' | 'backpressure';

export type AuthorityErrorCode =
    | 'permission_not_granted'
    | 'permission_denied'
    | 'permission_blocked'
    | 'unauthorized'
    | 'invalid_session'
    | 'session_user_mismatch'
    | 'validation_error'
    | 'limit_exceeded'
    | 'job_queue_full'
    | 'concurrency_limit_exceeded'
    | 'timeout'
    | 'core_unavailable'
    | 'core_request_failed';

export interface AuthorityErrorPayload {
    error: string;
    code?: AuthorityErrorCode;
    category?: AuthorityErrorCategory;
    details?: Record<string, unknown> | AuthorityPermissionErrorPayloadDetails;
}

export type JobStatus = 'queued' | 'running' | 'completed' | 'failed' | 'cancelled';

export type PrivateFileKind = 'file' | 'directory';

export type PrivateFileEncoding = 'utf8' | 'base64';

export type HttpBodyEncoding = 'utf8' | 'base64';

export type DataTransferResource = 'storage.blob' | 'fs.private' | 'http.fetch';

export type AuthorityInlineThresholdKey =
    | 'storageBlobWrite'
    | 'storageBlobRead'
    | 'privateFileWrite'
    | 'privateFileRead'
    | 'httpFetchRequest'
    | 'httpFetchResponse';

export type AuthorityOperationByteOverrides = Partial<Record<AuthorityInlineThresholdKey, number>>;

export type AuthorityInlineThresholdOverrides = AuthorityOperationByteOverrides;

export type AuthorityTransferMaxOverrides = AuthorityOperationByteOverrides;

export interface AuthorityEffectiveBytesLimit {
    bytes: number;
    source: AuthorityLimitSource;
}

export type AuthorityEffectiveOperationByteLimits = Record<AuthorityInlineThresholdKey, AuthorityEffectiveBytesLimit>;

export type AuthorityEffectiveInlineThresholds = AuthorityEffectiveOperationByteLimits;

export interface AuthorityExtensionLimitsPolicy {
    inlineThresholdBytes?: AuthorityInlineThresholdOverrides;
    transferMaxBytes?: AuthorityTransferMaxOverrides;
}

export interface AuthorityLimitsPolicyState {
    extensions: Record<string, AuthorityExtensionLimitsPolicy>;
}

export interface AuthoritySessionLimits {
    effectiveInlineThresholdBytes: AuthorityEffectiveInlineThresholds;
    effectiveTransferMaxBytes: AuthorityEffectiveOperationByteLimits;
}

export interface CursorPageRequest {
    cursor?: string;
    limit?: number;
}

export interface CursorPageInfo {
    nextCursor: string | null;
    limit: number;
    hasMore: boolean;
    totalCount: number;
}

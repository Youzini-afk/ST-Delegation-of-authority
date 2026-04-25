import type { PermissionResource, PermissionStatus, RiskLevel } from '@stdo/shared-types';

export const AUTHORITY_PLUGIN_ID = 'authority';
export const AUTHORITY_DATA_FOLDER = 'extensions-data/authority';
export const AUTHORITY_SDK_EXTENSION_ID = 'third-party/st-authority-sdk';
export const AUTHORITY_MANAGED_FILE = '.authority-managed.json';
export const AUTHORITY_RELEASE_FILE = '.authority-release.json';
export const AUTHORITY_MANAGED_SDK_DIR = 'managed/sdk-extension';
export const AUTHORITY_MANAGED_CORE_DIR = 'managed/core';

export const SESSION_HEADER = 'x-authority-session-token';
export const SESSION_QUERY = 'authoritySessionToken';

export const MAX_KV_VALUE_BYTES = 128 * 1024;
export const MAX_BLOB_BYTES = 2 * 1024 * 1024;
export const MAX_HTTP_BODY_BYTES = 512 * 1024;
export const MAX_HTTP_RESPONSE_BYTES = 2 * 1024 * 1024;
export const MAX_AUDIT_LINES = 200;

export const SUPPORTED_RESOURCES: PermissionResource[] = [
    'storage.kv',
    'storage.blob',
    'sql.private',
    'http.fetch',
    'jobs.background',
    'events.stream',
];

export const RESOURCE_RISK: Record<PermissionResource, RiskLevel> = {
    'storage.kv': 'low',
    'storage.blob': 'low',
    'sql.private': 'medium',
    'http.fetch': 'medium',
    'jobs.background': 'medium',
    'events.stream': 'low',
};

export const DEFAULT_POLICY_STATUS: Record<PermissionResource, PermissionStatus> = {
    'storage.kv': 'prompt',
    'storage.blob': 'prompt',
    'sql.private': 'prompt',
    'http.fetch': 'prompt',
    'jobs.background': 'prompt',
    'events.stream': 'prompt',
};

export const BUILTIN_JOB_TYPES = ['delay'] as const;

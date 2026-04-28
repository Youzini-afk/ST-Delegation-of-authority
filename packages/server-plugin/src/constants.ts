import type { AuthorityFeatureFlags, AuthorityJobRegistrySummary, PermissionResource, PermissionStatus, RiskLevel } from '@stdo/shared-types';

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
export const MAX_BLOB_BYTES = 16 * 1024 * 1024;
export const MAX_AUDIT_LINES = 200;
export const DATA_TRANSFER_CHUNK_BYTES = 256 * 1024;
export const DATA_TRANSFER_INLINE_THRESHOLD_BYTES = 256 * 1024;
export const UNMANAGED_TRANSFER_MAX_BYTES = Number.MAX_SAFE_INTEGER;

export const SUPPORTED_RESOURCES: PermissionResource[] = [
    'storage.kv',
    'storage.blob',
    'fs.private',
    'sql.private',
    'trivium.private',
    'http.fetch',
    'jobs.background',
    'events.stream',
];

export const RESOURCE_RISK: Record<PermissionResource, RiskLevel> = {
    'storage.kv': 'low',
    'storage.blob': 'low',
    'fs.private': 'medium',
    'sql.private': 'medium',
    'trivium.private': 'high',
    'http.fetch': 'medium',
    'jobs.background': 'medium',
    'events.stream': 'low',
};

export const DEFAULT_POLICY_STATUS: Record<PermissionResource, PermissionStatus> = {
    'storage.kv': 'granted',
    'storage.blob': 'granted',
    'fs.private': 'granted',
    'sql.private': 'granted',
    'trivium.private': 'granted',
    'http.fetch': 'granted',
    'jobs.background': 'granted',
    'events.stream': 'granted',
};

export const BUILTIN_JOB_TYPES = ['delay', 'sql.backup', 'trivium.flush', 'fs.import-jsonl'] as const;

export const BUILTIN_JOB_REGISTRY_SUMMARY: AuthorityJobRegistrySummary = {
    registered: BUILTIN_JOB_TYPES.length,
    jobTypes: [...BUILTIN_JOB_TYPES],
    entries: [
        {
            type: 'delay',
            description: 'Waits for a duration and emits progress updates until completion.',
            defaultTimeoutMs: null,
            defaultMaxAttempts: 1,
            cancellable: true,
            payloadFields: [
                { name: 'durationMs', type: 'number', required: false, description: 'Delay duration in milliseconds. Defaults to 3000.' },
                { name: 'message', type: 'string', required: false, description: 'Completion message. Defaults to "Delay completed".' },
                { name: 'failAttempts', type: 'number', required: false, description: 'Testing hook that forces the first N attempts to fail.' },
            ],
            progressFields: [
                { name: 'progress', type: 'number', required: true, description: 'Percent complete from 0 to 100.' },
                { name: 'summary', type: 'string', required: false, description: 'Human-readable progress summary.' },
                { name: 'result.elapsedMs', type: 'number', required: false, description: 'Elapsed duration reported on completion.' },
                { name: 'result.message', type: 'string', required: false, description: 'Completion message reported on success.' },
            ],
        },
        {
            type: 'sql.backup',
            description: 'Copies a private SQL database into the managed __backup__ folder.',
            defaultTimeoutMs: null,
            defaultMaxAttempts: 1,
            cancellable: true,
            payloadFields: [
                { name: 'database', type: 'string', required: false, description: 'Private SQL database name. Defaults to "default".' },
                { name: 'targetName', type: 'string', required: false, description: 'Optional backup filename. Defaults to a timestamped sqlite filename.' },
            ],
            progressFields: [
                { name: 'summary', type: 'string', required: false, description: 'Current backup stage.' },
                { name: 'result.database', type: 'string', required: false, description: 'Database name that was backed up.' },
                { name: 'result.backupPath', type: 'string', required: false, description: 'Filesystem path to the generated backup file.' },
                { name: 'result.sizeBytes', type: 'number', required: false, description: 'Backup file size in bytes.' },
            ],
        },
        {
            type: 'trivium.flush',
            description: 'Flushes a private Trivium database to durable storage.',
            defaultTimeoutMs: null,
            defaultMaxAttempts: 1,
            cancellable: true,
            payloadFields: [
                { name: 'database', type: 'string', required: false, description: 'Private Trivium database name. Defaults to "default".' },
            ],
            progressFields: [
                { name: 'summary', type: 'string', required: false, description: 'Current flush stage.' },
                { name: 'result.database', type: 'string', required: false, description: 'Database name that was flushed.' },
            ],
        },
        {
            type: 'fs.import-jsonl',
            description: 'Imports a JSONL blob into the private filesystem after validating each line.',
            defaultTimeoutMs: null,
            defaultMaxAttempts: 1,
            cancellable: true,
            payloadFields: [
                { name: 'blobId', type: 'string', required: true, description: 'Source blob containing UTF-8 JSONL content.' },
                { name: 'targetPath', type: 'string', required: true, description: 'Destination private file path for the imported JSONL file.' },
            ],
            progressFields: [
                { name: 'summary', type: 'string', required: false, description: 'Current import stage.' },
                { name: 'result.blobId', type: 'string', required: false, description: 'Imported source blob id.' },
                { name: 'result.targetPath', type: 'string', required: false, description: 'Written private file path.' },
                { name: 'result.lineCount', type: 'number', required: false, description: 'Number of JSONL records imported.' },
                { name: 'result.entry', type: 'object', required: false, description: 'Private file entry metadata for the imported file.' },
            ],
        },
    ],
};

export function buildAuthorityFeatureFlags(isAdmin: boolean): AuthorityFeatureFlags {
    return {
        securityCenter: true,
        admin: isAdmin,
        sql: {
            queryPage: true,
            stat: true,
            migrations: true,
            schemaManifest: true,
        },
        trivium: {
            resolveId: true,
            resolveMany: true,
            upsert: true,
            bulkMutations: true,
            tql: true,
            tqlMut: true,
            propertyIndex: true,
            searchContext: true,
            mappingPages: true,
            mappingIntegrity: true,
        },
        transfers: {
            blob: true,
            fs: true,
            httpFetch: true,
        },
        jobs: {
            background: true,
            safeRequeue: true,
            builtinTypes: [...BUILTIN_JOB_TYPES],
        },
        diagnostics: {
            warnings: true,
            activityPages: true,
            jobsPage: true,
            benchmarkCore: true,
        },
    };
}

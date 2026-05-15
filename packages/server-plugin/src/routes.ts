import fs from 'node:fs';
import path from 'node:path';
import type {
    AuthorityArtifactDownloadResponse,
    AuthorityErrorPayload,
    AuthorityDiagnosticBundleResponse,
    AuthorityDiagnosticExtensionSnapshot,
    AuthorityExportPackageRequest,
    AuthorityExtensionStorageSummary,
    AuthorityProbeResponse,
    AuthorityInitConfig,
    NativeMigrationApplyRequest,
    NativeMigrationOperationListResponse,
    NativeMigrationPreviewRequest,
    AuthorityPackageImportRequest,
    AuthorityPackageOperationListResponse,
    AuthorityUsageSummaryExtension,
    AuthorityUsageSummaryResponse,
    AuthorityUsageSummaryTotals,
    BlobRecord,
    ControlExtensionRecord,
    PermissionEvaluateBatchRequest,
    PermissionEvaluateBatchResponse,
    PermissionEvaluateRequest,
    PermissionResource,
    PermissionResolveRequest,
    SqlDatabaseRecord,
    SqlListDatabasesResponse,
    TriviumDatabaseRecord,
    TriviumListDatabasesResponse,
} from '@stdo/shared-types';
import {
    AUTHORITY_DATA_FOLDER,
    AUTHORITY_PLUGIN_ID,
    AUTHORITY_RELEASE_FILE,
    AUTHORITY_SDK_EXTENSION_ID,
    BUILTIN_JOB_REGISTRY_SUMMARY,
    BUILTIN_JOB_TYPES,
    DATA_TRANSFER_INLINE_THRESHOLD_BYTES,
    DATA_TRANSFER_CHUNK_BYTES,
    MAX_BLOB_BYTES,
    MAX_KV_VALUE_BYTES,
    NATIVE_MIGRATION_MAX_COMPRESSED_BYTES,
    NATIVE_MIGRATION_TRANSFER_CHUNK_BYTES,
    UNMANAGED_TRANSFER_MAX_BYTES,
    buildAuthorityFeatureFlags,
} from './constants.js';
import { registerBmeRoutes } from './routes/bme-routes.js';
import { registerStManagerRoutes } from './routes/st-manager-routes.js';
import { registerStorageRoutes } from './routes/storage-routes.js';
import { registerJobsAndEventsRoutes } from './routes/jobs-events-routes.js';
import { listPrivateTriviumDatabases, registerTriviumRoutes } from './routes/trivium-routes.js';
import { listPrivateSqlDatabases, registerSqlRoutes } from './routes/sql-routes.js';
import { registerHttpRoutes } from './routes/http-routes.js';
import { createAuthorityRuntime, type AuthorityRuntime } from './runtime.js';
import type { AdminUpdateAction, AdminUpdateResponse, AuthorityRequest, AuthorityResponse } from './types.js';
import { asErrorMessage, AuthorityServiceError, buildPermissionDescriptor, getSessionToken, getUserContext, isAuthorityServiceError } from './utils.js';

type RouterLike = {
    get(path: string, handler: (req: AuthorityRequest, res: AuthorityResponse) => void | Promise<void>): void;
    post(path: string, handler: (req: AuthorityRequest, res: AuthorityResponse) => void | Promise<void>): void;
};

const ADMIN_PACKAGE_MAX_BYTES = 256 * 1024 * 1024;

function ok(res: AuthorityResponse, data: unknown): void {
    res.json(data);
}

interface NormalizedAuthorityError {
    status: number;
    payload: AuthorityErrorPayload;
}

function fail(runtime: AuthorityRuntime, req: AuthorityRequest, res: AuthorityResponse, extensionId: string, error: unknown): void {
    const normalized = normalizeAuthorityError(error);
    try {
        const user = getUserContext(req);
        if (normalized.payload.category === 'permission' && isPermissionErrorDetails(normalized.payload.details)) {
            void runtime.audit.logPermission(user, extensionId, 'Permission denied', {
                ...normalized.payload.details,
                message: normalized.payload.error,
            }).catch(() => undefined);
        } else {
            void runtime.audit.logError(user, extensionId, normalized.payload.error).catch(() => undefined);
        }
    } catch {
    }
    res.status(normalized.status).json(normalized.payload);
}

function buildPermissionErrorPayload(message: string): AuthorityErrorPayload | null {
    const match = /^Permission not granted: ([a-z.]+)(?: for (.+))?$/.exec(message);
    if (!match) {
        return null;
    }

    const resource = match[1]?.trim();
    if (!resource || !isPermissionResource(resource)) {
        return null;
    }

    const target = match[2]?.trim();
    const descriptor = buildPermissionDescriptor(resource, target);
    return {
        error: message,
        code: 'permission_not_granted',
        category: 'permission',
        details: {
            resource: descriptor.resource,
            target: descriptor.target,
            key: descriptor.key,
            riskLevel: descriptor.riskLevel,
        },
    };
}

function isPermissionResource(value: string): value is PermissionResource {
    return value === 'storage.kv'
        || value === 'storage.blob'
        || value === 'fs.private'
        || value === 'sql.private'
        || value === 'trivium.private'
        || value === 'http.fetch'
        || value === 'jobs.background'
        || value === 'events.stream';
}

function isPermissionErrorDetails(value: AuthorityErrorPayload['details']): value is NonNullable<AuthorityErrorPayload['details']> & {
    resource: PermissionResource;
    target: string;
    key: string;
    riskLevel: string;
} {
    return typeof value === 'object'
        && value !== null
        && 'resource' in value
        && 'target' in value
        && 'key' in value
        && 'riskLevel' in value;
}

function normalizeAuthorityError(error: unknown): NormalizedAuthorityError {
    if (isAuthorityServiceError(error)) {
        return {
            status: error.status,
            payload: error.toPayload(),
        };
    }

    const message = asErrorMessage(error);
    const permissionErrorPayload = buildPermissionErrorPayload(message);
    if (permissionErrorPayload) {
        return {
            status: 403,
            payload: permissionErrorPayload,
        };
    }

    if (message === 'Unauthorized') {
        return {
            status: 401,
            payload: {
                error: message,
                code: 'unauthorized',
                category: 'auth',
            },
        };
    }

    if (message === 'Invalid authority session') {
        return {
            status: 401,
            payload: {
                error: message,
                code: 'invalid_session',
                category: 'session',
            },
        };
    }

    if (message === 'Authority session does not belong to current user') {
        return {
            status: 403,
            payload: {
                error: message,
                code: 'session_user_mismatch',
                category: 'session',
            },
        };
    }

    if (/timed?\s*out|timeout/i.test(message)) {
        return {
            status: 504,
            payload: {
                error: message,
                code: 'timeout',
                category: 'timeout',
            },
        };
    }

    if (/exceeds|too large|queue_full|max(?:imum)?|too many/i.test(message)) {
        return {
            status: 413,
            payload: {
                error: message,
                code: 'limit_exceeded',
                category: 'limit',
            },
        };
    }

    if (/must\b|required\b|invalid\b|unsupported\b|not[_ ]found\b|is not\b|cannot both be provided|mismatch|symlink is not allowed/i.test(message)) {
        return {
            status: 400,
            payload: {
                error: message,
                code: 'validation_error',
                category: 'validation',
            },
        };
    }

    return {
        status: 500,
        payload: {
            error: message,
            code: 'core_request_failed',
            category: 'core',
        },
    };
}

function buildEffectiveInlineThresholds() {
    return {
        storageBlobWrite: { bytes: DATA_TRANSFER_INLINE_THRESHOLD_BYTES, source: 'runtime' as const },
        storageBlobRead: { bytes: DATA_TRANSFER_INLINE_THRESHOLD_BYTES, source: 'runtime' as const },
        privateFileWrite: { bytes: DATA_TRANSFER_INLINE_THRESHOLD_BYTES, source: 'runtime' as const },
        privateFileRead: { bytes: DATA_TRANSFER_INLINE_THRESHOLD_BYTES, source: 'runtime' as const },
        httpFetchRequest: { bytes: DATA_TRANSFER_INLINE_THRESHOLD_BYTES, source: 'runtime' as const },
        httpFetchResponse: { bytes: DATA_TRANSFER_INLINE_THRESHOLD_BYTES, source: 'runtime' as const },
    };
}

function buildEffectiveTransferMaxBytes() {
    return {
        storageBlobWrite: { bytes: UNMANAGED_TRANSFER_MAX_BYTES, source: 'runtime' as const },
        storageBlobRead: { bytes: UNMANAGED_TRANSFER_MAX_BYTES, source: 'runtime' as const },
        privateFileWrite: { bytes: UNMANAGED_TRANSFER_MAX_BYTES, source: 'runtime' as const },
        privateFileRead: { bytes: UNMANAGED_TRANSFER_MAX_BYTES, source: 'runtime' as const },
        httpFetchRequest: { bytes: UNMANAGED_TRANSFER_MAX_BYTES, source: 'runtime' as const },
        httpFetchResponse: { bytes: UNMANAGED_TRANSFER_MAX_BYTES, source: 'runtime' as const },
    };
}

function parseAdminUpdateAction(value: unknown): AdminUpdateAction {
    return value === 'redeploy-sdk' ? 'redeploy-sdk' : 'git-pull';
}

function summarizeBlobRecords(records: BlobRecord[]): { count: number; totalSizeBytes: number } {
    return {
        count: records.length,
        totalSizeBytes: records.reduce((sum, record) => sum + record.size, 0),
    };
}

function summarizeDatabases(databases: SqlListDatabasesResponse['databases']): { count: number; totalSizeBytes: number } {
    return {
        count: databases.length,
        totalSizeBytes: databases.reduce((sum, record) => sum + record.sizeBytes, 0),
    };
}

function summarizeTriviumDatabases(databases: TriviumListDatabasesResponse['databases']): { count: number; totalSizeBytes: number } {
    return {
        count: databases.length,
        totalSizeBytes: databases.reduce((sum, record) => sum + record.totalSizeBytes, 0),
    };
}

async function buildExtensionStorageSummary(
    runtime: AuthorityRuntime,
    user: ReturnType<typeof getUserContext>,
    extensionId: string,
    sqlDatabases?: SqlDatabaseRecord[],
    triviumDatabases?: TriviumDatabaseRecord[],
): Promise<AuthorityExtensionStorageSummary> {
    const [kvEntries, blobs, files] = await Promise.all([
        runtime.storage.listKv(user, extensionId),
        runtime.storage.listBlobs(user, extensionId),
        runtime.files.getUsageSummary(user, extensionId),
    ]);
    const resolvedSqlDatabases = sqlDatabases ?? (await listPrivateSqlDatabases(runtime, user, extensionId)).databases;
    const resolvedTriviumDatabases = triviumDatabases ?? (await listPrivateTriviumDatabases(runtime, user, extensionId)).databases;
    const blobSummary = summarizeBlobRecords(blobs);
    const sqlDatabaseSummary = summarizeDatabases(resolvedSqlDatabases);
    const triviumDatabaseSummary = summarizeTriviumDatabases(resolvedTriviumDatabases);

    return {
        kvEntries: Object.keys(kvEntries).length,
        blobCount: blobSummary.count,
        blobBytes: blobSummary.totalSizeBytes,
        databaseCount: sqlDatabaseSummary.count + triviumDatabaseSummary.count,
        databaseBytes: sqlDatabaseSummary.totalSizeBytes + triviumDatabaseSummary.totalSizeBytes,
        sqlDatabaseCount: sqlDatabaseSummary.count,
        sqlDatabaseBytes: sqlDatabaseSummary.totalSizeBytes,
        triviumDatabaseCount: triviumDatabaseSummary.count,
        triviumDatabaseBytes: triviumDatabaseSummary.totalSizeBytes,
        files,
    };
}

async function buildProbeResponse(runtime: AuthorityRuntime, user: ReturnType<typeof getUserContext>): Promise<AuthorityProbeResponse> {
    await runtime.core.refreshHealth();
    const install = runtime.install.getStatus();
    const core = runtime.core.getStatus();
    const features = buildAuthorityFeatureFlags(user.isAdmin);
    const effectiveInlineThresholdBytes = buildEffectiveInlineThresholds();
    const effectiveTransferMaxBytes = buildEffectiveTransferMaxBytes();
    return {
        id: 'authority',
        online: true,
        version: install.pluginVersion,
        pluginId: AUTHORITY_PLUGIN_ID,
        sdkExtensionId: AUTHORITY_SDK_EXTENSION_ID,
        pluginVersion: install.pluginVersion,
        sdkBundledVersion: install.sdkBundledVersion,
        sdkDeployedVersion: install.sdkDeployedVersion,
        coreBundledVersion: install.coreBundledVersion,
        coreArtifactPlatform: install.coreArtifactPlatform,
        coreArtifactPlatforms: install.coreArtifactPlatforms,
        coreArtifactHash: install.coreArtifactHash,
        coreBinarySha256: install.coreBinarySha256,
        coreVerified: install.coreVerified,
        coreMessage: install.coreMessage,
        installStatus: install.installStatus,
        installMessage: install.installMessage,
        storageRoot: path.join(user.rootDir, AUTHORITY_DATA_FOLDER, 'storage'),
        features,
        limits: {
            maxRequestBytes: core.health?.limits.maxRequestBytes ?? null,
            maxKvValueBytes: MAX_KV_VALUE_BYTES,
            maxBlobBytes: MAX_BLOB_BYTES,
            maxHttpBodyBytes: core.health?.limits.maxHttpBodyBytes ?? MAX_BLOB_BYTES,
            maxHttpResponseBytes: core.health?.limits.maxHttpResponseBytes ?? MAX_BLOB_BYTES,
            maxEventPollLimit: core.health?.limits.maxEventPollLimit ?? null,
            maxDataTransferBytes: UNMANAGED_TRANSFER_MAX_BYTES,
            dataTransferChunkBytes: DATA_TRANSFER_CHUNK_BYTES,
            dataTransferInlineThresholdBytes: DATA_TRANSFER_INLINE_THRESHOLD_BYTES,
            effectiveInlineThresholdBytes,
            effectiveTransferMaxBytes,
        },
        jobs: {
            builtinTypes: [...BUILTIN_JOB_TYPES],
            registry: core.health?.jobRegistrySummary ?? BUILTIN_JOB_REGISTRY_SUMMARY,
        },
        core,
    };
}

async function buildUsageSummaryExtension(
    runtime: AuthorityRuntime,
    user: ReturnType<typeof getUserContext>,
    extension: ControlExtensionRecord,
    sqlDatabases?: SqlDatabaseRecord[],
    triviumDatabases?: TriviumDatabaseRecord[],
): Promise<AuthorityUsageSummaryExtension> {
    const grants = await runtime.permissions.listPersistentGrants(user, extension.id);
    return {
        extension,
        grantedCount: grants.filter(grant => grant.status === 'granted').length,
        deniedCount: grants.filter(grant => grant.status === 'denied').length,
        storage: await buildExtensionStorageSummary(runtime, user, extension.id, sqlDatabases, triviumDatabases),
    };
}

function buildUsageSummaryTotals(extensions: AuthorityUsageSummaryExtension[]): AuthorityUsageSummaryTotals {
    const initialTotals: AuthorityUsageSummaryTotals = {
        extensionCount: 0,
        kvEntries: 0,
        blobCount: 0,
        blobBytes: 0,
        databaseCount: 0,
        databaseBytes: 0,
        sqlDatabaseCount: 0,
        sqlDatabaseBytes: 0,
        triviumDatabaseCount: 0,
        triviumDatabaseBytes: 0,
        files: {
            fileCount: 0,
            directoryCount: 0,
            totalSizeBytes: 0,
            latestUpdatedAt: null,
        },
    };

    return extensions.reduce<AuthorityUsageSummaryTotals>((totals, entry) => ({
        extensionCount: totals.extensionCount + 1,
        kvEntries: totals.kvEntries + entry.storage.kvEntries,
        blobCount: totals.blobCount + entry.storage.blobCount,
        blobBytes: totals.blobBytes + entry.storage.blobBytes,
        databaseCount: totals.databaseCount + entry.storage.databaseCount,
        databaseBytes: totals.databaseBytes + entry.storage.databaseBytes,
        sqlDatabaseCount: totals.sqlDatabaseCount + entry.storage.sqlDatabaseCount,
        sqlDatabaseBytes: totals.sqlDatabaseBytes + entry.storage.sqlDatabaseBytes,
        triviumDatabaseCount: totals.triviumDatabaseCount + entry.storage.triviumDatabaseCount,
        triviumDatabaseBytes: totals.triviumDatabaseBytes + entry.storage.triviumDatabaseBytes,
        files: {
            fileCount: totals.files.fileCount + entry.storage.files.fileCount,
            directoryCount: totals.files.directoryCount + entry.storage.files.directoryCount,
            totalSizeBytes: totals.files.totalSizeBytes + entry.storage.files.totalSizeBytes,
            latestUpdatedAt: pickLatestIsoTimestamp(totals.files.latestUpdatedAt, entry.storage.files.latestUpdatedAt),
        },
    }), initialTotals);
}

function pickLatestIsoTimestamp(left: string | null, right: string | null): string | null {
    if (!left) {
        return right;
    }
    if (!right) {
        return left;
    }
    return left >= right ? left : right;
}

async function buildUsageSummary(runtime: AuthorityRuntime, user: ReturnType<typeof getUserContext>): Promise<AuthorityUsageSummaryResponse> {
    const extensions = await runtime.extensions.listExtensions(user);
    const summaries = await Promise.all(extensions.map(async extension => {
        const sqlDatabases = (await listPrivateSqlDatabases(runtime, user, extension.id)).databases;
        const triviumDatabases = (await listPrivateTriviumDatabases(runtime, user, extension.id)).databases;
        return await buildUsageSummaryExtension(runtime, user, extension, sqlDatabases, triviumDatabases);
    }));
    return {
        generatedAt: new Date().toISOString(),
        totals: buildUsageSummaryTotals(summaries),
        extensions: summaries,
    };
}

async function buildExtensionDiagnosticSnapshot(
    runtime: AuthorityRuntime,
    user: ReturnType<typeof getUserContext>,
    extensionId: string,
    extension?: ControlExtensionRecord,
): Promise<AuthorityDiagnosticExtensionSnapshot> {
    const resolvedExtension = extension ?? await runtime.extensions.getExtension(user, extensionId);
    if (!resolvedExtension) {
        throw new Error('Extension not found');
    }

    const databases = (await listPrivateSqlDatabases(runtime, user, extensionId)).databases;
    const triviumDatabases = (await listPrivateTriviumDatabases(runtime, user, extensionId)).databases;
    const activity = await runtime.audit.getRecentActivityPage(user, extensionId);
    const jobsPage = await runtime.jobs.listPage(user, extensionId);

    return {
        extension: resolvedExtension,
        grants: await runtime.permissions.listPersistentGrants(user, extensionId),
        policies: await runtime.permissions.getPolicyEntries(user, extensionId),
        activity,
        jobs: jobsPage.jobs,
        jobsPage: jobsPage.page,
        databases,
        triviumDatabases,
        storage: await buildExtensionStorageSummary(runtime, user, extensionId, databases, triviumDatabases),
    };
}

async function buildDiagnosticBundle(runtime: AuthorityRuntime, user: ReturnType<typeof getUserContext>): Promise<AuthorityDiagnosticBundleResponse> {
    const [probe, policies, usageSummary, jobs] = await Promise.all([
        buildProbeResponse(runtime, user),
        runtime.policies.getPolicies(user),
        buildUsageSummary(runtime, user),
        runtime.jobs.listPage(user),
    ]);

    const extensions = await Promise.all(usageSummary.extensions.map(async entry => await buildExtensionDiagnosticSnapshot(
        runtime,
        user,
        entry.extension.id,
        entry.extension,
    )));

    return sanitizeDiagnosticPayload({
        generatedAt: new Date().toISOString(),
        probe,
        policies,
        usageSummary,
        jobs,
        releaseMetadata: readReleaseMetadataSnapshot(runtime),
        extensions,
    });
}

function readReleaseMetadataSnapshot(runtime: AuthorityRuntime): Record<string, unknown> | null {
    const filePath = path.join(runtime.install.getPluginRoot(), AUTHORITY_RELEASE_FILE);
    if (!fs.existsSync(filePath)) {
        return null;
    }

    try {
        const parsed = JSON.parse(fs.readFileSync(filePath, 'utf8'));
        return parsed && typeof parsed === 'object' ? parsed as Record<string, unknown> : null;
    } catch {
        return null;
    }
}

function sanitizeDiagnosticPayload<T>(value: T): T {
    return sanitizeDiagnosticValue(undefined, value) as T;
}

function assertAdminUser(user: ReturnType<typeof getUserContext>): void {
    if (!user.isAdmin) {
        throw new Error('Forbidden');
    }
}

function parseAdminPackageSizeBytes(value: unknown): number {
    const sizeBytes = Number(value ?? 0);
    if (!Number.isFinite(sizeBytes) || sizeBytes <= 0) {
        throw new Error('sizeBytes must be a positive number');
    }
    if (sizeBytes > ADMIN_PACKAGE_MAX_BYTES) {
        throw new Error(`Admin package upload exceeds ${ADMIN_PACKAGE_MAX_BYTES} bytes`);
    }
    return Math.floor(sizeBytes);
}

function parseNativeMigrationSizeBytes(value: unknown): number {
    const sizeBytes = Number(value ?? 0);
    if (!Number.isFinite(sizeBytes) || sizeBytes <= 0) {
        throw new Error('sizeBytes must be a positive number');
    }
    if (sizeBytes > NATIVE_MIGRATION_MAX_COMPRESSED_BYTES) {
        throw new Error(`Native migration upload exceeds ${NATIVE_MIGRATION_MAX_COMPRESSED_BYTES} bytes`);
    }
    return Math.floor(sizeBytes);
}

async function openAdminArtifactDownload(
    runtime: AuthorityRuntime,
    user: ReturnType<typeof getUserContext>,
    filePath: string,
    sizeBytes: number,
    artifact: AuthorityArtifactDownloadResponse['artifact'],
): Promise<AuthorityArtifactDownloadResponse> {
    return {
        artifact,
        transfer: await runtime.transfers.openRead(user, AUTHORITY_SDK_EXTENSION_ID, {
            resource: 'fs.private',
            purpose: 'privateFileRead',
            sourcePath: filePath,
        }, Math.max(1, sizeBytes)),
    };
}

function sanitizeDiagnosticValue(key: string | undefined, value: unknown): unknown {
    if (typeof value === 'string') {
        return shouldRedactDiagnosticKey(key) ? '<redacted>' : value;
    }
    if (Array.isArray(value)) {
        return value.map(item => sanitizeDiagnosticValue(undefined, item));
    }
    if (!value || typeof value !== 'object') {
        return value;
    }
    return Object.fromEntries(Object.entries(value as Record<string, unknown>).map(([entryKey, entryValue]) => [
        entryKey,
        sanitizeDiagnosticValue(entryKey, entryValue),
    ]));
}

function shouldRedactDiagnosticKey(key: string | undefined): boolean {
    const normalized = key?.toLowerCase() ?? '';
    return normalized.includes('path')
        || normalized.includes('root')
        || normalized.includes('token')
        || normalized.includes('secret');
}

export function registerRoutes(router: RouterLike, runtime = createAuthorityRuntime()): AuthorityRuntime {

    router.post('/probe', async (req, res) => {
        const user = getUserContext(req);
        ok(res, await buildProbeResponse(runtime, user));
    });

    registerStManagerRoutes(router, runtime, fail);
    registerBmeRoutes(router, runtime, fail);

    router.post('/session/init', async (req, res) => {
        try {
            const user = getUserContext(req);
            const config = (req.body ?? {}) as AuthorityInitConfig;
            const session = await runtime.sessions.createSession(user, config);
            const grants = await runtime.permissions.listPersistentGrants(user, session.extension.id);
            const policies = await runtime.permissions.getPolicyEntries(user, session.extension.id);
            const limits = await runtime.permissions.getEffectiveSessionLimits(user, session.extension.id);
            await runtime.audit.logUsage(user, session.extension.id, 'Session initialized');
            ok(res, runtime.sessions.buildSessionResponse(session, grants, policies, limits));
        } catch (error) {
            fail(runtime, req, res, 'third-party/st-authority-sdk', error);
        }
    });

    router.get('/session/current', async (req, res) => {
        try {
            const user = getUserContext(req);
            const session = await runtime.sessions.assertSession(getSessionToken(req), user);
            const limits = await runtime.permissions.getEffectiveSessionLimits(user, session.extension.id);
            ok(res, runtime.sessions.buildSessionResponse(
                session,
                await runtime.permissions.listPersistentGrants(user, session.extension.id),
                await runtime.permissions.getPolicyEntries(user, session.extension.id),
                limits,
            ));
        } catch (error) {
            fail(runtime, req, res, 'third-party/st-authority-sdk', error);
        }
    });

    router.post('/permissions/evaluate', async (req, res) => {
        try {
            const user = getUserContext(req);
            const session = await runtime.sessions.assertSession(getSessionToken(req), user);
            const evaluation = await runtime.permissions.evaluate(user, session, req.body as PermissionEvaluateRequest);
            if (evaluation.decision === 'denied' || evaluation.decision === 'blocked') {
                await runtime.audit.logPermission(user, session.extension.id, 'Permission denied', {
                    key: evaluation.key,
                    resource: evaluation.resource,
                    target: evaluation.target,
                    decision: evaluation.decision,
                });
            }
            ok(res, evaluation);
        } catch (error) {
            fail(runtime, req, res, 'third-party/st-authority-sdk', error);
        }
    });

    router.post('/permissions/evaluate-batch', async (req, res) => {
        try {
            const user = getUserContext(req);
            const session = await runtime.sessions.assertSession(getSessionToken(req), user);
            const payload = (req.body ?? {}) as PermissionEvaluateBatchRequest;
            if (payload.requests !== undefined && !Array.isArray(payload.requests)) {
                throw new AuthorityServiceError('Permission batch requests must be an array', 400, 'validation_error', 'validation');
            }
            const results = await runtime.permissions.evaluateBatch(user, session, payload.requests ?? []);
            const response: PermissionEvaluateBatchResponse = { results };
            ok(res, response);
        } catch (error) {
            fail(runtime, req, res, 'third-party/st-authority-sdk', error);
        }
    });

    router.post('/permissions/resolve', async (req, res) => {
        try {
            const user = getUserContext(req);
            const session = await runtime.sessions.assertSession(getSessionToken(req), user);
            const payload = req.body as PermissionResolveRequest;
            const grant = await runtime.permissions.resolve(user, session, payload, payload.choice);
            await runtime.audit.logPermission(user, session.extension.id, grant.status === 'denied' ? 'Permission denied' : 'Permission granted', {
                key: grant.key,
                status: grant.status,
                scope: grant.scope,
                choice: payload.choice,
            });
            ok(res, grant);
        } catch (error) {
            fail(runtime, req, res, 'third-party/st-authority-sdk', error);
        }
    });

    router.get('/extensions', async (req, res) => {
        try {
            const user = getUserContext(req);
            const list = await Promise.all((await runtime.extensions.listExtensions(user)).map(async extension => {
                const grants = await runtime.permissions.listPersistentGrants(user, extension.id);
                const sqlDatabases = (await listPrivateSqlDatabases(runtime, user, extension.id)).databases;
                const triviumDatabases = (await listPrivateTriviumDatabases(runtime, user, extension.id)).databases;
                return {
                    ...extension,
                    grantedCount: grants.filter(grant => grant.status === 'granted').length,
                    deniedCount: grants.filter(grant => grant.status === 'denied').length,
                    storage: await buildExtensionStorageSummary(runtime, user, extension.id, sqlDatabases, triviumDatabases),
                };
            }));
            ok(res, list);
        } catch (error) {
            fail(runtime, req, res, 'third-party/st-authority-sdk', error);
        }
    });

    router.get('/extensions/:id', async (req, res) => {
        try {
            const user = getUserContext(req);
            const extensionId = decodeURIComponent(req.params?.id ?? '');
            const extension = await runtime.extensions.getExtension(user, extensionId);
            if (!extension) {
                throw new Error('Extension not found');
            }

            const databases = (await listPrivateSqlDatabases(runtime, user, extensionId)).databases;
            const triviumDatabases = (await listPrivateTriviumDatabases(runtime, user, extensionId)).databases;
            const activity = await runtime.audit.getRecentActivityPage(user, extensionId);
            const jobsPage = await runtime.jobs.listPage(user, extensionId);

            ok(res, {
                extension,
                grants: await runtime.permissions.listPersistentGrants(user, extensionId),
                policies: await runtime.permissions.getPolicyEntries(user, extensionId),
                activity,
                jobs: jobsPage.jobs,
                jobsPage: jobsPage.page,
                databases,
                triviumDatabases,
                storage: await buildExtensionStorageSummary(runtime, user, extensionId, databases, triviumDatabases),
            });
        } catch (error) {
            fail(runtime, req, res, decodeURIComponent(req.params?.id ?? 'unknown'), error);
        }
    });

    router.post('/extensions/:id/grants/reset', async (req, res) => {
        try {
            const user = getUserContext(req);
            const extensionId = decodeURIComponent(req.params?.id ?? '');
            await runtime.permissions.resetPersistentGrants(user, extensionId, req.body?.keys);
            await runtime.audit.logPermission(user, extensionId, 'Persistent grants reset', {
                keys: req.body?.keys ?? null,
            });
            if (typeof res.sendStatus === 'function') {
                res.sendStatus(204);
            } else {
                res.status(204).send();
            }
        } catch (error) {
            fail(runtime, req, res, decodeURIComponent(req.params?.id ?? 'unknown'), error);
        }
    });

    registerStorageRoutes(router, runtime, fail);

    registerSqlRoutes(router, runtime, fail);

    registerTriviumRoutes(router, runtime, fail);

    registerHttpRoutes(router, runtime, fail);

    registerJobsAndEventsRoutes(router, runtime, fail);

    router.get('/admin/policies', async (req, res) => {
        try {
            const user = getUserContext(req);
            if (!user.isAdmin) {
                throw new Error('Forbidden');
            }
            ok(res, await runtime.policies.getPolicies(user));
        } catch (error) {
            fail(runtime, req, res, 'third-party/st-authority-sdk', error);
        }
    });

    router.post('/admin/policies', async (req, res) => {
        try {
            const user = getUserContext(req);
            const result = await runtime.policies.saveGlobalPolicies(user, req.body ?? {});
            await runtime.audit.logUsage(user, 'third-party/st-authority-sdk', 'Policies updated');
            ok(res, result);
        } catch (error) {
            fail(runtime, req, res, 'third-party/st-authority-sdk', error);
        }
    });

    router.get('/admin/usage-summary', async (req, res) => {
        try {
            const user = getUserContext(req);
            assertAdminUser(user);
            ok(res, await buildUsageSummary(runtime, user));
        } catch (error) {
            fail(runtime, req, res, 'third-party/st-authority-sdk', error);
        }
    });

    router.get('/admin/import-export/operations', async (req, res) => {
        try {
            const user = getUserContext(req);
            assertAdminUser(user);
            ok(res, {
                operations: runtime.adminPackages.listOperations(user),
            } satisfies AuthorityPackageOperationListResponse);
        } catch (error) {
            fail(runtime, req, res, 'third-party/st-authority-sdk', error);
        }
    });

    router.post('/admin/import-export/export', async (req, res) => {
        try {
            const user = getUserContext(req);
            assertAdminUser(user);
            const operation = runtime.adminPackages.startExport(user, (req.body ?? {}) as AuthorityExportPackageRequest);
            await runtime.audit.logUsage(user, AUTHORITY_SDK_EXTENSION_ID, 'Export package started', {
                operationId: operation.id,
                kind: operation.kind,
            });
            ok(res, operation);
        } catch (error) {
            fail(runtime, req, res, 'third-party/st-authority-sdk', error);
        }
    });

    router.post('/admin/import-export/import-transfer/init', async (req, res) => {
        try {
            const user = getUserContext(req);
            assertAdminUser(user);
            ok(res, await runtime.transfers.init(user, AUTHORITY_SDK_EXTENSION_ID, {
                resource: 'fs.private',
                purpose: 'privateFileWrite',
            }, parseAdminPackageSizeBytes((req.body as { sizeBytes?: unknown } | undefined)?.sizeBytes)));
        } catch (error) {
            fail(runtime, req, res, 'third-party/st-authority-sdk', error);
        }
    });

    router.post('/admin/import-export/import', async (req, res) => {
        try {
            const user = getUserContext(req);
            assertAdminUser(user);
            const payload = (req.body ?? {}) as AuthorityPackageImportRequest;
            const transfer = runtime.transfers.get(user, AUTHORITY_SDK_EXTENSION_ID, String(payload.transferId ?? ''), 'fs.private');
            const operation = runtime.adminPackages.startImport(user, payload, transfer.filePath);
            await runtime.audit.logUsage(user, AUTHORITY_SDK_EXTENSION_ID, 'Import package started', {
                operationId: operation.id,
                transferId: transfer.transferId,
                mode: operation.importMode,
            });
            await runtime.transfers.discard(user, AUTHORITY_SDK_EXTENSION_ID, transfer.transferId).catch(() => undefined);
            ok(res, operation);
        } catch (error) {
            fail(runtime, req, res, 'third-party/st-authority-sdk', error);
        }
    });

    router.post('/admin/import-export/operations/:id/resume', async (req, res) => {
        try {
            const user = getUserContext(req);
            assertAdminUser(user);
            const operation = runtime.adminPackages.resume(user, String(req.params?.id ?? ''));
            await runtime.audit.logUsage(user, AUTHORITY_SDK_EXTENSION_ID, 'Import/export operation resumed', {
                operationId: operation.id,
                kind: operation.kind,
            });
            ok(res, operation);
        } catch (error) {
            fail(runtime, req, res, 'third-party/st-authority-sdk', error);
        }
    });

    router.post('/admin/import-export/operations/:id/open-download', async (req, res) => {
        try {
            const user = getUserContext(req);
            assertAdminUser(user);
            const artifact = runtime.adminPackages.getArtifact(user, String(req.params?.id ?? ''));
            await runtime.audit.logUsage(user, AUTHORITY_SDK_EXTENSION_ID, 'Import/export artifact opened', {
                fileName: artifact.artifact.fileName,
                sizeBytes: artifact.artifact.sizeBytes,
            });
            ok(res, await openAdminArtifactDownload(runtime, user, artifact.filePath, artifact.artifact.sizeBytes, artifact.artifact));
        } catch (error) {
            fail(runtime, req, res, 'third-party/st-authority-sdk', error);
        }
    });

    router.get('/admin/native-migration/operations', async (req, res) => {
        try {
            const user = getUserContext(req);
            assertAdminUser(user);
            ok(res, {
                operations: runtime.nativeMigrations.listOperations(),
            } satisfies NativeMigrationOperationListResponse);
        } catch (error) {
            fail(runtime, req, res, AUTHORITY_SDK_EXTENSION_ID, error);
        }
    });

    router.post('/admin/native-migration/upload/init', async (req, res) => {
        try {
            const user = getUserContext(req);
            assertAdminUser(user);
            const sizeBytes = parseNativeMigrationSizeBytes((req.body as { sizeBytes?: unknown } | undefined)?.sizeBytes);
            ok(res, await runtime.transfers.init(user, AUTHORITY_SDK_EXTENSION_ID, {
                resource: 'fs.private',
                purpose: 'privateFileWrite',
            }, sizeBytes, NATIVE_MIGRATION_TRANSFER_CHUNK_BYTES));
        } catch (error) {
            fail(runtime, req, res, AUTHORITY_SDK_EXTENSION_ID, error);
        }
    });

    router.post('/admin/native-migration/preview', async (req, res) => {
        try {
            const user = getUserContext(req);
            assertAdminUser(user);
            const payload = (req.body ?? {}) as NativeMigrationPreviewRequest;
            const transfer = runtime.transfers.get(user, AUTHORITY_SDK_EXTENSION_ID, String(payload.transferId ?? ''), 'fs.private');
            const previewOptions = typeof payload.fileName === 'string' && payload.fileName.trim()
                ? { sourceFileName: payload.fileName, adoptSource: true }
                : { adoptSource: true };
            const operation = await runtime.nativeMigrations.preview(payload.target, transfer.filePath, previewOptions);
            await runtime.audit.logUsage(user, AUTHORITY_SDK_EXTENSION_ID, 'Native migration preview created', {
                operationId: operation.id,
                target: operation.target,
                entryCount: operation.entryCount,
                sourceSizeBytes: operation.sourceSizeBytes,
            });
            await runtime.transfers.discard(user, AUTHORITY_SDK_EXTENSION_ID, transfer.transferId).catch(() => undefined);
            ok(res, operation);
        } catch (error) {
            fail(runtime, req, res, AUTHORITY_SDK_EXTENSION_ID, error);
        }
    });

    router.post('/admin/native-migration/operations/:id/apply', async (req, res) => {
        try {
            const user = getUserContext(req);
            assertAdminUser(user);
            const payload = (req.body ?? {}) as Partial<NativeMigrationApplyRequest>;
            const operation = await runtime.nativeMigrations.apply(String(req.params?.id ?? ''), payload.mode ?? 'skip');
            await runtime.audit.logUsage(user, AUTHORITY_SDK_EXTENSION_ID, 'Native migration applied', {
                operationId: operation.id,
                target: operation.target,
                mode: payload.mode ?? 'skip',
                createdCount: operation.createdCount,
                overwrittenCount: operation.overwrittenCount,
                skippedCount: operation.skippedCount,
            });
            ok(res, operation);
        } catch (error) {
            fail(runtime, req, res, AUTHORITY_SDK_EXTENSION_ID, error);
        }
    });

    router.post('/admin/native-migration/operations/:id/rollback', async (req, res) => {
        try {
            const user = getUserContext(req);
            assertAdminUser(user);
            const operation = runtime.nativeMigrations.rollback(String(req.params?.id ?? ''));
            await runtime.audit.logUsage(user, AUTHORITY_SDK_EXTENSION_ID, 'Native migration rolled back', {
                operationId: operation.id,
                target: operation.target,
            });
            ok(res, operation);
        } catch (error) {
            fail(runtime, req, res, AUTHORITY_SDK_EXTENSION_ID, error);
        }
    });

    router.get('/admin/diagnostic-bundle', async (req, res) => {
        try {
            const user = getUserContext(req);
            assertAdminUser(user);
            ok(res, await buildDiagnosticBundle(runtime, user));
        } catch (error) {
            fail(runtime, req, res, 'third-party/st-authority-sdk', error);
        }
    });

    router.post('/admin/diagnostic-bundle/archive', async (req, res) => {
        try {
            const user = getUserContext(req);
            assertAdminUser(user);
            const artifact = runtime.adminPackages.createDiagnosticArchive(user, await buildDiagnosticBundle(runtime, user));
            await runtime.audit.logUsage(user, AUTHORITY_SDK_EXTENSION_ID, 'Diagnostic archive created', {
                fileName: artifact.artifact.fileName,
                sizeBytes: artifact.artifact.sizeBytes,
            });
            ok(res, await openAdminArtifactDownload(runtime, user, artifact.filePath, artifact.artifact.sizeBytes, artifact.artifact));
        } catch (error) {
            fail(runtime, req, res, 'third-party/st-authority-sdk', error);
        }
    });

    router.post('/admin/update', async (req, res) => {
        try {
            const user = getUserContext(req);
            if (!user.isAdmin) {
                throw new Error('Forbidden');
            }

            const action = parseAdminUpdateAction((req.body as { action?: unknown } | undefined)?.action);
            const before = runtime.install.getStatus();
            const coreBefore = runtime.core.getStatus();
            const shouldStopCore = action === 'git-pull' && (coreBefore.state === 'running' || coreBefore.state === 'starting' || coreBefore.state === 'error');
            let git = null;

            if (shouldStopCore) {
                await runtime.core.stop();
            }

            try {
                if (action === 'git-pull') {
                    git = runtime.install.pullLatestFromGit();
                }

                const after = await runtime.install.redeployBundledSdk();
                const core = await runtime.core.start();
                const coreRestarted = shouldStopCore && core.state === 'running';
                const requiresRestart = action === 'git-pull' && Boolean(git?.changed);
                const message = action === 'git-pull'
                    ? requiresRestart
                        ? '服务端插件已拉取最新提交，并已重新部署携带的前端插件。要应用新的 Node 服务端代码，请重启 SillyTavern 并刷新页面。'
                        : '服务端插件已经是最新版本，已重新校验并部署携带的前端插件。'
                    : '已重新部署携带的前端插件，并重新校验 Authority 后台服务状态。';

                const response: AdminUpdateResponse = {
                    action,
                    message,
                    requiresRestart,
                    before,
                    after,
                    git,
                    core,
                    coreRestarted,
                    coreRestartMessage: coreRestarted
                        ? null
                        : core.state === 'running'
                            ? 'Authority 后台服务已保持运行。'
                            : `Authority 后台服务当前状态：${core.state}`,
                    updatedAt: new Date().toISOString(),
                };

                await runtime.audit.logUsage(user, 'third-party/st-authority-sdk', action === 'git-pull' ? 'Authority plugin updated' : 'Authority SDK redeployed');
                ok(res, response);
            } catch (error) {
                let recoveryMessage = '';
                try {
                    const recovery = await runtime.core.start();
                    recoveryMessage = recovery.state === 'running'
                        ? '更新失败后后台服务已恢复。'
                        : `更新失败后后台服务状态为 ${recovery.state}。`;
                } catch (recoveryError) {
                    recoveryMessage = `更新失败且后台服务恢复失败：${asErrorMessage(recoveryError)}`;
                }
                throw new Error(`${asErrorMessage(error)} ${recoveryMessage}`.trim());
            }
        } catch (error) {
            fail(runtime, req, res, 'third-party/st-authority-sdk', error);
        }
    });

    return runtime;
}

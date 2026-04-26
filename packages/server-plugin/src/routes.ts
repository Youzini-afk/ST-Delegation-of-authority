import fs from 'node:fs';
import path from 'node:path';
import type {
    AuthorityInitConfig,
    BlobRecord,
    BlobTransferCommitRequest,
    DataTransferAppendRequest,
    DataTransferInitRequest,
    DataTransferReadRequest,
    HttpFetchOpenRequest,
    PermissionEvaluateRequest,
    PermissionResolveRequest,
    PrivateFileDeleteRequest,
    PrivateFileTransferCommitRequest,
    PrivateFileMkdirRequest,
    PrivateFileReadDirRequest,
    PrivateFileReadRequest,
    PrivateFileUsageSummary,
    PrivateFileWriteRequest,
    PrivateFileStatRequest,
    SqlBatchRequest,
    SqlExecRequest,
    SqlListDatabasesResponse,
    SqlMigrateRequest,
    SqlQueryRequest,
    SqlTransactionRequest,
    TriviumBulkDeleteRequest,
    TriviumBulkLinkRequest,
    TriviumBulkUnlinkRequest,
    TriviumBulkUpsertRequest,
    TriviumBuildTextIndexRequest,
    TriviumDatabaseRecord,
    TriviumDeleteRequest,
    TriviumFilterWhereRequest,
    TriviumFlushRequest,
    TriviumGetRequest,
    TriviumIndexKeywordRequest,
    TriviumIndexTextRequest,
    TriviumInsertRequest,
    TriviumInsertWithIdRequest,
    TriviumLinkRequest,
    TriviumListDatabasesResponse,
    TriviumNeighborsRequest,
    TriviumQueryRequest,
    TriviumResolveIdRequest,
    TriviumSearchAdvancedRequest,
    TriviumSearchHybridRequest,
    TriviumSearchRequest,
    TriviumStatRequest,
    TriviumUnlinkRequest,
    TriviumUpsertRequest,
    TriviumUpdatePayloadRequest,
    TriviumUpdateVectorRequest,
} from '@stdo/shared-types';
import { DATA_TRANSFER_INLINE_THRESHOLD_BYTES } from './constants.js';
import { createAuthorityRuntime, type AuthorityRuntime } from './runtime.js';
import { getUserAuthorityPaths } from './store/authority-paths.js';
import type { AdminUpdateAction, AdminUpdateResponse, AuthorityRequest, AuthorityResponse } from './types.js';
import { asErrorMessage, getSessionToken, getUserContext, normalizeHostname, sanitizeFileSegment } from './utils.js';

type RouterLike = {
    get(path: string, handler: (req: AuthorityRequest, res: AuthorityResponse) => void | Promise<void>): void;
    post(path: string, handler: (req: AuthorityRequest, res: AuthorityResponse) => void | Promise<void>): void;
};

function ok(res: AuthorityResponse, data: unknown): void {
    res.json(data);
}

function fail(runtime: AuthorityRuntime, req: AuthorityRequest, res: AuthorityResponse, extensionId: string, error: unknown): void {
    const message = asErrorMessage(error);
    try {
        const user = getUserContext(req);
        void runtime.audit.logError(user, extensionId, message).catch(() => undefined);
    } catch {
        // ignore errors raised before auth is available
    }
    res.status(400).json({ error: message });
}

function parseAdminUpdateAction(value: unknown): AdminUpdateAction {
    return value === 'redeploy-sdk' ? 'redeploy-sdk' : 'git-pull';
}

function getSqlDatabaseName(value: unknown): string {
    return typeof value === 'string' && value.trim() ? value.trim() : 'default';
}

function resolvePrivateSqlDatabaseDir(user: ReturnType<typeof getUserContext>, extensionId: string): string {
    const paths = getUserAuthorityPaths(user);
    return path.join(paths.sqlPrivateDir, sanitizeFileSegment(extensionId));
}

function resolvePrivateSqlDatabasePath(user: ReturnType<typeof getUserContext>, extensionId: string, databaseName: string): string {
    return path.join(
        resolvePrivateSqlDatabaseDir(user, extensionId),
        `${sanitizeFileSegment(databaseName)}.sqlite`,
    );
}

function getTriviumDatabaseName(value: unknown): string {
    return typeof value === 'string' && value.trim() ? value.trim() : 'default';
}

function decodeHttpResponseBody(bytes: Buffer, encoding: 'utf8' | 'base64'): string {
    if (encoding === 'base64') {
        return bytes.toString('base64');
    }
    return bytes.toString('utf8');
}

function resolvePrivateTriviumDatabaseDir(user: ReturnType<typeof getUserContext>, extensionId: string): string {
    const paths = getUserAuthorityPaths(user);
    return path.join(paths.triviumPrivateDir, sanitizeFileSegment(extensionId));
}

function resolvePrivateTriviumDatabasePath(user: ReturnType<typeof getUserContext>, extensionId: string, databaseName: string): string {
    return path.join(
        resolvePrivateTriviumDatabaseDir(user, extensionId),
        `${sanitizeFileSegment(databaseName)}.tdb`,
    );
}

function readTriviumDimension(filePath: string): number | null {
    try {
        const handle = fs.openSync(filePath, 'r');
        try {
            const header = Buffer.alloc(10);
            const bytesRead = fs.readSync(handle, header, 0, 10, 0);
            if (bytesRead < 10 || header.toString('utf8', 0, 4) !== 'TVDB') {
                return null;
            }
            return header.readUInt32LE(6);
        } finally {
            fs.closeSync(handle);
        }
    } catch {
        return null;
    }
}

function buildTriviumDatabaseRecord(filePath: string, entryName: string): TriviumDatabaseRecord {
    const mainStats = fs.statSync(filePath);
    const walPath = `${filePath}.wal`;
    const vecPath = `${filePath}.vec`;
    const walStats = fs.existsSync(walPath) ? fs.statSync(walPath) : null;
    const vecStats = fs.existsSync(vecPath) ? fs.statSync(vecPath) : null;
    const storageMode = vecStats ? 'mmap' : 'rom';
    const timestamps = [mainStats, walStats, vecStats]
        .filter((value): value is fs.Stats => value !== null)
        .map(stats => stats.mtime.toISOString())
        .sort((left, right) => left.localeCompare(right));

    return {
        name: entryName.slice(0, -'.tdb'.length),
        fileName: entryName,
        dim: readTriviumDimension(filePath),
        dtype: null,
        syncMode: null,
        storageMode,
        sizeBytes: mainStats.size,
        walSizeBytes: walStats?.size ?? 0,
        vecSizeBytes: vecStats?.size ?? 0,
        totalSizeBytes: mainStats.size + (walStats?.size ?? 0) + (vecStats?.size ?? 0),
        updatedAt: timestamps.at(-1) ?? null,
    };
}

function listPrivateTriviumDatabases(user: ReturnType<typeof getUserContext>, extensionId: string): TriviumListDatabasesResponse {
    const databaseDir = resolvePrivateTriviumDatabaseDir(user, extensionId);
    if (!fs.existsSync(databaseDir)) {
        return { databases: [] };
    }

    const databases = fs.readdirSync(databaseDir, { withFileTypes: true })
        .filter(entry => entry.isFile() && entry.name.endsWith('.tdb'))
        .map(entry => buildTriviumDatabaseRecord(path.join(databaseDir, entry.name), entry.name))
        .sort((left, right) => (right.updatedAt ?? '').localeCompare(left.updatedAt ?? ''));

    return { databases };
}

function listPrivateSqlDatabases(user: ReturnType<typeof getUserContext>, extensionId: string): SqlListDatabasesResponse {
    const databaseDir = resolvePrivateSqlDatabaseDir(user, extensionId);
    if (!fs.existsSync(databaseDir)) {
        return { databases: [] };
    }

    const databases = fs.readdirSync(databaseDir, { withFileTypes: true })
        .filter(entry => entry.isFile() && entry.name.endsWith('.sqlite'))
        .map(entry => {
            const filePath = path.join(databaseDir, entry.name);
            const stats = fs.statSync(filePath);
            return {
                name: entry.name.slice(0, -'.sqlite'.length),
                fileName: entry.name,
                sizeBytes: stats.size,
                updatedAt: stats.mtime.toISOString(),
            };
        })
        .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt));

    return { databases };
}

function previewSqlStatement(statement: string): string {
    const normalized = statement.replace(/\s+/g, ' ').trim();
    return normalized.length > 160 ? `${normalized.slice(0, 157)}...` : normalized;
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
    sqlDatabases = listPrivateSqlDatabases(user, extensionId).databases,
    triviumDatabases = listPrivateTriviumDatabases(user, extensionId).databases,
): Promise<{
    kvEntries: number;
    blobCount: number;
    blobBytes: number;
    databaseCount: number;
    databaseBytes: number;
    sqlDatabaseCount: number;
    sqlDatabaseBytes: number;
    triviumDatabaseCount: number;
    triviumDatabaseBytes: number;
    files: PrivateFileUsageSummary;
}> {
    const [kvEntries, blobs, files] = await Promise.all([
        runtime.storage.listKv(user, extensionId),
        runtime.storage.listBlobs(user, extensionId),
        runtime.files.getUsageSummary(user, extensionId),
    ]);
    const blobSummary = summarizeBlobRecords(blobs);
    const sqlDatabaseSummary = summarizeDatabases(sqlDatabases);
    const triviumDatabaseSummary = summarizeTriviumDatabases(triviumDatabases);

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

export function registerRoutes(router: RouterLike, runtime = createAuthorityRuntime()): AuthorityRuntime {

    router.post('/probe', async (_req, res) => {
        await runtime.core.refreshHealth();
        const install = runtime.install.getStatus();
        const core = runtime.core.getStatus();
        ok(res, {
            id: 'authority',
            online: true,
            version: install.pluginVersion,
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
            core,
        });
    });

    router.post('/session/init', async (req, res) => {
        try {
            const user = getUserContext(req);
            const config = req.body as AuthorityInitConfig;
            const session = await runtime.sessions.createSession(user, config);
            const grants = await runtime.permissions.listPersistentGrants(user, session.extension.id);
            const policies = await runtime.permissions.getPolicyEntries(user, session.extension.id);
            await runtime.audit.logUsage(user, session.extension.id, 'Session initialized');
            ok(res, runtime.sessions.buildSessionResponse(session, grants, policies));
        } catch (error) {
            fail(runtime, req, res, 'third-party/st-authority-sdk', error);
        }
    });

    router.get('/session/current', async (req, res) => {
        try {
            const user = getUserContext(req);
            const session = await runtime.sessions.assertSession(getSessionToken(req), user);
            ok(res, runtime.sessions.buildSessionResponse(
                session,
                await runtime.permissions.listPersistentGrants(user, session.extension.id),
                await runtime.permissions.getPolicyEntries(user, session.extension.id),
            ));
        } catch (error) {
            fail(runtime, req, res, 'third-party/st-authority-sdk', error);
        }
    });

    router.post('/permissions/evaluate', async (req, res) => {
        try {
            const user = getUserContext(req);
            const session = await runtime.sessions.assertSession(getSessionToken(req), user);
            ok(res, await runtime.permissions.evaluate(user, session, req.body as PermissionEvaluateRequest));
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
            await runtime.audit.logPermission(user, session.extension.id, 'Permission resolved', {
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
                const sqlDatabases = listPrivateSqlDatabases(user, extension.id).databases;
                const triviumDatabases = listPrivateTriviumDatabases(user, extension.id).databases;
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

            const databases = listPrivateSqlDatabases(user, extensionId).databases;
            const triviumDatabases = listPrivateTriviumDatabases(user, extensionId).databases;

            ok(res, {
                extension,
                grants: await runtime.permissions.listPersistentGrants(user, extensionId),
                policies: await runtime.permissions.getPolicyEntries(user, extensionId),
                activity: await runtime.audit.getRecentActivity(user, extensionId),
                jobs: await runtime.jobs.list(user, extensionId),
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

    router.post('/storage/kv/get', async (req, res) => {
        try {
            const user = getUserContext(req);
            const session = await runtime.sessions.assertSession(getSessionToken(req), user);
            if (!await runtime.permissions.authorize(user, session, { resource: 'storage.kv' })) {
                throw new Error('Permission not granted: storage.kv');
            }

            ok(res, { value: await runtime.storage.getKv(user, session.extension.id, String(req.body?.key ?? '')) });
        } catch (error) {
            fail(runtime, req, res, 'storage.kv', error);
        }
    });

    router.post('/storage/kv/set', async (req, res) => {
        try {
            const user = getUserContext(req);
            const session = await runtime.sessions.assertSession(getSessionToken(req), user);
            if (!await runtime.permissions.authorize(user, session, { resource: 'storage.kv' })) {
                throw new Error('Permission not granted: storage.kv');
            }

            await runtime.storage.setKv(user, session.extension.id, String(req.body?.key ?? ''), req.body?.value);
            await runtime.audit.logUsage(user, session.extension.id, 'KV set', { key: req.body?.key });
            ok(res, { ok: true });
        } catch (error) {
            fail(runtime, req, res, 'storage.kv', error);
        }
    });

    router.post('/storage/kv/delete', async (req, res) => {
        try {
            const user = getUserContext(req);
            const session = await runtime.sessions.assertSession(getSessionToken(req), user);
            if (!await runtime.permissions.authorize(user, session, { resource: 'storage.kv' })) {
                throw new Error('Permission not granted: storage.kv');
            }

            await runtime.storage.deleteKv(user, session.extension.id, String(req.body?.key ?? ''));
            ok(res, { ok: true });
        } catch (error) {
            fail(runtime, req, res, 'storage.kv', error);
        }
    });

    router.post('/storage/kv/list', async (req, res) => {
        try {
            const user = getUserContext(req);
            const session = await runtime.sessions.assertSession(getSessionToken(req), user);
            if (!await runtime.permissions.authorize(user, session, { resource: 'storage.kv' })) {
                throw new Error('Permission not granted: storage.kv');
            }

            ok(res, { entries: await runtime.storage.listKv(user, session.extension.id) });
        } catch (error) {
            fail(runtime, req, res, 'storage.kv', error);
        }
    });

    router.post('/transfers/init', async (req, res) => {
        try {
            const user = getUserContext(req);
            const session = await runtime.sessions.assertSession(getSessionToken(req), user);
            const payload = (req.body ?? {}) as DataTransferInitRequest;
            if (payload.resource !== 'storage.blob' && payload.resource !== 'fs.private' && payload.resource !== 'http.fetch') {
                throw new Error(`Unsupported transfer resource: ${String(payload.resource)}`);
            }
            if (payload.resource !== 'http.fetch' && !await runtime.permissions.authorize(user, session, { resource: payload.resource })) {
                throw new Error(`Permission not granted: ${payload.resource}`);
            }

            ok(res, await runtime.transfers.init(user, session.extension.id, payload));
        } catch (error) {
            fail(runtime, req, res, 'third-party/st-authority-sdk', error);
        }
    });

    router.post('/transfers/:id/append', async (req, res) => {
        try {
            const user = getUserContext(req);
            const session = await runtime.sessions.assertSession(getSessionToken(req), user);
            const payload = (req.body ?? {}) as DataTransferAppendRequest;
            ok(res, await runtime.transfers.append(user, session.extension.id, String(req.params?.id ?? ''), payload));
        } catch (error) {
            fail(runtime, req, res, 'third-party/st-authority-sdk', error);
        }
    });

    router.post('/transfers/:id/read', async (req, res) => {
        try {
            const user = getUserContext(req);
            const session = await runtime.sessions.assertSession(getSessionToken(req), user);
            const payload = (req.body ?? {}) as DataTransferReadRequest;
            ok(res, await runtime.transfers.read(user, session.extension.id, String(req.params?.id ?? ''), payload));
        } catch (error) {
            fail(runtime, req, res, 'third-party/st-authority-sdk', error);
        }
    });

    router.post('/transfers/:id/discard', async (req, res) => {
        try {
            const user = getUserContext(req);
            const session = await runtime.sessions.assertSession(getSessionToken(req), user);
            await runtime.transfers.discard(user, session.extension.id, String(req.params?.id ?? ''));
            ok(res, { ok: true });
        } catch (error) {
            fail(runtime, req, res, 'third-party/st-authority-sdk', error);
        }
    });

    router.post('/storage/blob/put', async (req, res) => {
        try {
            const user = getUserContext(req);
            const session = await runtime.sessions.assertSession(getSessionToken(req), user);
            if (!await runtime.permissions.authorize(user, session, { resource: 'storage.blob' })) {
                throw new Error('Permission not granted: storage.blob');
            }

            const record = await runtime.storage.putBlob(
                user,
                session.extension.id,
                String(req.body?.name ?? 'blob'),
                String(req.body?.content ?? ''),
                req.body?.encoding,
                req.body?.contentType,
            );
            await runtime.audit.logUsage(user, session.extension.id, 'Blob stored', { id: record.id });
            ok(res, record);
        } catch (error) {
            fail(runtime, req, res, 'storage.blob', error);
        }
    });

    router.post('/storage/blob/commit-transfer', async (req, res) => {
        try {
            const user = getUserContext(req);
            const session = await runtime.sessions.assertSession(getSessionToken(req), user);
            const payload = (req.body ?? {}) as BlobTransferCommitRequest;
            if (!await runtime.permissions.authorize(user, session, { resource: 'storage.blob' })) {
                throw new Error('Permission not granted: storage.blob');
            }

            const transfer = runtime.transfers.get(user, session.extension.id, payload.transferId, 'storage.blob');
            const record = await runtime.storage.putBlobFromSource(
                user,
                session.extension.id,
                String(payload.name ?? 'blob'),
                transfer.filePath,
                payload.contentType,
            );
            await runtime.transfers.discard(user, session.extension.id, payload.transferId).catch(() => undefined);
            await runtime.audit.logUsage(user, session.extension.id, 'Blob stored', { id: record.id, via: 'transfer' });
            ok(res, record);
        } catch (error) {
            fail(runtime, req, res, 'storage.blob', error);
        }
    });

    router.post('/storage/blob/get', async (req, res) => {
        try {
            const user = getUserContext(req);
            const session = await runtime.sessions.assertSession(getSessionToken(req), user);
            if (!await runtime.permissions.authorize(user, session, { resource: 'storage.blob' })) {
                throw new Error('Permission not granted: storage.blob');
            }

            ok(res, await runtime.storage.getBlob(user, session.extension.id, String(req.body?.id ?? '')));
        } catch (error) {
            fail(runtime, req, res, 'storage.blob', error);
        }
    });

    router.post('/storage/blob/open-read', async (req, res) => {
        try {
            const user = getUserContext(req);
            const session = await runtime.sessions.assertSession(getSessionToken(req), user);
            if (!await runtime.permissions.authorize(user, session, { resource: 'storage.blob' })) {
                throw new Error('Permission not granted: storage.blob');
            }

            const blobId = String(req.body?.id ?? '');
            const opened = await runtime.storage.openBlobRead(user, session.extension.id, blobId);
            if (opened.record.size <= DATA_TRANSFER_INLINE_THRESHOLD_BYTES) {
                ok(res, {
                    mode: 'inline',
                    ...(await runtime.storage.getBlob(user, session.extension.id, blobId)),
                });
                return;
            }

            const transfer = await runtime.transfers.openRead(user, session.extension.id, {
                resource: 'storage.blob',
                sourcePath: opened.sourcePath,
            });
            ok(res, {
                mode: 'transfer',
                record: opened.record,
                encoding: 'base64',
                transfer,
            });
        } catch (error) {
            fail(runtime, req, res, 'storage.blob', error);
        }
    });

    router.post('/storage/blob/delete', async (req, res) => {
        try {
            const user = getUserContext(req);
            const session = await runtime.sessions.assertSession(getSessionToken(req), user);
            if (!await runtime.permissions.authorize(user, session, { resource: 'storage.blob' })) {
                throw new Error('Permission not granted: storage.blob');
            }

            await runtime.storage.deleteBlob(user, session.extension.id, String(req.body?.id ?? ''));
            ok(res, { ok: true });
        } catch (error) {
            fail(runtime, req, res, 'storage.blob', error);
        }
    });

    router.post('/storage/blob/list', async (req, res) => {
        try {
            const user = getUserContext(req);
            const session = await runtime.sessions.assertSession(getSessionToken(req), user);
            if (!await runtime.permissions.authorize(user, session, { resource: 'storage.blob' })) {
                throw new Error('Permission not granted: storage.blob');
            }

            ok(res, { entries: await runtime.storage.listBlobs(user, session.extension.id) });
        } catch (error) {
            fail(runtime, req, res, 'storage.blob', error);
        }
    });

    router.post('/fs/private/mkdir', async (req, res) => {
        try {
            const user = getUserContext(req);
            const session = await runtime.sessions.assertSession(getSessionToken(req), user);
            const payload = (req.body ?? {}) as PrivateFileMkdirRequest;
            if (!await runtime.permissions.authorize(user, session, { resource: 'fs.private' })) {
                throw new Error('Permission not granted: fs.private');
            }

            const entry = await runtime.files.mkdir(user, session.extension.id, payload);
            await runtime.audit.logUsage(user, session.extension.id, 'Private file mkdir', { path: payload.path });
            ok(res, { entry });
        } catch (error) {
            fail(runtime, req, res, 'fs.private', error);
        }
    });

    router.post('/fs/private/read-dir', async (req, res) => {
        try {
            const user = getUserContext(req);
            const session = await runtime.sessions.assertSession(getSessionToken(req), user);
            const payload = (req.body ?? {}) as PrivateFileReadDirRequest;
            if (!await runtime.permissions.authorize(user, session, { resource: 'fs.private' })) {
                throw new Error('Permission not granted: fs.private');
            }

            const entries = await runtime.files.readDir(user, session.extension.id, payload);
            await runtime.audit.logUsage(user, session.extension.id, 'Private file read dir', { path: payload.path });
            ok(res, { entries });
        } catch (error) {
            fail(runtime, req, res, 'fs.private', error);
        }
    });

    router.post('/fs/private/write-file', async (req, res) => {
        try {
            const user = getUserContext(req);
            const session = await runtime.sessions.assertSession(getSessionToken(req), user);
            const payload = (req.body ?? {}) as PrivateFileWriteRequest;
            if (!await runtime.permissions.authorize(user, session, { resource: 'fs.private' })) {
                throw new Error('Permission not granted: fs.private');
            }

            const entry = await runtime.files.writeFile(user, session.extension.id, payload);
            await runtime.audit.logUsage(user, session.extension.id, 'Private file write', { path: payload.path });
            ok(res, { entry });
        } catch (error) {
            fail(runtime, req, res, 'fs.private', error);
        }
    });

    router.post('/fs/private/write-file-transfer', async (req, res) => {
        try {
            const user = getUserContext(req);
            const session = await runtime.sessions.assertSession(getSessionToken(req), user);
            const payload = (req.body ?? {}) as PrivateFileTransferCommitRequest;
            if (!await runtime.permissions.authorize(user, session, { resource: 'fs.private' })) {
                throw new Error('Permission not granted: fs.private');
            }

            const transfer = runtime.transfers.get(user, session.extension.id, payload.transferId, 'fs.private');
            const entry = await runtime.files.writeFileFromSource(user, session.extension.id, {
                path: payload.path,
                sourcePath: transfer.filePath,
                ...(payload.createParents === undefined ? {} : { createParents: payload.createParents }),
            });
            await runtime.transfers.discard(user, session.extension.id, payload.transferId).catch(() => undefined);
            await runtime.audit.logUsage(user, session.extension.id, 'Private file write', { path: payload.path, via: 'transfer' });
            ok(res, { entry });
        } catch (error) {
            fail(runtime, req, res, 'fs.private', error);
        }
    });

    router.post('/fs/private/read-file', async (req, res) => {
        try {
            const user = getUserContext(req);
            const session = await runtime.sessions.assertSession(getSessionToken(req), user);
            const payload = (req.body ?? {}) as PrivateFileReadRequest;
            if (!await runtime.permissions.authorize(user, session, { resource: 'fs.private' })) {
                throw new Error('Permission not granted: fs.private');
            }

            const result = await runtime.files.readFile(user, session.extension.id, payload);
            await runtime.audit.logUsage(user, session.extension.id, 'Private file read', { path: payload.path });
            ok(res, result);
        } catch (error) {
            fail(runtime, req, res, 'fs.private', error);
        }
    });

    router.post('/fs/private/open-read', async (req, res) => {
        try {
            const user = getUserContext(req);
            const session = await runtime.sessions.assertSession(getSessionToken(req), user);
            const payload = (req.body ?? {}) as PrivateFileReadRequest;
            if (!await runtime.permissions.authorize(user, session, { resource: 'fs.private' })) {
                throw new Error('Permission not granted: fs.private');
            }

            const opened = await runtime.files.openRead(user, session.extension.id, payload);
            if (opened.entry.sizeBytes <= DATA_TRANSFER_INLINE_THRESHOLD_BYTES) {
                const result = await runtime.files.readFile(user, session.extension.id, payload);
                await runtime.audit.logUsage(user, session.extension.id, 'Private file read', { path: payload.path });
                ok(res, {
                    mode: 'inline',
                    ...result,
                });
                return;
            }

            const transfer = await runtime.transfers.openRead(user, session.extension.id, {
                resource: 'fs.private',
                sourcePath: opened.sourcePath,
            });
            await runtime.audit.logUsage(user, session.extension.id, 'Private file read', { path: payload.path, via: 'transfer' });
            ok(res, {
                mode: 'transfer',
                entry: opened.entry,
                encoding: payload.encoding ?? 'utf8',
                transfer,
            });
        } catch (error) {
            fail(runtime, req, res, 'fs.private', error);
        }
    });

    router.post('/fs/private/delete', async (req, res) => {
        try {
            const user = getUserContext(req);
            const session = await runtime.sessions.assertSession(getSessionToken(req), user);
            const payload = (req.body ?? {}) as PrivateFileDeleteRequest;
            if (!await runtime.permissions.authorize(user, session, { resource: 'fs.private' })) {
                throw new Error('Permission not granted: fs.private');
            }

            await runtime.files.delete(user, session.extension.id, payload);
            await runtime.audit.logUsage(user, session.extension.id, 'Private file delete', { path: payload.path });
            ok(res, { ok: true });
        } catch (error) {
            fail(runtime, req, res, 'fs.private', error);
        }
    });

    router.post('/fs/private/stat', async (req, res) => {
        try {
            const user = getUserContext(req);
            const session = await runtime.sessions.assertSession(getSessionToken(req), user);
            const payload = (req.body ?? {}) as PrivateFileStatRequest;
            if (!await runtime.permissions.authorize(user, session, { resource: 'fs.private' })) {
                throw new Error('Permission not granted: fs.private');
            }

            const entry = await runtime.files.stat(user, session.extension.id, payload);
            await runtime.audit.logUsage(user, session.extension.id, 'Private file stat', { path: payload.path });
            ok(res, { entry });
        } catch (error) {
            fail(runtime, req, res, 'fs.private', error);
        }
    });

    router.post('/sql/query', async (req, res) => {
        try {
            const user = getUserContext(req);
            const session = await runtime.sessions.assertSession(getSessionToken(req), user);
            const payload = (req.body ?? {}) as SqlQueryRequest;
            const database = getSqlDatabaseName(payload.database);
            if (!await runtime.permissions.authorize(user, session, { resource: 'sql.private', target: database })) {
                throw new Error(`Permission not granted: sql.private for ${database}`);
            }

            const dbPath = resolvePrivateSqlDatabasePath(user, session.extension.id, database);
            const result = await runtime.core.querySql(dbPath, {
                ...payload,
                database,
            });
            await runtime.audit.logUsage(user, session.extension.id, 'SQL query', {
                database,
                statement: previewSqlStatement(payload.statement ?? ''),
            });
            ok(res, result);
        } catch (error) {
            fail(runtime, req, res, 'sql.private', error);
        }
    });

    router.post('/sql/exec', async (req, res) => {
        try {
            const user = getUserContext(req);
            const session = await runtime.sessions.assertSession(getSessionToken(req), user);
            const payload = (req.body ?? {}) as SqlExecRequest;
            const database = getSqlDatabaseName(payload.database);
            if (!await runtime.permissions.authorize(user, session, { resource: 'sql.private', target: database })) {
                throw new Error(`Permission not granted: sql.private for ${database}`);
            }

            const dbPath = resolvePrivateSqlDatabasePath(user, session.extension.id, database);
            const result = await runtime.core.execSql(dbPath, {
                ...payload,
                database,
            });
            await runtime.audit.logUsage(user, session.extension.id, 'SQL exec', {
                database,
                statement: previewSqlStatement(payload.statement ?? ''),
            });
            ok(res, result);
        } catch (error) {
            fail(runtime, req, res, 'sql.private', error);
        }
    });

    router.post('/sql/batch', async (req, res) => {
        try {
            const user = getUserContext(req);
            const session = await runtime.sessions.assertSession(getSessionToken(req), user);
            const payload = (req.body ?? {}) as SqlBatchRequest;
            const database = getSqlDatabaseName(payload.database);
            if (!await runtime.permissions.authorize(user, session, { resource: 'sql.private', target: database })) {
                throw new Error(`Permission not granted: sql.private for ${database}`);
            }

            const dbPath = resolvePrivateSqlDatabasePath(user, session.extension.id, database);
            const result = await runtime.core.batchSql(dbPath, {
                ...payload,
                database,
            });
            await runtime.audit.logUsage(user, session.extension.id, 'SQL batch', {
                database,
                statements: Array.isArray(payload.statements) ? payload.statements.length : 0,
            });
            ok(res, result);
        } catch (error) {
            fail(runtime, req, res, 'sql.private', error);
        }
    });

    router.post('/sql/transaction', async (req, res) => {
        try {
            const user = getUserContext(req);
            const session = await runtime.sessions.assertSession(getSessionToken(req), user);
            const payload = (req.body ?? {}) as SqlTransactionRequest;
            const database = getSqlDatabaseName(payload.database);
            if (!await runtime.permissions.authorize(user, session, { resource: 'sql.private', target: database })) {
                throw new Error(`Permission not granted: sql.private for ${database}`);
            }

            const dbPath = resolvePrivateSqlDatabasePath(user, session.extension.id, database);
            const result = await runtime.core.transactionSql(dbPath, {
                ...payload,
                database,
            });
            await runtime.audit.logUsage(user, session.extension.id, 'SQL transaction', {
                database,
                statements: Array.isArray(payload.statements) ? payload.statements.length : 0,
            });
            ok(res, result);
        } catch (error) {
            fail(runtime, req, res, 'sql.private', error);
        }
    });

    router.post('/sql/migrate', async (req, res) => {
        try {
            const user = getUserContext(req);
            const session = await runtime.sessions.assertSession(getSessionToken(req), user);
            const payload = (req.body ?? {}) as SqlMigrateRequest;
            const database = getSqlDatabaseName(payload.database);
            if (!await runtime.permissions.authorize(user, session, { resource: 'sql.private', target: database })) {
                throw new Error(`Permission not granted: sql.private for ${database}`);
            }

            const dbPath = resolvePrivateSqlDatabasePath(user, session.extension.id, database);
            const result = await runtime.core.migrateSql(dbPath, {
                ...payload,
                database,
            });
            await runtime.audit.logUsage(user, session.extension.id, 'SQL migrate', {
                database,
                migrations: Array.isArray(payload.migrations) ? payload.migrations.length : 0,
                tableName: payload.tableName ?? '_authority_migrations',
            });
            ok(res, result);
        } catch (error) {
            fail(runtime, req, res, 'sql.private', error);
        }
    });

    router.get('/sql/databases', async (req, res) => {
        try {
            const user = getUserContext(req);
            const session = await runtime.sessions.assertSession(getSessionToken(req), user);
            if (!await runtime.permissions.authorize(user, session, { resource: 'sql.private' }, false)) {
                throw new Error('Permission not granted: sql.private');
            }

            const result = listPrivateSqlDatabases(user, session.extension.id);
            await runtime.audit.logUsage(user, session.extension.id, 'SQL list databases', {
                count: result.databases.length,
            });
            ok(res, result);
        } catch (error) {
            fail(runtime, req, res, 'sql.private', error);
        }
    });

    router.post('/trivium/insert', async (req, res) => {
        try {
            const user = getUserContext(req);
            const session = await runtime.sessions.assertSession(getSessionToken(req), user);
            const payload = (req.body ?? {}) as TriviumInsertRequest;
            const database = getTriviumDatabaseName(payload.database);
            if (!await runtime.permissions.authorize(user, session, { resource: 'trivium.private', target: database })) {
                throw new Error(`Permission not granted: trivium.private for ${database}`);
            }

            const dbPath = resolvePrivateTriviumDatabasePath(user, session.extension.id, database);
            const result = await runtime.core.insertTrivium(dbPath, {
                ...payload,
                database,
            });
            await runtime.audit.logUsage(user, session.extension.id, 'Trivium insert', {
                database,
                id: result.id,
            });
            ok(res, result);
        } catch (error) {
            fail(runtime, req, res, 'trivium.private', error);
        }
    });

    router.post('/trivium/insert-with-id', async (req, res) => {
        try {
            const user = getUserContext(req);
            const session = await runtime.sessions.assertSession(getSessionToken(req), user);
            const payload = (req.body ?? {}) as TriviumInsertWithIdRequest;
            const database = getTriviumDatabaseName(payload.database);
            if (!await runtime.permissions.authorize(user, session, { resource: 'trivium.private', target: database })) {
                throw new Error(`Permission not granted: trivium.private for ${database}`);
            }

            const dbPath = resolvePrivateTriviumDatabasePath(user, session.extension.id, database);
            await runtime.core.insertTriviumWithId(dbPath, {
                ...payload,
                database,
            });
            await runtime.audit.logUsage(user, session.extension.id, 'Trivium insert with id', {
                database,
                id: payload.id,
            });
            ok(res, { ok: true });
        } catch (error) {
            fail(runtime, req, res, 'trivium.private', error);
        }
    });

    router.post('/trivium/resolve-id', async (req, res) => {
        try {
            const user = getUserContext(req);
            const session = await runtime.sessions.assertSession(getSessionToken(req), user);
            const payload = (req.body ?? {}) as TriviumResolveIdRequest;
            const database = getTriviumDatabaseName(payload.database);
            if (!await runtime.permissions.authorize(user, session, { resource: 'trivium.private', target: database })) {
                throw new Error(`Permission not granted: trivium.private for ${database}`);
            }

            const result = await runtime.trivium.resolveId(user, session.extension.id, payload);
            await runtime.audit.logUsage(user, session.extension.id, 'Trivium resolve id', {
                database,
                externalId: result.externalId,
                namespace: result.namespace,
                id: result.id,
            });
            ok(res, result);
        } catch (error) {
            fail(runtime, req, res, 'trivium.private', error);
        }
    });

    router.post('/trivium/upsert', async (req, res) => {
        try {
            const user = getUserContext(req);
            const session = await runtime.sessions.assertSession(getSessionToken(req), user);
            const payload = (req.body ?? {}) as TriviumUpsertRequest;
            const database = getTriviumDatabaseName(payload.database);
            if (!await runtime.permissions.authorize(user, session, { resource: 'trivium.private', target: database })) {
                throw new Error(`Permission not granted: trivium.private for ${database}`);
            }

            const result = await runtime.trivium.upsert(user, session.extension.id, payload);
            await runtime.audit.logUsage(user, session.extension.id, 'Trivium upsert', {
                database,
                id: result.id,
                action: result.action,
                externalId: result.externalId,
                namespace: result.namespace,
            });
            ok(res, result);
        } catch (error) {
            fail(runtime, req, res, 'trivium.private', error);
        }
    });

    router.post('/trivium/bulk-upsert', async (req, res) => {
        try {
            const user = getUserContext(req);
            const session = await runtime.sessions.assertSession(getSessionToken(req), user);
            const payload = (req.body ?? {}) as TriviumBulkUpsertRequest;
            const database = getTriviumDatabaseName(payload.database);
            if (!await runtime.permissions.authorize(user, session, { resource: 'trivium.private', target: database })) {
                throw new Error(`Permission not granted: trivium.private for ${database}`);
            }

            const result = await runtime.trivium.bulkUpsert(user, session.extension.id, payload);
            await runtime.audit.logUsage(user, session.extension.id, 'Trivium bulk upsert', {
                database,
                totalCount: result.totalCount,
                successCount: result.successCount,
                failureCount: result.failureCount,
            });
            ok(res, result);
        } catch (error) {
            fail(runtime, req, res, 'trivium.private', error);
        }
    });

    router.post('/trivium/get', async (req, res) => {
        try {
            const user = getUserContext(req);
            const session = await runtime.sessions.assertSession(getSessionToken(req), user);
            const payload = (req.body ?? {}) as TriviumGetRequest;
            const database = getTriviumDatabaseName(payload.database);
            if (!await runtime.permissions.authorize(user, session, { resource: 'trivium.private', target: database })) {
                throw new Error(`Permission not granted: trivium.private for ${database}`);
            }

            const node = await runtime.trivium.get(user, session.extension.id, payload);
            await runtime.audit.logUsage(user, session.extension.id, 'Trivium get', {
                database,
                id: payload.id,
            });
            ok(res, { node });
        } catch (error) {
            fail(runtime, req, res, 'trivium.private', error);
        }
    });

    router.post('/trivium/update-payload', async (req, res) => {
        try {
            const user = getUserContext(req);
            const session = await runtime.sessions.assertSession(getSessionToken(req), user);
            const payload = (req.body ?? {}) as TriviumUpdatePayloadRequest;
            const database = getTriviumDatabaseName(payload.database);
            if (!await runtime.permissions.authorize(user, session, { resource: 'trivium.private', target: database })) {
                throw new Error(`Permission not granted: trivium.private for ${database}`);
            }

            const dbPath = resolvePrivateTriviumDatabasePath(user, session.extension.id, database);
            await runtime.core.updateTriviumPayload(dbPath, {
                ...payload,
                database,
            });
            await runtime.audit.logUsage(user, session.extension.id, 'Trivium update payload', {
                database,
                id: payload.id,
            });
            ok(res, { ok: true });
        } catch (error) {
            fail(runtime, req, res, 'trivium.private', error);
        }
    });

    router.post('/trivium/update-vector', async (req, res) => {
        try {
            const user = getUserContext(req);
            const session = await runtime.sessions.assertSession(getSessionToken(req), user);
            const payload = (req.body ?? {}) as TriviumUpdateVectorRequest;
            const database = getTriviumDatabaseName(payload.database);
            if (!await runtime.permissions.authorize(user, session, { resource: 'trivium.private', target: database })) {
                throw new Error(`Permission not granted: trivium.private for ${database}`);
            }

            const dbPath = resolvePrivateTriviumDatabasePath(user, session.extension.id, database);
            await runtime.core.updateTriviumVector(dbPath, {
                ...payload,
                database,
            });
            await runtime.audit.logUsage(user, session.extension.id, 'Trivium update vector', {
                database,
                id: payload.id,
            });
            ok(res, { ok: true });
        } catch (error) {
            fail(runtime, req, res, 'trivium.private', error);
        }
    });

    router.post('/trivium/delete', async (req, res) => {
        try {
            const user = getUserContext(req);
            const session = await runtime.sessions.assertSession(getSessionToken(req), user);
            const payload = (req.body ?? {}) as TriviumDeleteRequest;
            const database = getTriviumDatabaseName(payload.database);
            if (!await runtime.permissions.authorize(user, session, { resource: 'trivium.private', target: database })) {
                throw new Error(`Permission not granted: trivium.private for ${database}`);
            }

            await runtime.trivium.delete(user, session.extension.id, payload);
            await runtime.audit.logUsage(user, session.extension.id, 'Trivium delete', {
                database,
                id: payload.id,
            });
            ok(res, { ok: true });
        } catch (error) {
            fail(runtime, req, res, 'trivium.private', error);
        }
    });

    router.post('/trivium/bulk-delete', async (req, res) => {
        try {
            const user = getUserContext(req);
            const session = await runtime.sessions.assertSession(getSessionToken(req), user);
            const payload = (req.body ?? {}) as TriviumBulkDeleteRequest;
            const database = getTriviumDatabaseName(payload.database);
            if (!await runtime.permissions.authorize(user, session, { resource: 'trivium.private', target: database })) {
                throw new Error(`Permission not granted: trivium.private for ${database}`);
            }

            const result = await runtime.trivium.bulkDelete(user, session.extension.id, payload);
            await runtime.audit.logUsage(user, session.extension.id, 'Trivium bulk delete', {
                database,
                totalCount: result.totalCount,
                successCount: result.successCount,
                failureCount: result.failureCount,
            });
            ok(res, result);
        } catch (error) {
            fail(runtime, req, res, 'trivium.private', error);
        }
    });

    router.post('/trivium/link', async (req, res) => {
        try {
            const user = getUserContext(req);
            const session = await runtime.sessions.assertSession(getSessionToken(req), user);
            const payload = (req.body ?? {}) as TriviumLinkRequest;
            const database = getTriviumDatabaseName(payload.database);
            if (!await runtime.permissions.authorize(user, session, { resource: 'trivium.private', target: database })) {
                throw new Error(`Permission not granted: trivium.private for ${database}`);
            }

            const dbPath = resolvePrivateTriviumDatabasePath(user, session.extension.id, database);
            await runtime.core.linkTrivium(dbPath, {
                ...payload,
                database,
            });
            await runtime.audit.logUsage(user, session.extension.id, 'Trivium link', {
                database,
                src: payload.src,
                dst: payload.dst,
            });
            ok(res, { ok: true });
        } catch (error) {
            fail(runtime, req, res, 'trivium.private', error);
        }
    });

    router.post('/trivium/bulk-link', async (req, res) => {
        try {
            const user = getUserContext(req);
            const session = await runtime.sessions.assertSession(getSessionToken(req), user);
            const payload = (req.body ?? {}) as TriviumBulkLinkRequest;
            const database = getTriviumDatabaseName(payload.database);
            if (!await runtime.permissions.authorize(user, session, { resource: 'trivium.private', target: database })) {
                throw new Error(`Permission not granted: trivium.private for ${database}`);
            }

            const result = await runtime.trivium.bulkLink(user, session.extension.id, payload);
            await runtime.audit.logUsage(user, session.extension.id, 'Trivium bulk link', {
                database,
                totalCount: result.totalCount,
                successCount: result.successCount,
                failureCount: result.failureCount,
            });
            ok(res, result);
        } catch (error) {
            fail(runtime, req, res, 'trivium.private', error);
        }
    });

    router.post('/trivium/unlink', async (req, res) => {
        try {
            const user = getUserContext(req);
            const session = await runtime.sessions.assertSession(getSessionToken(req), user);
            const payload = (req.body ?? {}) as TriviumUnlinkRequest;
            const database = getTriviumDatabaseName(payload.database);
            if (!await runtime.permissions.authorize(user, session, { resource: 'trivium.private', target: database })) {
                throw new Error(`Permission not granted: trivium.private for ${database}`);
            }

            const dbPath = resolvePrivateTriviumDatabasePath(user, session.extension.id, database);
            await runtime.core.unlinkTrivium(dbPath, {
                ...payload,
                database,
            });
            await runtime.audit.logUsage(user, session.extension.id, 'Trivium unlink', {
                database,
                src: payload.src,
                dst: payload.dst,
            });
            ok(res, { ok: true });
        } catch (error) {
            fail(runtime, req, res, 'trivium.private', error);
        }
    });

    router.post('/trivium/bulk-unlink', async (req, res) => {
        try {
            const user = getUserContext(req);
            const session = await runtime.sessions.assertSession(getSessionToken(req), user);
            const payload = (req.body ?? {}) as TriviumBulkUnlinkRequest;
            const database = getTriviumDatabaseName(payload.database);
            if (!await runtime.permissions.authorize(user, session, { resource: 'trivium.private', target: database })) {
                throw new Error(`Permission not granted: trivium.private for ${database}`);
            }

            const result = await runtime.trivium.bulkUnlink(user, session.extension.id, payload);
            await runtime.audit.logUsage(user, session.extension.id, 'Trivium bulk unlink', {
                database,
                totalCount: result.totalCount,
                successCount: result.successCount,
                failureCount: result.failureCount,
            });
            ok(res, result);
        } catch (error) {
            fail(runtime, req, res, 'trivium.private', error);
        }
    });

    router.post('/trivium/neighbors', async (req, res) => {
        try {
            const user = getUserContext(req);
            const session = await runtime.sessions.assertSession(getSessionToken(req), user);
            const payload = (req.body ?? {}) as TriviumNeighborsRequest;
            const database = getTriviumDatabaseName(payload.database);
            if (!await runtime.permissions.authorize(user, session, { resource: 'trivium.private', target: database })) {
                throw new Error(`Permission not granted: trivium.private for ${database}`);
            }

            const result = await runtime.trivium.neighbors(user, session.extension.id, payload);
            await runtime.audit.logUsage(user, session.extension.id, 'Trivium neighbors', {
                database,
                id: payload.id,
                depth: payload.depth ?? 1,
            });
            ok(res, result);
        } catch (error) {
            fail(runtime, req, res, 'trivium.private', error);
        }
    });

    router.post('/trivium/search', async (req, res) => {
        try {
            const user = getUserContext(req);
            const session = await runtime.sessions.assertSession(getSessionToken(req), user);
            const payload = (req.body ?? {}) as TriviumSearchRequest;
            const database = getTriviumDatabaseName(payload.database);
            if (!await runtime.permissions.authorize(user, session, { resource: 'trivium.private', target: database })) {
                throw new Error(`Permission not granted: trivium.private for ${database}`);
            }

            const hits = await runtime.trivium.search(user, session.extension.id, payload);
            await runtime.audit.logUsage(user, session.extension.id, 'Trivium search', {
                database,
                topK: payload.topK ?? 5,
                expandDepth: payload.expandDepth ?? 0,
            });
            ok(res, { hits });
        } catch (error) {
            fail(runtime, req, res, 'trivium.private', error);
        }
    });

    router.post('/trivium/search-advanced', async (req, res) => {
        try {
            const user = getUserContext(req);
            const session = await runtime.sessions.assertSession(getSessionToken(req), user);
            const payload = (req.body ?? {}) as TriviumSearchAdvancedRequest;
            const database = getTriviumDatabaseName(payload.database);
            if (!await runtime.permissions.authorize(user, session, { resource: 'trivium.private', target: database })) {
                throw new Error(`Permission not granted: trivium.private for ${database}`);
            }

            const hits = await runtime.trivium.searchAdvanced(user, session.extension.id, payload);
            await runtime.audit.logUsage(user, session.extension.id, 'Trivium advanced search', {
                database,
                topK: payload.topK ?? 5,
                expandDepth: payload.expandDepth ?? 2,
            });
            ok(res, { hits });
        } catch (error) {
            fail(runtime, req, res, 'trivium.private', error);
        }
    });

    router.post('/trivium/search-hybrid', async (req, res) => {
        try {
            const user = getUserContext(req);
            const session = await runtime.sessions.assertSession(getSessionToken(req), user);
            const payload = (req.body ?? {}) as TriviumSearchHybridRequest;
            const database = getTriviumDatabaseName(payload.database);
            if (!await runtime.permissions.authorize(user, session, { resource: 'trivium.private', target: database })) {
                throw new Error(`Permission not granted: trivium.private for ${database}`);
            }

            const hits = await runtime.trivium.searchHybrid(user, session.extension.id, payload);
            await runtime.audit.logUsage(user, session.extension.id, 'Trivium hybrid search', {
                database,
                topK: payload.topK ?? 5,
                expandDepth: payload.expandDepth ?? 2,
            });
            ok(res, { hits });
        } catch (error) {
            fail(runtime, req, res, 'trivium.private', error);
        }
    });

    router.post('/trivium/filter-where', async (req, res) => {
        try {
            const user = getUserContext(req);
            const session = await runtime.sessions.assertSession(getSessionToken(req), user);
            const payload = (req.body ?? {}) as TriviumFilterWhereRequest;
            const database = getTriviumDatabaseName(payload.database);
            if (!await runtime.permissions.authorize(user, session, { resource: 'trivium.private', target: database })) {
                throw new Error(`Permission not granted: trivium.private for ${database}`);
            }

            const nodes = await runtime.trivium.filterWhere(user, session.extension.id, payload);
            await runtime.audit.logUsage(user, session.extension.id, 'Trivium filter where', {
                database,
                count: nodes.length,
            });
            ok(res, { nodes });
        } catch (error) {
            fail(runtime, req, res, 'trivium.private', error);
        }
    });

    router.post('/trivium/query', async (req, res) => {
        try {
            const user = getUserContext(req);
            const session = await runtime.sessions.assertSession(getSessionToken(req), user);
            const payload = (req.body ?? {}) as TriviumQueryRequest;
            const database = getTriviumDatabaseName(payload.database);
            if (!await runtime.permissions.authorize(user, session, { resource: 'trivium.private', target: database })) {
                throw new Error(`Permission not granted: trivium.private for ${database}`);
            }

            const rows = await runtime.trivium.query(user, session.extension.id, payload);
            await runtime.audit.logUsage(user, session.extension.id, 'Trivium query', {
                database,
                rowCount: rows.length,
            });
            ok(res, { rows });
        } catch (error) {
            fail(runtime, req, res, 'trivium.private', error);
        }
    });

    router.post('/trivium/index-text', async (req, res) => {
        try {
            const user = getUserContext(req);
            const session = await runtime.sessions.assertSession(getSessionToken(req), user);
            const payload = (req.body ?? {}) as TriviumIndexTextRequest;
            const database = getTriviumDatabaseName(payload.database);
            if (!await runtime.permissions.authorize(user, session, { resource: 'trivium.private', target: database })) {
                throw new Error(`Permission not granted: trivium.private for ${database}`);
            }

            const dbPath = resolvePrivateTriviumDatabasePath(user, session.extension.id, database);
            await runtime.core.indexTextTrivium(dbPath, {
                ...payload,
                database,
            });
            await runtime.audit.logUsage(user, session.extension.id, 'Trivium index text', {
                database,
                id: payload.id,
            });
            ok(res, { ok: true });
        } catch (error) {
            fail(runtime, req, res, 'trivium.private', error);
        }
    });

    router.post('/trivium/index-keyword', async (req, res) => {
        try {
            const user = getUserContext(req);
            const session = await runtime.sessions.assertSession(getSessionToken(req), user);
            const payload = (req.body ?? {}) as TriviumIndexKeywordRequest;
            const database = getTriviumDatabaseName(payload.database);
            if (!await runtime.permissions.authorize(user, session, { resource: 'trivium.private', target: database })) {
                throw new Error(`Permission not granted: trivium.private for ${database}`);
            }

            const dbPath = resolvePrivateTriviumDatabasePath(user, session.extension.id, database);
            await runtime.core.indexKeywordTrivium(dbPath, {
                ...payload,
                database,
            });
            await runtime.audit.logUsage(user, session.extension.id, 'Trivium index keyword', {
                database,
                id: payload.id,
            });
            ok(res, { ok: true });
        } catch (error) {
            fail(runtime, req, res, 'trivium.private', error);
        }
    });

    router.post('/trivium/build-text-index', async (req, res) => {
        try {
            const user = getUserContext(req);
            const session = await runtime.sessions.assertSession(getSessionToken(req), user);
            const payload = (req.body ?? {}) as TriviumBuildTextIndexRequest;
            const database = getTriviumDatabaseName(payload.database);
            if (!await runtime.permissions.authorize(user, session, { resource: 'trivium.private', target: database })) {
                throw new Error(`Permission not granted: trivium.private for ${database}`);
            }

            const dbPath = resolvePrivateTriviumDatabasePath(user, session.extension.id, database);
            await runtime.core.buildTextIndexTrivium(dbPath, {
                ...payload,
                database,
            });
            await runtime.audit.logUsage(user, session.extension.id, 'Trivium build text index', {
                database,
            });
            ok(res, { ok: true });
        } catch (error) {
            fail(runtime, req, res, 'trivium.private', error);
        }
    });

    router.post('/trivium/flush', async (req, res) => {
        try {
            const user = getUserContext(req);
            const session = await runtime.sessions.assertSession(getSessionToken(req), user);
            const payload = (req.body ?? {}) as TriviumFlushRequest;
            const database = getTriviumDatabaseName(payload.database);
            if (!await runtime.permissions.authorize(user, session, { resource: 'trivium.private', target: database })) {
                throw new Error(`Permission not granted: trivium.private for ${database}`);
            }

            await runtime.trivium.flush(user, session.extension.id, payload);
            await runtime.audit.logUsage(user, session.extension.id, 'Trivium flush', {
                database,
            });
            ok(res, { ok: true });
        } catch (error) {
            fail(runtime, req, res, 'trivium.private', error);
        }
    });

    router.post('/trivium/stat', async (req, res) => {
        try {
            const user = getUserContext(req);
            const session = await runtime.sessions.assertSession(getSessionToken(req), user);
            const payload = (req.body ?? {}) as TriviumStatRequest;
            const database = getTriviumDatabaseName(payload.database);
            if (!await runtime.permissions.authorize(user, session, { resource: 'trivium.private', target: database })) {
                throw new Error(`Permission not granted: trivium.private for ${database}`);
            }

            const result = await runtime.trivium.stat(user, session.extension.id, payload);
            await runtime.audit.logUsage(user, session.extension.id, 'Trivium stat', {
                database,
                nodeCount: result.nodeCount,
            });
            ok(res, result);
        } catch (error) {
            fail(runtime, req, res, 'trivium.private', error);
        }
    });

    router.get('/trivium/databases', async (req, res) => {
        try {
            const user = getUserContext(req);
            const session = await runtime.sessions.assertSession(getSessionToken(req), user);
            if (!await runtime.permissions.authorize(user, session, { resource: 'trivium.private' }, false)) {
                throw new Error('Permission not granted: trivium.private');
            }

            const result = listPrivateTriviumDatabases(user, session.extension.id);
            await runtime.audit.logUsage(user, session.extension.id, 'Trivium list databases', {
                count: result.databases.length,
            });
            ok(res, result);
        } catch (error) {
            fail(runtime, req, res, 'trivium.private', error);
        }
    });

    router.post('/http/fetch', async (req, res) => {
        try {
            const user = getUserContext(req);
            const session = await runtime.sessions.assertSession(getSessionToken(req), user);
            const hostname = normalizeHostname(String(req.body?.url ?? ''));
            if (!await runtime.permissions.authorize(user, session, { resource: 'http.fetch', target: hostname })) {
                throw new Error(`Permission not granted: http.fetch for ${hostname}`);
            }

            const result = await runtime.http.fetch(user, req.body);
            await runtime.audit.logUsage(user, session.extension.id, 'HTTP fetch', { hostname });
            ok(res, result);
        } catch (error) {
            fail(runtime, req, res, 'http.fetch', error);
        }
    });

    router.post('/http/fetch-open', async (req, res) => {
        const payload = (req.body ?? {}) as HttpFetchOpenRequest;
        let user: ReturnType<typeof getUserContext> | undefined;
        let session: Awaited<ReturnType<AuthorityRuntime['sessions']['assertSession']>> | undefined;
        let bodyTransferIdToDiscard: string | undefined;
        let responseTransferIdToDiscard: string | undefined;
        try {
            user = getUserContext(req);
            session = await runtime.sessions.assertSession(getSessionToken(req), user);
            const hostname = normalizeHostname(String(payload.url ?? ''));
            if (!await runtime.permissions.authorize(user, session, { resource: 'http.fetch', target: hostname })) {
                throw new Error(`Permission not granted: http.fetch for ${hostname}`);
            }
            if (payload.body !== undefined && payload.bodyTransferId) {
                throw new Error('HTTP fetch body and bodyTransferId cannot both be provided');
            }

            const bodyTransfer = payload.bodyTransferId
                ? runtime.transfers.get(user, session.extension.id, payload.bodyTransferId, 'http.fetch')
                : undefined;
            bodyTransferIdToDiscard = payload.bodyTransferId;

            const responseTransfer = await runtime.transfers.init(user, session.extension.id, { resource: 'http.fetch' });
            responseTransferIdToDiscard = responseTransfer.transferId;
            const responseTransferRecord = runtime.transfers.get(user, session.extension.id, responseTransfer.transferId, 'http.fetch');
            const result = await runtime.http.openFetch(user, {
                url: payload.url,
                ...(payload.method === undefined ? {} : { method: payload.method }),
                ...(payload.headers === undefined ? {} : { headers: payload.headers }),
                ...(bodyTransfer
                    ? { bodySourcePath: bodyTransfer.filePath }
                    : payload.body === undefined
                        ? {}
                        : {
                            body: payload.body,
                            ...(payload.bodyEncoding === undefined ? {} : { bodyEncoding: payload.bodyEncoding }),
                        }),
                responsePath: responseTransferRecord.filePath,
            });
            const finalizedTransfer = await runtime.transfers.promoteToDownload(user, session.extension.id, responseTransfer.transferId);
            await runtime.audit.logUsage(user, session.extension.id, 'HTTP fetch', {
                hostname,
                ...(bodyTransfer ? { requestVia: 'transfer' } : {}),
                ...(finalizedTransfer.sizeBytes > DATA_TRANSFER_INLINE_THRESHOLD_BYTES ? { responseVia: 'transfer' } : {}),
            });

            if (finalizedTransfer.sizeBytes <= DATA_TRANSFER_INLINE_THRESHOLD_BYTES) {
                const bytes = fs.readFileSync(responseTransferRecord.filePath);
                await runtime.transfers.discard(user, session.extension.id, responseTransfer.transferId).catch(() => undefined);
                responseTransferIdToDiscard = undefined;
                ok(res, {
                    mode: 'inline',
                    url: result.url,
                    hostname: result.hostname,
                    status: result.status,
                    ok: result.ok,
                    headers: result.headers,
                    body: decodeHttpResponseBody(bytes, result.bodyEncoding),
                    bodyEncoding: result.bodyEncoding,
                    contentType: result.contentType,
                });
                return;
            }

            responseTransferIdToDiscard = undefined;
            ok(res, {
                mode: 'transfer',
                url: result.url,
                hostname: result.hostname,
                status: result.status,
                ok: result.ok,
                headers: result.headers,
                bodyEncoding: result.bodyEncoding,
                contentType: result.contentType,
                transfer: finalizedTransfer,
            });
        } catch (error) {
            fail(runtime, req, res, 'http.fetch', error);
        } finally {
            if (user && session && bodyTransferIdToDiscard) {
                await runtime.transfers.discard(user, session.extension.id, bodyTransferIdToDiscard).catch(() => undefined);
            }
            if (user && session && responseTransferIdToDiscard) {
                await runtime.transfers.discard(user, session.extension.id, responseTransferIdToDiscard).catch(() => undefined);
            }
        }
    });

    router.post('/jobs/create', async (req, res) => {
        try {
            const user = getUserContext(req);
            const session = await runtime.sessions.assertSession(getSessionToken(req), user);
            const jobType = String(req.body?.type ?? '');
            if (!await runtime.permissions.authorize(user, session, { resource: 'jobs.background', target: jobType })) {
                throw new Error(`Permission not granted: jobs.background for ${jobType}`);
            }

            const jobOptions: Record<string, unknown> = {};
            if (typeof req.body?.timeoutMs === 'number') jobOptions.timeoutMs = req.body.timeoutMs;
            if (typeof req.body?.idempotencyKey === 'string') jobOptions.idempotencyKey = req.body.idempotencyKey;
            if (typeof req.body?.maxAttempts === 'number') jobOptions.maxAttempts = req.body.maxAttempts;
            const job = await runtime.jobs.create(user, session.extension.id, jobType, req.body?.payload ?? {}, jobOptions);
            await runtime.audit.logUsage(user, session.extension.id, 'Job created', { jobId: job.id, jobType });
            ok(res, job);
        } catch (error) {
            fail(runtime, req, res, 'jobs.background', error);
        }
    });

    router.get('/jobs', async (req, res) => {
        try {
            const user = getUserContext(req);
            const session = await runtime.sessions.assertSession(getSessionToken(req), user);
            ok(res, await runtime.jobs.list(user, session.extension.id));
        } catch (error) {
            fail(runtime, req, res, 'jobs.background', error);
        }
    });

    router.get('/jobs/:id', async (req, res) => {
        try {
            const user = getUserContext(req);
            const session = await runtime.sessions.assertSession(getSessionToken(req), user);
            const job = await runtime.jobs.get(user, String(req.params?.id ?? ''));
            if (!job || job.extensionId !== session.extension.id) {
                throw new Error('Job not found');
            }

            ok(res, job);
        } catch (error) {
            fail(runtime, req, res, 'jobs.background', error);
        }
    });

    router.post('/jobs/:id/cancel', async (req, res) => {
        try {
            const user = getUserContext(req);
            const session = await runtime.sessions.assertSession(getSessionToken(req), user);
            const job = await runtime.jobs.cancel(user, session.extension.id, String(req.params?.id ?? ''));
            await runtime.audit.logUsage(user, session.extension.id, 'Job cancelled', { jobId: job.id });
            ok(res, job);
        } catch (error) {
            fail(runtime, req, res, 'jobs.background', error);
        }
    });

    router.get('/events/stream', async (req, res) => {
        try {
            const user = getUserContext(req);
            const session = await runtime.sessions.assertSession(getSessionToken(req), user);
            const channel = String(req.query?.channel ?? `extension:${session.extension.id}`);
            if (!await runtime.permissions.authorize(user, session, { resource: 'events.stream', target: channel })) {
                throw new Error(`Permission not granted: events.stream for ${channel}`);
            }

            res.setHeader('Content-Type', 'text/event-stream');
            res.setHeader('Cache-Control', 'no-cache');
            res.setHeader('Connection', 'keep-alive');
            res.write(': connected\n\n');

            const paths = getUserAuthorityPaths(user);
            const cleanup = runtime.events.register(paths.controlDbFile, user.handle, channel, res);
            req.on?.('close', cleanup);
            req.on?.('end', cleanup);
        } catch (error) {
            fail(runtime, req, res, 'events.stream', error);
        }
    });

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

import type {
    BlobTransferCommitRequest,
    DataTransferAppendRequest,
    DataTransferInitRequest,
    DataTransferManifestResponse,
    DataTransferReadRequest,
    PrivateFileDeleteRequest,
    PrivateFileMkdirRequest,
    PrivateFileReadDirRequest,
    PrivateFileReadRequest,
    PrivateFileStatRequest,
    PrivateFileTransferCommitRequest,
    PrivateFileWriteRequest,
} from '@stdo/shared-types';
import type { AuthorityRuntime } from '../runtime.js';
import type { AuthorityRequest, AuthorityResponse } from '../types.js';
import { getSessionToken, getUserContext } from '../utils.js';

type RouterLike = {
    get(path: string, handler: (req: AuthorityRequest, res: AuthorityResponse) => void | Promise<void>): void;
    post(path: string, handler: (req: AuthorityRequest, res: AuthorityResponse) => void | Promise<void>): void;
};

type RouteFailureHandler = (runtime: AuthorityRuntime, req: AuthorityRequest, res: AuthorityResponse, extensionId: string, error: unknown) => void;

function ok(res: AuthorityResponse, data: unknown): void {
    res.json(data);
}

export function registerStorageRoutes(router: RouterLike, runtime: AuthorityRuntime, fail: RouteFailureHandler): void {
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

    router.post('/transfers/:id/status', async (req, res) => {
        try {
            const user = getUserContext(req);
            const session = await runtime.sessions.assertSession(getSessionToken(req), user);
            ok(res, runtime.transfers.status(user, session.extension.id, String(req.params?.id ?? '')));
        } catch (error) {
            fail(runtime, req, res, 'third-party/st-authority-sdk', error);
        }
    });

    router.post('/transfers/:id/manifest', async (req, res) => {
        try {
            const user = getUserContext(req);
            const session = await runtime.sessions.assertSession(getSessionToken(req), user);
            const manifest: DataTransferManifestResponse = runtime.transfers.manifest(user, session.extension.id, String(req.params?.id ?? ''));
            ok(res, manifest);
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
            if (payload.expectedChecksumSha256) {
                runtime.transfers.assertChecksum(user, session.extension.id, payload.transferId, payload.expectedChecksumSha256);
            }
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
            const inlineThreshold = await runtime.permissions.getEffectiveInlineThresholdBytes(user, session.extension.id, 'storageBlobRead');
            if (opened.record.size <= inlineThreshold) {
                ok(res, {
                    mode: 'inline',
                    ...(await runtime.storage.getBlob(user, session.extension.id, blobId)),
                });
                return;
            }

            const transfer = await runtime.transfers.openRead(user, session.extension.id, {
                resource: 'storage.blob',
                purpose: 'storageBlobRead',
                sourcePath: opened.sourcePath,
            });
            await runtime.audit.logUsage(user, session.extension.id, 'Blob read via transfer', { id: blobId, sizeBytes: opened.record.size });
            ok(res, {
                mode: 'transfer',
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
            if (payload.expectedChecksumSha256) {
                runtime.transfers.assertChecksum(user, session.extension.id, payload.transferId, payload.expectedChecksumSha256);
            }
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
            const inlineThreshold = await runtime.permissions.getEffectiveInlineThresholdBytes(user, session.extension.id, 'privateFileRead');
            if (opened.entry.sizeBytes <= inlineThreshold) {
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
                purpose: 'privateFileRead',
                sourcePath: opened.sourcePath,
            });
            await runtime.audit.logUsage(user, session.extension.id, 'Private file read via transfer', { path: payload.path, sizeBytes: opened.entry.sizeBytes });
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
}

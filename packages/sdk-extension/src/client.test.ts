import { beforeEach, describe, expect, it, vi } from 'vitest';
import type {
    AuthorityProbeResponse,
    TriviumBulkDeleteRequest,
    TriviumBulkUpsertRequest,
} from '@stdo/shared-types';

const authorityRequestMock = vi.hoisted(() => vi.fn());
const toastrMock = vi.hoisted(() => ({
    warning: vi.fn(),
    success: vi.fn(),
    error: vi.fn(),
}));

(globalThis as typeof globalThis & { toastr: typeof toastrMock }).toastr = toastrMock;

vi.mock('./api.js', () => ({
    AuthorityLimitError: class AuthorityLimitError extends Error {
        constructor(message: string, public readonly status: number, payload?: { code?: string }) {
            super(message);
            this.name = 'AuthorityLimitError';
            this.code = payload?.code;
        }

        readonly code: string | undefined;
    },
    authorityRequest: authorityRequestMock,
    buildEventStreamUrl: vi.fn(() => 'http://localhost/events'),
    hostnameFromUrl: vi.fn(() => 'example.com'),
    isInvalidSessionError: vi.fn(() => false),
}));

vi.mock('./permission-prompt.js', () => ({
    showPermissionPrompt: vi.fn(),
}));

vi.mock('./security-center.js', () => ({
    openSecurityCenter: vi.fn(),
}));

describe('AuthorityClient', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        authorityRequestMock.mockReset();
        toastrMock.warning.mockReset();
        toastrMock.success.mockReset();
        toastrMock.error.mockReset();
    });

    it('caches probe responses and exposes feature checks', async () => {
        const { AuthorityClient } = await import('./client.js');
        authorityRequestMock.mockResolvedValue(buildProbe());

        const client = new AuthorityClient({
            extensionId: 'third-party/ext-a',
            displayName: 'Ext A',
            version: '0.1.0',
            installType: 'local',
            declaredPermissions: {},
        });

        const probe = await client.probe();
        expect(probe.features.trivium.queryPage).toBe(true);
        expect(client.hasFeature('trivium.queryPage')).toBe(true);
        expect(await client.probe()).toEqual(probe);
        expect(authorityRequestMock).toHaveBeenCalledTimes(1);
    });

    it('rejects page-aware Trivium calls when probe reports unsupported feature', async () => {
        const { AuthorityClient } = await import('./client.js');
        authorityRequestMock.mockResolvedValue(buildProbe({ queryPage: false }));

        const client = new AuthorityClient({
            extensionId: 'third-party/ext-a',
            displayName: 'Ext A',
            version: '0.1.0',
            installType: 'local',
            declaredPermissions: {},
        });

        await expect(client.trivium.queryPage({ cypher: 'MATCH (n) RETURN n' })).rejects.toThrow('Authority 当前版本尚未提供 Trivium 图查询分页能力');
        expect(authorityRequestMock).toHaveBeenCalledWith('/probe', { method: 'POST' });
    });

    it('throws AuthorityPermissionError for blocked permissions and opens security center', async () => {
        const { AuthorityClient, AuthorityPermissionError, isAuthorityPermissionError } = await import('./client.js');
        const { openSecurityCenter } = await import('./security-center.js');

        const client = new AuthorityClient({
            extensionId: 'third-party/ext-a',
            displayName: 'Ext A',
            version: '0.1.0',
            installType: 'local',
            declaredPermissions: {},
        });

        const blocked = {
            decision: 'blocked',
            key: 'jobs.background:reindex',
            riskLevel: 'medium',
            target: 'reindex',
            resource: 'jobs.background',
        } as const;

        Object.assign(client as object, {
            evaluatePermission: vi.fn().mockResolvedValue(blocked),
        });

        const error = await client.ensurePermission({
            resource: 'jobs.background',
            target: 'reindex',
            reason: '运行重建任务',
        }).catch(value => value);

        expect(error).toBeInstanceOf(AuthorityPermissionError);
        expect(isAuthorityPermissionError(error)).toBe(true);
        expect(error).toMatchObject({
            code: 'permission_blocked',
            decision: 'blocked',
            key: 'jobs.background:reindex',
            riskLevel: 'medium',
            target: 'reindex',
            resource: 'jobs.background',
        });
        expect(toastrMock.warning).toHaveBeenCalledTimes(1);
        expect(openSecurityCenter).toHaveBeenCalledWith({ focusExtensionId: 'third-party/ext-a' });
    });

    it('throws AuthorityPermissionError for unresolved prompts without opening security center', async () => {
        const { AuthorityClient, AuthorityPermissionError } = await import('./client.js');
        const { openSecurityCenter } = await import('./security-center.js');

        const client = new AuthorityClient({
            extensionId: 'third-party/ext-a',
            displayName: 'Ext A',
            version: '0.1.0',
            installType: 'local',
            declaredPermissions: {},
        });

        const prompt = {
            decision: 'prompt',
            key: 'storage.kv:*',
            riskLevel: 'low',
            target: '*',
            resource: 'storage.kv',
        } as const;

        Object.assign(client as object, {
            evaluatePermission: vi.fn().mockResolvedValue(prompt),
            requestPermission: vi.fn().mockResolvedValue(prompt),
        });

        const error = await client.ensurePermission({
            resource: 'storage.kv',
            reason: '读取测试键',
        }).catch(value => value);

        expect(error).toBeInstanceOf(AuthorityPermissionError);
        expect(error).toMatchObject({
            code: 'permission_not_granted',
            decision: 'prompt',
            key: 'storage.kv:*',
            riskLevel: 'low',
            target: '*',
            resource: 'storage.kv',
        });
        expect(toastrMock.warning).toHaveBeenCalledTimes(1);
        expect(openSecurityCenter).not.toHaveBeenCalled();
    });

    it('evaluates permissions in batch through the public permissions namespace', async () => {
        const { AuthorityClient } = await import('./client.js');
        authorityRequestMock
            .mockResolvedValueOnce(buildSession())
            .mockResolvedValueOnce({
                results: [
                    {
                        decision: 'prompt',
                        key: 'storage.kv:*',
                        riskLevel: 'low',
                        target: '*',
                        resource: 'storage.kv',
                    },
                    {
                        decision: 'blocked',
                        key: 'http.fetch:localhost',
                        riskLevel: 'high',
                        target: 'localhost',
                        resource: 'http.fetch',
                    },
                ],
            });

        const client = new AuthorityClient({
            extensionId: 'third-party/ext-a',
            displayName: 'Ext A',
            version: '0.1.0',
            installType: 'local',
            declaredPermissions: {},
        });

        const results = await client.permissions.evaluateBatch([
            { resource: 'storage.kv', reason: '读取测试键' },
            { resource: 'http.fetch', target: 'localhost', reason: '访问本地主机' },
        ]);

        expect(results).toHaveLength(2);
        expect(authorityRequestMock).toHaveBeenNthCalledWith(2, '/permissions/evaluate-batch', {
            method: 'POST',
            sessionToken: 'session-token',
            body: {
                requests: [
                    { resource: 'storage.kv', reason: '读取测试键' },
                    { resource: 'http.fetch', target: 'localhost', reason: '访问本地主机' },
                ],
            },
        });
    });

    it('explains granted permissions with a positive message', async () => {
        const { AuthorityClient } = await import('./client.js');

        const client = new AuthorityClient({
            extensionId: 'third-party/ext-a',
            displayName: 'Ext A',
            version: '0.1.0',
            installType: 'local',
            declaredPermissions: {},
        });

        Object.assign(client as object, {
            evaluatePermission: vi.fn().mockResolvedValue({
                decision: 'granted',
                key: 'sql.private:default',
                riskLevel: 'medium',
                target: 'default',
                resource: 'sql.private',
            }),
        });

        const explained = await client.permissions.explain({
            resource: 'sql.private',
            target: 'default',
            reason: '检查 SQL 权限',
        });

        expect(explained.evaluation.decision).toBe('granted');
        expect(explained.message).toBe('Ext A 当前已获得 私有 SQL 数据库 (default) 的访问授权。');
    });

    it('uses probe inline thresholds when deciding blob write transfer routing', async () => {
        const { AuthorityClient } = await import('./client.js');

        authorityRequestMock.mockResolvedValueOnce(buildProbe({
            inlineThresholdBytes: {
                storageBlobWrite: 8,
            },
        }));

        const client = new AuthorityClient({
            extensionId: 'third-party/ext-a',
            displayName: 'Ext A',
            version: '0.1.0',
            installType: 'local',
            declaredPermissions: {},
        });

        const putBlobWithTransfer = vi.fn(async () => ({
            id: 'blob-1',
            name: 'payload.txt',
            contentType: 'text/plain',
            sizeBytes: 12,
            createdAt: 't1',
        }));

        Object.assign(client as object, {
            ensurePermission: vi.fn().mockResolvedValue(undefined),
            putBlobWithTransfer,
        });

        await client.storage.blob.put({
            name: 'payload.txt',
            content: 'hello world!',
            encoding: 'utf8',
        });

        expect(authorityRequestMock).toHaveBeenCalledWith('/probe', { method: 'POST' });
        expect(putBlobWithTransfer).toHaveBeenCalledTimes(1);
    });

    it('prefers session-scoped effective limits over probe defaults for blob transfer routing', async () => {
        const { AuthorityClient } = await import('./client.js');

        const client = new AuthorityClient({
            extensionId: 'third-party/ext-a',
            displayName: 'Ext A',
            version: '0.1.0',
            installType: 'local',
            declaredPermissions: {},
        });

        const session = buildSession();
        session.limits.effectiveInlineThresholdBytes.storageBlobWrite = { bytes: 8, source: 'policy' };
        const putBlobWithTransfer = vi.fn(async () => ({
            id: 'blob-1',
            name: 'payload.txt',
            contentType: 'text/plain',
            sizeBytes: 12,
            createdAt: 't1',
        }));

        Object.assign(client as object, {
            session,
            ensurePermission: vi.fn().mockResolvedValue(undefined),
            putBlobWithTransfer,
        });

        await client.storage.blob.put({
            name: 'payload.txt',
            content: 'hello world!',
            encoding: 'utf8',
        });

        expect(authorityRequestMock).not.toHaveBeenCalled();
        expect(putBlobWithTransfer).toHaveBeenCalledTimes(1);
    });

    it('fails fast with AuthorityLimitError when session-scoped transfer ceiling is exceeded', async () => {
        const { AuthorityClient } = await import('./client.js');

        const client = new AuthorityClient({
            extensionId: 'third-party/ext-a',
            displayName: 'Ext A',
            version: '0.1.0',
            installType: 'local',
            declaredPermissions: {},
        });

        const session = buildSession();
        session.limits.effectiveInlineThresholdBytes.storageBlobWrite = { bytes: 8, source: 'policy' };
        session.limits.effectiveTransferMaxBytes.storageBlobWrite = { bytes: 8, source: 'policy' };
        const initializeTransfer = vi.fn();

        Object.assign(client as object, {
            session,
            ensurePermission: vi.fn().mockResolvedValue(undefined),
            initializeTransfer,
        });

        await expect(client.storage.blob.put({
            name: 'payload.txt',
            content: 'hello world!',
            encoding: 'utf8',
        })).rejects.toMatchObject({
            name: 'AuthorityLimitError',
            status: 413,
            code: 'limit_exceeded',
        });

        expect(initializeTransfer).not.toHaveBeenCalled();
    });

    it('uses probe inline thresholds when deciding private file write transfer routing', async () => {
        const { AuthorityClient } = await import('./client.js');

        authorityRequestMock.mockResolvedValueOnce(buildProbe({
            inlineThresholdBytes: {
                privateFileWrite: 4,
            },
        }));

        const client = new AuthorityClient({
            extensionId: 'third-party/ext-a',
            displayName: 'Ext A',
            version: '0.1.0',
            installType: 'local',
            declaredPermissions: {},
        });

        const writePrivateFileWithTransfer = vi.fn(async () => ({
            name: 'note.txt',
            path: '/note.txt',
            kind: 'file',
            size: 10,
            updatedAt: 't1',
        }));

        Object.assign(client as object, {
            ensurePermission: vi.fn().mockResolvedValue(undefined),
            writePrivateFileWithTransfer,
        });

        await client.fs.writeFile('/note.txt', 'abcdefghij', { encoding: 'utf8' });

        expect(writePrivateFileWithTransfer).toHaveBeenCalledTimes(1);
    });

    it('uses probe inline thresholds when deciding http.fetch request transfer routing', async () => {
        const { AuthorityClient } = await import('./client.js');

        authorityRequestMock.mockResolvedValueOnce(buildProbe({
            inlineThresholdBytes: {
                httpFetchRequest: 6,
            },
        }));

        const client = new AuthorityClient({
            extensionId: 'third-party/ext-a',
            displayName: 'Ext A',
            version: '0.1.0',
            installType: 'local',
            declaredPermissions: {},
        });

        const initializeTransfer = vi.fn(async () => ({
            transferId: 'transfer-1',
            resource: 'http.fetch',
            chunkSize: 256,
            maxBytes: 1024,
            sizeBytes: 11,
            updatedAt: 't1',
        }));
        const appendTransferBytes = vi.fn(async () => undefined);
        const requestWithSession = vi.fn(async () => ({
            mode: 'inline',
            url: 'https://example.com',
            hostname: 'example.com',
            status: 200,
            ok: true,
            headers: {},
            body: 'ok',
            bodyEncoding: 'utf8',
            contentType: 'text/plain',
        }));

        Object.assign(client as object, {
            ensurePermission: vi.fn().mockResolvedValue(undefined),
            initializeTransfer,
            appendTransferBytes,
            requestWithSession,
        });

        await client.http.fetch({
            url: 'https://example.com',
            method: 'POST',
            body: 'hello world',
            bodyEncoding: 'utf8',
        });

        expect(initializeTransfer).toHaveBeenCalledWith('http.fetch', 'httpFetchRequest');
        expect(appendTransferBytes).toHaveBeenCalledTimes(1);
        expect(requestWithSession).toHaveBeenCalledWith('/http/fetch-open', expect.objectContaining({
            method: 'POST',
            body: expect.objectContaining({ bodyTransferId: 'transfer-1' }),
        }));
    });

    it('exposes low-level transfers namespace for resumable status, append, read, and discard', async () => {
        const { AuthorityClient } = await import('./client.js');

        authorityRequestMock
            .mockResolvedValueOnce(buildSession())
            .mockResolvedValueOnce({
                transferId: 'transfer-1',
                resource: 'storage.blob',
                purpose: 'storageBlobWrite',
                chunkSize: 256,
                maxBytes: 1024,
                createdAt: 't0',
                updatedAt: 't0',
                sizeBytes: 0,
                direction: 'upload',
                checksumSha256: 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855',
                resumable: true,
            })
            .mockResolvedValueOnce({
                transferId: 'transfer-1',
                resource: 'storage.blob',
                purpose: 'storageBlobWrite',
                chunkSize: 256,
                maxBytes: 1024,
                createdAt: 't0',
                updatedAt: 't1',
                sizeBytes: 5,
                direction: 'upload',
                checksumSha256: '2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824',
                resumable: true,
            })
            .mockResolvedValueOnce({
                transferId: 'transfer-1',
                resource: 'storage.blob',
                purpose: 'storageBlobWrite',
                chunkSize: 262144,
                maxBytes: 1024,
                createdAt: 't1',
                updatedAt: 't2',
                sizeBytes: 5,
                direction: 'upload',
                checksumSha256: '2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824',
                resumable: true,
                chunkCount: 1,
                chunks: [
                    {
                        index: 0,
                        offset: 0,
                        sizeBytes: 5,
                        checksumSha256: '2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824',
                    },
                ],
            })
            .mockResolvedValueOnce({
                transferId: 'transfer-1',
                sizeBytes: 10,
                updatedAt: 't2',
                checksumSha256: '0f683f2427b4ee20118a12dde6648d29396f813df27f56c3f3721e1a4dd7a3b7',
            })
            .mockResolvedValueOnce({
                transferId: 'transfer-1',
                offset: 0,
                content: Buffer.from('hello', 'utf8').toString('base64'),
                encoding: 'base64',
                sizeBytes: 10,
                eof: false,
                updatedAt: 't3',
                checksumSha256: '0f683f2427b4ee20118a12dde6648d29396f813df27f56c3f3721e1a4dd7a3b7',
            })
            .mockResolvedValueOnce(undefined);

        const client = new AuthorityClient({
            extensionId: 'third-party/ext-a',
            displayName: 'Ext A',
            version: '0.1.0',
            installType: 'local',
            declaredPermissions: {},
        });

        Object.assign(client as object, {
            ensurePermission: vi.fn().mockResolvedValue(undefined),
        });

        const initialized = await client.transfers.init({
            resource: 'storage.blob',
            purpose: 'storageBlobWrite',
        });
        expect(initialized.resumable).toBe(true);

        const status = await client.transfers.status('transfer-1');
        expect(status.sizeBytes).toBe(5);
        expect(status.checksumSha256).toMatch(/^[a-f0-9]{64}$/);

        const manifest = await client.transfers.manifest('transfer-1');
        expect(manifest.chunkCount).toBe(1);
        expect(manifest.chunks[0]?.offset).toBe(0);

        const appended = await client.transfers.append('transfer-1', new TextEncoder().encode(' world'), { offset: 5 });
        expect(appended.sizeBytes).toBe(10);

        const chunk = await client.transfers.read('transfer-1');
        expect(new TextDecoder().decode(chunk.bytes)).toBe('hello');
        expect(chunk.eof).toBe(false);

        await client.transfers.discard('transfer-1');

        expect(authorityRequestMock).toHaveBeenNthCalledWith(1, '/session/init', expect.objectContaining({ method: 'POST' }));
        expect(authorityRequestMock).toHaveBeenNthCalledWith(2, '/transfers/init', expect.objectContaining({
            method: 'POST',
            sessionToken: 'session-token',
            body: {
                resource: 'storage.blob',
                purpose: 'storageBlobWrite',
            },
        }));
        expect(authorityRequestMock).toHaveBeenNthCalledWith(3, '/transfers/transfer-1/status', expect.objectContaining({
            method: 'POST',
            sessionToken: 'session-token',
        }));
        expect(authorityRequestMock).toHaveBeenNthCalledWith(4, '/transfers/transfer-1/manifest', expect.objectContaining({
            method: 'POST',
            sessionToken: 'session-token',
        }));
        expect(authorityRequestMock).toHaveBeenNthCalledWith(5, '/transfers/transfer-1/append', expect.objectContaining({
            method: 'POST',
            sessionToken: 'session-token',
            body: expect.objectContaining({ offset: 5 }),
        }));
        expect(authorityRequestMock).toHaveBeenNthCalledWith(6, '/transfers/transfer-1/read', expect.objectContaining({
            method: 'POST',
            sessionToken: 'session-token',
            body: { offset: 0 },
        }));
        expect(authorityRequestMock).toHaveBeenNthCalledWith(7, '/transfers/transfer-1/discard', expect.objectContaining({
            method: 'POST',
            sessionToken: 'session-token',
        }));
    });

    it('splits items by chunk item count and estimated json bytes', async () => {
        const { splitAuthorityItemsIntoChunks } = await import('./client.js');

        const countChunks = splitAuthorityItemsIntoChunks([
            { value: 1 },
            { value: 2 },
            { value: 3 },
            { value: 4 },
            { value: 5 },
        ], {
            maxItemsPerChunk: 2,
            maxBytesPerChunk: 1024,
        });

        expect(countChunks).toHaveLength(3);
        expect(countChunks.map(chunk => chunk.itemCount)).toEqual([2, 2, 1]);
        expect(countChunks.map(chunk => chunk.itemOffset)).toEqual([0, 2, 4]);

        const byteChunks = splitAuthorityItemsIntoChunks([
            { text: 'a'.repeat(20) },
            { text: 'b'.repeat(20) },
            { text: 'c'.repeat(20) },
        ], {
            maxItemsPerChunk: 10,
            maxBytesPerChunk: 40,
        });

        expect(byteChunks).toHaveLength(3);
        expect(byteChunks.every(chunk => chunk.estimatedBytes <= 40)).toBe(true);
    });

    it('aggregates chunked Trivium bulk upsert progress and global indexes', async () => {
        const { AuthorityClient } = await import('./client.js');

        const client = new AuthorityClient({
            extensionId: 'third-party/ext-a',
            displayName: 'Ext A',
            version: '0.1.0',
            installType: 'local',
            declaredPermissions: {},
        });

        const progress = vi.fn();
        const bulkUpsertTriviumRequest = vi.fn(async (input: TriviumBulkUpsertRequest) => {
            if (input.items[0]?.externalId === 'node-a') {
                return {
                    totalCount: 2,
                    successCount: 1,
                    failureCount: 1,
                    failures: [{ index: 1, message: 'bad payload' }],
                    items: [{ index: 0, id: 101, action: 'inserted', externalId: 'node-a', namespace: 'graph' }],
                };
            }

            return {
                totalCount: 2,
                successCount: 2,
                failureCount: 0,
                failures: [],
                items: [
                    { index: 0, id: 102, action: 'updated', externalId: 'node-c', namespace: 'graph' },
                    { index: 1, id: 103, action: 'inserted', externalId: 'node-d', namespace: 'graph' },
                ],
            };
        });

        Object.assign(client as object, {
            requireFeature: vi.fn().mockResolvedValue(undefined),
            ensurePermission: vi.fn().mockResolvedValue(undefined),
            bulkUpsertTriviumRequest,
        });

        const result = await client.trivium.bulkUpsertChunked({
            database: 'graph',
            items: [
                { externalId: 'node-a', namespace: 'graph', vector: [1, 0], payload: { label: 'A' } },
                { externalId: 'node-b', namespace: 'graph', vector: [0, 1], payload: { label: 'B' } },
                { externalId: 'node-c', namespace: 'graph', vector: [1, 1], payload: { label: 'C' } },
                { externalId: 'node-d', namespace: 'graph', vector: [0, 0], payload: { label: 'D' } },
            ],
        }, {
            maxItemsPerChunk: 2,
            onProgress: progress,
        });

        expect(bulkUpsertTriviumRequest).toHaveBeenCalledTimes(2);
        expect(result.totalCount).toBe(4);
        expect(result.successCount).toBe(3);
        expect(result.failureCount).toBe(1);
        expect(result.failures).toEqual([
            expect.objectContaining({
                index: 1,
                globalIndex: 1,
                chunkIndex: 0,
                chunkItemIndex: 1,
                kind: 'item',
                message: 'bad payload',
            }),
        ]);
        expect(result.items).toEqual([
            expect.objectContaining({ index: 0, globalIndex: 0, chunkIndex: 0, chunkItemIndex: 0, id: 101 }),
            expect.objectContaining({ index: 2, globalIndex: 2, chunkIndex: 1, chunkItemIndex: 0, id: 102 }),
            expect.objectContaining({ index: 3, globalIndex: 3, chunkIndex: 1, chunkItemIndex: 1, id: 103 }),
        ]);
        expect(progress).toHaveBeenCalledTimes(2);
        expect(progress.mock.calls[0]?.[0]).toEqual(expect.objectContaining({
            totalChunks: 2,
            completedChunks: 1,
            totalItems: 4,
            completedItems: 2,
            successCount: 1,
            failureCount: 1,
        }));
        expect(progress.mock.calls[1]?.[0]).toEqual(expect.objectContaining({
            completedChunks: 2,
            completedItems: 4,
            successCount: 3,
            failureCount: 1,
        }));
    });

    it('records chunk-level failures for chunked Trivium bulk delete and continues', async () => {
        const { AuthorityClient } = await import('./client.js');

        const client = new AuthorityClient({
            extensionId: 'third-party/ext-a',
            displayName: 'Ext A',
            version: '0.1.0',
            installType: 'local',
            declaredPermissions: {},
        });

        const bulkDeleteTriviumRequest = vi.fn(async (input: TriviumBulkDeleteRequest) => {
            const firstExternalId = input.items[0]?.externalId;
            if (firstExternalId === 'node-c') {
                throw new Error('chunk write failed');
            }

            return {
                totalCount: input.items.length,
                successCount: input.items.length,
                failureCount: 0,
                failures: [],
            };
        });

        Object.assign(client as object, {
            requireFeature: vi.fn().mockResolvedValue(undefined),
            ensurePermission: vi.fn().mockResolvedValue(undefined),
            bulkDeleteTriviumRequest,
        });

        const result = await client.trivium.bulkDeleteChunked({
            database: 'graph',
            items: [
                { externalId: 'node-a', namespace: 'graph' },
                { externalId: 'node-b', namespace: 'graph' },
                { externalId: 'node-c', namespace: 'graph' },
                { externalId: 'node-d', namespace: 'graph' },
                { externalId: 'node-e', namespace: 'graph' },
            ],
        }, {
            maxItemsPerChunk: 2,
        });

        expect(bulkDeleteTriviumRequest).toHaveBeenCalledTimes(3);
        expect(result.chunkCount).toBe(3);
        expect(result.successCount).toBe(3);
        expect(result.failureCount).toBe(2);
        expect(result.failures).toEqual([
            expect.objectContaining({ index: 2, globalIndex: 2, chunkIndex: 1, chunkItemIndex: 0, kind: 'chunk', message: 'chunk write failed' }),
            expect.objectContaining({ index: 3, globalIndex: 3, chunkIndex: 1, chunkItemIndex: 1, kind: 'chunk', message: 'chunk write failed' }),
        ]);
        expect(result.chunks[1]).toEqual(expect.objectContaining({
            chunkIndex: 1,
            itemOffset: 2,
            itemCount: 2,
            successCount: 0,
            failureCount: 2,
            error: 'chunk write failed',
        }));
    });

    it('waits for background jobs to reach a terminal status', async () => {
        const { AuthorityClient } = await import('./client.js');

        const client = new AuthorityClient({
            extensionId: 'third-party/ext-a',
            displayName: 'Ext A',
            version: '0.1.0',
            installType: 'local',
            declaredPermissions: {},
        });

        const jobs = [
            { id: 'job-1', extensionId: 'third-party/ext-a', type: 'delay', status: 'queued', createdAt: 't1', updatedAt: 't1', progress: 0 },
            { id: 'job-1', extensionId: 'third-party/ext-a', type: 'delay', status: 'running', createdAt: 't1', updatedAt: 't2', progress: 50 },
            { id: 'job-1', extensionId: 'third-party/ext-a', type: 'delay', status: 'completed', createdAt: 't1', updatedAt: 't3', progress: 100 },
        ] as const;
        let index = 0;
        const requestWithSession = vi.fn(async () => jobs[Math.min(index++, jobs.length - 1)]);
        const onProgress = vi.fn();

        Object.assign(client as object, {
            requestWithSession,
        });

        const result = await client.jobs.waitForCompletion('job-1', {
            pollIntervalMs: 1,
            onProgress,
        });

        expect(result.status).toBe('completed');
        expect(requestWithSession).toHaveBeenCalledTimes(3);
        expect(onProgress).toHaveBeenCalledTimes(3);
        expect(onProgress.mock.calls[1]?.[0]).toEqual(expect.objectContaining({ status: 'running', progress: 50 }));
    });

    it('times out when background job does not complete in time', async () => {
        const { AuthorityClient } = await import('./client.js');

        const client = new AuthorityClient({
            extensionId: 'third-party/ext-a',
            displayName: 'Ext A',
            version: '0.1.0',
            installType: 'local',
            declaredPermissions: {},
        });

        Object.assign(client as object, {
            requestWithSession: vi.fn(async () => ({
                id: 'job-2',
                extensionId: 'third-party/ext-a',
                type: 'delay',
                status: 'running',
                createdAt: 't1',
                updatedAt: 't2',
                progress: 10,
            })),
        });

        await expect(client.jobs.waitForCompletion('job-2', {
            pollIntervalMs: 1,
            timeoutMs: 1,
        })).rejects.toThrow('Authority job job-2 did not complete within 1ms');
    });

    it('subscribes to job updates through authority.job events with polling fallback', async () => {
        vi.useFakeTimers();
        try {
            const { AuthorityClient } = await import('./client.js');

            const client = new AuthorityClient({
                extensionId: 'third-party/ext-a',
                displayName: 'Ext A',
                version: '0.1.0',
                installType: 'local',
                declaredPermissions: {},
            });

            let onEvent: ((event: { name: string; data: unknown }) => void) | undefined;
            const closeMock = vi.fn();
            const get = vi.fn()
                .mockResolvedValueOnce({
                    id: 'job-3',
                    extensionId: 'third-party/ext-a',
                    type: 'delay',
                    status: 'completed',
                    createdAt: 't1',
                    updatedAt: 't2',
                    progress: 100,
                });
            const onUpdate = vi.fn();

            Object.assign(client.events as object, {
                subscribe: vi.fn(async (options: { onEvent?: (event: { name: string; data: unknown }) => void }) => {
                    onEvent = options.onEvent;
                    return { close: closeMock };
                }),
            });
            Object.assign(client.jobs as object, { get });

            const subscription = await client.jobs.subscribe('job-3', {
                emitCurrent: false,
                pollIntervalMs: 5,
                onUpdate,
            });

            await onEvent?.({
                name: 'authority.job',
                data: {
                    id: 'job-3',
                    extensionId: 'third-party/ext-a',
                    type: 'delay',
                    status: 'running',
                    createdAt: 't1',
                    updatedAt: 't1',
                    progress: 30,
                },
            });
            expect(onUpdate).toHaveBeenCalledTimes(1);
            expect(onUpdate.mock.calls[0]?.[0]).toEqual(expect.objectContaining({ status: 'running', progress: 30 }));

            await vi.advanceTimersByTimeAsync(5);
            expect(get).toHaveBeenCalledTimes(1);
            expect(onUpdate).toHaveBeenCalledTimes(2);
            expect(onUpdate.mock.calls[1]?.[0]).toEqual(expect.objectContaining({ status: 'completed', progress: 100 }));
            expect(closeMock).toHaveBeenCalledTimes(1);

            subscription.close();
        } finally {
            vi.useRealTimers();
        }
    });

    it('serializes JSON through fs.writeJson helper', async () => {
        const { AuthorityClient } = await import('./client.js');

        const client = new AuthorityClient({
            extensionId: 'third-party/ext-a',
            displayName: 'Ext A',
            version: '0.1.0',
            installType: 'local',
            declaredPermissions: {},
        });

        const writeFile = vi.fn(async () => ({ name: 'config.json', path: '/config.json', kind: 'file', size: 2, updatedAt: 't1' }));
        Object.assign(client.fs as object, { writeFile });

        await client.fs.writeJson('/config.json', { enabled: true }, { createParents: true, space: 2 });

        expect(writeFile).toHaveBeenCalledWith('/config.json', '{\n  "enabled": true\n}', {
            createParents: true,
            encoding: 'utf8',
        });
    });

    it('serializes JSON through blob.putJsonLarge helper', async () => {
        const { AuthorityClient } = await import('./client.js');

        const client = new AuthorityClient({
            extensionId: 'third-party/ext-a',
            displayName: 'Ext A',
            version: '0.1.0',
            installType: 'local',
            declaredPermissions: {},
        });

        const put = vi.fn(async () => ({ id: 'blob-1', name: 'payload.json', contentType: 'application/json', sizeBytes: 2, createdAt: 't1' }));
        Object.assign(client.storage.blob as object, { put });

        await client.storage.blob.putJsonLarge({
            name: 'payload.json',
            value: { ok: true },
            space: 2,
        });

        expect(put).toHaveBeenCalledWith({
            name: 'payload.json',
            content: '{\n  "ok": true\n}',
            encoding: 'utf8',
            contentType: 'application/json',
        });
    });

    it('routes jobs.listPage through the paged jobs endpoint', async () => {
        const { AuthorityClient } = await import('./client.js');

        const client = new AuthorityClient({
            extensionId: 'third-party/ext-a',
            displayName: 'Ext A',
            version: '0.1.0',
            installType: 'local',
            declaredPermissions: {},
        });

        const requestWithSession = vi.fn(async () => ({
            jobs: [{ id: 'job-4', extensionId: 'third-party/ext-a', type: 'delay', status: 'queued', createdAt: 't1', updatedAt: 't1', progress: 0 }],
            page: { nextCursor: null, limit: 5, hasMore: false, totalCount: 1 },
        }));

        Object.assign(client as object, {
            requireFeature: vi.fn().mockResolvedValue(undefined),
            requestWithSession,
        });

        const result = await client.jobs.listPage({
            page: { limit: 5 },
        });

        expect(result.jobs).toHaveLength(1);
        expect(requestWithSession).toHaveBeenCalledWith('/jobs/list', {
            method: 'POST',
            body: {
                page: { limit: 5 },
            },
        });
    });

    it('routes jobs.requeue through the safe requeue endpoint', async () => {
        const { AuthorityClient } = await import('./client.js');

        const client = new AuthorityClient({
            extensionId: 'third-party/ext-a',
            displayName: 'Ext A',
            version: '0.1.0',
            installType: 'local',
            declaredPermissions: {},
        });

        const requestWithSession = vi.fn(async (path: string) => {
            if (path === '/jobs/job-1') {
                return {
                    id: 'job-1',
                    extensionId: 'third-party/ext-a',
                    type: 'delay',
                    status: 'failed',
                    createdAt: '2026-04-27T00:00:00.000Z',
                    updatedAt: '2026-04-27T00:00:01.000Z',
                    progress: 0,
                };
            }
            return {
                id: 'job-2',
                extensionId: 'third-party/ext-a',
                type: 'delay',
                status: 'queued',
                createdAt: '2026-04-27T00:00:02.000Z',
                updatedAt: '2026-04-27T00:00:02.000Z',
                progress: 0,
            };
        });

        Object.assign(client as object, {
            requireFeature: vi.fn().mockResolvedValue(undefined),
            ensurePermission: vi.fn().mockResolvedValue(undefined),
            requestWithSession,
        });

        const result = await client.jobs.requeue('job-1');

        expect(result.id).toBe('job-2');
        expect(requestWithSession).toHaveBeenNthCalledWith(1, '/jobs/job-1');
        expect(requestWithSession).toHaveBeenNthCalledWith(2, '/jobs/job-1/requeue', {
            method: 'POST',
        });
    });

    it('aggregates paged SQL query results through sql.pageAll', async () => {
        const { AuthorityClient } = await import('./client.js');

        const client = new AuthorityClient({
            extensionId: 'third-party/ext-a',
            displayName: 'Ext A',
            version: '0.1.0',
            installType: 'local',
            declaredPermissions: {},
        });

        const onPage = vi.fn();
        const query = vi.fn()
            .mockResolvedValueOnce({
                kind: 'query',
                columns: ['id'],
                rows: [{ id: 1 }, { id: 2 }],
                rowCount: 2,
                page: { nextCursor: '2', limit: 2, hasMore: true, totalCount: 3 },
            })
            .mockResolvedValueOnce({
                kind: 'query',
                columns: ['id'],
                rows: [{ id: 3 }],
                rowCount: 1,
                page: { nextCursor: null, limit: 2, hasMore: false, totalCount: 3 },
            });

        Object.assign(client as object, {
            requireFeature: vi.fn().mockResolvedValue(undefined),
        });
        Object.assign(client.sql as object, { query });

        const result = await client.sql.pageAll({
            database: 'graph',
            statement: 'SELECT id FROM notes ORDER BY id',
        }, {
            pageSize: 2,
            onPage,
        });

        expect(result.rows).toEqual([{ id: 1 }, { id: 2 }, { id: 3 }]);
        expect(result.rowCount).toBe(3);
        expect(query).toHaveBeenNthCalledWith(1, {
            database: 'graph',
            statement: 'SELECT id FROM notes ORDER BY id',
            page: { limit: 2 },
        });
        expect(query).toHaveBeenNthCalledWith(2, {
            database: 'graph',
            statement: 'SELECT id FROM notes ORDER BY id',
            page: { cursor: '2', limit: 2 },
        });
        expect(onPage).toHaveBeenCalledTimes(2);
    });

    it('stops sql.pageAll when maxPages is exceeded', async () => {
        const { AuthorityClient } = await import('./client.js');

        const client = new AuthorityClient({
            extensionId: 'third-party/ext-a',
            displayName: 'Ext A',
            version: '0.1.0',
            installType: 'local',
            declaredPermissions: {},
        });

        const query = vi.fn().mockResolvedValue({
            kind: 'query',
            columns: ['id'],
            rows: [{ id: 1 }],
            rowCount: 1,
            page: { nextCursor: '1', limit: 1, hasMore: true, totalCount: 2 },
        });

        Object.assign(client as object, {
            requireFeature: vi.fn().mockResolvedValue(undefined),
        });
        Object.assign(client.sql as object, { query });

        await expect(client.sql.pageAll({
            database: 'graph',
            statement: 'SELECT id FROM notes ORDER BY id',
        }, {
            pageSize: 1,
            maxPages: 1,
        })).rejects.toThrow('Authority sql.pageAll exceeded maxPages=1');
    });

    it('routes sql.stat through the SQL diagnostics endpoint', async () => {
        const { AuthorityClient } = await import('./client.js');

        const client = new AuthorityClient({
            extensionId: 'third-party/ext-a',
            displayName: 'Ext A',
            version: '0.1.0',
            installType: 'local',
            declaredPermissions: {},
        });

        const requestWithSession = vi.fn(async () => ({
            database: 'graph',
            name: 'graph',
            fileName: 'graph.sqlite',
            filePath: 'C:/authority/graph.sqlite',
            exists: true,
            sizeBytes: 1024,
            updatedAt: '2026-04-27T00:00:00.000Z',
            runtimeConfig: {
                journalMode: 'wal',
                synchronous: 'normal',
                foreignKeys: true,
                busyTimeoutMs: 5000,
                pagedQueryRequiresOrderBy: true,
            },
            slowQuery: {
                count: 1,
                lastOccurredAt: '2026-04-27T00:00:01.000Z',
                lastElapsedMs: 312,
                lastStatementPreview: 'SELECT * FROM notes ORDER BY id',
            },
        }));

        Object.assign(client as object, {
            requireFeature: vi.fn().mockResolvedValue(undefined),
            ensurePermission: vi.fn().mockResolvedValue(undefined),
            requestWithSession,
        });

        const result = await client.sql.stat({
            database: 'graph',
        });

        expect(result.runtimeConfig.journalMode).toBe('wal');
        expect(result.slowQuery.count).toBe(1);
        expect(requestWithSession).toHaveBeenCalledWith('/sql/stat', {
            method: 'POST',
            body: {
                database: 'graph',
            },
        });
    });

    it('routes resolveMany and listMappingsPage through the new Trivium endpoints', async () => {
        const { AuthorityClient } = await import('./client.js');

        const client = new AuthorityClient({
            extensionId: 'third-party/ext-a',
            displayName: 'Ext A',
            version: '0.1.0',
            installType: 'local',
            declaredPermissions: {},
        });

        const requestWithSession = vi.fn(async (path: string, options?: { body?: unknown }) => {
            if (path === '/trivium/resolve-many') {
                return {
                    items: [{ index: 0, id: 1, externalId: 'alpha', namespace: 'default' }],
                };
            }
            return {
                mappings: [{ id: 1, externalId: 'alpha', namespace: 'default', createdAt: 'now', updatedAt: 'now' }],
                page: { nextCursor: null, limit: 10, hasMore: false, totalCount: 1 },
            };
        });

        Object.assign(client as object, {
            requireFeature: vi.fn().mockResolvedValue(undefined),
            ensurePermission: vi.fn().mockResolvedValue(undefined),
            requestWithSession,
        });

        const resolved = await client.trivium.resolveMany({
            database: 'graph',
            items: [{ externalId: 'alpha' }],
        });
        const mappings = await client.trivium.listMappingsPage({
            database: 'graph',
            page: { limit: 10 },
        });

        expect(resolved.items[0]).toEqual({ index: 0, id: 1, externalId: 'alpha', namespace: 'default' });
        expect(mappings.mappings[0]).toEqual({ id: 1, externalId: 'alpha', namespace: 'default', createdAt: 'now', updatedAt: 'now' });
        expect(requestWithSession).toHaveBeenNthCalledWith(1, '/trivium/resolve-many', {
            method: 'POST',
            body: {
                database: 'graph',
                items: [{ externalId: 'alpha' }],
            },
        });
        expect(requestWithSession).toHaveBeenNthCalledWith(2, '/trivium/list-mappings', {
            method: 'POST',
            body: {
                database: 'graph',
                page: { limit: 10 },
            },
        });
    });

    it('routes Trivium mapping integrity tools through the new endpoints', async () => {
        const { AuthorityClient } = await import('./client.js');

        const client = new AuthorityClient({
            extensionId: 'third-party/ext-a',
            displayName: 'Ext A',
            version: '0.1.0',
            installType: 'local',
            declaredPermissions: {},
        });

        const requestWithSession = vi.fn(async (path: string) => {
            if (path === '/trivium/check-mappings-integrity') {
                return {
                    ok: false,
                    mappingCount: 2,
                    nodeCount: 2,
                    orphanMappingCount: 1,
                    missingMappingCount: 1,
                    duplicateInternalIdCount: 0,
                    duplicateExternalIdCount: 0,
                    issues: [],
                    sampled: false,
                };
            }
            return {
                scannedCount: 2,
                orphanCount: 1,
                deletedCount: 1,
                hasMore: false,
                orphans: [{ id: 2, externalId: 'beta', namespace: 'default', createdAt: 'now', updatedAt: 'now' }],
            };
        });

        Object.assign(client as object, {
            requireFeature: vi.fn().mockResolvedValue(undefined),
            ensurePermission: vi.fn().mockResolvedValue(undefined),
            requestWithSession,
        });

        const integrity = await client.trivium.checkMappingsIntegrity({
            database: 'graph',
            sampleLimit: 5,
        });
        const deleted = await client.trivium.deleteOrphanMappings({
            database: 'graph',
            limit: 10,
        });

        expect(integrity.orphanMappingCount).toBe(1);
        expect(deleted.deletedCount).toBe(1);
        expect(requestWithSession).toHaveBeenNthCalledWith(1, '/trivium/check-mappings-integrity', {
            method: 'POST',
            body: {
                database: 'graph',
                sampleLimit: 5,
            },
        });
        expect(requestWithSession).toHaveBeenNthCalledWith(2, '/trivium/delete-orphan-mappings', {
            method: 'POST',
            body: {
                database: 'graph',
                limit: 10,
            },
        });
    });

    it('routes Trivium compact through the new endpoint', async () => {
        const { AuthorityClient } = await import('./client.js');

        const client = new AuthorityClient({
            extensionId: 'third-party/ext-a',
            displayName: 'Ext A',
            version: '0.1.0',
            installType: 'local',
            declaredPermissions: {},
        });

        const ensurePermission = vi.fn().mockResolvedValue(undefined);
        const requestWithSession = vi.fn().mockResolvedValue({ ok: true });
        Object.assign(client as object, {
            ensurePermission,
            requestWithSession,
        });

        await client.trivium.compact({ database: 'graph' });

        expect(ensurePermission).toHaveBeenCalledWith({
            resource: 'trivium.private',
            target: 'graph',
            reason: '压实 Trivium 数据库 graph',
        });
        expect(requestWithSession).toHaveBeenCalledWith('/trivium/compact', {
            method: 'POST',
            body: {
                database: 'graph',
            },
        });
    });

    it('routes sql.listMigrationsPage through the SQL migration listing endpoint', async () => {
        const { AuthorityClient } = await import('./client.js');

        const client = new AuthorityClient({
            extensionId: 'third-party/ext-a',
            displayName: 'Ext A',
            version: '0.1.0',
            installType: 'local',
            declaredPermissions: {},
        });

        const requestWithSession = vi.fn(async () => ({
            tableName: '_authority_migrations',
            migrations: [{ id: '001_init', appliedAt: '2026-04-26T00:00:00.000Z' }],
            page: { nextCursor: null, limit: 10, hasMore: false, totalCount: 1 },
        }));

        Object.assign(client as object, {
            requireFeature: vi.fn().mockResolvedValue(undefined),
            ensurePermission: vi.fn().mockResolvedValue(undefined),
            requestWithSession,
        });

        const result = await client.sql.listMigrationsPage({
            database: 'graph',
            page: { limit: 10 },
        });

        expect(result.tableName).toBe('_authority_migrations');
        expect(result.migrations).toEqual([{ id: '001_init', appliedAt: '2026-04-26T00:00:00.000Z' }]);
        expect(requestWithSession).toHaveBeenCalledWith('/sql/list-migrations', {
            method: 'POST',
            body: {
                database: 'graph',
                page: { limit: 10 },
            },
        });
    });

    it('routes sql.listSchemaPage through the SQL schema listing endpoint', async () => {
        const { AuthorityClient } = await import('./client.js');

        const client = new AuthorityClient({
            extensionId: 'third-party/ext-a',
            displayName: 'Ext A',
            version: '0.1.0',
            installType: 'local',
            declaredPermissions: {},
        });

        const requestWithSession = vi.fn(async () => ({
            objects: [{ type: 'table', name: 'notes', tableName: 'notes', sql: 'CREATE TABLE notes (id INTEGER)' }],
            page: { nextCursor: null, limit: 10, hasMore: false, totalCount: 1 },
        }));

        Object.assign(client as object, {
            requireFeature: vi.fn().mockResolvedValue(undefined),
            ensurePermission: vi.fn().mockResolvedValue(undefined),
            requestWithSession,
        });

        const result = await client.sql.listSchemaPage({
            database: 'graph',
            type: 'table',
            page: { limit: 10 },
        });

        expect(result.objects).toEqual([{ type: 'table', name: 'notes', tableName: 'notes', sql: 'CREATE TABLE notes (id INTEGER)' }]);
        expect(requestWithSession).toHaveBeenCalledWith('/sql/list-schema', {
            method: 'POST',
            body: {
                database: 'graph',
                type: 'table',
                page: { limit: 10 },
            },
        });
    });
});

function buildProbe(overrides: Partial<{
    resolveId: boolean;
    resolveMany: boolean;
    upsert: boolean;
    bulkMutations: boolean;
    filterWherePage: boolean;
    queryPage: boolean;
    mappingPages: boolean;
    mappingIntegrity: boolean;
    inlineThresholdBytes: Partial<Record<
        'storageBlobWrite' | 'storageBlobRead' | 'privateFileWrite' | 'privateFileRead' | 'httpFetchRequest' | 'httpFetchResponse',
        number
    >>;
}> = {}): AuthorityProbeResponse {
    const sqlFeatures = {
        queryPage: true,
        stat: true,
        migrations: true,
        schemaManifest: true,
    } as unknown as AuthorityProbeResponse['features']['sql'];

    return {
        id: 'authority',
        online: true,
        version: '0.1.0',
        pluginId: 'authority',
        sdkExtensionId: 'third-party/st-authority-sdk',
        pluginVersion: '0.1.0',
        sdkBundledVersion: '0.1.0',
        sdkDeployedVersion: '0.1.0',
        coreBundledVersion: '0.1.0',
        coreArtifactPlatform: 'win32-x64',
        coreArtifactPlatforms: ['win32-x64'],
        coreArtifactHash: 'hash',
        coreBinarySha256: 'sha256',
        coreVerified: true,
        coreMessage: null,
        installStatus: 'ready',
        installMessage: 'ready',
        storageRoot: 'C:/authority/storage',
        features: {
            securityCenter: true,
            admin: false,
            sql: sqlFeatures,
            trivium: {
                resolveId: true,
                resolveMany: true,
                upsert: true,
                bulkMutations: true,
                filterWherePage: true,
                queryPage: true,
                mappingPages: true,
                mappingIntegrity: true,
                ...overrides,
            },
            transfers: {
                blob: true,
                fs: true,
                httpFetch: true,
            },
            jobs: {
                background: true,
                safeRequeue: true,
                builtinTypes: ['delay', 'sql.backup', 'trivium.flush', 'fs.import-jsonl'],
            },
            diagnostics: {
                warnings: true,
                activityPages: true,
                jobsPage: true,
                benchmarkCore: true,
            },
        },
        limits: {
            maxRequestBytes: 1024,
            maxKvValueBytes: 1024,
            maxBlobBytes: 1024,
            maxHttpBodyBytes: 1024,
            maxHttpResponseBytes: 1024,
            maxEventPollLimit: 100,
            maxDataTransferBytes: 1024,
            dataTransferChunkBytes: 256,
            dataTransferInlineThresholdBytes: 256,
            effectiveInlineThresholdBytes: {
                storageBlobWrite: { bytes: overrides.inlineThresholdBytes?.storageBlobWrite ?? 256, source: 'runtime' },
                storageBlobRead: { bytes: overrides.inlineThresholdBytes?.storageBlobRead ?? 256, source: 'runtime' },
                privateFileWrite: { bytes: overrides.inlineThresholdBytes?.privateFileWrite ?? 256, source: 'runtime' },
                privateFileRead: { bytes: overrides.inlineThresholdBytes?.privateFileRead ?? 256, source: 'runtime' },
                httpFetchRequest: { bytes: overrides.inlineThresholdBytes?.httpFetchRequest ?? 256, source: 'runtime' },
                httpFetchResponse: { bytes: overrides.inlineThresholdBytes?.httpFetchResponse ?? 256, source: 'runtime' },
            },
            effectiveTransferMaxBytes: {
                storageBlobWrite: { bytes: 1024, source: 'runtime' },
                storageBlobRead: { bytes: 1024, source: 'runtime' },
                privateFileWrite: { bytes: 1024, source: 'runtime' },
                privateFileRead: { bytes: 1024, source: 'runtime' },
                httpFetchRequest: { bytes: 1024, source: 'runtime' },
                httpFetchResponse: { bytes: 1024, source: 'runtime' },
            },
        },
        jobs: {
            builtinTypes: ['delay', 'sql.backup', 'trivium.flush', 'fs.import-jsonl'],
            registry: {
                registered: 4,
                jobTypes: ['delay', 'sql.backup', 'trivium.flush', 'fs.import-jsonl'],
                entries: [
                    {
                        type: 'delay',
                        description: 'Waits for a duration and emits progress updates until completion.',
                        defaultTimeoutMs: null,
                        defaultMaxAttempts: 1,
                        cancellable: true,
                        payloadFields: [],
                        progressFields: [],
                    },
                ],
            },
        },
        core: {
            enabled: true,
            state: 'running',
            port: 1234,
            pid: 1,
            version: '0.1.0',
            startedAt: new Date().toISOString(),
            lastError: null,
            health: {
                name: 'authority-core',
                apiVersion: 'authority-core/v1',
                version: '0.1.0',
                buildHash: null,
                platform: 'win32-x64',
                pid: 1,
                startedAt: new Date().toISOString(),
                uptimeMs: 10,
                requestCount: 1,
                errorCount: 0,
                activeJobCount: 0,
                queuedJobCount: 0,
                queuedRequestCount: 0,
                runtimeMode: 'managed',
                maxConcurrency: 4,
                currentConcurrency: 0,
                workerCount: 4,
                lastError: null,
                jobRegistrySummary: {
                    registered: 4,
                    jobTypes: ['delay', 'sql.backup', 'trivium.flush', 'fs.import-jsonl'],
                    entries: [
                        {
                            type: 'delay',
                            description: 'Waits for a duration and emits progress updates until completion.',
                            defaultTimeoutMs: null,
                            defaultMaxAttempts: 1,
                            cancellable: true,
                            payloadFields: [],
                            progressFields: [],
                        },
                    ],
                },
                timeoutMs: 5000,
                limits: {
                    maxRequestBytes: 1024,
                    maxKvValueBytes: 1024,
                    maxBlobBytes: 1024,
                    maxHttpBodyBytes: 1024,
                    maxHttpResponseBytes: 1024,
                    maxEventPollLimit: 100,
                },
            },
        },
    };
}

function buildSession() {
    return {
        sessionToken: 'session-token',
        user: {
            handle: 'alice',
            isAdmin: false,
        },
        extension: {
            id: 'third-party/ext-a',
            installType: 'local',
            displayName: 'Ext A',
            version: '0.1.0',
            firstSeenAt: '2026-01-01T00:00:00.000Z',
        },
        grants: [],
        policies: [],
        limits: {
            effectiveInlineThresholdBytes: {
                storageBlobWrite: { bytes: 256, source: 'runtime' },
                storageBlobRead: { bytes: 256, source: 'runtime' },
                privateFileWrite: { bytes: 256, source: 'runtime' },
                privateFileRead: { bytes: 256, source: 'runtime' },
                httpFetchRequest: { bytes: 256, source: 'runtime' },
                httpFetchResponse: { bytes: 256, source: 'runtime' },
            },
            effectiveTransferMaxBytes: {
                storageBlobWrite: { bytes: 1024, source: 'runtime' },
                storageBlobRead: { bytes: 1024, source: 'runtime' },
                privateFileWrite: { bytes: 1024, source: 'runtime' },
                privateFileRead: { bytes: 1024, source: 'runtime' },
                httpFetchRequest: { bytes: 1024, source: 'runtime' },
                httpFetchResponse: { bytes: 1024, source: 'runtime' },
            },
        },
        features: buildProbe().features,
    };
}

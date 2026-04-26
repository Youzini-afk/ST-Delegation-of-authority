import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { AuthorityFeatureFlags, AuthorityProbeResponse } from '@stdo/shared-types';

const authorityRequestMock = vi.hoisted(() => vi.fn());

vi.mock('./api.js', () => ({
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
        authorityRequestMock.mockReset();
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

    it('splits items by item count and estimated JSON bytes', async () => {
        const { splitAuthorityItemsIntoChunks } = await import('./client.js');

        const chunks = splitAuthorityItemsIntoChunks([
            { id: 'a', text: '1234567890' },
            { id: 'b', text: '1234567890' },
            { id: 'c', text: '1234567890' },
        ], {
            maxItemsPerChunk: 2,
            maxBytesPerChunk: 80,
        });

        expect(chunks).toHaveLength(2);
        expect(chunks[0]?.itemOffset).toBe(0);
        expect(chunks[0]?.itemCount).toBe(2);
        expect(chunks[1]?.itemOffset).toBe(2);
        expect(chunks[1]?.itemCount).toBe(1);
    });

    it('aggregates chunked Trivium bulk upsert progress and global failure indexes', async () => {
        const { AuthorityClient } = await import('./client.js');

        const client = new AuthorityClient({
            extensionId: 'third-party/ext-a',
            displayName: 'Ext A',
            version: '0.1.0',
            installType: 'local',
            declaredPermissions: {},
        });

        const privateClient = client as unknown as {
            requireFeature: ReturnType<typeof vi.fn>;
            ensurePermission: ReturnType<typeof vi.fn>;
            bulkUpsertTriviumRequest: ReturnType<typeof vi.fn>;
        };
        privateClient.requireFeature = vi.fn().mockResolvedValue(undefined);
        privateClient.ensurePermission = vi.fn().mockResolvedValue(undefined);
        privateClient.bulkUpsertTriviumRequest = vi.fn()
            .mockResolvedValueOnce({
                totalCount: 2,
                successCount: 1,
                failureCount: 1,
                failures: [{ index: 1, message: 'duplicate externalId' }],
                items: [{ index: 0, id: 101, action: 'inserted', externalId: 'n1', namespace: 'default' }],
            })
            .mockResolvedValueOnce({
                totalCount: 1,
                successCount: 1,
                failureCount: 0,
                failures: [],
                items: [{ index: 0, id: 103, action: 'updated', externalId: 'n3', namespace: 'default' }],
            });

        const progress: Array<{ completedChunks: number; completedItems: number; failureCount: number }> = [];
        const result = await client.trivium.bulkUpsertChunked({
            database: 'graph',
            items: [
                { externalId: 'n1', vector: [1], payload: { name: 'one' } },
                { externalId: 'n2', vector: [2], payload: { name: 'two' } },
                { externalId: 'n3', vector: [3], payload: { name: 'three' } },
            ],
        }, {
            maxItemsPerChunk: 2,
            onProgress(update) {
                progress.push({
                    completedChunks: update.completedChunks,
                    completedItems: update.completedItems,
                    failureCount: update.failureCount,
                });
            },
        });

        expect(privateClient.bulkUpsertTriviumRequest).toHaveBeenCalledTimes(2);
        expect(result.chunkCount).toBe(2);
        expect(result.successCount).toBe(2);
        expect(result.failureCount).toBe(1);
        expect(result.failures).toEqual([
            expect.objectContaining({
                index: 1,
                globalIndex: 1,
                chunkIndex: 0,
                chunkItemIndex: 1,
                kind: 'item',
                message: 'duplicate externalId',
            }),
        ]);
        expect(result.items).toEqual([
            expect.objectContaining({ id: 101, index: 0, globalIndex: 0, chunkIndex: 0, chunkItemIndex: 0 }),
            expect.objectContaining({ id: 103, index: 2, globalIndex: 2, chunkIndex: 1, chunkItemIndex: 0 }),
        ]);
        expect(progress).toEqual([
            { completedChunks: 1, completedItems: 2, failureCount: 1 },
            { completedChunks: 2, completedItems: 3, failureCount: 1 },
        ]);
    });

    it('continues after chunk-level Trivium bulk failures when configured', async () => {
        const { AuthorityClient } = await import('./client.js');

        const client = new AuthorityClient({
            extensionId: 'third-party/ext-a',
            displayName: 'Ext A',
            version: '0.1.0',
            installType: 'local',
            declaredPermissions: {},
        });

        const privateClient = client as unknown as {
            requireFeature: ReturnType<typeof vi.fn>;
            ensurePermission: ReturnType<typeof vi.fn>;
            bulkDeleteTriviumRequest: ReturnType<typeof vi.fn>;
        };
        privateClient.requireFeature = vi.fn().mockResolvedValue(undefined);
        privateClient.ensurePermission = vi.fn().mockResolvedValue(undefined);
        privateClient.bulkDeleteTriviumRequest = vi.fn()
            .mockRejectedValueOnce(new Error('chunk request timeout'))
            .mockResolvedValueOnce({
                totalCount: 1,
                successCount: 1,
                failureCount: 0,
                failures: [],
            });

        const result = await client.trivium.bulkDeleteChunked({
            database: 'graph',
            items: [
                { externalId: 'n1' },
                { externalId: 'n2' },
                { externalId: 'n3' },
            ],
        }, {
            maxItemsPerChunk: 2,
            continueOnChunkError: true,
        });

        expect(privateClient.bulkDeleteTriviumRequest).toHaveBeenCalledTimes(2);
        expect(result.successCount).toBe(1);
        expect(result.failureCount).toBe(2);
        expect(result.failures).toEqual([
            expect.objectContaining({ globalIndex: 0, chunkIndex: 0, kind: 'chunk', message: 'chunk request timeout' }),
            expect.objectContaining({ globalIndex: 1, chunkIndex: 0, kind: 'chunk', message: 'chunk request timeout' }),
        ]);
    });
});

function buildProbe(overrides: Partial<AuthorityFeatureFlags['trivium']> = {}): AuthorityProbeResponse {
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
            sql: {
                queryPage: true,
                migrations: true,
            },
            trivium: {
                resolveId: true,
                upsert: true,
                bulkMutations: true,
                filterWherePage: true,
                queryPage: true,
                ...overrides,
            },
            transfers: {
                blob: true,
                fs: true,
                httpFetch: true,
            },
            jobs: {
                background: true,
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
        },
        jobs: {
            builtinTypes: ['delay', 'sql.backup', 'trivium.flush', 'fs.import-jsonl'],
            registry: {
                registered: 4,
                jobTypes: ['delay', 'sql.backup', 'trivium.flush', 'fs.import-jsonl'],
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

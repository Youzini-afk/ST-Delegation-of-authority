import { beforeEach, describe, expect, it, vi } from 'vitest';
import type {
    AuthorityProbeResponse,
    TriviumBulkDeleteRequest,
    TriviumBulkUpsertRequest,
} from '@stdo/shared-types';

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
}> = {}): AuthorityProbeResponse {
    const sqlFeatures = {
        queryPage: true,
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

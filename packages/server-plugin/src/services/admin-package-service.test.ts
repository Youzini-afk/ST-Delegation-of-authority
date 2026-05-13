import crypto from 'node:crypto';
import { describe, expect, it } from 'vitest';
import type {
    AuthorityPortablePackage,
    AuthorityUsageSummaryResponse,
    ControlExtensionRecord,
    ControlPoliciesResponse,
    ControlGrantRecord,
    SqlDatabaseRecord,
    TriviumDatabaseRecord,
} from '@stdo/shared-types';
import { AdminPackageService } from './admin-package-service.js';
import { createZipArchive } from './zip-archive.js';

describe('AdminPackageService portable package archive', () => {
    it('round-trips the zip-based multi-file archive format back into the logical package shape', () => {
        const service = createService();
        const portablePackage = createPortablePackage();

        const archive = (service as any).buildPortablePackageArchive(portablePackage) as {
            manifest: Record<string, unknown>;
            files: Array<{ path: string; mediaType: string; bytes: Buffer }>;
        };
        const archiveBytes = createZipArchive([
            {
                path: 'manifest.json',
                bytes: Buffer.from(JSON.stringify(archive.manifest, null, 2), 'utf8'),
                compression: 'deflate',
            },
            ...archive.files.map(file => ({
                path: file.path,
                bytes: file.bytes,
                compression: file.mediaType === 'application/json' ? 'deflate' as const : 'auto' as const,
            })),
        ]);

        const readResult = (service as any).readPortablePackageArchive(archiveBytes) as {
            portablePackage: AuthorityPortablePackage;
            warnings: string[];
        };

        expect(readResult.warnings).toEqual([]);
        expect(readResult.portablePackage).toEqual(portablePackage);
    });
});

function createService(): AdminPackageService {
    return new AdminPackageService(
        {} as never,
        {} as never,
        {} as never,
        {} as never,
        {} as never,
        {} as never,
        {} as never,
    );
}

function createPortablePackage(): AuthorityPortablePackage {
    const now = '2026-04-27T19:00:00.000Z';
    const blobBytes = Buffer.from('hello blob payload', 'utf8');
    const fileBytes = Buffer.from('private-file-content', 'utf8');
    const sqlBytes = Buffer.from('sqlite-bytes', 'utf8');
    const triviumBytes = Buffer.from('trivium-db-bytes', 'utf8');
    const mappingBytes = Buffer.from('trivium-mapping-bytes', 'utf8');

    const extension: ControlExtensionRecord = {
        id: 'third-party/ext-a',
        installType: 'local',
        displayName: 'Extension A',
        version: '1.2.3',
        firstSeenAt: now,
        lastSeenAt: now,
        declaredPermissions: {
            storage: {
                kv: true,
                blob: true,
            },
            fs: {
                private: true,
            },
            sql: {
                private: true,
            },
            trivium: {
                private: true,
            },
        },
        uiLabel: 'Ext A',
    };

    const grants: ControlGrantRecord[] = [
        {
            key: 'storage.blob:*',
            resource: 'storage.blob',
            target: '*',
            status: 'granted',
            scope: 'persistent',
            riskLevel: 'medium',
            updatedAt: now,
            source: 'user',
            choice: 'allow-always',
        },
    ];

    const policies: ControlPoliciesResponse = {
        defaults: {
            'storage.kv': 'prompt',
            'storage.blob': 'prompt',
            'fs.private': 'prompt',
            'sql.private': 'prompt',
            'trivium.private': 'prompt',
            'http.fetch': 'prompt',
            'jobs.background': 'prompt',
            'events.stream': 'prompt',
        },
        extensions: {
            'third-party/ext-a': {
                'storage.blob:*': {
                    key: 'storage.blob:*',
                    resource: 'storage.blob',
                    target: '*',
                    status: 'granted',
                    riskLevel: 'medium',
                    updatedAt: now,
                    source: 'admin',
                },
            },
        },
        limits: {
            extensions: {},
        },
        updatedAt: now,
    };

    const sqlRecord: SqlDatabaseRecord = {
        name: 'main',
        fileName: 'main.sqlite',
        sizeBytes: sqlBytes.byteLength,
        updatedAt: now,
        runtimeConfig: {
            journalMode: 'wal',
            synchronous: 'normal',
            foreignKeys: true,
            busyTimeoutMs: 0,
            pagedQueryRequiresOrderBy: false,
        },
        slowQuery: {
            count: 0,
            lastOccurredAt: null,
            lastElapsedMs: null,
            lastStatementPreview: null,
        },
    };

    const triviumRecord: TriviumDatabaseRecord = {
        name: 'memory',
        fileName: 'memory.tdb',
        dim: 1536,
        dtype: 'f32',
        syncMode: 'normal',
        storageMode: 'mmap',
        sizeBytes: triviumBytes.byteLength,
        walSizeBytes: 0,
        vecSizeBytes: 0,
        quiverSizeBytes: 0,
        totalSizeBytes: triviumBytes.byteLength,
        updatedAt: now,
        indexHealth: {
            status: 'fresh',
            reason: null,
            requiresRebuild: false,
            staleSince: null,
            lastContentMutationAt: now,
            lastTextWriteAt: now,
            lastTextRebuildAt: now,
            lastCompactionAt: null,
        },
    };

    const usageSummary: AuthorityUsageSummaryResponse = {
        generatedAt: now,
        totals: {
            extensionCount: 1,
            kvEntries: 1,
            blobCount: 1,
            blobBytes: blobBytes.byteLength,
            databaseCount: 2,
            databaseBytes: sqlBytes.byteLength + triviumBytes.byteLength,
            sqlDatabaseCount: 1,
            sqlDatabaseBytes: sqlBytes.byteLength,
            triviumDatabaseCount: 1,
            triviumDatabaseBytes: triviumBytes.byteLength,
            files: {
                fileCount: 1,
                directoryCount: 1,
                totalSizeBytes: fileBytes.byteLength,
                latestUpdatedAt: now,
            },
        },
        extensions: [
            {
                extension,
                grantedCount: 1,
                deniedCount: 0,
                storage: {
                    kvEntries: 1,
                    blobCount: 1,
                    blobBytes: blobBytes.byteLength,
                    databaseCount: 2,
                    databaseBytes: sqlBytes.byteLength + triviumBytes.byteLength,
                    sqlDatabaseCount: 1,
                    sqlDatabaseBytes: sqlBytes.byteLength,
                    triviumDatabaseCount: 1,
                    triviumDatabaseBytes: triviumBytes.byteLength,
                    files: {
                        fileCount: 1,
                        directoryCount: 1,
                        totalSizeBytes: fileBytes.byteLength,
                        latestUpdatedAt: now,
                    },
                },
            },
        ],
    };

    return {
        manifest: {
            format: 'authority-portable-package-v1',
            generatedAt: now,
            extensionIds: [extension.id],
            includesPolicies: true,
            includesUsageSummary: true,
        },
        policies,
        usageSummary,
        extensions: [
            {
                extension,
                grants,
                kvEntries: {
                    greeting: 'hello',
                },
                blobs: [
                    {
                        record: {
                            id: 'hello.txt',
                            name: 'hello.txt',
                            contentType: 'text/plain',
                            size: blobBytes.byteLength,
                            updatedAt: now,
                        },
                        contentBase64: blobBytes.toString('base64'),
                        checksumSha256: hashBytes(blobBytes),
                    },
                ],
                files: [
                    {
                        path: '/docs/readme.txt',
                        sizeBytes: fileBytes.byteLength,
                        updatedAt: now,
                        contentBase64: fileBytes.toString('base64'),
                        checksumSha256: hashBytes(fileBytes),
                    },
                ],
                sqlDatabases: [
                    {
                        record: sqlRecord,
                        contentBase64: sqlBytes.toString('base64'),
                        checksumSha256: hashBytes(sqlBytes),
                    },
                ],
                triviumDatabases: [
                    {
                        record: triviumRecord,
                        databaseContentBase64: triviumBytes.toString('base64'),
                        databaseChecksumSha256: hashBytes(triviumBytes),
                        mappingContentBase64: mappingBytes.toString('base64'),
                        mappingChecksumSha256: hashBytes(mappingBytes),
                    },
                ],
            },
        ],
    };
}

function hashBytes(bytes: Uint8Array): string {
    return crypto.createHash('sha256').update(bytes).digest('hex');
}

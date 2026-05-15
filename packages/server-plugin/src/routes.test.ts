import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import process from 'node:process';
import { describe, expect, it, vi } from 'vitest';
import { AUTHORITY_VERSION } from './version.js';
import { registerRoutes } from './routes.js';
import { MAX_SQL_BATCH_STATEMENTS, NATIVE_MIGRATION_MAX_COMPRESSED_BYTES, NATIVE_MIGRATION_TRANSFER_CHUNK_BYTES, UNMANAGED_TRANSFER_MAX_BYTES } from './constants.js';
import type { AuthorityRuntime } from './runtime.js';
import { AuthorityServiceError } from './utils.js';
import { validateBmeVectorApplyDimensions } from './services/trivium-service.js';

describe('registerRoutes', () => {
    it('rejects BME vector apply batches with mixed dimensions', () => {
        expect(() => validateBmeVectorApplyDimensions({
            database: 'bme',
            vectorSpaceId: 'vs_abc',
            observedDim: 3,
            items: [
                { externalId: 'a', vector: [1, 2, 3], payload: { vectorSpaceId: 'vs_abc' } },
                { externalId: 'b', vector: [1, 2], payload: { vectorSpaceId: 'vs_abc' } },
            ],
        })).toThrow(AuthorityServiceError);
    });

    it('rejects BME vector apply batches with mismatched vector spaces', () => {
        expect(() => validateBmeVectorApplyDimensions({
            database: 'bme',
            vectorSpaceId: 'vs_abc',
            observedDim: 3,
            items: [
                { externalId: 'a', vector: [1, 2, 3], payload: { vectorSpaceId: 'vs_other' } },
            ],
        })).toThrow(AuthorityServiceError);
    });

    it('registers fs.private routes', () => {
        const posts: string[] = [];
        const gets: string[] = [];
        const router = {
            get(path: string) {
                gets.push(path);
            },
            post(path: string) {
                posts.push(path);
            },
        };

        registerRoutes(router, {} as AuthorityRuntime);

        expect(gets).toEqual(expect.arrayContaining([
            '/session/current',
            '/extensions',
            '/extensions/:id',
            '/sql/databases',
            '/jobs',
            '/jobs/:id',
            '/events/stream',
            '/st-manager/bridge/probe',
            '/st-manager/bridge/admin/config',
            '/st-manager/resources/:type/manifest',
            '/admin/policies',
            '/admin/import-export/operations',
            '/admin/usage-summary',
            '/admin/diagnostic-bundle',
        ]));
        expect(posts).toEqual(expect.arrayContaining([
            '/permissions/evaluate-batch',
            '/bme/vector-manifest',
            '/bme/vector-apply',
            '/transfers/init',
            '/transfers/:id/append',
            '/transfers/:id/read',
            '/transfers/:id/status',
            '/transfers/:id/manifest',
            '/transfers/:id/discard',
            '/storage/blob/commit-transfer',
            '/storage/blob/open-read',
            '/fs/private/mkdir',
            '/fs/private/read-dir',
            '/fs/private/write-file',
            '/fs/private/write-file-transfer',
            '/fs/private/read-file',
            '/fs/private/open-read',
            '/sql/stat',
            '/sql/list-migrations',
            '/sql/list-schema',
            '/trivium/resolve-id',
            '/trivium/check-mappings-integrity',
            '/trivium/delete-orphan-mappings',
            '/trivium/upsert',
            '/trivium/bulk-upsert',
            '/trivium/bulk-link',
            '/trivium/bulk-unlink',
            '/trivium/bulk-delete',
            '/trivium/compact',
            '/jobs/list',
            '/jobs/:id/requeue',
            '/http/fetch-open',
            '/fs/private/delete',
            '/fs/private/stat',
            '/st-manager/bridge/admin/config',
            '/st-manager/resources/:type/file/read',
            '/st-manager/resources/:type/file/write-init',
            '/st-manager/resources/:type/file/write-chunk',
            '/st-manager/resources/:type/file/write-commit',
            '/admin/import-export/export',
            '/admin/import-export/import-transfer/init',
            '/admin/import-export/import',
            '/admin/import-export/operations/:id/resume',
            '/admin/import-export/operations/:id/open-download',
            '/admin/native-migration/upload/init',
            '/admin/native-migration/preview',
            '/admin/native-migration/operations/:id/apply',
            '/admin/native-migration/operations/:id/rollback',
            '/admin/diagnostic-bundle/archive',
            '/admin/update',
        ]));
    });

    it('registers the complete route surface', () => {
        const posts: string[] = [];
        const gets: string[] = [];
        const router = {
            get(path: string) {
                gets.push(path);
            },
            post(path: string) {
                posts.push(path);
            },
        };

        registerRoutes(router, {} as AuthorityRuntime);

        expect(gets).toEqual([
            '/st-manager/bridge/probe',
            '/st-manager/bridge/admin/config',
            '/st-manager/resources/:type/manifest',
            '/st-manager/control/config',
            '/st-manager/control/backups',
            '/st-manager/control/backups/:backup_id',
            '/session/current',
            '/extensions',
            '/extensions/:id',
            '/sql/databases',
            '/trivium/databases',
            '/jobs',
            '/jobs/:id',
            '/events/stream',
            '/admin/policies',
            '/admin/usage-summary',
            '/admin/import-export/operations',
            '/admin/native-migration/operations',
            '/admin/diagnostic-bundle',
        ]);
        expect(posts).toEqual([
            '/probe',
            '/st-manager/bridge/admin/config',
            '/st-manager/resources/:type/file/read',
            '/st-manager/resources/:type/file/write-init',
            '/st-manager/resources/:type/file/write-chunk',
            '/st-manager/resources/:type/file/write-commit',
            '/st-manager/control/config',
            '/st-manager/control/probe',
            '/st-manager/control/backup/start',
            '/st-manager/control/pair',
            '/st-manager/control/restore-preview',
            '/st-manager/control/restore',
            '/bme/vector-manifest',
            '/bme/vector-apply',
            '/session/init',
            '/permissions/evaluate',
            '/permissions/evaluate-batch',
            '/permissions/resolve',
            '/extensions/:id/grants/reset',
            '/storage/kv/get',
            '/storage/kv/set',
            '/storage/kv/delete',
            '/storage/kv/list',
            '/transfers/init',
            '/transfers/:id/append',
            '/transfers/:id/read',
            '/transfers/:id/status',
            '/transfers/:id/manifest',
            '/transfers/:id/discard',
            '/storage/blob/put',
            '/storage/blob/commit-transfer',
            '/storage/blob/get',
            '/storage/blob/open-read',
            '/storage/blob/delete',
            '/storage/blob/list',
            '/fs/private/mkdir',
            '/fs/private/read-dir',
            '/fs/private/write-file',
            '/fs/private/write-file-transfer',
            '/fs/private/read-file',
            '/fs/private/open-read',
            '/fs/private/delete',
            '/fs/private/stat',
            '/sql/query',
            '/sql/exec',
            '/sql/batch',
            '/sql/transaction',
            '/sql/migrate',
            '/sql/list-migrations',
            '/sql/list-schema',
            '/sql/stat',
            '/trivium/insert',
            '/trivium/insert-with-id',
            '/trivium/resolve-id',
            '/trivium/resolve-many',
            '/trivium/upsert',
            '/trivium/bulk-upsert',
            '/trivium/get',
            '/trivium/update-payload',
            '/trivium/update-vector',
            '/trivium/delete',
            '/trivium/bulk-delete',
            '/trivium/link',
            '/trivium/bulk-link',
            '/trivium/unlink',
            '/trivium/bulk-unlink',
            '/trivium/neighbors',
            '/trivium/search',
            '/trivium/search-advanced',
            '/trivium/search-hybrid',
            '/trivium/search-hybrid-context',
            '/trivium/tql',
            '/trivium/tql-mut',
            '/trivium/create-index',
            '/trivium/drop-index',
            '/trivium/index-text',
            '/trivium/index-keyword',
            '/trivium/build-text-index',
            '/trivium/compact',
            '/trivium/flush',
            '/trivium/stat',
            '/trivium/check-mappings-integrity',
            '/trivium/delete-orphan-mappings',
            '/trivium/list-mappings',
            '/http/fetch',
            '/http/fetch-open',
            '/jobs/create',
            '/jobs/list',
            '/jobs/:id/cancel',
            '/jobs/:id/requeue',
            '/admin/policies',
            '/admin/import-export/export',
            '/admin/import-export/import-transfer/init',
            '/admin/import-export/import',
            '/admin/import-export/operations/:id/resume',
            '/admin/import-export/operations/:id/open-download',
            '/admin/native-migration/upload/init',
            '/admin/native-migration/preview',
            '/admin/native-migration/operations/:id/apply',
            '/admin/native-migration/operations/:id/rollback',
            '/admin/diagnostic-bundle/archive',
            '/admin/update',
        ]);
    });

    it('returns structured permission payloads for unauthorized storage routes', async () => {
        const posts = new Map<string, (req: any, res: any) => void | Promise<void>>();
        const router = {
            get() {
                return undefined;
            },
            post(path: string, handler: (req: any, res: any) => void | Promise<void>) {
                posts.set(path, handler);
            },
        };

        const runtime = {
            sessions: {
                assertSession: vi.fn().mockResolvedValue({
                    extension: {
                        id: 'third-party/ext-a',
                    },
                }),
            },
            permissions: {
                authorize: vi.fn().mockResolvedValue(false),
            },
            audit: {
                logPermission: vi.fn().mockResolvedValue(undefined),
                logError: vi.fn().mockResolvedValue(undefined),
            },
        } as unknown as AuthorityRuntime;

        registerRoutes(router, runtime);
        const handler = posts.get('/storage/kv/get');
        expect(handler).toBeTypeOf('function');

        const response = {
            status: vi.fn(),
            json: vi.fn(),
            send: vi.fn(),
            setHeader: vi.fn(),
            write: vi.fn(),
            end: vi.fn(),
        };
        response.status.mockReturnValue(response);

        await handler?.({
            user: {
                profile: {
                    handle: 'alice',
                    admin: false,
                },
                directories: {
                    root: 'C:/users/alice',
                },
            },
            body: { key: 'demo' },
            headers: {},
        }, response);

        expect(response.status).toHaveBeenCalledWith(403);
        expect(response.json).toHaveBeenCalledWith({
            error: 'Permission not granted: storage.kv',
            code: 'permission_not_granted',
            category: 'permission',
            details: {
                resource: 'storage.kv',
                target: '*',
                key: 'storage.kv:*',
                riskLevel: 'low',
            },
        });
    });

    it('returns structured session payloads when the session is invalid', async () => {
        const posts = new Map<string, (req: any, res: any) => void | Promise<void>>();
        const router = {
            get() {
                return undefined;
            },
            post(path: string, handler: (req: any, res: any) => void | Promise<void>) {
                posts.set(path, handler);
            },
        };

        const runtime = {
            sessions: {
                assertSession: vi.fn().mockRejectedValue(new AuthorityServiceError('Invalid authority session', 401, 'invalid_session', 'session')),
            },
            audit: {
                logPermission: vi.fn().mockResolvedValue(undefined),
                logError: vi.fn().mockResolvedValue(undefined),
            },
        } as unknown as AuthorityRuntime;

        registerRoutes(router, runtime);
        const handler = posts.get('/permissions/evaluate-batch');
        expect(handler).toBeTypeOf('function');

        const response = {
            status: vi.fn(),
            json: vi.fn(),
            send: vi.fn(),
            setHeader: vi.fn(),
            write: vi.fn(),
            end: vi.fn(),
        };
        response.status.mockReturnValue(response);

        await handler?.({
            user: {
                profile: {
                    handle: 'alice',
                    admin: false,
                },
                directories: {
                    root: 'C:/users/alice',
                },
            },
            body: { requests: [{ resource: 'storage.kv' }] },
            headers: {},
        }, response);

        expect(response.status).toHaveBeenCalledWith(401);
        expect(response.json).toHaveBeenCalledWith({
            error: 'Invalid authority session',
            code: 'invalid_session',
            category: 'session',
        });
    });

    it('exposes effective inline thresholds in probe limits', async () => {
        const posts = new Map<string, (req: any, res: any) => void | Promise<void>>();
        const router = {
            get() {
                return undefined;
            },
            post(path: string, handler: (req: any, res: any) => void | Promise<void>) {
                posts.set(path, handler);
            },
        };

        const runtime = {
            core: {
                refreshHealth: vi.fn().mockResolvedValue(undefined),
                getStatus: vi.fn(() => ({
                    health: {
                        limits: {
                            maxRequestBytes: 1024,
                            maxEventPollLimit: 100,
                        },
                        jobRegistrySummary: {
                            registered: 0,
                            jobTypes: [],
                            entries: [],
                        },
                    },
                })),
            },
            install: {
                getStatus: vi.fn(() => ({
                    pluginVersion: AUTHORITY_VERSION,
                    sdkBundledVersion: AUTHORITY_VERSION,
                    sdkDeployedVersion: AUTHORITY_VERSION,
                    coreBundledVersion: AUTHORITY_VERSION,
                    coreArtifactPlatform: 'win32-x64',
                    coreArtifactPlatforms: ['win32-x64'],
                    coreArtifactHash: 'hash',
                    coreBinarySha256: 'sha256',
                    coreVerified: true,
                    coreMessage: null,
                    installStatus: 'ready',
                    installMessage: 'ready',
                })),
            },
        } as unknown as AuthorityRuntime;

        registerRoutes(router, runtime);
        const handler = posts.get('/probe');
        expect(handler).toBeTypeOf('function');

        const response = {
            status: vi.fn(),
            json: vi.fn(),
            send: vi.fn(),
            setHeader: vi.fn(),
            write: vi.fn(),
            end: vi.fn(),
        };
        response.status.mockReturnValue(response);

        await handler?.({
            user: {
                profile: {
                    handle: 'alice',
                    admin: false,
                },
                directories: {
                    root: 'C:/users/alice',
                },
            },
            body: {},
            headers: {},
        }, response);

        expect(response.json).toHaveBeenCalledWith(expect.objectContaining({
            features: expect.objectContaining({
                bme: expect.objectContaining({
                    protocolVersion: 1,
                    vectorManifest: true,
                    vectorApply: true,
                    serverEmbeddingProbe: false,
                }),
            }),
            limits: expect.objectContaining({
                effectiveInlineThresholdBytes: expect.objectContaining({
                    storageBlobWrite: { bytes: 256 * 1024, source: 'runtime' },
                    privateFileRead: { bytes: 256 * 1024, source: 'runtime' },
                    httpFetchResponse: { bytes: 256 * 1024, source: 'runtime' },
                }),
                effectiveTransferMaxBytes: expect.objectContaining({
                    storageBlobWrite: { bytes: UNMANAGED_TRANSFER_MAX_BYTES, source: 'runtime' },
                    privateFileRead: { bytes: UNMANAGED_TRANSFER_MAX_BYTES, source: 'runtime' },
                    httpFetchRequest: { bytes: UNMANAGED_TRANSFER_MAX_BYTES, source: 'runtime' },
                    httpFetchResponse: { bytes: UNMANAGED_TRANSFER_MAX_BYTES, source: 'runtime' },
                }),
            }),
        }));
    });

    it('rejects oversized SQL transaction statement batches before core execution', async () => {
        const posts = new Map<string, (req: any, res: any) => void | Promise<void>>();
        const router = {
            get() {
                return undefined;
            },
            post(path: string, handler: (req: any, res: any) => void | Promise<void>) {
                posts.set(path, handler);
            },
        };
        const runtime = {
            sessions: {
                assertSession: vi.fn().mockResolvedValue({ extension: { id: 'third-party/ext-a' } }),
            },
            permissions: {
                authorize: vi.fn().mockResolvedValue(true),
            },
            core: {
                transactionSql: vi.fn(),
            },
            audit: {
                logPermission: vi.fn().mockResolvedValue(undefined),
                logUsage: vi.fn().mockResolvedValue(undefined),
                logError: vi.fn().mockResolvedValue(undefined),
            },
        } as unknown as AuthorityRuntime;

        registerRoutes(router, runtime);
        const response = {
            status: vi.fn().mockReturnThis(),
            json: vi.fn(),
            send: vi.fn(),
            setHeader: vi.fn(),
            write: vi.fn(),
            end: vi.fn(),
        };

        await posts.get('/sql/transaction')?.({
            user: {
                profile: { handle: 'alice', admin: false },
                directories: { root: 'C:/users/alice' },
            },
            body: {
                database: 'default',
                statements: Array.from({ length: MAX_SQL_BATCH_STATEMENTS + 1 }, () => ({ statement: 'SELECT 1' })),
            },
            headers: {},
        }, response);

        expect(runtime.core.transactionSql).not.toHaveBeenCalled();
        expect(response.status).toHaveBeenCalledWith(400);
        expect(response.json).toHaveBeenCalledWith({
            error: `SQL transaction exceeds ${MAX_SQL_BATCH_STATEMENTS} statements`,
            code: 'validation_error',
            category: 'validation',
            details: {
                statementCount: MAX_SQL_BATCH_STATEMENTS + 1,
                maxStatements: MAX_SQL_BATCH_STATEMENTS,
            },
        });
    });

    it('returns a BME vector manifest through the session-gated route', async () => {
        const posts = new Map<string, (req: any, res: any) => void | Promise<void>>();
        const router = {
            get() {
                return undefined;
            },
            post(path: string, handler: (req: any, res: any) => void | Promise<void>) {
                posts.set(path, handler);
            },
        };
        const runtime = {
            sessions: {
                assertSession: vi.fn().mockResolvedValue({
                    extension: { id: 'third-party/st-bme' },
                }),
            },
            permissions: {
                authorize: vi.fn().mockResolvedValue(true),
            },
            trivium: {
                getBmeVectorManifest: vi.fn().mockResolvedValue({
                    database: 'st_bme_vectors',
                    exists: false,
                    status: 'missing',
                    embeddingMode: 'client',
                    serverEmbeddingSupported: false,
                    vectorApplySupported: false,
                    vectorManifestSupported: true,
                    vectorDim: null,
                    dtype: null,
                    storageMode: null,
                    syncMode: null,
                    mappingCount: 0,
                    nodeCount: null,
                    lastFlushAt: null,
                    updatedAt: null,
                }),
            },
            audit: {
                logError: vi.fn().mockResolvedValue(undefined),
                logPermission: vi.fn().mockResolvedValue(undefined),
            },
        } as unknown as AuthorityRuntime;

        registerRoutes(router, runtime);
        const response = {
            status: vi.fn().mockReturnThis(),
            json: vi.fn(),
            send: vi.fn(),
            setHeader: vi.fn(),
            write: vi.fn(),
            end: vi.fn(),
        };

        await posts.get('/bme/vector-manifest')?.({
            user: {
                profile: {
                    handle: 'alice',
                    admin: false,
                },
                directories: {
                    root: 'C:/users/alice',
                },
            },
            body: { database: 'st_bme_vectors' },
            headers: {},
        }, response);

        expect(runtime.permissions.authorize).toHaveBeenCalledWith(
            expect.objectContaining({ handle: 'alice' }),
            expect.objectContaining({ extension: { id: 'third-party/st-bme' } }),
            { resource: 'trivium.private', target: 'st_bme_vectors' },
        );
        expect(runtime.trivium.getBmeVectorManifest).toHaveBeenCalledWith(
            expect.objectContaining({ handle: 'alice' }),
            'third-party/st-bme',
            { database: 'st_bme_vectors' },
        );
        expect(response.json).toHaveBeenCalledWith(expect.objectContaining({
            database: 'st_bme_vectors',
            embeddingMode: 'client',
            vectorManifestSupported: true,
        }));
    });

    it('applies BME client-provided vectors through the session-gated route', async () => {
        const posts = new Map<string, (req: any, res: any) => void | Promise<void>>();
        const router = {
            get() {
                return undefined;
            },
            post(path: string, handler: (req: any, res: any) => void | Promise<void>) {
                posts.set(path, handler);
            },
        };
        const runtime = {
            sessions: {
                assertSession: vi.fn().mockResolvedValue({
                    extension: { id: 'third-party/st-bme' },
                }),
            },
            permissions: {
                authorize: vi.fn().mockResolvedValue(true),
            },
            trivium: {
                applyBmeVectorManifest: vi.fn().mockResolvedValue({
                    ok: true,
                    appliedAt: '2026-01-01T00:00:00.000Z',
                    database: 'st_bme_vectors',
                    manifest: { database: 'st_bme_vectors', exists: true },
                    upsert: { totalCount: 1, successCount: 1, failureCount: 0, failures: [], items: [] },
                    links: { totalCount: 0, successCount: 0, failureCount: 0, failures: [] },
                    skippedLinkCount: 0,
                }),
            },
            audit: {
                logError: vi.fn().mockResolvedValue(undefined),
                logPermission: vi.fn().mockResolvedValue(undefined),
            },
        } as unknown as AuthorityRuntime;

        registerRoutes(router, runtime);
        const response = {
            status: vi.fn().mockReturnThis(),
            json: vi.fn(),
            send: vi.fn(),
            setHeader: vi.fn(),
            write: vi.fn(),
            end: vi.fn(),
        };
        const body = {
            database: 'st_bme_vectors',
            items: [{ externalId: 'node-a', vector: [1, 0], payload: { text: 'a' } }],
            links: [],
        };

        await posts.get('/bme/vector-apply')?.({
            user: {
                profile: {
                    handle: 'alice',
                    admin: false,
                },
                directories: {
                    root: 'C:/users/alice',
                },
            },
            body,
            headers: {},
        }, response);

        expect(runtime.permissions.authorize).toHaveBeenCalledWith(
            expect.objectContaining({ handle: 'alice' }),
            expect.objectContaining({ extension: { id: 'third-party/st-bme' } }),
            { resource: 'trivium.private', target: 'st_bme_vectors' },
        );
        expect(runtime.trivium.applyBmeVectorManifest).toHaveBeenCalledWith(
            expect.objectContaining({ handle: 'alice' }),
            'third-party/st-bme',
            body,
        );
        expect(response.json).toHaveBeenCalledWith(expect.objectContaining({
            ok: true,
            database: 'st_bme_vectors',
        }));
    });

    it('resolves relative SillyTavern user directories from the server root before probing', async () => {
        const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'authority-st-root-'));
        const cwdSpy = vi.spyOn(process, 'cwd').mockReturnValue(tempRoot);
        try {
            const posts = new Map<string, (req: any, res: any) => void | Promise<void>>();
            const router = {
                get() {
                    return undefined;
                },
                post(path: string, handler: (req: any, res: any) => void | Promise<void>) {
                    posts.set(path, handler);
                },
            };

            const runtime = {
                core: {
                    refreshHealth: vi.fn().mockResolvedValue(undefined),
                    getStatus: vi.fn(() => ({ health: { limits: {} } })),
                },
                install: {
                    getStatus: vi.fn(() => ({
                        pluginVersion: AUTHORITY_VERSION,
                        sdkBundledVersion: AUTHORITY_VERSION,
                        sdkDeployedVersion: AUTHORITY_VERSION,
                        coreBundledVersion: AUTHORITY_VERSION,
                        coreArtifactPlatform: 'win32-x64',
                        coreArtifactPlatforms: ['win32-x64'],
                        coreArtifactHash: 'hash',
                        coreBinarySha256: 'sha256',
                        coreVerified: true,
                        coreMessage: null,
                        installStatus: 'ready',
                        installMessage: 'ready',
                    })),
                },
            } as unknown as AuthorityRuntime;

            registerRoutes(router, runtime);
            const response = {
                status: vi.fn().mockReturnThis(),
                json: vi.fn(),
                send: vi.fn(),
                setHeader: vi.fn(),
                write: vi.fn(),
                end: vi.fn(),
            };

            await posts.get('/probe')?.({
                user: {
                    profile: {
                        handle: 'alice',
                        admin: false,
                    },
                    directories: {
                        root: 'data/default-user',
                    },
                },
                body: {},
                headers: {},
            }, response);

            expect(response.json).toHaveBeenCalledWith(expect.objectContaining({
                storageRoot: path.join(tempRoot, 'data', 'default-user', 'extensions-data', 'authority', 'storage'),
            }));
        } finally {
            cwdSpy.mockRestore();
            fs.rmSync(tempRoot, { recursive: true, force: true });
        }
    });

    it('exposes ST-Manager bridge admin config without rotating or rewriting it', async () => {
        const gets = new Map<string, (req: any, res: any) => void | Promise<void>>();
        const router = {
            get(path: string, handler: (req: any, res: any) => void | Promise<void>) {
                gets.set(path, handler);
            },
            post() {
                return undefined;
            },
        };
        const runtime = {
            stManagerBridge: {
                getAdminConfig: vi.fn(() => ({
                    enabled: true,
                    bound_user_handle: 'alice',
                    key_fingerprint: 'abcdef123456',
                    key_masked: 'stmb_abcd...3456',
                    bridge_key: 'stmb_plain_key',
                    max_file_size: 104857600,
                    resource_types: ['characters'],
                })),
                updateAdminConfig: vi.fn(),
            },
        } as unknown as AuthorityRuntime;

        registerRoutes(router, runtime);
        const response = {
            status: vi.fn().mockReturnThis(),
            json: vi.fn(),
            send: vi.fn(),
            setHeader: vi.fn(),
            write: vi.fn(),
            end: vi.fn(),
        };

        await gets.get('/st-manager/bridge/admin/config')?.({
            user: {
                profile: {
                    handle: 'alice',
                    admin: true,
                },
                directories: {
                    root: 'C:/users/alice',
                },
            },
            headers: {},
        }, response);

        expect(runtime.stManagerBridge.getAdminConfig).toHaveBeenCalledWith(expect.objectContaining({
            handle: 'alice',
            isAdmin: true,
        }));
        expect(runtime.stManagerBridge.updateAdminConfig).not.toHaveBeenCalled();
        expect(response.json).toHaveBeenCalledWith(expect.objectContaining({
            enabled: true,
            key_masked: 'stmb_abcd...3456',
            bridge_key: 'stmb_plain_key',
        }));
    });

    it('allows ST-Manager bridge probe with Bridge Key only', async () => {
        const gets = new Map<string, (req: any, res: any) => void | Promise<void>>();
        const router = {
            get(path: string, handler: (req: any, res: any) => void | Promise<void>) {
                gets.set(path, handler);
            },
            post() {
                return undefined;
            },
        };

        const boundUser = {
            handle: 'alice',
            isAdmin: true,
            rootDir: 'C:/users/alice',
            directories: { root: 'C:/users/alice' },
        };
        const runtime = {
            stManagerBridge: {
                resolveAuthorizedUser: vi.fn(() => boundUser),
                probe: vi.fn(() => ({ success: true, user: { handle: 'alice', root: 'C:/users/alice' } })),
            },
            audit: {
                logError: vi.fn().mockResolvedValue(undefined),
            },
        } as unknown as AuthorityRuntime;

        registerRoutes(router, runtime);
        const response = {
            status: vi.fn().mockReturnThis(),
            json: vi.fn(),
            send: vi.fn(),
            setHeader: vi.fn(),
            write: vi.fn(),
            end: vi.fn(),
        };

        await gets.get('/st-manager/bridge/probe')?.({
            headers: { authorization: 'Bearer stmb_key' },
        }, response);

        expect(runtime.stManagerBridge.resolveAuthorizedUser).toHaveBeenCalledWith(undefined, { authorization: 'Bearer stmb_key' });
        expect(runtime.stManagerBridge.probe).toHaveBeenCalledWith(boundUser, { authorization: 'Bearer stmb_key' });
        expect(response.json).toHaveBeenCalledWith(expect.objectContaining({ success: true }));
    });

    it('exposes ST-Manager control routes for admins', async () => {
        const gets = new Map<string, (req: any, res: any) => void | Promise<void>>();
        const posts = new Map<string, (req: any, res: any) => void | Promise<void>>();
        const router = {
            get(path: string, handler: (req: any, res: any) => void | Promise<void>) {
                gets.set(path, handler);
            },
            post(path: string, handler: (req: any, res: any) => void | Promise<void>) {
                posts.set(path, handler);
            },
        };
        const runtime = {
            stManagerControl: {
                getAdminConfig: vi.fn(() => ({ enabled: true, manager_url: 'https://manager.example', control_key: 'stmc_plain_key' })),
                startBackup: vi.fn(async () => ({ success: true, backup: { backup_id: 'backup-001' } })),
            },
            audit: {
                logError: vi.fn().mockResolvedValue(undefined),
            },
        } as unknown as AuthorityRuntime;
        const response = {
            status: vi.fn().mockReturnThis(),
            json: vi.fn(),
            send: vi.fn(),
            setHeader: vi.fn(),
            write: vi.fn(),
            end: vi.fn(),
        };
        const adminRequest = {
            user: {
                profile: { handle: 'alice', admin: true },
                directories: { root: 'C:/users/alice' },
            },
            headers: {},
            body: { resource_types: ['characters'] },
        };

        registerRoutes(router, runtime);
        await gets.get('/st-manager/control/config')?.(adminRequest, response);
        await posts.get('/st-manager/control/backup/start')?.(adminRequest, response);

        expect(runtime.stManagerControl.getAdminConfig).toHaveBeenCalled();
        expect(runtime.stManagerControl.startBackup).toHaveBeenCalledWith(
            expect.objectContaining({ handle: 'alice', isAdmin: true }),
            { resource_types: ['characters'] },
        );
        expect(response.json).toHaveBeenCalledWith(expect.objectContaining({ manager_url: 'https://manager.example', control_key: 'stmc_plain_key' }));
        expect(response.json).toHaveBeenCalledWith(expect.objectContaining({ success: true }));
    });

    it('initializes native migration uploads with 12 GiB ceiling and large chunks', async () => {
        const posts = new Map<string, (req: any, res: any) => void | Promise<void>>();
        const router = {
            get() {
                return undefined;
            },
            post(path: string, handler: (req: any, res: any) => void | Promise<void>) {
                posts.set(path, handler);
            },
        };
        const runtime = {
            transfers: {
                init: vi.fn(async () => ({ transferId: 'transfer-001', chunkSize: NATIVE_MIGRATION_TRANSFER_CHUNK_BYTES })),
            },
            audit: {
                logError: vi.fn().mockResolvedValue(undefined),
            },
        } as unknown as AuthorityRuntime;
        const response = {
            status: vi.fn().mockReturnThis(),
            json: vi.fn(),
            send: vi.fn(),
            setHeader: vi.fn(),
            write: vi.fn(),
            end: vi.fn(),
        };

        registerRoutes(router, runtime);
        await posts.get('/admin/native-migration/upload/init')?.({
            user: { profile: { handle: 'alice', admin: true }, directories: { root: 'C:/users/alice' } },
            headers: {},
            body: { sizeBytes: NATIVE_MIGRATION_MAX_COMPRESSED_BYTES },
        }, response);

        expect(runtime.transfers.init).toHaveBeenCalledWith(
            expect.objectContaining({ handle: 'alice', isAdmin: true }),
            'third-party/st-authority-sdk',
            { resource: 'fs.private', purpose: 'privateFileWrite' },
            NATIVE_MIGRATION_MAX_COMPRESSED_BYTES,
            NATIVE_MIGRATION_TRANSFER_CHUNK_BYTES,
        );
        expect(response.json).toHaveBeenCalledWith(expect.objectContaining({ transferId: 'transfer-001' }));
    });

    it('previews native migration from an uploaded transfer and adopts the staged archive', async () => {
        const posts = new Map<string, (req: any, res: any) => void | Promise<void>>();
        const router = {
            get() {
                return undefined;
            },
            post(path: string, handler: (req: any, res: any) => void | Promise<void>) {
                posts.set(path, handler);
            },
        };
        const runtime = {
            transfers: {
                get: vi.fn(() => ({ transferId: 'transfer-001', filePath: '/tmp/upload.zip' })),
                discard: vi.fn(async () => undefined),
            },
            nativeMigrations: {
                preview: vi.fn(async () => ({ id: 'migration-001', target: 'data', entryCount: 1, sourceSizeBytes: 100 })),
            },
            audit: {
                logUsage: vi.fn().mockResolvedValue(undefined),
                logError: vi.fn().mockResolvedValue(undefined),
            },
        } as unknown as AuthorityRuntime;
        const response = {
            status: vi.fn().mockReturnThis(),
            json: vi.fn(),
            send: vi.fn(),
            setHeader: vi.fn(),
            write: vi.fn(),
            end: vi.fn(),
        };

        registerRoutes(router, runtime);
        await posts.get('/admin/native-migration/preview')?.({
            user: { profile: { handle: 'alice', admin: true }, directories: { root: 'C:/users/alice' } },
            headers: {},
            body: { transferId: 'transfer-001', target: 'data', fileName: 'old-data.zip' },
        }, response);

        expect(runtime.nativeMigrations.preview).toHaveBeenCalledWith('data', '/tmp/upload.zip', { sourceFileName: 'old-data.zip', adoptSource: true });
        expect(runtime.transfers.discard).toHaveBeenCalledWith(expect.anything(), 'third-party/st-authority-sdk', 'transfer-001');
        expect(response.json).toHaveBeenCalledWith(expect.objectContaining({ id: 'migration-001' }));
    });
});

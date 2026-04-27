import { describe, expect, it, vi } from 'vitest';
import { AUTHORITY_VERSION } from './version.js';
import { registerRoutes } from './routes.js';
import type { AuthorityRuntime } from './runtime.js';
import { AuthorityServiceError } from './utils.js';

describe('registerRoutes', () => {
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
            '/admin/policies',
            '/admin/import-export/operations',
            '/admin/usage-summary',
            '/admin/diagnostic-bundle',
        ]));
        expect(posts).toEqual(expect.arrayContaining([
            '/permissions/evaluate-batch',
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
            '/admin/import-export/export',
            '/admin/import-export/import-transfer/init',
            '/admin/import-export/import',
            '/admin/import-export/operations/:id/resume',
            '/admin/import-export/operations/:id/open-download',
            '/admin/diagnostic-bundle/archive',
            '/admin/update',
        ]));
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
            limits: expect.objectContaining({
                effectiveInlineThresholdBytes: expect.objectContaining({
                    storageBlobWrite: { bytes: 256 * 1024, source: 'runtime' },
                    privateFileRead: { bytes: 256 * 1024, source: 'runtime' },
                    httpFetchResponse: { bytes: 256 * 1024, source: 'runtime' },
                }),
                effectiveTransferMaxBytes: expect.objectContaining({
                    storageBlobWrite: { bytes: Number.MAX_SAFE_INTEGER, source: 'runtime' },
                    privateFileRead: { bytes: Number.MAX_SAFE_INTEGER, source: 'runtime' },
                    httpFetchRequest: { bytes: Number.MAX_SAFE_INTEGER, source: 'runtime' },
                    httpFetchResponse: { bytes: Number.MAX_SAFE_INTEGER, source: 'runtime' },
                }),
            }),
        }));
    });
});

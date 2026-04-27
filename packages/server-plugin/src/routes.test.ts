import { describe, expect, it, vi } from 'vitest';
import { registerRoutes } from './routes.js';
import type { AuthorityRuntime } from './runtime.js';

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
        ]));
        expect(posts).toEqual(expect.arrayContaining([
            '/transfers/init',
            '/transfers/:id/append',
            '/transfers/:id/read',
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
            details: {
                resource: 'storage.kv',
                target: '*',
                key: 'storage.kv:*',
                riskLevel: 'low',
            },
        });
    });
});

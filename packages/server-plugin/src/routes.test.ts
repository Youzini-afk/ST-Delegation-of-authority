import { describe, expect, it } from 'vitest';
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
            '/jobs/list',
            '/http/fetch-open',
            '/fs/private/delete',
            '/fs/private/stat',
            '/admin/update',
        ]));
    });
});

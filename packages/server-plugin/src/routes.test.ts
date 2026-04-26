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
            '/fs/private/mkdir',
            '/fs/private/read-dir',
            '/fs/private/write-file',
            '/fs/private/read-file',
            '/fs/private/delete',
            '/fs/private/stat',
            '/admin/update',
        ]));
    });
});

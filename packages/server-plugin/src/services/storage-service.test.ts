import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { StorageService } from './storage-service.js';
import type { UserContext } from '../types.js';

describe('StorageService', () => {
    const dirs: string[] = [];

    afterEach(() => {
        while (dirs.length > 0) {
            const dir = dirs.pop();
            if (dir) {
                fs.rmSync(dir, { recursive: true, force: true });
            }
        }
    });

    it('isolates kv namespaces by extension id', () => {
        const user = createUser(dirs);
        const storage = new StorageService();

        storage.setKv(user, 'third-party/ext-a', 'foo', { value: 1 });
        storage.setKv(user, 'third-party/ext-b', 'foo', { value: 2 });

        expect(storage.getKv(user, 'third-party/ext-a', 'foo')).toEqual({ value: 1 });
        expect(storage.getKv(user, 'third-party/ext-b', 'foo')).toEqual({ value: 2 });
        expect(storage.listKv(user, 'third-party/ext-a')).toEqual({ foo: { value: 1 } });
    });

    it('stores blob content and metadata under the extension namespace', () => {
        const user = createUser(dirs);
        const storage = new StorageService();

        const record = storage.putBlob(user, 'third-party/ext-a', 'hello.txt', 'hello authority', 'utf8', 'text/plain');
        expect(record.id).toBe('hello.txt');
        expect(storage.listBlobs(user, 'third-party/ext-a')).toHaveLength(1);

        const blob = storage.getBlob(user, 'third-party/ext-a', record.id);
        expect(Buffer.from(blob.content, 'base64').toString('utf8')).toBe('hello authority');

        storage.deleteBlob(user, 'third-party/ext-a', record.id);
        expect(storage.listBlobs(user, 'third-party/ext-a')).toEqual([]);
    });
});

function createUser(dirs: string[]): UserContext {
    const rootDir = fs.mkdtempSync(path.join(os.tmpdir(), 'authority-storage-'));
    dirs.push(rootDir);
    return {
        handle: 'alice',
        isAdmin: false,
        rootDir,
    };
}

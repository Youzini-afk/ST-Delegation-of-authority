import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import type { BlobGetResponse, BlobRecord } from '@stdo/shared-types';
import { StorageService } from './storage-service.js';
import type { CoreService } from './core-service.js';
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

    it('isolates kv namespaces by extension id', async () => {
        const user = createUser(dirs);
        const storage = new StorageService(createMockCore());

        await storage.setKv(user, 'third-party/ext-a', 'foo', { value: 1 });
        await storage.setKv(user, 'third-party/ext-b', 'foo', { value: 2 });

        expect(await storage.getKv(user, 'third-party/ext-a', 'foo')).toEqual({ value: 1 });
        expect(await storage.getKv(user, 'third-party/ext-b', 'foo')).toEqual({ value: 2 });
        expect(await storage.listKv(user, 'third-party/ext-a')).toEqual({ foo: { value: 1 } });
    });

    it('stores blob content and metadata under the extension namespace', async () => {
        const user = createUser(dirs);
        const storage = new StorageService(createMockCore());

        const record = await storage.putBlob(user, 'third-party/ext-a', 'hello.txt', 'hello authority', 'utf8', 'text/plain');
        expect(record.id).toBe('hello.txt');
        expect(await storage.listBlobs(user, 'third-party/ext-a')).toHaveLength(1);

        const blob = await storage.getBlob(user, 'third-party/ext-a', record.id);
        expect(Buffer.from(blob.content, 'base64').toString('utf8')).toBe('hello authority');

        await storage.deleteBlob(user, 'third-party/ext-a', record.id);
        expect(await storage.listBlobs(user, 'third-party/ext-a')).toEqual([]);
    });
});

function createMockCore(): CoreService {
    const kvStores = new Map<string, Map<string, unknown>>();
    const blobStores = new Map<string, Map<string, BlobGetResponse>>();

    function getKvStore(dbPath: string): Map<string, unknown> {
        let store = kvStores.get(dbPath);
        if (!store) {
            store = new Map<string, unknown>();
            kvStores.set(dbPath, store);
        }
        return store;
    }

    function getBlobStore(dbPath: string, extensionId: string): Map<string, BlobGetResponse> {
        const key = `${dbPath}:${extensionId}`;
        let store = blobStores.get(key);
        if (!store) {
            store = new Map<string, BlobGetResponse>();
            blobStores.set(key, store);
        }
        return store;
    }

    function toBlobRecord(name: string, contentType: string, content: string, encoding: 'utf8' | 'base64'): BlobGetResponse {
        const payload = encoding === 'base64' ? Buffer.from(content, 'base64') : Buffer.from(content, 'utf8');
        const record: BlobRecord = {
            id: name.replace(/[^a-zA-Z0-9._-]/g, '_') || 'blob',
            name,
            contentType,
            size: payload.byteLength,
            updatedAt: new Date().toISOString(),
        };
        return {
            record,
            content: payload.toString('base64'),
            encoding: 'base64',
        };
    }

    return {
        async getStorageKv(dbPath: string, request: { key: string }) {
            return getKvStore(dbPath).get(request.key);
        },
        async setStorageKv(dbPath: string, request: { key: string; value: unknown }) {
            getKvStore(dbPath).set(request.key, request.value);
        },
        async deleteStorageKv(dbPath: string, request: { key: string }) {
            getKvStore(dbPath).delete(request.key);
        },
        async listStorageKv(dbPath: string) {
            return Object.fromEntries(getKvStore(dbPath).entries());
        },
        async putStorageBlob(dbPath: string, request: { extensionId: string; name: string; content: string; encoding?: 'utf8' | 'base64'; contentType?: string }) {
            const blob = toBlobRecord(request.name, request.contentType ?? 'application/octet-stream', request.content, request.encoding ?? 'utf8');
            getBlobStore(dbPath, request.extensionId).set(blob.record.id, blob);
            return blob.record;
        },
        async getStorageBlob(dbPath: string, request: { extensionId: string; id: string }) {
            const blob = getBlobStore(dbPath, request.extensionId).get(request.id);
            if (!blob) {
                throw new Error('Blob not found');
            }
            return blob;
        },
        async deleteStorageBlob(dbPath: string, request: { extensionId: string; id: string }) {
            getBlobStore(dbPath, request.extensionId).delete(request.id);
        },
        async listStorageBlobs(dbPath: string, request: { extensionId: string }) {
            return [...getBlobStore(dbPath, request.extensionId).values()].map(blob => blob.record);
        },
    } as unknown as CoreService;
}

function createUser(dirs: string[]): UserContext {
    const rootDir = fs.mkdtempSync(path.join(os.tmpdir(), 'authority-storage-'));
    dirs.push(rootDir);
    return {
        handle: 'alice',
        isAdmin: false,
        rootDir,
    };
}

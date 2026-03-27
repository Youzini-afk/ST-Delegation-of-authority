import fs from 'node:fs';
import path from 'node:path';
import type { BlobRecord } from '@stdo/shared-types';
import { MAX_BLOB_BYTES, MAX_KV_VALUE_BYTES } from '../constants.js';
import { getUserAuthorityPaths } from '../store/authority-paths.js';
import type { UserContext } from '../types.js';
import { atomicWriteJson, ensureDir, nowIso, readJsonFile, sanitizeFileSegment } from '../utils.js';

export class StorageService {
    getKv(user: UserContext, extensionId: string, key: string): unknown {
        return this.listKv(user, extensionId)[key];
    }

    setKv(user: UserContext, extensionId: string, key: string, value: unknown): void {
        const valueBytes = Buffer.byteLength(JSON.stringify(value));
        if (valueBytes > MAX_KV_VALUE_BYTES) {
            throw new Error(`KV value exceeds ${MAX_KV_VALUE_BYTES} bytes`);
        }

        const filePath = this.getKvFilePath(user, extensionId);
        const data = readJsonFile<Record<string, unknown>>(filePath, {});
        data[key] = value;
        atomicWriteJson(filePath, data);
    }

    deleteKv(user: UserContext, extensionId: string, key: string): void {
        const filePath = this.getKvFilePath(user, extensionId);
        const data = readJsonFile<Record<string, unknown>>(filePath, {});
        delete data[key];
        atomicWriteJson(filePath, data);
    }

    listKv(user: UserContext, extensionId: string): Record<string, unknown> {
        return readJsonFile<Record<string, unknown>>(this.getKvFilePath(user, extensionId), {});
    }

    putBlob(user: UserContext, extensionId: string, name: string, content: string, encoding: 'utf8' | 'base64' = 'utf8', contentType = 'application/octet-stream'): BlobRecord {
        const extensionDir = this.getBlobDir(user, extensionId);
        ensureDir(extensionDir);

        const blobId = sanitizeFileSegment(name || 'blob');
        const payload = encoding === 'base64' ? Buffer.from(content, 'base64') : Buffer.from(content, 'utf8');
        if (payload.byteLength > MAX_BLOB_BYTES) {
            throw new Error(`Blob exceeds ${MAX_BLOB_BYTES} bytes`);
        }

        const binPath = path.join(extensionDir, `${blobId}.bin`);
        const metaPath = path.join(extensionDir, `${blobId}.json`);
        fs.writeFileSync(binPath, payload);

        const record: BlobRecord = {
            id: blobId,
            name,
            contentType,
            size: payload.byteLength,
            updatedAt: nowIso(),
        };
        atomicWriteJson(metaPath, record);
        return record;
    }

    getBlob(user: UserContext, extensionId: string, blobId: string): { record: BlobRecord; content: string; encoding: 'base64' } {
        const extensionDir = this.getBlobDir(user, extensionId);
        const safeId = sanitizeFileSegment(blobId);
        const metaPath = path.join(extensionDir, `${safeId}.json`);
        const binPath = path.join(extensionDir, `${safeId}.bin`);
        if (!fs.existsSync(metaPath) || !fs.existsSync(binPath)) {
            throw new Error('Blob not found');
        }

        const record = readJsonFile<BlobRecord>(metaPath, {} as BlobRecord);
        return {
            record,
            content: fs.readFileSync(binPath).toString('base64'),
            encoding: 'base64',
        };
    }

    deleteBlob(user: UserContext, extensionId: string, blobId: string): void {
        const extensionDir = this.getBlobDir(user, extensionId);
        const safeId = sanitizeFileSegment(blobId);
        fs.rmSync(path.join(extensionDir, `${safeId}.json`), { force: true });
        fs.rmSync(path.join(extensionDir, `${safeId}.bin`), { force: true });
    }

    listBlobs(user: UserContext, extensionId: string): BlobRecord[] {
        const extensionDir = this.getBlobDir(user, extensionId);
        if (!fs.existsSync(extensionDir)) {
            return [];
        }

        return fs.readdirSync(extensionDir)
            .filter(entry => entry.endsWith('.json'))
            .map(entry => readJsonFile<BlobRecord>(path.join(extensionDir, entry), {} as BlobRecord))
            .filter(record => Boolean(record?.id));
    }

    private getKvFilePath(user: UserContext, extensionId: string): string {
        const paths = getUserAuthorityPaths(user);
        ensureDir(paths.kvDir);
        return path.join(paths.kvDir, `${sanitizeFileSegment(extensionId)}.json`);
    }

    private getBlobDir(user: UserContext, extensionId: string): string {
        const paths = getUserAuthorityPaths(user);
        return path.join(paths.blobDir, sanitizeFileSegment(extensionId));
    }
}


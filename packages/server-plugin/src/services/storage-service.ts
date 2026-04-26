import path from 'node:path';
import type { BlobGetResponse, BlobRecord, ControlBlobOpenReadResponse } from '@stdo/shared-types';
import { getUserAuthorityPaths } from '../store/authority-paths.js';
import type { UserContext } from '../types.js';
import { sanitizeFileSegment } from '../utils.js';
import { CoreService } from './core-service.js';

export class StorageService {
    constructor(private readonly core: CoreService) {}

    async getKv(user: UserContext, extensionId: string, key: string): Promise<unknown> {
        const paths = getUserAuthorityPaths(user);
        return await this.core.getStorageKv(this.getKvDbPath(paths.kvDir, extensionId), { key });
    }

    async setKv(user: UserContext, extensionId: string, key: string, value: unknown): Promise<void> {
        const paths = getUserAuthorityPaths(user);
        await this.core.setStorageKv(this.getKvDbPath(paths.kvDir, extensionId), { key, value });
    }

    async deleteKv(user: UserContext, extensionId: string, key: string): Promise<void> {
        const paths = getUserAuthorityPaths(user);
        await this.core.deleteStorageKv(this.getKvDbPath(paths.kvDir, extensionId), { key });
    }

    async listKv(user: UserContext, extensionId: string): Promise<Record<string, unknown>> {
        const paths = getUserAuthorityPaths(user);
        return await this.core.listStorageKv(this.getKvDbPath(paths.kvDir, extensionId));
    }

    async putBlob(
        user: UserContext,
        extensionId: string,
        name: string,
        content: string,
        encoding: 'utf8' | 'base64' = 'utf8',
        contentType = 'application/octet-stream',
    ): Promise<BlobRecord> {
        const paths = getUserAuthorityPaths(user);
        return await this.core.putStorageBlob(paths.controlDbFile, {
            userHandle: user.handle,
            extensionId,
            blobDir: paths.blobDir,
            name,
            content,
            encoding,
            contentType,
        });
    }

    async putBlobFromSource(user: UserContext, extensionId: string, name: string, sourcePath: string, contentType = 'application/octet-stream'): Promise<BlobRecord> {
        const paths = getUserAuthorityPaths(user);
        return await this.core.putStorageBlob(paths.controlDbFile, {
            userHandle: user.handle,
            extensionId,
            blobDir: paths.blobDir,
            name,
            content: '',
            contentType,
            sourcePath,
        });
    }

    async getBlob(user: UserContext, extensionId: string, blobId: string): Promise<BlobGetResponse> {
        const paths = getUserAuthorityPaths(user);
        return await this.core.getStorageBlob(paths.controlDbFile, {
            userHandle: user.handle,
            extensionId,
            blobDir: paths.blobDir,
            id: blobId,
        });
    }

    async openBlobRead(user: UserContext, extensionId: string, blobId: string): Promise<ControlBlobOpenReadResponse> {
        const paths = getUserAuthorityPaths(user);
        return await this.core.openStorageBlobRead(paths.controlDbFile, {
            userHandle: user.handle,
            extensionId,
            blobDir: paths.blobDir,
            id: blobId,
        });
    }

    async deleteBlob(user: UserContext, extensionId: string, blobId: string): Promise<void> {
        const paths = getUserAuthorityPaths(user);
        await this.core.deleteStorageBlob(paths.controlDbFile, {
            userHandle: user.handle,
            extensionId,
            blobDir: paths.blobDir,
            id: blobId,
        });
    }

    async listBlobs(user: UserContext, extensionId: string): Promise<BlobRecord[]> {
        const paths = getUserAuthorityPaths(user);
        return await this.core.listStorageBlobs(paths.controlDbFile, {
            userHandle: user.handle,
            extensionId,
            blobDir: paths.blobDir,
        });
    }

    private getKvDbPath(kvDir: string, extensionId: string): string {
        return path.join(kvDir, `${sanitizeFileSegment(extensionId)}.sqlite`);
    }
}


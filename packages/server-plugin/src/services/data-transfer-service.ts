import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import type {
    DataTransferAppendRequest,
    DataTransferAppendResponse,
    DataTransferInitRequest,
    DataTransferInitResponse,
    DataTransferResource,
} from '@stdo/shared-types';
import { DATA_TRANSFER_CHUNK_BYTES, MAX_DATA_TRANSFER_BYTES } from '../constants.js';
import { getUserAuthorityPaths } from '../store/authority-paths.js';
import type { UserContext } from '../types.js';
import { sanitizeFileSegment } from '../utils.js';

interface DataTransferRecord {
    transferId: string;
    userHandle: string;
    extensionId: string;
    resource: DataTransferResource;
    filePath: string;
    sizeBytes: number;
    maxBytes: number;
    createdAt: string;
    updatedAt: string;
}

export class DataTransferService {
    private readonly transfers = new Map<string, DataTransferRecord>();

    async init(user: UserContext, extensionId: string, request: DataTransferInitRequest): Promise<DataTransferInitResponse> {
        const resource = normalizeTransferResource(request.resource);
        const transferId = crypto.randomUUID();
        const timestamp = new Date().toISOString();
        const dirPath = this.getTransferDir(user, extensionId, resource);
        fs.mkdirSync(dirPath, { recursive: true });
        const filePath = path.join(dirPath, `${transferId}.part`);
        fs.writeFileSync(filePath, Buffer.alloc(0));

        const record: DataTransferRecord = {
            transferId,
            userHandle: user.handle,
            extensionId,
            resource,
            filePath,
            sizeBytes: 0,
            maxBytes: MAX_DATA_TRANSFER_BYTES,
            createdAt: timestamp,
            updatedAt: timestamp,
        };
        this.transfers.set(transferId, record);
        return toInitResponse(record);
    }

    async append(user: UserContext, extensionId: string, transferId: string, request: DataTransferAppendRequest): Promise<DataTransferAppendResponse> {
        const record = this.get(user, extensionId, transferId);
        if (request.offset !== record.sizeBytes) {
            throw new Error(`Transfer offset mismatch: expected ${record.sizeBytes}, received ${request.offset}`);
        }
        const chunk = decodeTransferChunk(request.content);
        const nextSize = record.sizeBytes + chunk.byteLength;
        if (nextSize > record.maxBytes) {
            throw new Error(`Transfer exceeds ${record.maxBytes} bytes`);
        }

        fs.appendFileSync(record.filePath, chunk);
        record.sizeBytes = nextSize;
        record.updatedAt = new Date().toISOString();
        return {
            transferId: record.transferId,
            sizeBytes: record.sizeBytes,
            updatedAt: record.updatedAt,
        };
    }

    get(user: UserContext, extensionId: string, transferId: string, resource?: DataTransferResource): DataTransferRecord {
        const record = this.transfers.get(transferId);
        if (!record || record.userHandle !== user.handle || record.extensionId !== extensionId) {
            throw new Error('Transfer not found');
        }
        if (resource && record.resource !== resource) {
            throw new Error(`Transfer resource mismatch: expected ${resource}, received ${record.resource}`);
        }
        return record;
    }

    async discard(user: UserContext, extensionId: string, transferId: string): Promise<void> {
        const record = this.get(user, extensionId, transferId);
        this.transfers.delete(transferId);
        try {
            fs.rmSync(record.filePath, { force: true });
        } finally {
            pruneEmptyTransferDirs(path.dirname(record.filePath));
        }
    }

    private getTransferDir(user: UserContext, extensionId: string, resource: DataTransferResource): string {
        const paths = getUserAuthorityPaths(user);
        const stateDir = path.dirname(paths.controlDbFile);
        return path.join(
            stateDir,
            'transfers',
            sanitizeFileSegment(extensionId),
            sanitizeFileSegment(resource),
        );
    }
}

function toInitResponse(record: DataTransferRecord): DataTransferInitResponse {
    return {
        transferId: record.transferId,
        resource: record.resource,
        chunkSize: DATA_TRANSFER_CHUNK_BYTES,
        maxBytes: record.maxBytes,
        createdAt: record.createdAt,
        updatedAt: record.updatedAt,
        sizeBytes: record.sizeBytes,
    };
}

function normalizeTransferResource(resource: DataTransferInitRequest['resource']): DataTransferResource {
    if (resource === 'storage.blob' || resource === 'fs.private') {
        return resource;
    }
    throw new Error(`Unsupported transfer resource: ${String(resource)}`);
}

function decodeTransferChunk(content: string): Buffer {
    try {
        return Buffer.from(content, 'base64');
    } catch {
        throw new Error('Invalid transfer chunk encoding');
    }
}

function pruneEmptyTransferDirs(dirPath: string): void {
    let current = dirPath;
    for (let index = 0; index < 3; index += 1) {
        try {
            fs.rmdirSync(current);
        } catch {
            return;
        }
        const parent = path.dirname(current);
        if (parent === current) {
            return;
        }
        current = parent;
    }
}

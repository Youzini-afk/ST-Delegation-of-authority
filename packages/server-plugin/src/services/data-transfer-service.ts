import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import type {
    DataTransferAppendRequest,
    DataTransferAppendResponse,
    DataTransferInitRequest,
    DataTransferInitResponse,
    DataTransferReadRequest,
    DataTransferReadResponse,
    DataTransferResource,
} from '@stdo/shared-types';
import { DATA_TRANSFER_CHUNK_BYTES, MAX_DATA_TRANSFER_BYTES } from '../constants.js';
import { getUserAuthorityPaths } from '../store/authority-paths.js';
import type { UserContext } from '../types.js';
import { sanitizeFileSegment } from '../utils.js';

interface DataTransferOpenReadRequest {
    resource: DataTransferResource;
    sourcePath: string;
}

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
    direction: 'upload' | 'download';
    ownedFile: boolean;
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
            direction: 'upload',
            ownedFile: true,
        };
        this.transfers.set(transferId, record);
        return toInitResponse(record);
    }

    async append(user: UserContext, extensionId: string, transferId: string, request: DataTransferAppendRequest): Promise<DataTransferAppendResponse> {
        const record = this.get(user, extensionId, transferId);
        if (record.direction !== 'upload') {
            throw new Error('Transfer does not accept append operations');
        }
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

    async openRead(user: UserContext, extensionId: string, request: DataTransferOpenReadRequest): Promise<DataTransferInitResponse> {
        const resource = normalizeTransferResource(request.resource);
        const { filePath, sizeBytes } = validateReadableTransferFile(request.sourcePath);
        if (sizeBytes > MAX_DATA_TRANSFER_BYTES) {
            throw new Error(`Transfer exceeds ${MAX_DATA_TRANSFER_BYTES} bytes`);
        }

        const transferId = crypto.randomUUID();
        const timestamp = new Date().toISOString();
        const record: DataTransferRecord = {
            transferId,
            userHandle: user.handle,
            extensionId,
            resource,
            filePath,
            sizeBytes,
            maxBytes: sizeBytes,
            createdAt: timestamp,
            updatedAt: timestamp,
            direction: 'download',
            ownedFile: false,
        };
        this.transfers.set(transferId, record);
        return toInitResponse(record);
    }

    async promoteToDownload(user: UserContext, extensionId: string, transferId: string): Promise<DataTransferInitResponse> {
        const record = this.get(user, extensionId, transferId);
        if (record.direction !== 'upload') {
            throw new Error('Transfer is already readable');
        }

        const { filePath, sizeBytes } = validateReadableTransferFile(record.filePath);
        if (sizeBytes > MAX_DATA_TRANSFER_BYTES) {
            throw new Error(`Transfer exceeds ${MAX_DATA_TRANSFER_BYTES} bytes`);
        }

        record.filePath = filePath;
        record.sizeBytes = sizeBytes;
        record.maxBytes = sizeBytes;
        record.direction = 'download';
        record.updatedAt = new Date().toISOString();
        return toInitResponse(record);
    }

    async read(user: UserContext, extensionId: string, transferId: string, request: DataTransferReadRequest): Promise<DataTransferReadResponse> {
        const record = this.get(user, extensionId, transferId);
        if (record.direction !== 'download') {
            throw new Error('Transfer does not support read operations');
        }
        if (!Number.isInteger(request.offset) || request.offset < 0) {
            throw new Error('Transfer offset must be a non-negative integer');
        }
        if (request.offset > record.sizeBytes) {
            throw new Error(`Transfer offset exceeds size ${record.sizeBytes}`);
        }

        const remaining = record.sizeBytes - request.offset;
        const requestedLimit = request.limit ?? DATA_TRANSFER_CHUNK_BYTES;
        if (!Number.isInteger(requestedLimit) || requestedLimit < 0) {
            throw new Error('Transfer limit must be a non-negative integer');
        }

        const limit = Math.min(requestedLimit, DATA_TRANSFER_CHUNK_BYTES, remaining);
        if (limit === 0) {
            return {
                transferId: record.transferId,
                offset: request.offset,
                content: '',
                encoding: 'base64',
                sizeBytes: record.sizeBytes,
                eof: true,
                updatedAt: record.updatedAt,
            };
        }

        const handle = fs.openSync(record.filePath, 'r');
        try {
            const buffer = Buffer.alloc(limit);
            const bytesRead = fs.readSync(handle, buffer, 0, limit, request.offset);
            return {
                transferId: record.transferId,
                offset: request.offset,
                content: buffer.subarray(0, bytesRead).toString('base64'),
                encoding: 'base64',
                sizeBytes: record.sizeBytes,
                eof: request.offset + bytesRead >= record.sizeBytes,
                updatedAt: record.updatedAt,
            };
        } finally {
            fs.closeSync(handle);
        }
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
        if (!record.ownedFile) {
            return;
        }
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
    if (resource === 'storage.blob' || resource === 'fs.private' || resource === 'http.fetch') {
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

function validateReadableTransferFile(sourcePath: string): { filePath: string; sizeBytes: number } {
    const filePath = sourcePath.trim();
    if (!filePath) {
        throw new Error('Transfer source path is required');
    }
    let metadata: fs.Stats;
    try {
        metadata = fs.lstatSync(filePath);
    } catch {
        throw new Error('Transfer source file not found');
    }
    if (metadata.isSymbolicLink()) {
        throw new Error('Transfer source symlink is not allowed');
    }
    if (!metadata.isFile()) {
        throw new Error('Transfer source must be a file');
    }
    return {
        filePath,
        sizeBytes: metadata.size,
    };
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

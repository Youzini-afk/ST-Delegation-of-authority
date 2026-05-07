import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import type {
    AuthorityInlineThresholdKey,
    DataTransferAppendRequest,
    DataTransferAppendResponse,
    DataTransferInitRequest,
    DataTransferInitResponse,
    DataTransferManifestResponse,
    DataTransferReadRequest,
    DataTransferReadResponse,
    DataTransferResource,
} from '@stdo/shared-types';
import {
    DATA_TRANSFER_CHUNK_BYTES,
    UNMANAGED_TRANSFER_MAX_BYTES,
} from '../constants.js';
import { getUserAuthorityPaths } from '../store/authority-paths.js';
import type { UserContext } from '../types.js';
import { resolveContainedPath, sanitizeFileSegment } from '../utils.js';

interface DataTransferOpenReadRequest {
    resource: DataTransferResource;
    sourcePath: string;
    purpose?: AuthorityInlineThresholdKey;
}

interface DataTransferRecord {
    transferId: string;
    userHandle: string;
    extensionId: string;
    resource: DataTransferResource;
    purpose?: AuthorityInlineThresholdKey;
    filePath: string;
    sizeBytes: number;
    maxBytes: number;
    createdAt: string;
    updatedAt: string;
    direction: 'upload' | 'download';
    ownedFile: boolean;
    checksumSha256: string;
}

const EMPTY_FILE_SHA256 = crypto.createHash('sha256').update('').digest('hex');

export class DataTransferService {
    private readonly transfers = new Map<string, DataTransferRecord>();

    async init(user: UserContext, extensionId: string, request: DataTransferInitRequest, maxBytesOverride?: number): Promise<DataTransferInitResponse> {
        const resource = normalizeTransferResource(request.resource);
        const purpose = normalizeTransferPurpose(resource, request.purpose);
        const transferId = crypto.randomUUID();
        const timestamp = new Date().toISOString();
        const dirPath = this.getTransferDataDir(user, extensionId, resource);
        fs.mkdirSync(dirPath, { recursive: true });
        fs.mkdirSync(this.getTransferRecordDir(user, extensionId), { recursive: true });
        const filePath = path.join(dirPath, `${transferId}.part`);
        fs.writeFileSync(filePath, Buffer.alloc(0));

        const record: DataTransferRecord = {
            transferId,
            userHandle: user.handle,
            extensionId,
            resource,
            ...(purpose ? { purpose } : {}),
            filePath,
            sizeBytes: 0,
            maxBytes: resolveTransferMaxBytes(maxBytesOverride),
            createdAt: timestamp,
            updatedAt: timestamp,
            direction: 'upload',
            ownedFile: true,
            checksumSha256: EMPTY_FILE_SHA256,
        };
        this.storeRecord(user, extensionId, record);
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
        record.checksumSha256 = computeFileSha256(record.filePath);
        this.storeRecord(user, extensionId, record);
        return {
            transferId: record.transferId,
            sizeBytes: record.sizeBytes,
            updatedAt: record.updatedAt,
            checksumSha256: record.checksumSha256,
        };
    }

    async openRead(user: UserContext, extensionId: string, request: DataTransferOpenReadRequest, maxBytesOverride?: number): Promise<DataTransferInitResponse> {
        const resource = normalizeTransferResource(request.resource);
        const purpose = normalizeTransferPurpose(resource, request.purpose);
        const maxBytes = resolveTransferMaxBytes(maxBytesOverride);
        const { filePath, sizeBytes } = validateReadableTransferFile(request.sourcePath);
        if (sizeBytes > maxBytes) {
            throw new Error(`Transfer exceeds ${maxBytes} bytes`);
        }

        const transferId = crypto.randomUUID();
        const timestamp = new Date().toISOString();
        fs.mkdirSync(this.getTransferRecordDir(user, extensionId), { recursive: true });
        const record: DataTransferRecord = {
            transferId,
            userHandle: user.handle,
            extensionId,
            resource,
            ...(purpose ? { purpose } : {}),
            filePath,
            sizeBytes,
            maxBytes: sizeBytes,
            createdAt: timestamp,
            updatedAt: timestamp,
            direction: 'download',
            ownedFile: false,
            checksumSha256: computeFileSha256(filePath),
        };
        this.storeRecord(user, extensionId, record);
        return toInitResponse(record);
    }

    async promoteToDownload(user: UserContext, extensionId: string, transferId: string): Promise<DataTransferInitResponse> {
        const record = this.get(user, extensionId, transferId);
        if (record.direction !== 'upload') {
            throw new Error('Transfer is already readable');
        }

        const { filePath, sizeBytes } = validateReadableTransferFile(record.filePath);
        if (sizeBytes > record.maxBytes) {
            throw new Error(`Transfer exceeds ${record.maxBytes} bytes`);
        }

        record.filePath = filePath;
        record.sizeBytes = sizeBytes;
        record.maxBytes = sizeBytes;
        record.direction = 'download';
        record.updatedAt = new Date().toISOString();
        record.checksumSha256 = computeFileSha256(filePath);
        this.storeRecord(user, extensionId, record);
        return toInitResponse(record);
    }

    status(user: UserContext, extensionId: string, transferId: string, resource?: DataTransferResource): DataTransferInitResponse {
        return toInitResponse(this.get(user, extensionId, transferId, resource));
    }

    manifest(user: UserContext, extensionId: string, transferId: string, resource?: DataTransferResource): DataTransferManifestResponse {
        return toManifestResponse(this.get(user, extensionId, transferId, resource));
    }

    assertChecksum(user: UserContext, extensionId: string, transferId: string, expectedChecksumSha256: string): string {
        const record = this.get(user, extensionId, transferId);
        const expected = normalizeChecksumSha256(expectedChecksumSha256);
        if (!expected) {
            throw new Error('Transfer checksum must be a 64-character sha256 hex string');
        }
        if (record.checksumSha256.toLowerCase() !== expected) {
            throw new Error(`Transfer checksum mismatch: expected ${expected}, received ${record.checksumSha256}`);
        }
        return record.checksumSha256;
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
                checksumSha256: record.checksumSha256,
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
                checksumSha256: record.checksumSha256,
            };
        } finally {
            fs.closeSync(handle);
        }
    }

    get(user: UserContext, extensionId: string, transferId: string, resource?: DataTransferResource): DataTransferRecord {
        const record = this.transfers.get(transferId) ?? this.loadRecord(user, extensionId, transferId);
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
        fs.rmSync(this.getTransferRecordPath(user, extensionId, transferId), { force: true });
        if (!record.ownedFile) {
            pruneEmptyTransferDirs(this.getTransferRecordDir(user, extensionId));
            return;
        }
        try {
            fs.rmSync(record.filePath, { force: true });
        } finally {
            pruneEmptyTransferDirs(path.dirname(record.filePath));
            pruneEmptyTransferDirs(this.getTransferRecordDir(user, extensionId));
        }
    }

    private loadRecord(user: UserContext, extensionId: string, transferId: string): DataTransferRecord | null {
        const recordPath = this.getTransferRecordPath(user, extensionId, transferId);
        let parsed: DataTransferRecord;
        try {
            parsed = JSON.parse(fs.readFileSync(recordPath, 'utf8')) as DataTransferRecord;
        } catch {
            return null;
        }
        try {
            const readable = validateReadableTransferFile(parsed.filePath);
            parsed.sizeBytes = readable.sizeBytes;
            if (!parsed.checksumSha256) {
                parsed.checksumSha256 = computeFileSha256(parsed.filePath);
            }
        } catch {
            return null;
        }
        this.transfers.set(transferId, parsed);
        return parsed;
    }

    private storeRecord(user: UserContext, extensionId: string, record: DataTransferRecord): void {
        fs.mkdirSync(this.getTransferRecordDir(user, extensionId), { recursive: true });
        fs.writeFileSync(this.getTransferRecordPath(user, extensionId, record.transferId), JSON.stringify(record, null, 2));
        this.transfers.set(record.transferId, record);
    }

    private getTransferBaseDir(user: UserContext, extensionId: string): string {
        const paths = getUserAuthorityPaths(user);
        const stateDir = path.dirname(paths.controlDbFile);
        return resolveContainedPath(
            stateDir,
            'transfers',
            sanitizeFileSegment(extensionId),
        );
    }

    private getTransferDataDir(user: UserContext, extensionId: string, resource: DataTransferResource): string {
        return resolveContainedPath(this.getTransferBaseDir(user, extensionId), sanitizeFileSegment(resource));
    }

    private getTransferRecordDir(user: UserContext, extensionId: string): string {
        return resolveContainedPath(this.getTransferBaseDir(user, extensionId), 'records');
    }

    private getTransferRecordPath(user: UserContext, extensionId: string, transferId: string): string {
        return resolveContainedPath(this.getTransferRecordDir(user, extensionId), `${transferId}.json`);
    }
}

function toInitResponse(record: DataTransferRecord): DataTransferInitResponse {
    return {
        transferId: record.transferId,
        resource: record.resource,
        ...(record.purpose ? { purpose: record.purpose } : {}),
        chunkSize: DATA_TRANSFER_CHUNK_BYTES,
        maxBytes: record.maxBytes,
        createdAt: record.createdAt,
        updatedAt: record.updatedAt,
        sizeBytes: record.sizeBytes,
        direction: record.direction,
        checksumSha256: record.checksumSha256,
        resumable: true,
    };
}

function toManifestResponse(record: DataTransferRecord): DataTransferManifestResponse {
    const chunkSize = DATA_TRANSFER_CHUNK_BYTES;
    const chunkCount = Math.ceil(record.sizeBytes / chunkSize);
    return {
        ...toInitResponse(record),
        chunkCount,
        chunks: Array.from({ length: chunkCount }, (_, index) => {
            const offset = index * chunkSize;
            const sizeBytes = Math.min(chunkSize, record.sizeBytes - offset);
            return {
                index,
                offset,
                sizeBytes,
                checksumSha256: computeFileSliceSha256(record.filePath, offset, sizeBytes),
            };
        }),
    };
}

function normalizeTransferResource(resource: DataTransferInitRequest['resource']): DataTransferResource {
    if (resource === 'storage.blob' || resource === 'fs.private' || resource === 'http.fetch') {
        return resource;
    }
    throw new Error(`Unsupported transfer resource: ${String(resource)}`);
}

function normalizeTransferPurpose(
    resource: DataTransferResource,
    purpose: AuthorityInlineThresholdKey | undefined,
): AuthorityInlineThresholdKey | undefined {
    if (!purpose) {
        return undefined;
    }

    if (resource === 'storage.blob' && (purpose === 'storageBlobWrite' || purpose === 'storageBlobRead')) {
        return purpose;
    }
    if (resource === 'fs.private' && (purpose === 'privateFileWrite' || purpose === 'privateFileRead')) {
        return purpose;
    }
    if (resource === 'http.fetch' && (purpose === 'httpFetchRequest' || purpose === 'httpFetchResponse')) {
        return purpose;
    }

    throw new Error(`Unsupported transfer purpose ${purpose} for resource ${resource}`);
}

function resolveTransferMaxBytes(
    maxBytesOverride?: number,
): number {
    if (typeof maxBytesOverride !== 'number' || !Number.isFinite(maxBytesOverride)) {
        return UNMANAGED_TRANSFER_MAX_BYTES;
    }
    if (maxBytesOverride <= 0) {
        throw new Error('Transfer maxBytes must be a positive integer');
    }
    return Math.floor(maxBytesOverride);
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

function computeFileSha256(filePath: string): string {
    return crypto.createHash('sha256').update(fs.readFileSync(filePath)).digest('hex');
}

function computeFileSliceSha256(filePath: string, offset: number, sizeBytes: number): string {
    if (sizeBytes <= 0) {
        return EMPTY_FILE_SHA256;
    }

    const handle = fs.openSync(filePath, 'r');
    try {
        const buffer = Buffer.alloc(sizeBytes);
        const bytesRead = fs.readSync(handle, buffer, 0, sizeBytes, offset);
        return crypto.createHash('sha256').update(buffer.subarray(0, bytesRead)).digest('hex');
    } finally {
        fs.closeSync(handle);
    }
}

function normalizeChecksumSha256(value: string): string | null {
    const candidate = value.trim().toLowerCase();
    return /^[a-f0-9]{64}$/.test(candidate) ? candidate : null;
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

import crypto from 'node:crypto';
import path from 'node:path';
import zlib from 'node:zlib';
import type {
    AuthorityExportPackageRequest,
    AuthorityPackageArtifactSummary,
    AuthorityPortablePackageArchiveFileEntry,
} from '@stdo/shared-types';
import { sanitizeFileSegment } from '../utils.js';

export interface ArchiveBuildFile {
    path: string;
    mediaType: string;
    bytes: Buffer;
}

export function normalizeExportRequest(request: AuthorityExportPackageRequest | undefined): AuthorityExportPackageRequest {
    return {
        ...(request?.extensionIds?.length ? { extensionIds: [...new Set(request.extensionIds.map(value => value.trim()).filter(Boolean))] } : {}),
        includePolicies: request?.includePolicies !== false,
        includeUsageSummary: request?.includeUsageSummary !== false,
    };
}

export function sanitizeArtifactFileName(value: string): string {
    const trimmed = value.trim();
    return trimmed ? sanitizeFileSegment(trimmed) : `artifact-${crypto.randomUUID()}.json.gz`;
}

export function sanitizeTimestamp(value: string): string {
    return value.replace(/[:.]/g, '-');
}

export function buildArtifactSummary(fileName: string, bytes: Buffer, mediaType: string): AuthorityPackageArtifactSummary {
    return {
        fileName,
        mediaType,
        sizeBytes: bytes.byteLength,
        checksumSha256: hashBytes(bytes),
    };
}

export function buildArchiveFileEntry(file: ArchiveBuildFile): AuthorityPortablePackageArchiveFileEntry {
    return {
        path: file.path,
        mediaType: file.mediaType,
        sizeBytes: file.bytes.byteLength,
        checksumSha256: hashBytes(file.bytes),
    };
}

export function buildIndexedArchivePath(directory: string, index: number, sourceName: string): string {
    const normalizedSource = sourceName.replace(/\\/g, '/');
    const baseName = path.posix.basename(normalizedSource) || 'entry.bin';
    const safeBaseName = sanitizeFileSegment(baseName) || 'entry.bin';
    return `${directory}/${String(index).padStart(4, '0')}-${safeBaseName}`;
}

export function hashBytes(value: Uint8Array): string {
    return crypto.createHash('sha256').update(value).digest('hex');
}

export function hashText(value: string): string {
    return crypto.createHash('sha256').update(value, 'utf8').digest('hex');
}

export function tryGunzip(value: Buffer): Buffer {
    try {
        return zlib.gunzipSync(value);
    } catch {
        return value;
    }
}

export function decodeBase64Checked(contentBase64: string, checksumSha256: string, label: string): Buffer {
    const bytes = Buffer.from(contentBase64, 'base64');
    const actual = hashBytes(bytes);
    if (actual !== checksumSha256) {
        throw new Error(`${label} checksum mismatch: expected ${checksumSha256}, received ${actual}`);
    }
    return bytes;
}

export function newestTimestamp(left: string | null, right: string | null): string | null {
    if (!left) {
        return right;
    }
    if (!right) {
        return left;
    }
    return left.localeCompare(right) >= 0 ? left : right;
}

import path from 'node:path';
import zlib from 'node:zlib';

export interface ZipArchiveFileInput {
    path: string;
    bytes: Uint8Array;
    modifiedAt?: Date;
    compression?: 'auto' | 'store' | 'deflate';
}

const ZIP_LOCAL_FILE_HEADER_SIGNATURE = 0x04034b50;
const ZIP_CENTRAL_DIRECTORY_SIGNATURE = 0x02014b50;
const ZIP_END_OF_CENTRAL_DIRECTORY_SIGNATURE = 0x06054b50;
const ZIP_UTF8_FLAG = 0x0800;
const ZIP_STORE_METHOD = 0;
const ZIP_DEFLATE_METHOD = 8;
const ZIP_VERSION = 20;
const ZIP_MAX_EOCD_SEARCH = 0xffff + 22;
const CRC32_TABLE = buildCrc32Table();

export function isZipArchive(bytes: Uint8Array): boolean {
    const buffer = Buffer.from(bytes);
    return buffer.byteLength >= 4 && buffer.readUInt32LE(0) === ZIP_LOCAL_FILE_HEADER_SIGNATURE;
}

export function createZipArchive(files: ZipArchiveFileInput[]): Buffer {
    const normalizedFiles = files.map(file => normalizeInputFile(file));
    const seen = new Set<string>();
    const localParts: Buffer[] = [];
    const centralParts: Buffer[] = [];
    let offset = 0;

    for (const file of normalizedFiles) {
        if (seen.has(file.path)) {
            throw new Error(`Duplicate zip entry path: ${file.path}`);
        }
        seen.add(file.path);

        const encodedPath = Buffer.from(file.path, 'utf8');
        const rawBytes = Buffer.from(file.bytes);
        const compressed = selectCompressedBytes(rawBytes, file.compression);
        const crc = crc32(rawBytes);
        const { date, time } = toDosDateTime(file.modifiedAt ?? new Date());

        const localHeader = Buffer.alloc(30);
        localHeader.writeUInt32LE(ZIP_LOCAL_FILE_HEADER_SIGNATURE, 0);
        localHeader.writeUInt16LE(ZIP_VERSION, 4);
        localHeader.writeUInt16LE(ZIP_UTF8_FLAG, 6);
        localHeader.writeUInt16LE(compressed.method, 8);
        localHeader.writeUInt16LE(time, 10);
        localHeader.writeUInt16LE(date, 12);
        localHeader.writeUInt32LE(crc >>> 0, 14);
        localHeader.writeUInt32LE(compressed.bytes.byteLength, 18);
        localHeader.writeUInt32LE(rawBytes.byteLength, 22);
        localHeader.writeUInt16LE(encodedPath.byteLength, 26);
        localHeader.writeUInt16LE(0, 28);

        localParts.push(localHeader, encodedPath, compressed.bytes);

        const centralHeader = Buffer.alloc(46);
        centralHeader.writeUInt32LE(ZIP_CENTRAL_DIRECTORY_SIGNATURE, 0);
        centralHeader.writeUInt16LE(ZIP_VERSION, 4);
        centralHeader.writeUInt16LE(ZIP_VERSION, 6);
        centralHeader.writeUInt16LE(ZIP_UTF8_FLAG, 8);
        centralHeader.writeUInt16LE(compressed.method, 10);
        centralHeader.writeUInt16LE(time, 12);
        centralHeader.writeUInt16LE(date, 14);
        centralHeader.writeUInt32LE(crc >>> 0, 16);
        centralHeader.writeUInt32LE(compressed.bytes.byteLength, 20);
        centralHeader.writeUInt32LE(rawBytes.byteLength, 24);
        centralHeader.writeUInt16LE(encodedPath.byteLength, 28);
        centralHeader.writeUInt16LE(0, 30);
        centralHeader.writeUInt16LE(0, 32);
        centralHeader.writeUInt16LE(0, 34);
        centralHeader.writeUInt16LE(0, 36);
        centralHeader.writeUInt32LE(0, 38);
        centralHeader.writeUInt32LE(offset, 42);
        centralParts.push(centralHeader, encodedPath);

        offset += localHeader.byteLength + encodedPath.byteLength + compressed.bytes.byteLength;
    }

    const centralDirectory = Buffer.concat(centralParts);
    const end = Buffer.alloc(22);
    end.writeUInt32LE(ZIP_END_OF_CENTRAL_DIRECTORY_SIGNATURE, 0);
    end.writeUInt16LE(0, 4);
    end.writeUInt16LE(0, 6);
    end.writeUInt16LE(normalizedFiles.length, 8);
    end.writeUInt16LE(normalizedFiles.length, 10);
    end.writeUInt32LE(centralDirectory.byteLength, 12);
    end.writeUInt32LE(offset, 16);
    end.writeUInt16LE(0, 20);

    return Buffer.concat([...localParts, centralDirectory, end]);
}

export function readZipArchive(bytes: Uint8Array): Map<string, Buffer> {
    const buffer = Buffer.from(bytes);
    const endRecordOffset = findEndOfCentralDirectoryOffset(buffer);
    const entryCount = buffer.readUInt16LE(endRecordOffset + 10);
    const centralDirectoryOffset = buffer.readUInt32LE(endRecordOffset + 16);
    const files = new Map<string, Buffer>();
    let offset = centralDirectoryOffset;

    for (let index = 0; index < entryCount; index += 1) {
        if (offset + 46 > buffer.byteLength || buffer.readUInt32LE(offset) !== ZIP_CENTRAL_DIRECTORY_SIGNATURE) {
            throw new Error('Invalid zip central directory');
        }
        const flags = buffer.readUInt16LE(offset + 8);
        if ((flags & 0x0001) !== 0) {
            throw new Error('Encrypted zip entries are not supported');
        }
        const method = buffer.readUInt16LE(offset + 10);
        const crc = buffer.readUInt32LE(offset + 16);
        const compressedSize = buffer.readUInt32LE(offset + 20);
        const uncompressedSize = buffer.readUInt32LE(offset + 24);
        const fileNameLength = buffer.readUInt16LE(offset + 28);
        const extraLength = buffer.readUInt16LE(offset + 30);
        const commentLength = buffer.readUInt16LE(offset + 32);
        const localHeaderOffset = buffer.readUInt32LE(offset + 42);
        const fileNameStart = offset + 46;
        const fileNameEnd = fileNameStart + fileNameLength;
        const fileName = buffer.subarray(fileNameStart, fileNameEnd).toString('utf8');
        const normalizedPath = normalizeArchivePath(fileName);
        offset = fileNameEnd + extraLength + commentLength;

        if (!normalizedPath) {
            continue;
        }
        if (files.has(normalizedPath)) {
            throw new Error(`Duplicate zip entry path: ${normalizedPath}`);
        }
        if (localHeaderOffset + 30 > buffer.byteLength || buffer.readUInt32LE(localHeaderOffset) !== ZIP_LOCAL_FILE_HEADER_SIGNATURE) {
            throw new Error(`Invalid zip local header for entry: ${normalizedPath}`);
        }
        const localFileNameLength = buffer.readUInt16LE(localHeaderOffset + 26);
        const localExtraLength = buffer.readUInt16LE(localHeaderOffset + 28);
        const compressedStart = localHeaderOffset + 30 + localFileNameLength + localExtraLength;
        const compressedEnd = compressedStart + compressedSize;
        if (compressedEnd > buffer.byteLength) {
            throw new Error(`Zip entry exceeds archive size: ${normalizedPath}`);
        }
        const compressed = buffer.subarray(compressedStart, compressedEnd);
        const rawBytes = decompressZipEntry(compressed, method, normalizedPath);
        if (rawBytes.byteLength !== uncompressedSize) {
            throw new Error(`Zip entry size mismatch: ${normalizedPath}`);
        }
        if ((crc32(rawBytes) >>> 0) !== (crc >>> 0)) {
            throw new Error(`Zip entry checksum mismatch: ${normalizedPath}`);
        }
        files.set(normalizedPath, rawBytes);
    }

    return files;
}

function normalizeInputFile(file: ZipArchiveFileInput): Required<ZipArchiveFileInput> {
    return {
        path: requireArchivePath(file.path),
        bytes: Buffer.from(file.bytes),
        modifiedAt: file.modifiedAt ?? new Date(),
        compression: file.compression ?? 'auto',
    };
}

function requireArchivePath(value: string): string {
    const normalized = normalizeArchivePath(value);
    if (!normalized) {
        throw new Error(`Invalid zip entry path: ${value}`);
    }
    return normalized;
}

function normalizeArchivePath(value: string): string | null {
    const replaced = value.replace(/\\/g, '/').trim();
    if (!replaced) {
        return null;
    }
    const trimmedLeading = replaced.replace(/^\/+/, '');
    if (!trimmedLeading) {
        return null;
    }
    if (trimmedLeading.endsWith('/')) {
        const directoryPath = trimmedLeading.replace(/\/+$/, '');
        return directoryPath ? null : null;
    }
    const normalized = path.posix.normalize(trimmedLeading);
    if (!normalized || normalized === '.' || normalized === '..' || normalized.startsWith('../') || normalized.includes('/../')) {
        throw new Error(`Invalid zip entry path: ${value}`);
    }
    return normalized;
}

function selectCompressedBytes(bytes: Buffer, compression: ZipArchiveFileInput['compression']): { method: number; bytes: Buffer } {
    if (compression === 'store') {
        return {
            method: ZIP_STORE_METHOD,
            bytes,
        };
    }
    const deflated = zlib.deflateRawSync(bytes);
    if (compression === 'deflate' || deflated.byteLength < bytes.byteLength) {
        return {
            method: ZIP_DEFLATE_METHOD,
            bytes: deflated,
        };
    }
    return {
        method: ZIP_STORE_METHOD,
        bytes,
    };
}

function decompressZipEntry(bytes: Buffer, method: number, pathName: string): Buffer {
    if (method === ZIP_STORE_METHOD) {
        return Buffer.from(bytes);
    }
    if (method === ZIP_DEFLATE_METHOD) {
        return zlib.inflateRawSync(bytes);
    }
    throw new Error(`Unsupported zip compression method ${method} for entry: ${pathName}`);
}

function findEndOfCentralDirectoryOffset(buffer: Buffer): number {
    const start = Math.max(0, buffer.byteLength - ZIP_MAX_EOCD_SEARCH);
    for (let offset = buffer.byteLength - 22; offset >= start; offset -= 1) {
        if (buffer.readUInt32LE(offset) === ZIP_END_OF_CENTRAL_DIRECTORY_SIGNATURE) {
            return offset;
        }
    }
    throw new Error('Zip end of central directory not found');
}

function toDosDateTime(value: Date): { date: number; time: number } {
    const year = Math.min(2107, Math.max(1980, value.getFullYear()));
    return {
        date: ((year - 1980) << 9) | ((value.getMonth() + 1) << 5) | value.getDate(),
        time: (value.getHours() << 11) | (value.getMinutes() << 5) | Math.floor(value.getSeconds() / 2),
    };
}

function crc32(bytes: Uint8Array): number {
    let crc = 0xffffffff;
    for (const byte of bytes) {
        crc = (crc >>> 8) ^ CRC32_TABLE[(crc ^ byte) & 0xff]!;
    }
    return (crc ^ 0xffffffff) >>> 0;
}

function buildCrc32Table(): Uint32Array {
    const table = new Uint32Array(256);
    for (let index = 0; index < 256; index += 1) {
        let value = index;
        for (let bit = 0; bit < 8; bit += 1) {
            value = (value & 1) !== 0 ? (0xedb88320 ^ (value >>> 1)) : (value >>> 1);
        }
        table[index] = value >>> 0;
    }
    return table;
}

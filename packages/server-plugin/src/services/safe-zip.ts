import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { Transform, type Readable, type TransformCallback } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import zlib from 'node:zlib';
import {
    NATIVE_MIGRATION_MAX_COMPRESSED_BYTES,
    NATIVE_MIGRATION_MAX_ENTRY_COUNT,
    NATIVE_MIGRATION_MAX_PATH_BYTES,
    NATIVE_MIGRATION_MAX_PATH_DEPTH,
    NATIVE_MIGRATION_MAX_UNCOMPRESSED_BYTES,
} from '../constants.js';
import { ensureDir, resolveContainedPath } from '../utils.js';

export interface SafeZipEntry {
    path: string;
    compressedSizeBytes: number;
    uncompressedSizeBytes: number;
    checksumCrc32?: number;
}

export interface SafeZipScanResult {
    archivePath: string;
    sizeBytes: number;
    entries: SafeZipEntry[];
}

export interface SafeZipExtractedEntry extends SafeZipEntry {
    extractedPath: string;
    checksumSha256: string;
}

interface SafeZipReadOptions {
    maxCompressedBytes?: number;
    maxUncompressedBytes?: number;
    maxEntryCount?: number;
    maxPathBytes?: number;
    maxPathDepth?: number;
}

export interface SafeZipExtractPlan {
    entry: SafeZipEntry;
    destinationPath: string;
}

export interface SafeZipExtractPlanOptions extends SafeZipReadOptions {
    onExtractedEntry?: (entry: SafeZipExtractedEntry) => void | Promise<void>;
}

interface ParsedZipEntry extends SafeZipEntry {
    compressionMethod: number;
    localHeaderOffset: number;
    dataStart: number;
    externalFileAttributes: number;
}

const ZIP_LOCAL_FILE_HEADER_SIGNATURE = 0x04034b50;
const ZIP_CENTRAL_DIRECTORY_SIGNATURE = 0x02014b50;
const ZIP_END_OF_CENTRAL_DIRECTORY_SIGNATURE = 0x06054b50;
const ZIP64_END_OF_CENTRAL_DIRECTORY_LOCATOR_SIGNATURE = 0x07064b50;
const ZIP64_END_OF_CENTRAL_DIRECTORY_SIGNATURE = 0x06064b50;
const ZIP_DATA_DESCRIPTOR_FLAG = 0x0008;
const ZIP_ENCRYPTED_FLAG = 0x0001;
const ZIP_STORE_METHOD = 0;
const ZIP_DEFLATE_METHOD = 8;
const ZIP_MAX_EOCD_SEARCH = 0xffff + 22;
const ZIP_DIRECTORY_ATTRIBUTE = 0x10;
const ZIP_UNIX_FILE_TYPE_MASK = 0o170000;
const ZIP_UNIX_REGULAR_FILE = 0o100000;
const ZIP_UNIX_SYMLINK = 0o120000;
const ZIP64_EXTRA_FIELD_ID = 0x0001;
const CRC32_TABLE = buildCrc32Table();
const WINDOWS_RESERVED_SEGMENTS = /^(con|prn|aux|nul|com[1-9]|lpt[1-9]|conin\$|conout\$)(\..*)?$/i;

export async function scanSafeZip(filePath: string, options: SafeZipReadOptions = {}): Promise<SafeZipScanResult> {
    const archivePath = requireRegularArchive(filePath, options.maxCompressedBytes ?? NATIVE_MIGRATION_MAX_COMPRESSED_BYTES);
    const entries = parseZipEntries(archivePath, options).map(toSafeEntry);
    return {
        archivePath,
        sizeBytes: fs.statSync(archivePath).size,
        entries,
    };
}

export async function extractSafeZipEntries(
    filePath: string,
    targetRoot: string,
    shouldExtract: (entry: SafeZipEntry) => boolean = () => true,
    options: SafeZipReadOptions = {},
): Promise<SafeZipExtractedEntry[]> {
    ensureDir(targetRoot);
    const parsedEntries = parseZipEntries(filePath, options);
    const extracted: SafeZipExtractedEntry[] = [];
    for (const parsedEntry of parsedEntries) {
        if (!shouldExtract(toSafeEntry(parsedEntry))) {
            continue;
        }
        const extractedPath = resolveContainedPath(targetRoot, parsedEntry.path);
        extracted.push(await extractParsedEntry(filePath, parsedEntry, extractedPath));
    }
    return extracted;
}

export async function extractSafeZipPlan(
    filePath: string,
    plans: SafeZipExtractPlan[],
    options: SafeZipExtractPlanOptions = {},
): Promise<SafeZipExtractedEntry[]> {
    const parsedEntries = parseZipEntries(filePath, options);
    const parsedByPath = new Map(parsedEntries.map(entry => [entry.path, entry]));
    const destinationByPath = new Map<string, string>();
    for (const plan of plans) {
        if (!parsedByPath.has(plan.entry.path)) {
            throw new Error(`Zip extraction plan references missing entry: ${plan.entry.path}`);
        }
        destinationByPath.set(plan.entry.path, plan.destinationPath);
    }

    const extracted: SafeZipExtractedEntry[] = [];
    for (const [entryPath, destinationPath] of destinationByPath) {
        const parsedEntry = parsedByPath.get(entryPath);
        if (!parsedEntry) {
            throw new Error(`Zip extraction entry was not found after scan: ${entryPath}`);
        }
        const extractedEntry = await extractParsedEntry(filePath, parsedEntry, destinationPath);
        if (options.onExtractedEntry) {
            await options.onExtractedEntry(extractedEntry);
        }
        extracted.push(extractedEntry);
    }
    return extracted;
}

export function normalizeSafeZipEntryName(value: string, options: SafeZipReadOptions = {}): string {
    if (value.includes('\u0000')) {
        throw new Error('Invalid zip entry path: contains NUL byte');
    }
    if (value.includes('\\')) {
        throw new Error(`Invalid zip entry path: ${value}`);
    }
    if (/^[a-zA-Z]:/.test(value) || value.startsWith('/')) {
        throw new Error(`Invalid zip entry path: ${value}`);
    }
    const trimmed = value.trim();
    if (!trimmed || trimmed !== value || trimmed.endsWith('/')) {
        throw new Error(`Invalid zip entry path: ${value}`);
    }
    const normalized = path.posix.normalize(trimmed);
    if (!normalized || normalized === '.' || normalized === '..' || normalized.startsWith('../') || normalized.includes('/../')) {
        throw new Error(`Invalid zip entry path: ${value}`);
    }
    const pathBytes = Buffer.byteLength(normalized, 'utf8');
    if (pathBytes > (options.maxPathBytes ?? NATIVE_MIGRATION_MAX_PATH_BYTES)) {
        throw new Error(`Zip entry path exceeds ${options.maxPathBytes ?? NATIVE_MIGRATION_MAX_PATH_BYTES} bytes: ${value}`);
    }
    const depth = normalized.split('/').length;
    if (depth > (options.maxPathDepth ?? NATIVE_MIGRATION_MAX_PATH_DEPTH)) {
        throw new Error(`Zip entry path exceeds ${options.maxPathDepth ?? NATIVE_MIGRATION_MAX_PATH_DEPTH} segments: ${value}`);
    }
    for (const segment of normalized.split('/')) {
        if (!segment || segment.endsWith('.') || segment.endsWith(' ') || segment.includes(':') || WINDOWS_RESERVED_SEGMENTS.test(segment)) {
            throw new Error(`Invalid zip entry path: ${value}`);
        }
    }
    return normalized.normalize('NFC');
}

function parseZipEntries(filePath: string, options: SafeZipReadOptions): ParsedZipEntry[] {
    const archivePath = requireRegularArchive(filePath, options.maxCompressedBytes ?? NATIVE_MIGRATION_MAX_COMPRESSED_BYTES);
    const fd = fs.openSync(archivePath, 'r');
    try {
        const sizeBytes = fs.fstatSync(fd).size;
        const centralDirectory = readCentralDirectory(fd, sizeBytes);
        const entries: ParsedZipEntry[] = [];
        const seen = new Set<string>();
        let offset = centralDirectory.offset;
        let totalUncompressedBytes = 0;
        for (let index = 0; index < centralDirectory.entryCount; index += 1) {
            const fixed = readBuffer(fd, offset, 46);
            if (fixed.readUInt32LE(0) !== ZIP_CENTRAL_DIRECTORY_SIGNATURE) {
                throw new Error('Invalid zip central directory');
            }
            const flags = fixed.readUInt16LE(8);
            const compressionMethod = fixed.readUInt16LE(10);
            const crc32 = fixed.readUInt32LE(16);
            let compressedSize = fixed.readUInt32LE(20);
            let uncompressedSize = fixed.readUInt32LE(24);
            const fileNameLength = fixed.readUInt16LE(28);
            const extraLength = fixed.readUInt16LE(30);
            const commentLength = fixed.readUInt16LE(32);
            const externalFileAttributes = fixed.readUInt32LE(38);
            let localHeaderOffset = fixed.readUInt32LE(42);
            const fileName = readBuffer(fd, offset + 46, fileNameLength).toString('utf8');
            const extra = readBuffer(fd, offset + 46 + fileNameLength, extraLength);
            offset += 46 + fileNameLength + extraLength + commentLength;

            if (isDirectoryEntry(fileName, externalFileAttributes)) {
                continue;
            }
            const normalizedPath = normalizeSafeZipEntryName(fileName, options);
            if ((flags & ZIP_ENCRYPTED_FLAG) !== 0) {
                throw new Error(`Encrypted zip entries are not supported: ${normalizedPath}`);
            }
            if ((flags & ZIP_DATA_DESCRIPTOR_FLAG) !== 0) {
                throw new Error(`Zip entries with data descriptors are not supported: ${normalizedPath}`);
            }
            if (compressionMethod !== ZIP_STORE_METHOD && compressionMethod !== ZIP_DEFLATE_METHOD) {
                throw new Error(`Zip entry compression method is not supported: ${normalizedPath}`);
            }
            assertRegularFileEntry(externalFileAttributes, normalizedPath);
            const zip64 = readZip64Extra(extra, { compressedSize, uncompressedSize, localHeaderOffset });
            compressedSize = zip64.compressedSize;
            uncompressedSize = zip64.uncompressedSize;
            localHeaderOffset = zip64.localHeaderOffset;
            const duplicateKey = normalizedPath.normalize('NFC').toLowerCase();
            if (seen.has(duplicateKey)) {
                throw new Error(`Duplicate zip entry path: ${normalizedPath}`);
            }
            seen.add(duplicateKey);
            if (entries.length + 1 > (options.maxEntryCount ?? NATIVE_MIGRATION_MAX_ENTRY_COUNT)) {
                throw new Error(`Zip archive exceeds ${options.maxEntryCount ?? NATIVE_MIGRATION_MAX_ENTRY_COUNT} entries`);
            }
            totalUncompressedBytes += uncompressedSize;
            if (totalUncompressedBytes > (options.maxUncompressedBytes ?? NATIVE_MIGRATION_MAX_UNCOMPRESSED_BYTES)) {
                throw new Error(`Zip archive exceeds ${options.maxUncompressedBytes ?? NATIVE_MIGRATION_MAX_UNCOMPRESSED_BYTES} uncompressed bytes`);
            }
            const dataStart = readLocalDataStart(fd, localHeaderOffset, normalizedPath);
            if (dataStart + compressedSize > sizeBytes) {
                throw new Error(`Zip entry exceeds archive size: ${normalizedPath}`);
            }
            entries.push({
                path: normalizedPath,
                compressedSizeBytes: compressedSize,
                uncompressedSizeBytes: uncompressedSize,
                checksumCrc32: crc32,
                compressionMethod,
                localHeaderOffset,
                dataStart,
                externalFileAttributes,
            });
        }
        return entries;
    } finally {
        fs.closeSync(fd);
    }
}

function requireRegularArchive(filePath: string, maxBytes: number): string {
    const archivePath = path.resolve(filePath);
    const metadata = fs.lstatSync(archivePath);
    if (metadata.isSymbolicLink()) {
        throw new Error('Zip archive symlink is not allowed');
    }
    if (!metadata.isFile()) {
        throw new Error('Zip archive must be a file');
    }
    if (metadata.size > maxBytes) {
        throw new Error(`Zip archive exceeds ${maxBytes} bytes`);
    }
    return archivePath;
}

function readCentralDirectory(fd: number, sizeBytes: number): { offset: number; entryCount: number } {
    const searchLength = Math.min(sizeBytes, ZIP_MAX_EOCD_SEARCH);
    const tail = readBuffer(fd, sizeBytes - searchLength, searchLength);
    for (let index = tail.byteLength - 22; index >= 0; index -= 1) {
        if (tail.readUInt32LE(index) !== ZIP_END_OF_CENTRAL_DIRECTORY_SIGNATURE) {
            continue;
        }
        let entryCount = tail.readUInt16LE(index + 10);
        let offset = tail.readUInt32LE(index + 16);
        if (entryCount === 0xffff || offset === 0xffffffff) {
            const locatorOffset = sizeBytes - searchLength + index - 20;
            if (locatorOffset < 0) {
                throw new Error('Zip64 end of central directory locator not found');
            }
            const locator = readBuffer(fd, locatorOffset, 20);
            if (locator.readUInt32LE(0) !== ZIP64_END_OF_CENTRAL_DIRECTORY_LOCATOR_SIGNATURE) {
                throw new Error('Zip64 end of central directory locator not found');
            }
            const zip64EndOffset = Number(locator.readBigUInt64LE(8));
            const zip64End = readBuffer(fd, zip64EndOffset, 56);
            if (zip64End.readUInt32LE(0) !== ZIP64_END_OF_CENTRAL_DIRECTORY_SIGNATURE) {
                throw new Error('Zip64 end of central directory not found');
            }
            entryCount = Number(zip64End.readBigUInt64LE(32));
            offset = Number(zip64End.readBigUInt64LE(48));
        }
        if (!Number.isSafeInteger(entryCount) || !Number.isSafeInteger(offset)) {
            throw new Error('Zip central directory values exceed safe integer range');
        }
        return { offset, entryCount };
    }
    throw new Error('Zip end of central directory not found');
}

function readLocalDataStart(fd: number, localHeaderOffset: number, entryPath: string): number {
    const localHeader = readBuffer(fd, localHeaderOffset, 30);
    if (localHeader.readUInt32LE(0) !== ZIP_LOCAL_FILE_HEADER_SIGNATURE) {
        throw new Error(`Invalid zip local header for entry: ${entryPath}`);
    }
    const fileNameLength = localHeader.readUInt16LE(26);
    const extraLength = localHeader.readUInt16LE(28);
    return localHeaderOffset + 30 + fileNameLength + extraLength;
}

function readZip64Extra(extra: Buffer, values: { compressedSize: number; uncompressedSize: number; localHeaderOffset: number }): { compressedSize: number; uncompressedSize: number; localHeaderOffset: number } {
    let compressedSize = values.compressedSize;
    let uncompressedSize = values.uncompressedSize;
    let localHeaderOffset = values.localHeaderOffset;
    let offset = 0;
    while (offset + 4 <= extra.byteLength) {
        const id = extra.readUInt16LE(offset);
        const size = extra.readUInt16LE(offset + 2);
        const dataStart = offset + 4;
        const dataEnd = dataStart + size;
        if (dataEnd > extra.byteLength) {
            throw new Error('Invalid zip extra field');
        }
        if (id === ZIP64_EXTRA_FIELD_ID) {
            let cursor = dataStart;
            if (uncompressedSize === 0xffffffff) {
                uncompressedSize = Number(extra.readBigUInt64LE(cursor));
                cursor += 8;
            }
            if (compressedSize === 0xffffffff) {
                compressedSize = Number(extra.readBigUInt64LE(cursor));
                cursor += 8;
            }
            if (localHeaderOffset === 0xffffffff) {
                localHeaderOffset = Number(extra.readBigUInt64LE(cursor));
            }
            break;
        }
        offset = dataEnd;
    }
    if (!Number.isSafeInteger(compressedSize) || !Number.isSafeInteger(uncompressedSize) || !Number.isSafeInteger(localHeaderOffset)) {
        throw new Error('Zip64 entry values exceed safe integer range');
    }
    return { compressedSize, uncompressedSize, localHeaderOffset };
}

async function extractParsedEntry(filePath: string, entry: ParsedZipEntry, destinationPath: string): Promise<SafeZipExtractedEntry> {
    ensureDir(path.dirname(destinationPath));
    const source = fs.createReadStream(filePath, {
        start: entry.dataStart,
        end: entry.dataStart + entry.compressedSizeBytes - 1,
    });
    const payload: Readable = entry.compressionMethod === ZIP_STORE_METHOD ? source : source.pipe(zlib.createInflateRaw());
    const verifier = new ZipEntryVerifier(entry);
    try {
        await pipeline(payload, verifier, fs.createWriteStream(destinationPath, { flags: 'wx' }));
        const result = verifier.result();
        if (result.sizeBytes !== entry.uncompressedSizeBytes) {
            throw new Error(`Zip entry size mismatch: ${entry.path}`);
        }
        if ((result.crc32 >>> 0) !== ((entry.checksumCrc32 ?? 0) >>> 0)) {
            throw new Error(`Zip entry checksum mismatch: ${entry.path}`);
        }
        return {
            ...toSafeEntry(entry),
            extractedPath: destinationPath,
            checksumSha256: result.checksumSha256,
        };
    } catch (error) {
        fs.rmSync(destinationPath, { force: true });
        throw error;
    }
}

class ZipEntryVerifier extends Transform {
    private readonly hash = crypto.createHash('sha256');
    private readonly crc = createCrc32State();
    private sizeBytes = 0;

    constructor(private readonly entry: ParsedZipEntry) {
        super();
    }

    override _transform(chunk: Buffer, _encoding: BufferEncoding, callback: TransformCallback): void {
        this.sizeBytes += chunk.byteLength;
        if (this.sizeBytes > this.entry.uncompressedSizeBytes) {
            callback(new Error(`Zip entry exceeds declared size: ${this.entry.path}`));
            return;
        }
        this.hash.update(chunk);
        updateCrc32State(this.crc, chunk);
        callback(null, chunk);
    }

    result(): { sizeBytes: number; checksumSha256: string; crc32: number } {
        return {
            sizeBytes: this.sizeBytes,
            checksumSha256: this.hash.digest('hex'),
            crc32: finishCrc32State(this.crc),
        };
    }
}

function assertRegularFileEntry(externalFileAttributes: number, entryPath: string): void {
    const mode = (externalFileAttributes >>> 16) & 0xffff;
    const fileType = mode & ZIP_UNIX_FILE_TYPE_MASK;
    if (fileType === ZIP_UNIX_SYMLINK || (fileType !== 0 && fileType !== ZIP_UNIX_REGULAR_FILE)) {
        throw new Error(`Zip entry is not a regular file: ${entryPath}`);
    }
}

function isDirectoryEntry(fileName: string, externalFileAttributes: number): boolean {
    return fileName.endsWith('/') || (externalFileAttributes & ZIP_DIRECTORY_ATTRIBUTE) !== 0;
}

function toSafeEntry(entry: ParsedZipEntry): SafeZipEntry {
    return {
        path: entry.path,
        compressedSizeBytes: entry.compressedSizeBytes,
        uncompressedSizeBytes: entry.uncompressedSizeBytes,
        ...(entry.checksumCrc32 === undefined ? {} : { checksumCrc32: entry.checksumCrc32 }),
    };
}

function readBuffer(fd: number, offset: number, length: number): Buffer {
    const buffer = Buffer.alloc(length);
    const bytesRead = fs.readSync(fd, buffer, 0, length, offset);
    if (bytesRead !== length) {
        throw new Error('Unexpected end of zip archive');
    }
    return buffer;
}

function createCrc32State(): { value: number } {
    return { value: 0xffffffff };
}

function updateCrc32State(state: { value: number }, bytes: Uint8Array): void {
    for (const byte of bytes) {
        state.value = (state.value >>> 8) ^ CRC32_TABLE[(state.value ^ byte) & 0xff]!;
    }
}

function finishCrc32State(state: { value: number }): number {
    return (state.value ^ 0xffffffff) >>> 0;
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

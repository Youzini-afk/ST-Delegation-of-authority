import { describe, expect, it } from 'vitest';
import { createZipArchive, isZipArchive, readZipArchive } from './zip-archive.js';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach } from 'vitest';
import { extractSafeZipEntries, scanSafeZip } from './safe-zip.js';

describe('zip-archive', () => {
    const dirs: string[] = [];

    afterEach(() => {
        while (dirs.length > 0) {
            const dir = dirs.pop();
            if (dir) {
                fs.rmSync(dir, { recursive: true, force: true });
            }
        }
    });

    it('round-trips mixed utf8 and binary files', () => {
        const archive = createZipArchive([
            {
                path: 'manifest.json',
                bytes: Buffer.from('{"format":"authority-portable-package-archive-v2"}', 'utf8'),
            },
            {
                path: 'extensions/ext-a/blob.bin',
                bytes: Buffer.from([0, 1, 2, 3, 4, 255]),
                compression: 'store',
            },
            {
                path: 'extensions/ext-a/notes/readme.txt',
                bytes: Buffer.from('hello authority zip', 'utf8'),
                compression: 'deflate',
            },
        ]);

        expect(isZipArchive(archive)).toBe(true);
        const files = readZipArchive(archive);
        expect([...files.keys()]).toEqual([
            'manifest.json',
            'extensions/ext-a/blob.bin',
            'extensions/ext-a/notes/readme.txt',
        ]);
        expect(files.get('manifest.json')?.toString('utf8')).toContain('authority-portable-package-archive-v2');
        expect([...files.get('extensions/ext-a/blob.bin') ?? []]).toEqual([0, 1, 2, 3, 4, 255]);
        expect(files.get('extensions/ext-a/notes/readme.txt')?.toString('utf8')).toBe('hello authority zip');
    });

    it('rejects duplicate entry paths', () => {
        expect(() => createZipArchive([
            {
                path: 'dup.txt',
                bytes: Buffer.from('a', 'utf8'),
            },
            {
                path: 'dup.txt',
                bytes: Buffer.from('b', 'utf8'),
            },
        ])).toThrow('Duplicate zip entry path');
    });

    it('rejects path traversal entries', () => {
        expect(() => createZipArchive([
            {
                path: '../escape.txt',
                bytes: Buffer.from('nope', 'utf8'),
            },
        ])).toThrow('Invalid zip entry path');
    });

    it('does not misidentify arbitrary bytes as a zip archive', () => {
        expect(isZipArchive(Buffer.from('not-a-zip', 'utf8'))).toBe(false);
    });
});

describe('safe-zip', () => {
    const dirs: string[] = [];

    afterEach(() => {
        while (dirs.length > 0) {
            const dir = dirs.pop();
            if (dir) {
                fs.rmSync(dir, { recursive: true, force: true });
            }
        }
    });

    it('scans safe archive entries without extracting payloads into memory', async () => {
        const archivePath = writeArchive(dirs, createZipArchive([
            { path: 'data/settings.json', bytes: Buffer.from('{}', 'utf8') },
            { path: 'third-party/ext/index.js', bytes: Buffer.from('export {};', 'utf8') },
        ]));

        const scan = await scanSafeZip(archivePath);

        expect(scan.entries.map(entry => entry.path)).toEqual(['data/settings.json', 'third-party/ext/index.js']);
        expect(scan.entries[0]?.uncompressedSizeBytes).toBe(2);
    });

    it('rejects unsafe paths and duplicate normalized paths', async () => {
        const duplicateArchive = Buffer.from(createZipArchive([
            { path: 'dup-a.txt', bytes: Buffer.from('ok') },
            { path: 'dup-b.txt', bytes: Buffer.from('duplicate') },
        ]));
        const firstName = Buffer.from('dup-a.txt', 'utf8');
        const secondName = Buffer.from('dup-b.txt', 'utf8');
        firstName.copy(duplicateArchive, duplicateArchive.indexOf(secondName));
        firstName.copy(duplicateArchive, duplicateArchive.lastIndexOf(secondName));

        await expect(scanSafeZip(writeArchive(dirs, duplicateArchive))).rejects.toThrow('Duplicate zip entry path');

        const unsafeArchive = Buffer.from(createZipArchive([{ path: 'safe.txt', bytes: Buffer.from('ok') }]));
        const unsafeName = Buffer.from('/bad.txt', 'utf8');
        const safeName = Buffer.from('safe.txt', 'utf8');
        unsafeName.copy(unsafeArchive, unsafeArchive.indexOf(safeName));
        unsafeName.copy(unsafeArchive, unsafeArchive.lastIndexOf(safeName));

        await expect(scanSafeZip(writeArchive(dirs, unsafeArchive))).rejects.toThrow();
    });

    it('rejects Windows-reserved names and trailing dot or space segments', async () => {
        await expect(scanSafeZip(writeArchive(dirs, replaceArchiveEntryName(
            createZipArchive([{ path: 'safe.txt', bytes: Buffer.from('ok') }]),
            'safe.txt',
            'CON..txt',
        )))).rejects.toThrow('Invalid zip entry path');

        await expect(scanSafeZip(writeArchive(dirs, replaceArchiveEntryName(
            createZipArchive([{ path: 'safe1', bytes: Buffer.from('ok') }]),
            'safe1',
            'bad. ',
        )))).rejects.toThrow('Invalid zip entry path');
    });

    it('stops extraction when inflated bytes exceed the declared entry size', async () => {
        const archive = Buffer.from(createZipArchive([
            { path: 'bomb.txt', bytes: Buffer.from('abcd'), compression: 'store' },
        ]));
        setSingleEntryDeclaredUncompressedSize(archive, 'bomb.txt', 1);
        const archivePath = writeArchive(dirs, archive);
        const targetRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'authority-zip-target-'));
        dirs.push(targetRoot);

        await expect(extractSafeZipEntries(archivePath, targetRoot)).rejects.toThrow('exceeds declared size');
        expect(fs.existsSync(path.join(targetRoot, 'bomb.txt'))).toBe(false);
    });
});

function writeArchive(dirs: string[], bytes: Buffer): string {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'authority-zip-'));
    dirs.push(dir);
    const archivePath = path.join(dir, 'archive.zip');
    fs.writeFileSync(archivePath, bytes);
    return archivePath;
}

function replaceArchiveEntryName(bytes: Buffer, from: string, to: string): Buffer {
    const fromBytes = Buffer.from(from, 'utf8');
    const toBytes = Buffer.from(to, 'utf8');
    if (fromBytes.byteLength !== toBytes.byteLength) {
        throw new Error('Replacement archive entry names must have equal byte length');
    }
    const archive = Buffer.from(bytes);
    let offset = archive.indexOf(fromBytes);
    while (offset !== -1) {
        toBytes.copy(archive, offset);
        offset = archive.indexOf(fromBytes, offset + toBytes.byteLength);
    }
    return archive;
}

function setSingleEntryDeclaredUncompressedSize(bytes: Buffer, entryName: string, sizeBytes: number): void {
    const encodedName = Buffer.from(entryName, 'utf8');
    const localNameOffset = bytes.indexOf(encodedName);
    if (localNameOffset < 30) {
        throw new Error('Local entry name not found');
    }
    bytes.writeUInt32LE(sizeBytes, localNameOffset - 30 + 22);

    const centralNameOffset = bytes.indexOf(encodedName, localNameOffset + encodedName.byteLength);
    if (centralNameOffset < 46) {
        throw new Error('Central entry name not found');
    }
    bytes.writeUInt32LE(sizeBytes, centralNameOffset - 46 + 24);
}

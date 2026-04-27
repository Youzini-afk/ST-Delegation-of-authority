import { describe, expect, it } from 'vitest';
import { createZipArchive, isZipArchive, readZipArchive } from './zip-archive.js';

describe('zip-archive', () => {
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

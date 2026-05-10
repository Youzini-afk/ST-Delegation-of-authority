import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { NativeMigrationService } from './native-migration-service.js';
import { createZipArchive } from './zip-archive.js';

describe('NativeMigrationService', () => {
    const dirs: string[] = [];
    let previousDataRoot: string | undefined;

    afterEach(() => {
        const globalState = globalThis as typeof globalThis & { DATA_ROOT?: string };
        if (previousDataRoot === undefined) {
            delete globalState.DATA_ROOT;
        } else {
            globalState.DATA_ROOT = previousDataRoot;
        }
        while (dirs.length > 0) {
            const dir = dirs.pop();
            if (dir) {
                fs.rmSync(dir, { recursive: true, force: true });
            }
        }
    });

    it('maps data archives, previews, applies, and rolls back created files', async () => {
        const dataRoot = createDataRoot(dirs);
        const archivePath = writeMigrationArchive(dirs, [
            { path: 'data/settings.json', bytes: Buffer.from('{"theme":"dark"}', 'utf8') },
            { path: 'characters/alice.json', bytes: Buffer.from('{"name":"Alice"}', 'utf8') },
        ]);
        const service = new NativeMigrationService({ dataRoot, migrationRoot: path.join(dataRoot, '.authority-test-migrations') });

        const preview = await service.preview('data', archivePath);

        expect(preview.entries?.map(entry => entry.targetPath)).toEqual(['settings.json', 'characters/alice.json']);
        expect(preview.sourceFileName).toBe('migration.zip');
        expect(JSON.stringify(preview)).not.toContain(dataRoot);

        const applied = await service.apply(preview.id, 'skip');
        expect(applied.status).toBe('applied');
        expect(applied.createdCount).toBe(2);
        expect(fs.readFileSync(path.join(dataRoot, 'settings.json'), 'utf8')).toBe('{"theme":"dark"}');

        const rolledBack = service.rollback(preview.id);
        expect(rolledBack.status).toBe('rolled_back');
        expect(fs.existsSync(path.join(dataRoot, 'settings.json'))).toBe(false);
        expect(fs.existsSync(path.join(dataRoot, 'characters', 'alice.json'))).toBe(false);
    });

    it('maps third-party prefixes and safely restores overwritten files by checksum', async () => {
        const sillyRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'authority-native-migration-st-'));
        dirs.push(sillyRoot);
        const dataRoot = path.join(sillyRoot, 'data');
        fs.mkdirSync(dataRoot, { recursive: true });
        const globalState = globalThis as typeof globalThis & { DATA_ROOT?: string };
        previousDataRoot = globalState.DATA_ROOT;
        globalState.DATA_ROOT = dataRoot;
        const thirdPartyRoot = path.join(dataRoot, 'public', 'scripts', 'extensions', 'third-party');
        const actualThirdPartyRoot = path.join(sillyRoot, 'public', 'scripts', 'extensions', 'third-party');
        fs.mkdirSync(path.join(thirdPartyRoot, 'ext-a'), { recursive: true });
        fs.mkdirSync(path.join(actualThirdPartyRoot, 'ext-a'), { recursive: true });
        fs.writeFileSync(path.join(actualThirdPartyRoot, 'ext-a', 'index.js'), 'old');
        const archivePath = writeMigrationArchive(dirs, [
            { path: 'public/scripts/extensions/third-party/ext-a/index.js', bytes: Buffer.from('new', 'utf8') },
            { path: 'extensions/third-party/ext-b/main.js', bytes: Buffer.from('b', 'utf8') },
            { path: 'third-party/ext-c/main.js', bytes: Buffer.from('c', 'utf8') },
            { path: 'ext-d/main.js', bytes: Buffer.from('d', 'utf8') },
        ]);
        const service = new NativeMigrationService({ dataRoot, sillyTavernRoot: sillyRoot, migrationRoot: path.join(dataRoot, '.authority-test-migrations') });

        const preview = await service.preview('third-party', archivePath);
        expect(preview.entries?.map(entry => entry.targetPath)).toEqual([
            'ext-a/index.js',
            'ext-b/main.js',
            'ext-c/main.js',
            'ext-d/main.js',
        ]);

        const skipped = await service.apply(preview.id, 'skip');
        expect(skipped.skippedCount).toBe(1);
        expect(fs.readFileSync(path.join(actualThirdPartyRoot, 'ext-a', 'index.js'), 'utf8')).toBe('old');
        service.rollback(preview.id);

        const overwritePreview = await service.preview('third-party', archivePath);
        const overwritten = await service.apply(overwritePreview.id, 'overwrite');
        expect(overwritten.overwrittenCount).toBe(1);
        expect(fs.readFileSync(path.join(actualThirdPartyRoot, 'ext-a', 'index.js'), 'utf8')).toBe('new');

        service.rollback(overwritePreview.id);
        expect(fs.readFileSync(path.join(actualThirdPartyRoot, 'ext-a', 'index.js'), 'utf8')).toBe('old');
    });

    it('rejects archive entries that collapse to the same target path after prefix mapping', async () => {
        const dataRoot = createDataRoot(dirs);
        const archivePath = writeMigrationArchive(dirs, [
            { path: 'data/settings.json', bytes: Buffer.from('a', 'utf8') },
            { path: 'settings.json', bytes: Buffer.from('b', 'utf8') },
        ]);
        const service = new NativeMigrationService({ dataRoot, migrationRoot: path.join(dataRoot, '.authority-test-migrations') });

        const preview = await service.preview('data', archivePath);

        expect(preview.entries?.every(entry => entry.action === 'reject')).toBe(true);
        await expect(service.apply(preview.id, 'overwrite')).rejects.toThrow('rejected entries');
        expect(fs.existsSync(path.join(dataRoot, 'settings.json'))).toBe(false);
    });

    it('persists an overwrite rollback record before replacing an existing target', async () => {
        const dataRoot = createDataRoot(dirs);
        fs.writeFileSync(path.join(dataRoot, 'settings.json'), 'old');
        const archivePath = writeMigrationArchive(dirs, [
            { path: 'settings.json', bytes: Buffer.from('new', 'utf8') },
        ]);
        const service = new NativeMigrationService({ dataRoot, migrationRoot: path.join(dataRoot, '.authority-test-migrations') });
        const preview = await service.preview('data', archivePath);
        const originalRenameSync = fs.renameSync;
        fs.renameSync = function renameSyncForTest(oldPath, newPath): void {
            if (String(oldPath).endsWith('.tmp') && String(newPath).endsWith('settings.json')) {
                throw new Error('simulated rename failure');
            }
            return originalRenameSync(oldPath, newPath);
        };

        try {
            await expect(service.apply(preview.id, 'overwrite')).rejects.toThrow('simulated rename failure');
        } finally {
            fs.renameSync = originalRenameSync;
        }

        const failed = service.getOperation(preview.id);
        expect(failed?.status).toBe('failed');
        expect(failed?.journal?.[0]?.action).toBe('pending_overwrite');
        expect(fs.readFileSync(path.join(dataRoot, 'settings.json'), 'utf8')).toBe('old');
    });
});

function createDataRoot(dirs: string[]): string {
    const globalState = globalThis as typeof globalThis & { DATA_ROOT?: string };
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'authority-native-migration-data-'));
    dirs.push(dir);
    globalState.DATA_ROOT = dir;
    return dir;
}

function writeMigrationArchive(dirs: string[], files: Parameters<typeof createZipArchive>[0]): string {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'authority-native-migration-'));
    dirs.push(dir);
    const archivePath = path.join(dir, 'migration.zip');
    fs.writeFileSync(archivePath, createZipArchive(files));
    return archivePath;
}

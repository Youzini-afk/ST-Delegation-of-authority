import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { DataTransferService } from './data-transfer-service.js';
import type { UserContext } from '../types.js';

describe('DataTransferService', () => {
    const dirs: string[] = [];

    afterEach(() => {
        while (dirs.length > 0) {
            const dir = dirs.pop();
            if (dir) {
                fs.rmSync(dir, { recursive: true, force: true });
            }
        }
    });

    it('stages chunked payloads under the extension namespace', async () => {
        const user = createUser(dirs);
        const transfers = new DataTransferService();

        const initialized = await transfers.init(user, 'third-party/ext-a', { resource: 'storage.blob' });
        expect(initialized.resource).toBe('storage.blob');
        expect(initialized.sizeBytes).toBe(0);

        const appended = await transfers.append(user, 'third-party/ext-a', initialized.transferId, {
            offset: 0,
            content: Buffer.from('hello authority', 'utf8').toString('base64'),
        });
        expect(appended.sizeBytes).toBe(Buffer.byteLength('hello authority'));

        const record = transfers.get(user, 'third-party/ext-a', initialized.transferId, 'storage.blob');
        expect(fs.readFileSync(record.filePath, 'utf8')).toBe('hello authority');

        await transfers.discard(user, 'third-party/ext-a', initialized.transferId);
        expect(() => transfers.get(user, 'third-party/ext-a', initialized.transferId)).toThrow('Transfer not found');
    });

    it('rejects cross-extension access to staged payloads', async () => {
        const user = createUser(dirs);
        const transfers = new DataTransferService();
        const initialized = await transfers.init(user, 'third-party/ext-a', { resource: 'fs.private' });

        expect(() => transfers.get(user, 'third-party/ext-b', initialized.transferId)).toThrow('Transfer not found');
    });

    it('reads chunked payloads from existing files without deleting the source file', async () => {
        const user = createUser(dirs);
        const transfers = new DataTransferService();
        const sourcePath = path.join(user.rootDir, 'download.bin');
        fs.writeFileSync(sourcePath, Buffer.from('hello authority download', 'utf8'));

        const opened = await transfers.openRead(user, 'third-party/ext-a', {
            resource: 'storage.blob',
            sourcePath,
        });
        expect(opened.sizeBytes).toBe(Buffer.byteLength('hello authority download'));

        const first = await transfers.read(user, 'third-party/ext-a', opened.transferId, {
            offset: 0,
            limit: 5,
        });
        expect(Buffer.from(first.content, 'base64').toString('utf8')).toBe('hello');
        expect(first.eof).toBe(false);

        const second = await transfers.read(user, 'third-party/ext-a', opened.transferId, {
            offset: 5,
            limit: 1024,
        });
        expect(Buffer.from(second.content, 'base64').toString('utf8')).toBe(' authority download');
        expect(second.eof).toBe(true);

        await transfers.discard(user, 'third-party/ext-a', opened.transferId);
        expect(fs.existsSync(sourcePath)).toBe(true);
    });
});

function createUser(dirs: string[]): UserContext {
    const rootDir = fs.mkdtempSync(path.join(os.tmpdir(), 'authority-transfer-'));
    dirs.push(rootDir);
    return {
        handle: 'alice',
        isAdmin: false,
        rootDir,
    };
}

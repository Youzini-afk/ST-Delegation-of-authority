import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { StManagerControlService } from './st-manager-control-service.js';

describe('StManagerControlService', () => {
    let tempDir = '';

    beforeEach(() => {
        tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'authority-st-manager-control-'));
    });

    afterEach(() => {
        fs.rmSync(tempDir, { recursive: true, force: true });
    });

    it('saves control config without returning plaintext key', () => {
        const service = new StManagerControlService({
            statePath: path.join(tempDir, 'control.json'),
        });

        const saved = service.updateConfig({
            manager_url: 'https://manager.example/',
            control_key: 'stmc_secret_key',
        });

        expect(saved).toMatchObject({
            enabled: true,
            manager_url: 'https://manager.example',
            control_key_masked: 'stmc..._key',
        });
        expect(JSON.stringify(saved)).not.toContain('stmc_secret_key');
        expect(service.getPublicConfig().control_key_fingerprint).toMatch(/^[a-f0-9]{12}$/);
    });

    it('calls ST-Manager with the stored control key header', async () => {
        const fetcher = vi.fn(async () => new Response(JSON.stringify({
            success: true,
            backups: [{ backup_id: 'backup-001' }],
        }), { status: 200 }));
        const service = new StManagerControlService({
            statePath: path.join(tempDir, 'control.json'),
            fetcher,
        });
        service.updateConfig({
            manager_url: 'https://manager.example',
            control_key: 'stmc_secret_key',
        });

        const result = await service.listBackups();

        expect(result).toEqual({ success: true, backups: [{ backup_id: 'backup-001' }] });
        expect(fetcher).toHaveBeenCalledWith('https://manager.example/api/remote_backups/list', expect.objectContaining({
            method: 'GET',
            headers: expect.objectContaining({
                'X-ST-Manager-Control-Key': 'stmc_secret_key',
            }),
        }));
    });

    it('sends backup and restore requests to ST-Manager', async () => {
        const fetcher = vi.fn(async (_url: URL | RequestInfo, init?: RequestInit) => new Response(JSON.stringify({
            success: true,
            received: JSON.parse(String(init?.body ?? '{}')),
        }), { status: 200 }));
        const service = new StManagerControlService({
            statePath: path.join(tempDir, 'control.json'),
            fetcher,
        });
        service.updateConfig({
            manager_url: 'https://manager.example',
            control_key: 'stmc_secret_key',
        });

        await service.startBackup({ resource_types: ['characters'] });
        await service.restoreBackup({ backup_id: 'backup-001', overwrite: true });

        expect(fetcher).toHaveBeenNthCalledWith(1, 'https://manager.example/api/remote_backups/start', expect.objectContaining({
            method: 'POST',
            body: JSON.stringify({ resource_types: ['characters'] }),
        }));
        expect(fetcher).toHaveBeenNthCalledWith(2, 'https://manager.example/api/remote_backups/restore', expect.objectContaining({
            method: 'POST',
            body: JSON.stringify({ backup_id: 'backup-001', overwrite: true }),
        }));
    });
});

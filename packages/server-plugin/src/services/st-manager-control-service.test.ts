import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { StManagerControlService } from './st-manager-control-service.js';
import type { UserContext } from '../types.js';

describe('StManagerControlService', () => {
    let tempDir = '';

    beforeEach(() => {
        tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'authority-st-manager-control-'));
    });

    afterEach(() => {
        fs.rmSync(tempDir, { recursive: true, force: true });
    });

    function user(): UserContext {
        return {
            handle: 'alice',
            isAdmin: true,
            rootDir: path.join(tempDir, 'data', 'alice'),
            directories: { root: path.join(tempDir, 'data', 'alice') },
        };
    }

    it('saves control config and returns the key to the admin config view', () => {
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
            control_key: 'stmc_secret_key',
        });
        expect(service.getPublicConfig()).not.toHaveProperty('control_key');
        expect(service.getAdminConfig()).toHaveProperty('control_key', 'stmc_secret_key');
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

    it('probes the ST-Manager control channel without requiring remote Bridge config', async () => {
        const calls: string[] = [];
        const fetcher = vi.fn(async (url: URL | RequestInfo) => {
            calls.push(String(url));
            return new Response(JSON.stringify({
                success: true,
                control: { enabled: true },
            }), { status: 200 });
        });
        const service = new StManagerControlService({
            statePath: path.join(tempDir, 'control.json'),
            fetcher,
        });
        service.updateConfig({
            manager_url: 'https://manager.example',
            control_key: 'stmc_secret_key',
        });

        await service.probe();

        expect(calls).toEqual(['https://manager.example/api/remote_backups/control']);
    });

    it('pushes Authority resources to ST-Manager without asking ST-Manager to call back into Authority', async () => {
        const calls: Array<{ url: string; body: Record<string, unknown> }> = [];
        const fetcher = vi.fn(async (url: URL | RequestInfo, init?: RequestInit) => {
            const body = init?.body ? JSON.parse(String(init.body)) as Record<string, unknown> : {};
            calls.push({ url: String(url), body });
            if (String(url).endsWith('/control')) {
                return new Response(JSON.stringify({ success: true, features: {} }), { status: 200 });
            }
            if (String(url).endsWith('/incoming/start')) {
                return new Response(JSON.stringify({ success: true, backup: { backup_id: 'push-001' } }), { status: 200 });
            }
            if (String(url).endsWith('/incoming/file/write-init')) {
                return new Response(JSON.stringify({ success: true, transfer: { upload_id: 'upload-1' } }), { status: 200 });
            }
            if (String(url).endsWith('/incoming/complete')) {
                return new Response(JSON.stringify({ success: true, backup: { backup_id: 'push-001', total_files: 1 } }), { status: 200 });
            }
            return new Response(JSON.stringify({ success: true, transfer: { offset: 4 }, file: {} }), { status: 200 });
        });
        const locator = {
            buildManifest: vi.fn(() => ({
                resource_type: 'characters',
                root: '/st/data/characters',
                files: [{
                    relative_path: 'Ava.png',
                    kind: 'file' as const,
                    source: 'root/characters',
                    size: 4,
                    mtime: 123,
                    sha256: '0'.repeat(64),
                }],
            })),
            readResourceFile: vi.fn(() => ({
                buffer: Buffer.from('card'),
                size: 4,
                mtime: 123,
                sha256: '0'.repeat(64),
                source: 'root/characters',
                kind: 'file',
            })),
            writeResourceFile: vi.fn(),
        };
        const service = new StManagerControlService({
            statePath: path.join(tempDir, 'control.json'),
            fetcher,
            locator,
            chunkSize: 2,
        });
        service.updateConfig({
            manager_url: 'https://manager.example',
            control_key: 'stmc_secret_key',
        });

        const result = await service.startBackup(user(), {
            resource_types: ['characters'],
            backup_id: 'push-001',
            ingest: false,
        });

        expect(result).toMatchObject({ success: true, backup: { backup_id: 'push-001' } });
        expect(calls.map(call => call.url)).toEqual([
            'https://manager.example/api/remote_backups/control',
            'https://manager.example/api/remote_backups/incoming/start',
            'https://manager.example/api/remote_backups/incoming/file/write-init',
            'https://manager.example/api/remote_backups/incoming/file/write-chunk',
            'https://manager.example/api/remote_backups/incoming/file/write-chunk',
            'https://manager.example/api/remote_backups/incoming/file/write-commit',
            'https://manager.example/api/remote_backups/incoming/complete',
        ]);
        expect(calls.map(call => call.url)).not.toContain('https://manager.example/api/remote_backups/start');
    });

    it('verifies current Authority file bytes before using incoming skip-by-sha', async () => {
        const calls: Array<{ url: string; body: Record<string, unknown> }> = [];
        const fetcher = vi.fn(async (url: URL | RequestInfo, init?: RequestInit) => {
            const body = init?.body ? JSON.parse(String(init.body)) as Record<string, unknown> : {};
            calls.push({ url: String(url), body });
            if (String(url).endsWith('/control')) {
                return new Response(JSON.stringify({
                    success: true,
                    protocol_version: 2,
                    features: { incoming_skip_by_sha: true },
                }), { status: 200 });
            }
            if (String(url).endsWith('/incoming/start')) {
                return new Response(JSON.stringify({ success: true, backup: { backup_id: 'push-001' } }), { status: 200 });
            }
            if (String(url).endsWith('/incoming/file/write-init')) {
                return new Response(JSON.stringify({
                    success: true,
                    transfer: { upload_required: false, status: 'already_present' },
                }), { status: 200 });
            }
            if (String(url).endsWith('/incoming/complete')) {
                return new Response(JSON.stringify({ success: true, backup: { backup_id: 'push-001', total_files: 1 } }), { status: 200 });
            }
            return new Response(JSON.stringify({ success: true }), { status: 200 });
        });
        const locator = {
            buildManifest: vi.fn(() => ({
                files: [{
                    relative_path: 'Ava.png',
                    kind: 'file' as const,
                    source: 'root/characters',
                    size: 4,
                    mtime: 123,
                    sha256: '8367cd66fdd136bba8ba23f8805bb050dd6289401c8ec3b0be44a3c233eef90d',
                }],
            })),
            readResourceFile: vi.fn(() => ({ buffer: Buffer.from('card') })),
            writeResourceFile: vi.fn(),
        };
        const service = new StManagerControlService({
            statePath: path.join(tempDir, 'control.json'),
            fetcher,
            locator,
            chunkSize: 2,
        });
        service.updateConfig({
            manager_url: 'https://manager.example',
            control_key: 'stmc_secret_key',
        });

        await service.startBackup(user(), { resource_types: ['characters'], backup_id: 'push-001', ingest: false });

        expect(locator.readResourceFile).toHaveBeenCalledWith(expect.any(Object), 'characters', 'Ava.png');
        expect(calls.map(call => call.url)).toEqual([
            'https://manager.example/api/remote_backups/control',
            'https://manager.example/api/remote_backups/incoming/start',
            'https://manager.example/api/remote_backups/incoming/file/write-init',
            'https://manager.example/api/remote_backups/incoming/complete',
        ]);
        expect(calls.at(2)?.body).toMatchObject({
            allow_skip_by_sha: true,
            sha256: '8367cd66fdd136bba8ba23f8805bb050dd6289401c8ec3b0be44a3c233eef90d',
        });
    });

    it('uses freshly hashed file bytes when manifest sha is stale', async () => {
        const calls: Array<{ url: string; body: Record<string, unknown> }> = [];
        const currentBytes = Buffer.from('new-card');
        const currentSha = 'b679a2e7b21f0676d92b08820a9914c814666a2844018e00380dc73ea28c2f7e';
        const fetcher = vi.fn(async (url: URL | RequestInfo, init?: RequestInit) => {
            const body = init?.body ? JSON.parse(String(init.body)) as Record<string, unknown> : {};
            calls.push({ url: String(url), body });
            if (String(url).endsWith('/control')) {
                return new Response(JSON.stringify({
                    success: true,
                    protocol_version: 2,
                    features: { incoming_skip_by_sha: true },
                }), { status: 200 });
            }
            if (String(url).endsWith('/incoming/start')) {
                return new Response(JSON.stringify({ success: true, backup: { backup_id: 'push-001' } }), { status: 200 });
            }
            if (String(url).endsWith('/incoming/file/write-init')) {
                return new Response(JSON.stringify({
                    success: true,
                    transfer: { upload_required: true, upload_id: 'upload-001' },
                }), { status: 200 });
            }
            if (String(url).endsWith('/incoming/complete')) {
                return new Response(JSON.stringify({ success: true, backup: { backup_id: 'push-001', total_files: 1 } }), { status: 200 });
            }
            return new Response(JSON.stringify({ success: true }), { status: 200 });
        });
        const locator = {
            buildManifest: vi.fn(() => ({
                files: [{
                    relative_path: 'Ava.png',
                    kind: 'file' as const,
                    source: 'root/characters',
                    size: 4,
                    mtime: 123,
                    sha256: '8367cd66fdd136bba8ba23f8805bb050dd6289401c8ec3b0be44a3c233eef90d',
                }],
            })),
            readResourceFile: vi.fn(() => ({ buffer: currentBytes })),
            writeResourceFile: vi.fn(),
        };
        const service = new StManagerControlService({
            statePath: path.join(tempDir, 'control.json'),
            fetcher,
            locator,
            chunkSize: 4,
        });
        service.updateConfig({
            manager_url: 'https://manager.example',
            control_key: 'stmc_secret_key',
        });

        await service.startBackup(user(), { resource_types: ['characters'], backup_id: 'push-001', ingest: false });

        expect(calls.find(call => call.url.endsWith('/incoming/file/write-init'))?.body).toMatchObject({
            allow_skip_by_sha: true,
            size: currentBytes.length,
            sha256: currentSha,
        });
        const chunks = calls.filter(call => call.url.endsWith('/incoming/file/write-chunk'));
        expect(chunks.map(call => call.body)).toEqual([
            {
                upload_id: 'upload-001',
                offset: 0,
                data_base64: currentBytes.subarray(0, 4).toString('base64'),
            },
            {
                upload_id: 'upload-001',
                offset: 4,
                data_base64: currentBytes.subarray(4).toString('base64'),
            },
        ]);
    });

    it('restores ST-Manager backup files through the control channel into Authority resources', async () => {
        const written: Array<{ type: string; path: string; data: string; mode: string }> = [];
        const fetcher = vi.fn(async (url: URL | RequestInfo, init?: RequestInit) => {
            if (String(url).includes('/detail?')) {
                return new Response(JSON.stringify({
                    success: true,
                    backup: {
                        backup_id: 'backup-001',
                        resource_types: ['characters'],
                        resources: {
                            characters: [{
                                relative_path: 'Ava.png',
                                size: 4,
                                sha256: '8367cd66fdd136bba8ba23f8805bb050dd6289401c8ec3b0be44a3c233eef90d',
                            }],
                        },
                    },
                }), { status: 200 });
            }
            const body = init?.body ? JSON.parse(String(init.body)) as Record<string, unknown> : {};
            expect(String(url)).toBe('https://manager.example/api/remote_backups/file/read');
            expect(body).toMatchObject({ backup_id: 'backup-001', resource_type: 'characters', path: 'Ava.png' });
            return new Response(JSON.stringify({
                success: true,
                file: {
                    data_base64: Buffer.from('card').toString('base64'),
                    bytes_read: 4,
                    sha256: '8367cd66fdd136bba8ba23f8805bb050dd6289401c8ec3b0be44a3c233eef90d',
                    eof: true,
                },
            }), { status: 200 });
        });
        const locator = {
            buildManifest: vi.fn(() => ({ files: [] })),
            readResourceFile: vi.fn(),
            writeResourceFile: vi.fn((_user: UserContext, type: string, relativePath: string, data: Buffer, mode: string) => {
                written.push({ type, path: relativePath, data: data.toString('utf8'), mode });
                return { path: relativePath, skipped: false };
            }),
        };
        const service = new StManagerControlService({
            statePath: path.join(tempDir, 'control.json'),
            fetcher,
            locator,
            chunkSize: 2,
        });
        service.updateConfig({
            manager_url: 'https://manager.example',
            control_key: 'stmc_secret_key',
        });

        const result = await service.restoreBackup(user(), { backup_id: 'backup-001', overwrite: true });

        expect(result).toMatchObject({ uploaded: 1, skipped: 0, failed: 0 });
        expect(written).toEqual([{ type: 'characters', path: 'Ava.png', data: 'card', mode: 'overwrite' }]);
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

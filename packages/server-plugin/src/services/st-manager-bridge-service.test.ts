import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { StManagerBridgeService } from './st-manager-bridge-service.js';
import type { UserContext } from '../types.js';

describe('StManagerBridgeService', () => {
    let tempDir = '';
    let userRoot = '';
    let service: StManagerBridgeService;

    beforeEach(() => {
        tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'authority-st-manager-bridge-'));
        userRoot = path.join(tempDir, 'data', 'alice');
        fs.mkdirSync(path.join(userRoot, 'characters'), { recursive: true });
        fs.writeFileSync(path.join(userRoot, 'characters', 'Ava.png'), Buffer.from('card'));
        service = new StManagerBridgeService({
            statePath: path.join(tempDir, 'bridge-state.json'),
            transferRoot: path.join(tempDir, 'transfers'),
        });
    });

    afterEach(() => {
        fs.rmSync(tempDir, { recursive: true, force: true });
    });

    function user(isAdmin = true): UserContext {
        return {
            handle: 'alice',
            isAdmin,
            rootDir: userRoot,
            directories: { root: userRoot },
        };
    }

    it('keeps the bridge disabled by default and never exposes stored key material', () => {
        expect(service.getPublicConfig(user())).toEqual({
            enabled: false,
            bound_user_handle: null,
            key_fingerprint: null,
            key_masked: null,
            max_file_size: 104857600,
            resource_types: ['characters', 'chats', 'worlds', 'presets', 'regex', 'quick_replies'],
        });

        expect(() => service.probe(user(), {})).toThrow(/Bridge disabled/);
    });

    it('keeps the rotated bridge key available only in the admin config view', () => {
        const updated = service.updateAdminConfig(user(), { enabled: true, rotate_key: true });

        expect(updated.bridge_key).toMatch(/^stmb_/);
        expect(service.getAdminConfig(user()).bridge_key).toBe(updated.bridge_key);
        expect(service.getPublicConfig(user())).not.toHaveProperty('bridge_key');
        expect(service.probe(user(), { authorization: `Bearer ${updated.bridge_key}` }).bridge).not.toHaveProperty('bridge_key');
    });

    it('rotates a key for admins and requires it for protected operations', () => {
        const updated = service.updateAdminConfig(user(), { enabled: true, rotate_key: true });
        expect(updated.bridge_key).toMatch(/^stmb_/);
        expect(updated.key_masked).toContain('...');
        expect('key_hash' in updated).toBe(false);

        expect(() => service.buildManifest(user(), 'characters', {})).toThrow(/Invalid bridge key/);

        const manifest = service.buildManifest(user(), 'characters', {
            authorization: `Bearer ${updated.bridge_key}`,
        });
        expect(manifest.files.map(file => file.relative_path)).toEqual(['Ava.png']);
    });

    it('reads files in chunks and commits writes only after sha256 validation', () => {
        const updated = service.updateAdminConfig(user(), { enabled: true, rotate_key: true });
        const headers = { authorization: `Bearer ${updated.bridge_key}` };

        const chunk = service.readFile(user(), 'characters', { path: 'Ava.png', offset: 1, limit: 2 }, headers);
        expect(chunk).toMatchObject({
            path: 'Ava.png',
            offset: 1,
            bytes_read: 2,
            eof: false,
        });
        expect(Buffer.from(chunk.data_base64, 'base64').toString('utf8')).toBe('ar');

        const init = service.writeInit(user(), 'characters', { path: 'Bex.png', size: 3, sha256: '0'.repeat(64) }, headers);
        expect(init.upload_id).toBeTruthy();
        service.writeChunk(user(), 'characters', { upload_id: init.upload_id, offset: 0, data_base64: Buffer.from('new').toString('base64') }, headers);
        expect(() => service.writeCommit(user(), 'characters', { upload_id: init.upload_id }, headers)).toThrow(/sha256 mismatch/);
        expect(fs.existsSync(path.join(userRoot, 'characters', 'Bex.png'))).toBe(false);
    });

    it('treats negative max file size as unlimited for uploads', () => {
        const updated = service.updateAdminConfig(user(), {
            enabled: true,
            rotate_key: true,
            max_file_size: -1,
        });
        const headers = { authorization: `Bearer ${updated.bridge_key}` };

        expect(updated.max_file_size).toBe(-1);
        expect(service.getPublicConfig(user()).max_file_size).toBe(-1);
        expect(() => service.writeInit(user(), 'characters', {
            path: 'Huge.png',
            size: 101 * 1024 * 1024,
            sha256: '0'.repeat(64),
        }, headers)).not.toThrow();
    });

    it('binds the current admin user when enabling or rotating the bridge key', () => {
        const updated = service.updateAdminConfig(user(), { enabled: true, rotate_key: true });

        expect(updated.bridge_key).toMatch(/^stmb_/);
        expect(updated.bound_user_handle).toBe('alice');
        expect(JSON.stringify(updated)).not.toContain(userRoot);
        expect(JSON.stringify(updated)).not.toContain('key_hash');

        const resolved = service.resolveAuthorizedUser(undefined, {
            authorization: `Bearer ${updated.bridge_key}`,
        });

        expect(resolved.handle).toBe('alice');
        expect(resolved.rootDir).toBe(userRoot);
    });

    it('requires a bound user for key-only bridge access', () => {
        const updated = service.updateAdminConfig(user(), { enabled: true, rotate_key: true });
        const bridgeKey = String(updated.bridge_key);
        fs.writeFileSync(path.join(tempDir, 'bridge-state.json'), JSON.stringify({
            enabled: true,
            key_hash: crypto.createHash('sha256').update(bridgeKey).digest('hex'),
            key_fingerprint: 'legacy',
        }));

        expect(() => service.resolveAuthorizedUser(undefined, {
            authorization: `Bearer ${bridgeKey}`,
        })).toThrow(/Bridge key is not bound/);
    });
});

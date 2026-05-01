import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { getGlobalAuthorityPaths } from '../store/authority-paths.js';
import { AuthorityServiceError, atomicWriteJson, readJsonFile } from '../utils.js';

interface StManagerControlState {
    enabled?: boolean;
    manager_url?: string;
    control_key?: string;
    control_key_masked?: string;
    control_key_fingerprint?: string;
}

export interface StManagerControlServiceOptions {
    statePath?: string;
    fetcher?: typeof fetch;
}

export interface StManagerControlPayload {
    enabled?: boolean;
    manager_url?: string;
    control_key?: string;
}

function defaultStatePath(): string {
    return path.join(path.dirname(getGlobalAuthorityPaths().controlDbFile), 'st-manager-control.json');
}

function normalizeManagerUrl(value: unknown): string {
    const raw = String(value ?? '').trim();
    if (!raw) {
        return '';
    }
    const parsed = new URL(raw);
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
        throw new AuthorityServiceError('ST-Manager URL must be http or https', 400, 'validation_error', 'validation');
    }
    return parsed.toString().replace(/\/+$/, '');
}

function fingerprintKey(key: string): string {
    return crypto.createHash('sha256').update(key).digest('hex').slice(0, 12);
}

function maskKey(key: string): string {
    if (!key) {
        return '';
    }
    return key.length <= 10 ? 'stmc...' : `${key.slice(0, 4)}...${key.slice(-4)}`;
}

function publicState(state: StManagerControlState) {
    return {
        enabled: Boolean(state.enabled),
        manager_url: state.manager_url ?? '',
        control_key_masked: state.control_key_masked ?? '',
        control_key_fingerprint: state.control_key_fingerprint ?? '',
    };
}

function adminState(state: StManagerControlState) {
    return {
        ...publicState(state),
        control_key: state.control_key ?? '',
    };
}

export class StManagerControlService {
    private readonly statePath: string;
    private readonly fetcher: typeof fetch;

    constructor(options: StManagerControlServiceOptions = {}) {
        this.statePath = options.statePath ?? defaultStatePath();
        this.fetcher = options.fetcher ?? fetch;
    }

    getPublicConfig() {
        return publicState(this.readState());
    }

    getAdminConfig() {
        return adminState(this.readState());
    }

    updateConfig(payload: StManagerControlPayload) {
        const current = this.readState();
        const next: StManagerControlState = { ...current };
        if (typeof payload.enabled === 'boolean') {
            next.enabled = payload.enabled;
        }
        if (payload.manager_url !== undefined) {
            next.manager_url = normalizeManagerUrl(payload.manager_url);
        }
        if (payload.control_key !== undefined && String(payload.control_key).trim()) {
            next.control_key = String(payload.control_key).trim();
            next.control_key_masked = maskKey(next.control_key);
            next.control_key_fingerprint = fingerprintKey(next.control_key);
        }
        next.enabled = Boolean(next.enabled || (next.manager_url && next.control_key));
        this.writeState(next);
        return adminState(next);
    }

    probe() {
        return this.request('POST', '/api/remote_backups/probe');
    }

    startBackup(payload: Record<string, unknown>) {
        return this.request('POST', '/api/remote_backups/start', payload);
    }

    listBackups() {
        return this.request('GET', '/api/remote_backups/list');
    }

    getBackupDetail(backupId: string) {
        return this.request('GET', `/api/remote_backups/detail?backup_id=${encodeURIComponent(backupId)}`);
    }

    restorePreview(payload: Record<string, unknown>) {
        return this.request('POST', '/api/remote_backups/restore-preview', payload);
    }

    restoreBackup(payload: Record<string, unknown>) {
        return this.request('POST', '/api/remote_backups/restore', payload);
    }

    async pair(payload: Record<string, unknown>) {
        return await this.request('POST', '/api/remote_backups/config', payload);
    }

    private async request(method: string, apiPath: string, payload?: Record<string, unknown>) {
        const state = this.readState();
        if (!state.manager_url || !state.control_key) {
            throw new AuthorityServiceError('ST-Manager URL and Control Key are required', 400, 'validation_error', 'validation');
        }
        const response = await this.fetcher(`${state.manager_url}${apiPath}`, {
            method,
            headers: {
                'Content-Type': 'application/json',
                'X-ST-Manager-Control-Key': state.control_key,
            },
            ...(payload === undefined ? {} : { body: JSON.stringify(payload) }),
        });
        const text = await response.text();
        let data: unknown = {};
        try {
            data = text ? JSON.parse(text) : {};
        } catch {
            throw new AuthorityServiceError('ST-Manager returned invalid JSON', 502, 'validation_error', 'core');
        }
        if (!response.ok) {
            const message = typeof data === 'object' && data && 'error' in data ? String((data as Record<string, unknown>).error) : text;
            throw new AuthorityServiceError(message || `ST-Manager request failed: ${response.status}`, response.status, 'validation_error', 'core');
        }
        return data;
    }

    private readState(): StManagerControlState {
        return readJsonFile<StManagerControlState>(this.statePath, {});
    }

    private writeState(state: StManagerControlState): void {
        fs.mkdirSync(path.dirname(this.statePath), { recursive: true });
        atomicWriteJson(this.statePath, state);
    }
}

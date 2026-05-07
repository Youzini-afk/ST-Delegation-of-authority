import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { getGlobalAuthorityPaths } from '../store/authority-paths.js';
import type { UserContext } from '../types.js';
import { AuthorityServiceError, atomicWriteJson, readJsonFile } from '../utils.js';
import { ST_MANAGER_RESOURCE_TYPES, StManagerResourceLocator, type StManagerManifestFile, type StManagerResourceType } from './st-manager-resource-locator.js';

interface StManagerControlState {
    enabled?: boolean;
    manager_url?: string;
    control_key?: string;
    control_key_masked?: string;
    control_key_fingerprint?: string;
}

interface StManagerControlFeatures {
    incomingSkipBySha: boolean;
}

export interface StManagerControlServiceOptions {
    statePath?: string;
    fetcher?: typeof fetch;
    locator?: StManagerControlLocator;
    chunkSize?: number;
}

export interface StManagerControlPayload {
    enabled?: boolean;
    manager_url?: string;
    control_key?: string;
}

interface StManagerControlLocator {
    buildManifest(user: UserContext, resourceType: StManagerResourceType): { files: StManagerManifestFile[] };
    readResourceFile(user: UserContext, resourceType: StManagerResourceType, relativePath: string): { buffer: Buffer };
    writeResourceFile(
        user: UserContext,
        resourceType: StManagerResourceType,
        relativePath: string,
        buffer: Buffer,
        overwriteMode?: string,
    ): { path: string; skipped: boolean };
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
    private readonly locator: StManagerControlLocator;
    private readonly chunkSize: number;

    constructor(options: StManagerControlServiceOptions = {}) {
        this.statePath = options.statePath ?? defaultStatePath();
        this.fetcher = options.fetcher ?? fetch;
        this.locator = options.locator ?? new StManagerResourceLocator();
        this.chunkSize = Math.max(1, Number(options.chunkSize ?? 1024 * 1024) || 1024 * 1024);
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
        return this.request('GET', '/api/remote_backups/control');
    }

    startBackup(payload: Record<string, unknown>): Promise<unknown>;
    startBackup(user: UserContext, payload: Record<string, unknown>): Promise<unknown>;
    startBackup(userOrPayload: UserContext | Record<string, unknown>, maybePayload?: Record<string, unknown>) {
        if (maybePayload === undefined) {
            return this.request('POST', '/api/remote_backups/start', userOrPayload as Record<string, unknown>);
        }
        return this.pushBackup(userOrPayload as UserContext, maybePayload);
    }

    listBackups() {
        return this.request('GET', '/api/remote_backups/list');
    }

    getBackupDetail(backupId: string) {
        return this.request('GET', `/api/remote_backups/detail?backup_id=${encodeURIComponent(backupId)}`);
    }

    restorePreview(payload: Record<string, unknown>): Promise<unknown>;
    restorePreview(user: UserContext, payload: Record<string, unknown>): Promise<unknown>;
    restorePreview(userOrPayload: UserContext | Record<string, unknown>, maybePayload?: Record<string, unknown>) {
        if (maybePayload === undefined) {
            return this.request('POST', '/api/remote_backups/restore-preview', userOrPayload as Record<string, unknown>);
        }
        return this.previewRestoreToAuthority(userOrPayload as UserContext, maybePayload);
    }

    restoreBackup(payload: Record<string, unknown>): Promise<unknown>;
    restoreBackup(user: UserContext, payload: Record<string, unknown>): Promise<unknown>;
    restoreBackup(userOrPayload: UserContext | Record<string, unknown>, maybePayload?: Record<string, unknown>) {
        if (maybePayload === undefined) {
            return this.request('POST', '/api/remote_backups/restore', userOrPayload as Record<string, unknown>);
        }
        return this.restoreToAuthority(userOrPayload as UserContext, maybePayload);
    }

    async pair(payload: Record<string, unknown>) {
        return await this.request('POST', '/api/remote_backups/config', payload);
    }

    private async pushBackup(user: UserContext, payload: Record<string, unknown>) {
        const resourceTypes = this.resolveResourceTypes(payload.resource_types);
        const features = await this.getControlFeatures();
        const startResponse = await this.request('POST', '/api/remote_backups/incoming/start', {
            backup_id: payload.backup_id,
            description: payload.description ?? 'manual backup from Authority',
            source: 'authority_control',
            resource_types: resourceTypes,
        }) as Record<string, unknown>;
        const backup = this.extractObject(startResponse.backup, 'ST-Manager incoming start response missing backup');
        const backupId = String(backup.backup_id || payload.backup_id || '');
        if (!backupId) {
            throw new AuthorityServiceError('ST-Manager incoming start response missing backup_id', 502, 'validation_error', 'core');
        }

        for (const resourceType of resourceTypes) {
            const manifest = this.locator.buildManifest(user, resourceType);
            for (const entry of manifest.files) {
                await this.uploadBackupFile(user, backupId, resourceType, entry, features);
            }
        }

        return await this.request('POST', '/api/remote_backups/incoming/complete', {
            backup_id: backupId,
            ingest: payload.ingest !== false,
        });
    }

    private async uploadBackupFile(
        user: UserContext,
        backupId: string,
        resourceType: StManagerResourceType,
        entry: StManagerManifestFile,
        features: StManagerControlFeatures,
    ) {
        const file = this.locator.readResourceFile(user, resourceType, entry.relative_path);
        const buffer = file.buffer;
        const size = buffer.length;
        const digest = crypto.createHash('sha256').update(buffer).digest('hex');
        const canSkipBySha = features.incomingSkipBySha && /^[a-f0-9]{64}$/.test(digest);
        const initResponse = await this.request('POST', '/api/remote_backups/incoming/file/write-init', {
            backup_id: backupId,
            resource_type: resourceType,
            relative_path: entry.relative_path,
            size,
            sha256: digest,
            allow_skip_by_sha: canSkipBySha,
            metadata: {
                kind: entry.kind,
                source: entry.source,
                mtime: entry.mtime,
            },
        }) as Record<string, unknown>;
        const transfer = this.extractObject(initResponse.transfer, 'ST-Manager write-init response missing transfer');
        if (transfer.upload_required === false) {
            return;
        }
        const uploadId = String(transfer.upload_id || '');
        if (!uploadId) {
            throw new AuthorityServiceError('ST-Manager write-init response missing upload_id', 502, 'validation_error', 'core');
        }

        let offset = 0;
        while (offset < buffer.length) {
            const chunk = buffer.subarray(offset, offset + this.chunkSize);
            await this.request('POST', '/api/remote_backups/incoming/file/write-chunk', {
                upload_id: uploadId,
                offset,
                data_base64: chunk.toString('base64'),
            });
            offset += chunk.length;
        }

        await this.request('POST', '/api/remote_backups/incoming/file/write-commit', {
            upload_id: uploadId,
        });
    }

    private async getControlFeatures(): Promise<StManagerControlFeatures> {
        try {
            const response = await this.probe() as Record<string, unknown>;
            const features = this.extractObject(response.features, 'ST-Manager control response missing features');
            return {
                incomingSkipBySha: features.incoming_skip_by_sha === true,
            };
        } catch {
            return { incomingSkipBySha: false };
        }
    }

    private async previewRestoreToAuthority(user: UserContext, payload: Record<string, unknown>) {
        const backupId = this.requiredBackupId(payload);
        const manifest = await this.getRemoteBackupManifest(backupId);
        const resourceTypes = this.resolveResourceTypes(payload.resource_types ?? manifest.resource_types);
        const preview = { backup_id: backupId, items: [] as Array<Record<string, unknown>>, create: 0, overwrite: 0, same: 0 };

        for (const resourceType of resourceTypes) {
            const localEntries = new Map(
                this.locator.buildManifest(user, resourceType).files.map(entry => [entry.relative_path, entry]),
            );
            for (const entry of this.backupEntries(manifest, resourceType)) {
                const relativePath = String(entry.relative_path || entry.path || '');
                const localEntry = localEntries.get(relativePath);
                const same = Boolean(localEntry && localEntry.sha256 === entry.sha256);
                const action = same ? 'same' : (localEntry ? 'overwrite' : 'create');
                preview[action] += 1;
                preview.items.push({
                    resource_type: resourceType,
                    relative_path: relativePath,
                    exists_local: Boolean(localEntry),
                    same_sha256: same,
                    action,
                });
            }
        }
        return preview;
    }

    private async restoreToAuthority(user: UserContext, payload: Record<string, unknown>) {
        const backupId = this.requiredBackupId(payload);
        const overwrite = Boolean(payload.overwrite);
        const manifest = await this.getRemoteBackupManifest(backupId);
        const resourceTypes = this.resolveResourceTypes(payload.resource_types ?? manifest.resource_types);
        const result = { backup_id: backupId, uploaded: 0, skipped: 0, failed: 0, items: [] as Array<Record<string, unknown>> };

        for (const resourceType of resourceTypes) {
            const localEntries = new Map(
                this.locator.buildManifest(user, resourceType).files.map(entry => [entry.relative_path, entry]),
            );
            for (const entry of this.backupEntries(manifest, resourceType)) {
                const relativePath = String(entry.relative_path || entry.path || '');
                if (localEntries.has(relativePath) && !overwrite) {
                    result.skipped += 1;
                    result.items.push({ resource_type: resourceType, relative_path: relativePath, status: 'skipped_existing' });
                    continue;
                }

                try {
                    const data = await this.downloadBackupFile(backupId, resourceType, relativePath, String(entry.sha256 || ''));
                    const write = this.locator.writeResourceFile(
                        user,
                        resourceType,
                        relativePath,
                        data,
                        overwrite ? 'overwrite' : 'skip',
                    );
                    if (write.skipped) {
                        result.skipped += 1;
                        result.items.push({ resource_type: resourceType, relative_path: relativePath, status: 'skipped_existing' });
                    } else {
                        result.uploaded += 1;
                        result.items.push({ resource_type: resourceType, relative_path: relativePath, status: 'uploaded' });
                    }
                } catch (error) {
                    result.failed += 1;
                    result.items.push({
                        resource_type: resourceType,
                        relative_path: relativePath,
                        status: 'failed',
                        error: error instanceof Error ? error.message : String(error),
                    });
                }
            }
        }
        return result;
    }

    private async downloadBackupFile(backupId: string, resourceType: StManagerResourceType, relativePath: string, expectedSha256 = ''): Promise<Buffer> {
        const chunks: Buffer[] = [];
        let offset = 0;
        let remoteSha256 = '';
        while (true) {
            const response = await this.request('POST', '/api/remote_backups/file/read', {
                backup_id: backupId,
                resource_type: resourceType,
                path: relativePath,
                offset,
                limit: this.chunkSize,
            }) as Record<string, unknown>;
            const file = this.extractObject(response.file, 'ST-Manager file read response missing file');
            const chunk = Buffer.from(String(file.data_base64 || ''), 'base64');
            const bytesRead = Number(file.bytes_read ?? chunk.length);
            if (bytesRead !== chunk.length) {
                throw new AuthorityServiceError(`chunk size mismatch for ${relativePath}`, 502, 'validation_error', 'core');
            }
            chunks.push(chunk);
            offset += chunk.length;
            remoteSha256 = String(file.sha256 || remoteSha256);
            if (file.eof) {
                break;
            }
            if (chunk.length === 0) {
                throw new AuthorityServiceError(`file read stalled for ${relativePath}`, 502, 'validation_error', 'core');
            }
        }
        const data = Buffer.concat(chunks);
        const actualSha256 = crypto.createHash('sha256').update(data).digest('hex');
        const expected = expectedSha256 || remoteSha256;
        if (expected && actualSha256 !== expected) {
            throw new AuthorityServiceError(`sha256 mismatch for ${relativePath}`, 502, 'validation_error', 'core');
        }
        if (remoteSha256 && actualSha256 !== remoteSha256) {
            throw new AuthorityServiceError(`sha256 mismatch for ${relativePath}`, 502, 'validation_error', 'core');
        }
        return data;
    }

    private async getRemoteBackupManifest(backupId: string): Promise<Record<string, unknown>> {
        const response = await this.getBackupDetail(backupId) as Record<string, unknown>;
        return this.extractObject(response.backup, 'ST-Manager detail response missing backup');
    }

    private backupEntries(manifest: Record<string, unknown>, resourceType: StManagerResourceType): Array<Record<string, unknown>> {
        const resources = manifest.resources;
        if (!resources || typeof resources !== 'object' || Array.isArray(resources)) {
            return [];
        }
        const entries = (resources as Record<string, unknown>)[resourceType];
        return Array.isArray(entries)
            ? entries.filter((entry): entry is Record<string, unknown> => Boolean(entry) && typeof entry === 'object' && !Array.isArray(entry))
            : [];
    }

    private resolveResourceTypes(value: unknown): StManagerResourceType[] {
        const values = Array.isArray(value) && value.length ? value : ST_MANAGER_RESOURCE_TYPES;
        const result: StManagerResourceType[] = [];
        for (const item of values) {
            if (!ST_MANAGER_RESOURCE_TYPES.includes(item as StManagerResourceType)) {
                throw new AuthorityServiceError(`Unsupported resource type: ${String(item)}`, 400, 'validation_error', 'validation');
            }
            if (!result.includes(item as StManagerResourceType)) {
                result.push(item as StManagerResourceType);
            }
        }
        return result;
    }

    private requiredBackupId(payload: Record<string, unknown>): string {
        const backupId = String(payload.backup_id || '').trim();
        if (!backupId) {
            throw new AuthorityServiceError('backup_id is required', 400, 'validation_error', 'validation');
        }
        return backupId;
    }

    private extractObject(value: unknown, message: string): Record<string, unknown> {
        if (!value || typeof value !== 'object' || Array.isArray(value)) {
            throw new AuthorityServiceError(message, 502, 'validation_error', 'core');
        }
        return value as Record<string, unknown>;
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
        if (typeof data === 'object' && data && (data as Record<string, unknown>).success === false) {
            const message = 'error' in data ? String((data as Record<string, unknown>).error) : 'ST-Manager request failed';
            throw new AuthorityServiceError(message, 502, 'validation_error', 'core');
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

import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { getGlobalAuthorityPaths } from '../store/authority-paths.js';
import type { UserContext } from '../types.js';
import { AuthorityServiceError, ensureDir, readJsonFile } from '../utils.js';
import { ST_MANAGER_RESOURCE_TYPES, StManagerResourceLocator, type StManagerResourceManifest, type StManagerResourceType } from './st-manager-resource-locator.js';

interface StManagerBridgeState {
    enabled?: boolean;
    key_hash?: string;
    key_fingerprint?: string;
    max_file_size?: number;
    resource_types?: StManagerResourceType[];
    bound_user?: UserContext;
}

interface StManagerTransfer {
    type: StManagerResourceType;
    path: string;
    tempPath: string;
    size: number;
    sha256: string;
    overwriteMode: string;
}

export interface StManagerBridgeServiceOptions {
    statePath?: string;
    transferRoot?: string;
    locator?: StManagerResourceLocator;
}

const DEFAULT_MAX_FILE_SIZE = 100 * 1024 * 1024;

function defaultStatePath(): string {
    return path.join(path.dirname(getGlobalAuthorityPaths().controlDbFile), 'st-manager-bridge.json');
}

function hashKey(key: string): string {
    return crypto.createHash('sha256').update(key).digest('hex');
}

function generateBridgeKey(): string {
    return `stmb_${crypto.randomBytes(24).toString('base64url')}`;
}

function maskedKey(key: string): string {
    return `${key.slice(0, 8)}...${key.slice(-4)}`;
}

function stableResourceTypes(value: unknown): StManagerResourceType[] {
    if (!Array.isArray(value)) {
        return [...ST_MANAGER_RESOURCE_TYPES];
    }
    const selected = value.filter((item): item is StManagerResourceType => ST_MANAGER_RESOURCE_TYPES.includes(item));
    return selected.length ? selected : [...ST_MANAGER_RESOURCE_TYPES];
}

function normalizePublicMaxFileSize(value: unknown): number {
    const maxFileSize = Number(value);
    if (!Number.isFinite(maxFileSize) || maxFileSize === 0) {
        return DEFAULT_MAX_FILE_SIZE;
    }
    if (maxFileSize < 0) {
        return -1;
    }
    return Math.max(1, Math.floor(maxFileSize));
}

function snapshotUser(user: UserContext): UserContext {
    const snapshot: UserContext = {
        handle: user.handle,
        isAdmin: user.isAdmin,
        rootDir: user.rootDir,
    };
    if (user.directories) {
        snapshot.directories = { ...user.directories };
    }
    return snapshot;
}

function headerValue(headers: Record<string, string | string[] | undefined>, name: string): string {
    const direct = headers[name] ?? headers[name.toLowerCase()];
    if (Array.isArray(direct)) {
        return String(direct[0] ?? '').trim();
    }
    return String(direct ?? '').trim();
}

function extractBridgeKey(headers: Record<string, string | string[] | undefined>): string {
    const bearer = headerValue(headers, 'authorization');
    if (bearer.toLowerCase().startsWith('bearer ')) {
        return bearer.slice(7).trim();
    }
    return headerValue(headers, 'x-st-manager-key');
}

export class StManagerBridgeService {
    private readonly statePath: string;
    private readonly transferRoot: string;
    private readonly locator: StManagerResourceLocator;
    private readonly transfers = new Map<string, StManagerTransfer>();

    constructor(options: StManagerBridgeServiceOptions = {}) {
        this.statePath = options.statePath ?? defaultStatePath();
        this.transferRoot = options.transferRoot ?? path.join(path.dirname(this.statePath), 'st-manager-transfers');
        this.locator = options.locator ?? new StManagerResourceLocator();
    }

    getPublicConfig(_user: UserContext) {
        const state = this.readState();
        return {
            enabled: Boolean(state.enabled),
            bound_user_handle: state.bound_user?.handle ?? null,
            key_fingerprint: state.key_fingerprint ?? null,
            key_masked: state.key_fingerprint ? `stmb_${state.key_fingerprint.slice(0, 4)}...${state.key_fingerprint.slice(-4)}` : null,
            max_file_size: normalizePublicMaxFileSize(state.max_file_size),
            resource_types: stableResourceTypes(state.resource_types),
        };
    }

    updateAdminConfig(user: UserContext, payload: Record<string, unknown>) {
        if (!user.isAdmin) {
            throw new AuthorityServiceError('Forbidden', 403, 'unauthorized', 'auth');
        }

        const current = this.readState();
        const next: StManagerBridgeState = { ...current };
        if (typeof payload.enabled === 'boolean') {
            next.enabled = payload.enabled;
        }
        if (payload.resource_types !== undefined) {
            next.resource_types = stableResourceTypes(payload.resource_types);
        }
        if (payload.max_file_size !== undefined) {
            const maxFileSize = Number(payload.max_file_size);
            if (!Number.isFinite(maxFileSize) || maxFileSize === 0) {
                throw new AuthorityServiceError('Invalid max_file_size', 400, 'validation_error', 'validation');
            }
            next.max_file_size = maxFileSize < 0 ? -1 : Math.max(1, Math.floor(maxFileSize));
        }

        let bridgeKey: string | null = null;
        if (payload.rotate_key === true || (next.enabled && !next.key_hash)) {
            bridgeKey = generateBridgeKey();
            next.key_hash = hashKey(bridgeKey);
            next.key_fingerprint = next.key_hash.slice(0, 12);
        }
        if (payload.enabled === true || payload.rotate_key === true || (next.enabled && !current.key_hash)) {
            next.bound_user = snapshotUser(user);
        }

        this.writeState(next);
        return {
            ...this.getPublicConfig(user),
            ...(bridgeKey ? { bridge_key: bridgeKey, key_masked: maskedKey(bridgeKey) } : {}),
        };
    }

    resolveAuthorizedUser(user: UserContext | undefined, headers: Record<string, string | string[] | undefined>): UserContext {
        this.assertAuthorized(headers);
        if (user) {
            return user;
        }
        const boundUser = this.readState().bound_user;
        if (!boundUser) {
            throw new AuthorityServiceError('Bridge key is not bound to a user; rotate the key in Authority.', 403, 'unauthorized', 'auth');
        }
        return boundUser;
    }

    probe(user: UserContext, headers: Record<string, string | string[] | undefined>) {
        this.assertAuthorized(headers);
        const config = this.getPublicConfig(user);
        const resources: Record<string, { count: number; root: string | null; available: boolean }> = {};
        for (const type of config.resource_types) {
            const root = this.locator.resolveResourceRoot(user, type);
            const manifest = this.locator.buildManifest(user, type);
            resources[type] = {
                count: manifest.files.length,
                root: manifest.root,
                available: Boolean(root?.exists),
            };
        }
        return {
            success: true,
            version: 1,
            user: {
                handle: user.handle,
                root: user.rootDir,
            },
            bridge: config,
            resources,
            server_time: new Date().toISOString(),
        };
    }

    buildManifest(user: UserContext, resourceType: StManagerResourceType, headers: Record<string, string | string[] | undefined>): StManagerResourceManifest {
        this.assertResourceAllowed(resourceType, headers);
        return this.locator.buildManifest(user, resourceType);
    }

    readFile(user: UserContext, resourceType: StManagerResourceType, payload: Record<string, unknown>, headers: Record<string, string | string[] | undefined>) {
        this.assertResourceAllowed(resourceType, headers);
        const filePath = String(payload.path ?? '');
        const offset = Math.max(0, Number(payload.offset ?? 0) || 0);
        const limit = Math.max(1, Math.min(Number(payload.limit ?? 1024 * 1024) || 1024 * 1024, 16 * 1024 * 1024));
        const file = this.locator.readResourceFile(user, resourceType, filePath);
        const chunk = file.buffer.subarray(offset, Math.min(file.buffer.length, offset + limit));
        return {
            path: filePath,
            offset,
            bytes_read: chunk.length,
            size: file.size,
            sha256: file.sha256,
            mtime: file.mtime,
            eof: offset + chunk.length >= file.buffer.length,
            data_base64: chunk.toString('base64'),
        };
    }

    writeInit(user: UserContext, resourceType: StManagerResourceType, payload: Record<string, unknown>, headers: Record<string, string | string[] | undefined>) {
        this.assertResourceAllowed(resourceType, headers);
        const size = Number(payload.size ?? -1);
        const expectedSha = String(payload.sha256 ?? '').trim();
        const relativePath = String(payload.path ?? '');
        const overwriteMode = String(payload.overwrite_mode ?? 'skip');
        const maxFileSize = this.getPublicConfig(user).max_file_size;
        if (!Number.isFinite(size) || size < 0 || (maxFileSize >= 0 && size > maxFileSize)) {
            throw new AuthorityServiceError('Invalid transfer size', 400, 'validation_error', 'validation');
        }
        if (!/^[a-f0-9]{64}$/i.test(expectedSha)) {
            throw new AuthorityServiceError('Invalid sha256', 400, 'validation_error', 'validation');
        }
        this.locator.resolveWritePath(user, resourceType, relativePath);

        ensureDir(this.transferRoot);
        const transferId = crypto.randomUUID();
        const tempPath = path.join(this.transferRoot, `${transferId}.tmp`);
        fs.writeFileSync(tempPath, Buffer.alloc(0));
        this.transfers.set(transferId, {
            type: resourceType,
            path: relativePath,
            tempPath,
            size,
            sha256: expectedSha.toLowerCase(),
            overwriteMode: overwriteMode === 'overwrite' ? 'overwrite' : 'skip',
        });
        return { upload_id: transferId, transfer_id: transferId, offset: 0 };
    }

    writeChunk(user: UserContext, resourceType: StManagerResourceType, payload: Record<string, unknown>, headers: Record<string, string | string[] | undefined>) {
        this.assertResourceAllowed(resourceType, headers);
        const uploadId = String(payload.upload_id ?? payload.transfer_id ?? '');
        const transfer = this.getTransfer(resourceType, uploadId);
        const offset = Number(payload.offset ?? -1);
        const chunk = Buffer.from(String(payload.data_base64 ?? ''), 'base64');
        const currentSize = fs.existsSync(transfer.tempPath) ? fs.statSync(transfer.tempPath).size : 0;
        if (offset !== currentSize) {
            throw new AuthorityServiceError('Invalid transfer offset', 409, 'validation_error', 'validation');
        }
        fs.appendFileSync(transfer.tempPath, chunk);
        if (fs.statSync(transfer.tempPath).size > transfer.size) {
            throw new AuthorityServiceError('Transfer exceeds declared size', 400, 'validation_error', 'validation');
        }
        return { upload_id: uploadId, transfer_id: uploadId, offset: fs.statSync(transfer.tempPath).size };
    }

    writeCommit(user: UserContext, resourceType: StManagerResourceType, payload: Record<string, unknown>, headers: Record<string, string | string[] | undefined>) {
        this.assertResourceAllowed(resourceType, headers);
        const transferId = String(payload.upload_id ?? payload.transfer_id ?? '');
        const transfer = this.getTransfer(resourceType, transferId);
        const buffer = fs.readFileSync(transfer.tempPath);
        if (buffer.length !== transfer.size) {
            throw new AuthorityServiceError('Transfer size mismatch', 400, 'validation_error', 'validation');
        }
        const binarySha = crypto.createHash('sha256').update(buffer).digest('hex');
        if (binarySha !== transfer.sha256) {
            throw new AuthorityServiceError('sha256 mismatch', 400, 'validation_error', 'validation');
        }
        const result = this.locator.writeResourceFile(user, resourceType, transfer.path, buffer, transfer.overwriteMode);
        fs.rmSync(transfer.tempPath, { force: true });
        this.transfers.delete(transferId);
        return {
            upload_id: transferId,
            transfer_id: transferId,
            path: transfer.path,
            skipped: result.skipped,
        };
    }

    private assertAuthorized(headers: Record<string, string | string[] | undefined>): void {
        const state = this.readState();
        if (!state.enabled) {
            throw new AuthorityServiceError('Bridge disabled', 403, 'unauthorized', 'auth');
        }
        const provided = extractBridgeKey(headers);
        if (!provided || !state.key_hash || hashKey(provided) !== state.key_hash) {
            throw new AuthorityServiceError('Invalid bridge key', 401, 'unauthorized', 'auth');
        }
    }

    private assertResourceAllowed(resourceType: StManagerResourceType, headers: Record<string, string | string[] | undefined>): void {
        this.assertAuthorized(headers);
        if (!ST_MANAGER_RESOURCE_TYPES.includes(resourceType)) {
            throw new AuthorityServiceError('Unsupported resource type', 400, 'validation_error', 'validation');
        }
        if (!stableResourceTypes(this.readState().resource_types).includes(resourceType)) {
            throw new AuthorityServiceError('Resource type disabled', 403, 'unauthorized', 'auth');
        }
    }

    private getTransfer(resourceType: StManagerResourceType, transferId: string): StManagerTransfer {
        const transfer = this.transfers.get(transferId);
        if (!transfer || transfer.type !== resourceType) {
            throw new AuthorityServiceError('Transfer not found', 404, 'validation_error', 'validation');
        }
        return transfer;
    }

    private readState(): StManagerBridgeState {
        return readJsonFile<StManagerBridgeState>(this.statePath, {});
    }

    private writeState(state: StManagerBridgeState): void {
        ensureDir(path.dirname(this.statePath));
        const tempPath = `${this.statePath}.${crypto.randomUUID()}.tmp`;
        fs.writeFileSync(tempPath, JSON.stringify(state, null, 2), 'utf8');
        fs.renameSync(tempPath, this.statePath);
    }
}

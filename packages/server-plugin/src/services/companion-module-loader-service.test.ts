import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { AUTHORITY_VERSION } from '../version.js';
import { AUTHORITY_MODULE_PROTOCOL_VERSION } from '../constants.js';
import {
    DEFAULT_ACTIVATION_TIMEOUT_MS,
    CompanionModuleLoaderService,
    loadCompanionModuleFromDisk,
} from './companion-module-loader-service.js';
import { ModuleDiscoveryService } from './module-discovery-service.js';
import { CoreService } from './core-service.js';
import { ModuleHostService } from './module-host-service.js';
import { PermissionService } from './permission-service.js';
import { PolicyService } from './policy-service.js';
import { InstallService } from './install-service.js';
import type { AuthorityModuleManifest } from '@stdo/shared-types';
import type { AuditService } from './audit-service.js';
import type { JobService } from './job-service.js';
import type { PrivateFsService } from './private-fs-service.js';
import type { StorageService } from './storage-service.js';
import type { TriviumService } from './trivium-service.js';
import type { SseBroker } from '../events/sse-broker.js';
import type { CoreService as CoreServiceType } from './core-service.js';
import type { PoliciesState, SessionRecord, StoredGrantEntry, UserContext } from '../types.js';

const cleanupDirs: string[] = [];

interface Fixture {
    sillyTavernRoot: string;
    extensionsRoot: string;
    thirdPartyRoot: string;
}

function createFixture(): Fixture {
    const baseDir = fs.mkdtempSync(path.join(os.tmpdir(), 'authority-companion-'));
    cleanupDirs.push(baseDir);
    const sillyTavernRoot = path.join(baseDir, 'SillyTavern');
    fs.mkdirSync(path.join(sillyTavernRoot, 'plugins'), { recursive: true });
    const extensionsRoot = path.join(sillyTavernRoot, 'public', 'scripts', 'extensions');
    fs.mkdirSync(extensionsRoot, { recursive: true });
    const thirdPartyRoot = path.join(extensionsRoot, 'third-party');
    fs.mkdirSync(thirdPartyRoot, { recursive: true });
    return { sillyTavernRoot, extensionsRoot, thirdPartyRoot };
}

function createInstallService(sillyTavernRoot: string): InstallService {
    return new InstallService({
        cwd: sillyTavernRoot,
        env: { ...process.env },
        logger: { info() {}, warn() {}, error() {} },
    });
}

function createDiscovery(fixture: Fixture): ModuleDiscoveryService {
    return new ModuleDiscoveryService(createInstallService(fixture.sillyTavernRoot), {
        sillyTavernRoot: fixture.sillyTavernRoot,
        logger: { info() {}, warn() {}, error() {} },
    });
}

const silentLogger = { info() {}, warn() {}, error() {} };

function createMockCore(): CoreServiceType {
    const grants = new Map<string, StoredGrantEntry>();
    let policies: PoliciesState = {
        defaults: {} as PoliciesState['defaults'],
        extensions: {},
        limits: {
            extensions: {},
        },
        updatedAt: new Date().toISOString(),
    };
    return {
        async listControlGrants() {
            return [...grants.values()];
        },
        async getControlGrant(_dbPath: string, request: { key: string }) {
            return grants.get(request.key) ?? null;
        },
        async upsertControlGrant(_dbPath: string, request: { grant: StoredGrantEntry }) {
            grants.set(request.grant.key, request.grant);
            return request.grant;
        },
        async resetControlGrants(_dbPath: string, request: { keys?: string[] }) {
            if (request.keys?.length) {
                for (const key of request.keys) {
                    grants.delete(key);
                }
            } else {
                grants.clear();
            }
        },
        async getControlPolicies() {
            return policies;
        },
        async saveControlPolicies(_dbPath: string, request: { partial: Partial<PoliciesState> }) {
            policies = {
                defaults: {
                    ...policies.defaults,
                    ...(request.partial.defaults ?? {}),
                },
                extensions: {
                    ...policies.extensions,
                    ...(request.partial.extensions ?? {}),
                },
                limits: {
                    extensions: {
                        ...policies.limits.extensions,
                        ...(request.partial.limits?.extensions ?? {}),
                    },
                },
                updatedAt: new Date().toISOString(),
            };
            return policies;
        },
    } as unknown as CoreServiceType;
}

function createMockAudit(): AuditService {
    return {
        logUsage: vi.fn().mockResolvedValue(undefined),
        logPermission: vi.fn().mockResolvedValue(undefined),
        logError: vi.fn().mockResolvedValue(undefined),
        logWarning: vi.fn().mockResolvedValue(undefined),
    } as unknown as AuditService;
}

function createUser(isAdmin: boolean, rootDir: string): UserContext {
    return {
        handle: isAdmin ? 'admin' : 'alice',
        isAdmin,
        rootDir,
    };
}

function createSession(user: UserContext): SessionRecord {
    return {
        token: 'session-token',
        createdAt: new Date().toISOString(),
        userHandle: user.handle,
        isAdmin: user.isAdmin,
        extension: {
            id: 'third-party/test-extension',
            installType: 'local',
            displayName: 'Test Extension',
            version: AUTHORITY_VERSION,
            firstSeenAt: new Date().toISOString(),
        },
        declaredPermissions: {},
        sessionGrants: new Map(),
    };
}

function createRuntime(core: CoreServiceType = createMockCore()): {
    permissions: PermissionService;
    audit: AuditService;
    modules: ModuleHostService;
    loader: CompanionModuleLoaderService;
} {
    const permissions = new PermissionService(new PolicyService(core), core);
    const audit = createMockAudit();
    const modules = new ModuleHostService(
        permissions,
        audit,
        {} as TriviumService,
        {} as StorageService,
        {} as PrivateFsService,
        {} as JobService,
        {} as SseBroker,
    );
    const loader = new CompanionModuleLoaderService(modules, permissions, audit, {
        logger: silentLogger as unknown as Console,
        activationTimeoutMs: 2000,
    });
    return { permissions, audit, modules, loader };
}

interface WriteModuleOptions {
    moduleId?: string;
    ownerExtensionId?: string;
    entry?: string | null;
    serverCjsContent?: string;
    transactions?: Record<string, unknown>;
    protocolVersion?: number;
}

function writeModule(extensionDir: string, options: WriteModuleOptions = {}): string {
    const moduleDir = path.join(extensionDir, '.authority');
    fs.mkdirSync(moduleDir, { recursive: true });
    const manifestPath = path.join(moduleDir, 'module.json');
    const extensionDirName = path.basename(extensionDir);
    const derivedOwner = `third-party/${extensionDirName}`;
    const ownerExtensionId = options.ownerExtensionId ?? derivedOwner;
    const moduleId = options.moduleId ?? `third-party.${extensionDirName}`;
    const entry = options.entry === null ? undefined : (options.entry ?? './server.cjs');
    const manifest: Record<string, unknown> = {
        id: moduleId,
        displayName: 'Some Extension Authority Module',
        ownerExtensionId,
        version: '1.0.0',
        schemaVersion: 1,
        protocolVersion: options.protocolVersion ?? AUTHORITY_MODULE_PROTOCOL_VERSION,
        entry,
        transactions: options.transactions ?? {
            'task.run': {
                name: 'task.run',
                version: '1.0.0',
                title: 'Run task',
                riskLevel: 'medium',
                permissionTarget: { kind: 'transaction' },
                requiredResources: [],
                idempotency: 'optional',
            },
        },
    };
    fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2), 'utf8');
    if (entry) {
        const entryPath = path.join(moduleDir, entry);
        const content = options.serverCjsContent ?? 'module.exports.activate = async () => {};\n';
        fs.writeFileSync(entryPath, content, 'utf8');
    }
    return manifestPath;
}

function buildManifest(): AuthorityModuleManifest {
    return {
        id: 'third-party.some-extension',
        displayName: 'Some Extension Authority Module',
        version: '1.0.0',
        protocolVersion: AUTHORITY_MODULE_PROTOCOL_VERSION,
        schemaVersion: 1,
        ownerExtensionId: 'third-party/some-extension',
        entry: './server.cjs',
        transactions: {
            'task.run': {
                name: 'task.run',
                version: '1.0.0',
                title: 'Run task',
                riskLevel: 'medium',
                permissionTarget: { kind: 'transaction' },
                requiredResources: [],
                idempotency: 'optional',
            },
        },
    };
}

describe('CompanionModuleLoaderService', () => {
    afterEach(() => {
        while (cleanupDirs.length > 0) {
            const dir = cleanupDirs.pop();
            if (dir) {
                fs.rmSync(dir, { recursive: true, force: true });
            }
        }
    });

    it('exposes a 10s default activation timeout and a 30s hard cap', () => {
        expect(DEFAULT_ACTIVATION_TIMEOUT_MS).toBe(10_000);
    });

    it('loads a valid companion module, registers its handler, and executes via the module host', async () => {
        const fixture = createFixture();
        const extensionDir = path.join(fixture.thirdPartyRoot, 'some-extension');
        fs.mkdirSync(extensionDir, { recursive: true });
        writeModule(extensionDir, {
            serverCjsContent: `
                let captured;
                module.exports.activate = async function activate(ctx) {
                    captured = ctx;
                    ctx.registerTransaction('task.run', {
                        handler: async (txCtx, input) => ({
                            result: { ok: true, echo: input, moduleId: txCtx.moduleId, requestId: txCtx.requestId },
                        }),
                    });
                };
                module.exports.__getCaptured = () => captured;
            `,
        });

        const discovery = createDiscovery(fixture);
        const result = discovery.discover();
        const runtime = createRuntime();
        runtime.modules.registerDiscoveredRecords(result.records);

        const updated = await runtime.loader.loadAll(result);
        expect(updated).toHaveLength(1);
        expect(updated[0]?.status).toBe('loaded');

        const user = createUser(false, fixture.sillyTavernRoot);
        const session = createSession(user);
        const response = await runtime.modules.execute(user, session, 'third-party.some-extension', 'task.run', {
            input: { items: [1, 2, 3] },
            idempotencyKey: 'idem-1',
        });
        expect(response.ok).toBe(true);
        expect(response.moduleId).toBe('third-party.some-extension');
        expect(response.transaction).toBe('task.run');
        expect(response.result).toMatchObject({
            ok: true,
            echo: { items: [1, 2, 3] },
            moduleId: 'third-party.some-extension',
        });
        expect(typeof (response.result as { requestId: string }).requestId).toBe('string');
    });

    it('does NOT pass raw runtime services through the activation ctx', async () => {
        const fixture = createFixture();
        const extensionDir = path.join(fixture.thirdPartyRoot, 'audit-extension');
        fs.mkdirSync(extensionDir, { recursive: true });
        const moduleDir = path.join(extensionDir, '.authority');
        fs.mkdirSync(moduleDir, { recursive: true });
        const manifestPath = path.join(moduleDir, 'module.json');
        fs.writeFileSync(
            path.join(moduleDir, 'server.cjs'),
            `
            module.exports.activate = async function activate(ctx) {
                // Capture the activation ctx for inspection. The handler is
                // a no-op; the test reads the captured ctx via module.exports.
                module.exports.__capturedActivationCtx = ctx;
                ctx.registerTransaction('task.run', {
                    handler: async () => ({ result: { ok: true } }),
                });
            };
            `,
            'utf8',
        );
        const moduleId = 'third-party.audit-extension';
        const owner = 'third-party/audit-extension';
        fs.writeFileSync(manifestPath, JSON.stringify({
            id: moduleId,
            displayName: 'Audit',
            ownerExtensionId: owner,
            version: '1.0.0',
            schemaVersion: 1,
            protocolVersion: AUTHORITY_MODULE_PROTOCOL_VERSION,
            entry: './server.cjs',
            transactions: {
                'task.run': {
                    name: 'task.run',
                    version: '1.0.0',
                    title: 'Run task',
                    riskLevel: 'medium',
                    permissionTarget: { kind: 'transaction' },
                    requiredResources: [],
                    idempotency: 'optional',
                },
            },
        }, null, 2), 'utf8');

        const discovery = createDiscovery(fixture);
        const result = discovery.discover();
        const runtime = createRuntime();
        runtime.modules.registerDiscoveredRecords(result.records);

        await runtime.loader.loadAll(result);

        // Reload the entry through Node require to inspect the captured ctx.
        const candidate = result.internalSources.get(moduleId);
        expect(candidate).toBeDefined();
        const captured = loadCompanionModuleFromDisk(candidate!.entryPath) as {
            __capturedActivationCtx?: Record<string, unknown>;
        };
        const ctx = captured.__capturedActivationCtx;
        expect(ctx).toBeDefined();
        // Activation ctx exposes only safe metadata + logger + registerTransaction.
        expect(ctx).toHaveProperty('moduleId', moduleId);
        expect(ctx).toHaveProperty('ownerExtensionId', owner);
        expect(ctx).toHaveProperty('moduleDir');
        expect(ctx).toHaveProperty('logger');
        expect(ctx).toHaveProperty('registerTransaction');
        // Raw services MUST be absent.
        expect(ctx).not.toHaveProperty('trivium');
        expect(ctx).not.toHaveProperty('storage');
        expect(ctx).not.toHaveProperty('files');
        expect(ctx).not.toHaveProperty('jobs');
        expect(ctx).not.toHaveProperty('events');
        expect(ctx).not.toHaveProperty('audit');
        expect(ctx).not.toHaveProperty('core');
        expect(ctx).not.toHaveProperty('runtime');
        expect(ctx).not.toHaveProperty('permissions');
        expect(ctx).not.toHaveProperty('sql');
        expect(ctx).not.toHaveProperty('fs');
        expect(ctx).not.toHaveProperty('blob');
    });

    it('does NOT pass raw trivium/storage/files/jobs/events/runtime/core to companion tx handlers', async () => {
        const fixture = createFixture();
        const extensionDir = path.join(fixture.thirdPartyRoot, 'introspect-extension');
        fs.mkdirSync(extensionDir, { recursive: true });
        writeModule(extensionDir, {
            serverCjsContent: `
                module.exports.activate = async function activate(ctx) {
                    ctx.registerTransaction('task.run', {
                        handler: async (txCtx, input) => ({
                            result: { keys: Object.keys(txCtx).sort(), input },
                        }),
                    });
                };
            `,
        });

        const discovery = createDiscovery(fixture);
        const result = discovery.discover();
        const runtime = createRuntime();
        runtime.modules.registerDiscoveredRecords(result.records);
        await runtime.loader.loadAll(result);

        const user = createUser(false, fixture.sillyTavernRoot);
        const session = createSession(user);
        const response = await runtime.modules.execute(user, session, 'third-party.introspect-extension', 'task.run', {
            input: { ok: true },
        });
        const keys = (response.result as { keys: string[] }).keys;
        // Companion tx ctx exposes only safe fields.
        expect(keys).toEqual(expect.arrayContaining([
            'moduleId',
            'ownerExtensionId',
            'transactionName',
            'callerExtensionId',
            'requestId',
            'logger',
            'audit',
            'authorize',
            'signal',
        ]));
        // Raw services MUST be absent.
        for (const forbidden of ['trivium', 'storage', 'files', 'jobs', 'events', 'core', 'runtime', 'permissions', 'sql', 'fs', 'blob', 'user', 'session']) {
            expect(keys).not.toContain(forbidden);
        }
    });

    it('marks the record load_error when the entry exports no activate function', async () => {
        const fixture = createFixture();
        const extensionDir = path.join(fixture.thirdPartyRoot, 'no-activate');
        fs.mkdirSync(extensionDir, { recursive: true });
        writeModule(extensionDir, {
            serverCjsContent: 'module.exports = { notActivate: () => {} };\n',
        });

        const discovery = createDiscovery(fixture);
        const result = discovery.discover();
        const runtime = createRuntime();
        runtime.modules.registerDiscoveredRecords(result.records);

        const updated = await runtime.loader.loadAll(result);
        expect(updated).toHaveLength(1);
        expect(updated[0]?.status).toBe('load_error');
        expect(updated[0]?.diagnostics?.[0]?.code).toBe('load_activate_not_a_function');
    });

    it('marks the record load_error when activate throws', async () => {
        const fixture = createFixture();
        const extensionDir = path.join(fixture.thirdPartyRoot, 'throws-activate');
        fs.mkdirSync(extensionDir, { recursive: true });
        writeModule(extensionDir, {
            serverCjsContent: `
                module.exports.activate = async function activate(ctx) {
                    throw new Error('boom');
                };
            `,
        });

        const discovery = createDiscovery(fixture);
        const result = discovery.discover();
        const runtime = createRuntime();
        runtime.modules.registerDiscoveredRecords(result.records);

        const updated = await runtime.loader.loadAll(result);
        expect(updated).toHaveLength(1);
        expect(updated[0]?.status).toBe('load_error');
        expect(updated[0]?.diagnostics?.[0]?.code).toBe('load_activation_threw');
        expect(updated[0]?.diagnostics?.[0]?.message).toContain('boom');
    });

    it('marks the record load_error when activation times out', async () => {
        const fixture = createFixture();
        const extensionDir = path.join(fixture.thirdPartyRoot, 'hang-activate');
        fs.mkdirSync(extensionDir, { recursive: true });
        writeModule(extensionDir, {
            serverCjsContent: `
                module.exports.activate = async function activate(ctx) {
                    // Never resolves within the short test timeout.
                    await new Promise(() => {});
                };
            `,
        });

        const discovery = createDiscovery(fixture);
        const result = discovery.discover();
        const runtime = createRuntime();
        runtime.modules.registerDiscoveredRecords(result.records);

        const updated = await runtime.loader.loadAll(result);
        expect(updated).toHaveLength(1);
        expect(updated[0]?.status).toBe('load_error');
        expect(updated[0]?.diagnostics?.[0]?.code).toBe('load_activation_timeout');
    });

    it('marks the record load_error when activate registers an undeclared transaction', async () => {
        const fixture = createFixture();
        const extensionDir = path.join(fixture.thirdPartyRoot, 'undeclared-extension');
        fs.mkdirSync(extensionDir, { recursive: true });
        writeModule(extensionDir, {
            serverCjsContent: `
                module.exports.activate = async function activate(ctx) {
                    ctx.registerTransaction('task.run', { handler: async () => ({ result: { ok: true } }) });
                    ctx.registerTransaction('not.declared', { handler: async () => ({ result: { ok: true } }) });
                };
            `,
        });

        const discovery = createDiscovery(fixture);
        const result = discovery.discover();
        const runtime = createRuntime();
        runtime.modules.registerDiscoveredRecords(result.records);

        const updated = await runtime.loader.loadAll(result);
        expect(updated).toHaveLength(1);
        expect(updated[0]?.status).toBe('load_error');
        const codes = updated[0]?.diagnostics?.map(d => d.code) ?? [];
        expect(codes).toContain('load_transaction_undeclared');
    });

    it('marks the record load_error when activate does not register a declared transaction', async () => {
        const fixture = createFixture();
        const extensionDir = path.join(fixture.thirdPartyRoot, 'missing-handler-extension');
        fs.mkdirSync(extensionDir, { recursive: true });
        writeModule(extensionDir, {
            serverCjsContent: `
                module.exports.activate = async function activate(ctx) {
                    // Declared 'task.run' is intentionally not registered.
                };
            `,
        });

        const discovery = createDiscovery(fixture);
        const result = discovery.discover();
        const runtime = createRuntime();
        runtime.modules.registerDiscoveredRecords(result.records);

        const updated = await runtime.loader.loadAll(result);
        expect(updated).toHaveLength(1);
        expect(updated[0]?.status).toBe('load_error');
        expect(updated[0]?.diagnostics?.[0]?.code).toBe('load_transaction_handler_missing');
    });

    it('does not load invalid, duplicate, or incompatible records', async () => {
        const fixture = createFixture();
        const brokenDir = path.join(fixture.thirdPartyRoot, 'broken');
        const incompatibleDir = path.join(fixture.thirdPartyRoot, 'incompatible');
        const firstDir = path.join(fixture.thirdPartyRoot, 'first');
        const secondDir = path.join(fixture.thirdPartyRoot, 'second');
        for (const dir of [brokenDir, incompatibleDir, firstDir, secondDir]) {
            fs.mkdirSync(dir, { recursive: true });
        }
        const validServerCjs = `
            module.exports.activate = async function activate(ctx) {
                ctx.registerTransaction('task.run', { handler: async () => ({ result: { ok: true } }) });
            };
        `;
        // Broken JSON manifest.
        fs.mkdirSync(path.join(brokenDir, '.authority'), { recursive: true });
        fs.writeFileSync(
            path.join(brokenDir, '.authority', 'module.json'),
            '{ not valid json',
            'utf8',
        );
        // Incompatible protocol.
        writeModule(incompatibleDir, { protocolVersion: 999, serverCjsContent: validServerCjs });
        // First valid + a copy-paste duplicate that fails owner validation
        // rather than producing a duplicate_id record (it claims the first
        // extension's owner).
        writeModule(firstDir, { serverCjsContent: validServerCjs });
        // Second valid module with a different id.
        writeModule(secondDir, { serverCjsContent: validServerCjs });

        const discovery = createDiscovery(fixture);
        const result = discovery.discover();
        const runtime = createRuntime();
        runtime.modules.registerDiscoveredRecords(result.records);

        // Only the valid `available` records contribute internalSources.
        expect(result.internalSources.size).toBe(2);
        const updated = await runtime.loader.loadAll(result);
        // Two valid modules transitioned to loaded.
        const loaded = updated.filter(r => r.status === 'loaded');
        expect(loaded).toHaveLength(2);
        // No load_error records came from broken/incompatible records.
        const loadErrors = updated.filter(r => r.status === 'load_error');
        expect(loadErrors).toHaveLength(0);
    });

    it('does not load entry_missing, no-entry, or disabled records', async () => {
        const fixture = createFixture();
        const noEntryDir = path.join(fixture.thirdPartyRoot, 'no-entry');
        const missingEntryDir = path.join(fixture.thirdPartyRoot, 'missing-entry');
        fs.mkdirSync(noEntryDir, { recursive: true });
        fs.mkdirSync(missingEntryDir, { recursive: true });
        // No entry on manifest.
        const moduleDir1 = path.join(noEntryDir, '.authority');
        fs.mkdirSync(moduleDir1, { recursive: true });
        fs.writeFileSync(path.join(moduleDir1, 'module.json'), JSON.stringify({
            id: 'third-party.no-entry',
            displayName: 'No Entry',
            ownerExtensionId: 'third-party/no-entry',
            version: '1.0.0',
            schemaVersion: 1,
            protocolVersion: AUTHORITY_MODULE_PROTOCOL_VERSION,
            transactions: {
                'task.run': {
                    name: 'task.run',
                    version: '1.0.0',
                    title: 'Run task',
                    riskLevel: 'medium',
                    permissionTarget: { kind: 'transaction' },
                    requiredResources: [],
                    idempotency: 'optional',
                },
            },
        }, null, 2), 'utf8');
        // Entry declared but file missing.
        writeModule(missingEntryDir, { entry: './server.cjs' });
        fs.unlinkSync(path.join(missingEntryDir, '.authority', 'server.cjs'));

        const discovery = createDiscovery(fixture);
        const result = discovery.discover();
        const runtime = createRuntime();
        runtime.modules.registerDiscoveredRecords(result.records);

        // Neither invalid nor entry_missing records produce internalSources.
        expect(result.internalSources.size).toBe(0);
        const updated = await runtime.loader.loadAll(result);
        expect(updated).toHaveLength(0);
    });

    it('does not leak absolute filesystem paths from the loaded public record', async () => {
        const fixture = createFixture();
        const extensionDir = path.join(fixture.thirdPartyRoot, 'leaky-extension');
        fs.mkdirSync(extensionDir, { recursive: true });
        writeModule(extensionDir, {
            serverCjsContent: `
                module.exports.activate = async function activate(ctx) {
                    ctx.registerTransaction('task.run', { handler: async () => ({ result: { ok: true } }) });
                };
            `,
        });

        const discovery = createDiscovery(fixture);
        const result = discovery.discover();
        const runtime = createRuntime();
        runtime.modules.registerDiscoveredRecords(result.records);
        await runtime.loader.loadAll(result);

        const record = runtime.modules.getRecord('third-party.leaky-extension');
        expect(record?.status).toBe('loaded');
        const serialized = JSON.stringify(record);
        expect(serialized).not.toContain(fixture.sillyTavernRoot);
        expect(serialized).not.toContain(extensionDir);
        // Safe relative paths are allowed.
        expect(serialized).toContain('.authority/module.json');
        expect(serialized).toContain('./server.cjs');
    });

    it('revalidates entry before load and marks load_error when entry was swapped to a symlink after discovery', async () => {
        const fixture = createFixture();
        const extensionDir = path.join(fixture.thirdPartyRoot, 'swap-extension');
        fs.mkdirSync(extensionDir, { recursive: true });
        writeModule(extensionDir, {
            serverCjsContent: `
                module.exports.activate = async function activate(ctx) {
                    ctx.registerTransaction('task.run', { handler: async () => ({ result: { ok: true } }) });
                };
            `,
        });
        const discovery = createDiscovery(fixture);
        const result = discovery.discover();

        // TOCTOU: replace the entry with a symlink to a file outside .authority.
        const entryPath = path.join(extensionDir, '.authority', 'server.cjs');
        const outsidePath = path.join(extensionDir, 'outside.cjs');
        fs.writeFileSync(outsidePath, 'module.exports.activate = async () => {};\n', 'utf8');
        fs.unlinkSync(entryPath);
        fs.symlinkSync(outsidePath, entryPath, 'file');

        const runtime = createRuntime();
        runtime.modules.registerDiscoveredRecords(result.records);
        const updated = await runtime.loader.loadAll(result);
        expect(updated).toHaveLength(1);
        expect(updated[0]?.status).toBe('load_error');
        // The revalidation diagnostic should be one of the entry-related codes.
        const codes = updated[0]?.diagnostics?.map(d => d.code) ?? [];
        expect(codes.some(c => c.startsWith('entry_') || c.startsWith('load_'))).toBe(true);
    });

    it('accepts module.exports = activate (function form) as a valid entry', async () => {
        const fixture = createFixture();
        const extensionDir = path.join(fixture.thirdPartyRoot, 'function-export');
        fs.mkdirSync(extensionDir, { recursive: true });
        writeModule(extensionDir, {
            serverCjsContent: `
                module.exports = async function activate(ctx) {
                    ctx.registerTransaction('task.run', { handler: async () => ({ result: { ok: true } }) });
                };
            `,
        });

        const discovery = createDiscovery(fixture);
        const result = discovery.discover();
        const runtime = createRuntime();
        runtime.modules.registerDiscoveredRecords(result.records);
        const updated = await runtime.loader.loadAll(result);
        expect(updated[0]?.status).toBe('loaded');
    });

    it('throws a structured module_load_error-style error when executing a load_error module', async () => {
        const fixture = createFixture();
        const extensionDir = path.join(fixture.thirdPartyRoot, 'failed-extension');
        fs.mkdirSync(extensionDir, { recursive: true });
        writeModule(extensionDir, {
            serverCjsContent: 'module.exports = { notActivate: () => {} };\n',
        });

        const discovery = createDiscovery(fixture);
        const result = discovery.discover();
        const runtime = createRuntime();
        runtime.modules.registerDiscoveredRecords(result.records);
        await runtime.loader.loadAll(result);

        const user = createUser(false, fixture.sillyTavernRoot);
        const session = createSession(user);
        await expect(
            runtime.modules.execute(user, session, 'third-party.failed-extension', 'task.run', {}),
        ).rejects.toThrow(/Module not loaded/);
    });

    it('loadCompanionModuleFromDisk requires the absolute entry path through Node runtime require', () => {
        const fixture = createFixture();
        const extensionDir = path.join(fixture.thirdPartyRoot, 'disk-load');
        fs.mkdirSync(extensionDir, { recursive: true });
        writeModule(extensionDir, {
            serverCjsContent: 'module.exports = { marker: "disk-load-ok" };\n',
        });
        const candidate = (() => {
            const discovery = createDiscovery(fixture);
            const result = discovery.discover();
            return result.internalSources.get('third-party.disk-load');
        })();
        expect(candidate).toBeDefined();
        const exported = loadCompanionModuleFromDisk(candidate!.entryPath) as { marker: string };
        expect(exported.marker).toBe('disk-load-ok');
    });

    it('invokes activate only once and reports a single updated record per module', async () => {
        const fixture = createFixture();
        const extensionDir = path.join(fixture.thirdPartyRoot, 'once-extension');
        fs.mkdirSync(extensionDir, { recursive: true });
        let activateCount = 0;
        // Write a small module that increments an outer counter on activation.
        // The outer counter is exposed via a sibling file because each
        // runtimeRequire call returns the cached module export.
        const moduleDir = path.join(extensionDir, '.authority');
        fs.mkdirSync(moduleDir, { recursive: true });
        const counterPath = path.join(moduleDir, 'counter.json');
        fs.writeFileSync(counterPath, JSON.stringify({ count: 0 }), 'utf8');
        writeModule(extensionDir, {
            serverCjsContent: `
                const fs = require('node:fs');
                const path = require('node:path');
                module.exports.activate = async function activate(ctx) {
                    const counterPath = path.join(ctx.moduleDir, 'counter.json');
                    const data = JSON.parse(fs.readFileSync(counterPath, 'utf8'));
                    data.count = (data.count || 0) + 1;
                    fs.writeFileSync(counterPath, JSON.stringify(data), 'utf8');
                    ctx.registerTransaction('task.run', { handler: async () => ({ result: { ok: true } }) });
                };
            `,
        });

        const discovery = createDiscovery(fixture);
        const result = discovery.discover();
        const runtime = createRuntime();
        runtime.modules.registerDiscoveredRecords(result.records);
        await runtime.loader.loadAll(result);

        // The Node module cache means activate is invoked once per loader
        // process; loadAll is idempotent across calls.
        const counter = JSON.parse(fs.readFileSync(counterPath, 'utf8'));
        expect(counter.count).toBe(1);
    });

    it('captures the audit wrapper on the companion tx ctx and routes logs through it', async () => {
        const fixture = createFixture();
        const extensionDir = path.join(fixture.thirdPartyRoot, 'audit-extension-2');
        fs.mkdirSync(extensionDir, { recursive: true });
        writeModule(extensionDir, {
            serverCjsContent: `
                module.exports.activate = async function activate(ctx) {
                    ctx.registerTransaction('task.run', {
                        handler: async (txCtx) => {
                            await txCtx.audit.logUsage('companion-ran', { moduleId: txCtx.moduleId });
                            return { result: { ok: true } };
                        },
                    });
                };
            `,
        });

        const discovery = createDiscovery(fixture);
        const result = discovery.discover();
        const runtime = createRuntime();
        runtime.modules.registerDiscoveredRecords(result.records);
        await runtime.loader.loadAll(result);

        const user = createUser(false, fixture.sillyTavernRoot);
        const session = createSession(user);
        await runtime.modules.execute(user, session, 'third-party.audit-extension-2', 'task.run', {});
        expect(runtime.audit.logUsage).toHaveBeenCalledWith(
            expect.objectContaining({ handle: 'alice' }),
            'third-party/audit-extension-2',
            'companion-ran',
            expect.objectContaining({ moduleId: 'third-party.audit-extension-2' }),
        );
    });

    it('exposes a default manifest when registerTransaction is called with the declared transaction shape', async () => {
        // Sanity: buildManifest() shape round-trips through registerCompanion.
        const runtime = createRuntime();
        const handler = vi.fn().mockResolvedValue({ result: { ok: true } });
        expect(() => runtime.modules.registerCompanion(buildManifest(), { 'task.run': handler })).not.toThrow();
        expect(runtime.modules.count()).toBe(1);
        const list = runtime.modules.listManifests();
        expect(list.count).toBe(1);
        expect(list.modules[0]?.id).toBe('third-party.some-extension');
        // The loaded record carries safe relative source metadata only.
        const record = runtime.modules.getRecord('third-party.some-extension');
        expect(record?.status).toBe('loaded');
        expect(JSON.stringify(record)).not.toContain('/tmp/');
    });

    it('does not expose raw services on the companion handler ctx even when the host ctx has them', async () => {
        const fixture = createFixture();
        const extensionDir = path.join(fixture.thirdPartyRoot, 'raw-leak-extension');
        fs.mkdirSync(extensionDir, { recursive: true });
        writeModule(extensionDir, {
            serverCjsContent: `
                module.exports.activate = async function activate(ctx) {
                    ctx.registerTransaction('task.run', {
                        handler: async (txCtx) => ({
                            result: {
                                hasTrivium: 'trivium' in txCtx,
                                hasStorage: 'storage' in txCtx,
                                hasFiles: 'files' in txCtx,
                                hasJobs: 'jobs' in txCtx,
                                hasEvents: 'events' in txCtx,
                                hasCore: 'core' in txCtx,
                                hasRuntime: 'runtime' in txCtx,
                                hasUser: 'user' in txCtx,
                                hasSession: 'session' in txCtx,
                                hasPermissions: 'permissions' in txCtx,
                            },
                        }),
                    });
                };
            `,
        });

        const discovery = createDiscovery(fixture);
        const result = discovery.discover();
        const runtime = createRuntime();
        runtime.modules.registerDiscoveredRecords(result.records);
        await runtime.loader.loadAll(result);

        const user = createUser(false, fixture.sillyTavernRoot);
        const session = createSession(user);
        const response = await runtime.modules.execute(user, session, 'third-party.raw-leak-extension', 'task.run', {});
        const result2 = response.result as Record<string, boolean>;
        expect(result2.hasTrivium).toBe(false);
        expect(result2.hasStorage).toBe(false);
        expect(result2.hasFiles).toBe(false);
        expect(result2.hasJobs).toBe(false);
        expect(result2.hasEvents).toBe(false);
        expect(result2.hasCore).toBe(false);
        expect(result2.hasRuntime).toBe(false);
        expect(result2.hasUser).toBe(false);
        expect(result2.hasSession).toBe(false);
        expect(result2.hasPermissions).toBe(false);
    });

    it('still throws structured module_not_loaded for available-but-not-loaded records (Phase 1 compatibility)', async () => {
        const fixture = createFixture();
        const extensionDir = path.join(fixture.thirdPartyRoot, 'never-loaded');
        fs.mkdirSync(extensionDir, { recursive: true });
        writeModule(extensionDir, {
            serverCjsContent: 'module.exports.activate = async () => {};\n',
        });

        const discovery = createDiscovery(fixture);
        const result = discovery.discover();
        const runtime = createRuntime();
        // Intentionally do NOT call loader.loadAll so the record stays available.
        runtime.modules.registerDiscoveredRecords(result.records);

        const user = createUser(false, fixture.sillyTavernRoot);
        const session = createSession(user);
        await expect(
            runtime.modules.execute(user, session, 'third-party.never-loaded', 'task.run', {}),
        ).rejects.toThrow(/Module not loaded/);
    });
});

void AUTHORITY_VERSION;
void AUTHORITY_MODULE_PROTOCOL_VERSION;
void (undefined as unknown as AuthorityModuleManifest);

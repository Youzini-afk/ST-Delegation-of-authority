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
import { AuthorityServiceError } from '../utils.js';
import type { AuthorityModuleManifest } from '@stdo/shared-types';
import type { AuditService } from './audit-service.js';
import type { JobService } from './job-service.js';
import type { PrivateFsService } from './private-fs-service.js';
import type { StorageService } from './storage-service.js';
import { TriviumService } from './trivium-service.js';
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
    // Phase A: stub the four CoreService SQL methods so the companion
    // `ctx.sql` capability wrapper has something to delegate to in unit
    // tests. Each stub returns a minimal valid response shape; individual
    // tests override these via `vi.spyOn(core, '<method>')` to capture
    // arguments or assert call counts.
    const querySqlStub = vi.fn().mockResolvedValue({
        kind: 'query' as const,
        columns: [] as string[],
        rows: [] as Record<string, unknown>[],
        rowCount: 0,
    });
    const execSqlStub = vi.fn().mockResolvedValue({
        kind: 'exec' as const,
        rowsAffected: 0,
        lastInsertRowid: null as number | null,
    });
    const transactionSqlStub = vi.fn().mockResolvedValue({
        committed: true,
        results: [] as unknown[],
    });
    const migrateSqlStub = vi.fn().mockResolvedValue({
        tableName: '_authority_migrations',
        applied: [] as string[],
        skipped: [] as string[],
        latestId: null as string | null,
    });
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
        querySql: querySqlStub,
        execSql: execSqlStub,
        transactionSql: transactionSqlStub,
        migrateSql: migrateSqlStub,
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

function createRuntime(core: CoreServiceType = createMockCore(), trivium?: TriviumService): {
    permissions: PermissionService;
    audit: AuditService;
    modules: ModuleHostService;
    loader: CompanionModuleLoaderService;
    trivium: TriviumService;
    core: CoreServiceType;
} {
    const permissions = new PermissionService(new PolicyService(core), core);
    const audit = createMockAudit();
    const triviumService = trivium ?? new TriviumService(core);
    const modules = new ModuleHostService(
        permissions,
        audit,
        triviumService,
        {} as StorageService,
        {} as PrivateFsService,
        {} as JobService,
        {} as SseBroker,
    );
    const loader = new CompanionModuleLoaderService(modules, permissions, audit, triviumService, core, {
        logger: silentLogger as unknown as Console,
        activationTimeoutMs: 2000,
    });
    return { permissions, audit, modules, loader, trivium: triviumService, core };
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
            'trivium',
            'sql',
        ]));
        // Raw services MUST be absent. Note: 'trivium' and 'sql' are now
        // present as SAFE WRAPPERS (not raw TriviumService / CoreService),
        // so they are excluded from the forbidden list below.
        for (const forbidden of ['storage', 'files', 'jobs', 'events', 'core', 'runtime', 'permissions', 'fs', 'blob', 'user', 'session']) {
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

    it('throws a structured module_load_error when executing a load_error module', async () => {
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
        let caught: unknown;
        try {
            await runtime.modules.execute(user, session, 'third-party.failed-extension', 'task.run', {});
        } catch (error) {
            caught = error;
        }
        expect(caught).toBeInstanceOf(AuthorityServiceError);
        const err = caught as AuthorityServiceError;
        expect(err.status).toBe(409);
        expect(err.message).toMatch(/Module failed to load/);
        const details = err.details as { code: string; moduleId: string; status: string; diagnostics: unknown[] };
        expect(details.code).toBe('module_load_error');
        expect(details.moduleId).toBe('third-party.failed-extension');
        expect(details.status).toBe('load_error');
        // Sanitized diagnostics: code/message/severity present, no absolute paths.
        const diagnostics = details.diagnostics as Array<{ code: string; message: string; severity: string }>;
        expect(diagnostics.length).toBeGreaterThan(0);
        const serialized = JSON.stringify(diagnostics);
        expect(serialized).not.toContain(fixture.sillyTavernRoot);
        expect(serialized).not.toContain(extensionDir);
        expect(serialized).not.toContain('/tmp/');
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
                                hasTriviumWrapper: 'trivium' in txCtx,
                                triviumHasListDatabases: typeof txCtx.trivium?.listDatabases === 'function',
                                triviumHasStat: typeof txCtx.trivium?.stat === 'function',
                                triviumHasBulkUpsert: typeof txCtx.trivium?.bulkUpsert === 'function',
                                triviumHasBulkLink: typeof txCtx.trivium?.bulkLink === 'function',
                                triviumHasBulkDelete: typeof txCtx.trivium?.bulkDelete === 'function',
                                triviumIsRawService: typeof (txCtx.trivium)?.repository !== 'undefined' || typeof (txCtx.trivium)?.mappingStore !== 'undefined',
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
        // Phase A: trivium wrapper IS present on the companion ctx.
        expect(result2.hasTriviumWrapper).toBe(true);
        expect(result2.triviumHasListDatabases).toBe(true);
        expect(result2.triviumHasStat).toBe(true);
        expect(result2.triviumHasBulkUpsert).toBe(true);
        expect(result2.triviumHasBulkLink).toBe(true);
        expect(result2.triviumHasBulkDelete).toBe(true);
        // The trivium wrapper must NOT expose raw service internals.
        expect(result2.triviumIsRawService).toBe(false);
        // Raw services MUST still be absent.
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
        let caught: unknown;
        try {
            await runtime.modules.execute(user, session, 'third-party.never-loaded', 'task.run', {});
        } catch (error) {
            caught = error;
        }
        expect(caught).toBeInstanceOf(AuthorityServiceError);
        const err = caught as AuthorityServiceError;
        expect(err.status).toBe(409);
        const details = err.details as { code: string; moduleId: string; status: string };
        expect(details.code).toBe('module_not_loaded');
        expect(details.status).toBe('available');
    });

    it('enforces the companion 64 MiB default request limit on companion modules', async () => {
        const fixture = createFixture();
        const extensionDir = path.join(fixture.thirdPartyRoot, 'limit-extension');
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

        const user = createUser(false, fixture.sillyTavernRoot);
        const session = createSession(user);

        // Build a request payload that exceeds the 64 MiB companion default.
        // We construct a string of 70 MiB (well above 64 MiB) to trigger the
        // limit. We do NOT need to actually send it through the handler; the
        // host rejects it before dispatch.
        const oversized = 'x'.repeat(70 * 1024 * 1024);
        let caught: unknown;
        try {
            await runtime.modules.execute(user, session, 'third-party.limit-extension', 'task.run', {
                input: { data: oversized },
            });
        } catch (error) {
            caught = error;
        }
        expect(caught).toBeInstanceOf(AuthorityServiceError);
        const err = caught as AuthorityServiceError;
        expect(err.status).toBe(413);
        expect(err.code).toBe('limit_exceeded');
        expect(err.category).toBe('limit');
        const details = err.details as { code: string; moduleId: string; maxRequestBytes: number; limitSource: string };
        expect(details.code).toBe('module_request_too_large');
        expect(details.maxRequestBytes).toBe(64 * 1024 * 1024);
        expect(details.limitSource).toBe('host_default');
    });

    it('enforces a per-transaction lower maxRequestBytes on companion modules', async () => {
        const fixture = createFixture();
        const extensionDir = path.join(fixture.thirdPartyRoot, 'lower-limit-extension');
        fs.mkdirSync(extensionDir, { recursive: true });
        writeModule(extensionDir, {
            transactions: {
                'task.run': {
                    name: 'task.run',
                    version: '1.0.0',
                    title: 'Run task',
                    riskLevel: 'medium',
                    permissionTarget: { kind: 'transaction' },
                    requiredResources: [],
                    idempotency: 'optional',
                    maxRequestBytes: 128,
                },
            },
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

        const user = createUser(false, fixture.sillyTavernRoot);
        const session = createSession(user);

        // 200 bytes > 128 byte manifest limit.
        let caught: unknown;
        try {
            await runtime.modules.execute(user, session, 'third-party.lower-limit-extension', 'task.run', {
                input: { data: 'x'.repeat(200) },
            });
        } catch (error) {
            caught = error;
        }
        expect(caught).toBeInstanceOf(AuthorityServiceError);
        const err = caught as AuthorityServiceError;
        expect(err.status).toBe(413);
        const details = err.details as { code: string; maxRequestBytes: number; limitSource: string };
        expect(details.code).toBe('module_request_too_large');
        expect(details.maxRequestBytes).toBe(128);
        expect(details.limitSource).toBe('manifest');
    });

    it('enforces the companion 64 MiB default response limit on companion modules', async () => {
        const fixture = createFixture();
        const extensionDir = path.join(fixture.thirdPartyRoot, 'response-limit-extension');
        fs.mkdirSync(extensionDir, { recursive: true });
        writeModule(extensionDir, {
            serverCjsContent: `
                module.exports.activate = async function activate(ctx) {
                    ctx.registerTransaction('task.run', {
                        handler: async () => ({ result: { data: 'x'.repeat(70 * 1024 * 1024) } }),
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

        let caught: unknown;
        try {
            await runtime.modules.execute(user, session, 'third-party.response-limit-extension', 'task.run', {});
        } catch (error) {
            caught = error;
        }
        expect(caught).toBeInstanceOf(AuthorityServiceError);
        const err = caught as AuthorityServiceError;
        expect(err.status).toBe(413);
        const details = err.details as { code: string; maxResponseBytes: number; limitSource: string };
        expect(details.code).toBe('module_response_too_large');
        expect(details.maxResponseBytes).toBe(64 * 1024 * 1024);
        expect(details.limitSource).toBe('host_default');
    });

    it('enforces a per-transaction lower maxResponseBytes on companion modules', async () => {
        const fixture = createFixture();
        const extensionDir = path.join(fixture.thirdPartyRoot, 'lower-response-extension');
        fs.mkdirSync(extensionDir, { recursive: true });
        writeModule(extensionDir, {
            transactions: {
                'task.run': {
                    name: 'task.run',
                    version: '1.0.0',
                    title: 'Run task',
                    riskLevel: 'medium',
                    permissionTarget: { kind: 'transaction' },
                    requiredResources: [],
                    idempotency: 'optional',
                    maxResponseBytes: 64,
                },
            },
            serverCjsContent: `
                module.exports.activate = async function activate(ctx) {
                    ctx.registerTransaction('task.run', {
                        handler: async () => ({ result: { data: 'x'.repeat(200) } }),
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

        let caught: unknown;
        try {
            await runtime.modules.execute(user, session, 'third-party.lower-response-extension', 'task.run', {});
        } catch (error) {
            caught = error;
        }
        expect(caught).toBeInstanceOf(AuthorityServiceError);
        const err = caught as AuthorityServiceError;
        expect(err.status).toBe(413);
        const details = err.details as { code: string; maxResponseBytes: number; limitSource: string };
        expect(details.code).toBe('module_response_too_large');
        expect(details.maxResponseBytes).toBe(64);
        expect(details.limitSource).toBe('manifest');
    });

    it('enforces the companion 120 s default timeout on companion modules (with short injected timeout via manifest)', async () => {
        const fixture = createFixture();
        const extensionDir = path.join(fixture.thirdPartyRoot, 'timeout-extension');
        fs.mkdirSync(extensionDir, { recursive: true });
        writeModule(extensionDir, {
            transactions: {
                'task.run': {
                    name: 'task.run',
                    version: '1.0.0',
                    title: 'Run task',
                    riskLevel: 'medium',
                    permissionTarget: { kind: 'transaction' },
                    requiredResources: [],
                    idempotency: 'optional',
                    timeoutMs: 50,
                },
            },
            serverCjsContent: `
                module.exports.activate = async function activate(ctx) {
                    ctx.registerTransaction('task.run', {
                        handler: async () => {
                            await new Promise(resolve => setTimeout(resolve, 500));
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

        let caught: unknown;
        try {
            await runtime.modules.execute(user, session, 'third-party.timeout-extension', 'task.run', {});
        } catch (error) {
            caught = error;
        }
        expect(caught).toBeInstanceOf(AuthorityServiceError);
        const err = caught as AuthorityServiceError;
        expect(err.status).toBe(504);
        expect(err.category).toBe('timeout');
        const details = err.details as { code: string; moduleId: string; transaction: string; timeoutMs: number; limitSource: string };
        expect(details.code).toBe('transaction_timeout');
        expect(details.timeoutMs).toBe(50);
        expect(details.limitSource).toBe('manifest');
    });

    it('rejects companion handler non-serializable results with module_response_not_serializable', async () => {
        const fixture = createFixture();
        const extensionDir = path.join(fixture.thirdPartyRoot, 'circular-extension');
        fs.mkdirSync(extensionDir, { recursive: true });
        writeModule(extensionDir, {
            serverCjsContent: `
                module.exports.activate = async function activate(ctx) {
                    ctx.registerTransaction('task.run', {
                        handler: async () => {
                            const circular = {};
                            circular.self = circular;
                            return { result: circular };
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

        let caught: unknown;
        try {
            await runtime.modules.execute(user, session, 'third-party.circular-extension', 'task.run', {});
        } catch (error) {
            caught = error;
        }
        expect(caught).toBeInstanceOf(AuthorityServiceError);
        const err = caught as AuthorityServiceError;
        expect(err.status).toBe(500);
        const details = err.details as { code: string; moduleId: string; transaction: string };
        expect(details.code).toBe('module_response_not_serializable');
        expect(details.moduleId).toBe('third-party.circular-extension');
    });

    it('wraps companion handler throws in transaction_handler_failed with sanitized message', async () => {
        const fixture = createFixture();
        const extensionDir = path.join(fixture.thirdPartyRoot, 'throwing-extension');
        fs.mkdirSync(extensionDir, { recursive: true });
        writeModule(extensionDir, {
            serverCjsContent: `
                module.exports.activate = async function activate(ctx) {
                    ctx.registerTransaction('task.run', {
                        handler: async () => {
                            throw new Error('companion handler exploded at ${fixture.sillyTavernRoot}/secret');
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

        let caught: unknown;
        try {
            await runtime.modules.execute(user, session, 'third-party.throwing-extension', 'task.run', {});
        } catch (error) {
            caught = error;
        }
        expect(caught).toBeInstanceOf(AuthorityServiceError);
        const err = caught as AuthorityServiceError;
        expect(err.status).toBe(500);
        const details = err.details as { code: string; moduleId: string; transaction: string; message: string };
        expect(details.code).toBe('transaction_handler_failed');
        expect(details.moduleId).toBe('third-party.throwing-extension');
        expect(details.transaction).toBe('task.run');
        // The error message must be sanitized: no absolute paths.
        const serialized = JSON.stringify(err.toPayload());
        expect(serialized).not.toContain(fixture.sillyTavernRoot);
        expect(serialized).not.toContain('/secret');
        // The useful "exploded" fragment is preserved.
        expect(details.message).toContain('exploded');
    });

    it('rejects companion module_not_found with structured detail code', async () => {
        const fixture = createFixture();
        const runtime = createRuntime();

        const user = createUser(false, fixture.sillyTavernRoot);
        const session = createSession(user);

        let caught: unknown;
        try {
            await runtime.modules.execute(user, session, 'third-party.nonexistent', 'task.run', {});
        } catch (error) {
            caught = error;
        }
        expect(caught).toBeInstanceOf(AuthorityServiceError);
        const err = caught as AuthorityServiceError;
        expect(err.status).toBe(404);
        const details = err.details as { code: string; moduleId: string };
        expect(details.code).toBe('module_not_found');
        expect(details.moduleId).toBe('third-party.nonexistent');
    });

    it('rejects companion transaction_not_found with structured detail code', async () => {
        const fixture = createFixture();
        const extensionDir = path.join(fixture.thirdPartyRoot, 'missing-tx-extension');
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

        const user = createUser(false, fixture.sillyTavernRoot);
        const session = createSession(user);

        let caught: unknown;
        try {
            await runtime.modules.execute(user, session, 'third-party.missing-tx-extension', 'nonexistent.tx', {});
        } catch (error) {
            caught = error;
        }
        expect(caught).toBeInstanceOf(AuthorityServiceError);
        const err = caught as AuthorityServiceError;
        expect(err.status).toBe(404);
        const details = err.details as { code: string; moduleId: string; transaction: string };
        expect(details.code).toBe('transaction_not_found');
    });

    it('rejects companion dryRun with structured dry_run_unsupported detail code', async () => {
        const fixture = createFixture();
        const extensionDir = path.join(fixture.thirdPartyRoot, 'dryrun-extension');
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

        const user = createUser(false, fixture.sillyTavernRoot);
        const session = createSession(user);

        let caught: unknown;
        try {
            await runtime.modules.execute(user, session, 'third-party.dryrun-extension', 'task.run', {
                options: { dryRun: true },
            });
        } catch (error) {
            caught = error;
        }
        expect(caught).toBeInstanceOf(AuthorityServiceError);
        const err = caught as AuthorityServiceError;
        expect(err.status).toBe(400);
        const details = err.details as { code: string };
        expect(details.code).toBe('dry_run_unsupported');
    });

    it('rejects companion idempotency_required with structured detail code', async () => {
        const fixture = createFixture();
        const extensionDir = path.join(fixture.thirdPartyRoot, 'idempotency-extension');
        fs.mkdirSync(extensionDir, { recursive: true });
        writeModule(extensionDir, {
            transactions: {
                'graph.commit': {
                    name: 'graph.commit',
                    version: '1.0.0',
                    title: 'Commit',
                    riskLevel: 'high',
                    permissionTarget: { kind: 'transaction' },
                    requiredResources: [],
                    idempotency: 'required',
                },
            },
            serverCjsContent: `
                module.exports.activate = async function activate(ctx) {
                    ctx.registerTransaction('graph.commit', { handler: async () => ({ result: { ok: true } }) });
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

        let caught: unknown;
        try {
            await runtime.modules.execute(user, session, 'third-party.idempotency-extension', 'graph.commit', {});
        } catch (error) {
            caught = error;
        }
        expect(caught).toBeInstanceOf(AuthorityServiceError);
        const err = caught as AuthorityServiceError;
        expect(err.status).toBe(400);
        const details = err.details as { code: string; moduleId: string; transaction: string };
        expect(details.code).toBe('idempotency_required');
    });

    it('exposes effective limits metadata on the companion tx ctx (no raw services)', async () => {
        const fixture = createFixture();
        const extensionDir = path.join(fixture.thirdPartyRoot, 'limits-ctx-extension');
        fs.mkdirSync(extensionDir, { recursive: true });
        writeModule(extensionDir, {
            transactions: {
                'task.run': {
                    name: 'task.run',
                    version: '1.0.0',
                    title: 'Run task',
                    riskLevel: 'medium',
                    permissionTarget: { kind: 'transaction' },
                    requiredResources: [],
                    idempotency: 'optional',
                    maxRequestBytes: 1024,
                    maxResponseBytes: 2048,
                    timeoutMs: 5000,
                },
            },
            serverCjsContent: `
                module.exports.activate = async function activate(ctx) {
                    ctx.registerTransaction('task.run', {
                        handler: async (txCtx) => ({
                            result: {
                                limits: txCtx.limits,
                                moduleVersion: txCtx.moduleVersion,
                                transactionVersion: txCtx.transactionVersion,
                                hasTriviumWrapper: 'trivium' in txCtx,
                                triviumHasListDatabases: typeof txCtx.trivium?.listDatabases === 'function',
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

        const response = await runtime.modules.execute(user, session, 'third-party.limits-ctx-extension', 'task.run', {});
        const result2 = response.result as {
            limits: { maxRequestBytes: number; maxResponseBytes: number; timeoutMs: number; source: string };
            moduleVersion: string;
            transactionVersion: string;
            hasTriviumWrapper: boolean;
            triviumHasListDatabases: boolean;
            hasStorage: boolean;
            hasFiles: boolean;
            hasJobs: boolean;
            hasEvents: boolean;
            hasCore: boolean;
            hasRuntime: boolean;
            hasUser: boolean;
            hasSession: boolean;
            hasPermissions: boolean;
        };
        // Effective limits are exposed as safe metadata (numbers + source).
        expect(result2.limits.maxRequestBytes).toBe(1024);
        expect(result2.limits.maxResponseBytes).toBe(2048);
        expect(result2.limits.timeoutMs).toBe(5000);
        expect(result2.limits.source).toBe('manifest');
        expect(result2.moduleVersion).toBe('1.0.0');
        expect(result2.transactionVersion).toBe('1.0.0');
        // Phase A: trivium wrapper IS present on the companion ctx.
        expect(result2.hasTriviumWrapper).toBe(true);
        expect(result2.triviumHasListDatabases).toBe(true);
        // Raw services MUST still be absent.
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

    it('activation ctx still lacks raw services in Phase 3', async () => {
        const fixture = createFixture();
        const extensionDir = path.join(fixture.thirdPartyRoot, 'activation-no-raw-extension');
        fs.mkdirSync(extensionDir, { recursive: true });
        const moduleDir = path.join(extensionDir, '.authority');
        fs.mkdirSync(moduleDir, { recursive: true });
        fs.writeFileSync(
            path.join(moduleDir, 'server.cjs'),
            `
            module.exports.activate = async function activate(ctx) {
                module.exports.__capturedActivationCtx = ctx;
                ctx.registerTransaction('task.run', { handler: async () => ({ result: { ok: true } }) });
            };
            `,
            'utf8',
        );
        fs.writeFileSync(
            path.join(moduleDir, 'module.json'),
            JSON.stringify({
                id: 'third-party.activation-no-raw-extension',
                displayName: 'Activation No Raw',
                ownerExtensionId: 'third-party/activation-no-raw-extension',
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
            }, null, 2),
            'utf8',
        );

        const discovery = createDiscovery(fixture);
        const result = discovery.discover();
        const runtime = createRuntime();
        runtime.modules.registerDiscoveredRecords(result.records);
        await runtime.loader.loadAll(result);

        const candidate = result.internalSources.get('third-party.activation-no-raw-extension');
        expect(candidate).toBeDefined();
        const captured = loadCompanionModuleFromDisk(candidate!.entryPath) as {
            __capturedActivationCtx?: Record<string, unknown>;
        };
        const ctx = captured.__capturedActivationCtx;
        expect(ctx).toBeDefined();
        // Activation ctx exposes only safe metadata + logger + registerTransaction.
        expect(ctx).toHaveProperty('moduleId');
        expect(ctx).toHaveProperty('ownerExtensionId');
        expect(ctx).toHaveProperty('moduleDir');
        expect(ctx).toHaveProperty('logger');
        expect(ctx).toHaveProperty('registerTransaction');
        // Raw services MUST be absent from the activation ctx.
        for (const forbidden of ['trivium', 'storage', 'files', 'jobs', 'events', 'audit', 'core', 'runtime', 'permissions', 'sql', 'fs', 'blob']) {
            expect(ctx).not.toHaveProperty(forbidden);
        }
    });

    it('aborts companion ctx.signal when the host timeout fires (cooperative cancellation)', async () => {
        const fixture = createFixture();
        const extensionDir = path.join(fixture.thirdPartyRoot, 'signal-abort-extension');
        fs.mkdirSync(extensionDir, { recursive: true });
        // The handler records the signal state when it starts and never
        // resolves until the signal fires. The host's timeout (50 ms) aborts
        // the signal, which unblocks the handler; the host then rejects
        // with transaction_timeout. We assert the companion handler saw
        // `signal.aborted === true` before the host gave up.
        writeModule(extensionDir, {
            transactions: {
                'task.run': {
                    name: 'task.run',
                    version: '1.0.0',
                    title: 'Run task',
                    riskLevel: 'medium',
                    permissionTarget: { kind: 'transaction' },
                    requiredResources: [],
                    idempotency: 'optional',
                    timeoutMs: 50,
                },
            },
            serverCjsContent: `
                module.exports.activate = async function activate(ctx) {
                    let observedAborted = null;
                    let observedReason = null;
                    ctx.registerTransaction('task.run', {
                        handler: async (txCtx) => {
                            observedAborted = txCtx.signal.aborted;
                            observedReason = txCtx.signal.reason;
                            // Wait for the abort event so the handler does
                            // not resolve until the host has actually fired
                            // the timeout. This proves the signal is wired
                            // through, not a no-op.
                            if (!txCtx.signal.aborted) {
                                await new Promise(resolve => {
                                    txCtx.signal.addEventListener('abort', () => resolve(null), { once: true });
                                });
                            }
                            // Record the post-abort state for assertion.
                            module.exports.__signalAbortedAtEnd = txCtx.signal.aborted;
                            module.exports.__signalReason = txCtx.signal.reason;
                            return { result: { ok: true, aborted: txCtx.signal.aborted } };
                        },
                    });
                    module.exports.__observedAbortedAtStart = () => observedAborted;
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

        let caught: unknown;
        try {
            await runtime.modules.execute(user, session, 'third-party.signal-abort-extension', 'task.run', {});
        } catch (error) {
            caught = error;
        }
        // The host must reject with transaction_timeout.
        expect(caught).toBeInstanceOf(AuthorityServiceError);
        const err = caught as AuthorityServiceError;
        expect(err.status).toBe(504);
        const details = err.details as { code: string; timeoutMs: number };
        expect(details.code).toBe('transaction_timeout');
        expect(details.timeoutMs).toBe(50);

        // The companion handler MUST have observed signal.aborted === true
        // by the time the host gave up. This proves the host-owned
        // AbortController is the SAME signal exposed on the companion ctx.
        const candidate = result.internalSources.get('third-party.signal-abort-extension');
        expect(candidate).toBeDefined();
        const exported = loadCompanionModuleFromDisk(candidate!.entryPath) as {
            __signalAbortedAtEnd?: boolean;
            __signalReason?: unknown;
            __observedAbortedAtStart?: () => boolean | null;
        };
        expect(exported.__signalAbortedAtEnd).toBe(true);
        // The abort reason is a DOMException with name 'AbortError' in
        // Node 18+; we just assert it's present (not undefined).
        expect(exported.__signalReason).toBeDefined();
    });

    it('does not abort companion ctx.signal when no timeout is enforced (built-in-style Infinity)', async () => {
        // Companion modules always get a host-default timeout (120 s) when
        // the manifest omits timeoutMs, so this test uses a companion module
        // with a very long manifest timeout (well above the test duration)
        // and asserts the signal stays non-aborted through a fast resolve.
        const fixture = createFixture();
        const extensionDir = path.join(fixture.thirdPartyRoot, 'signal-no-abort-extension');
        fs.mkdirSync(extensionDir, { recursive: true });
        writeModule(extensionDir, {
            transactions: {
                'task.run': {
                    name: 'task.run',
                    version: '1.0.0',
                    title: 'Run task',
                    riskLevel: 'medium',
                    permissionTarget: { kind: 'transaction' },
                    requiredResources: [],
                    idempotency: 'optional',
                    timeoutMs: 60_000,
                },
            },
            serverCjsContent: `
                module.exports.activate = async function activate(ctx) {
                    ctx.registerTransaction('task.run', {
                        handler: async (txCtx) => {
                            // Fast resolve; the signal should not fire.
                            return { result: { ok: true, abortedAtCallTime: txCtx.signal.aborted } };
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

        const response = await runtime.modules.execute(user, session, 'third-party.signal-no-abort-extension', 'task.run', {});
        expect(response.ok).toBe(true);
        const result2 = response.result as { abortedAtCallTime: boolean };
        expect(result2.abortedAtCallTime).toBe(false);
    });

    it('sanitizes load_error diagnostics on /modules list/get for companion-loaded modules', async () => {
        const fixture = createFixture();
        const extensionDir = path.join(fixture.thirdPartyRoot, 'leaky-load-error-extension');
        fs.mkdirSync(extensionDir, { recursive: true });
        // Write a server.cjs whose activate throws an error referencing the
        // absolute module dir. The loader will mark the record load_error
        // and store the thrown message as a diagnostic detail. The public
        // /modules list/get must NOT contain the absolute path.
        writeModule(extensionDir, {
            serverCjsContent: `
                module.exports.activate = async function activate(ctx) {
                    throw new Error('failed at ' + ctx.moduleDir + '/secret.cjs');
                };
            `,
        });

        const discovery = createDiscovery(fixture);
        const result = discovery.discover();
        const runtime = createRuntime();
        runtime.modules.registerDiscoveredRecords(result.records);
        await runtime.loader.loadAll(result);

        // listRecords() must not leak the absolute moduleDir.
        const listed = runtime.modules.listRecords();
        const serializedList = JSON.stringify(listed);
        expect(serializedList).not.toContain(fixture.sillyTavernRoot);
        expect(serializedList).not.toContain(extensionDir);
        expect(serializedList).not.toContain('/secret.cjs');
        expect(serializedList).not.toContain('extensionDir');
        expect(serializedList).not.toContain('moduleDir');
        expect(serializedList).not.toContain('manifestPath');
        expect(serializedList).not.toContain('entryPath');

        // getRecord() must not leak either.
        const got = runtime.modules.getRecord('third-party.leaky-load-error-extension');
        expect(got?.status).toBe('load_error');
        const serializedGet = JSON.stringify(got);
        expect(serializedGet).not.toContain(fixture.sillyTavernRoot);
        expect(serializedGet).not.toContain(extensionDir);
        expect(serializedGet).not.toContain('/secret.cjs');
        expect(serializedGet).not.toContain('extensionDir');
        expect(serializedGet).not.toContain('moduleDir');
        expect(serializedGet).not.toContain('manifestPath');
        expect(serializedGet).not.toContain('entryPath');

        // listManifests() must not leak.
        const manifests = runtime.modules.listManifests();
        const serializedManifests = JSON.stringify(manifests);
        expect(serializedManifests).not.toContain(fixture.sillyTavernRoot);
        expect(serializedManifests).not.toContain(extensionDir);

        // The useful diagnostic code must survive sanitization.
        expect(serializedGet).toContain('load_activation_threw');
    });
});

describe('CompanionModuleLoaderService Phase A trivium wrapper', () => {
    afterEach(() => {
        while (cleanupDirs.length > 0) {
            const dir = cleanupDirs.pop();
            if (dir) {
                fs.rmSync(dir, { recursive: true, force: true });
            }
        }
    });

function createTriviumFixture(): { fixture: Fixture; runtime: ReturnType<typeof createRuntime> } {
    const fixture = createFixture();
    const extensionDir = path.join(fixture.thirdPartyRoot, 'trivium-extension');
    fs.mkdirSync(extensionDir, { recursive: true });
    writeModule(extensionDir, {
        serverCjsContent: `
            module.exports.activate = async function activate(ctx) {
                ctx.registerTransaction('task.run', {
                    handler: async (txCtx, input) => {
                        const op = input?.op ?? 'stat';
                        if (op === 'listDatabases') {
                            const result = await txCtx.trivium.listDatabases();
                            return { result: { op, databases: result.databases.map(d => d.entryName) } };
                        }
                            if (op === 'stat') {
                                const db = input.database ?? 'default';
                                const result = await txCtx.trivium.stat({ database: db });
                                return { result: { op, exists: result.exists, database: db } };
                            }
                        if (op === 'bulkUpsert') {
                            const result = await txCtx.trivium.bulkUpsert({
                                database: input.database,
                                dim: input.dim ?? 3,
                                items: input.items ?? [],
                            });
                            return { result: { op, totalCount: result.totalCount, successCount: result.successCount } };
                        }
                        if (op === 'bulkLink') {
                            const result = await txCtx.trivium.bulkLink({
                                database: input.database,
                                items: input.items ?? [],
                            });
                            return { result: { op, totalCount: result.totalCount, successCount: result.successCount } };
                        }
                        if (op === 'bulkDelete') {
                            const result = await txCtx.trivium.bulkDelete({
                                database: input.database,
                                items: input.items ?? [],
                            });
                            return { result: { op, totalCount: result.totalCount, successCount: result.successCount } };
                        }
                        if (op === 'searchHybrid') {
                            const result = await txCtx.trivium.searchHybrid({
                                database: input.database,
                                vector: input.vector ?? [1, 2, 3],
                                queryText: input.queryText ?? 'hello',
                                topK: input.topK,
                                expandDepth: input.expandDepth,
                            });
                            return { result: { op, hits: result.length } };
                        }
                        if (op === 'resolveMany') {
                            const result = await txCtx.trivium.resolveMany({
                                database: input.database,
                                items: input.items ?? [],
                            });
                            return { result: { op, items: result.items.length } };
                        }
                        if (op === 'neighbors') {
                            const result = await txCtx.trivium.neighbors({
                                database: input.database,
                                id: input.id ?? 1,
                                depth: input.depth,
                            });
                            return { result: { op, ids: result.ids.length } };
                        }
                        return { result: { op: 'unknown' } };
                    },
                });
            };
        `,
    });
    const discovery = createDiscovery(fixture);
    const result = discovery.discover();
    // Use a mock CoreService that has the trivium stubs needed for
    // listDatabases/stat/bulkUpsert/bulkLink/bulkDelete. The mock returns
    // empty/zero results; the tests assert the wrapper calls the service
    // with the right extensionId and authorizes before the call, not the
    // actual trivium data correctness.
    const triviumCore = createMockCore();
    const triviumService = new TriviumService(triviumCore);
    // Stub the trivium service methods that would delegate to the native
    // core (which is not available in unit tests). Each stub returns a
    // minimal valid response shape.
    vi.spyOn(triviumService, 'listDatabases').mockResolvedValue({ databases: [] });
    vi.spyOn(triviumService, 'stat').mockResolvedValue({
        exists: false,
        entryName: '',
        sizeBytes: 0,
        nodeCount: 0,
        edgeCount: 0,
        indexCount: 0,
        updatedAt: null,
        lastFlushAt: null,
        mappingCount: 0,
        orphanMappingCount: null,
        indexHealth: null,
    } as never);
    vi.spyOn(triviumService, 'bulkUpsert').mockResolvedValue({
        totalCount: 0,
        successCount: 0,
        failureCount: 0,
        failures: [],
        items: [],
    });
    vi.spyOn(triviumService, 'bulkLink').mockResolvedValue({
        totalCount: 0,
        successCount: 0,
        failureCount: 0,
        failures: [],
    });
    vi.spyOn(triviumService, 'bulkDelete').mockResolvedValue({
        totalCount: 0,
        successCount: 0,
        failureCount: 0,
        failures: [],
    });
    vi.spyOn(triviumService, 'resolveMany').mockResolvedValue({ items: [] });
    vi.spyOn(triviumService, 'searchHybrid').mockResolvedValue([]);
    vi.spyOn(triviumService, 'neighbors').mockResolvedValue({ ids: [], nodes: [] });
    const runtime = createRuntime(triviumCore, triviumService);
    runtime.modules.registerDiscoveredRecords(result.records);
    return { fixture, runtime };
}

    async function loadAndExecute(
        fixture: Fixture,
        runtime: ReturnType<typeof createRuntime>,
        input: unknown,
    ): Promise<unknown> {
        await runtime.loader.loadAll(createDiscovery(fixture).discover());
        const user = createUser(false, fixture.sillyTavernRoot);
        const session = createSession(user);
        const response = await runtime.modules.execute(user, session, 'third-party.trivium-extension', 'task.run', { input });
        return response.result;
    }

    it('exposes ctx.trivium wrapper with listDatabases/stat/bulkUpsert/bulkLink/bulkDelete', async () => {
        const { fixture, runtime } = createTriviumFixture();
        // Just call stat on a non-existent database to verify the wrapper is wired.
        const result = await loadAndExecute(fixture, runtime, { op: 'stat', database: 'test-db' });
        expect(result).toMatchObject({ op: 'stat', exists: false, database: 'test-db' });
    });

    it('wrapper calls TriviumService with ownerExtensionId, not caller extension id', async () => {
        const { fixture, runtime } = createTriviumFixture();
        // Spy on the TriviumService.stat method to capture the extensionId argument.
        const statSpy = vi.spyOn(runtime.trivium, 'stat');
        await loadAndExecute(fixture, runtime, { op: 'stat', database: 'test-db' });
        expect(statSpy).toHaveBeenCalledTimes(1);
        // The second argument is the extensionId. It MUST be the owner
        // extension id (third-party/trivium-extension), NOT the caller
        // extension id from session.extension.id (third-party/test-extension).
        const extensionIdArg = statSpy.mock.calls[0]?.[1];
        expect(extensionIdArg).toBe('third-party/trivium-extension');
        expect(extensionIdArg).not.toBe('third-party/test-extension');
    });

    it('wrapper authorizes trivium.private before the service call; denial prevents service call', async () => {
        const { fixture, runtime } = createTriviumFixture();
        // Deny trivium.private for the 'test-db' database.
        const user = createUser(false, fixture.sillyTavernRoot);
        const session = createSession(user);
        await runtime.permissions.resolve(user, session, { resource: 'trivium.private', target: 'test-db' }, 'deny');

        // Spy on the TriviumService.stat method to verify it is NOT called.
        const statSpy = vi.spyOn(runtime.trivium, 'stat');
        await runtime.loader.loadAll(createDiscovery(fixture).discover());
        let caught: unknown;
        try {
            await runtime.modules.execute(user, session, 'third-party.trivium-extension', 'task.run', {
                input: { op: 'stat', database: 'test-db' },
            });
        } catch (error) {
            caught = error;
        }
        expect(caught).toBeInstanceOf(AuthorityServiceError);
        const err = caught as AuthorityServiceError;
        expect(err.status).toBe(403);
        expect(err.code).toBe('permission_not_granted');
        expect(statSpy).not.toHaveBeenCalled();
    });

    it('default/undefined database authorization target matches Trivium default (default)', async () => {
        const { fixture, runtime } = createTriviumFixture();
        // Spy on the permissions.authorize method to capture the target.
        const user = createUser(false, fixture.sillyTavernRoot);
        const session = createSession(user);
        const authorizeSpy = vi.spyOn(runtime.permissions, 'authorize');

        await runtime.loader.loadAll(createDiscovery(fixture).discover());
        // Call stat with no database field (undefined) -> should authorize
        // against 'default', matching getTriviumDatabaseName normalization.
        await runtime.modules.execute(user, session, 'third-party.trivium-extension', 'task.run', {
            input: { op: 'stat' },
        });

        // Find the authorize call for trivium.private.
        const triviumCall = authorizeSpy.mock.calls.find(call => call[2]?.resource === 'trivium.private');
        expect(triviumCall).toBeDefined();
        expect(triviumCall?.[2]?.target).toBe('default');
    });

    it('listDatabases authorizes with target * (no per-database target for list)', async () => {
        const { fixture, runtime } = createTriviumFixture();
        const user = createUser(false, fixture.sillyTavernRoot);
        const session = createSession(user);
        const authorizeSpy = vi.spyOn(runtime.permissions, 'authorize');

        await runtime.loader.loadAll(createDiscovery(fixture).discover());
        await runtime.modules.execute(user, session, 'third-party.trivium-extension', 'task.run', {
            input: { op: 'listDatabases' },
        });

        const triviumCall = authorizeSpy.mock.calls.find(call => call[2]?.resource === 'trivium.private');
        expect(triviumCall).toBeDefined();
        expect(triviumCall?.[2]?.target).toBe('*');
    });

    it('bulkUpsert calls TriviumService.bulkUpsert with ownerExtensionId', async () => {
        const { fixture, runtime } = createTriviumFixture();
        const upsertSpy = vi.spyOn(runtime.trivium, 'bulkUpsert');
        await loadAndExecute(fixture, runtime, {
            op: 'bulkUpsert',
            database: 'test-db',
            dim: 3,
            items: [{ externalId: 'node-1', namespace: 'default', vector: [1, 2, 3], payload: { label: 'test' } }],
        });
        expect(upsertSpy).toHaveBeenCalledTimes(1);
        const extensionIdArg = upsertSpy.mock.calls[0]?.[1];
        expect(extensionIdArg).toBe('third-party/trivium-extension');
    });

    it('bulkLink calls TriviumService.bulkLink with ownerExtensionId', async () => {
        const { fixture, runtime } = createTriviumFixture();
        const linkSpy = vi.spyOn(runtime.trivium, 'bulkLink');
        // bulkLink requires existing nodes; the call will likely fail at the
        // service level, but the spy still captures the extensionId argument
        // before the service throws. The wrapper re-throws, so we catch.
        const user = createUser(false, fixture.sillyTavernRoot);
        const session = createSession(user);
        await runtime.loader.loadAll(createDiscovery(fixture).discover());
        try {
            await runtime.modules.execute(user, session, 'third-party.trivium-extension', 'task.run', {
                input: {
                    op: 'bulkLink',
                    database: 'test-db',
                    items: [{ src: { externalId: 'a' }, dst: { externalId: 'b' } }],
                },
            });
        } catch {
            // expected: bulkLink on non-existent nodes fails
        }
        expect(linkSpy).toHaveBeenCalledTimes(1);
        const extensionIdArg = linkSpy.mock.calls[0]?.[1];
        expect(extensionIdArg).toBe('third-party/trivium-extension');
    });

    it('bulkDelete calls TriviumService.bulkDelete with ownerExtensionId', async () => {
        const { fixture, runtime } = createTriviumFixture();
        const deleteSpy = vi.spyOn(runtime.trivium, 'bulkDelete');
        await loadAndExecute(fixture, runtime, {
            op: 'bulkDelete',
            database: 'test-db',
            items: [{ externalId: 'nonexistent' }],
        });
        expect(deleteSpy).toHaveBeenCalledTimes(1);
        const extensionIdArg = deleteSpy.mock.calls[0]?.[1];
        expect(extensionIdArg).toBe('third-party/trivium-extension');
    });

    it('searchHybrid calls TriviumService.searchHybrid with ownerExtensionId', async () => {
        const { fixture, runtime } = createTriviumFixture();
        const searchSpy = vi.spyOn(runtime.trivium, 'searchHybrid');
        await loadAndExecute(fixture, runtime, {
            op: 'searchHybrid',
            database: 'test-db',
            vector: [1, 2, 3],
            queryText: 'hello',
            topK: 5,
        });
        expect(searchSpy).toHaveBeenCalledTimes(1);
        const extensionIdArg = searchSpy.mock.calls[0]?.[1];
        expect(extensionIdArg).toBe('third-party/trivium-extension');
        expect(extensionIdArg).not.toBe('third-party/test-extension');
    });

    it('searchHybrid authorizes before the service call; denial prevents service call', async () => {
        const { fixture, runtime } = createTriviumFixture();
        const user = createUser(false, fixture.sillyTavernRoot);
        const session = createSession(user);
        await runtime.permissions.resolve(user, session, { resource: 'trivium.private', target: 'test-db' }, 'deny');
        const searchSpy = vi.spyOn(runtime.trivium, 'searchHybrid');
        await runtime.loader.loadAll(createDiscovery(fixture).discover());
        let caught: unknown;
        try {
            await runtime.modules.execute(user, session, 'third-party.trivium-extension', 'task.run', {
                input: { op: 'searchHybrid', database: 'test-db', vector: [1, 2, 3], queryText: 'hello' },
            });
        } catch (error) {
            caught = error;
        }
        expect(caught).toBeInstanceOf(AuthorityServiceError);
        const err = caught as AuthorityServiceError;
        expect(err.status).toBe(403);
        expect(err.code).toBe('permission_not_granted');
        expect(searchSpy).not.toHaveBeenCalled();
    });

    it('searchHybrid normalizes undefined database to default for authorization', async () => {
        const { fixture, runtime } = createTriviumFixture();
        const user = createUser(false, fixture.sillyTavernRoot);
        const session = createSession(user);
        const authorizeSpy = vi.spyOn(runtime.permissions, 'authorize');
        await runtime.loader.loadAll(createDiscovery(fixture).discover());
        await runtime.modules.execute(user, session, 'third-party.trivium-extension', 'task.run', {
            input: { op: 'searchHybrid', vector: [1, 2, 3], queryText: 'hello' },
        });
        const triviumCall = authorizeSpy.mock.calls.find(call => call[2]?.resource === 'trivium.private');
        expect(triviumCall).toBeDefined();
        expect(triviumCall?.[2]?.target).toBe('default');
    });

    it('searchHybrid clamps over-cap topK and expandDepth (does not reject)', async () => {
        const { fixture, runtime } = createTriviumFixture();
        const searchSpy = vi.spyOn(runtime.trivium, 'searchHybrid');
        // 9999 exceeds MAX_SEARCH_TOP_K (200); 99 exceeds MAX_SEARCH_EXPAND_DEPTH (5).
        await loadAndExecute(fixture, runtime, {
            op: 'searchHybrid',
            database: 'test-db',
            vector: [1, 2, 3],
            queryText: 'hello',
            topK: 9999,
            expandDepth: 99,
        });
        expect(searchSpy).toHaveBeenCalledTimes(1);
        const passedRequest = searchSpy.mock.calls[0]?.[2];
        expect(passedRequest?.topK).toBe(200);
        expect(passedRequest?.expandDepth).toBe(5);
    });

    it('searchHybrid does not mutate the caller request object', async () => {
        const { fixture, runtime } = createTriviumFixture();
        const searchSpy = vi.spyOn(runtime.trivium, 'searchHybrid');
        const callerRequest = {
            op: 'searchHybrid',
            database: 'test-db',
            vector: [1, 2, 3],
            queryText: 'hello',
            topK: 9999,
            expandDepth: 99,
        };
        await loadAndExecute(fixture, runtime, callerRequest);
        // Caller's topK/expandDepth must be untouched.
        expect(callerRequest.topK).toBe(9999);
        expect(callerRequest.expandDepth).toBe(99);
        // Service received the clamped copy.
        const passedRequest = searchSpy.mock.calls[0]?.[2];
        expect(passedRequest?.topK).toBe(200);
        expect(passedRequest?.expandDepth).toBe(5);
    });

    it('resolveMany calls TriviumService.resolveMany with ownerExtensionId', async () => {
        const { fixture, runtime } = createTriviumFixture();
        const resolveSpy = vi.spyOn(runtime.trivium, 'resolveMany');
        await loadAndExecute(fixture, runtime, {
            op: 'resolveMany',
            database: 'test-db',
            items: [{ externalId: 'a' }, { id: 1 }],
        });
        expect(resolveSpy).toHaveBeenCalledTimes(1);
        const extensionIdArg = resolveSpy.mock.calls[0]?.[1];
        expect(extensionIdArg).toBe('third-party/trivium-extension');
        expect(extensionIdArg).not.toBe('third-party/test-extension');
    });

    it('resolveMany hard-rejects oversized item batches with 400 validation_error', async () => {
        const { fixture, runtime } = createTriviumFixture();
        const resolveSpy = vi.spyOn(runtime.trivium, 'resolveMany');
        // MAX_TRIVIUM_RESOLVE_MANY_ITEMS = 5000; send 5001 items.
        const items = Array.from({ length: 5001 }, (_v, i) => ({ id: i + 1 }));
        const user = createUser(false, fixture.sillyTavernRoot);
        const session = createSession(user);
        await runtime.loader.loadAll(createDiscovery(fixture).discover());
        let caught: unknown;
        try {
            await runtime.modules.execute(user, session, 'third-party.trivium-extension', 'task.run', {
                input: { op: 'resolveMany', database: 'test-db', items },
            });
        } catch (error) {
            caught = error;
        }
        expect(caught).toBeInstanceOf(AuthorityServiceError);
        const err = caught as AuthorityServiceError;
        expect(err.status).toBe(400);
        expect(err.code).toBe('validation_error');
        // The wrapper hard-rejects BEFORE the service call.
        expect(resolveSpy).not.toHaveBeenCalled();
    });

    it('resolveMany at exactly the cap is accepted (boundary)', async () => {
        const { fixture, runtime } = createTriviumFixture();
        const resolveSpy = vi.spyOn(runtime.trivium, 'resolveMany');
        // MAX_TRIVIUM_RESOLVE_MANY_ITEMS = 5000; send exactly 5000 items.
        const items = Array.from({ length: 5000 }, (_v, i) => ({ id: i + 1 }));
        await loadAndExecute(fixture, runtime, {
            op: 'resolveMany',
            database: 'test-db',
            items,
        });
        expect(resolveSpy).toHaveBeenCalledTimes(1);
    });

    it('neighbors calls TriviumService.neighbors with ownerExtensionId', async () => {
        const { fixture, runtime } = createTriviumFixture();
        const neighborsSpy = vi.spyOn(runtime.trivium, 'neighbors');
        await loadAndExecute(fixture, runtime, {
            op: 'neighbors',
            database: 'test-db',
            id: 1,
            depth: 2,
        });
        expect(neighborsSpy).toHaveBeenCalledTimes(1);
        const extensionIdArg = neighborsSpy.mock.calls[0]?.[1];
        expect(extensionIdArg).toBe('third-party/trivium-extension');
        expect(extensionIdArg).not.toBe('third-party/test-extension');
    });

    it('neighbors clamps over-cap depth (does not reject)', async () => {
        const { fixture, runtime } = createTriviumFixture();
        const neighborsSpy = vi.spyOn(runtime.trivium, 'neighbors');
        // 99 exceeds MAX_NEIGHBORS_DEPTH (5).
        await loadAndExecute(fixture, runtime, {
            op: 'neighbors',
            database: 'test-db',
            id: 1,
            depth: 99,
        });
        expect(neighborsSpy).toHaveBeenCalledTimes(1);
        const passedRequest = neighborsSpy.mock.calls[0]?.[2];
        expect(passedRequest?.depth).toBe(5);
    });

    it('neighbors does not mutate the caller request object', async () => {
        const { fixture, runtime } = createTriviumFixture();
        const neighborsSpy = vi.spyOn(runtime.trivium, 'neighbors');
        const callerRequest = {
            op: 'neighbors',
            database: 'test-db',
            id: 1,
            depth: 99,
        };
        await loadAndExecute(fixture, runtime, callerRequest);
        expect(callerRequest.depth).toBe(99);
        const passedRequest = neighborsSpy.mock.calls[0]?.[2];
        expect(passedRequest?.depth).toBe(5);
    });

    it('companion ctx still lacks raw storage/files/jobs/events/core/runtime/sql services', async () => {
        const fixture = createFixture();
        const extensionDir = path.join(fixture.thirdPartyRoot, 'trivium-raw-check');
        fs.mkdirSync(extensionDir, { recursive: true });
        writeModule(extensionDir, {
            serverCjsContent: `
                module.exports.activate = async function activate(ctx) {
                    ctx.registerTransaction('task.run', {
                        handler: async (txCtx) => ({
                            result: {
                                keys: Object.keys(txCtx).sort(),
                                hasTriviumWrapper: typeof txCtx.trivium?.listDatabases === 'function',
                                triviumIsRaw: typeof (txCtx.trivium)?.repository !== 'undefined',
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
        const response = await runtime.modules.execute(user, session, 'third-party.trivium-raw-check', 'task.run', {});
        const result2 = response.result as { keys: string[]; hasTriviumWrapper: boolean; triviumIsRaw: boolean };
        // trivium wrapper IS present.
        expect(result2.hasTriviumWrapper).toBe(true);
        // trivium is NOT the raw TriviumService (no repository property).
        expect(result2.triviumIsRaw).toBe(false);
        // Raw services MUST be absent. Note: 'sql' is now present as a
        // SAFE WRAPPER (not the raw CoreService), so it is excluded from
        // the forbidden list below.
        for (const forbidden of ['storage', 'files', 'jobs', 'events', 'core', 'runtime', 'permissions', 'fs', 'blob', 'user', 'session']) {
            expect(result2.keys).not.toContain(forbidden);
        }
    });
});

describe('CompanionModuleLoaderService Phase A sql wrapper', () => {
    afterEach(() => {
        while (cleanupDirs.length > 0) {
            const dir = cleanupDirs.pop();
            if (dir) {
                fs.rmSync(dir, { recursive: true, force: true });
            }
        }
    });

    function createSqlFixture(): { fixture: Fixture; runtime: ReturnType<typeof createRuntime> } {
        const fixture = createFixture();
        const extensionDir = path.join(fixture.thirdPartyRoot, 'sql-extension');
        fs.mkdirSync(extensionDir, { recursive: true });
        writeModule(extensionDir, {
            serverCjsContent: `
                module.exports.activate = async function activate(ctx) {
                    ctx.registerTransaction('task.run', {
                        handler: async (txCtx, input) => {
                            const op = input?.op ?? 'query';
                            const database = input?.database;
                            if (op === 'query') {
                                const result = await txCtx.sql.query(
                                    database,
                                    input?.statement ?? 'SELECT 1 AS one',
                                    input?.params,
                                    input?.page,
                                );
                                return { result: { op, rowCount: result.rowCount, columns: result.columns } };
                            }
                            if (op === 'exec') {
                                const result = await txCtx.sql.exec(
                                    database,
                                    input?.statement ?? 'CREATE TABLE t (id INTEGER)',
                                    input?.params,
                                );
                                return { result: { op, rowsAffected: result.rowsAffected } };
                            }
                            if (op === 'transaction') {
                                const result = await txCtx.sql.transaction(
                                    database,
                                    input?.statements ?? [],
                                );
                                return { result: { op, committed: result.committed } };
                            }
                            if (op === 'migrate') {
                                const result = await txCtx.sql.migrate(
                                    database,
                                    input?.migrations ?? [],
                                    input?.tableName,
                                );
                                return { result: { op, tableName: result.tableName, applied: result.applied } };
                            }
                            if (op === 'introspect') {
                                return {
                                    result: {
                                        op,
                                        keys: Object.keys(txCtx).sort(),
                                        hasSqlWrapper: typeof txCtx.sql?.query === 'function',
                                        hasSqlExec: typeof txCtx.sql?.exec === 'function',
                                        hasSqlTransaction: typeof txCtx.sql?.transaction === 'function',
                                        hasSqlMigrate: typeof txCtx.sql?.migrate === 'function',
                                        sqlIsRawCore: typeof (txCtx.sql)?.querySql !== 'undefined' || typeof (txCtx.sql)?.execSql !== 'undefined',
                                    },
                                };
                            }
                            return { result: { op: 'unknown' } };
                        },
                    });
                };
            `,
        });
        const discovery = createDiscovery(fixture);
        const result = discovery.discover();
        // Use a mock CoreService that has the SQL stubs needed for
        // query/exec/transaction/migrate. The mock returns empty/zero
        // results; the tests assert the wrapper calls the service with
        // the right dbPath (resolved from ownerExtensionId) and authorizes
        // before the call, not the actual SQL data correctness.
        const sqlCore = createMockCore();
        const runtime = createRuntime(sqlCore);
        runtime.modules.registerDiscoveredRecords(result.records);
        return { fixture, runtime };
    }

    async function loadAndExecuteSql(
        fixture: Fixture,
        runtime: ReturnType<typeof createRuntime>,
        input: unknown,
    ): Promise<unknown> {
        await runtime.loader.loadAll(createDiscovery(fixture).discover());
        const user = createUser(false, fixture.sillyTavernRoot);
        const session = createSession(user);
        const response = await runtime.modules.execute(user, session, 'third-party.sql-extension', 'task.run', { input });
        return response.result;
    }

    it('exposes ctx.sql wrapper with query/exec/transaction/migrate', async () => {
        const { fixture, runtime } = createSqlFixture();
        const result = await loadAndExecuteSql(fixture, runtime, { op: 'introspect' });
        const introspect = result as {
            keys: string[];
            hasSqlWrapper: boolean;
            hasSqlExec: boolean;
            hasSqlTransaction: boolean;
            hasSqlMigrate: boolean;
            sqlIsRawCore: boolean;
        };
        expect(introspect.hasSqlWrapper).toBe(true);
        expect(introspect.hasSqlExec).toBe(true);
        expect(introspect.hasSqlTransaction).toBe(true);
        expect(introspect.hasSqlMigrate).toBe(true);
        // The wrapper must NOT expose raw CoreService internals.
        expect(introspect.sqlIsRawCore).toBe(false);
        // sql wrapper IS present on the ctx.
        expect(introspect.keys).toContain('sql');
    });

    it('raw CoreService is absent from the companion ctx', async () => {
        const { fixture, runtime } = createSqlFixture();
        const result = await loadAndExecuteSql(fixture, runtime, { op: 'introspect' });
        const introspect = result as { keys: string[] };
        // Raw services MUST be absent from the ctx.
        for (const forbidden of ['storage', 'files', 'jobs', 'events', 'core', 'runtime', 'permissions', 'fs', 'blob', 'user', 'session']) {
            expect(introspect.keys).not.toContain(forbidden);
        }
    });

    it('no raw dbPath is exposed to companion code via ctx.sql', async () => {
        const { fixture, runtime } = createSqlFixture();
        // Spy on the underlying core.querySql to capture the dbPath argument.
        // The wrapper resolves dbPath internally; companion code never sees it.
        const querySpy = runtime.core.querySql as unknown as ReturnType<typeof vi.fn>;
        await loadAndExecuteSql(fixture, runtime, { op: 'query', database: 'test-db', statement: 'SELECT 1' });
        expect(querySpy).toHaveBeenCalledTimes(1);
        const dbPathArg = querySpy.mock.calls[0]?.[0];
        // dbPath is a non-empty absolute filesystem path ending in .sqlite.
        expect(typeof dbPathArg).toBe('string');
        expect(dbPathArg.length).toBeGreaterThan(0);
        expect(dbPathArg.endsWith('.sqlite')).toBe(true);
        // The dbPath must be rooted under the OWNER extension's private SQL
        // directory, not the caller extension's. The owner extension is
        // 'third-party/sql-extension' (derived from the directory name).
        expect(dbPathArg).toContain('sql-extension');
        // And must NOT reference the caller extension ('third-party/test-extension').
        expect(dbPathArg).not.toContain('test-extension');
    });

    it('query: wrapper calls CoreService.querySql with dbPath resolved from ownerExtensionId', async () => {
        const { fixture, runtime } = createSqlFixture();
        const querySpy = runtime.core.querySql as unknown as ReturnType<typeof vi.fn>;
        await loadAndExecuteSql(fixture, runtime, { op: 'query', database: 'test-db', statement: 'SELECT 1 AS one' });
        expect(querySpy).toHaveBeenCalledTimes(1);
        const [dbPathArg, requestArg] = querySpy.mock.calls[0] as [string, { database: string; statement: string; params?: unknown[] }];
        // dbPath is rooted under the OWNER extension's directory.
        expect(dbPathArg).toContain('sql-extension');
        // The wrapper passes the normalized database name through.
        expect(requestArg.database).toBe('test-db');
        expect(requestArg.statement).toBe('SELECT 1 AS one');
    });

    it('query: extensionId is owner not caller', async () => {
        const { fixture, runtime } = createSqlFixture();
        const querySpy = runtime.core.querySql as unknown as ReturnType<typeof vi.fn>;
        await loadAndExecuteSql(fixture, runtime, { op: 'query', database: 'test-db' });
        expect(querySpy).toHaveBeenCalledTimes(1);
        const dbPathArg = querySpy.mock.calls[0]?.[0] as string;
        // The wrapper resolved the dbPath using the OWNER extension id
        // ('third-party/sql-extension'), NOT the caller extension id
        // ('third-party/test-extension' from session.extension.id).
        expect(dbPathArg).toContain('sql-extension');
        expect(dbPathArg).not.toContain('test-extension');
    });

    it('query: authorizes sql.private before the service call; denial prevents service call', async () => {
        const { fixture, runtime } = createSqlFixture();
        const user = createUser(false, fixture.sillyTavernRoot);
        const session = createSession(user);
        await runtime.permissions.resolve(user, session, { resource: 'sql.private', target: 'test-db' }, 'deny');
        const querySpy = runtime.core.querySql as unknown as ReturnType<typeof vi.fn>;
        await runtime.loader.loadAll(createDiscovery(fixture).discover());
        let caught: unknown;
        try {
            await runtime.modules.execute(user, session, 'third-party.sql-extension', 'task.run', {
                input: { op: 'query', database: 'test-db' },
            });
        } catch (error) {
            caught = error;
        }
        expect(caught).toBeInstanceOf(AuthorityServiceError);
        const err = caught as AuthorityServiceError;
        expect(err.status).toBe(403);
        expect(err.code).toBe('permission_not_granted');
        expect(querySpy).not.toHaveBeenCalled();
    });

    it('query: undefined database is normalized to default for authorization', async () => {
        const { fixture, runtime } = createSqlFixture();
        const user = createUser(false, fixture.sillyTavernRoot);
        const session = createSession(user);
        const authorizeSpy = vi.spyOn(runtime.permissions, 'authorize');
        await runtime.loader.loadAll(createDiscovery(fixture).discover());
        await runtime.modules.execute(user, session, 'third-party.sql-extension', 'task.run', {
            input: { op: 'query' },
        });
        const sqlCall = authorizeSpy.mock.calls.find(call => call[2]?.resource === 'sql.private');
        expect(sqlCall).toBeDefined();
        expect(sqlCall?.[2]?.target).toBe('default');
    });

    it('query: page.limit clamped to 1000 (does not reject)', async () => {
        const { fixture, runtime } = createSqlFixture();
        const querySpy = runtime.core.querySql as unknown as ReturnType<typeof vi.fn>;
        await loadAndExecuteSql(fixture, runtime, {
            op: 'query',
            database: 'test-db',
            statement: 'SELECT 1',
            page: { limit: 99999 },
        });
        expect(querySpy).toHaveBeenCalledTimes(1);
        const requestArg = querySpy.mock.calls[0]?.[1] as { page?: { limit: number } };
        expect(requestArg.page?.limit).toBe(1000);
    });

    it('query: does not mutate the caller page object', async () => {
        const { fixture, runtime } = createSqlFixture();
        const querySpy = runtime.core.querySql as unknown as ReturnType<typeof vi.fn>;
        const callerPage = { limit: 99999 };
        await loadAndExecuteSql(fixture, runtime, {
            op: 'query',
            database: 'test-db',
            statement: 'SELECT 1',
            page: callerPage,
        });
        // Caller's limit must be untouched.
        expect(callerPage.limit).toBe(99999);
        // Service received the clamped copy.
        const requestArg = querySpy.mock.calls[0]?.[1] as { page?: { limit: number } };
        expect(requestArg.page?.limit).toBe(1000);
    });

    it('exec: wrapper calls CoreService.execSql with dbPath resolved from ownerExtensionId', async () => {
        const { fixture, runtime } = createSqlFixture();
        const execSpy = runtime.core.execSql as unknown as ReturnType<typeof vi.fn>;
        await loadAndExecuteSql(fixture, runtime, { op: 'exec', database: 'test-db', statement: 'CREATE TABLE t (id INTEGER)' });
        expect(execSpy).toHaveBeenCalledTimes(1);
        const [dbPathArg, requestArg] = execSpy.mock.calls[0] as [string, { database: string; statement: string }];
        expect(dbPathArg).toContain('sql-extension');
        expect(dbPathArg).not.toContain('test-extension');
        expect(requestArg.database).toBe('test-db');
        expect(requestArg.statement).toBe('CREATE TABLE t (id INTEGER)');
    });

    it('exec: authorizes sql.private before the service call; denial prevents service call', async () => {
        const { fixture, runtime } = createSqlFixture();
        const user = createUser(false, fixture.sillyTavernRoot);
        const session = createSession(user);
        await runtime.permissions.resolve(user, session, { resource: 'sql.private', target: 'test-db' }, 'deny');
        const execSpy = runtime.core.execSql as unknown as ReturnType<typeof vi.fn>;
        await runtime.loader.loadAll(createDiscovery(fixture).discover());
        let caught: unknown;
        try {
            await runtime.modules.execute(user, session, 'third-party.sql-extension', 'task.run', {
                input: { op: 'exec', database: 'test-db', statement: 'CREATE TABLE t (id INTEGER)' },
            });
        } catch (error) {
            caught = error;
        }
        expect(caught).toBeInstanceOf(AuthorityServiceError);
        const err = caught as AuthorityServiceError;
        expect(err.status).toBe(403);
        expect(err.code).toBe('permission_not_granted');
        expect(execSpy).not.toHaveBeenCalled();
    });

    it('transaction: wrapper calls CoreService.transactionSql with dbPath resolved from ownerExtensionId', async () => {
        const { fixture, runtime } = createSqlFixture();
        const txSpy = runtime.core.transactionSql as unknown as ReturnType<typeof vi.fn>;
        await loadAndExecuteSql(fixture, runtime, {
            op: 'transaction',
            database: 'test-db',
            statements: [{ statement: 'CREATE TABLE t (id INTEGER)' }],
        });
        expect(txSpy).toHaveBeenCalledTimes(1);
        const [dbPathArg, requestArg] = txSpy.mock.calls[0] as [string, { database: string; statements: unknown[] }];
        expect(dbPathArg).toContain('sql-extension');
        expect(dbPathArg).not.toContain('test-extension');
        expect(requestArg.database).toBe('test-db');
        expect(requestArg.statements).toHaveLength(1);
    });

    it('transaction: hard-rejects over-cap statements with 400 validation_error', async () => {
        const { fixture, runtime } = createSqlFixture();
        // MAX_SQL_BATCH_STATEMENTS = 100; send 101 statements.
        const statements = Array.from({ length: 101 }, () => ({ statement: 'SELECT 1' }));
        const user = createUser(false, fixture.sillyTavernRoot);
        const session = createSession(user);
        const txSpy = runtime.core.transactionSql as unknown as ReturnType<typeof vi.fn>;
        await runtime.loader.loadAll(createDiscovery(fixture).discover());
        let caught: unknown;
        try {
            await runtime.modules.execute(user, session, 'third-party.sql-extension', 'task.run', {
                input: { op: 'transaction', database: 'test-db', statements },
            });
        } catch (error) {
            caught = error;
        }
        expect(caught).toBeInstanceOf(AuthorityServiceError);
        const err = caught as AuthorityServiceError;
        expect(err.status).toBe(400);
        expect(err.code).toBe('validation_error');
        // The wrapper hard-rejects BEFORE the service call.
        expect(txSpy).not.toHaveBeenCalled();
    });

    it('transaction: exactly-100 statements accepted (boundary)', async () => {
        const { fixture, runtime } = createSqlFixture();
        const txSpy = runtime.core.transactionSql as unknown as ReturnType<typeof vi.fn>;
        const statements = Array.from({ length: 100 }, () => ({ statement: 'SELECT 1' }));
        await loadAndExecuteSql(fixture, runtime, {
            op: 'transaction',
            database: 'test-db',
            statements,
        });
        expect(txSpy).toHaveBeenCalledTimes(1);
    });

    it('migrate: wrapper calls CoreService.migrateSql with dbPath resolved from ownerExtensionId', async () => {
        const { fixture, runtime } = createSqlFixture();
        const migrateSpy = runtime.core.migrateSql as unknown as ReturnType<typeof vi.fn>;
        await loadAndExecuteSql(fixture, runtime, {
            op: 'migrate',
            database: 'test-db',
            migrations: [{ id: '0001', statement: 'CREATE TABLE t (id INTEGER)' }],
            tableName: 'custom_migrations',
        });
        expect(migrateSpy).toHaveBeenCalledTimes(1);
        const [dbPathArg, requestArg] = migrateSpy.mock.calls[0] as [string, { database: string; migrations: unknown[]; tableName?: string }];
        expect(dbPathArg).toContain('sql-extension');
        expect(dbPathArg).not.toContain('test-extension');
        expect(requestArg.database).toBe('test-db');
        expect(requestArg.migrations).toHaveLength(1);
        expect(requestArg.tableName).toBe('custom_migrations');
    });

    it('migrate: tableName passes through when omitted (core uses default)', async () => {
        const { fixture, runtime } = createSqlFixture();
        const migrateSpy = runtime.core.migrateSql as unknown as ReturnType<typeof vi.fn>;
        await loadAndExecuteSql(fixture, runtime, {
            op: 'migrate',
            database: 'test-db',
            migrations: [{ id: '0001', statement: 'CREATE TABLE t (id INTEGER)' }],
        });
        expect(migrateSpy).toHaveBeenCalledTimes(1);
        const requestArg = migrateSpy.mock.calls[0]?.[1] as { database: string; migrations: unknown[]; tableName?: string };
        expect(requestArg.database).toBe('test-db');
        expect(requestArg.migrations).toHaveLength(1);
        // tableName is not passed through when the caller omits it; the
        // core applies its own default ('_authority_migrations').
        expect(requestArg.tableName).toBeUndefined();
    });
});

void AUTHORITY_VERSION;
void AUTHORITY_MODULE_PROTOCOL_VERSION;
void (undefined as unknown as AuthorityModuleManifest);

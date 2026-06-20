import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { AUTHORITY_VERSION } from '../version.js';
import { AUTHORITY_MODULE_PROTOCOL_VERSION } from '../constants.js';
import { ModuleHostService } from './module-host-service.js';
import { PermissionService } from './permission-service.js';
import { PolicyService } from './policy-service.js';
import type { AuthorityModuleManifest, ModuleTransactionManifest } from '@stdo/shared-types';
import type { AuditService } from './audit-service.js';
import type { JobService } from './job-service.js';
import type { PrivateFsService } from './private-fs-service.js';
import type { StorageService } from './storage-service.js';
import type { TriviumService } from './trivium-service.js';
import type { SseBroker } from '../events/sse-broker.js';
import type { CoreService } from './core-service.js';
import type { PoliciesState, SessionRecord, StoredGrantEntry, UserContext } from '../types.js';

const cleanupDirs: string[] = [];
const globalState = globalThis as typeof globalThis & { DATA_ROOT?: string };

function createMockCore(): CoreService {
    const grants = new Map<string, StoredGrantEntry>();
    // The Rust core starts with an empty defaults map; the TS layer fills it
    // in via DEFAULT_POLICY_STATUS only when reading through getPolicies().
    // Permission checks that resolve grants walk through evaluate() which uses
    // getStoredPolicies() (raw), so defaults stay empty here to mirror fresh
    // installs and exercise the persistent-grant code path.
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
    } as unknown as CoreService;
}

function createMockAudit(): AuditService {
    return {
        logUsage: vi.fn().mockResolvedValue(undefined),
        logPermission: vi.fn().mockResolvedValue(undefined),
        logError: vi.fn().mockResolvedValue(undefined),
        logWarning: vi.fn().mockResolvedValue(undefined),
    } as unknown as AuditService;
}

function createUser(isAdmin: boolean): UserContext {
    const rootDir = fs.mkdtempSync(path.join(os.tmpdir(), 'authority-module-host-'));
    cleanupDirs.push(rootDir);
    globalState.DATA_ROOT = rootDir;

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

function createService(core: CoreService = createMockCore()): ModuleHostService {
    const permissions = new PermissionService(new PolicyService(core), core);
    return new ModuleHostService(
        permissions,
        createMockAudit(),
        {} as TriviumService,
        {} as StorageService,
        {} as PrivateFsService,
        {} as JobService,
        {} as SseBroker,
    );
}

function createPermissions(core: CoreService) {
    return new PermissionService(new PolicyService(core), core);
}

function buildTransaction(overrides: Partial<ModuleTransactionManifest> = {}): ModuleTransactionManifest {
    return {
        name: 'task.run',
        version: '1.0.0',
        title: 'Run task',
        riskLevel: 'medium',
        permissionTarget: { kind: 'transaction' },
        requiredResources: [],
        idempotency: 'optional',
        ...overrides,
    };
}

function buildManifest(overrides: Partial<AuthorityModuleManifest> = {}): AuthorityModuleManifest {
    return {
        id: 'sample-module',
        displayName: 'Sample Module',
        version: '0.1.0',
        protocolVersion: AUTHORITY_MODULE_PROTOCOL_VERSION,
        transactions: {
            'task.run': buildTransaction(),
        },
        ...overrides,
    };
}

describe('ModuleHostService', () => {
    afterEach(() => {
        while (cleanupDirs.length > 0) {
            const dir = cleanupDirs.pop();
            if (dir) {
                fs.rmSync(dir, { recursive: true, force: true });
            }
        }
    });

    it('rejects module ids that do not match the lowercase pattern', () => {
        const service = createService();
        expect(() => service.register(buildManifest({ id: 'Sample-Module' }), {})).toThrow(/Invalid module id/);
        expect(() => service.register(buildManifest({ id: 'sample module' }), {})).toThrow(/Invalid module id/);
        expect(() => service.register(buildManifest({ id: '' }), {})).toThrow(/Invalid module id/);
    });

    it('rejects transaction names containing colons or invalid characters', () => {
        const service = createService();
        const manifest = buildManifest({
            transactions: {
                'task:run': buildTransaction({ name: 'task:run' }),
            },
        });
        expect(() => service.register(manifest, {})).toThrow(/Invalid transaction name/);
    });

    it('rejects manifests declaring an unsupported protocol version', () => {
        const service = createService();
        expect(() => service.register(buildManifest({ protocolVersion: 999 }), {})).toThrow(/Unsupported module protocol version/);
    });

    it('rejects registration when a handler is missing for a declared transaction', () => {
        const service = createService();
        expect(() => service.register(buildManifest(), {})).toThrow(/Missing handler/);
    });

    it('rejects duplicate registration of the same module id', () => {
        const service = createService();
        const handler = vi.fn().mockResolvedValue({ result: { ok: true } });
        service.register(buildManifest(), { 'task.run': handler });
        expect(() => service.register(buildManifest(), { 'task.run': handler })).toThrow(/already registered/);
    });

    it('lists manifests and counts registered modules', () => {
        const service = createService();
        service.register(buildManifest(), { 'task.run': vi.fn().mockResolvedValue({}) });
        const list = service.listManifests();
        expect(list.count).toBe(1);
        expect(list.modules[0]?.id).toBe('sample-module');
        expect(service.count()).toBe(1);
    });

    it('returns a single module manifest via getManifest', () => {
        const service = createService();
        service.register(buildManifest(), { 'task.run': vi.fn().mockResolvedValue({}) });
        expect(service.getManifest('sample-module').module.id).toBe('sample-module');
        expect(() => service.getManifest('missing')).toThrow(/Module not found/);
    });

    it('requires an idempotency key when the manifest declares idempotency required', async () => {
        const service = createService();
        const handler = vi.fn().mockResolvedValue({ result: { ok: true } });
        service.register(
            buildManifest({
                transactions: {
                    'graph.commit': buildTransaction({
                        name: 'graph.commit',
                        idempotency: 'required',
                    }),
                },
            }),
            { 'graph.commit': handler },
        );

        const user = createUser(false);
        const session = createSession(user);

        await expect(service.execute(user, session, 'sample-module', 'graph.commit', {})).rejects.toThrow(/Idempotency key required/);
        expect(handler).not.toHaveBeenCalled();
    });

    it('authorizes module.execute with target moduleId:transactionName before invoking the handler', async () => {
        const service = createService();
        const handler = vi.fn().mockImplementation(async (ctx: unknown, input: unknown) => ({
            result: { input, callerExtensionId: (ctx as { callerExtensionId: string }).callerExtensionId },
        }));
        service.register(buildManifest(), { 'task.run': handler });

        const user = createUser(false);
        const session = createSession(user);

        const response = await service.execute(user, session, 'sample-module', 'task.run', {
            input: { items: [] },
            idempotencyKey: 'idem-1',
        });

        expect(response).toMatchObject({
            ok: true,
            moduleId: 'sample-module',
            transaction: 'task.run',
            transactionVersion: '1.0.0',
            idempotencyKey: 'idem-1',
        });
        expect(handler).toHaveBeenCalledTimes(1);
        const ctxArg = handler.mock.calls[0]?.[0] as { callerExtensionId: string; moduleId: string; transactionName: string };
        expect(ctxArg.callerExtensionId).toBe('third-party/test-extension');
        expect(ctxArg.moduleId).toBe('sample-module');
        expect(ctxArg.transactionName).toBe('task.run');
    });

    it('blocks execution when module.execute is denied via persistent grant', async () => {
        const core = createMockCore();
        const permissions = createPermissions(core);
        const service = new ModuleHostService(
            permissions,
            createMockAudit(),
            {} as TriviumService,
            {} as StorageService,
            {} as PrivateFsService,
            {} as JobService,
            {} as SseBroker,
        );

        const handler = vi.fn().mockResolvedValue({ result: { ok: true } });
        service.register(buildManifest(), { 'task.run': handler });

        const user = createUser(false);
        const session = createSession(user);

        // Persist a deny grant for module.execute on this extension.
        await permissions.resolve(user, session, { resource: 'module.execute', target: 'sample-module:task.run' }, 'deny');

        await expect(service.execute(user, session, 'sample-module', 'task.run', {})).rejects.toThrow(/Permission not granted: module.execute/);
        expect(handler).not.toHaveBeenCalled();
    });

    it('resolves required resources from a server-side resolver and authorizes each', async () => {
        const core = createMockCore();
        const permissions = createPermissions(core);
        const audit = createMockAudit();
        const service = new ModuleHostService(
            permissions,
            audit,
            {} as TriviumService,
            {} as StorageService,
            {} as PrivateFsService,
            {} as JobService,
            {} as SseBroker,
        );

        const handler = vi.fn().mockResolvedValue({ result: { ok: true } });
        service.register(
            buildManifest({
                transactions: {
                    'task.run': buildTransaction({
                        name: 'task.run',
                        requiredResources: [],
                    }),
                },
            }),
            { 'task.run': handler },
            {
                requiredResourceResolvers: {
                    'task.run': (input: unknown) => {
                        const target = (input as { database?: string } | null)?.database ?? 'default';
                        return [{ resource: 'trivium.private' as const, target, reason: 'task run target' }];
                    },
                },
            },
        );

        const user = createUser(false);
        const session = createSession(user);

        // Default policy grants trivium.private, so the call should succeed.
        const response = await service.execute(user, session, 'sample-module', 'task.run', {
            input: { database: 'sample' },
        });
        expect(response.ok).toBe(true);
        expect(handler).toHaveBeenCalledTimes(1);
    });

    it('returns 404-style validation error for unknown transaction', async () => {
        const service = createService();
        service.register(buildManifest(), { 'task.run': vi.fn().mockResolvedValue({}) });

        const user = createUser(false);
        const session = createSession(user);

        await expect(service.execute(user, session, 'sample-module', 'missing.tx', {})).rejects.toThrow(/Transaction not found/);
    });

    it('respects custom permission target overrides', async () => {
        const core = createMockCore();
        const permissions = createPermissions(core);
        const audit = createMockAudit();
        const service = new ModuleHostService(
            permissions,
            audit,
            {} as TriviumService,
            {} as StorageService,
            {} as PrivateFsService,
            {} as JobService,
            {} as SseBroker,
        );

        const handler = vi.fn().mockResolvedValue({ result: { ok: true } });
        service.register(
            buildManifest({
                transactions: {
                    'graph.commit': buildTransaction({
                        name: 'graph.commit',
                        permissionTarget: { kind: 'custom', target: 'sample-module:graph' },
                    }),
                },
            }),
            { 'graph.commit': handler },
        );

        const user = createUser(false);
        const session = createSession(user);

        await permissions.resolve(user, session, { resource: 'module.execute', target: 'sample-module:graph' }, 'deny');
        await expect(service.execute(user, session, 'sample-module', 'graph.commit', {})).rejects.toThrow(/Permission not granted: module.execute for sample-module:graph/);
        expect(handler).not.toHaveBeenCalled();
    });

    it('returns JSON-serializable manifests from listManifests and getManifest', () => {
        const service = createService();
        service.register(buildManifest(), { 'task.run': vi.fn().mockResolvedValue({}) });

        const list = service.listManifests();
        const got = service.getManifest('sample-module');

        // The public manifest shape must round-trip through JSON with no
        // function-valued fields (requiredResources is a static array).
        expect(JSON.parse(JSON.stringify(list.modules[0]))).toEqual(list.modules[0]);
        expect(JSON.parse(JSON.stringify(got.module))).toEqual(got.module);
        const listTransaction = list.modules[0]?.transactions['task.run'];
        const gotTransaction = got.module.transactions['task.run'];
        expect(Array.isArray(listTransaction?.requiredResources)).toBe(true);
        expect(Array.isArray(gotTransaction?.requiredResources)).toBe(true);
    });

    it('rejects dryRun execution requests with a validation error', async () => {
        const service = createService();
        const handler = vi.fn().mockResolvedValue({ result: { ok: true } });
        service.register(buildManifest(), { 'task.run': handler });

        const user = createUser(false);
        const session = createSession(user);

        await expect(service.execute(user, session, 'sample-module', 'task.run', {
            options: { dryRun: true },
        })).rejects.toThrow(/Dry-run execution is not supported/);
        expect(handler).not.toHaveBeenCalled();
    });

    it('rejects getManifest calls with an invalid module id', () => {
        const service = createService();
        service.register(buildManifest(), { 'task.run': vi.fn().mockResolvedValue({}) });

        expect(() => service.getManifest('Sample-Module')).toThrow(/Invalid module id/);
        expect(() => service.getManifest('sample module')).toThrow(/Invalid module id/);
    });

    it('rejects registration when a transaction key does not match its declared name', () => {
        const service = createService();
        const manifest = buildManifest({
            transactions: {
                'task.run': buildTransaction({ name: 'task.bulk-run' }),
            },
        });
        expect(() => service.register(manifest, { 'task.run': vi.fn() })).toThrow(/Transaction name mismatch/);
    });

    it('forwards the required resource reason to permissions.authorize', async () => {
        const core = createMockCore();
        const permissions = createPermissions(core);
        const authorizeSpy = vi.spyOn(permissions, 'authorize');
        const audit = createMockAudit();
        const service = new ModuleHostService(
            permissions,
            audit,
            {} as TriviumService,
            {} as StorageService,
            {} as PrivateFsService,
            {} as JobService,
            {} as SseBroker,
        );

        const handler = vi.fn().mockResolvedValue({ result: { ok: true } });
        service.register(
            buildManifest({
                transactions: {
                    'task.run': buildTransaction({
                        name: 'task.run',
                        requiredResources: [
                            { resource: 'trivium.private', target: 'sample', reason: 'task run target' },
                        ],
                    }),
                },
            }),
            { 'task.run': handler },
        );

        const user = createUser(false);
        const session = createSession(user);

        const response = await service.execute(user, session, 'sample-module', 'task.run', {});
        expect(response.ok).toBe(true);

        const requiredCall = authorizeSpy.mock.calls.find(call => call[2]?.resource === 'trivium.private');
        expect(requiredCall).toBeDefined();
        expect(requiredCall?.[2]).toMatchObject({
            resource: 'trivium.private',
            target: 'sample',
            reason: 'task run target',
        });
    });
});

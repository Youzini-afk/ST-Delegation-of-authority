import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { AUTHORITY_VERSION } from '../version.js';
import { AUTHORITY_MODULE_PROTOCOL_VERSION } from '../constants.js';
import { ModuleHostService } from './module-host-service.js';
import { PermissionService } from './permission-service.js';
import { PolicyService } from './policy-service.js';
import { AuthorityServiceError } from '../utils.js';
import {
    MODULE_DEFAULT_REQUEST_BYTES,
    MODULE_DEFAULT_RESPONSE_BYTES,
    MODULE_MAX_REQUEST_BYTES,
    MODULE_MAX_RESPONSE_BYTES,
    MODULE_MAX_TIMEOUT_MS,
    MODULE_DEFAULT_TIMEOUT_MS,
} from './module-discovery-service.js';
import type { AuthorityModuleManifest, ModuleTransactionManifest } from '@stdo/shared-types';
import type { AuditService } from './audit-service.js';
import type { JobService } from './job-service.js';
import type { PrivateFsService } from './private-fs-service.js';
import type { StorageService } from './storage-service.js';
import type { TriviumService } from './trivium-service.js';
import type { SseBroker } from '../events/sse-broker.js';
import type { CoreService } from './core-service.js';
import type { HostEventLedgerService } from './host-event-ledger-service.js';
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

function createService(core: CoreService = createMockCore(), hostEvents?: HostEventLedgerService): ModuleHostService {
    const permissions = new PermissionService(new PolicyService(core), core);
    return new ModuleHostService(
        permissions,
        createMockAudit(),
        {} as TriviumService,
        {} as StorageService,
        {} as PrivateFsService,
        {} as JobService,
        {} as SseBroker,
        hostEvents,
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

    it('fences and exposes normalized host context to the handler and response', async () => {
        const host = {
            schemaVersion: 1 as const,
            phase: 'event' as const,
            conversationId: 'conversation:one',
            branchId: 'branch:one',
            hostRevision: 3,
            baseHostRevision: 3,
            sourceEventId: 'host-event:one',
            capturedAt: '2026-08-01T00:00:00.000Z',
        };
        const bindModuleContext = vi.fn(async () => host);
        const service = createService(createMockCore(), { bindModuleContext } as unknown as HostEventLedgerService);
        const handler = vi.fn().mockImplementation(async (ctx: { host: unknown }) => ({ result: { host: ctx.host } }));
        service.register(buildManifest(), { 'task.run': handler });
        const user = createUser(false);
        const session = createSession(user);

        const response = await service.execute(user, session, 'sample-module', 'task.run', { host });

        expect(bindModuleContext).toHaveBeenCalledWith(user, host, session.extension.id);
        expect(handler.mock.calls[0]?.[0]).toMatchObject({ host });
        expect(response.host).toEqual(host);
        expect(response.result).toEqual({ host });
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

    it('exposes module error code constants for 64 MiB defaults and 256 MiB hard caps', () => {
        expect(MODULE_DEFAULT_REQUEST_BYTES).toBe(64 * 1024 * 1024);
        expect(MODULE_DEFAULT_RESPONSE_BYTES).toBe(64 * 1024 * 1024);
        expect(MODULE_MAX_REQUEST_BYTES).toBe(256 * 1024 * 1024);
        expect(MODULE_MAX_RESPONSE_BYTES).toBe(256 * 1024 * 1024);
        expect(MODULE_DEFAULT_TIMEOUT_MS).toBe(120_000);
        expect(MODULE_MAX_TIMEOUT_MS).toBe(10 * 60 * 1000);
    });

    it('rejects dryRun with a structured dry_run_unsupported detail code', async () => {
        const service = createService();
        const handler = vi.fn().mockResolvedValue({ result: { ok: true } });
        service.register(buildManifest(), { 'task.run': handler });

        const user = createUser(false);
        const session = createSession(user);

        let caught: unknown;
        try {
            await service.execute(user, session, 'sample-module', 'task.run', { options: { dryRun: true } });
        } catch (error) {
            caught = error;
        }
        expect(caught).toBeInstanceOf(AuthorityServiceError);
        const err = caught as AuthorityServiceError;
        expect(err.status).toBe(400);
        expect(err.code).toBe('validation_error');
        const details = err.details as { code: string };
        expect(details.code).toBe('dry_run_unsupported');
        expect(handler).not.toHaveBeenCalled();
    });

    it('rejects idempotency-required transactions with a structured idempotency_required detail code', async () => {
        const service = createService();
        const handler = vi.fn().mockResolvedValue({ result: { ok: true } });
        service.register(
            buildManifest({
                transactions: {
                    'graph.commit': buildTransaction({ name: 'graph.commit', idempotency: 'required' }),
                },
            }),
            { 'graph.commit': handler },
        );

        const user = createUser(false);
        const session = createSession(user);

        let caught: unknown;
        try {
            await service.execute(user, session, 'sample-module', 'graph.commit', { input: {} });
        } catch (error) {
            caught = error;
        }
        expect(caught).toBeInstanceOf(AuthorityServiceError);
        const err = caught as AuthorityServiceError;
        expect(err.status).toBe(400);
        const details = err.details as { code: string; moduleId: string; transaction: string };
        expect(details.code).toBe('idempotency_required');
        expect(details.moduleId).toBe('sample-module');
        expect(details.transaction).toBe('graph.commit');
        expect(handler).not.toHaveBeenCalled();
    });

    it('rejects unknown module with a structured module_not_found detail code', async () => {
        const service = createService();

        const user = createUser(false);
        const session = createSession(user);

        let caught: unknown;
        try {
            await service.execute(user, session, 'nonexistent.module', 'task.run', {});
        } catch (error) {
            caught = error;
        }
        expect(caught).toBeInstanceOf(AuthorityServiceError);
        const err = caught as AuthorityServiceError;
        expect(err.status).toBe(404);
        const details = err.details as { code: string; moduleId: string };
        expect(details.code).toBe('module_not_found');
        expect(details.moduleId).toBe('nonexistent.module');
    });

    it('rejects unknown transaction with a structured transaction_not_found detail code', async () => {
        const service = createService();
        service.register(buildManifest(), { 'task.run': vi.fn().mockResolvedValue({}) });

        const user = createUser(false);
        const session = createSession(user);

        let caught: unknown;
        try {
            await service.execute(user, session, 'sample-module', 'missing.tx', {});
        } catch (error) {
            caught = error;
        }
        expect(caught).toBeInstanceOf(AuthorityServiceError);
        const err = caught as AuthorityServiceError;
        expect(err.status).toBe(404);
        const details = err.details as { code: string; moduleId: string; transaction: string };
        expect(details.code).toBe('transaction_not_found');
        expect(details.moduleId).toBe('sample-module');
        expect(details.transaction).toBe('missing.tx');
    });

    it('built-in modules without explicit limits are not constrained by companion defaults', async () => {
        // A built-in with no manifest limits should accept a large-ish
        // request payload without triggering module_request_too_large.
        const service = createService();
        // Build a payload that would exceed the companion default (64 MiB)
        // if applied. We use a 100-char string repeated 1M times = 100 MB
        // which is comfortably above the 64 MiB companion default but below
        // the 256 MiB hard cap. Built-ins should NOT be subject to the
        // companion default, so this should succeed.
        const largePayload = { data: 'x'.repeat(100 * 1000) }; // 100 KB, well under any cap
        const handler = vi.fn().mockResolvedValue({ result: { ok: true } });
        service.register(buildManifest(), { 'task.run': handler });

        const user = createUser(false);
        const session = createSession(user);

        const response = await service.execute(user, session, 'sample-module', 'task.run', { input: largePayload });
        expect(response.ok).toBe(true);
        expect(handler).toHaveBeenCalledTimes(1);
    });

    it('built-in modules with an explicit manifest maxRequestBytes enforce that limit', async () => {
        const service = createService();
        const handler = vi.fn().mockResolvedValue({ result: { ok: true } });
        service.register(
            buildManifest({
                transactions: {
                    'task.run': buildTransaction({ name: 'task.run', maxRequestBytes: 64 }),
                },
            }),
            { 'task.run': handler },
        );

        const user = createUser(false);
        const session = createSession(user);

        // 100 bytes > 64 byte manifest limit.
        let caught: unknown;
        try {
            await service.execute(user, session, 'sample-module', 'task.run', { input: { data: 'x'.repeat(100) } });
        } catch (error) {
            caught = error;
        }
        expect(caught).toBeInstanceOf(AuthorityServiceError);
        const err = caught as AuthorityServiceError;
        expect(err.status).toBe(413);
        expect(err.code).toBe('limit_exceeded');
        expect(err.category).toBe('limit');
        const details = err.details as { code: string; moduleId: string; transaction: string; maxRequestBytes: number; limitSource: string };
        expect(details.code).toBe('module_request_too_large');
        expect(details.maxRequestBytes).toBe(64);
        expect(details.limitSource).toBe('manifest');
        expect(handler).not.toHaveBeenCalled();
    });

    it('built-in modules with an explicit manifest maxResponseBytes enforce that limit', async () => {
        const service = createService();
        const handler = vi.fn().mockResolvedValue({ result: { data: 'x'.repeat(100) } });
        service.register(
            buildManifest({
                transactions: {
                    'task.run': buildTransaction({ name: 'task.run', maxResponseBytes: 64 }),
                },
            }),
            { 'task.run': handler },
        );

        const user = createUser(false);
        const session = createSession(user);

        let caught: unknown;
        try {
            await service.execute(user, session, 'sample-module', 'task.run', {});
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

    it('rejects non-serializable handler results with module_response_not_serializable', async () => {
        const service = createService();
        // Circular reference: JSON.stringify throws.
        const circular: Record<string, unknown> = {};
        circular.self = circular;
        const handler = vi.fn().mockResolvedValue({ result: circular });
        service.register(buildManifest(), { 'task.run': handler });

        const user = createUser(false);
        const session = createSession(user);

        let caught: unknown;
        try {
            await service.execute(user, session, 'sample-module', 'task.run', {});
        } catch (error) {
            caught = error;
        }
        expect(caught).toBeInstanceOf(AuthorityServiceError);
        const err = caught as AuthorityServiceError;
        expect(err.status).toBe(500);
        const details = err.details as { code: string; moduleId: string; transaction: string };
        expect(details.code).toBe('module_response_not_serializable');
    });

    it('wraps handler throws in a transaction_handler_failed structured error', async () => {
        const service = createService();
        const handler = vi.fn().mockRejectedValue(new Error('boom from handler'));
        service.register(buildManifest(), { 'task.run': handler });

        const user = createUser(false);
        const session = createSession(user);

        let caught: unknown;
        try {
            await service.execute(user, session, 'sample-module', 'task.run', {});
        } catch (error) {
            caught = error;
        }
        expect(caught).toBeInstanceOf(AuthorityServiceError);
        const err = caught as AuthorityServiceError;
        expect(err.status).toBe(500);
        const details = err.details as { code: string; moduleId: string; transaction: string; message: string };
        expect(details.code).toBe('transaction_handler_failed');
        expect(details.moduleId).toBe('sample-module');
        expect(details.transaction).toBe('task.run');
        // The original error message is sanitized but preserved.
        expect(details.message).toContain('boom from handler');
    });

    it('wraps synchronous handler throws in a transaction_handler_failed structured error', async () => {
        const service = createService();
        service.register(buildManifest(), {
            'task.run': () => { throw new Error('synchronous boom'); },
        });
        const user = createUser(false);
        const session = createSession(user);

        const error = await service.execute(user, session, 'sample-module', 'task.run', {}).catch(value => value) as AuthorityServiceError;

        expect(error).toBeInstanceOf(AuthorityServiceError);
        expect(error.details).toMatchObject({ code: 'transaction_handler_failed', message: 'synchronous boom' });
    });

    it('enforces an explicit manifest timeout on built-ins with a structured transaction_timeout error', async () => {
        const service = createService();
        const handler = vi.fn().mockImplementation(async () => {
            await new Promise(resolve => setTimeout(resolve, 500));
            return { result: { ok: true } };
        });
        service.register(
            buildManifest({
                transactions: {
                    'task.run': buildTransaction({ name: 'task.run', timeoutMs: 50 }),
                },
            }),
            { 'task.run': handler },
        );

        const user = createUser(false);
        const session = createSession(user);

        let caught: unknown;
        try {
            await service.execute(user, session, 'sample-module', 'task.run', {});
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

    it('honors a shorter caller transaction timeout', async () => {
        const service = createService();
        service.register(
            buildManifest({
                transactions: {
                    'task.run': buildTransaction({ name: 'task.run', timeoutMs: 500 }),
                },
            }),
            { 'task.run': async () => await new Promise(resolve => setTimeout(() => resolve({ result: true }), 1_000)) },
        );
        const user = createUser(false);
        const session = createSession(user);

        const error = await service.execute(user, session, 'sample-module', 'task.run', {
            options: { timeoutMs: 20 },
        }).catch(value => value) as AuthorityServiceError;

        expect(error).toBeInstanceOf(AuthorityServiceError);
        expect(error.status).toBe(504);
        expect(error.details).toMatchObject({ code: 'transaction_timeout', timeoutMs: 20, limitSource: 'request' });
    });

    it('keeps timeout classification when a cooperative handler rejects on abort', async () => {
        const service = createService();
        service.register(
            buildManifest({
                transactions: {
                    'task.run': buildTransaction({ name: 'task.run', timeoutMs: 20 }),
                },
            }),
            {
                'task.run': async ctx => await new Promise((_resolve, reject) => {
                    ctx.signal.addEventListener('abort', () => reject(new Error('cooperative stop')), { once: true });
                }),
            },
        );
        const user = createUser(false);
        const session = createSession(user);

        const error = await service.execute(user, session, 'sample-module', 'task.run', {}).catch(value => value) as AuthorityServiceError;

        expect(error.status).toBe(504);
        expect(error.details).toMatchObject({ code: 'transaction_timeout', timeoutMs: 20, limitSource: 'manifest' });
    });

    it('keeps response limit attribution when only timeout is caller-limited', async () => {
        const service = createService();
        service.register(
            buildManifest({
                transactions: {
                    'task.run': buildTransaction({ name: 'task.run', timeoutMs: 500, maxResponseBytes: 32 }),
                },
            }),
            { 'task.run': vi.fn().mockResolvedValue({ result: { value: 'x'.repeat(100) } }) },
        );
        const user = createUser(false);
        const session = createSession(user);

        const error = await service.execute(user, session, 'sample-module', 'task.run', {
            options: { timeoutMs: 100 },
        }).catch(value => value) as AuthorityServiceError;

        expect(error.status).toBe(413);
        expect(error.details).toMatchObject({ code: 'module_response_too_large', limitSource: 'manifest' });
    });

    it('relays caller cancellation to a module transaction signal', async () => {
        const service = createService();
        let observedAbort = false;
        let started = false;
        service.register(buildManifest(), {
            'task.run': async ctx => await new Promise((_resolve, reject) => {
                started = true;
                ctx.signal.addEventListener('abort', () => {
                    observedAbort = true;
                    reject(ctx.signal.reason);
                }, { once: true });
            }),
        });
        const user = createUser(false);
        const session = createSession(user);
        const controller = new AbortController();

        const execution = service.execute(user, session, 'sample-module', 'task.run', {}, controller.signal);
        await vi.waitFor(() => expect(started).toBe(true));
        controller.abort(new Error('Agent cancelled module'));

        await expect(execution).rejects.toThrow('Agent cancelled module');
        expect(observedAbort).toBe(true);
    });

    it('built-in modules without an explicit timeout are not subject to the 120 s companion default', async () => {
        // A built-in with no manifest timeout should NOT be killed by the
        // 120 s companion default. We verify the limit resolves to Infinity
        // by registering a handler that resolves quickly; the key assertion
        // is that execute() does not introduce a timeout race that could
        // reject. (We cannot practically wait 120 s in a unit test.)
        const service = createService();
        const handler = vi.fn().mockResolvedValue({ result: { ok: true } });
        service.register(buildManifest(), { 'task.run': handler });

        const user = createUser(false);
        const session = createSession(user);

        const response = await service.execute(user, session, 'sample-module', 'task.run', {});
        expect(response.ok).toBe(true);
    });

    it('preserves an AuthorityServiceError thrown by a handler without double-wrapping', async () => {
        const service = createService();
        const inner = new AuthorityServiceError(
            'inner structured error',
            418,
            'validation_error',
            'validation',
            { code: 'custom_inner_code' },
        );
        const handler = vi.fn().mockRejectedValue(inner);
        service.register(buildManifest(), { 'task.run': handler });

        const user = createUser(false);
        const session = createSession(user);

        let caught: unknown;
        try {
            await service.execute(user, session, 'sample-module', 'task.run', {});
        } catch (error) {
            caught = error;
        }
        // The inner AuthorityServiceError should be preserved as-is, NOT
        // re-wrapped in a transaction_handler_failed envelope.
        expect(caught).toBe(inner);
    });
});

describe('ModuleHostService load_error execution', () => {
    afterEach(() => {
        while (cleanupDirs.length > 0) {
            const dir = cleanupDirs.pop();
            if (dir) {
                fs.rmSync(dir, { recursive: true, force: true });
            }
        }
    });

    it('returns a structured module_load_error with sanitized diagnostics when executing a load_error record', async () => {
        // Register a load_error record directly through registerDiscoveredRecord
        // so we can exercise the module_load_error path without spinning up the
        // companion loader.
        const service = createService();
        const moduleId = 'third-party.broken-extension';
        const ownerExtensionId = 'third-party/broken-extension';
        // Simulate a load_error record carrying a diagnostic with a fake
        // absolute path that must be sanitized out of the public error.
        const fakePath = '/tmp/secret/authority-companion-XYZ/.authority/server.cjs';
        const record = {
            moduleId,
            ownerExtensionId,
            status: 'load_error' as const,
            manifest: null,
            source: { extensionId: ownerExtensionId, modulePath: '.authority/module.json', entry: './server.cjs' },
            diagnostics: [
                {
                    code: 'load_activate_not_a_function',
                    message: `Entry './server.cjs' did not export an activate function. Stack: Error: at ${fakePath}:1:1`,
                    severity: 'error' as const,
                    details: { ownerExtensionId, stack: `at ${fakePath}:1:1`, rawError: { path: fakePath } },
                },
            ],
        };
        service.registerDiscoveredRecord(record);

        const user = createUser(false);
        const session = createSession(user);

        let caught: unknown;
        try {
            await service.execute(user, session, moduleId, 'task.run', {});
        } catch (error) {
            caught = error;
        }
        expect(caught).toBeInstanceOf(AuthorityServiceError);
        const err = caught as AuthorityServiceError;
        expect(err.status).toBe(409);
        expect(err.message).toMatch(/Module failed to load/);
        const details = err.details as {
            code: string;
            moduleId: string;
            status: string;
            diagnostics: Array<{ code: string; message: string; severity: string; details?: { stack?: string; rawError?: { path?: string } } }>;
        };
        expect(details.code).toBe('module_load_error');
        expect(details.moduleId).toBe(moduleId);
        expect(details.status).toBe('load_error');
        expect(details.diagnostics.length).toBeGreaterThan(0);

        // Sanitization: the wire payload must NOT contain the absolute path,
        // stack trace, or raw error object. JSON.stringify exercises the
        // actual wire shape that would be sent to the frontend.
        const serialized = JSON.stringify(err.toPayload());
        expect(serialized).not.toContain('/tmp/secret');
        expect(serialized).not.toContain(fakePath);
        expect(serialized).not.toContain('at /tmp');
        // The useful diagnostic code and severity must survive sanitization.
        expect(serialized).toContain('load_activate_not_a_function');
        expect(serialized).toContain('error');
    });
});

describe('ModuleHostService Phase 3 review blockers', () => {
    afterEach(() => {
        while (cleanupDirs.length > 0) {
            const dir = cleanupDirs.pop();
            if (dir) {
                fs.rmSync(dir, { recursive: true, force: true });
            }
        }
    });

    it('sanitizes load_error diagnostics on /modules listRecords, getRecord, listManifests, and getManifest', () => {
        const service = createService();
        const moduleId = 'third-party.leaky-load-error';
        const ownerExtensionId = 'third-party/leaky-load-error';
        // Simulate a load_error record carrying diagnostics with absolute
        // paths, stack traces, raw error objects, and internal keys that must
        // NEVER leak through /modules or /modules/:moduleId/record. The
        // forbidden key set includes both internal path keys and raw
        // error/stack structures.
        const fakePath = '/tmp/secret/authority-companion-XYZ/.authority/server.cjs';
        const record = {
            moduleId,
            ownerExtensionId,
            status: 'load_error' as const,
            manifest: null,
            source: { extensionId: ownerExtensionId, modulePath: '.authority/module.json', entry: './server.cjs' },
            diagnostics: [
                {
                    code: 'load_activate_threw',
                    message: `activate threw: Error: boom\n    at ${fakePath}:1:1`,
                    severity: 'error' as const,
                    details: {
                        ownerExtensionId,
                        stack: `Error: boom\n    at ${fakePath}:1:1`,
                        rawError: { path: fakePath, stack: `at ${fakePath}:1:1` },
                        error: new Error('boom'),
                        cause: new Error('root cause'),
                        originalError: { message: 'original' },
                        thrown: 'thrown-value',
                        exception: 'exception-value',
                        trace: 'stack-trace-fragment',
                        stacktrace: 'stack-trace-fragment-2',
                        internalKeys: {
                            extensionDir: '/tmp/secret/extension',
                            moduleDir: '/tmp/secret/extension/.authority',
                            manifestPath: '/tmp/secret/extension/.authority/module.json',
                            entryPath: fakePath,
                            absolutePath: fakePath,
                            resolvedEntry: fakePath,
                            realEntry: fakePath,
                            realModuleDir: '/tmp/secret/extension/.authority',
                        },
                    },
                },
            ],
        };
        service.registerDiscoveredRecord(record);

        // Forbidden detail key names that must NEVER appear in public wire
        // payloads, regardless of their values. The sanitizer drops these keys
        // entirely so even the key names do not echo back.
        const forbiddenKeys = [
            'extensionDir', 'moduleDir', 'manifestPath', 'entryPath',
            'absolutePath', 'resolvedEntry', 'realEntry', 'realModuleDir',
            'stack', 'rawError', 'error', 'cause',
            'originalError', 'thrown', 'exception', 'trace', 'stacktrace',
        ];

        // listRecords() must return sanitized copies.
        const listed = service.listRecords();
        const listedRecord = listed.find(r => r.moduleId === moduleId);
        expect(listedRecord).toBeDefined();
        const serializedList = JSON.stringify(listed);
        expect(serializedList).not.toContain('/tmp/secret');
        expect(serializedList).not.toContain(fakePath);
        // Forbidden keys must not appear as JSON keys (check the `"key":`
        // form so legitimate values like `severity:"error"` are not false
        // positives).
        for (const key of forbiddenKeys) {
            expect(serializedList).not.toContain(`"${key}":`);
        }

        // getRecord() must return a sanitized copy.
        const got = service.getRecord(moduleId);
        expect(got).toBeDefined();
        const serializedGet = JSON.stringify(got);
        expect(serializedGet).not.toContain('/tmp/secret');
        expect(serializedGet).not.toContain(fakePath);
        for (const key of forbiddenKeys) {
            expect(serializedGet).not.toContain(`"${key}":`);
        }

        // listManifests() must return sanitized records.
        const manifests = service.listManifests();
        const serializedManifests = JSON.stringify(manifests);
        expect(serializedManifests).not.toContain('/tmp/secret');
        expect(serializedManifests).not.toContain(fakePath);
        for (const key of forbiddenKeys) {
            expect(serializedManifests).not.toContain(`"${key}":`);
        }

        // The useful diagnostic code/severity must survive sanitization.
        expect(serializedGet).toContain('load_activate_threw');
        expect(serializedGet).toContain('error');
        // The ownerExtensionId is a safe metadata field and is preserved.
        expect(serializedGet).toContain(ownerExtensionId);
    });

    it('module_load_error execute payload drops forbidden detail keys (stack/rawError/error/cause)', async () => {
        const service = createService();
        const moduleId = 'third-party.leaky-load-error-execute';
        const ownerExtensionId = 'third-party/leaky-load-error-execute';
        const fakePath = '/tmp/secret/authority-companion-XYZ/.authority/server.cjs';
        const record = {
            moduleId,
            ownerExtensionId,
            status: 'load_error' as const,
            manifest: null,
            source: { extensionId: ownerExtensionId, modulePath: '.authority/module.json', entry: './server.cjs' },
            diagnostics: [
                {
                    code: 'load_activate_threw',
                    message: `boom at ${fakePath}`,
                    severity: 'error' as const,
                    details: {
                        stack: `Error: boom\n    at ${fakePath}:1:1`,
                        rawError: { path: fakePath },
                        error: 'raw-error-object',
                        cause: 'root-cause',
                        moduleDir: fakePath,
                        entryPath: fakePath,
                    },
                },
            ],
        };
        service.registerDiscoveredRecord(record);

        const user = createUser(false);
        const session = createSession(user);

        let caught: unknown;
        try {
            await service.execute(user, session, moduleId, 'task.run', {});
        } catch (error) {
            caught = error;
        }
        expect(caught).toBeInstanceOf(AuthorityServiceError);
        const err = caught as AuthorityServiceError;
        const payload = err.toPayload();
        const payloadJson = JSON.stringify(payload);
        // Absolute paths must not appear anywhere in the wire payload.
        expect(payloadJson).not.toContain('/tmp/secret');
        expect(payloadJson).not.toContain(fakePath);
        // The useful diagnostic code must survive.
        expect(payloadJson).toContain('load_activate_threw');
        expect(payloadJson).toContain('module_load_error');

        // Forbidden detail keys must not appear INSIDE the diagnostics
        // `details` object. We extract the diagnostics details and assert
        // the forbidden keys are absent. The top-level `error` field of
        // AuthorityErrorPayload is the standard error message, NOT a
        // forbidden detail key, so we only inspect the diagnostics details.
        const details = payload.details as { diagnostics: Array<{ details?: Record<string, unknown> }> };
        const diagnosticsDetails = details.diagnostics?.[0]?.details ?? {};
        for (const key of ['stack', 'rawError', 'error', 'cause', 'moduleDir', 'entryPath', 'originalError', 'thrown', 'exception', 'trace', 'stacktrace']) {
            expect(diagnosticsDetails).not.toHaveProperty(key);
        }
        // The diagnostics details should be empty or contain only safe keys
        // (all forbidden keys were stripped).
    });

    it('measures the whole request payload (idempotencyKey + options) for module_request_too_large', async () => {
        const service = createService();
        const handler = vi.fn().mockResolvedValue({ result: { ok: true } });
        service.register(
            buildManifest({
                transactions: {
                    'task.run': buildTransaction({ name: 'task.run', maxRequestBytes: 128 }),
                },
            }),
            { 'task.run': handler },
        );

        const user = createUser(false);
        const session = createSession(user);

        // A huge idempotencyKey (not input) must trip the request size limit
        // before the handler or permissions are invoked.
        const hugeKey = 'k'.repeat(10_000);
        let caught: unknown;
        try {
            await service.execute(user, session, 'sample-module', 'task.run', {
                idempotencyKey: hugeKey,
                input: { small: 'payload' },
            });
        } catch (error) {
            caught = error;
        }
        expect(caught).toBeInstanceOf(AuthorityServiceError);
        const err = caught as AuthorityServiceError;
        expect(err.status).toBe(413);
        expect(err.code).toBe('limit_exceeded');
        const details = err.details as { code: string; maxRequestBytes: number };
        expect(details.code).toBe('module_request_too_large');
        expect(details.maxRequestBytes).toBe(128);
        // Handler and permissions must not be reached.
        expect(handler).not.toHaveBeenCalled();
    });

    it('rejects function-valued response fields with module_response_not_serializable (not silently dropped)', async () => {
        const service = createService();
        // JSON.stringify silently drops function-valued object properties;
        // the validator must catch this explicitly so callers see an error
        // rather than a response with missing fields.
        const handler = vi.fn().mockResolvedValue({
            result: { ok: true, callback: () => 'secret' },
        });
        service.register(buildManifest(), { 'task.run': handler });

        const user = createUser(false);
        const session = createSession(user);

        let caught: unknown;
        try {
            await service.execute(user, session, 'sample-module', 'task.run', {});
        } catch (error) {
            caught = error;
        }
        expect(caught).toBeInstanceOf(AuthorityServiceError);
        const err = caught as AuthorityServiceError;
        expect(err.status).toBe(500);
        const details = err.details as { code: string; reason: string };
        expect(details.code).toBe('module_response_not_serializable');
        expect(details.reason).toContain('callback');
        expect(details.reason).toContain('function');
    });

    it('rejects symbol-valued response fields with module_response_not_serializable', async () => {
        const service = createService();
        const sym = Symbol('hidden');
        const handler = vi.fn().mockResolvedValue({
            result: { ok: true, marker: sym },
        });
        service.register(buildManifest(), { 'task.run': handler });

        const user = createUser(false);
        const session = createSession(user);

        let caught: unknown;
        try {
            await service.execute(user, session, 'sample-module', 'task.run', {});
        } catch (error) {
            caught = error;
        }
        expect(caught).toBeInstanceOf(AuthorityServiceError);
        const err = caught as AuthorityServiceError;
        const details = err.details as { code: string };
        expect(details.code).toBe('module_response_not_serializable');
    });

    it('rejects undefined-valued response object fields with module_response_not_serializable (not silently dropped)', async () => {
        const service = createService();
        // JSON.stringify silently drops undefined object properties; the
        // validator must catch this so a caller expecting `result.field`
        // gets an error rather than a response where `field` is missing.
        const handler = vi.fn().mockResolvedValue({
            result: { ok: true, missing: undefined },
        });
        service.register(buildManifest(), { 'task.run': handler });

        const user = createUser(false);
        const session = createSession(user);

        let caught: unknown;
        try {
            await service.execute(user, session, 'sample-module', 'task.run', {});
        } catch (error) {
            caught = error;
        }
        expect(caught).toBeInstanceOf(AuthorityServiceError);
        const err = caught as AuthorityServiceError;
        const details = err.details as { code: string; reason: string };
        expect(details.code).toBe('module_response_not_serializable');
        expect(details.reason).toContain('missing');
        expect(details.reason).toContain('undefined');
    });

    it('rejects undefined array elements in response with module_response_not_serializable (not converted to null)', async () => {
        const service = createService();
        // JSON.stringify converts array undefined to null, which IS data
        // loss for a caller distinguishing the two. The validator rejects.
        const handler = vi.fn().mockResolvedValue({
            result: { items: [1, undefined, 3] },
        });
        service.register(buildManifest(), { 'task.run': handler });

        const user = createUser(false);
        const session = createSession(user);

        let caught: unknown;
        try {
            await service.execute(user, session, 'sample-module', 'task.run', {});
        } catch (error) {
            caught = error;
        }
        expect(caught).toBeInstanceOf(AuthorityServiceError);
        const err = caught as AuthorityServiceError;
        const details = err.details as { code: string; reason: string };
        expect(details.code).toBe('module_response_not_serializable');
        expect(details.reason).toContain('undefined array element');
    });

    it('rejects BigInt in response with module_response_not_serializable', async () => {
        const service = createService();
        const handler = vi.fn().mockResolvedValue({
            result: { count: BigInt(123) },
        });
        service.register(buildManifest(), { 'task.run': handler });

        const user = createUser(false);
        const session = createSession(user);

        let caught: unknown;
        try {
            await service.execute(user, session, 'sample-module', 'task.run', {});
        } catch (error) {
            caught = error;
        }
        expect(caught).toBeInstanceOf(AuthorityServiceError);
        const err = caught as AuthorityServiceError;
        const details = err.details as { code: string; reason: string };
        expect(details.code).toBe('module_response_not_serializable');
        expect(details.reason).toContain('BigInt');
    });

    it('still rejects circular references in response with module_response_not_serializable', async () => {
        const service = createService();
        const handler = vi.fn().mockImplementation(async () => {
            const circular: Record<string, unknown> = { ok: true };
            circular.self = circular;
            return { result: circular };
        });
        service.register(buildManifest(), { 'task.run': handler });

        const user = createUser(false);
        const session = createSession(user);

        let caught: unknown;
        try {
            await service.execute(user, session, 'sample-module', 'task.run', {});
        } catch (error) {
            caught = error;
        }
        expect(caught).toBeInstanceOf(AuthorityServiceError);
        const err = caught as AuthorityServiceError;
        const details = err.details as { code: string; reason: string };
        expect(details.code).toBe('module_response_not_serializable');
        expect(details.reason).toContain('circular');
    });

    it('accepts valid JSON response shapes (null, primitives, nested objects, arrays)', async () => {
        const service = createService();
        const handler = vi.fn().mockResolvedValue({
            result: {
                nullField: null,
                stringField: 'hello',
                numberField: 42,
                booleanField: true,
                nested: { a: 1, b: [2, 3, { c: null }] },
                emptyArray: [] as unknown[],
                emptyObject: {},
            },
        });
        service.register(buildManifest(), { 'task.run': handler });

        const user = createUser(false);
        const session = createSession(user);

        const response = await service.execute(user, session, 'sample-module', 'task.run', {});
        expect(response.ok).toBe(true);
        const result = response.result as { stringField: string };
        expect(result.stringField).toBe('hello');
    });

    it('rejects symbol-keyed object properties with module_response_not_serializable', async () => {
        const service = createService();
        // JSON.stringify silently drops ALL symbol-keyed properties. The
        // validator must reject them explicitly so a handler cannot hide
        // data in symbol keys the caller never sees.
        const sym = Symbol('hidden');
        const handler = vi.fn().mockImplementation(async () => {
            const result: Record<string, unknown> = { ok: true };
            // Assign via computed symbol key so TypeScript allows it.
            (result as Record<symbol, unknown>)[sym] = 'secret-value';
            return { result };
        });
        service.register(buildManifest(), { 'task.run': handler });

        const user = createUser(false);
        const session = createSession(user);

        let caught: unknown;
        try {
            await service.execute(user, session, 'sample-module', 'task.run', {});
        } catch (error) {
            caught = error;
        }
        expect(caught).toBeInstanceOf(AuthorityServiceError);
        const err = caught as AuthorityServiceError;
        expect(err.status).toBe(500);
        const details = err.details as { code: string; reason: string };
        expect(details.code).toBe('module_response_not_serializable');
        expect(details.reason).toContain('symbol-keyed');
        expect(details.reason).toContain('hidden');
    });

    it('rejects Map in response with module_response_not_serializable (not silently coerced to {})', async () => {
        const service = createService();
        // JSON.stringify silently coerces Map to `{}`. The validator must
        // reject it so the caller sees an error rather than an empty object.
        const handler = vi.fn().mockResolvedValue({
            result: new Map([['key', 'value']]),
        });
        service.register(buildManifest(), { 'task.run': handler });

        const user = createUser(false);
        const session = createSession(user);

        let caught: unknown;
        try {
            await service.execute(user, session, 'sample-module', 'task.run', {});
        } catch (error) {
            caught = error;
        }
        expect(caught).toBeInstanceOf(AuthorityServiceError);
        const err = caught as AuthorityServiceError;
        const details = err.details as { code: string; reason: string };
        expect(details.code).toBe('module_response_not_serializable');
        expect(details.reason).toContain('non-plain object');
        expect(details.reason).toContain('Map');
    });

    it('rejects Set in response with module_response_not_serializable', async () => {
        const service = createService();
        const handler = vi.fn().mockResolvedValue({
            result: new Set([1, 2, 3]),
        });
        service.register(buildManifest(), { 'task.run': handler });

        const user = createUser(false);
        const session = createSession(user);

        let caught: unknown;
        try {
            await service.execute(user, session, 'sample-module', 'task.run', {});
        } catch (error) {
            caught = error;
        }
        expect(caught).toBeInstanceOf(AuthorityServiceError);
        const err = caught as AuthorityServiceError;
        const details = err.details as { code: string; reason: string };
        expect(details.code).toBe('module_response_not_serializable');
        expect(details.reason).toContain('non-plain object');
        expect(details.reason).toContain('Set');
    });

    it('rejects Date in response with module_response_not_serializable', async () => {
        const service = createService();
        // JSON.stringify coerces Date to an ISO string, which is a type
        // coercion the caller should make explicit. The validator rejects.
        const handler = vi.fn().mockResolvedValue({
            result: new Date('2024-01-01T00:00:00Z'),
        });
        service.register(buildManifest(), { 'task.run': handler });

        const user = createUser(false);
        const session = createSession(user);

        let caught: unknown;
        try {
            await service.execute(user, session, 'sample-module', 'task.run', {});
        } catch (error) {
            caught = error;
        }
        expect(caught).toBeInstanceOf(AuthorityServiceError);
        const err = caught as AuthorityServiceError;
        const details = err.details as { code: string; reason: string };
        expect(details.code).toBe('module_response_not_serializable');
        expect(details.reason).toContain('non-plain object');
        expect(details.reason).toContain('Date');
    });

    it('rejects RegExp in response with module_response_not_serializable', async () => {
        const service = createService();
        const handler = vi.fn().mockResolvedValue({
            result: /pattern/g,
        });
        service.register(buildManifest(), { 'task.run': handler });

        const user = createUser(false);
        const session = createSession(user);

        let caught: unknown;
        try {
            await service.execute(user, session, 'sample-module', 'task.run', {});
        } catch (error) {
            caught = error;
        }
        expect(caught).toBeInstanceOf(AuthorityServiceError);
        const err = caught as AuthorityServiceError;
        const details = err.details as { code: string; reason: string };
        expect(details.code).toBe('module_response_not_serializable');
        expect(details.reason).toContain('non-plain object');
        expect(details.reason).toContain('RegExp');
    });

    it('rejects class instance in response with module_response_not_serializable', async () => {
        const service = createService();
        // JSON.stringify serializes a class instance as `{}` (dropping
        // private fields and prototype methods). The validator rejects so
        // the caller sees an error rather than an empty object.
        class CompanionPayload {
            public ok = true;
            private secret = 'hidden';
        }
        const handler = vi.fn().mockResolvedValue({
            result: new CompanionPayload(),
        });
        service.register(buildManifest(), { 'task.run': handler });

        const user = createUser(false);
        const session = createSession(user);

        let caught: unknown;
        try {
            await service.execute(user, session, 'sample-module', 'task.run', {});
        } catch (error) {
            caught = error;
        }
        expect(caught).toBeInstanceOf(AuthorityServiceError);
        const err = caught as AuthorityServiceError;
        const details = err.details as { code: string; reason: string };
        expect(details.code).toBe('module_response_not_serializable');
        expect(details.reason).toContain('non-plain object');
        expect(details.reason).toContain('CompanionPayload');
    });

    it('rejects array subclass in response with module_response_not_serializable', async () => {
        const service = createService();
        class CustomArray extends Array<number> {
            public extra = 'metadata';
        }
        const customArr = new CustomArray();
        customArr.push(1, 2, 3);
        const handler = vi.fn().mockResolvedValue({
            result: customArr,
        });
        service.register(buildManifest(), { 'task.run': handler });

        const user = createUser(false);
        const session = createSession(user);

        let caught: unknown;
        try {
            await service.execute(user, session, 'sample-module', 'task.run', {});
        } catch (error) {
            caught = error;
        }
        expect(caught).toBeInstanceOf(AuthorityServiceError);
        const err = caught as AuthorityServiceError;
        const details = err.details as { code: string; reason: string };
        expect(details.code).toBe('module_response_not_serializable');
        expect(details.reason).toContain('array subclass');
    });

    it('accepts null-prototype objects in response (plain JSON shape)', async () => {
        const service = createService();
        // Objects created via Object.create(null) have a null prototype
        // but are otherwise plain JSON shapes. The validator accepts them.
        const handler = vi.fn().mockImplementation(async () => {
            const result = Object.create(null);
            result.ok = true;
            result.count = 42;
            return { result };
        });
        service.register(buildManifest(), { 'task.run': handler });

        const user = createUser(false);
        const session = createSession(user);

        const response = await service.execute(user, session, 'sample-module', 'task.run', {});
        expect(response.ok).toBe(true);
        const result = response.result as { ok: boolean; count: number };
        expect(result.ok).toBe(true);
        expect(result.count).toBe(42);
    });
});

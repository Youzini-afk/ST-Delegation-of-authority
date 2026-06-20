import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { AUTHORITY_SDK_EXTENSION_ID } from '../../constants.js';
import {
    buildBmeApplyPayload,
    buildBmeManifestPayload,
    buildStBmeModuleManifest,
    executeBmeVectorApply,
    executeBmeVectorManifest,
    normalizeBmeDatabase,
    registerStBmeModule,
    resolveBmeApplyRequiredResources,
    resolveBmeManifestRequiredResources,
    ST_BME_MODULE_ID,
    ST_BME_TRANSACTION_APPLY,
    ST_BME_TRANSACTION_MANIFEST,
    stBmeModuleHandlers,
} from './st-bme-module.js';
import { createAuthorityRuntime } from '../../runtime.js';
import { registerRoutes } from '../../routes.js';
import { AUTHORITY_VERSION } from '../../version.js';
import { ModuleHostService } from '../../services/module-host-service.js';
import { PermissionService } from '../../services/permission-service.js';
import { PolicyService } from '../../services/policy-service.js';
import type { AuthorityModuleManifest, BmeVectorApplyResponse, BmeVectorManifestResponse } from '@stdo/shared-types';
import type { AuthorityRuntime } from '../../runtime.js';
import type { AuthorityRequest, AuthorityResponse, PoliciesState, SessionRecord, StoredGrantEntry, UserContext } from '../../types.js';
import type { AuditService } from '../../services/audit-service.js';
import type { JobService } from '../../services/job-service.js';
import type { PrivateFsService } from '../../services/private-fs-service.js';
import type { StorageService } from '../../services/storage-service.js';
import type { TriviumService } from '../../services/trivium-service.js';
import type { SseBroker } from '../../events/sse-broker.js';
import type { CoreService } from '../../services/core-service.js';

const cleanupDirs: string[] = [];
const globalState = globalThis as typeof globalThis & { DATA_ROOT?: string };

function createMockCore(): CoreService {
    const grants = new Map<string, StoredGrantEntry>();
    let policies: PoliciesState = {
        defaults: {} as PoliciesState['defaults'],
        extensions: {},
        limits: { extensions: {} },
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

function createUser(handle = 'alice', isAdmin = false): UserContext {
    const rootDir = fs.mkdtempSync(path.join(os.tmpdir(), 'st-bme-module-'));
    cleanupDirs.push(rootDir);
    globalState.DATA_ROOT = rootDir;
    return { handle, isAdmin, rootDir };
}

function createSession(user: UserContext, declaredPermissions: SessionRecord['declaredPermissions']): SessionRecord {
    return {
        token: 'session-token',
        createdAt: new Date().toISOString(),
        userHandle: user.handle,
        isAdmin: user.isAdmin,
        extension: {
            id: 'third-party/st-bme',
            installType: 'local',
            displayName: 'ST-BME',
            version: AUTHORITY_VERSION,
            firstSeenAt: new Date().toISOString(),
        },
        declaredPermissions,
        sessionGrants: new Map(),
    };
}

function buildBmeManifestResponse(database: string): BmeVectorManifestResponse {
    return {
        database,
        exists: false,
        status: 'missing',
        embeddingMode: 'client',
        serverEmbeddingSupported: false,
        vectorApplySupported: true,
        vectorManifestSupported: true,
        vectorDim: null,
        dtype: null,
        storageMode: null,
        syncMode: null,
        mappingCount: 0,
        nodeCount: null,
        lastFlushAt: null,
        updatedAt: null,
    };
}

function buildBmeApplyResponse(database: string): BmeVectorApplyResponse {
    return {
        ok: true,
        appliedAt: '2026-01-01T00:00:00.000Z',
        database,
        manifest: buildBmeManifestResponse(database),
        upsert: { totalCount: 0, successCount: 0, failureCount: 0, failures: [], items: [] },
        links: { totalCount: 0, successCount: 0, failureCount: 0, failures: [] },
        skippedLinkCount: 0,
    };
}

interface RuntimeOptions {
    declaredPermissions?: SessionRecord['declaredPermissions'];
    getBmeVectorManifest?: ReturnType<typeof vi.fn>;
    applyBmeVectorManifest?: ReturnType<typeof vi.fn>;
}

interface BuiltRuntime {
    runtime: AuthorityRuntime;
    user: UserContext;
    session: SessionRecord;
    permissions: PermissionService;
    modules: ModuleHostService;
    trivium: { getBmeVectorManifest: ReturnType<typeof vi.fn>; applyBmeVectorManifest: ReturnType<typeof vi.fn> };
    audit: AuditService;
    setSession: (session: SessionRecord) => void;
}

function buildRuntime(options: RuntimeOptions = {}): BuiltRuntime {
    const user = createUser();
    const session = createSession(user, options.declaredPermissions ?? {});
    const core = createMockCore();
    const permissions = new PermissionService(new PolicyService(core), core);
    const audit = createMockAudit();
    const getBmeVectorManifest = options.getBmeVectorManifest ?? vi.fn().mockResolvedValue(buildBmeManifestResponse('default'));
    const applyBmeVectorManifest = options.applyBmeVectorManifest ?? vi.fn().mockResolvedValue(buildBmeApplyResponse('default'));
    const trivium = {
        getBmeVectorManifest,
        applyBmeVectorManifest,
    } as unknown as TriviumService;
    const modules = new ModuleHostService(
        permissions,
        audit,
        trivium,
        {} as StorageService,
        {} as PrivateFsService,
        {} as JobService,
        {} as SseBroker,
    );
    registerStBmeModule(modules);
    let activeSession = session;
    const sessions = {
        assertSession: vi.fn(async () => activeSession),
    };
    const runtime = {
        core,
        permissions,
        audit,
        trivium,
        modules,
        sessions,
    } as unknown as AuthorityRuntime;
    return {
        runtime,
        user,
        session,
        permissions,
        modules,
        trivium: { getBmeVectorManifest, applyBmeVectorManifest },
        audit,
        setSession(next: SessionRecord) {
            activeSession = next;
        },
    };
}

function buildRouter(): {
    router: {
        get: (path: string, handler: (req: AuthorityRequest, res: AuthorityResponse) => void | Promise<void>) => void;
        post: (path: string, handler: (req: AuthorityRequest, res: AuthorityResponse) => void | Promise<void>) => void;
    };
    posts: Map<string, (req: AuthorityRequest, res: AuthorityResponse) => void | Promise<void>>;
    gets: Map<string, (req: AuthorityRequest, res: AuthorityResponse) => void | Promise<void>>;
} {
    const posts = new Map<string, (req: AuthorityRequest, res: AuthorityResponse) => void | Promise<void>>();
    const gets = new Map<string, (req: AuthorityRequest, res: AuthorityResponse) => void | Promise<void>>();
    const router = {
        get(path: string, handler: (req: AuthorityRequest, res: AuthorityResponse) => void | Promise<void>) {
            gets.set(path, handler);
        },
        post(path: string, handler: (req: AuthorityRequest, res: AuthorityResponse) => void | Promise<void>) {
            posts.set(path, handler);
        },
    };
    return { router, posts, gets };
}

function buildRequest(user: UserContext, body: unknown, params: Record<string, string> = {}): AuthorityRequest {
    return {
        user: {
            profile: { handle: user.handle, admin: user.isAdmin },
            directories: { root: user.rootDir },
        },
        body,
        params,
        headers: { 'x-authority-session-token': 'session-token' },
    };
}

function buildResponse(): AuthorityResponse & { status: ReturnType<typeof vi.fn>; json: ReturnType<typeof vi.fn> } {
    const response = {
        status: vi.fn().mockReturnThis(),
        json: vi.fn(),
        send: vi.fn(),
        setHeader: vi.fn(),
        write: vi.fn(),
        end: vi.fn(),
    };
    return response as unknown as AuthorityResponse & { status: ReturnType<typeof vi.fn>; json: ReturnType<typeof vi.fn> };
}

describe('st-bme built-in module', () => {
    afterEach(() => {
        while (cleanupDirs.length > 0) {
            const dir = cleanupDirs.pop();
            if (dir) {
                fs.rmSync(dir, { recursive: true, force: true });
            }
        }
    });

    describe('manifest', () => {
        it('declares the st-bme id, two transactions, and JSON-serializable public requiredResources', () => {
            const manifest = buildStBmeModuleManifest();
            expect(manifest.id).toBe(ST_BME_MODULE_ID);
            expect(manifest.protocolVersion).toBe(1);
            expect(Object.keys(manifest.transactions).sort()).toEqual(['vector.apply', 'vector.manifest']);

            const manifestTx = manifest.transactions[ST_BME_TRANSACTION_MANIFEST];
            const applyTx = manifest.transactions[ST_BME_TRANSACTION_APPLY];
            expect(manifestTx?.riskLevel).toBe('low');
            expect(manifestTx?.idempotency).toBe('none');
            expect(manifestTx?.permissionTarget).toEqual({ kind: 'transaction' });
            expect(manifestTx?.requiredResources).toEqual([]);
            expect(applyTx?.riskLevel).toBe('high');
            expect(applyTx?.idempotency).toBe('optional');
            expect(applyTx?.permissionTarget).toEqual({ kind: 'transaction' });
            expect(applyTx?.requiredResources).toEqual([]);

            // Public manifest must round-trip through JSON with no function-
            // valued fields.
            expect(JSON.parse(JSON.stringify(manifest))).toEqual(manifest);
        });
    });

    describe('normalizeBmeDatabase', () => {
        it('returns the trimmed database name when present, otherwise "default"', () => {
            expect(normalizeBmeDatabase('bme')).toBe('bme');
            expect(normalizeBmeDatabase('  bme  ')).toBe('bme');
            expect(normalizeBmeDatabase('')).toBe('default');
            expect(normalizeBmeDatabase('   ')).toBe('default');
            expect(normalizeBmeDatabase(undefined)).toBe('default');
            expect(normalizeBmeDatabase(null)).toBe('default');
            expect(normalizeBmeDatabase(42)).toBe('default');
            expect(normalizeBmeDatabase({ database: 'bme' })).toBe('default');
        });
    });

    describe('payload helpers', () => {
        it('buildBmeManifestPayload clones the request with a normalized database', () => {
            expect(buildBmeManifestPayload({ database: '  bme  ' })).toEqual({ database: 'bme' });
            expect(buildBmeManifestPayload({})).toEqual({ database: 'default' });
            expect(buildBmeManifestPayload(undefined)).toEqual({ database: 'default' });
            expect(buildBmeManifestPayload(null)).toEqual({ database: 'default' });
        });

        it('buildBmeApplyPayload clones the request with a normalized database and preserves other fields', () => {
            const items = [{ externalId: 'a', vector: [1, 0], payload: { text: 'a' } }];
            const payload = buildBmeApplyPayload({
                database: '  bme  ',
                graphRevision: 7,
                collectionId: 'st-bme::chat-a',
                chatId: 'chat-a',
                modelScope: 'model-a',
                items,
                links: [],
            });
            expect(payload.database).toBe('bme');
            expect(payload.graphRevision).toBe(7);
            expect(payload.collectionId).toBe('st-bme::chat-a');
            expect(payload.items).toBe(items);
            // The returned payload is a new object: patching its `database`
            // must not mutate the caller's input object.
            const input = { database: '  bme  ', items: [] };
            const cloned = buildBmeApplyPayload(input);
            cloned.database = 'default';
            expect(input.database).toBe('  bme  ');
            expect(cloned.database).toBe('default');
        });
    });

    describe('required-resource resolvers', () => {
        it('resolves trivium.private with the normalized database target for vector.manifest', () => {
            expect(resolveBmeManifestRequiredResources({ database: '  bme  ' })).toEqual([
                { resource: 'trivium.private', target: 'bme', reason: 'BME vector manifest target database' },
            ]);
            expect(resolveBmeManifestRequiredResources({})).toEqual([
                { resource: 'trivium.private', target: 'default', reason: 'BME vector manifest target database' },
            ]);
            expect(resolveBmeManifestRequiredResources(undefined)).toEqual([
                { resource: 'trivium.private', target: 'default', reason: 'BME vector manifest target database' },
            ]);
        });

        it('resolves trivium.private with the normalized database target for vector.apply', () => {
            expect(resolveBmeApplyRequiredResources({ database: '  bme  ' })).toEqual([
                { resource: 'trivium.private', target: 'bme', reason: 'BME vector apply target database' },
            ]);
            expect(resolveBmeApplyRequiredResources({})).toEqual([
                { resource: 'trivium.private', target: 'default', reason: 'BME vector apply target database' },
            ]);
        });
    });

    describe('registerStBmeModule', () => {
        it('registers the st-bme module with the host so it shows up in manifests', () => {
            const built = buildRuntime();
            expect(built.modules.count()).toBe(1);
            const list = built.modules.listManifests();
            expect(list.count).toBe(1);
            expect(list.modules[0]?.id).toBe(ST_BME_MODULE_ID);
            const got = built.modules.getManifest(ST_BME_MODULE_ID);
            expect(got.module.id).toBe(ST_BME_MODULE_ID);
            expect(Object.keys(got.module.transactions).sort()).toEqual(['vector.apply', 'vector.manifest']);
        });

        it('exports handlers keyed by transaction name', () => {
            expect(typeof stBmeModuleHandlers[ST_BME_TRANSACTION_MANIFEST]).toBe('function');
            expect(typeof stBmeModuleHandlers[ST_BME_TRANSACTION_APPLY]).toBe('function');
        });
    });

    describe('createAuthorityRuntime', () => {
        it('registers the built-in st-bme module so the runtime module count is 1', () => {
            const runtime = createAuthorityRuntime();
            expect(runtime.modules.count()).toBe(1);
            const list = runtime.modules.listManifests();
            expect(list.modules[0]?.id).toBe(ST_BME_MODULE_ID);
            const got = runtime.modules.getManifest(ST_BME_MODULE_ID);
            const manifest = got.module as AuthorityModuleManifest;
            expect(Object.keys(manifest.transactions).sort()).toEqual(['vector.apply', 'vector.manifest']);
        });

        it('probe reports modules count 1 when the actual runtime is used', async () => {
            const runtime = createAuthorityRuntime();
            // Override IO-heavy methods so the probe path does not spawn the
            // core child process or read release metadata from disk.
            runtime.core.refreshHealth = vi.fn().mockResolvedValue(null);
            runtime.core.getStatus = vi.fn().mockReturnValue({
                enabled: true,
                state: 'stopped',
                platform: process.platform,
                arch: process.arch,
                binaryPath: null,
                port: null,
                pid: null,
                version: null,
                startedAt: null,
                lastError: null,
                health: { limits: {} },
            }) as unknown as typeof runtime.core.getStatus;
            runtime.install.getStatus = vi.fn().mockReturnValue({
                pluginVersion: AUTHORITY_VERSION,
                sdkBundledVersion: AUTHORITY_VERSION,
                sdkDeployedVersion: AUTHORITY_VERSION,
                coreBundledVersion: AUTHORITY_VERSION,
                coreArtifactPlatform: `${process.platform}-${process.arch}`,
                coreArtifactPlatforms: [`${process.platform}-${process.arch}`],
                coreArtifactHash: 'hash',
                coreBinarySha256: 'sha256',
                coreVerified: true,
                coreMessage: null,
                installStatus: 'ready',
                installMessage: 'ready',
            }) as unknown as typeof runtime.install.getStatus;

            const { router, posts } = buildRouter();
            registerRoutes(router, runtime);

            const user = createUser();
            const response = buildResponse();
            await posts.get('/probe')?.(buildRequest(user, {}), response);

            const payload = response.json.mock.calls[0]?.[0] as { features: { modules: { count: number; enabled: boolean; registryVersion: number } } };
            expect(payload.features.modules).toEqual({
                enabled: true,
                registryVersion: 1,
                count: 1,
            });
        });
    });

    describe('handlers', () => {
        it('vector.manifest calls trivium.getBmeVectorManifest with the normalized database and returns the module envelope', async () => {
            const built = buildRuntime({
                getBmeVectorManifest: vi.fn().mockResolvedValue(buildBmeManifestResponse('bme')),
            });
            const user = built.user;
            const session = built.session;
            const response = await built.modules.execute(user, session, ST_BME_MODULE_ID, ST_BME_TRANSACTION_MANIFEST, {
                input: { database: '  bme  ' },
            });
            expect(response).toMatchObject({
                ok: true,
                moduleId: ST_BME_MODULE_ID,
                transaction: ST_BME_TRANSACTION_MANIFEST,
            });
            expect(response.result).toEqual(buildBmeManifestResponse('bme'));
            expect(built.trivium.getBmeVectorManifest).toHaveBeenCalledWith(
                expect.objectContaining({ handle: user.handle }),
                'third-party/st-bme',
                { database: 'bme' },
            );
        });

        it('vector.apply calls trivium.applyBmeVectorManifest with the normalized database and returns the module envelope', async () => {
            const built = buildRuntime({
                applyBmeVectorManifest: vi.fn().mockResolvedValue(buildBmeApplyResponse('bme')),
            });
            const user = built.user;
            const session = built.session;
            const input = {
                database: '  bme  ',
                graphRevision: 7,
                collectionId: 'st-bme::chat-a',
                chatId: 'chat-a',
                modelScope: 'model-a',
                items: [{ externalId: 'a', vector: [1, 0], payload: { text: 'a' } }],
                links: [],
            };
            const response = await built.modules.execute(user, session, ST_BME_MODULE_ID, ST_BME_TRANSACTION_APPLY, {
                input,
            });
            expect(response).toMatchObject({
                ok: true,
                moduleId: ST_BME_MODULE_ID,
                transaction: ST_BME_TRANSACTION_APPLY,
            });
            expect(response.result).toEqual(buildBmeApplyResponse('bme'));
            expect(built.trivium.applyBmeVectorManifest).toHaveBeenCalledWith(
                expect.objectContaining({ handle: user.handle }),
                'third-party/st-bme',
                expect.objectContaining({ database: 'bme', graphRevision: 7, items: input.items }),
            );
        });

        it('executeBmeVectorManifest and executeBmeVectorApply normalize the database before invoking trivium', async () => {
            const getBmeVectorManifest = vi.fn().mockResolvedValue(buildBmeManifestResponse('default'));
            const applyBmeVectorManifest = vi.fn().mockResolvedValue(buildBmeApplyResponse('default'));
            const trivium = { getBmeVectorManifest, applyBmeVectorManifest } as unknown as TriviumService;
            const user = createUser();
            await executeBmeVectorManifest(trivium, user, 'third-party/st-bme', { database: '   ' });
            expect(getBmeVectorManifest).toHaveBeenCalledWith(user, 'third-party/st-bme', { database: 'default' });
            await executeBmeVectorApply(trivium, user, 'third-party/st-bme', { database: '   ', items: [] });
            expect(applyBmeVectorManifest).toHaveBeenCalledWith(
                user,
                'third-party/st-bme',
                expect.objectContaining({ database: 'default', items: [] }),
            );
        });
    });

    describe('route integration', () => {
        it('legacy /bme/vector-manifest preserves the BME response shape and succeeds for a session declaring only trivium.private', async () => {
            const built = buildRuntime({
                declaredPermissions: { trivium: { private: true } },
                getBmeVectorManifest: vi.fn().mockResolvedValue(buildBmeManifestResponse('st_bme_vectors')),
            });
            const { router, posts } = buildRouter();
            registerRoutes(router, built.runtime);

            const response = buildResponse();
            await posts.get('/bme/vector-manifest')?.(
                buildRequest(built.user, { database: 'st_bme_vectors' }),
                response,
            );

            expect(built.trivium.getBmeVectorManifest).toHaveBeenCalledWith(
                expect.objectContaining({ handle: built.user.handle }),
                'third-party/st-bme',
                { database: 'st_bme_vectors' },
            );
            expect(response.json).toHaveBeenCalledWith(expect.objectContaining({
                database: 'st_bme_vectors',
                embeddingMode: 'client',
                vectorManifestSupported: true,
            }));
            // Legacy route returns the BME vector response directly, not the
            // module envelope.
            const payload = response.json.mock.calls[0]?.[0] as Record<string, unknown>;
            expect(payload).not.toHaveProperty('moduleId');
            expect(payload).not.toHaveProperty('transaction');
        });

        it('legacy /bme/vector-apply preserves the BME apply response shape for a session declaring only trivium.private', async () => {
            const built = buildRuntime({
                declaredPermissions: { trivium: { private: true } },
                applyBmeVectorManifest: vi.fn().mockResolvedValue(buildBmeApplyResponse('st_bme_vectors')),
            });
            const { router, posts } = buildRouter();
            registerRoutes(router, built.runtime);

            const response = buildResponse();
            const body = {
                database: 'st_bme_vectors',
                graphRevision: 7,
                collectionId: 'st-bme::chat-a',
                chatId: 'chat-a',
                modelScope: 'model-a',
                items: [{ externalId: 'a', vector: [1, 0], payload: { text: 'a' } }],
                links: [],
            };
            await posts.get('/bme/vector-apply')?.(buildRequest(built.user, body), response);

            expect(built.trivium.applyBmeVectorManifest).toHaveBeenCalledWith(
                expect.objectContaining({ handle: built.user.handle }),
                'third-party/st-bme',
                expect.objectContaining({ database: 'st_bme_vectors', items: body.items }),
            );
            expect(response.json).toHaveBeenCalledWith(expect.objectContaining({
                ok: true,
                database: 'st_bme_vectors',
                manifest: expect.objectContaining({ database: 'st_bme_vectors' }),
            }));
            const payload = response.json.mock.calls[0]?.[0] as Record<string, unknown>;
            expect(payload).not.toHaveProperty('moduleId');
            expect(payload).not.toHaveProperty('transaction');
        });

        it('module route /modules/st-bme/transactions/vector.manifest succeeds when module.execute and trivium.private are both granted', async () => {
            const built = buildRuntime({
                declaredPermissions: { trivium: { private: true }, modules: { execute: true } },
                getBmeVectorManifest: vi.fn().mockResolvedValue(buildBmeManifestResponse('bme')),
            });
            const { router, posts } = buildRouter();
            registerRoutes(router, built.runtime);

            const response = buildResponse();
            await posts.get('/modules/:moduleId/transactions/:transactionName')?.(
                buildRequest(built.user, { input: { database: 'bme' } }, {
                    moduleId: ST_BME_MODULE_ID,
                    transactionName: ST_BME_TRANSACTION_MANIFEST,
                }),
                response,
            );

            expect(response.json).toHaveBeenCalledWith(expect.objectContaining({
                ok: true,
                moduleId: ST_BME_MODULE_ID,
                transaction: ST_BME_TRANSACTION_MANIFEST,
                result: expect.objectContaining({ database: 'bme' }),
            }));
        });

        it('module route denies the module path when the session declares trivium.private but not modules.execute', async () => {
            const built = buildRuntime({
                declaredPermissions: { trivium: { private: true } },
                getBmeVectorManifest: vi.fn().mockResolvedValue(buildBmeManifestResponse('bme')),
            });
            const { router, posts } = buildRouter();
            registerRoutes(router, built.runtime);

            const response = buildResponse();
            await posts.get('/modules/:moduleId/transactions/:transactionName')?.(
                buildRequest(built.user, { input: { database: 'bme' } }, {
                    moduleId: ST_BME_MODULE_ID,
                    transactionName: ST_BME_TRANSACTION_MANIFEST,
                }),
                response,
            );

            expect(built.trivium.getBmeVectorManifest).not.toHaveBeenCalled();
            expect(response.status).toHaveBeenCalledWith(403);
            const payload = response.json.mock.calls[0]?.[0] as Record<string, unknown>;
            expect(payload).toMatchObject({
                code: 'permission_not_granted',
                category: 'permission',
            });
        });

        it('dynamic trivium.private denial blocks the module path before the handler runs', async () => {
            const built = buildRuntime({
                declaredPermissions: { trivium: { private: true }, modules: { execute: true } },
                getBmeVectorManifest: vi.fn().mockResolvedValue(buildBmeManifestResponse('bme')),
            });
            // Persist a deny grant for trivium.private on the targeted database.
            await built.permissions.resolve(
                built.user,
                built.session,
                { resource: 'trivium.private', target: 'bme' },
                'deny',
            );
            const { router, posts } = buildRouter();
            registerRoutes(router, built.runtime);

            const response = buildResponse();
            await posts.get('/modules/:moduleId/transactions/:transactionName')?.(
                buildRequest(built.user, { input: { database: 'bme' } }, {
                    moduleId: ST_BME_MODULE_ID,
                    transactionName: ST_BME_TRANSACTION_MANIFEST,
                }),
                response,
            );

            expect(built.trivium.getBmeVectorManifest).not.toHaveBeenCalled();
            expect(response.status).toHaveBeenCalledWith(403);
        });

        it('explicit denial of trivium.private blocks both legacy and module paths', async () => {
            const built = buildRuntime({
                declaredPermissions: { trivium: { private: true }, modules: { execute: true } },
                getBmeVectorManifest: vi.fn().mockResolvedValue(buildBmeManifestResponse('bme')),
            });
            await built.permissions.resolve(
                built.user,
                built.session,
                { resource: 'trivium.private', target: 'bme' },
                'deny',
            );
            const { router, posts } = buildRouter();
            registerRoutes(router, built.runtime);

            const legacyResponse = buildResponse();
            await posts.get('/bme/vector-manifest')?.(
                buildRequest(built.user, { database: 'bme' }),
                legacyResponse,
            );
            expect(built.trivium.getBmeVectorManifest).not.toHaveBeenCalled();
            expect(legacyResponse.status).toHaveBeenCalledWith(403);

            const moduleResponse = buildResponse();
            await posts.get('/modules/:moduleId/transactions/:transactionName')?.(
                buildRequest(built.user, { input: { database: 'bme' } }, {
                    moduleId: ST_BME_MODULE_ID,
                    transactionName: ST_BME_TRANSACTION_MANIFEST,
                }),
                moduleResponse,
            );
            expect(built.trivium.getBmeVectorManifest).not.toHaveBeenCalled();
            expect(moduleResponse.status).toHaveBeenCalledWith(403);
        });

        it('explicit denial of module.execute blocks the module path but not the legacy path', async () => {
            const built = buildRuntime({
                declaredPermissions: { trivium: { private: true }, modules: { execute: true } },
                getBmeVectorManifest: vi.fn().mockResolvedValue(buildBmeManifestResponse('bme')),
            });
            // Persist a deny grant for module.execute on the targeted
            // transaction. The legacy route does not check module.execute so
            // it must still succeed.
            await built.permissions.resolve(
                built.user,
                built.session,
                { resource: 'module.execute', target: `${ST_BME_MODULE_ID}:${ST_BME_TRANSACTION_MANIFEST}` },
                'deny',
            );
            const { router, posts } = buildRouter();
            registerRoutes(router, built.runtime);

            const legacyResponse = buildResponse();
            await posts.get('/bme/vector-manifest')?.(
                buildRequest(built.user, { database: 'bme' }),
                legacyResponse,
            );
            expect(built.trivium.getBmeVectorManifest).toHaveBeenCalledTimes(1);
            expect(legacyResponse.json).toHaveBeenCalledWith(expect.objectContaining({ database: 'bme' }));
            expect(legacyResponse.status).not.toHaveBeenCalled();

            const moduleResponse = buildResponse();
            await posts.get('/modules/:moduleId/transactions/:transactionName')?.(
                buildRequest(built.user, { input: { database: 'bme' } }, {
                    moduleId: ST_BME_MODULE_ID,
                    transactionName: ST_BME_TRANSACTION_MANIFEST,
                }),
                moduleResponse,
            );
            // No additional trivium call: the module path was blocked before
            // reaching the handler.
            expect(built.trivium.getBmeVectorManifest).toHaveBeenCalledTimes(1);
            expect(moduleResponse.status).toHaveBeenCalledWith(403);
            const payload = moduleResponse.json.mock.calls[0]?.[0] as Record<string, unknown>;
            expect(payload).toMatchObject({
                code: 'permission_not_granted',
                category: 'permission',
            });
        });

        it('legacy /bme/vector-manifest failure attributes the audit to the calling extension', async () => {
            const built = buildRuntime({
                declaredPermissions: { trivium: { private: true } },
                getBmeVectorManifest: vi.fn().mockResolvedValue(buildBmeManifestResponse('bme')),
            });
            // Persist a deny grant for trivium.private so the legacy route
            // throws a permission error, exercising the failure audit path.
            await built.permissions.resolve(
                built.user,
                built.session,
                { resource: 'trivium.private', target: 'bme' },
                'deny',
            );
            const { router, posts } = buildRouter();
            registerRoutes(router, built.runtime);

            const response = buildResponse();
            await posts.get('/bme/vector-manifest')?.(
                buildRequest(built.user, { database: 'bme' }),
                response,
            );

            expect(response.status).toHaveBeenCalledWith(403);
            expect(built.audit.logPermission).toHaveBeenCalledWith(
                expect.objectContaining({ handle: built.user.handle }),
                'third-party/st-bme',
                'Permission denied',
                expect.objectContaining({ resource: 'trivium.private' }),
            );
        });

        it('legacy /bme/vector-manifest falls back to the SDK extension id when no session can be resolved', async () => {
            // Build a runtime whose session lookup throws so the failure
            // audit fallback path is exercised.
            const built = buildRuntime({
                declaredPermissions: { trivium: { private: true } },
            });
            built.runtime.sessions.assertSession = vi.fn().mockRejectedValue(new Error('Invalid authority session')) as unknown as typeof built.runtime.sessions.assertSession;
            const { router, posts } = buildRouter();
            registerRoutes(router, built.runtime);

            const response = buildResponse();
            await posts.get('/bme/vector-manifest')?.(
                buildRequest(built.user, { database: 'bme' }),
                response,
            );

            expect(response.status).toHaveBeenCalledWith(401);
            expect(built.audit.logError).toHaveBeenCalledWith(
                expect.objectContaining({ handle: built.user.handle }),
                AUTHORITY_SDK_EXTENSION_ID,
                'Invalid authority session',
            );
        });
    });
});

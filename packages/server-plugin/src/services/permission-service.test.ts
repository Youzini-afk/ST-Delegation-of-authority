import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { DEFAULT_POLICY_STATUS } from '../constants.js';
import { PermissionService } from './permission-service.js';
import { PolicyService } from './policy-service.js';
import type { CoreService } from './core-service.js';
import type { PoliciesFile, SessionRecord, StoredGrantEntry, UserContext } from '../types.js';

const globalState = globalThis as typeof globalThis & { DATA_ROOT?: string };
const cleanupDirs: string[] = [];

describe('PermissionService', () => {
    const previousDataRoot = globalState.DATA_ROOT;

    afterEach(() => {
        while (cleanupDirs.length > 0) {
            const dir = cleanupDirs.pop();
            if (dir) {
                fs.rmSync(dir, { recursive: true, force: true });
            }
        }

        if (previousDataRoot === undefined) {
            delete globalState.DATA_ROOT;
        } else {
            globalState.DATA_ROOT = previousDataRoot;
        }
    });

    it('persists allow-always and deny decisions', async () => {
        const user = createUser(false);
        const session = createSession(user);
        const core = createMockCore();
        const permissions = new PermissionService(new PolicyService(core), core);

        expect((await permissions.evaluate(user, session, { resource: 'storage.kv' })).decision).toBe('prompt');

        const granted = await permissions.resolve(user, session, { resource: 'storage.kv' }, 'allow-always');
        expect(granted.status).toBe('granted');
        expect((await permissions.evaluate(user, session, { resource: 'storage.kv' })).decision).toBe('granted');

        const denied = await permissions.resolve(user, session, { resource: 'storage.blob' }, 'deny');
        expect(denied.status).toBe('denied');
        expect((await permissions.evaluate(user, session, { resource: 'storage.blob' })).decision).toBe('denied');
    });

    it('consumes allow-once session grants after a single authorization', async () => {
        const user = createUser(false);
        const session = createSession(user);
        const core = createMockCore();
        const permissions = new PermissionService(new PolicyService(core), core);

        await permissions.resolve(user, session, { resource: 'jobs.background', target: 'delay' }, 'allow-once');
        expect(await permissions.authorize(user, session, { resource: 'jobs.background', target: 'delay' })).not.toBeNull();
        expect(await permissions.authorize(user, session, { resource: 'jobs.background', target: 'delay' })).toBeNull();
    });

    it('applies admin policy overrides ahead of user grants', async () => {
        const user = createUser(false);
        const admin = createUser(true);
        const session = createSession(user);
        const core = createMockCore();
        const policies = new PolicyService(core);
        const permissions = new PermissionService(policies, core);

        await permissions.resolve(user, session, { resource: 'http.fetch', target: 'api.example.com' }, 'allow-always');
        expect((await permissions.evaluate(user, session, { resource: 'http.fetch', target: 'api.example.com' })).decision).toBe('granted');

        await policies.saveGlobalPolicies(admin, {
            extensions: {
                [session.extension.id]: {
                    'http.fetch:api.example.com': {
                        key: 'http.fetch:api.example.com',
                        resource: 'http.fetch',
                        target: 'api.example.com',
                        status: 'blocked',
                        riskLevel: 'medium',
                        updatedAt: new Date().toISOString(),
                        source: 'admin',
                    },
                },
            },
        });

        expect((await permissions.evaluate(user, session, { resource: 'http.fetch', target: 'api.example.com' })).decision).toBe('blocked');
    });
});

function createMockCore(): CoreService {
    const grants = new Map<string, StoredGrantEntry>();
    let policies: PoliciesFile = {
        defaults: { ...DEFAULT_POLICY_STATUS },
        extensions: {},
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
        async saveControlPolicies(_dbPath: string, request: { partial: Partial<PoliciesFile> }) {
            policies = {
                defaults: {
                    ...policies.defaults,
                    ...(request.partial.defaults ?? {}),
                },
                extensions: {
                    ...policies.extensions,
                    ...(request.partial.extensions ?? {}),
                },
                updatedAt: new Date().toISOString(),
            };
            return policies;
        },
    } as unknown as CoreService;
}

function createUser(isAdmin: boolean): UserContext {
    const rootDir = fs.mkdtempSync(path.join(os.tmpdir(), 'authority-permissions-'));
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
            version: '0.1.0',
            firstSeenAt: new Date().toISOString(),
        },
        declaredPermissions: {},
        sessionGrants: new Map(),
    };
}

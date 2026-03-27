import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { PermissionService } from './permission-service.js';
import { PolicyService } from './policy-service.js';
import type { SessionRecord, UserContext } from '../types.js';

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

    it('persists allow-always and deny decisions', () => {
        const user = createUser(false);
        const session = createSession(user);
        const permissions = new PermissionService(new PolicyService());

        expect(permissions.evaluate(user, session, { resource: 'storage.kv' }).decision).toBe('prompt');

        const granted = permissions.resolve(user, session, { resource: 'storage.kv' }, 'allow-always');
        expect(granted.status).toBe('granted');
        expect(permissions.evaluate(user, session, { resource: 'storage.kv' }).decision).toBe('granted');

        const denied = permissions.resolve(user, session, { resource: 'storage.blob' }, 'deny');
        expect(denied.status).toBe('denied');
        expect(permissions.evaluate(user, session, { resource: 'storage.blob' }).decision).toBe('denied');
    });

    it('consumes allow-once session grants after a single authorization', () => {
        const user = createUser(false);
        const session = createSession(user);
        const permissions = new PermissionService(new PolicyService());

        permissions.resolve(user, session, { resource: 'jobs.background', target: 'delay' }, 'allow-once');
        expect(permissions.authorize(user, session, { resource: 'jobs.background', target: 'delay' })).not.toBeNull();
        expect(permissions.authorize(user, session, { resource: 'jobs.background', target: 'delay' })).toBeNull();
    });

    it('applies admin policy overrides ahead of user grants', () => {
        const user = createUser(false);
        const admin = createUser(true);
        const session = createSession(user);
        const policies = new PolicyService();
        const permissions = new PermissionService(policies);

        permissions.resolve(user, session, { resource: 'http.fetch', target: 'api.example.com' }, 'allow-always');
        expect(permissions.evaluate(user, session, { resource: 'http.fetch', target: 'api.example.com' }).decision).toBe('granted');

        policies.saveGlobalPolicies(admin, {
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

        expect(permissions.evaluate(user, session, { resource: 'http.fetch', target: 'api.example.com' }).decision).toBe('blocked');
    });
});

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

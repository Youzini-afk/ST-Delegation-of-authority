import type {
    AuthorityGrant,
    AuthorityPolicyEntry,
    PermissionDecision,
    PermissionEvaluateRequest,
    PermissionEvaluateResponse,
} from '@stdo/shared-types';
import { DEFAULT_POLICY_STATUS } from '../constants.js';
import { getUserAuthorityPaths } from '../store/authority-paths.js';
import type {
    PermissionsFile,
    SessionGrantState,
    SessionRecord,
    StoredGrantEntry,
    StoredPolicyEntry,
    UserContext,
} from '../types.js';
import { atomicWriteJson, buildPermissionDescriptor, nowIso, readJsonFile } from '../utils.js';
import { PolicyService } from './policy-service.js';

export class PermissionService {
    constructor(private readonly policyService: PolicyService) {}

    listPersistentGrants(user: UserContext, extensionId: string): StoredGrantEntry[] {
        const paths = getUserAuthorityPaths(user);
        const file = readJsonFile<PermissionsFile>(paths.permissionsFile, { entries: {} });
        return Object.values(file.entries[extensionId] ?? {});
    }

    getPolicyEntries(user: UserContext, extensionId: string): StoredPolicyEntry[] {
        return this.policyService.getExtensionPolicies(user, extensionId);
    }

    evaluate(user: UserContext, session: SessionRecord, request: PermissionEvaluateRequest): PermissionEvaluateResponse {
        const descriptor = buildPermissionDescriptor(request.resource, request.target);
        const policy = this.getPolicyGrant(user, session.extension.id, descriptor.key);
        if (policy) {
            return {
                decision: policy.status,
                key: descriptor.key,
                riskLevel: descriptor.riskLevel,
                target: descriptor.target,
                resource: descriptor.resource,
                grant: policy,
            };
        }

        const persistentGrant = this.getPersistentGrant(user, session.extension.id, descriptor.key);
        if (persistentGrant) {
            return {
                decision: persistentGrant.status,
                key: descriptor.key,
                riskLevel: descriptor.riskLevel,
                target: descriptor.target,
                resource: descriptor.resource,
                grant: persistentGrant,
            };
        }

        const sessionGrant = session.sessionGrants.get(descriptor.key)?.grant;
        if (sessionGrant) {
            return {
                decision: sessionGrant.status,
                key: descriptor.key,
                riskLevel: descriptor.riskLevel,
                target: descriptor.target,
                resource: descriptor.resource,
                grant: sessionGrant,
            };
        }

        return {
            decision: DEFAULT_POLICY_STATUS[descriptor.resource],
            key: descriptor.key,
            riskLevel: descriptor.riskLevel,
            target: descriptor.target,
            resource: descriptor.resource,
        };
    }

    authorize(user: UserContext, session: SessionRecord, request: PermissionEvaluateRequest, consume = true): AuthorityGrant | AuthorityPolicyEntry | null {
        const evaluation = this.evaluate(user, session, request);
        if (evaluation.decision !== 'granted') {
            return null;
        }

        const descriptor = buildPermissionDescriptor(request.resource, request.target);
        const sessionState = session.sessionGrants.get(descriptor.key);
        if (consume && sessionState?.remainingUses) {
            sessionState.remainingUses -= 1;
            if (sessionState.remainingUses <= 0) {
                session.sessionGrants.delete(descriptor.key);
            } else {
                session.sessionGrants.set(descriptor.key, sessionState);
            }
        }

        return evaluation.grant ?? null;
    }

    resolve(user: UserContext, session: SessionRecord, request: PermissionEvaluateRequest, choice: PermissionDecision): AuthorityGrant {
        const descriptor = buildPermissionDescriptor(request.resource, request.target);
        const timestamp = nowIso();
        const grant: AuthorityGrant = {
            key: descriptor.key,
            resource: descriptor.resource,
            target: descriptor.target,
            status: choice === 'deny' ? 'denied' : 'granted',
            scope: choice === 'allow-always' || choice === 'deny' ? 'persistent' : 'session',
            riskLevel: descriptor.riskLevel,
            updatedAt: timestamp,
            source: user.isAdmin ? 'admin' : 'user',
        };

        if (choice === 'allow-always' || choice === 'deny') {
            this.writePersistentGrant(user, session.extension.id, {
                ...grant,
                choice,
            });
        } else {
            const sessionGrant: SessionGrantState = { grant };
            if (choice === 'allow-once') {
                sessionGrant.remainingUses = 1;
            }
            session.sessionGrants.set(descriptor.key, sessionGrant);
        }

        return grant;
    }

    resetPersistentGrants(user: UserContext, extensionId: string, keys?: string[]): void {
        const paths = getUserAuthorityPaths(user);
        const file = readJsonFile<PermissionsFile>(paths.permissionsFile, { entries: {} });
        const current = file.entries[extensionId] ?? {};

        if (!keys || keys.length === 0) {
            delete file.entries[extensionId];
        } else {
            for (const key of keys) {
                delete current[key];
            }
            file.entries[extensionId] = current;
        }

        atomicWriteJson(paths.permissionsFile, file);
    }

    private getPolicyGrant(user: UserContext, extensionId: string, key: string): StoredPolicyEntry | null {
        const file = this.policyService.getPolicies(user);
        return file.extensions[extensionId]?.[key] ?? null;
    }

    private getPersistentGrant(user: UserContext, extensionId: string, key: string): StoredGrantEntry | null {
        const paths = getUserAuthorityPaths(user);
        const file = readJsonFile<PermissionsFile>(paths.permissionsFile, { entries: {} });
        return file.entries[extensionId]?.[key] ?? null;
    }

    private writePersistentGrant(user: UserContext, extensionId: string, grant: StoredGrantEntry): void {
        const paths = getUserAuthorityPaths(user);
        const file = readJsonFile<PermissionsFile>(paths.permissionsFile, { entries: {} });
        const current = file.entries[extensionId] ?? {};
        current[grant.key] = grant;
        file.entries[extensionId] = current;
        atomicWriteJson(paths.permissionsFile, file);
    }
}


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
    SessionGrantState,
    SessionRecord,
    StoredGrantEntry,
    StoredPolicyEntry,
    UserContext,
} from '../types.js';
import { buildPermissionDescriptor, nowIso } from '../utils.js';
import { CoreService } from './core-service.js';
import { PolicyService } from './policy-service.js';

export class PermissionService {
    constructor(
        private readonly policyService: PolicyService,
        private readonly core: CoreService,
    ) {}

    async listPersistentGrants(user: UserContext, extensionId: string): Promise<StoredGrantEntry[]> {
        const paths = getUserAuthorityPaths(user);
        return await this.core.listControlGrants(paths.controlDbFile, {
            userHandle: user.handle,
            extensionId,
        });
    }

    async getPolicyEntries(user: UserContext, extensionId: string): Promise<StoredPolicyEntry[]> {
        return await this.policyService.getExtensionPolicies(user, extensionId);
    }

    async evaluate(user: UserContext, session: SessionRecord, request: PermissionEvaluateRequest): Promise<PermissionEvaluateResponse> {
        const descriptor = buildPermissionDescriptor(request.resource, request.target);
        const policy = await this.getPolicyGrant(user, session.extension.id, descriptor.key);
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

        const persistentGrant = await this.getPersistentGrant(user, session.extension.id, descriptor.key);
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

    async authorize(user: UserContext, session: SessionRecord, request: PermissionEvaluateRequest, consume = true): Promise<AuthorityGrant | AuthorityPolicyEntry | null> {
        const evaluation = await this.evaluate(user, session, request);
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

    async resolve(user: UserContext, session: SessionRecord, request: PermissionEvaluateRequest, choice: PermissionDecision): Promise<AuthorityGrant> {
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
            await this.writePersistentGrant(user, session.extension.id, {
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

    async resetPersistentGrants(user: UserContext, extensionId: string, keys?: string[]): Promise<void> {
        const paths = getUserAuthorityPaths(user);
        const request = {
            userHandle: user.handle,
            extensionId,
            ...(keys ? { keys } : {}),
        };
        await this.core.resetControlGrants(paths.controlDbFile, request);
    }

    private async getPolicyGrant(user: UserContext, extensionId: string, key: string): Promise<StoredPolicyEntry | null> {
        const file = await this.policyService.getPolicies(user);
        return file.extensions[extensionId]?.[key] ?? null;
    }

    private async getPersistentGrant(user: UserContext, extensionId: string, key: string): Promise<StoredGrantEntry | null> {
        const paths = getUserAuthorityPaths(user);
        return await this.core.getControlGrant(paths.controlDbFile, {
            userHandle: user.handle,
            extensionId,
            key,
        });
    }

    private async writePersistentGrant(user: UserContext, extensionId: string, grant: StoredGrantEntry): Promise<void> {
        const paths = getUserAuthorityPaths(user);
        await this.core.upsertControlGrant(paths.controlDbFile, {
            userHandle: user.handle,
            extensionId,
            grant,
        });
    }
}


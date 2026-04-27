import type {
    AuthorityEffectiveInlineThresholds,
    AuthorityEffectiveOperationByteLimits,
    AuthorityGrant,
    AuthorityExtensionLimitsPolicy,
    AuthorityInlineThresholdKey,
    AuthorityPolicyEntry,
    AuthoritySessionLimits,
    DeclaredPermissions,
    PermissionDecision,
    PermissionEvaluateRequest,
    PermissionEvaluateResponse,
} from '@stdo/shared-types';
import {
    DATA_TRANSFER_INLINE_THRESHOLD_BYTES,
    DEFAULT_POLICY_STATUS,
    MAX_HTTP_REQUEST_TRANSFER_BYTES,
    MAX_HTTP_RESPONSE_TRANSFER_BYTES,
    MAX_PRIVATE_FILE_TRANSFER_BYTES,
    MAX_STORAGE_BLOB_TRANSFER_BYTES,
} from '../constants.js';
import { getUserAuthorityPaths } from '../store/authority-paths.js';
import type {
    SessionGrantState,
    PermissionDescriptor,
    SessionRecord,
    StoredGrantEntry,
    StoredPolicyEntry,
    UserContext,
} from '../types.js';
import { buildPermissionDescriptor, normalizePermissionTarget, nowIso } from '../utils.js';
import { CoreService } from './core-service.js';
import { PolicyService } from './policy-service.js';

const INLINE_THRESHOLD_KEYS: AuthorityInlineThresholdKey[] = [
    'storageBlobWrite',
    'storageBlobRead',
    'privateFileWrite',
    'privateFileRead',
    'httpFetchRequest',
    'httpFetchResponse',
];

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

    async getEffectiveSessionLimits(user: UserContext, extensionId: string): Promise<AuthoritySessionLimits> {
        const policy = await this.policyService.getExtensionLimitPolicy(user, extensionId);
        return {
            effectiveInlineThresholdBytes: this.buildEffectiveInlineThresholds(policy),
            effectiveTransferMaxBytes: this.buildEffectiveTransferMaxBytes(),
        };
    }

    async getEffectiveInlineThresholdBytes(
        user: UserContext,
        extensionId: string,
        key: AuthorityInlineThresholdKey,
    ): Promise<number> {
        return (await this.getEffectiveSessionLimits(user, extensionId)).effectiveInlineThresholdBytes[key].bytes;
    }

    async evaluate(user: UserContext, session: SessionRecord, request: PermissionEvaluateRequest): Promise<PermissionEvaluateResponse> {
        const descriptor = buildPermissionDescriptor(request.resource, request.target);
        const declarationDecision = this.getDeclarationDecision(session.declaredPermissions, descriptor);
        if (declarationDecision) {
            return declarationDecision;
        }

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

    async evaluateBatch(
        user: UserContext,
        session: SessionRecord,
        requests: PermissionEvaluateRequest[],
    ): Promise<PermissionEvaluateResponse[]> {
        return await Promise.all(requests.map(async request => await this.evaluate(user, session, request)));
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

    private buildEffectiveInlineThresholds(policy: AuthorityExtensionLimitsPolicy | null): AuthorityEffectiveInlineThresholds {
        const effective = this.buildRuntimeInlineThresholds();
        const overrides = policy?.inlineThresholdBytes;
        if (!overrides) {
            return effective;
        }

        for (const key of INLINE_THRESHOLD_KEYS) {
            const requested = overrides[key];
            if (typeof requested !== 'number' || !Number.isFinite(requested) || requested <= 0) {
                continue;
            }

            const normalized = Math.floor(requested);
            if (normalized < effective[key].bytes) {
                effective[key] = {
                    bytes: normalized,
                    source: 'policy',
                };
            }
        }

        return effective;
    }

    private buildRuntimeInlineThresholds(): AuthorityEffectiveInlineThresholds {
        return {
            storageBlobWrite: { bytes: DATA_TRANSFER_INLINE_THRESHOLD_BYTES, source: 'runtime' },
            storageBlobRead: { bytes: DATA_TRANSFER_INLINE_THRESHOLD_BYTES, source: 'runtime' },
            privateFileWrite: { bytes: DATA_TRANSFER_INLINE_THRESHOLD_BYTES, source: 'runtime' },
            privateFileRead: { bytes: DATA_TRANSFER_INLINE_THRESHOLD_BYTES, source: 'runtime' },
            httpFetchRequest: { bytes: DATA_TRANSFER_INLINE_THRESHOLD_BYTES, source: 'runtime' },
            httpFetchResponse: { bytes: DATA_TRANSFER_INLINE_THRESHOLD_BYTES, source: 'runtime' },
        };
    }

    private buildEffectiveTransferMaxBytes(): AuthorityEffectiveOperationByteLimits {
        return {
            storageBlobWrite: { bytes: MAX_STORAGE_BLOB_TRANSFER_BYTES, source: 'runtime' },
            storageBlobRead: { bytes: MAX_STORAGE_BLOB_TRANSFER_BYTES, source: 'runtime' },
            privateFileWrite: { bytes: MAX_PRIVATE_FILE_TRANSFER_BYTES, source: 'runtime' },
            privateFileRead: { bytes: MAX_PRIVATE_FILE_TRANSFER_BYTES, source: 'runtime' },
            httpFetchRequest: { bytes: MAX_HTTP_REQUEST_TRANSFER_BYTES, source: 'runtime' },
            httpFetchResponse: { bytes: MAX_HTTP_RESPONSE_TRANSFER_BYTES, source: 'runtime' },
        };
    }

    private getDeclarationDecision(
        declaredPermissions: DeclaredPermissions,
        descriptor: PermissionDescriptor,
    ): PermissionEvaluateResponse | null {
        if (!this.hasDeclaredPermissions(declaredPermissions)) {
            return null;
        }
        if (this.isDeclaredPermissionAllowed(declaredPermissions, descriptor.resource, descriptor.target)) {
            return null;
        }
        return {
            decision: 'blocked',
            key: descriptor.key,
            riskLevel: descriptor.riskLevel,
            target: descriptor.target,
            resource: descriptor.resource,
        };
    }

    private hasDeclaredPermissions(declaredPermissions: DeclaredPermissions): boolean {
        return Boolean(
            declaredPermissions.storage?.kv
            || declaredPermissions.storage?.blob
            || declaredPermissions.fs?.private
            || declaredPermissions.sql?.private
            || declaredPermissions.trivium?.private
            || declaredPermissions.http?.allow?.length
            || declaredPermissions.jobs?.background
            || declaredPermissions.events?.channels,
        );
    }

    private isDeclaredPermissionAllowed(
        declaredPermissions: DeclaredPermissions,
        resource: PermissionEvaluateRequest['resource'],
        target: string,
    ): boolean {
        switch (resource) {
            case 'storage.kv':
                return declaredPermissions.storage?.kv === true;
            case 'storage.blob':
                return declaredPermissions.storage?.blob === true;
            case 'fs.private':
                return declaredPermissions.fs?.private === true;
            case 'sql.private':
                return this.matchesDeclaredTarget(declaredPermissions.sql?.private, resource, target);
            case 'trivium.private':
                return this.matchesDeclaredTarget(declaredPermissions.trivium?.private, resource, target);
            case 'http.fetch':
                return this.matchesDeclaredTarget(declaredPermissions.http?.allow, resource, target);
            case 'jobs.background':
                return this.matchesDeclaredTarget(declaredPermissions.jobs?.background, resource, target);
            case 'events.stream':
                return this.matchesDeclaredTarget(declaredPermissions.events?.channels, resource, target);
            default:
                return false;
        }
    }

    private matchesDeclaredTarget(
        declared: boolean | string[] | undefined,
        resource: PermissionEvaluateRequest['resource'],
        target: string,
    ): boolean {
        if (declared === true) {
            return true;
        }
        if (!Array.isArray(declared) || declared.length === 0) {
            return false;
        }

        const normalizedTarget = normalizePermissionTarget(resource, target);
        return declared.some(candidate => {
            const normalizedCandidate = normalizePermissionTarget(resource, candidate);
            if (normalizedCandidate === '*' || normalizedCandidate === normalizedTarget) {
                return true;
            }
            if (resource === 'http.fetch' && normalizedCandidate.startsWith('*.')) {
                const suffix = normalizedCandidate.slice(1);
                return normalizedTarget.endsWith(suffix) && normalizedTarget.length > suffix.length;
            }
            return false;
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


import { DEFAULT_POLICY_STATUS } from '../constants.js';
import { getGlobalAuthorityPaths, getUserAuthorityPaths } from '../store/authority-paths.js';
import type { PoliciesFile, StoredPolicyEntry, UserContext } from '../types.js';
import { atomicWriteJson, nowIso, readJsonFile } from '../utils.js';

export class PolicyService {
    getPolicies(user: UserContext): PoliciesFile {
        const globalPaths = getGlobalAuthorityPaths();
        const userPaths = getUserAuthorityPaths(user);
        const globalFile = readJsonFile<PoliciesFile>(globalPaths.policiesFile, {
            defaults: { ...DEFAULT_POLICY_STATUS },
            extensions: {},
            updatedAt: nowIso(),
        });
        const userFile = readJsonFile<PoliciesFile>(userPaths.policiesFile, {
            defaults: { ...DEFAULT_POLICY_STATUS },
            extensions: {},
            updatedAt: nowIso(),
        });

        return {
            defaults: {
                ...globalFile.defaults,
                ...userFile.defaults,
            },
            extensions: {
                ...globalFile.extensions,
                ...userFile.extensions,
            },
            updatedAt: userFile.updatedAt || globalFile.updatedAt,
        };
    }

    getExtensionPolicies(user: UserContext, extensionId: string): StoredPolicyEntry[] {
        return Object.values(this.getPolicies(user).extensions[extensionId] ?? {});
    }

    saveGlobalPolicies(actor: UserContext, partial: Partial<PoliciesFile>): PoliciesFile {
        if (!actor.isAdmin) {
            throw new Error('Forbidden');
        }

        const paths = getGlobalAuthorityPaths();
        const current = readJsonFile<PoliciesFile>(paths.policiesFile, {
            defaults: { ...DEFAULT_POLICY_STATUS },
            extensions: {},
            updatedAt: nowIso(),
        });

        const next: PoliciesFile = {
            defaults: {
                ...current.defaults,
                ...(partial.defaults ?? {}),
            },
            extensions: {
                ...current.extensions,
                ...(partial.extensions ?? {}),
            },
            updatedAt: nowIso(),
        };

        atomicWriteJson(paths.policiesFile, next);
        return next;
    }
}


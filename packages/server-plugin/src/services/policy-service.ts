import { DEFAULT_POLICY_STATUS } from '../constants.js';
import { getGlobalAuthorityPaths } from '../store/authority-paths.js';
import type { PoliciesState, StoredPolicyEntry, UserContext } from '../types.js';
import { nowIso } from '../utils.js';
import { CoreService } from './core-service.js';

export class PolicyService {
    constructor(private readonly core: CoreService) {}

    async getPolicies(user: UserContext): Promise<PoliciesState> {
        const globalPaths = getGlobalAuthorityPaths();
        const globalFile = await this.core.getControlPolicies(globalPaths.controlDbFile, {
            userHandle: user.handle,
        });

        return {
            ...globalFile,
            defaults: {
                ...DEFAULT_POLICY_STATUS,
                ...globalFile.defaults,
            },
            updatedAt: globalFile.updatedAt || nowIso(),
        };
    }

    async getExtensionPolicies(user: UserContext, extensionId: string): Promise<StoredPolicyEntry[]> {
        return Object.values((await this.getPolicies(user)).extensions[extensionId] ?? {});
    }

    async saveGlobalPolicies(actor: UserContext, partial: Partial<PoliciesState>): Promise<PoliciesState> {
        if (!actor.isAdmin) {
            throw new Error('Forbidden');
        }

        const paths = getGlobalAuthorityPaths();
        return await this.core.saveControlPolicies(paths.controlDbFile, {
            actor: {
                handle: actor.handle,
                isAdmin: actor.isAdmin,
            },
            partial: {
                ...(partial.defaults ? { defaults: partial.defaults } : {}),
                ...(partial.extensions ? { extensions: partial.extensions } : {}),
            },
        });
    }
}


import type { AuthorityInitConfig } from '@stdo/shared-types';
import { getUserAuthorityPaths } from '../store/authority-paths.js';
import type { ExtensionRegistryEntry, ExtensionsFile, UserContext } from '../types.js';
import { atomicWriteJson, nowIso, readJsonFile } from '../utils.js';

export class ExtensionService {
    upsertExtension(user: UserContext, config: AuthorityInitConfig): ExtensionRegistryEntry {
        const paths = getUserAuthorityPaths(user);
        const file = readJsonFile<ExtensionsFile>(paths.extensionsFile, { entries: {} });
        const current = file.entries[config.extensionId];
        const timestamp = nowIso();

        const next: ExtensionRegistryEntry = {
            id: config.extensionId,
            installType: config.installType,
            displayName: config.displayName,
            version: config.version,
            firstSeenAt: current?.firstSeenAt ?? timestamp,
            lastSeenAt: timestamp,
            declaredPermissions: config.declaredPermissions,
        };

        if (config.uiLabel) {
            next.uiLabel = config.uiLabel;
        }

        file.entries[config.extensionId] = next;
        atomicWriteJson(paths.extensionsFile, file);
        return next;
    }

    listExtensions(user: UserContext): ExtensionRegistryEntry[] {
        const paths = getUserAuthorityPaths(user);
        const file = readJsonFile<ExtensionsFile>(paths.extensionsFile, { entries: {} });
        return Object.values(file.entries).sort((left, right) => left.displayName.localeCompare(right.displayName));
    }

    getExtension(user: UserContext, extensionId: string): ExtensionRegistryEntry | null {
        return this.listExtensions(user).find(entry => entry.id === extensionId) ?? null;
    }
}

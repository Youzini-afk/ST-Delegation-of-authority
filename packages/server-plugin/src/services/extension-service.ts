import { getUserAuthorityPaths } from '../store/authority-paths.js';
import type { ExtensionRegistryEntry, UserContext } from '../types.js';
import { CoreService } from './core-service.js';

export class ExtensionService {
    constructor(private readonly core: CoreService) {}

    async listExtensions(user: UserContext): Promise<ExtensionRegistryEntry[]> {
        const paths = getUserAuthorityPaths(user);
        return await this.core.listControlExtensions(paths.controlDbFile, user.handle);
    }

    async getExtension(user: UserContext, extensionId: string): Promise<ExtensionRegistryEntry | null> {
        const paths = getUserAuthorityPaths(user);
        return await this.core.getControlExtension(paths.controlDbFile, {
            userHandle: user.handle,
            extensionId,
        });
    }
}

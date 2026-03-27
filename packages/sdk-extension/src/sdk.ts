import type { AuthorityInitConfig } from '@stdo/shared-types';
import { AuthorityClient } from './client.js';

const clients = new Map<string, AuthorityClient>();
const initLocks = new Map<string, Promise<AuthorityClient>>();

export class AuthoritySDK {
    static async init(config: AuthorityInitConfig): Promise<AuthorityClient> {
        const existing = clients.get(config.extensionId);
        if (existing) {
            existing.setConfig(config);
            await existing.init();
            return existing;
        }

        const pending = initLocks.get(config.extensionId);
        if (pending) {
            return await pending;
        }

        const client = new AuthorityClient(config);
        const task = client.init()
            .then(() => {
                clients.set(config.extensionId, client);
                return client;
            })
            .finally(() => {
                initLocks.delete(config.extensionId);
            });

        initLocks.set(config.extensionId, task);
        return await task;
    }

    static getClient(extensionId: string): AuthorityClient | null {
        return clients.get(extensionId) ?? null;
    }
}

export { AuthorityClient };

import { AuthorityClient } from './client.js';
const clients = new Map();
const initLocks = new Map();
export class AuthoritySDK {
    static async init(config) {
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
    static getClient(extensionId) {
        return clients.get(extensionId) ?? null;
    }
}
export { AuthorityClient };
//# sourceMappingURL=sdk.js.map
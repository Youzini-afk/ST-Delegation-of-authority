import { AUTHORITY_PLUGIN_ID } from './constants.js';
import { createAuthorityRuntime, type AuthorityRuntime } from './runtime.js';
import { registerRoutes } from './routes.js';

export const info = {
    id: AUTHORITY_PLUGIN_ID,
    name: 'ST Authority',
    description: 'Authority security center and delegation platform for SillyTavern extensions.',
};

let runtime: AuthorityRuntime | null = null;

export async function init(router: any): Promise<void> {
    runtime ??= createAuthorityRuntime();
    registerRoutes(router, runtime);
    void runtime.install.bootstrap();
    void runtime.core.start();
}

export async function exit(): Promise<void> {
    if (!runtime) {
        return;
    }

    await runtime.core.stop();
    runtime = null;
}

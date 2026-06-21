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
    await runtime.install.bootstrap();
    // Phase 1: discover companion module manifests without loading any
    // server.cjs. Discovery failures must never block DOA startup; they are
    // recorded as diagnostics on the affected records and surfaced through
    // /modules for admin/debug inspection.
    try {
        const result = runtime.moduleDiscovery.discover();
        runtime.modules.registerDiscoveredRecords(result.records);
    } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        runtime.install.getStatus();
        // There is no public logger on AuthorityRuntime; rely on the install
        // service's logger indirectly via console for now. Phase 2 will route
        // this through a dedicated runtime logger.
        console.warn(`[authority] Module discovery failed: ${message}`);
    }
    void runtime.core.start();
}

export async function exit(): Promise<void> {
    if (!runtime) {
        return;
    }

    await runtime.core.stop();
    runtime = null;
}

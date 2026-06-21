import { AUTHORITY_PLUGIN_ID } from './constants.js';
import { createAuthorityRuntime, type AuthorityRuntime } from './runtime.js';
import { registerRoutes } from './routes.js';

/**
 * Webpack-safe runtime require for the bundled `runtime/index.cjs`. Tests
 * and the smoke-test entry point use this to load external `.authority/
 * server.cjs` files from disk without going through webpack's bundle-time
 * `__webpack_require__`. Built on `node:module.createRequire(import.meta.url)`,
 * which webpack leaves intact as a runtime call on an imported binding.
 */
export { loadCompanionModuleFromDisk } from './services/companion-module-loader-service.js';

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
    // Phase 1+2: discover companion module manifests and then load their
    // server.cjs at startup. Discovery failures must never block DOA
    // startup; they are recorded as diagnostics on the affected records and
    // surfaced through /modules for admin/debug inspection. Loader failures
    // (invalid export, activate throw, activation timeout, missing/undeclared
    // handler) transition the record to load_error without throwing.
    try {
        const result = runtime.moduleDiscovery.discover();
        runtime.modules.registerDiscoveredRecords(result.records);
        await runtime.companionLoader.loadAll(result);
    } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        runtime.install.getStatus();
        // There is no public logger on AuthorityRuntime; rely on the install
        // service's logger indirectly via console for now.
        console.warn(`[authority] Companion module discovery/load failed: ${message}`);
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

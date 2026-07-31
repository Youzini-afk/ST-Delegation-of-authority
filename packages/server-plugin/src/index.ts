import { AUTHORITY_PLUGIN_ID } from './constants.js';
import { createAuthorityRuntime, type AuthorityRuntime } from './runtime.js';
import { registerRoutes } from './routes.js';
import { ensureDefaultAgentWorkspace } from './services/default-agent-workspace.js';

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
    const hostBridgeStatus = await runtime.hostBridge.bootstrap();
    if (hostBridgeStatus.requiresRestart) {
        console.warn(`[authority] ${hostBridgeStatus.message}`);
    } else if (hostBridgeStatus.status === 'conflict' || hostBridgeStatus.status === 'error') {
        console.warn(`[authority] Host Bridge ${hostBridgeStatus.status}: ${hostBridgeStatus.message}`);
    }
    try {
        const workspace = await ensureDefaultAgentWorkspace(runtime);
        if (!workspace) {
            console.warn('[authority] SillyTavern root could not be resolved; the default Agent scope was not registered.');
        }
    } catch (error) {
        console.warn(`[authority] Default Agent scope registration failed: ${error instanceof Error ? error.message : String(error)}`);
    }
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
    void runtime.agentSessions.start().then(result => {
        for (const problem of result.problems) {
            console.warn(`[authority] Agent session recovery skipped ${problem.sessionId}: ${problem.error}`);
        }
    }).catch(error => {
        console.warn(`[authority] Agent session runtime startup failed: ${error instanceof Error ? error.message : String(error)}`);
    });
    void runtime.core.start();
}

export async function exit(): Promise<void> {
    if (!runtime) {
        return;
    }

    const current = runtime;
    try {
        await current.agentSessions.stop();
    } finally {
        try {
            await current.core.stop();
        } finally {
            runtime = null;
        }
    }
}

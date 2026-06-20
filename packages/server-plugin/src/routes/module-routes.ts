import { AUTHORITY_SDK_EXTENSION_ID } from '../constants.js';
import type { ModuleTransactionRequest } from '@stdo/shared-types';
import type { AuthorityRuntime } from '../runtime.js';
import type { AuthorityRequest, AuthorityResponse } from '../types.js';
import { getSessionToken, getUserContext } from '../utils.js';

type RouterLike = {
    get(path: string, handler: (req: AuthorityRequest, res: AuthorityResponse) => void | Promise<void>): void;
    post(path: string, handler: (req: AuthorityRequest, res: AuthorityResponse) => void | Promise<void>): void;
};

type RouteFailureHandler = (runtime: AuthorityRuntime, req: AuthorityRequest, res: AuthorityResponse, extensionId: string, error: unknown) => void;

function ok(res: AuthorityResponse, data: unknown): void {
    res.json(data);
}

function decodeParam(value: string | undefined): string {
    return typeof value === 'string' ? decodeURIComponent(value) : '';
}

/**
 * Resolves the extension id used for audit on failure. Prefers the active
 * session's extension id; falls back to the bundled SDK extension id when no
 * session is available (e.g. invalid token, user mismatch).
 */
async function resolveAuditExtensionId(runtime: AuthorityRuntime, req: AuthorityRequest): Promise<string> {
    try {
        const user = getUserContext(req);
        const session = await runtime.sessions.assertSession(getSessionToken(req), user);
        return session.extension.id;
    } catch {
        return AUTHORITY_SDK_EXTENSION_ID;
    }
}

export function registerModuleRoutes(router: RouterLike, runtime: AuthorityRuntime, fail: RouteFailureHandler): void {
    router.get('/modules', async (req, res) => {
        let extensionId = AUTHORITY_SDK_EXTENSION_ID;
        try {
            const user = getUserContext(req);
            const session = await runtime.sessions.assertSession(getSessionToken(req), user);
            extensionId = session.extension.id;
            ok(res, runtime.modules.listManifests());
        } catch (error) {
            fail(runtime, req, res, extensionId, error);
        }
    });

    router.get('/modules/:moduleId', async (req, res) => {
        let extensionId = AUTHORITY_SDK_EXTENSION_ID;
        try {
            const user = getUserContext(req);
            const session = await runtime.sessions.assertSession(getSessionToken(req), user);
            extensionId = session.extension.id;
            const moduleId = decodeParam(req.params?.moduleId);
            ok(res, runtime.modules.getManifest(moduleId));
        } catch (error) {
            fail(runtime, req, res, extensionId, error);
        }
    });

    router.post('/modules/:moduleId/transactions/:transactionName', async (req, res) => {
        let extensionId = AUTHORITY_SDK_EXTENSION_ID;
        try {
            const user = getUserContext(req);
            const session = await runtime.sessions.assertSession(getSessionToken(req), user);
            extensionId = session.extension.id;
            const moduleId = decodeParam(req.params?.moduleId);
            const transactionName = decodeParam(req.params?.transactionName);
            const payload = (req.body ?? {}) as ModuleTransactionRequest;
            const response = await runtime.modules.execute(user, session, moduleId, transactionName, payload);
            // Success audit lives in ModuleHostService.execute so it can include
            // the resolved transaction version and idempotency key without being
            // duplicated at the route layer.
            ok(res, response);
        } catch (error) {
            // Fall back to session-resolved extension id when possible so audit
            // attributes the failure to the calling extension rather than the SDK.
            extensionId = await resolveAuditExtensionId(runtime, req);
            fail(runtime, req, res, extensionId, error);
        }
    });
}

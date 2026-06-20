import type { BmeVectorApplyRequest, BmeVectorManifestRequest } from '@stdo/shared-types';
import { AUTHORITY_SDK_EXTENSION_ID } from '../constants.js';
import {
    executeBmeVectorApply,
    executeBmeVectorManifest,
    normalizeBmeDatabase,
} from '../modules/builtin/st-bme-module.js';
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

/**
 * Resolves the extension id used for failure audit. Prefers the active
 * session's extension id (so failures attribute to the calling extension);
 * falls back to the bundled SDK extension id when no session is available.
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

export function registerBmeRoutes(router: RouterLike, runtime: AuthorityRuntime, fail: RouteFailureHandler): void {
    router.post('/bme/vector-manifest', async (req, res) => {
        let extensionId = AUTHORITY_SDK_EXTENSION_ID;
        try {
            const user = getUserContext(req);
            const session = await runtime.sessions.assertSession(getSessionToken(req), user);
            extensionId = session.extension.id;
            const payload = (req.body ?? {}) as BmeVectorManifestRequest;
            const database = normalizeBmeDatabase(payload.database);
            if (!await runtime.permissions.authorize(user, session, { resource: 'trivium.private', target: database })) {
                throw new Error(`Permission not granted: trivium.private for ${database}`);
            }
            // Legacy routes return the BME vector response shape directly, not
            // the module envelope, and require only trivium.private (no
            // module.execute) for backwards compatibility with existing ST-BME
            // clients. The shared helper reuses the same normalized payload
            // and trivium call as the built-in st-bme module handler.
            ok(res, await executeBmeVectorManifest(runtime.trivium, user, session.extension.id, payload));
        } catch (error) {
            // Fall back to session-resolved extension id when possible so
            // audit attributes the failure to the calling extension rather
            // than the SDK fallback id.
            extensionId = await resolveAuditExtensionId(runtime, req);
            fail(runtime, req, res, extensionId, error);
        }
    });

    router.post('/bme/vector-apply', async (req, res) => {
        let extensionId = AUTHORITY_SDK_EXTENSION_ID;
        try {
            const user = getUserContext(req);
            const session = await runtime.sessions.assertSession(getSessionToken(req), user);
            extensionId = session.extension.id;
            const payload = (req.body ?? {}) as BmeVectorApplyRequest;
            const database = normalizeBmeDatabase(payload.database);
            if (!await runtime.permissions.authorize(user, session, { resource: 'trivium.private', target: database })) {
                throw new Error(`Permission not granted: trivium.private for ${database}`);
            }
            ok(res, await executeBmeVectorApply(runtime.trivium, user, session.extension.id, payload));
        } catch (error) {
            extensionId = await resolveAuditExtensionId(runtime, req);
            fail(runtime, req, res, extensionId, error);
        }
    });
}

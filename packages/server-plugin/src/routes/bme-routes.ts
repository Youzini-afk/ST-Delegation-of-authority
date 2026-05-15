import type { BmeVectorApplyRequest, BmeVectorManifestRequest } from '@stdo/shared-types';
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

function getTriviumDatabaseName(value: unknown): string {
    return typeof value === 'string' && value.trim() ? value.trim() : 'default';
}

export function registerBmeRoutes(router: RouterLike, runtime: AuthorityRuntime, fail: RouteFailureHandler): void {
    router.post('/bme/vector-manifest', async (req, res) => {
        try {
            const user = getUserContext(req);
            const session = await runtime.sessions.assertSession(getSessionToken(req), user);
            const payload = (req.body ?? {}) as BmeVectorManifestRequest;
            const database = getTriviumDatabaseName(payload.database);
            if (!await runtime.permissions.authorize(user, session, { resource: 'trivium.private', target: database })) {
                throw new Error(`Permission not granted: trivium.private for ${database}`);
            }
            ok(res, await runtime.trivium.getBmeVectorManifest(user, session.extension.id, payload));
        } catch (error) {
            fail(runtime, req, res, 'bme.vector', error);
        }
    });

    router.post('/bme/vector-apply', async (req, res) => {
        try {
            const user = getUserContext(req);
            const session = await runtime.sessions.assertSession(getSessionToken(req), user);
            const payload = (req.body ?? {}) as BmeVectorApplyRequest;
            const database = getTriviumDatabaseName(payload.database);
            if (!await runtime.permissions.authorize(user, session, { resource: 'trivium.private', target: database })) {
                throw new Error(`Permission not granted: trivium.private for ${database}`);
            }
            ok(res, await runtime.trivium.applyBmeVectorManifest(user, session.extension.id, payload));
        } catch (error) {
            fail(runtime, req, res, 'bme.vector', error);
        }
    });
}

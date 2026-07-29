import { AUTHORITY_SDK_EXTENSION_ID } from '../constants.js';
import type { AuthorityRuntime } from '../runtime.js';
import type { AuthorityRequest, AuthorityResponse, SessionRecord, UserContext } from '../types.js';
import { getSessionToken, getUserContext } from '../utils.js';

export interface AuthorityCallerContext {
    user: UserContext;
    session: SessionRecord;
}

export type AuthorityRouteFailureHandler = (
    runtime: AuthorityRuntime,
    req: AuthorityRequest,
    res: AuthorityResponse,
    extensionId: string,
    error: unknown,
) => void;

export async function requireAuthorityCaller(
    runtime: AuthorityRuntime,
    req: AuthorityRequest,
): Promise<AuthorityCallerContext> {
    const user = getUserContext(req);
    const session = await runtime.sessions.assertSession(getSessionToken(req), user);
    return { user, session };
}

export function withAuthorityAdmin(
    runtime: AuthorityRuntime,
    fail: AuthorityRouteFailureHandler,
    handler: (
        req: AuthorityRequest,
        res: AuthorityResponse,
        context: AuthorityCallerContext,
    ) => void | Promise<void>,
): (req: AuthorityRequest, res: AuthorityResponse) => Promise<void> {
    return async (req, res) => {
        let extensionId = AUTHORITY_SDK_EXTENSION_ID;
        try {
            const context = await requireAuthorityCaller(runtime, req);
            extensionId = context.session.extension.id;
            if (!context.user.isAdmin) {
                throw new Error('Forbidden');
            }
            await handler(req, res, context);
        } catch (error) {
            fail(runtime, req, res, extensionId, error);
        }
    };
}

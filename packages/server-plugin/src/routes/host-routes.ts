import type {
    AuthorityHostEventListRequest,
    AuthorityHostEventListResponse,
    AuthorityHostEventGetResponse,
    AuthorityHostConversationGetResponse,
} from '@stdo/shared-types';
import { AUTHORITY_SDK_EXTENSION_ID } from '../constants.js';
import type { AuthorityRuntime } from '../runtime.js';
import type { AuthorityRequest, AuthorityResponse } from '../types.js';
import { getSessionToken, getUserContext } from '../utils.js';

type RouterLike = {
    get(path: string, handler: (req: AuthorityRequest, res: AuthorityResponse) => void | Promise<void>): void;
    post(path: string, handler: (req: AuthorityRequest, res: AuthorityResponse) => void | Promise<void>): void;
};

type RouteFailureHandler = (runtime: AuthorityRuntime, req: AuthorityRequest, res: AuthorityResponse, extensionId: string, error: unknown) => void;

function decodeParam(value: string | undefined): string {
    return typeof value === 'string' ? decodeURIComponent(value) : '';
}

export function registerHostRoutes(router: RouterLike, runtime: AuthorityRuntime, fail: RouteFailureHandler): void {
    router.post('/host/events/commit', async (req, res) => {
        let extensionId = AUTHORITY_SDK_EXTENSION_ID;
        try {
            const user = getUserContext(req);
            const session = await runtime.sessions.assertSession(getSessionToken(req), user);
            extensionId = session.extension.id;
            const response = await runtime.hostEvents.recordCommit(user, req.body, extensionId);
            await runtime.audit.logUsage(user, extensionId, 'Host commit recorded', {
                eventId: response.event.eventId,
                conversationId: response.event.conversationId,
                revision: response.event.revision,
                replayed: response.replayed,
                continuity: response.event.continuity,
            }).catch(() => undefined);
            res.json(response);
        } catch (error) {
            fail(runtime, req, res, extensionId, error);
        }
    });

    router.get('/host/events/:eventId', async (req, res) => {
        let extensionId = AUTHORITY_SDK_EXTENSION_ID;
        try {
            const user = getUserContext(req);
            const session = await runtime.sessions.assertSession(getSessionToken(req), user);
            extensionId = session.extension.id;
            const response: AuthorityHostEventGetResponse = {
                event: await runtime.hostEvents.getEvent(user, decodeParam(req.params?.eventId)),
            };
            res.json(response);
        } catch (error) {
            fail(runtime, req, res, extensionId, error);
        }
    });

    router.get('/host/conversations/:conversationId', async (req, res) => {
        let extensionId = AUTHORITY_SDK_EXTENSION_ID;
        try {
            const user = getUserContext(req);
            const session = await runtime.sessions.assertSession(getSessionToken(req), user);
            extensionId = session.extension.id;
            const response: AuthorityHostConversationGetResponse = {
                conversation: await runtime.hostEvents.getConversation(user, decodeParam(req.params?.conversationId)),
            };
            res.json(response);
        } catch (error) {
            fail(runtime, req, res, extensionId, error);
        }
    });

    router.post('/host/events/list', async (req, res) => {
        let extensionId = AUTHORITY_SDK_EXTENSION_ID;
        try {
            const user = getUserContext(req);
            const session = await runtime.sessions.assertSession(getSessionToken(req), user);
            extensionId = session.extension.id;
            const response: AuthorityHostEventListResponse = await runtime.hostEvents.listEvents(
                user,
                (req.body ?? {}) as AuthorityHostEventListRequest,
            );
            res.json(response);
        } catch (error) {
            fail(runtime, req, res, extensionId, error);
        }
    });
}

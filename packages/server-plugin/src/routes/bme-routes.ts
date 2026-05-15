import type {
    TriviumBulkLinkRequest,
    TriviumBulkUpsertRequest,
    TriviumBulkMutationResponse,
    TriviumBulkUpsertResponse,
} from '@stdo/shared-types';
import type { AuthorityRuntime } from '../runtime.js';
import type { AuthorityRequest, AuthorityResponse } from '../types.js';
import { getSessionToken, getUserContext } from '../utils.js';

type RouterLike = {
    post(path: string, handler: (req: AuthorityRequest, res: AuthorityResponse) => void | Promise<void>): void;
};

type RouteFailureHandler = (runtime: AuthorityRuntime, req: AuthorityRequest, res: AuthorityResponse, extensionId: string, error: unknown) => void;

interface BmeVectorApplyPayload extends Omit<TriviumBulkUpsertRequest, 'items'> {
    chatId?: string;
    collectionId?: string;
    namespace?: string;
    graphRevision?: number;
    modelScope?: string;
    vectorSpaceId?: string;
    observedDim?: number;
    embeddingMode?: string;
    items?: TriviumBulkUpsertRequest['items'];
    links?: TriviumBulkLinkRequest['items'];
}

function ok(res: AuthorityResponse, data: unknown): void {
    res.json(data);
}

function getTriviumDatabaseName(value: unknown): string {
    return typeof value === 'string' && value.trim() ? value.trim() : 'default';
}

function buildManifest(payload: BmeVectorApplyPayload, upsert: TriviumBulkUpsertResponse, links: TriviumBulkMutationResponse) {
    const graphRevision = Math.max(0, Math.floor(Number(payload.graphRevision) || 0));
    const observedDim = Math.max(0, Math.floor(Number(payload.observedDim) || 0));
    return {
        protocolVersion: 1,
        backend: 'authority',
        status: upsert.failureCount === 0 && links.failureCount === 0 ? 'clean' : 'degraded',
        chatId: String(payload.chatId ?? ''),
        collectionId: String(payload.collectionId ?? payload.namespace ?? ''),
        namespace: String(payload.namespace ?? payload.collectionId ?? ''),
        graphRevision,
        revision: graphRevision,
        modelScope: String(payload.modelScope ?? ''),
        vectorSpaceId: String(payload.vectorSpaceId ?? ''),
        observedDim,
        itemCount: upsert.successCount,
        linkCount: links.successCount,
        updatedAt: new Date().toISOString(),
    };
}

export function registerBmeRoutes(router: RouterLike, runtime: AuthorityRuntime, fail: RouteFailureHandler): void {
    router.post('/bme/vector-apply', async (req, res) => {
        let extensionId = 'bme.vector';
        try {
            const user = getUserContext(req);
            const session = await runtime.sessions.assertSession(getSessionToken(req), user);
            extensionId = session.extension.id;
            const payload = (req.body ?? {}) as BmeVectorApplyPayload;
            const database = getTriviumDatabaseName(payload.database);
            if (!await runtime.permissions.authorize(user, session, { resource: 'trivium.private', target: database })) {
                throw new Error(`Permission not granted: trivium.private for ${database}`);
            }

            const namespace = String(payload.namespace ?? payload.collectionId ?? '').trim();
            const items = Array.isArray(payload.items) ? payload.items : [];
            const linkItems = Array.isArray(payload.links) ? payload.links : [];
            const upsert = await runtime.trivium.bulkUpsert(user, extensionId, {
                ...payload,
                database,
                items,
            });
            const links = linkItems.length > 0
                ? await runtime.trivium.bulkLink(user, extensionId, {
                    database,
                    items: linkItems,
                })
                : {
                    totalCount: 0,
                    successCount: 0,
                    failureCount: 0,
                    failures: [],
                } satisfies TriviumBulkMutationResponse;

            await runtime.audit.logUsage(user, extensionId, 'BME vector apply', {
                database,
                namespace,
                graphRevision: Number(payload.graphRevision || 0),
                upserted: upsert.successCount,
                linked: links.successCount,
                upsertFailures: upsert.failureCount,
                linkFailures: links.failureCount,
            });

            ok(res, {
                ok: upsert.failureCount === 0 && links.failureCount === 0,
                protocolVersion: 1,
                upsert,
                links,
                upserted: upsert.successCount,
                linked: links.successCount,
                manifest: buildManifest(payload, upsert, links),
            });
        } catch (error) {
            fail(runtime, req, res, extensionId, error);
        }
    });
}

import type {
    TriviumBulkDeleteRequest,
    TriviumBulkLinkRequest,
    TriviumBulkUnlinkRequest,
    TriviumBulkUpsertRequest,
    TriviumBuildTextIndexRequest,
    TriviumCheckMappingsIntegrityRequest,
    TriviumCompactRequest,
    TriviumCreateIndexRequest,
    TriviumDeleteRequest,
    TriviumDeleteOrphanMappingsRequest,
    TriviumDropIndexRequest,
    TriviumFlushRequest,
    TriviumGetRequest,
    TriviumIndexKeywordRequest,
    TriviumIndexTextRequest,
    TriviumInsertRequest,
    TriviumInsertWithIdRequest,
    TriviumLinkRequest,
    TriviumListDatabasesResponse,
    TriviumListMappingsRequest,
    TriviumNeighborsRequest,
    TriviumResolveIdRequest,
    TriviumResolveManyRequest,
    TriviumSearchAdvancedRequest,
    TriviumSearchHybridRequest,
    TriviumSearchHybridWithContextRequest,
    TriviumSearchRequest,
    TriviumStatRequest,
    TriviumTqlMutRequest,
    TriviumTqlRequest,
    TriviumUnlinkRequest,
    TriviumUpsertRequest,
    TriviumUpdatePayloadRequest,
    TriviumUpdateVectorRequest,
} from '@stdo/shared-types';
import type { AuthorityRuntime } from '../runtime.js';
import { getUserAuthorityPaths } from '../store/authority-paths.js';
import type { AuthorityRequest, AuthorityResponse } from '../types.js';
import { getSessionToken, getUserContext, resolveContainedPath, sanitizeFileSegment } from '../utils.js';

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

function resolvePrivateTriviumDatabaseDir(user: ReturnType<typeof getUserContext>, extensionId: string): string {
    const paths = getUserAuthorityPaths(user);
    return resolveContainedPath(paths.triviumPrivateDir, sanitizeFileSegment(extensionId));
}

function resolvePrivateTriviumDatabasePath(user: ReturnType<typeof getUserContext>, extensionId: string, databaseName: string): string {
    return resolveContainedPath(
        resolvePrivateTriviumDatabaseDir(user, extensionId),
        `${sanitizeFileSegment(databaseName)}.tdb`,
    );
}

export async function listPrivateTriviumDatabases(
    runtime: AuthorityRuntime,
    user: ReturnType<typeof getUserContext>,
    extensionId: string,
): Promise<TriviumListDatabasesResponse> {
    return await runtime.trivium.listDatabases(user, extensionId);
}

export function registerTriviumRoutes(router: RouterLike, runtime: AuthorityRuntime, fail: RouteFailureHandler): void {
    router.post('/trivium/insert', async (req, res) => {
        try {
            const user = getUserContext(req);
            const session = await runtime.sessions.assertSession(getSessionToken(req), user);
            const payload = (req.body ?? {}) as TriviumInsertRequest;
            const database = getTriviumDatabaseName(payload.database);
            if (!await runtime.permissions.authorize(user, session, { resource: 'trivium.private', target: database })) {
                throw new Error(`Permission not granted: trivium.private for ${database}`);
            }

            const response = await runtime.trivium.insert(user, session.extension.id, payload);
            await runtime.audit.logUsage(user, session.extension.id, 'Trivium insert', {
                database,
                id: response.id,
            });
            ok(res, response);
        } catch (error) {
            fail(runtime, req, res, 'trivium.private', error);
        }
    });

    router.post('/trivium/insert-with-id', async (req, res) => {
        try {
            const user = getUserContext(req);
            const session = await runtime.sessions.assertSession(getSessionToken(req), user);
            const payload = (req.body ?? {}) as TriviumInsertWithIdRequest;
            const database = getTriviumDatabaseName(payload.database);
            if (!await runtime.permissions.authorize(user, session, { resource: 'trivium.private', target: database })) {
                throw new Error(`Permission not granted: trivium.private for ${database}`);
            }

            await runtime.trivium.insertWithId(user, session.extension.id, payload);
            await runtime.audit.logUsage(user, session.extension.id, 'Trivium insert with id', {
                database,
                id: payload.id,
            });
            ok(res, { ok: true });
        } catch (error) {
            fail(runtime, req, res, 'trivium.private', error);
        }
    });

    router.post('/trivium/resolve-id', async (req, res) => {
        try {
            const user = getUserContext(req);
            const session = await runtime.sessions.assertSession(getSessionToken(req), user);
            const payload = (req.body ?? {}) as TriviumResolveIdRequest;
            const database = getTriviumDatabaseName(payload.database);
            if (!await runtime.permissions.authorize(user, session, { resource: 'trivium.private', target: database })) {
                throw new Error(`Permission not granted: trivium.private for ${database}`);
            }

            const result = await runtime.trivium.resolveId(user, session.extension.id, payload);
            await runtime.audit.logUsage(user, session.extension.id, 'Trivium resolve id', {
                database,
                externalId: result.externalId,
                namespace: result.namespace,
                id: result.id,
            });
            ok(res, result);
        } catch (error) {
            fail(runtime, req, res, 'trivium.private', error);
        }
    });

    router.post('/trivium/resolve-many', async (req, res) => {
        try {
            const user = getUserContext(req);
            const session = await runtime.sessions.assertSession(getSessionToken(req), user);
            const payload = (req.body ?? {}) as TriviumResolveManyRequest;
            const database = getTriviumDatabaseName(payload.database);
            if (!await runtime.permissions.authorize(user, session, { resource: 'trivium.private', target: database })) {
                throw new Error(`Permission not granted: trivium.private for ${database}`);
            }

            const result = await runtime.trivium.resolveMany(user, session.extension.id, payload);
            await runtime.audit.logUsage(user, session.extension.id, 'Trivium resolve many', {
                database,
                totalCount: result.items.length,
            });
            ok(res, result);
        } catch (error) {
            fail(runtime, req, res, 'trivium.private', error);
        }
    });

    router.post('/trivium/upsert', async (req, res) => {
        try {
            const user = getUserContext(req);
            const session = await runtime.sessions.assertSession(getSessionToken(req), user);
            const payload = (req.body ?? {}) as TriviumUpsertRequest;
            const database = getTriviumDatabaseName(payload.database);
            if (!await runtime.permissions.authorize(user, session, { resource: 'trivium.private', target: database })) {
                throw new Error(`Permission not granted: trivium.private for ${database}`);
            }

            const result = await runtime.trivium.upsert(user, session.extension.id, payload);
            await runtime.audit.logUsage(user, session.extension.id, 'Trivium upsert', {
                database,
                id: result.id,
                action: result.action,
                externalId: result.externalId,
                namespace: result.namespace,
            });
            ok(res, result);
        } catch (error) {
            fail(runtime, req, res, 'trivium.private', error);
        }
    });

    router.post('/trivium/bulk-upsert', async (req, res) => {
        try {
            const user = getUserContext(req);
            const session = await runtime.sessions.assertSession(getSessionToken(req), user);
            const payload = (req.body ?? {}) as TriviumBulkUpsertRequest;
            const database = getTriviumDatabaseName(payload.database);
            if (!await runtime.permissions.authorize(user, session, { resource: 'trivium.private', target: database })) {
                throw new Error(`Permission not granted: trivium.private for ${database}`);
            }

            const result = await runtime.trivium.bulkUpsert(user, session.extension.id, payload);
            await runtime.audit.logUsage(user, session.extension.id, 'Trivium bulk upsert', {
                database,
                totalCount: result.totalCount,
                successCount: result.successCount,
                failureCount: result.failureCount,
            });
            ok(res, result);
        } catch (error) {
            fail(runtime, req, res, 'trivium.private', error);
        }
    });

    router.post('/trivium/get', async (req, res) => {
        try {
            const user = getUserContext(req);
            const session = await runtime.sessions.assertSession(getSessionToken(req), user);
            const payload = (req.body ?? {}) as TriviumGetRequest;
            const database = getTriviumDatabaseName(payload.database);
            if (!await runtime.permissions.authorize(user, session, { resource: 'trivium.private', target: database })) {
                throw new Error(`Permission not granted: trivium.private for ${database}`);
            }

            const node = await runtime.trivium.get(user, session.extension.id, payload);
            await runtime.audit.logUsage(user, session.extension.id, 'Trivium get', {
                database,
                id: payload.id,
            });
            ok(res, { node });
        } catch (error) {
            fail(runtime, req, res, 'trivium.private', error);
        }
    });

    router.post('/trivium/update-payload', async (req, res) => {
        try {
            const user = getUserContext(req);
            const session = await runtime.sessions.assertSession(getSessionToken(req), user);
            const payload = (req.body ?? {}) as TriviumUpdatePayloadRequest;
            const database = getTriviumDatabaseName(payload.database);
            if (!await runtime.permissions.authorize(user, session, { resource: 'trivium.private', target: database })) {
                throw new Error(`Permission not granted: trivium.private for ${database}`);
            }

            await runtime.trivium.updatePayload(user, session.extension.id, payload);
            await runtime.audit.logUsage(user, session.extension.id, 'Trivium update payload', {
                database,
                id: payload.id,
            });
            ok(res, { ok: true });
        } catch (error) {
            fail(runtime, req, res, 'trivium.private', error);
        }
    });

    router.post('/trivium/update-vector', async (req, res) => {
        try {
            const user = getUserContext(req);
            const session = await runtime.sessions.assertSession(getSessionToken(req), user);
            const payload = (req.body ?? {}) as TriviumUpdateVectorRequest;
            const database = getTriviumDatabaseName(payload.database);
            if (!await runtime.permissions.authorize(user, session, { resource: 'trivium.private', target: database })) {
                throw new Error(`Permission not granted: trivium.private for ${database}`);
            }

            await runtime.trivium.updateVector(user, session.extension.id, payload);
            await runtime.audit.logUsage(user, session.extension.id, 'Trivium update vector', {
                database,
                id: payload.id,
            });
            ok(res, { ok: true });
        } catch (error) {
            fail(runtime, req, res, 'trivium.private', error);
        }
    });

    router.post('/trivium/delete', async (req, res) => {
        try {
            const user = getUserContext(req);
            const session = await runtime.sessions.assertSession(getSessionToken(req), user);
            const payload = (req.body ?? {}) as TriviumDeleteRequest;
            const database = getTriviumDatabaseName(payload.database);
            if (!await runtime.permissions.authorize(user, session, { resource: 'trivium.private', target: database })) {
                throw new Error(`Permission not granted: trivium.private for ${database}`);
            }

            await runtime.trivium.delete(user, session.extension.id, payload);
            await runtime.audit.logUsage(user, session.extension.id, 'Trivium delete', {
                database,
                id: payload.id,
            });
            ok(res, { ok: true });
        } catch (error) {
            fail(runtime, req, res, 'trivium.private', error);
        }
    });

    router.post('/trivium/bulk-delete', async (req, res) => {
        try {
            const user = getUserContext(req);
            const session = await runtime.sessions.assertSession(getSessionToken(req), user);
            const payload = (req.body ?? {}) as TriviumBulkDeleteRequest;
            const database = getTriviumDatabaseName(payload.database);
            if (!await runtime.permissions.authorize(user, session, { resource: 'trivium.private', target: database })) {
                throw new Error(`Permission not granted: trivium.private for ${database}`);
            }

            const result = await runtime.trivium.bulkDelete(user, session.extension.id, payload);
            await runtime.audit.logUsage(user, session.extension.id, 'Trivium bulk delete', {
                database,
                totalCount: result.totalCount,
                successCount: result.successCount,
                failureCount: result.failureCount,
            });
            ok(res, result);
        } catch (error) {
            fail(runtime, req, res, 'trivium.private', error);
        }
    });

    router.post('/trivium/link', async (req, res) => {
        try {
            const user = getUserContext(req);
            const session = await runtime.sessions.assertSession(getSessionToken(req), user);
            const payload = (req.body ?? {}) as TriviumLinkRequest;
            const database = getTriviumDatabaseName(payload.database);
            if (!await runtime.permissions.authorize(user, session, { resource: 'trivium.private', target: database })) {
                throw new Error(`Permission not granted: trivium.private for ${database}`);
            }

            const dbPath = resolvePrivateTriviumDatabasePath(user, session.extension.id, database);
            await runtime.core.linkTrivium(dbPath, {
                ...payload,
                database,
            });
            await runtime.audit.logUsage(user, session.extension.id, 'Trivium link', {
                database,
                src: payload.src,
                dst: payload.dst,
            });
            ok(res, { ok: true });
        } catch (error) {
            fail(runtime, req, res, 'trivium.private', error);
        }
    });

    router.post('/trivium/bulk-link', async (req, res) => {
        try {
            const user = getUserContext(req);
            const session = await runtime.sessions.assertSession(getSessionToken(req), user);
            const payload = (req.body ?? {}) as TriviumBulkLinkRequest;
            const database = getTriviumDatabaseName(payload.database);
            if (!await runtime.permissions.authorize(user, session, { resource: 'trivium.private', target: database })) {
                throw new Error(`Permission not granted: trivium.private for ${database}`);
            }

            const result = await runtime.trivium.bulkLink(user, session.extension.id, payload);
            await runtime.audit.logUsage(user, session.extension.id, 'Trivium bulk link', {
                database,
                totalCount: result.totalCount,
                successCount: result.successCount,
                failureCount: result.failureCount,
            });
            ok(res, result);
        } catch (error) {
            fail(runtime, req, res, 'trivium.private', error);
        }
    });

    router.post('/trivium/unlink', async (req, res) => {
        try {
            const user = getUserContext(req);
            const session = await runtime.sessions.assertSession(getSessionToken(req), user);
            const payload = (req.body ?? {}) as TriviumUnlinkRequest;
            const database = getTriviumDatabaseName(payload.database);
            if (!await runtime.permissions.authorize(user, session, { resource: 'trivium.private', target: database })) {
                throw new Error(`Permission not granted: trivium.private for ${database}`);
            }

            const dbPath = resolvePrivateTriviumDatabasePath(user, session.extension.id, database);
            await runtime.core.unlinkTrivium(dbPath, {
                ...payload,
                database,
            });
            await runtime.audit.logUsage(user, session.extension.id, 'Trivium unlink', {
                database,
                src: payload.src,
                dst: payload.dst,
            });
            ok(res, { ok: true });
        } catch (error) {
            fail(runtime, req, res, 'trivium.private', error);
        }
    });

    router.post('/trivium/bulk-unlink', async (req, res) => {
        try {
            const user = getUserContext(req);
            const session = await runtime.sessions.assertSession(getSessionToken(req), user);
            const payload = (req.body ?? {}) as TriviumBulkUnlinkRequest;
            const database = getTriviumDatabaseName(payload.database);
            if (!await runtime.permissions.authorize(user, session, { resource: 'trivium.private', target: database })) {
                throw new Error(`Permission not granted: trivium.private for ${database}`);
            }

            const result = await runtime.trivium.bulkUnlink(user, session.extension.id, payload);
            await runtime.audit.logUsage(user, session.extension.id, 'Trivium bulk unlink', {
                database,
                totalCount: result.totalCount,
                successCount: result.successCount,
                failureCount: result.failureCount,
            });
            ok(res, result);
        } catch (error) {
            fail(runtime, req, res, 'trivium.private', error);
        }
    });

    router.post('/trivium/neighbors', async (req, res) => {
        try {
            const user = getUserContext(req);
            const session = await runtime.sessions.assertSession(getSessionToken(req), user);
            const payload = (req.body ?? {}) as TriviumNeighborsRequest;
            const database = getTriviumDatabaseName(payload.database);
            if (!await runtime.permissions.authorize(user, session, { resource: 'trivium.private', target: database })) {
                throw new Error(`Permission not granted: trivium.private for ${database}`);
            }

            const result = await runtime.trivium.neighbors(user, session.extension.id, payload);
            await runtime.audit.logUsage(user, session.extension.id, 'Trivium neighbors', {
                database,
                id: payload.id,
                depth: payload.depth ?? 1,
            });
            ok(res, result);
        } catch (error) {
            fail(runtime, req, res, 'trivium.private', error);
        }
    });

    router.post('/trivium/search', async (req, res) => {
        try {
            const user = getUserContext(req);
            const session = await runtime.sessions.assertSession(getSessionToken(req), user);
            const payload = (req.body ?? {}) as TriviumSearchRequest;
            const database = getTriviumDatabaseName(payload.database);
            if (!await runtime.permissions.authorize(user, session, { resource: 'trivium.private', target: database })) {
                throw new Error(`Permission not granted: trivium.private for ${database}`);
            }

            const hits = await runtime.trivium.search(user, session.extension.id, payload);
            await runtime.audit.logUsage(user, session.extension.id, 'Trivium search', {
                database,
                topK: payload.topK ?? 5,
                expandDepth: payload.expandDepth ?? 0,
            });
            ok(res, { hits });
        } catch (error) {
            fail(runtime, req, res, 'trivium.private', error);
        }
    });

    router.post('/trivium/search-advanced', async (req, res) => {
        try {
            const user = getUserContext(req);
            const session = await runtime.sessions.assertSession(getSessionToken(req), user);
            const payload = (req.body ?? {}) as TriviumSearchAdvancedRequest;
            const database = getTriviumDatabaseName(payload.database);
            if (!await runtime.permissions.authorize(user, session, { resource: 'trivium.private', target: database })) {
                throw new Error(`Permission not granted: trivium.private for ${database}`);
            }

            const hits = await runtime.trivium.searchAdvanced(user, session.extension.id, payload);
            await runtime.audit.logUsage(user, session.extension.id, 'Trivium advanced search', {
                database,
                topK: payload.topK ?? 5,
                expandDepth: payload.expandDepth ?? 2,
            });
            ok(res, { hits });
        } catch (error) {
            fail(runtime, req, res, 'trivium.private', error);
        }
    });

    router.post('/trivium/search-hybrid', async (req, res) => {
        try {
            const user = getUserContext(req);
            const session = await runtime.sessions.assertSession(getSessionToken(req), user);
            const payload = (req.body ?? {}) as TriviumSearchHybridRequest;
            const database = getTriviumDatabaseName(payload.database);
            if (!await runtime.permissions.authorize(user, session, { resource: 'trivium.private', target: database })) {
                throw new Error(`Permission not granted: trivium.private for ${database}`);
            }

            const hits = await runtime.trivium.searchHybrid(user, session.extension.id, payload);
            await runtime.audit.logUsage(user, session.extension.id, 'Trivium hybrid search', {
                database,
                topK: payload.topK ?? 5,
                expandDepth: payload.expandDepth ?? 2,
            });
            ok(res, { hits });
        } catch (error) {
            fail(runtime, req, res, 'trivium.private', error);
        }
    });

    router.post('/trivium/search-hybrid-context', async (req, res) => {
        try {
            const user = getUserContext(req);
            const session = await runtime.sessions.assertSession(getSessionToken(req), user);
            const payload = (req.body ?? {}) as TriviumSearchHybridWithContextRequest;
            const database = getTriviumDatabaseName(payload.database);
            if (!await runtime.permissions.authorize(user, session, { resource: 'trivium.private', target: database })) {
                throw new Error(`Permission not granted: trivium.private for ${database}`);
            }

            const response = await runtime.trivium.searchHybridWithContext(user, session.extension.id, payload);
            await runtime.audit.logUsage(user, session.extension.id, 'Trivium hybrid search context', {
                database,
                hitCount: response.hits.length,
            });
            ok(res, response);
        } catch (error) {
            fail(runtime, req, res, 'trivium.private', error);
        }
    });

    router.post('/trivium/tql', async (req, res) => {
        try {
            const user = getUserContext(req);
            const session = await runtime.sessions.assertSession(getSessionToken(req), user);
            const payload = (req.body ?? {}) as TriviumTqlRequest;
            const database = getTriviumDatabaseName(payload.database);
            if (!await runtime.permissions.authorize(user, session, { resource: 'trivium.private', target: database })) {
                throw new Error(`Permission not granted: trivium.private for ${database}`);
            }

            const response = await runtime.trivium.tqlPage(user, session.extension.id, payload);
            await runtime.audit.logUsage(user, session.extension.id, 'Trivium TQL query', {
                database,
                rowCount: response.rows.length,
            });
            ok(res, response);
        } catch (error) {
            fail(runtime, req, res, 'trivium.private', error);
        }
    });

    router.post('/trivium/tql-mut', async (req, res) => {
        try {
            const user = getUserContext(req);
            const session = await runtime.sessions.assertSession(getSessionToken(req), user);
            const payload = (req.body ?? {}) as TriviumTqlMutRequest;
            const database = getTriviumDatabaseName(payload.database);
            if (!await runtime.permissions.authorize(user, session, { resource: 'trivium.private', target: database })) {
                throw new Error(`Permission not granted: trivium.private for ${database}`);
            }

            const response = await runtime.trivium.tqlMut(user, session.extension.id, payload);
            await runtime.audit.logUsage(user, session.extension.id, 'Trivium TQL mutation', {
                database,
                affected: response.affected,
                createdCount: response.createdIds.length,
            });
            ok(res, response);
        } catch (error) {
            fail(runtime, req, res, 'trivium.private', error);
        }
    });

    router.post('/trivium/create-index', async (req, res) => {
        try {
            const user = getUserContext(req);
            const session = await runtime.sessions.assertSession(getSessionToken(req), user);
            const payload = (req.body ?? {}) as TriviumCreateIndexRequest;
            const database = getTriviumDatabaseName(payload.database);
            if (!await runtime.permissions.authorize(user, session, { resource: 'trivium.private', target: database })) {
                throw new Error(`Permission not granted: trivium.private for ${database}`);
            }

            await runtime.trivium.createIndex(user, session.extension.id, payload);
            await runtime.audit.logUsage(user, session.extension.id, 'Trivium create index', {
                database,
                field: payload.field,
            });
            ok(res, { ok: true });
        } catch (error) {
            fail(runtime, req, res, 'trivium.private', error);
        }
    });

    router.post('/trivium/drop-index', async (req, res) => {
        try {
            const user = getUserContext(req);
            const session = await runtime.sessions.assertSession(getSessionToken(req), user);
            const payload = (req.body ?? {}) as TriviumDropIndexRequest;
            const database = getTriviumDatabaseName(payload.database);
            if (!await runtime.permissions.authorize(user, session, { resource: 'trivium.private', target: database })) {
                throw new Error(`Permission not granted: trivium.private for ${database}`);
            }

            await runtime.trivium.dropIndex(user, session.extension.id, payload);
            await runtime.audit.logUsage(user, session.extension.id, 'Trivium drop index', {
                database,
                field: payload.field,
            });
            ok(res, { ok: true });
        } catch (error) {
            fail(runtime, req, res, 'trivium.private', error);
        }
    });

    router.post('/trivium/index-text', async (req, res) => {
        try {
            const user = getUserContext(req);
            const session = await runtime.sessions.assertSession(getSessionToken(req), user);
            const payload = (req.body ?? {}) as TriviumIndexTextRequest;
            const database = getTriviumDatabaseName(payload.database);
            if (!await runtime.permissions.authorize(user, session, { resource: 'trivium.private', target: database })) {
                throw new Error(`Permission not granted: trivium.private for ${database}`);
            }

            await runtime.trivium.indexText(user, session.extension.id, payload);
            await runtime.audit.logUsage(user, session.extension.id, 'Trivium index text', {
                database,
                id: payload.id,
            });
            ok(res, { ok: true });
        } catch (error) {
            fail(runtime, req, res, 'trivium.private', error);
        }
    });

    router.post('/trivium/index-keyword', async (req, res) => {
        try {
            const user = getUserContext(req);
            const session = await runtime.sessions.assertSession(getSessionToken(req), user);
            const payload = (req.body ?? {}) as TriviumIndexKeywordRequest;
            const database = getTriviumDatabaseName(payload.database);
            if (!await runtime.permissions.authorize(user, session, { resource: 'trivium.private', target: database })) {
                throw new Error(`Permission not granted: trivium.private for ${database}`);
            }

            await runtime.trivium.indexKeyword(user, session.extension.id, payload);
            await runtime.audit.logUsage(user, session.extension.id, 'Trivium index keyword', {
                database,
                id: payload.id,
            });
            ok(res, { ok: true });
        } catch (error) {
            fail(runtime, req, res, 'trivium.private', error);
        }
    });

    router.post('/trivium/build-text-index', async (req, res) => {
        try {
            const user = getUserContext(req);
            const session = await runtime.sessions.assertSession(getSessionToken(req), user);
            const payload = (req.body ?? {}) as TriviumBuildTextIndexRequest;
            const database = getTriviumDatabaseName(payload.database);
            if (!await runtime.permissions.authorize(user, session, { resource: 'trivium.private', target: database })) {
                throw new Error(`Permission not granted: trivium.private for ${database}`);
            }

            await runtime.trivium.buildTextIndex(user, session.extension.id, payload);
            await runtime.audit.logUsage(user, session.extension.id, 'Trivium build text index', {
                database,
            });
            ok(res, { ok: true });
        } catch (error) {
            fail(runtime, req, res, 'trivium.private', error);
        }
    });

    router.post('/trivium/compact', async (req, res) => {
        try {
            const user = getUserContext(req);
            const session = await runtime.sessions.assertSession(getSessionToken(req), user);
            const payload = (req.body ?? {}) as TriviumCompactRequest;
            const database = getTriviumDatabaseName(payload.database);
            if (!await runtime.permissions.authorize(user, session, { resource: 'trivium.private', target: database })) {
                throw new Error(`Permission not granted: trivium.private for ${database}`);
            }

            await runtime.trivium.compact(user, session.extension.id, payload);
            await runtime.audit.logUsage(user, session.extension.id, 'Trivium compact', {
                database,
            });
            ok(res, { ok: true });
        } catch (error) {
            fail(runtime, req, res, 'trivium.private', error);
        }
    });

    router.post('/trivium/flush', async (req, res) => {
        try {
            const user = getUserContext(req);
            const session = await runtime.sessions.assertSession(getSessionToken(req), user);
            const payload = (req.body ?? {}) as TriviumFlushRequest;
            const database = getTriviumDatabaseName(payload.database);
            if (!await runtime.permissions.authorize(user, session, { resource: 'trivium.private', target: database })) {
                throw new Error(`Permission not granted: trivium.private for ${database}`);
            }

            await runtime.trivium.flush(user, session.extension.id, payload);
            await runtime.audit.logUsage(user, session.extension.id, 'Trivium flush', {
                database,
            });
            ok(res, { ok: true });
        } catch (error) {
            fail(runtime, req, res, 'trivium.private', error);
        }
    });

    router.post('/trivium/stat', async (req, res) => {
        try {
            const user = getUserContext(req);
            const session = await runtime.sessions.assertSession(getSessionToken(req), user);
            const payload = (req.body ?? {}) as TriviumStatRequest;
            const database = getTriviumDatabaseName(payload.database);
            if (!await runtime.permissions.authorize(user, session, { resource: 'trivium.private', target: database })) {
                throw new Error(`Permission not granted: trivium.private for ${database}`);
            }

            if (payload.includeMappingIntegrity === true) {
                await runtime.audit.logWarning(user, session.extension.id, 'Trivium mapping integrity stat requested', {
                    database,
                    route: '/trivium/stat',
                    hotPathRisk: true,
                });
            }
            const result = await runtime.trivium.stat(user, session.extension.id, payload);
            await runtime.audit.logUsage(user, session.extension.id, 'Trivium stat', {
                database,
                nodeCount: result.nodeCount,
            });
            ok(res, result);
        } catch (error) {
            fail(runtime, req, res, 'trivium.private', error);
        }
    });

    router.post('/trivium/check-mappings-integrity', async (req, res) => {
        try {
            const user = getUserContext(req);
            const session = await runtime.sessions.assertSession(getSessionToken(req), user);
            const payload = (req.body ?? {}) as TriviumCheckMappingsIntegrityRequest;
            const database = getTriviumDatabaseName(payload.database);
            if (!await runtime.permissions.authorize(user, session, { resource: 'trivium.private', target: database })) {
                throw new Error(`Permission not granted: trivium.private for ${database}`);
            }

            await runtime.audit.logWarning(user, session.extension.id, 'Trivium mapping integrity check requested', {
                database,
                route: '/trivium/check-mappings-integrity',
                hotPathRisk: true,
            });
            const result = await runtime.trivium.checkMappingsIntegrity(user, session.extension.id, payload);
            await runtime.audit.logUsage(user, session.extension.id, 'Trivium check mappings integrity', {
                database,
                mappingCount: result.mappingCount,
                orphanMappingCount: result.orphanMappingCount,
                missingMappingCount: result.missingMappingCount,
                issueCount: result.issues.length,
            });
            ok(res, result);
        } catch (error) {
            fail(runtime, req, res, 'trivium.private', error);
        }
    });

    router.post('/trivium/delete-orphan-mappings', async (req, res) => {
        try {
            const user = getUserContext(req);
            const session = await runtime.sessions.assertSession(getSessionToken(req), user);
            const payload = (req.body ?? {}) as TriviumDeleteOrphanMappingsRequest;
            const database = getTriviumDatabaseName(payload.database);
            if (!await runtime.permissions.authorize(user, session, { resource: 'trivium.private', target: database })) {
                throw new Error(`Permission not granted: trivium.private for ${database}`);
            }

            await runtime.audit.logWarning(user, session.extension.id, 'Trivium orphan mapping cleanup requested', {
                database,
                route: '/trivium/delete-orphan-mappings',
                dryRun: payload.dryRun === true,
                hotPathRisk: true,
            });
            const result = await runtime.trivium.deleteOrphanMappings(user, session.extension.id, payload);
            await runtime.audit.logUsage(user, session.extension.id, 'Trivium delete orphan mappings', {
                database,
                dryRun: payload.dryRun === true,
                orphanCount: result.orphanCount,
                deletedCount: result.deletedCount,
                hasMore: result.hasMore,
            });
            ok(res, result);
        } catch (error) {
            fail(runtime, req, res, 'trivium.private', error);
        }
    });

    router.post('/trivium/list-mappings', async (req, res) => {
        try {
            const user = getUserContext(req);
            const session = await runtime.sessions.assertSession(getSessionToken(req), user);
            const payload = (req.body ?? {}) as TriviumListMappingsRequest;
            const database = getTriviumDatabaseName(payload.database);
            if (!await runtime.permissions.authorize(user, session, { resource: 'trivium.private', target: database })) {
                throw new Error(`Permission not granted: trivium.private for ${database}`);
            }

            const result = await runtime.trivium.listMappingsPage(user, session.extension.id, payload);
            await runtime.audit.logUsage(user, session.extension.id, 'Trivium list mappings', {
                database,
                namespace: typeof payload.namespace === 'string' && payload.namespace.trim() ? payload.namespace.trim() : null,
                count: result.mappings.length,
                limit: result.page?.limit ?? null,
            });
            ok(res, result);
        } catch (error) {
            fail(runtime, req, res, 'trivium.private', error);
        }
    });

    router.get('/trivium/databases', async (req, res) => {
        try {
            const user = getUserContext(req);
            const session = await runtime.sessions.assertSession(getSessionToken(req), user);
            if (!await runtime.permissions.authorize(user, session, { resource: 'trivium.private' }, false)) {
                throw new Error('Permission not granted: trivium.private');
            }

            const result = await listPrivateTriviumDatabases(runtime, user, session.extension.id);
            await runtime.audit.logUsage(user, session.extension.id, 'Trivium list databases', {
                count: result.databases.length,
            });
            ok(res, result);
        } catch (error) {
            fail(runtime, req, res, 'trivium.private', error);
        }
    });
}

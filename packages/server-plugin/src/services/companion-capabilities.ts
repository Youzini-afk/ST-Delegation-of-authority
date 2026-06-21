import type {
    PermissionEvaluateRequest,
    TriviumBulkDeleteRequest,
    TriviumBulkLinkRequest,
    TriviumBulkMutationResponse,
    TriviumBulkUpsertRequest,
    TriviumBulkUpsertResponse,
    TriviumListDatabasesResponse,
    TriviumNeighborsRequest,
    TriviumNeighborsResponse,
    TriviumResolveManyRequest,
    TriviumResolveManyResponse,
    TriviumSearchHit,
    TriviumSearchHybridRequest,
    TriviumStatRequest,
    TriviumStatResponse,
} from '@stdo/shared-types';
import type { AuditService } from './audit-service.js';
import type { PermissionService } from './permission-service.js';
import type { TriviumService } from './trivium-service.js';
import type { SessionRecord, UserContext } from '../types.js';
import { AuthorityServiceError } from '../utils.js';
import {
    DEFAULT_SEARCH_EXPAND_DEPTH,
    DEFAULT_SEARCH_TOP_K,
    MAX_NEIGHBORS_DEPTH,
    MAX_SEARCH_EXPAND_DEPTH,
    MAX_SEARCH_TOP_K,
    MAX_TRIVIUM_RESOLVE_MANY_ITEMS,
    getBoundedPositiveInteger,
} from './trivium-internal.js';

/**
 * Phase A generic safe Trivium wrapper exposed on the companion transaction
 * ctx as `ctx.trivium`.
 *
 * Boundary contract (non-negotiable):
 *
 * - The wrapper forces `extensionId = ownerExtensionId`. Companion code never
 *   passes an extension id; the wrapper always scopes Trivium operations to
 *   the owner extension that shipped the companion module, NOT the caller
 *   extension id from `session.extension.id`. This prevents a companion
 *   module from reading/writing another extension's Trivium databases.
 * - The wrapper authorizes `trivium.private` before every service call,
 *   normalized to the same database target the service will use. This is
 *   defense-in-depth in addition to the host's manifest `requiredResources`
 *   check: even if a companion transaction declares `trivium.private` in its
 *   manifest, the wrapper still re-checks before each call so a logic bug in
 *   the host's required-resource resolver cannot bypass authorization.
 * - The wrapper exposes only narrow methods: `listDatabases`, `stat`,
 *   `bulkUpsert`, `bulkLink`, `bulkDelete`, `searchHybrid`, `resolveMany`,
 *   `neighbors`. No raw `TriviumService` is exposed; companion code cannot
 *   reach `repository`, `mappingStore`, `resolvePaths`, or any other
 *   internal method.
 * - The wrapper does not add business-specific methods. DOA stays generic;
 *   the wrapper is a reusable Trivium capability for companion modules.
 *   In particular there is no convenience method like
 *   `neighborsByExternalId`; companion modules do the two-call
 *   resolve-then-neighbors dance themselves using `resolveMany` followed
 *   by `neighbors`.
 * - The wrapper applies server-side caps before delegating so a buggy or
 *   hostile companion module cannot request unbounded vector search or
 *   graph expansion: `searchHybrid` clamps `topK`/`expandDepth`,
 *   `neighbors` clamps `depth`, and `resolveMany` hard-rejects oversized
 *   `items` arrays.
 *
 * Phase A scope: Trivium only. SQL/blob/fs/jobs/events wrappers are separate
 * future work per the design doc.
 */
export interface CompanionTriviumCapability {
    /**
     * List Trivium databases owned by the companion module's extension.
     * Authorizes `trivium.private` with target `*` (list spans all databases
     * for the owner extension; there is no per-database target for a list
     * operation).
     */
    listDatabases(): Promise<TriviumListDatabasesResponse>;

    /**
     * Stat a Trivium database owned by the companion module's extension.
     * Authorizes `trivium.private` with the normalized database target
     * before delegating to {@link TriviumService.stat}.
     */
    stat(request: TriviumStatRequest): Promise<TriviumStatResponse>;

    /**
     * Bulk upsert Trivium nodes into a database owned by the companion
     * module's extension. Authorizes `trivium.private` with the normalized
     * database target before delegating to {@link TriviumService.bulkUpsert}.
     */
    bulkUpsert(request: TriviumBulkUpsertRequest): Promise<TriviumBulkUpsertResponse>;

    /**
     * Bulk link Trivium edges in a database owned by the companion module's
     * extension. Authorizes `trivium.private` with the normalized database
     * target before delegating to {@link TriviumService.bulkLink}.
     */
    bulkLink(request: TriviumBulkLinkRequest): Promise<TriviumBulkMutationResponse>;

    /**
     * Bulk delete Trivium nodes from a database owned by the companion
     * module's extension. Authorizes `trivium.private` with the normalized
     * database target before delegating to {@link TriviumService.bulkDelete}.
     */
    bulkDelete(request: TriviumBulkDeleteRequest): Promise<TriviumBulkMutationResponse>;

    /**
     * Hybrid vector + text search against a database owned by the companion
     * module's extension. Authorizes `trivium.private` with the normalized
     * database target, clamps `topK`/`expandDepth` to server-side caps, then
     * delegates to {@link TriviumService.searchHybrid}. The wrapper does not
     * mutate the caller's request object; it shallow-copies the request
     * with the clamped values before delegating.
     */
    searchHybrid(request: TriviumSearchHybridRequest): Promise<TriviumSearchHit[]>;

    /**
     * Resolve a batch of `TriviumNodeReference` items (mixed internal ids
     * and external ids) against a database owned by the companion module's
     * extension. Authorizes `trivium.private` with the normalized database
     * target, hard-rejects requests with more than
     * `MAX_TRIVIUM_RESOLVE_MANY_ITEMS` items, then delegates to
     * {@link TriviumService.resolveMany}.
     */
    resolveMany(request: TriviumResolveManyRequest): Promise<TriviumResolveManyResponse>;

    /**
     * Expand the graph around a node id in a database owned by the
     * companion module's extension. Authorizes `trivium.private` with the
     * normalized database target, clamps `depth` to a server-side cap, then
     * delegates to {@link TriviumService.neighbors}. The wrapper does not
     * mutate the caller's request object; it shallow-copies the request
     * with the clamped value before delegating.
     */
    neighbors(request: TriviumNeighborsRequest): Promise<TriviumNeighborsResponse>;
}

/**
 * Build a {@link CompanionTriviumCapability} bound to a specific companion
 * module's owner extension id. The wrapper captures `user`, `session`, and
 * `ownerExtensionId` at build time so companion code cannot override the
 * extension scoping.
 *
 * @param trivium    The host's TriviumService. NOT exposed on the returned
 *                   wrapper; only the narrow methods delegate to it.
 * @param permissions The host's PermissionService. Used for defense-in-depth
 *                   authorization before each Trivium call.
 * @param audit      The host's AuditService. Used to log permission denials.
 * @param user       The calling user context (from the host's execute ctx).
 * @param session    The calling session record (from the host's execute ctx).
 * @param ownerExtensionId The companion module's owner extension id. This
 *                   is the extension that shipped the `.authority/server.cjs`
 *                   being activated, NOT the caller extension id from
 *                   `session.extension.id`.
 */
export function buildCompanionTriviumCapability(
    trivium: TriviumService,
    permissions: PermissionService,
    audit: AuditService,
    user: UserContext,
    session: SessionRecord,
    ownerExtensionId: string,
): CompanionTriviumCapability {
    const authorize = async (database: string): Promise<void> => {
        const granted = await permissions.authorize(user, session, {
            resource: 'trivium.private',
            target: database,
        });
        if (granted === null) {
            // Log the denial for audit traceability, then throw a structured
            // permission error. The wrapper uses the OWNER extension id for
            // audit attribution so the denial is attributed to the companion
            // module that attempted the operation, not the caller extension.
            await audit.logPermission(user, ownerExtensionId, 'Permission denied: trivium.private', {
                resource: 'trivium.private',
                target: database,
                moduleId: ownerExtensionId,
            }).catch(() => undefined);
            throw new AuthorityServiceError(
                `Permission not granted: trivium.private for ${database}`,
                403,
                'permission_not_granted',
                'permission',
                { resource: 'trivium.private', target: database, ownerExtensionId },
            );
        }
    };

    return {
        async listDatabases(): Promise<TriviumListDatabasesResponse> {
            // List spans all databases for the owner extension; there is no
            // per-database target. Use `*` to match the route-layer convention
            // for list operations.
            await authorize('*');
            return await trivium.listDatabases(user, ownerExtensionId);
        },

        async stat(request: TriviumStatRequest): Promise<TriviumStatResponse> {
            const database = normalizeTriviumDatabase(request.database);
            await authorize(database);
            return await trivium.stat(user, ownerExtensionId, request);
        },

        async bulkUpsert(request: TriviumBulkUpsertRequest): Promise<TriviumBulkUpsertResponse> {
            const database = normalizeTriviumDatabase(request.database);
            await authorize(database);
            return await trivium.bulkUpsert(user, ownerExtensionId, request);
        },

        async bulkLink(request: TriviumBulkLinkRequest): Promise<TriviumBulkMutationResponse> {
            const database = normalizeTriviumDatabase(request.database);
            await authorize(database);
            return await trivium.bulkLink(user, ownerExtensionId, request);
        },

        async bulkDelete(request: TriviumBulkDeleteRequest): Promise<TriviumBulkMutationResponse> {
            const database = normalizeTriviumDatabase(request.database);
            await authorize(database);
            return await trivium.bulkDelete(user, ownerExtensionId, request);
        },

        async searchHybrid(request: TriviumSearchHybridRequest): Promise<TriviumSearchHit[]> {
            const database = normalizeTriviumDatabase(request.database);
            await authorize(database);
            // Clamp topK/expandDepth to server-side caps. Shallow-copy the
            // request so the caller's object is not mutated. A non-positive
            // safe integer for topK/expandDepth throws here, mirroring the
            // existing getBoundedPositiveInteger precedent used by
            // TriviumService for sampleLimit/limit.
            const topK = getBoundedPositiveInteger(request.topK, DEFAULT_SEARCH_TOP_K, MAX_SEARCH_TOP_K, 'topK');
            const expandDepth = getBoundedPositiveInteger(
                request.expandDepth,
                DEFAULT_SEARCH_EXPAND_DEPTH,
                MAX_SEARCH_EXPAND_DEPTH,
                'expandDepth',
            );
            const clampedRequest: TriviumSearchHybridRequest = {
                ...request,
                topK,
                expandDepth,
            };
            return await trivium.searchHybrid(user, ownerExtensionId, clampedRequest);
        },

        async resolveMany(request: TriviumResolveManyRequest): Promise<TriviumResolveManyResponse> {
            const database = normalizeTriviumDatabase(request.database);
            await authorize(database);
            // Hard-reject oversized batches before delegating, matching the
            // MAX_TRIVIUM_BULK_ITEMS precedent in TriviumService.bulkUpsert.
            if (request.items.length > MAX_TRIVIUM_RESOLVE_MANY_ITEMS) {
                throw new AuthorityServiceError(
                    `Trivium resolveMany supports at most ${MAX_TRIVIUM_RESOLVE_MANY_ITEMS} items per request`,
                    400,
                    'validation_error',
                    'validation',
                    { limit: MAX_TRIVIUM_RESOLVE_MANY_ITEMS, actual: request.items.length },
                );
            }
            return await trivium.resolveMany(user, ownerExtensionId, request);
        },

        async neighbors(request: TriviumNeighborsRequest): Promise<TriviumNeighborsResponse> {
            const database = normalizeTriviumDatabase(request.database);
            await authorize(database);
            // Clamp depth to the server-side cap. Shallow-copy the request
            // so the caller's object is not mutated. A non-positive safe
            // integer for depth throws here.
            const depth = getBoundedPositiveInteger(request.depth, 1, MAX_NEIGHBORS_DEPTH, 'depth');
            const clampedRequest: TriviumNeighborsRequest = {
                ...request,
                depth,
            };
            return await trivium.neighbors(user, ownerExtensionId, clampedRequest);
        },
    };
}

/**
 * Normalize a Trivium database name to the same default the TriviumService
 * uses internally (`getTriviumDatabaseName`: empty/undefined -> 'default').
 * The wrapper uses this for authorization target normalization so that a
 * request with `database: undefined` authorizes against `'default'`, matching
 * the database the service will actually open.
 */
function normalizeTriviumDatabase(value: string | undefined): string {
    return typeof value === 'string' && value.trim() ? value.trim() : 'default';
}

// Suppress unused-import warnings for type-only imports preserved for the
// public API surface of this module.
void (undefined as unknown as PermissionEvaluateRequest);

import type {
    PermissionEvaluateRequest,
    TriviumBulkDeleteRequest,
    TriviumBulkLinkRequest,
    TriviumBulkMutationResponse,
    TriviumBulkUpsertRequest,
    TriviumBulkUpsertResponse,
    TriviumListDatabasesResponse,
    TriviumStatRequest,
    TriviumStatResponse,
} from '@stdo/shared-types';
import type { AuditService } from './audit-service.js';
import type { PermissionService } from './permission-service.js';
import type { TriviumService } from './trivium-service.js';
import type { SessionRecord, UserContext } from '../types.js';
import { AuthorityServiceError } from '../utils.js';

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
 *   `bulkUpsert`, `bulkLink`, `bulkDelete`. No raw `TriviumService` is
 *   exposed; companion code cannot reach `repository`, `mappingStore`,
 *   `resolvePaths`, or any other internal method.
 * - The wrapper does not add business-specific methods. DOA stays generic;
 *   the wrapper is a reusable Trivium capability for companion modules.
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

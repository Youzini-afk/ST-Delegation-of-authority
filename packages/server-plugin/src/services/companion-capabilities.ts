import type {
    CursorPageRequest,
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
    SqlBatchRequest,
    SqlExecRequest,
    SqlExecResult,
    SqlMigrationInput,
    SqlMigrateResponse,
    SqlQueryRequest,
    SqlQueryResult,
    SqlStatementInput,
    SqlTransactionRequest,
    SqlTransactionResponse,
    SqlValue,
} from '@stdo/shared-types';
import { MAX_SQL_BATCH_STATEMENTS } from '../constants.js';
import { resolvePrivateSqlDatabasePath } from '../store/authority-paths.js';
import type { AuditService } from './audit-service.js';
import type { CoreService } from './core-service.js';
import type { LockService } from './lock-service.js';
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
 * Phase A scope: Trivium plus a generic SQL capability (`ctx.sql`) that
 * delegates to the host's CoreService SQL methods. SQL/blob/fs/jobs/events
 * wrappers beyond SQL are separate future work per the design doc.
 *
 * Phase B scope: a generic in-process locks capability (`ctx.locks`) that
 * delegates to the host's `LockService`. Companion modules use it to
 * serialize per-resource work (e.g. per-chat graph commits) so two
 * concurrent transactions targeting the same resource cannot interleave
 * their reads and writes. Locks are per-process only; they are NOT
 * crash-durable and NOT cross-process. Phase C idempotency provides
 * durability across crashes; `ctx.locks` provides in-process concurrency
 * safety only.
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

/**
 * Phase A generic safe SQL wrapper exposed on the companion transaction
 * ctx as `ctx.sql`.
 *
 * Boundary contract (non-negotiable):
 *
 * - The wrapper resolves the SQLite database filesystem path internally
 *   from `ownerExtensionId` (the companion module's owner extension id),
 *   NEVER from the caller extension id and NEVER from a raw path supplied
 *   by companion code. Companion modules pass only a `database` NAME
 *   (e.g. 'default', 'cache', 'index'); the wrapper maps it to a path
 *   inside the owner extension's private SQL directory. This prevents a
 *   companion module from reading/writing another extension's databases
 *   or any file outside its private SQL sandbox.
 * - The wrapper authorizes `sql.private` before every CoreService call,
 *   normalized to the same database target the resolver will use. This is
 *   defense-in-depth in addition to the host's manifest
 *   `requiredResources` check: even if a companion transaction declares
 *   `sql.private` in its manifest, the wrapper still re-checks before each
 *   call so a logic bug in the host's required-resource resolver cannot
 *   bypass authorization.
 * - The wrapper exposes only narrow methods: `query`, `exec`,
 *   `transaction`, `migrate`. No raw `CoreService` is exposed; companion
 *   code cannot reach `querySql`'s sibling HTTP/control methods, the
 *   authority-core process handle, the token, the port, or any other
 *   CoreService internals.
 * - The wrapper does not add business-specific methods. DOA stays generic;
 *   the wrapper is a reusable SQL capability for companion modules and
 *   contains no host-extension-specific helpers.
 * - The wrapper applies server-side caps before delegating so a buggy or
 *   hostile companion module cannot request unbounded work:
 *   `transaction`/`batch` hard-reject statement counts above
 *   {@link MAX_SQL_BATCH_STATEMENTS}; `query` clamps `page.limit` to 1000.
 *   There is no per-statement byte cap for now (kept generous).
 * - The wrapper shallow-copies the request object before delegating to the
 *   CoreService so the caller's object is not mutated by the clamping or
 *   by the service.
 */
export interface CompanionSqlCapability {
    /**
     * Run a SELECT-style statement against a database owned by the
     * companion module's extension and return paged rows. Authorizes
     * `sql.private` with the normalized database target, clamps
     * `page.limit` to 1000, then delegates to
     * {@link CoreService.querySql}. The wrapper resolves the dbPath
     * internally from `ownerExtensionId`; companion code never supplies
     * a raw filesystem path.
     */
    query(database: string, statement: string, params?: SqlValue[], page?: CursorPageRequest): Promise<SqlQueryResult>;

    /**
     * Run a single DDL/DML statement that does not return rows (INSERT,
     * UPDATE, DELETE, CREATE TABLE, ...). Authorizes `sql.private` with
     * the normalized database target before delegating to
     * {@link CoreService.execSql}. The wrapper resolves the dbPath
     * internally from `ownerExtensionId`; companion code never supplies
     * a raw filesystem path.
     */
    exec(database: string, statement: string, params?: SqlValue[]): Promise<SqlExecResult>;

    /**
     * Run a batch of statements inside a single transaction against a
     * database owned by the companion module's extension. Authorizes
     * `sql.private` with the normalized database target, hard-rejects
     * statement counts above {@link MAX_SQL_BATCH_STATEMENTS} (100),
     * then delegates to {@link CoreService.transactionSql}. The wrapper
     * resolves the dbPath internally from `ownerExtensionId`; companion
     * code never supplies a raw filesystem path.
     */
    transaction(database: string, statements: SqlStatementInput[]): Promise<SqlTransactionResponse>;

    /**
     * Apply a set of idempotent migrations to a database owned by the
     * companion module's extension, recording applied ids in a migrations
     * table. Authorizes `sql.private` with the normalized database
     * target before delegating to {@link CoreService.migrateSql}. The
     * wrapper resolves the dbPath internally from `ownerExtensionId`;
     * companion code never supplies a raw filesystem path.
     */
    migrate(database: string, migrations: SqlMigrationInput[], tableName?: string): Promise<SqlMigrateResponse>;
}

/**
 * Build a {@link CompanionSqlCapability} bound to a specific companion
 * module's owner extension id. The wrapper captures `user`, `session`, and
 * `ownerExtensionId` at build time so companion code cannot override the
 * extension scoping or pass a raw dbPath.
 *
 * @param core       The host's CoreService. NOT exposed on the returned
 *                   wrapper; only the narrow SQL methods delegate to it.
 * @param permissions The host's PermissionService. Used for defense-in-depth
 *                   authorization before each SQL call.
 * @param audit      The host's AuditService. Used to log permission denials.
 * @param user       The calling user context (from the host's execute ctx).
 * @param session    The calling session record (from the host's execute ctx).
 * @param ownerExtensionId The companion module's owner extension id. This
 *                   is the extension that shipped the `.authority/server.cjs`
 *                   being activated, NOT the caller extension id from
 *                   `session.extension.id`. The wrapper uses this id to
 *                   resolve the private SQL database directory so two
 *                   extensions cannot read or write each other's databases.
 */
export function buildCompanionSqlCapability(
    core: CoreService,
    permissions: PermissionService,
    audit: AuditService,
    user: UserContext,
    session: SessionRecord,
    ownerExtensionId: string,
): CompanionSqlCapability {
    const authorize = async (database: string): Promise<void> => {
        const granted = await permissions.authorize(user, session, {
            resource: 'sql.private',
            target: database,
        });
        if (granted === null) {
            // Log the denial for audit traceability, then throw a structured
            // permission error. The wrapper uses the OWNER extension id for
            // audit attribution so the denial is attributed to the companion
            // module that attempted the operation, not the caller extension.
            await audit.logPermission(user, ownerExtensionId, 'Permission denied: sql.private', {
                resource: 'sql.private',
                target: database,
                moduleId: ownerExtensionId,
            }).catch(() => undefined);
            throw new AuthorityServiceError(
                `Permission not granted: sql.private for ${database}`,
                403,
                'permission_not_granted',
                'permission',
                { resource: 'sql.private', target: database, ownerExtensionId },
            );
        }
    };

    return {
        async query(database, statement, params, page): Promise<SqlQueryResult> {
            const db = normalizeSqlDatabase(database);
            await authorize(db);
            // Clamp page.limit to 1000 to match the route-layer cap in
            // buildEmptySqlCursorPage (sql-routes.ts). Shallow-copy the
            // request so the caller's page object is not mutated.
            const clampedPage = page === undefined ? undefined : clampSqlPage(page);
            const request: SqlQueryRequest = {
                database: db,
                statement,
                ...(params === undefined ? {} : { params }),
                ...(clampedPage === undefined ? {} : { page: clampedPage }),
            };
            // Resolve dbPath internally from ownerExtensionId; the wrapper
            // never accepts a raw dbPath from companion code.
            const dbPath = resolvePrivateSqlDatabasePath(user, ownerExtensionId, db);
            return await core.querySql(dbPath, { ...request });
        },

        async exec(database, statement, params): Promise<SqlExecResult> {
            const db = normalizeSqlDatabase(database);
            await authorize(db);
            const request: SqlExecRequest = {
                database: db,
                statement,
                ...(params === undefined ? {} : { params }),
            };
            const dbPath = resolvePrivateSqlDatabasePath(user, ownerExtensionId, db);
            return await core.execSql(dbPath, { ...request });
        },

        async transaction(database, statements): Promise<SqlTransactionResponse> {
            const db = normalizeSqlDatabase(database);
            await authorize(db);
            // Hard-reject oversized batches before delegating, matching the
            // route-layer assertSqlStatementCount precedent in sql-routes.ts.
            if (statements.length > MAX_SQL_BATCH_STATEMENTS) {
                throw new AuthorityServiceError(
                    `SQL transaction supports at most ${MAX_SQL_BATCH_STATEMENTS} statements per request`,
                    400,
                    'validation_error',
                    'validation',
                    { limit: MAX_SQL_BATCH_STATEMENTS, actual: statements.length },
                );
            }
            const request: SqlTransactionRequest = {
                database: db,
                statements,
            };
            const dbPath = resolvePrivateSqlDatabasePath(user, ownerExtensionId, db);
            return await core.transactionSql(dbPath, { ...request });
        },

        async migrate(database, migrations, tableName): Promise<SqlMigrateResponse> {
            const db = normalizeSqlDatabase(database);
            await authorize(db);
            // Build the migrate request from positional args; shallow-copy
            // so the caller's migrations array reference is not mutated by
            // the service. tableName is optional; omit it when not supplied
            // so the core falls back to its default migrations table name.
            const migrateRequest = tableName === undefined
                ? { database: db, migrations: [...migrations] }
                : { database: db, migrations: [...migrations], tableName };
            const dbPath = resolvePrivateSqlDatabasePath(user, ownerExtensionId, db);
            return await core.migrateSql(dbPath, migrateRequest);
        },
    };
}

/**
 * Normalize a SQL database name to the same default the route layer uses
 * (`getSqlDatabaseName`: empty/undefined -> 'default'). The wrapper uses
 * this for authorization target normalization so that a request with
 * `database: undefined` authorizes against `'default'`, matching the
 * database the resolver will actually open.
 */
function normalizeSqlDatabase(value: string | undefined): string {
    return typeof value === 'string' && value.trim() ? value.trim() : 'default';
}

/**
 * Clamp a query page's `limit` to the server-side cap of 1000. Mirrors the
 * route-layer cap in `buildEmptySqlCursorPage` (sql-routes.ts). Returns a
 * shallow copy of the page so the caller's object is not mutated.
 */
function clampSqlPage(page: CursorPageRequest): CursorPageRequest {
    if (
        page.limit !== undefined
        && typeof page.limit === 'number'
        && Number.isSafeInteger(page.limit)
        && page.limit > MAX_COMPANION_SQL_QUERY_PAGE_LIMIT
    ) {
        return { ...page, limit: MAX_COMPANION_SQL_QUERY_PAGE_LIMIT };
    }
    return page;
}

/** Server-side cap on `query` page.limit. Matches the route-layer cap. */
const MAX_COMPANION_SQL_QUERY_PAGE_LIMIT = 1000;

/**
 * Default `withLock` timeout (30 s) when the caller does not supply one.
 * Prevents a companion module from holding a lock forever due to a logic
 * bug or unhandled hang; the timeout throws `lock_timeout` so the caller
 * can surface a structured error and the next waiter can proceed.
 */
const DEFAULT_COMPANION_LOCK_TIMEOUT_MS = 30_000;

/**
 * Hard upper bound on `withLock` timeout (5 min). Companion modules
 * cannot request a longer timeout; values above this cap are clamped
 * down so a buggy or hostile module cannot block the lock for the
 * entire server lifetime.
 */
const MAX_COMPANION_LOCK_TIMEOUT_MS = 5 * 60_000;

/**
 * Phase B generic in-process locks wrapper exposed on the companion
 * transaction ctx as `ctx.locks`.
 *
 * Boundary contract (non-negotiable):
 *
 * - The wrapper auto-prefixes `scope` with `ownerExtensionId` so two
 *   companion modules that happen to pick the same `scope` string (e.g.
 *   'chat:123') do NOT interfere with each other. The full lock scopeKey
 *   is `${ownerExtensionId}:${scope}`.
 * - The wrapper applies a default `timeoutMs` of 30 s when the caller
 *   omits it, and clamps any caller-supplied `timeoutMs` to a hard cap
 *   of 5 min. This prevents a buggy or hostile companion module from
 *   holding a lock indefinitely or requesting an unbounded wait.
 * - The wrapper validates `scope` is a non-empty string and throws
 *   `AuthorityServiceError(400, 'validation_error', 'validation', ...)`
 *   otherwise. Empty/whitespace scope is rejected because an empty
 *   scopeKey would collide across all callers within the same owner.
 * - The wrapper exposes only `withLock`. No raw `LockService` is
 *   exposed; companion code cannot reach the underlying `locks` Map or
 *   any other LockService internals.
 * - The wrapper does not add business-specific methods. DOA stays
 *   generic; the wrapper is a reusable locks capability for companion
 *   modules. In particular there is no convenience method for per-chat
 *   locking; companion modules build their own scope string (e.g.
 *   `chat:${chatId}`) and pass it to `withLock`.
 * - Per-process only. NOT crash-durable. NOT cross-process. Single-process
 *   ST server invariant. Idempotency (Phase C) provides durability across
 *   crashes; this wrapper provides in-process concurrency safety only.
 * - No nested acquisition detection. Acquiring the same `scope`
 *   nestedly from the same async context WILL deadlock. Companion
 *   modules must not do this.
 */
export interface CompanionLocksCapability {
    /**
     * Serialize `fn` against all other `withLock` calls for the same
     * `scope` (auto-prefixed with `ownerExtensionId`). The lock is
     * acquired after all prior waiters for this scope finish (success
     * or failure), held while `fn` runs, and released in a `finally`
     * block when `fn` settles.
     *
     * If `options.timeoutMs` is provided it overrides the 30 s default
     * and is clamped to a 5 min hard cap. If the lock cannot be
     * acquired within the timeout, throws
     * `AuthorityServiceError(408, 'lock_timeout', 'concurrency', { scopeKey, timeoutMs })`
     * where `scopeKey` is the auto-prefixed `${ownerExtensionId}:${scope}`.
     *
     * If `fn` throws, the error propagates to the caller; the lock is
     * still released.
     */
    withLock<T>(scope: string, options: { timeoutMs?: number }, fn: () => Promise<T>): Promise<T>;
}

/**
 * Build a {@link CompanionLocksCapability} bound to a specific companion
 * module's owner extension id. The wrapper captures `ownerExtensionId`
 * at build time so companion code cannot override the auto-prefixing or
 * acquire locks in another extension's namespace.
 *
 * @param lockService      The host's LockService. NOT exposed on the
 *                         returned wrapper; only `withLock` delegates
 *                         to it.
 * @param ownerExtensionId The companion module's owner extension id.
 *                         This is the extension that shipped the
 *                         `.authority/server.cjs` being activated, NOT
 *                         the caller extension id from
 *                         `session.extension.id`. The wrapper uses this
 *                         id to prefix lock scopeKeys so two companion
 *                         modules cannot interfere with each other.
 */
export function buildCompanionLocksCapability(
    lockService: LockService,
    ownerExtensionId: string,
): CompanionLocksCapability {
    return {
        async withLock<T>(scope: string, options: { timeoutMs?: number }, fn: () => Promise<T>): Promise<T> {
            // Validate scope is a non-empty string. An empty scopeKey
            // would collide across all callers within the same owner;
            // reject up front rather than silently allowing the collision.
            if (typeof scope !== 'string' || scope.trim() === '') {
                throw new AuthorityServiceError(
                    `companion ctx.locks.withLock requires a non-empty scope string`,
                    400,
                    'validation_error',
                    'validation',
                    { ownerExtensionId, scope },
                );
            }
            // Auto-prefix with ownerExtensionId so two companion modules
            // that pick the same scope string do not interfere. The full
            // scopeKey passed to the underlying LockService is
            // `${ownerExtensionId}:${scope}`.
            const scopeKey = `${ownerExtensionId}:${scope}`;
            // Default to 30 s; clamp any caller-supplied value to the
            // 5 min hard cap. A non-positive caller-supplied timeout is
            // treated as "use the default" rather than "no timeout" so a
            // buggy module cannot accidentally disable the safety net.
            const callerTimeout = options.timeoutMs;
            const effectiveTimeoutMs
                = typeof callerTimeout === 'number'
                && Number.isFinite(callerTimeout)
                && callerTimeout > 0
                    ? Math.min(callerTimeout, MAX_COMPANION_LOCK_TIMEOUT_MS)
                    : DEFAULT_COMPANION_LOCK_TIMEOUT_MS;
            return await lockService.withLock(scopeKey, { timeoutMs: effectiveTimeoutMs }, fn);
        },
    };
}

// Suppress unused-import warnings for type-only imports preserved for the
// public API surface of this module.
void (undefined as unknown as PermissionEvaluateRequest);
void (undefined as unknown as SqlBatchRequest);

import fs from 'node:fs';
import type {
    CursorPageInfo,
    CursorPageRequest,
    SqlBatchRequest,
    SqlDatabaseRecord,
    SqlExecRequest,
    SqlListDatabasesResponse,
    SqlListMigrationsRequest,
    SqlListMigrationsResponse,
    SqlListSchemaRequest,
    SqlListSchemaResponse,
    SqlMigrateRequest,
    SqlMigrationRecord,
    SqlQueryRequest,
    SqlSchemaObjectRecord,
    SqlSchemaObjectType,
    SqlStatRequest,
    SqlStatResponse,
    SqlTransactionRequest,
} from '@stdo/shared-types';
import { MAX_SQL_BATCH_STATEMENTS } from '../constants.js';
import type { AuthorityRuntime } from '../runtime.js';
import { getUserAuthorityPaths } from '../store/authority-paths.js';
import type { AuthorityRequest, AuthorityResponse } from '../types.js';
import { AuthorityServiceError, getSessionToken, getUserContext, resolveContainedPath, sanitizeFileSegment } from '../utils.js';

type RouterLike = {
    get(path: string, handler: (req: AuthorityRequest, res: AuthorityResponse) => void | Promise<void>): void;
    post(path: string, handler: (req: AuthorityRequest, res: AuthorityResponse) => void | Promise<void>): void;
};

type RouteFailureHandler = (runtime: AuthorityRuntime, req: AuthorityRequest, res: AuthorityResponse, extensionId: string, error: unknown) => void;

function ok(res: AuthorityResponse, data: unknown): void {
    res.json(data);
}

function getSqlDatabaseName(value: unknown): string {
    return typeof value === 'string' && value.trim() ? value.trim() : 'default';
}

function getSqlMigrationTableName(value: unknown): string {
    const candidate = typeof value === 'string' && value.trim() ? value.trim() : '_authority_migrations';
    if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(candidate)) {
        throw new Error('SQL migration tableName must be a valid identifier');
    }
    return candidate;
}

function buildEmptySqlCursorPage(page: CursorPageRequest): CursorPageInfo {
    const limit = Number.isInteger(page.limit) && Number(page.limit) > 0
        ? Math.min(Number(page.limit), 1000)
        : 100;
    const cursor = page.cursor?.trim();
    if (cursor) {
        const offset = Number(cursor);
        if (!Number.isSafeInteger(offset) || offset < 0) {
            throw new Error('invalid_page_cursor');
        }
    }
    return {
        nextCursor: null,
        limit,
        hasMore: false,
        totalCount: 0,
    };
}

function readSqlMigrationRecord(row: Record<string, unknown>): SqlMigrationRecord {
    if (typeof row.id !== 'string' || !row.id.trim()) {
        throw new Error('SQL migration row is missing id');
    }
    return {
        id: row.id,
        appliedAt: typeof row.appliedAt === 'string' ? row.appliedAt : '',
    };
}

function getSqlSchemaObjectType(value: unknown): SqlSchemaObjectType | null {
    if (value == null || value === '') {
        return null;
    }
    if (value === 'table' || value === 'index' || value === 'view' || value === 'trigger') {
        return value;
    }
    throw new Error('SQL schema type must be table, index, view, or trigger');
}

function readSqlSchemaObjectRecord(row: Record<string, unknown>): SqlSchemaObjectRecord {
    const type = getSqlSchemaObjectType(row.type);
    if (!type) {
        throw new Error('SQL schema row is missing type');
    }
    if (typeof row.name !== 'string' || !row.name.trim()) {
        throw new Error('SQL schema row is missing name');
    }
    return {
        type,
        name: row.name,
        tableName: typeof row.tableName === 'string' && row.tableName.trim() ? row.tableName : null,
        sql: typeof row.sql === 'string' ? row.sql : null,
    };
}

function resolvePrivateSqlDatabaseDir(user: ReturnType<typeof getUserContext>, extensionId: string): string {
    const paths = getUserAuthorityPaths(user);
    return resolveContainedPath(paths.sqlPrivateDir, sanitizeFileSegment(extensionId));
}

function resolvePrivateSqlDatabasePath(user: ReturnType<typeof getUserContext>, extensionId: string, databaseName: string): string {
    return resolveContainedPath(
        resolvePrivateSqlDatabaseDir(user, extensionId),
        `${sanitizeFileSegment(databaseName)}.sqlite`,
    );
}

async function sqlMigrationTableExists(runtime: AuthorityRuntime, dbPath: string, tableName: string): Promise<boolean> {
    const result = await runtime.core.querySql(dbPath, {
        statement: 'SELECT name FROM sqlite_master WHERE type = ?1 AND name = ?2 LIMIT 1',
        params: ['table', tableName],
    });
    return result.rows.length > 0;
}

async function listSqlMigrationsPage(
    runtime: AuthorityRuntime,
    user: ReturnType<typeof getUserContext>,
    extensionId: string,
    request: SqlListMigrationsRequest,
): Promise<SqlListMigrationsResponse> {
    const database = getSqlDatabaseName(request.database);
    const tableName = getSqlMigrationTableName(request.tableName);
    const dbPath = resolvePrivateSqlDatabasePath(user, extensionId, database);
    if (!fs.existsSync(dbPath) || !await sqlMigrationTableExists(runtime, dbPath, tableName)) {
        return {
            tableName,
            migrations: [],
            ...(request.page ? { page: buildEmptySqlCursorPage(request.page) } : {}),
        };
    }

    const result = await runtime.core.querySql(dbPath, {
        statement: `SELECT id, applied_at AS appliedAt FROM ${tableName} ORDER BY applied_at ASC, id ASC`,
        ...(request.page ? { page: request.page } : {}),
    });
    return {
        tableName,
        migrations: result.rows.map(row => readSqlMigrationRecord(row)),
        ...(result.page ? { page: result.page } : {}),
    };
}

async function listSqlSchemaPage(
    runtime: AuthorityRuntime,
    user: ReturnType<typeof getUserContext>,
    extensionId: string,
    request: SqlListSchemaRequest,
): Promise<SqlListSchemaResponse> {
    const database = getSqlDatabaseName(request.database);
    const type = getSqlSchemaObjectType(request.type);
    const dbPath = resolvePrivateSqlDatabasePath(user, extensionId, database);
    if (!fs.existsSync(dbPath)) {
        return {
            objects: [],
            ...(request.page ? { page: buildEmptySqlCursorPage(request.page) } : {}),
        };
    }

    const params = type ? [type] : [];
    const result = await runtime.core.querySql(dbPath, {
        statement: `SELECT type, name, tbl_name AS tableName, sql
            FROM sqlite_master
            WHERE type IN ('table', 'index', 'view', 'trigger')
                AND name NOT LIKE 'sqlite_%'${type ? ' AND type = ?1' : ''}
            ORDER BY type ASC, name ASC`,
        ...(params.length > 0 ? { params } : {}),
        ...(request.page ? { page: request.page } : {}),
    });

    return {
        objects: result.rows.map(row => readSqlSchemaObjectRecord(row)),
        ...(result.page ? { page: result.page } : {}),
    };
}

async function statPrivateSqlDatabase(
    runtime: AuthorityRuntime,
    user: ReturnType<typeof getUserContext>,
    extensionId: string,
    databaseName: string,
): Promise<SqlStatResponse> {
    const dbPath = resolvePrivateSqlDatabasePath(user, extensionId, databaseName);
    return await runtime.core.statSql(dbPath, { database: databaseName });
}

export async function listPrivateSqlDatabases(
    runtime: AuthorityRuntime,
    user: ReturnType<typeof getUserContext>,
    extensionId: string,
): Promise<SqlListDatabasesResponse> {
    const databaseDir = resolvePrivateSqlDatabaseDir(user, extensionId);
    if (!fs.existsSync(databaseDir)) {
        return { databases: [] };
    }

    const databases = (await Promise.all(
        fs.readdirSync(databaseDir, { withFileTypes: true })
            .filter(entry => entry.isFile() && entry.name.endsWith('.sqlite'))
            .map(async entry => {
                const databaseName = entry.name.slice(0, -'.sqlite'.length);
                const stat = await statPrivateSqlDatabase(runtime, user, extensionId, databaseName);
                return {
                    name: stat.name,
                    fileName: stat.fileName,
                    sizeBytes: stat.sizeBytes,
                    updatedAt: stat.updatedAt,
                    runtimeConfig: stat.runtimeConfig,
                    slowQuery: stat.slowQuery,
                } satisfies SqlDatabaseRecord;
            }),
    ))
        .sort((left, right) => (right.updatedAt ?? '').localeCompare(left.updatedAt ?? ''));

    return { databases };
}

function previewSqlStatement(statement: string): string {
    const normalized = statement.replace(/\s+/g, ' ').trim();
    return normalized.length > 160 ? `${normalized.slice(0, 157)}...` : normalized;
}

function assertSqlStatementCount(statements: unknown, label: string): void {
    if (!Array.isArray(statements)) {
        return;
    }
    if (statements.length > MAX_SQL_BATCH_STATEMENTS) {
        throw new AuthorityServiceError(
            `${label} exceeds ${MAX_SQL_BATCH_STATEMENTS} statements`,
            400,
            'validation_error',
            'validation',
            { statementCount: statements.length, maxStatements: MAX_SQL_BATCH_STATEMENTS },
        );
    }
}

export function registerSqlRoutes(router: RouterLike, runtime: AuthorityRuntime, fail: RouteFailureHandler): void {
    router.post('/sql/query', async (req, res) => {
        try {
            const user = getUserContext(req);
            const session = await runtime.sessions.assertSession(getSessionToken(req), user);
            const payload = (req.body ?? {}) as SqlQueryRequest;
            const database = getSqlDatabaseName(payload.database);
            if (!await runtime.permissions.authorize(user, session, { resource: 'sql.private', target: database })) {
                throw new Error(`Permission not granted: sql.private for ${database}`);
            }

            const dbPath = resolvePrivateSqlDatabasePath(user, session.extension.id, database);
            const result = await runtime.core.querySql(dbPath, {
                ...payload,
                database,
            });
            await runtime.audit.logUsage(user, session.extension.id, 'SQL query', {
                database,
                statement: previewSqlStatement(payload.statement ?? ''),
            });
            ok(res, result);
        } catch (error) {
            fail(runtime, req, res, 'sql.private', error);
        }
    });

    router.post('/sql/exec', async (req, res) => {
        try {
            const user = getUserContext(req);
            const session = await runtime.sessions.assertSession(getSessionToken(req), user);
            const payload = (req.body ?? {}) as SqlExecRequest;
            const database = getSqlDatabaseName(payload.database);
            if (!await runtime.permissions.authorize(user, session, { resource: 'sql.private', target: database })) {
                throw new Error(`Permission not granted: sql.private for ${database}`);
            }

            const dbPath = resolvePrivateSqlDatabasePath(user, session.extension.id, database);
            const result = await runtime.core.execSql(dbPath, {
                ...payload,
                database,
            });
            await runtime.audit.logUsage(user, session.extension.id, 'SQL exec', {
                database,
                statement: previewSqlStatement(payload.statement ?? ''),
            });
            ok(res, result);
        } catch (error) {
            fail(runtime, req, res, 'sql.private', error);
        }
    });

    router.post('/sql/batch', async (req, res) => {
        try {
            const user = getUserContext(req);
            const session = await runtime.sessions.assertSession(getSessionToken(req), user);
            const payload = (req.body ?? {}) as SqlBatchRequest;
            const database = getSqlDatabaseName(payload.database);
            if (!await runtime.permissions.authorize(user, session, { resource: 'sql.private', target: database })) {
                throw new Error(`Permission not granted: sql.private for ${database}`);
            }
            assertSqlStatementCount(payload.statements, 'SQL batch');

            const dbPath = resolvePrivateSqlDatabasePath(user, session.extension.id, database);
            const result = await runtime.core.batchSql(dbPath, {
                ...payload,
                database,
            });
            await runtime.audit.logUsage(user, session.extension.id, 'SQL batch', {
                database,
                statements: Array.isArray(payload.statements) ? payload.statements.length : 0,
            });
            ok(res, result);
        } catch (error) {
            fail(runtime, req, res, 'sql.private', error);
        }
    });

    router.post('/sql/transaction', async (req, res) => {
        try {
            const user = getUserContext(req);
            const session = await runtime.sessions.assertSession(getSessionToken(req), user);
            const payload = (req.body ?? {}) as SqlTransactionRequest;
            const database = getSqlDatabaseName(payload.database);
            if (!await runtime.permissions.authorize(user, session, { resource: 'sql.private', target: database })) {
                throw new Error(`Permission not granted: sql.private for ${database}`);
            }
            assertSqlStatementCount(payload.statements, 'SQL transaction');

            const dbPath = resolvePrivateSqlDatabasePath(user, session.extension.id, database);
            const result = await runtime.core.transactionSql(dbPath, {
                ...payload,
                database,
            });
            await runtime.audit.logUsage(user, session.extension.id, 'SQL transaction', {
                database,
                statements: Array.isArray(payload.statements) ? payload.statements.length : 0,
            });
            ok(res, result);
        } catch (error) {
            fail(runtime, req, res, 'sql.private', error);
        }
    });

    router.post('/sql/migrate', async (req, res) => {
        try {
            const user = getUserContext(req);
            const session = await runtime.sessions.assertSession(getSessionToken(req), user);
            const payload = (req.body ?? {}) as SqlMigrateRequest;
            const database = getSqlDatabaseName(payload.database);
            if (!await runtime.permissions.authorize(user, session, { resource: 'sql.private', target: database })) {
                throw new Error(`Permission not granted: sql.private for ${database}`);
            }

            const dbPath = resolvePrivateSqlDatabasePath(user, session.extension.id, database);
            const result = await runtime.core.migrateSql(dbPath, {
                ...payload,
                database,
            });
            await runtime.audit.logUsage(user, session.extension.id, 'SQL migrate', {
                database,
                migrations: Array.isArray(payload.migrations) ? payload.migrations.length : 0,
                tableName: payload.tableName ?? '_authority_migrations',
            });
            ok(res, result);
        } catch (error) {
            fail(runtime, req, res, 'sql.private', error);
        }
    });

    router.post('/sql/list-migrations', async (req, res) => {
        try {
            const user = getUserContext(req);
            const session = await runtime.sessions.assertSession(getSessionToken(req), user);
            const payload = (req.body ?? {}) as SqlListMigrationsRequest;
            const database = getSqlDatabaseName(payload.database);
            if (!await runtime.permissions.authorize(user, session, { resource: 'sql.private', target: database })) {
                throw new Error(`Permission not granted: sql.private for ${database}`);
            }

            const result = await listSqlMigrationsPage(runtime, user, session.extension.id, payload);
            await runtime.audit.logUsage(user, session.extension.id, 'SQL list migrations', {
                database,
                tableName: result.tableName,
                count: result.migrations.length,
                limit: result.page?.limit ?? null,
            });
            ok(res, result);
        } catch (error) {
            fail(runtime, req, res, 'sql.private', error);
        }
    });

    router.post('/sql/list-schema', async (req, res) => {
        try {
            const user = getUserContext(req);
            const session = await runtime.sessions.assertSession(getSessionToken(req), user);
            const payload = (req.body ?? {}) as SqlListSchemaRequest;
            const database = getSqlDatabaseName(payload.database);
            if (!await runtime.permissions.authorize(user, session, { resource: 'sql.private', target: database })) {
                throw new Error(`Permission not granted: sql.private for ${database}`);
            }

            const result = await listSqlSchemaPage(runtime, user, session.extension.id, payload);
            await runtime.audit.logUsage(user, session.extension.id, 'SQL list schema', {
                database,
                type: payload.type ?? null,
                count: result.objects.length,
                limit: result.page?.limit ?? null,
            });
            ok(res, result);
        } catch (error) {
            fail(runtime, req, res, 'sql.private', error);
        }
    });

    router.get('/sql/databases', async (req, res) => {
        try {
            const user = getUserContext(req);
            const session = await runtime.sessions.assertSession(getSessionToken(req), user);
            if (!await runtime.permissions.authorize(user, session, { resource: 'sql.private' }, false)) {
                throw new Error('Permission not granted: sql.private');
            }

            const result = await listPrivateSqlDatabases(runtime, user, session.extension.id);
            await runtime.audit.logUsage(user, session.extension.id, 'SQL list databases', {
                count: result.databases.length,
            });
            ok(res, result);
        } catch (error) {
            fail(runtime, req, res, 'sql.private', error);
        }
    });

    router.post('/sql/stat', async (req, res) => {
        try {
            const user = getUserContext(req);
            const session = await runtime.sessions.assertSession(getSessionToken(req), user);
            const payload = (req.body ?? {}) as SqlStatRequest;
            const database = getSqlDatabaseName(payload.database);
            if (!await runtime.permissions.authorize(user, session, { resource: 'sql.private', target: database })) {
                throw new Error(`Permission not granted: sql.private for ${database}`);
            }

            const result = await statPrivateSqlDatabase(runtime, user, session.extension.id, database);
            await runtime.audit.logUsage(user, session.extension.id, 'SQL stat', {
                database,
                exists: result.exists,
                sizeBytes: result.sizeBytes,
                slowQueryCount: result.slowQuery.count,
            });
            ok(res, result);
        } catch (error) {
            fail(runtime, req, res, 'sql.private', error);
        }
    });
}

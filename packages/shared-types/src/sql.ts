import type { CursorPageInfo, CursorPageRequest } from './common.js';

export type SqlValue = string | number | boolean | null;

export type SqlStatementMode = 'query' | 'exec';

export interface SqlRuntimeConfigDiagnostics {
    journalMode: string;
    synchronous: string;
    foreignKeys: boolean;
    busyTimeoutMs: number;
    pagedQueryRequiresOrderBy: boolean;
}

export interface SqlSlowQueryDiagnostics {
    count: number;
    lastOccurredAt: string | null;
    lastElapsedMs: number | null;
    lastStatementPreview: string | null;
}

export interface SqlQueryRequest {
    database?: string;
    statement: string;
    params?: SqlValue[];
    page?: CursorPageRequest;
}

export interface SqlStatRequest {
    database?: string;
}

export interface SqlExecRequest {
    database?: string;
    statement: string;
    params?: SqlValue[];
}

export interface SqlStatementInput {
    mode?: SqlStatementMode;
    statement: string;
    params?: SqlValue[];
}

export interface SqlBatchRequest {
    database?: string;
    statements: SqlStatementInput[];
}

export interface SqlQueryResult {
    kind: 'query';
    columns: string[];
    rows: Record<string, SqlValue>[];
    rowCount: number;
    page?: CursorPageInfo;
}

export interface SqlExecResult {
    kind: 'exec';
    rowsAffected: number;
    lastInsertRowid: number | null;
}

export type SqlStatementResult = SqlQueryResult | SqlExecResult;

export interface SqlBatchResponse {
    results: SqlStatementResult[];
}

export interface SqlTransactionRequest {
    database?: string;
    statements: SqlStatementInput[];
}

export interface SqlTransactionResponse {
    committed: boolean;
    results: SqlStatementResult[];
}

export interface SqlMigrationInput {
    id: string;
    statement: string;
}

export interface SqlMigrateRequest {
    database?: string;
    migrations: SqlMigrationInput[];
    tableName?: string;
}

export interface SqlMigrateResponse {
    tableName: string;
    applied: string[];
    skipped: string[];
    latestId: string | null;
}

export interface SqlMigrationRecord {
    id: string;
    appliedAt: string;
}

export interface SqlListMigrationsRequest {
    database?: string;
    tableName?: string;
    page?: CursorPageRequest;
}

export interface SqlListMigrationsResponse {
    tableName: string;
    migrations: SqlMigrationRecord[];
    page?: CursorPageInfo;
}

export type SqlSchemaObjectType = 'table' | 'index' | 'view' | 'trigger';

export interface SqlSchemaObjectRecord {
    type: SqlSchemaObjectType;
    name: string;
    tableName: string | null;
    sql: string | null;
}

export interface SqlListSchemaRequest {
    database?: string;
    type?: SqlSchemaObjectType;
    page?: CursorPageRequest;
}

export interface SqlListSchemaResponse {
    objects: SqlSchemaObjectRecord[];
    page?: CursorPageInfo;
}

export interface SqlDatabaseRecord {
    name: string;
    fileName: string;
    sizeBytes: number;
    updatedAt: string | null;
    runtimeConfig: SqlRuntimeConfigDiagnostics;
    slowQuery: SqlSlowQueryDiagnostics;
}

export interface SqlListDatabasesResponse {
    databases: SqlDatabaseRecord[];
}

export interface SqlStatResponse extends SqlDatabaseRecord {
    database: string;
    filePath: string;
    exists: boolean;
}

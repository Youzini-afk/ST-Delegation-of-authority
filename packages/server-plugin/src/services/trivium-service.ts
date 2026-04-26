import fs from 'node:fs';
import path from 'node:path';
import type {
    ControlTriviumBulkDeleteRequest,
    ControlTriviumBulkLinkRequest,
    ControlTriviumBulkUnlinkRequest,
    ControlTriviumBulkUpsertRequest,
    TriviumBulkDeleteRequest,
    TriviumBulkFailure,
    TriviumBulkLinkRequest,
    TriviumBulkMutationResponse,
    TriviumBulkUnlinkRequest,
    TriviumBulkUpsertRequest,
    TriviumBulkUpsertResponse,
    TriviumDeleteRequest,
    TriviumFilterWhereRequest,
    TriviumFlushRequest,
    TriviumGetRequest,
    TriviumNeighborsRequest,
    TriviumNeighborsResponse,
    TriviumNodeReference,
    TriviumNodeView,
    TriviumQueryRequest,
    TriviumQueryRow,
    TriviumResolveIdRequest,
    TriviumResolveIdResponse,
    TriviumResolvedNodeReference,
    TriviumSearchAdvancedRequest,
    TriviumSearchHit,
    TriviumSearchHybridRequest,
    TriviumSearchRequest,
    TriviumStatRequest,
    TriviumStatResponse,
    TriviumUpsertRequest,
    TriviumUpsertResponse,
} from '@stdo/shared-types';
import { getUserAuthorityPaths } from '../store/authority-paths.js';
import type { UserContext } from '../types.js';
import { asErrorMessage, sanitizeFileSegment } from '../utils.js';
import { CoreService } from './core-service.js';

const EXTERNAL_IDS_TABLE = 'authority_trivium_external_ids';
const META_TABLE = 'authority_trivium_meta';
const LAST_FLUSH_META_KEY = 'last_flush_at';

interface ResolvedReference extends TriviumResolvedNodeReference {
    createdMapping: boolean;
}

interface IndexedCoreUpsertItem {
    originalIndex: number;
    mapping: ResolvedReference;
    request: ControlTriviumBulkUpsertRequest['items'][number];
}

interface IndexedCoreMutationItem<T> {
    originalIndex: number;
    request: T;
}

export class TriviumService {
    private readonly schemaReady = new Map<string, Promise<void>>();

    constructor(private readonly core: CoreService) {}

    async resolveId(user: UserContext, extensionId: string, request: TriviumResolveIdRequest): Promise<TriviumResolveIdResponse> {
        const database = getTriviumDatabaseName(request.database);
        const namespace = getTriviumNamespace(request.namespace);
        const externalId = getRequiredExternalId(request.externalId);
        const mapping = await this.fetchMappingByExternal(this.getMappingDbPath(user, extensionId, database), externalId, namespace);
        return {
            id: mapping?.id ?? null,
            externalId,
            namespace,
        };
    }

    async upsert(user: UserContext, extensionId: string, request: TriviumUpsertRequest): Promise<TriviumUpsertResponse> {
        const response = await this.bulkUpsert(user, extensionId, {
            ...request,
            items: [
                {
                    ...(request.id === undefined ? {} : { id: request.id }),
                    ...(request.externalId === undefined ? {} : { externalId: request.externalId }),
                    ...(request.namespace === undefined ? {} : { namespace: request.namespace }),
                    vector: request.vector,
                    payload: request.payload,
                },
            ],
        });
        if (response.items.length > 0) {
            const item = response.items[0]!;
            return {
                id: item.id,
                action: item.action,
                externalId: item.externalId,
                namespace: item.namespace,
            };
        }
        throw new Error(response.failures[0]?.message ?? 'Trivium upsert failed');
    }

    async bulkUpsert(user: UserContext, extensionId: string, request: TriviumBulkUpsertRequest): Promise<TriviumBulkUpsertResponse> {
        const database = getTriviumDatabaseName(request.database);
        const { dbPath, mappingDbPath } = this.resolvePaths(user, extensionId, database);
        await this.ensureSchema(mappingDbPath);

        const failures: TriviumBulkFailure[] = [];
        const prepared: IndexedCoreUpsertItem[] = [];

        for (const [index, item] of request.items.entries()) {
            try {
                const mapping = await this.resolveReference(mappingDbPath, item, true);
                prepared.push({
                    originalIndex: index,
                    mapping,
                    request: {
                        id: mapping.id,
                        vector: item.vector,
                        payload: item.payload,
                    },
                });
            } catch (error) {
                failures.push({ index, message: asErrorMessage(error) });
            }
        }

        let successItems: TriviumBulkUpsertResponse['items'] = [];
        if (prepared.length > 0) {
            const coreResponse = await this.core.bulkUpsertTrivium(dbPath, {
                ...request,
                database,
                items: prepared.map(item => item.request),
            });
            const failedPreparedIndexes = new Set(coreResponse.failures.map(item => item.index));
            const cleanupIds = prepared
                .filter((item, index) => item.mapping.createdMapping && failedPreparedIndexes.has(index))
                .map(item => item.mapping.id);
            if (cleanupIds.length > 0) {
                await this.deleteMappingsByInternalIds(mappingDbPath, cleanupIds);
            }
            failures.push(...coreResponse.failures.map(item => ({
                index: prepared[item.index]?.originalIndex ?? item.index,
                message: item.message,
            })));
            successItems = coreResponse.items
                .map(item => {
                    const preparedItem = prepared[item.index];
                    if (!preparedItem) {
                        return null;
                    }
                    return {
                        index: preparedItem.originalIndex,
                        id: item.id,
                        action: item.action,
                        externalId: preparedItem.mapping.externalId,
                        namespace: preparedItem.mapping.namespace,
                    };
                })
                .filter((item): item is TriviumBulkUpsertResponse['items'][number] => item !== null)
                .sort((left, right) => left.index - right.index);
        }

        return {
            totalCount: request.items.length,
            successCount: successItems.length,
            failureCount: failures.length,
            failures: failures.sort((left, right) => left.index - right.index),
            items: successItems,
        };
    }

    async bulkLink(user: UserContext, extensionId: string, request: TriviumBulkLinkRequest): Promise<TriviumBulkMutationResponse> {
        const database = getTriviumDatabaseName(request.database);
        const { dbPath, mappingDbPath } = this.resolvePaths(user, extensionId, database);
        const failures: TriviumBulkFailure[] = [];
        const prepared: IndexedCoreMutationItem<ControlTriviumBulkLinkRequest['items'][number]>[] = [];

        for (const [index, item] of request.items.entries()) {
            try {
                const src = await this.resolveReference(mappingDbPath, item.src, false);
                const dst = await this.resolveReference(mappingDbPath, item.dst, false);
                prepared.push({
                    originalIndex: index,
                    request: {
                        src: src.id,
                        dst: dst.id,
                        ...(item.label === undefined ? {} : { label: item.label }),
                        ...(item.weight === undefined ? {} : { weight: item.weight }),
                    },
                });
            } catch (error) {
                failures.push({ index, message: asErrorMessage(error) });
            }
        }

        return await this.runBulkMutation(prepared, failures, request.items.length, items => this.core.bulkLinkTrivium(dbPath, {
            ...request,
            database,
            items,
        }));
    }

    async bulkUnlink(user: UserContext, extensionId: string, request: TriviumBulkUnlinkRequest): Promise<TriviumBulkMutationResponse> {
        const database = getTriviumDatabaseName(request.database);
        const { dbPath, mappingDbPath } = this.resolvePaths(user, extensionId, database);
        const failures: TriviumBulkFailure[] = [];
        const prepared: IndexedCoreMutationItem<ControlTriviumBulkUnlinkRequest['items'][number]>[] = [];

        for (const [index, item] of request.items.entries()) {
            try {
                const src = await this.resolveReference(mappingDbPath, item.src, false);
                const dst = await this.resolveReference(mappingDbPath, item.dst, false);
                prepared.push({
                    originalIndex: index,
                    request: {
                        src: src.id,
                        dst: dst.id,
                    },
                });
            } catch (error) {
                failures.push({ index, message: asErrorMessage(error) });
            }
        }

        return await this.runBulkMutation(prepared, failures, request.items.length, items => this.core.bulkUnlinkTrivium(dbPath, {
            ...request,
            database,
            items,
        }));
    }

    async bulkDelete(user: UserContext, extensionId: string, request: TriviumBulkDeleteRequest): Promise<TriviumBulkMutationResponse> {
        const database = getTriviumDatabaseName(request.database);
        const { dbPath, mappingDbPath } = this.resolvePaths(user, extensionId, database);
        const failures: TriviumBulkFailure[] = [];
        const prepared: Array<IndexedCoreMutationItem<ControlTriviumBulkDeleteRequest['items'][number]> & { id: number }> = [];

        for (const [index, item] of request.items.entries()) {
            try {
                const resolved = await this.resolveReference(mappingDbPath, item, false);
                prepared.push({
                    originalIndex: index,
                    id: resolved.id,
                    request: { id: resolved.id },
                });
            } catch (error) {
                failures.push({ index, message: asErrorMessage(error) });
            }
        }

        const response = await this.runBulkMutation(prepared, failures, request.items.length, items => this.core.bulkDeleteTrivium(dbPath, {
            ...request,
            database,
            items,
        }));
        const failedOriginalIndexes = new Set(response.failures.map(item => item.index));
        const deletedIds = prepared
            .filter(item => !failedOriginalIndexes.has(item.originalIndex))
            .map(item => item.id);
        if (deletedIds.length > 0) {
            await this.deleteMappingsByInternalIds(mappingDbPath, deletedIds);
        }
        return response;
    }

    async delete(user: UserContext, extensionId: string, request: TriviumDeleteRequest): Promise<void> {
        const response = await this.bulkDelete(user, extensionId, {
            ...request,
            items: [{ id: request.id }],
        });
        if (response.failureCount > 0) {
            throw new Error(response.failures[0]?.message ?? 'Trivium delete failed');
        }
    }

    async get(user: UserContext, extensionId: string, request: TriviumGetRequest): Promise<TriviumNodeView | null> {
        const database = getTriviumDatabaseName(request.database);
        const { dbPath, mappingDbPath } = this.resolvePaths(user, extensionId, database);
        const node = await this.core.getTrivium(dbPath, { ...request, database });
        if (!node) {
            return null;
        }
        const [enriched] = await this.enrichNodes(mappingDbPath, [node]);
        return enriched ?? node;
    }

    async neighbors(user: UserContext, extensionId: string, request: TriviumNeighborsRequest): Promise<TriviumNeighborsResponse> {
        const database = getTriviumDatabaseName(request.database);
        const { dbPath, mappingDbPath } = this.resolvePaths(user, extensionId, database);
        const response = await this.core.neighborsTrivium(dbPath, { ...request, database });
        return {
            ...response,
            nodes: await this.resolveMappingsByInternalIds(mappingDbPath, response.ids),
        };
    }

    async search(user: UserContext, extensionId: string, request: TriviumSearchRequest): Promise<TriviumSearchHit[]> {
        const database = getTriviumDatabaseName(request.database);
        const { dbPath, mappingDbPath } = this.resolvePaths(user, extensionId, database);
        return await this.enrichSearchHits(mappingDbPath, await this.core.searchTrivium(dbPath, { ...request, database }));
    }

    async searchAdvanced(user: UserContext, extensionId: string, request: TriviumSearchAdvancedRequest): Promise<TriviumSearchHit[]> {
        const database = getTriviumDatabaseName(request.database);
        const { dbPath, mappingDbPath } = this.resolvePaths(user, extensionId, database);
        return await this.enrichSearchHits(mappingDbPath, await this.core.searchAdvancedTrivium(dbPath, { ...request, database }));
    }

    async searchHybrid(user: UserContext, extensionId: string, request: TriviumSearchHybridRequest): Promise<TriviumSearchHit[]> {
        const database = getTriviumDatabaseName(request.database);
        const { dbPath, mappingDbPath } = this.resolvePaths(user, extensionId, database);
        return await this.enrichSearchHits(mappingDbPath, await this.core.searchHybridTrivium(dbPath, { ...request, database }));
    }

    async filterWhere(user: UserContext, extensionId: string, request: TriviumFilterWhereRequest): Promise<TriviumNodeView[]> {
        const database = getTriviumDatabaseName(request.database);
        const { dbPath, mappingDbPath } = this.resolvePaths(user, extensionId, database);
        return await this.enrichNodes(mappingDbPath, await this.core.filterWhereTrivium(dbPath, { ...request, database }));
    }

    async query(user: UserContext, extensionId: string, request: TriviumQueryRequest): Promise<TriviumQueryRow[]> {
        const database = getTriviumDatabaseName(request.database);
        const { dbPath, mappingDbPath } = this.resolvePaths(user, extensionId, database);
        return await this.enrichRows(mappingDbPath, await this.core.queryTrivium(dbPath, { ...request, database }));
    }

    async flush(user: UserContext, extensionId: string, request: TriviumFlushRequest = {}): Promise<void> {
        const database = getTriviumDatabaseName(request.database);
        const { dbPath, mappingDbPath } = this.resolvePaths(user, extensionId, database);
        await this.core.flushTrivium(dbPath, { ...request, database });
        await this.ensureSchema(mappingDbPath);
        await this.writeMetaValue(mappingDbPath, LAST_FLUSH_META_KEY, new Date().toISOString());
    }

    async stat(user: UserContext, extensionId: string, request: TriviumStatRequest = {}): Promise<TriviumStatResponse> {
        const database = getTriviumDatabaseName(request.database);
        const { dbPath, mappingDbPath } = this.resolvePaths(user, extensionId, database);
        const stat = await this.core.statTrivium(dbPath, { ...request, database });
        const lastFlushAt = await this.readMetaValue(mappingDbPath, LAST_FLUSH_META_KEY);
        return {
            ...stat,
            lastFlushAt,
        };
    }

    private async ensureSchema(mappingDbPath: string): Promise<void> {
        const existing = this.schemaReady.get(mappingDbPath);
        if (existing) {
            await existing;
            return;
        }

        const schemaPromise = this.core.migrateSql(mappingDbPath, {
            migrations: [{
                id: '001_authority_trivium_mapping',
                statement: `CREATE TABLE IF NOT EXISTS ${EXTERNAL_IDS_TABLE} (
                    internal_id INTEGER PRIMARY KEY AUTOINCREMENT,
                    namespace TEXT NOT NULL,
                    external_id TEXT NOT NULL,
                    created_at TEXT NOT NULL,
                    updated_at TEXT NOT NULL,
                    UNIQUE (namespace, external_id)
                );
                CREATE INDEX IF NOT EXISTS idx_${EXTERNAL_IDS_TABLE}_external ON ${EXTERNAL_IDS_TABLE}(namespace, external_id);
                CREATE INDEX IF NOT EXISTS idx_${EXTERNAL_IDS_TABLE}_internal ON ${EXTERNAL_IDS_TABLE}(internal_id);
                CREATE TABLE IF NOT EXISTS ${META_TABLE} (
                    key TEXT PRIMARY KEY,
                    value TEXT NOT NULL,
                    updated_at TEXT NOT NULL
                );`,
            }],
        }).then(() => undefined);
        this.schemaReady.set(mappingDbPath, schemaPromise);
        try {
            await schemaPromise;
        } catch (error) {
            this.schemaReady.delete(mappingDbPath);
            throw error;
        }
    }

    private resolvePaths(user: UserContext, extensionId: string, database: string): { dbPath: string; mappingDbPath: string } {
        const paths = getUserAuthorityPaths(user);
        const directory = path.join(paths.triviumPrivateDir, sanitizeFileSegment(extensionId));
        return {
            dbPath: path.join(directory, `${sanitizeFileSegment(database)}.tdb`),
            mappingDbPath: path.join(directory, '__mapping__', `${sanitizeFileSegment(database)}.sqlite`),
        };
    }

    private getMappingDbPath(user: UserContext, extensionId: string, database: string): string {
        return this.resolvePaths(user, extensionId, database).mappingDbPath;
    }

    private async runBulkMutation<T>(
        prepared: IndexedCoreMutationItem<T>[],
        failures: TriviumBulkFailure[],
        totalCount: number,
        execute: (items: T[]) => Promise<TriviumBulkMutationResponse>,
    ): Promise<TriviumBulkMutationResponse> {
        if (prepared.length > 0) {
            const coreResponse = await execute(prepared.map(item => item.request));
            failures.push(...coreResponse.failures.map(item => ({
                index: prepared[item.index]?.originalIndex ?? item.index,
                message: item.message,
            })));
            return {
                totalCount,
                successCount: prepared.length - coreResponse.failureCount,
                failureCount: failures.length,
                failures: failures.sort((left, right) => left.index - right.index),
            };
        }
        return {
            totalCount,
            successCount: 0,
            failureCount: failures.length,
            failures: failures.sort((left, right) => left.index - right.index),
        };
    }

    private async resolveReference(mappingDbPath: string, reference: TriviumNodeReference, allowCreate: boolean): Promise<ResolvedReference> {
        const externalId = reference.externalId?.trim() ? reference.externalId.trim() : null;
        const hasId = reference.id != null;
        if (!hasId && !externalId) {
            throw new Error('Trivium reference must include id or externalId');
        }
        if (externalId === null) {
            return {
                id: getRequiredNumericId(reference.id),
                externalId: null,
                namespace: null,
                createdMapping: false,
            };
        }

        const namespace = getTriviumNamespace(reference.namespace);
        await this.ensureSchema(mappingDbPath);
        const existing = await this.fetchMappingByExternal(mappingDbPath, externalId, namespace);
        if (existing) {
            if (hasId && existing.id !== getRequiredNumericId(reference.id)) {
                throw new Error(`Trivium externalId ${namespace}:${externalId} is already mapped to ${existing.id}`);
            }
            return { ...existing, createdMapping: false };
        }
        if (!allowCreate) {
            throw new Error(`Trivium externalId ${namespace}:${externalId} is not mapped`);
        }

        const explicitId = hasId ? getRequiredNumericId(reference.id) : null;
        try {
            if (explicitId != null) {
                await this.insertMappingWithId(mappingDbPath, explicitId, externalId, namespace);
                return { id: explicitId, externalId, namespace, createdMapping: true };
            }
            const id = await this.insertMappingAuto(mappingDbPath, externalId, namespace);
            return { id, externalId, namespace, createdMapping: true };
        } catch (error) {
            const raced = await this.fetchMappingByExternal(mappingDbPath, externalId, namespace);
            if (raced) {
                if (explicitId != null && raced.id !== explicitId) {
                    throw new Error(`Trivium externalId ${namespace}:${externalId} is already mapped to ${raced.id}`);
                }
                return { ...raced, createdMapping: false };
            }
            throw new Error(`Failed to create Trivium externalId mapping: ${asErrorMessage(error)}`);
        }
    }

    private async fetchMappingByExternal(mappingDbPath: string, externalId: string, namespace: string): Promise<TriviumResolvedNodeReference | null> {
        if (!fs.existsSync(mappingDbPath)) {
            return null;
        }
        const result = await this.core.querySql(mappingDbPath, {
            statement: `SELECT internal_id AS internalId, external_id AS externalId, namespace FROM ${EXTERNAL_IDS_TABLE} WHERE namespace = ?1 AND external_id = ?2 LIMIT 1`,
            params: [namespace, externalId],
        });
        const [row] = result.rows;
        return row ? readResolvedReference(row) : null;
    }

    private async resolveMappingsByInternalIds(mappingDbPath: string, ids: number[]): Promise<TriviumResolvedNodeReference[]> {
        const mappings = await this.fetchMappingsByInternalIds(mappingDbPath, ids);
        return ids.map(id => mappings.get(id) ?? { id, externalId: null, namespace: null });
    }

    private async fetchMappingsByInternalIds(mappingDbPath: string, ids: number[]): Promise<Map<number, TriviumResolvedNodeReference>> {
        const uniqueIds = [...new Set(ids.filter(value => Number.isSafeInteger(value) && value > 0))];
        if (uniqueIds.length === 0 || !fs.existsSync(mappingDbPath)) {
            return new Map();
        }
        const statement = `SELECT internal_id AS internalId, external_id AS externalId, namespace FROM ${EXTERNAL_IDS_TABLE} WHERE internal_id IN (${uniqueIds.map((_, index) => `?${index + 1}`).join(', ')})`;
        const result = await this.core.querySql(mappingDbPath, {
            statement,
            params: uniqueIds,
        });
        return new Map(result.rows.map(row => {
            const resolved = readResolvedReference(row);
            return [resolved.id, resolved] as const;
        }));
    }

    private async insertMappingAuto(mappingDbPath: string, externalId: string, namespace: string): Promise<number> {
        const timestamp = new Date().toISOString();
        const result = await this.core.execSql(mappingDbPath, {
            statement: `INSERT INTO ${EXTERNAL_IDS_TABLE} (namespace, external_id, created_at, updated_at) VALUES (?1, ?2, ?3, ?4)`,
            params: [namespace, externalId, timestamp, timestamp],
        });
        return getRequiredNumericId(result.lastInsertRowid, 'lastInsertRowid');
    }

    private async insertMappingWithId(mappingDbPath: string, id: number, externalId: string, namespace: string): Promise<void> {
        const timestamp = new Date().toISOString();
        await this.core.execSql(mappingDbPath, {
            statement: `INSERT INTO ${EXTERNAL_IDS_TABLE} (internal_id, namespace, external_id, created_at, updated_at) VALUES (?1, ?2, ?3, ?4, ?5)`,
            params: [id, namespace, externalId, timestamp, timestamp],
        });
    }

    private async deleteMappingsByInternalIds(mappingDbPath: string, ids: number[]): Promise<void> {
        const uniqueIds = [...new Set(ids.filter(value => Number.isSafeInteger(value) && value > 0))];
        if (uniqueIds.length === 0 || !fs.existsSync(mappingDbPath)) {
            return;
        }
        await this.core.execSql(mappingDbPath, {
            statement: `DELETE FROM ${EXTERNAL_IDS_TABLE} WHERE internal_id IN (${uniqueIds.map((_, index) => `?${index + 1}`).join(', ')})`,
            params: uniqueIds,
        });
    }

    private async readMetaValue(mappingDbPath: string, key: string): Promise<string | null> {
        if (!fs.existsSync(mappingDbPath)) {
            return null;
        }
        const result = await this.core.querySql(mappingDbPath, {
            statement: `SELECT value FROM ${META_TABLE} WHERE key = ?1 LIMIT 1`,
            params: [key],
        });
        const [row] = result.rows;
        return typeof row?.value === 'string' ? row.value : null;
    }

    private async writeMetaValue(mappingDbPath: string, key: string, value: string): Promise<void> {
        const timestamp = new Date().toISOString();
        await this.core.execSql(mappingDbPath, {
            statement: `INSERT INTO ${META_TABLE} (key, value, updated_at) VALUES (?1, ?2, ?3)
                ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`,
            params: [key, value, timestamp],
        });
    }

    private async enrichSearchHits(mappingDbPath: string, hits: TriviumSearchHit[]): Promise<TriviumSearchHit[]> {
        const mappings = await this.fetchMappingsByInternalIds(mappingDbPath, hits.map(hit => hit.id));
        return hits.map(hit => ({
            ...hit,
            externalId: mappings.get(hit.id)?.externalId ?? null,
            namespace: mappings.get(hit.id)?.namespace ?? null,
        }));
    }

    private async enrichNodes(mappingDbPath: string, nodes: TriviumNodeView[]): Promise<TriviumNodeView[]> {
        const ids = nodes.flatMap(node => [node.id, ...node.edges.map(edge => edge.targetId)]);
        const mappings = await this.fetchMappingsByInternalIds(mappingDbPath, ids);
        return nodes.map(node => ({
            ...node,
            externalId: mappings.get(node.id)?.externalId ?? null,
            namespace: mappings.get(node.id)?.namespace ?? null,
            edges: node.edges.map(edge => ({
                ...edge,
                targetExternalId: mappings.get(edge.targetId)?.externalId ?? null,
                targetNamespace: mappings.get(edge.targetId)?.namespace ?? null,
            })),
        }));
    }

    private async enrichRows(mappingDbPath: string, rows: TriviumQueryRow[]): Promise<TriviumQueryRow[]> {
        const ids = rows.flatMap(row => Object.values(row).flatMap(node => [node.id, ...node.edges.map(edge => edge.targetId)]));
        const mappings = await this.fetchMappingsByInternalIds(mappingDbPath, ids);
        return rows.map(row => Object.fromEntries(Object.entries(row).map(([key, node]) => [key, {
            ...node,
            externalId: mappings.get(node.id)?.externalId ?? null,
            namespace: mappings.get(node.id)?.namespace ?? null,
            edges: node.edges.map(edge => ({
                ...edge,
                targetExternalId: mappings.get(edge.targetId)?.externalId ?? null,
                targetNamespace: mappings.get(edge.targetId)?.namespace ?? null,
            })),
        }])));
    }
}

function getTriviumDatabaseName(value: unknown): string {
    return typeof value === 'string' && value.trim() ? value.trim() : 'default';
}

function getTriviumNamespace(value: unknown): string {
    return typeof value === 'string' && value.trim() ? value.trim() : 'default';
}

function getRequiredExternalId(value: unknown): string {
    if (typeof value === 'string' && value.trim()) {
        return value.trim();
    }
    throw new Error('Trivium externalId must not be empty');
}

function getRequiredNumericId(value: unknown, label = 'id'): number {
    if (typeof value === 'number' && Number.isSafeInteger(value) && value > 0) {
        return value;
    }
    throw new Error(`Trivium ${label} must be a positive safe integer`);
}

function readResolvedReference(row: Record<string, unknown>): TriviumResolvedNodeReference {
    return {
        id: getRequiredNumericId(row.internalId, 'internalId'),
        externalId: typeof row.externalId === 'string' ? row.externalId : null,
        namespace: typeof row.namespace === 'string' ? row.namespace : null,
    };
}

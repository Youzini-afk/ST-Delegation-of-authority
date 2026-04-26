import fs from 'node:fs';
import path from 'node:path';
import type {
    ControlTriviumBulkDeleteRequest,
    ControlTriviumBulkLinkRequest,
    ControlTriviumBulkUnlinkRequest,
    ControlTriviumBulkUpsertRequest,
    CursorPageInfo,
    CursorPageRequest,
    TriviumBulkDeleteRequest,
    TriviumBulkFailure,
    TriviumBulkLinkRequest,
    TriviumBulkMutationResponse,
    TriviumBulkUnlinkRequest,
    TriviumBulkUpsertRequest,
    TriviumBulkUpsertResponse,
    TriviumCheckMappingsIntegrityRequest,
    TriviumCheckMappingsIntegrityResponse,
    TriviumDeleteRequest,
    TriviumDeleteOrphanMappingsRequest,
    TriviumDeleteOrphanMappingsResponse,
    TriviumDType,
    TriviumDatabaseRecord,
    TriviumFilterWhereRequest,
    TriviumFilterWhereResponse,
    TriviumFlushRequest,
    TriviumGetRequest,
    TriviumListDatabasesResponse,
    TriviumListMappingsRequest,
    TriviumListMappingsResponse,
    TriviumMappingIntegrityIssue,
    TriviumMappingRecord,
    TriviumNeighborsRequest,
    TriviumNeighborsResponse,
    TriviumNodeReference,
    TriviumNodeView,
    TriviumQueryRequest,
    TriviumQueryResponse,
    TriviumQueryRow,
    TriviumResolveIdRequest,
    TriviumResolveIdResponse,
    TriviumResolveManyRequest,
    TriviumResolveManyResponse,
    TriviumResolvedNodeReference,
    TriviumSearchAdvancedRequest,
    TriviumSearchHit,
    TriviumSearchHybridRequest,
    TriviumSearchRequest,
    TriviumStatRequest,
    TriviumStatResponse,
    TriviumStorageMode,
    TriviumSyncMode,
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
const DATABASE_DIM_META_KEY = 'database_dim';
const DATABASE_DTYPE_META_KEY = 'database_dtype';
const DATABASE_SYNC_MODE_META_KEY = 'database_sync_mode';
const DATABASE_STORAGE_MODE_META_KEY = 'database_storage_mode';
const DEFAULT_CURSOR_PAGE_LIMIT = 50;
const MAX_CURSOR_PAGE_LIMIT = 500;
const DEFAULT_INTEGRITY_SAMPLE_LIMIT = 100;
const DEFAULT_ORPHAN_DELETE_LIMIT = 100;

interface TriviumDatabaseConfigMeta {
    dim: number | null;
    dtype: TriviumDType | null;
    syncMode: TriviumSyncMode | null;
    storageMode: TriviumStorageMode | null;
}

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

interface MappingIntegrityAnalysis {
    mappings: TriviumMappingRecord[];
    nodeIds: number[];
    orphanMappings: TriviumMappingRecord[];
    missingNodeIds: number[];
    duplicateInternalGroups: TriviumMappingRecord[][];
    duplicateExternalGroups: TriviumMappingRecord[][];
}

export class TriviumService {
    private readonly schemaReady = new Map<string, Promise<void>>();

    constructor(private readonly core: CoreService) {}

    async listDatabases(user: UserContext, extensionId: string): Promise<TriviumListDatabasesResponse> {
        const paths = getUserAuthorityPaths(user);
        const directory = path.join(paths.triviumPrivateDir, sanitizeFileSegment(extensionId));
        if (!fs.existsSync(directory)) {
            return { databases: [] };
        }

        const databases = await Promise.all(fs.readdirSync(directory, { withFileTypes: true })
            .filter(entry => entry.isFile() && entry.name.endsWith('.tdb'))
            .map(async entry => {
                const database = entry.name.slice(0, -'.tdb'.length);
                const { dbPath, mappingDbPath } = this.resolvePaths(user, extensionId, database);
                const meta = await this.readDatabaseConfigMeta(mappingDbPath);
                return buildTriviumDatabaseRecord(dbPath, entry.name, meta);
            }));

        databases.sort((left, right) => (right.updatedAt ?? '').localeCompare(left.updatedAt ?? ''));
        return { databases };
    }

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

    async resolveMany(user: UserContext, extensionId: string, request: TriviumResolveManyRequest): Promise<TriviumResolveManyResponse> {
        const database = getTriviumDatabaseName(request.database);
        const mappingDbPath = this.getMappingDbPath(user, extensionId, database);
        const byInternalId = await this.fetchMappingsByInternalIds(mappingDbPath, request.items.map(item => Number(item.id ?? 0)));

        return {
            items: await Promise.all(request.items.map(async (item, index) => {
                const rawExternalId = typeof item.externalId === 'string' && item.externalId.trim() ? item.externalId.trim() : null;
                if (rawExternalId) {
                    const namespace = getTriviumNamespace(item.namespace);
                    const mapping = await this.fetchMappingByExternal(mappingDbPath, rawExternalId, namespace);
                    const explicitId = item.id == null ? null : Number(item.id);
                    if (explicitId != null && Number.isSafeInteger(explicitId) && explicitId > 0 && mapping && mapping.id !== explicitId) {
                        return {
                            index,
                            id: mapping.id,
                            externalId: mapping.externalId,
                            namespace: mapping.namespace,
                            error: `Trivium externalId ${namespace}:${rawExternalId} is already mapped to ${mapping.id}`,
                        };
                    }
                    return {
                        index,
                        id: mapping?.id ?? null,
                        externalId: rawExternalId,
                        namespace,
                    };
                }

                try {
                    const id = getRequiredNumericId(item.id);
                    const mapping = byInternalId.get(id);
                    return {
                        index,
                        id,
                        externalId: mapping?.externalId ?? null,
                        namespace: mapping?.namespace ?? null,
                    };
                } catch (error) {
                    return {
                        index,
                        id: null,
                        externalId: null,
                        namespace: null,
                        error: asErrorMessage(error),
                    };
                }
            })),
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
        await this.rememberDatabaseConfig(mappingDbPath, request);

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
        const response = await this.filterWherePage(user, extensionId, request);
        return response.nodes;
    }

    async filterWherePage(user: UserContext, extensionId: string, request: TriviumFilterWhereRequest): Promise<TriviumFilterWhereResponse> {
        const database = getTriviumDatabaseName(request.database);
        const { dbPath, mappingDbPath } = this.resolvePaths(user, extensionId, database);
        const response = await this.core.filterWhereTriviumPage(dbPath, { ...request, database });
        return {
            ...response,
            nodes: await this.enrichNodes(mappingDbPath, response.nodes),
        };
    }

    async query(user: UserContext, extensionId: string, request: TriviumQueryRequest): Promise<TriviumQueryRow[]> {
        const response = await this.queryPage(user, extensionId, request);
        return response.rows;
    }

    async queryPage(user: UserContext, extensionId: string, request: TriviumQueryRequest): Promise<TriviumQueryResponse> {
        const database = getTriviumDatabaseName(request.database);
        const { dbPath, mappingDbPath } = this.resolvePaths(user, extensionId, database);
        const response = await this.core.queryTriviumPage(dbPath, { ...request, database });
        return {
            ...response,
            rows: await this.enrichRows(mappingDbPath, response.rows),
        };
    }

    async flush(user: UserContext, extensionId: string, request: TriviumFlushRequest = {}): Promise<void> {
        const database = getTriviumDatabaseName(request.database);
        const { dbPath, mappingDbPath } = this.resolvePaths(user, extensionId, database);
        await this.core.flushTrivium(dbPath, { ...request, database });
        await this.ensureSchema(mappingDbPath);
        if (fs.existsSync(dbPath)) {
            await this.rememberDatabaseConfig(mappingDbPath, request);
        }
        await this.writeMetaValue(mappingDbPath, LAST_FLUSH_META_KEY, new Date().toISOString());
    }

    async stat(user: UserContext, extensionId: string, request: TriviumStatRequest = {}): Promise<TriviumStatResponse> {
        const database = getTriviumDatabaseName(request.database);
        const { dbPath, mappingDbPath } = this.resolvePaths(user, extensionId, database);
        if (fs.existsSync(dbPath)) {
            await this.rememberDatabaseConfig(mappingDbPath, request);
        }
        const stat = await this.core.statTrivium(dbPath, { ...request, database });
        const lastFlushAt = await this.readMetaValue(mappingDbPath, LAST_FLUSH_META_KEY);
        const mappingCount = await this.countMappings(mappingDbPath);
        const orphanMappingCount = request.includeMappingIntegrity
            ? await this.countOrphanMappings(dbPath, mappingDbPath, database)
            : null;
        return {
            ...stat,
            lastFlushAt,
            mappingCount,
            orphanMappingCount,
        };
    }

    async checkMappingsIntegrity(
        user: UserContext,
        extensionId: string,
        request: TriviumCheckMappingsIntegrityRequest = {},
    ): Promise<TriviumCheckMappingsIntegrityResponse> {
        const database = getTriviumDatabaseName(request.database);
        const { dbPath, mappingDbPath } = this.resolvePaths(user, extensionId, database);
        const sampleLimit = getBoundedPositiveInteger(request.sampleLimit, DEFAULT_INTEGRITY_SAMPLE_LIMIT, MAX_CURSOR_PAGE_LIMIT, 'sampleLimit');
        const analysis = await this.analyzeMappingsIntegrity(dbPath, mappingDbPath, database);

        const issues: TriviumMappingIntegrityIssue[] = [];
        const pushIssue = (issue: TriviumMappingIntegrityIssue): void => {
            if (issues.length < sampleLimit) {
                issues.push(issue);
            }
        };

        for (const mapping of analysis.orphanMappings) {
            pushIssue({
                type: 'orphanMapping',
                message: `Trivium mapping ${mapping.namespace}:${mapping.externalId} points to missing node ${mapping.id}`,
                id: mapping.id,
                externalId: mapping.externalId,
                namespace: mapping.namespace,
            });
        }

        for (const id of analysis.missingNodeIds) {
            pushIssue({
                type: 'missingMapping',
                message: `Trivium node ${id} has no externalId mapping`,
                id,
                externalId: null,
                namespace: null,
            });
        }

        for (const group of analysis.duplicateInternalGroups) {
            const first = group[0];
            if (!first) {
                continue;
            }
            pushIssue({
                type: 'duplicateInternalId',
                message: `Trivium internalId ${first.id} appears in ${group.length} mapping rows`,
                id: first.id,
                externalId: first.externalId,
                namespace: first.namespace,
            });
        }

        for (const group of analysis.duplicateExternalGroups) {
            const first = group[0];
            if (!first) {
                continue;
            }
            pushIssue({
                type: 'duplicateExternalId',
                message: `Trivium externalId ${first.namespace}:${first.externalId} appears in ${group.length} mapping rows`,
                id: first.id,
                externalId: first.externalId,
                namespace: first.namespace,
            });
        }

        const totalIssues = analysis.orphanMappings.length
            + analysis.missingNodeIds.length
            + analysis.duplicateInternalGroups.length
            + analysis.duplicateExternalGroups.length;

        return {
            ok: totalIssues === 0,
            mappingCount: analysis.mappings.length,
            nodeCount: analysis.nodeIds.length,
            orphanMappingCount: analysis.orphanMappings.length,
            missingMappingCount: analysis.missingNodeIds.length,
            duplicateInternalIdCount: analysis.duplicateInternalGroups.length,
            duplicateExternalIdCount: analysis.duplicateExternalGroups.length,
            issues,
            sampled: totalIssues > issues.length,
        };
    }

    async deleteOrphanMappings(
        user: UserContext,
        extensionId: string,
        request: TriviumDeleteOrphanMappingsRequest = {},
    ): Promise<TriviumDeleteOrphanMappingsResponse> {
        const database = getTriviumDatabaseName(request.database);
        const { dbPath, mappingDbPath } = this.resolvePaths(user, extensionId, database);
        const limit = getBoundedPositiveInteger(request.limit, DEFAULT_ORPHAN_DELETE_LIMIT, MAX_CURSOR_PAGE_LIMIT, 'limit');
        const analysis = await this.analyzeMappingsIntegrity(dbPath, mappingDbPath, database);
        const orphans = analysis.orphanMappings.slice(0, limit);

        if (!request.dryRun && orphans.length > 0) {
            await this.deleteMappingsByInternalIds(mappingDbPath, orphans.map(item => item.id));
        }

        return {
            scannedCount: analysis.mappings.length,
            orphanCount: analysis.orphanMappings.length,
            deletedCount: request.dryRun ? 0 : orphans.length,
            hasMore: analysis.orphanMappings.length > orphans.length,
            orphans,
        };
    }

    async listMappingsPage(user: UserContext, extensionId: string, request: TriviumListMappingsRequest = {}): Promise<TriviumListMappingsResponse> {
        const database = getTriviumDatabaseName(request.database);
        const mappingDbPath = this.getMappingDbPath(user, extensionId, database);
        const namespace = getOptionalTriviumNamespace(request.namespace);
        if (!fs.existsSync(mappingDbPath)) {
            return {
                mappings: [],
                ...(request.page ? { page: buildEmptyCursorPage(request.page) } : {}),
            };
        }

        const params = namespace ? [namespace] : [];
        const result = await this.core.querySql(mappingDbPath, {
            statement: `SELECT internal_id AS internalId, external_id AS externalId, namespace, created_at AS createdAt, updated_at AS updatedAt
                FROM ${EXTERNAL_IDS_TABLE}${namespace ? ' WHERE namespace = ?1' : ''}
                ORDER BY namespace ASC, external_id ASC, internal_id ASC`,
            params,
            ...(request.page ? { page: request.page } : {}),
        });

        return {
            mappings: result.rows.map(row => readMappingRecord(row)),
            ...(result.page ? { page: result.page } : {}),
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

    private async countMappings(mappingDbPath: string): Promise<number> {
        if (!fs.existsSync(mappingDbPath)) {
            return 0;
        }
        const result = await this.core.querySql(mappingDbPath, {
            statement: `SELECT COUNT(*) AS count FROM ${EXTERNAL_IDS_TABLE}`,
        });
        return getNonNegativeInteger(result.rows[0]?.count);
    }

    private async countOrphanMappings(dbPath: string, mappingDbPath: string, database: string): Promise<number> {
        if (!fs.existsSync(mappingDbPath)) {
            return 0;
        }
        const result = await this.core.querySql(mappingDbPath, {
            statement: `SELECT internal_id AS internalId FROM ${EXTERNAL_IDS_TABLE} ORDER BY internal_id ASC`,
        });

        let orphanCount = 0;
        for (const row of result.rows) {
            const id = getRequiredNumericId(row.internalId, 'internalId');
            const node = await this.core.getTrivium(dbPath, {
                database,
                id,
            });
            if (!node) {
                orphanCount += 1;
            }
        }
        return orphanCount;
    }

    private async analyzeMappingsIntegrity(dbPath: string, mappingDbPath: string, database: string): Promise<MappingIntegrityAnalysis> {
        const mappings = await this.listAllMappings(mappingDbPath);
        const nodeIds = await this.listAllNodeIds(dbPath, database);
        const nodeIdSet = new Set(nodeIds);
        const mappedIdSet = new Set<number>();
        const byInternalId = new Map<number, TriviumMappingRecord[]>();
        const byExternalId = new Map<string, TriviumMappingRecord[]>();

        for (const mapping of mappings) {
            mappedIdSet.add(mapping.id);
            const internalGroup = byInternalId.get(mapping.id);
            if (internalGroup) {
                internalGroup.push(mapping);
            } else {
                byInternalId.set(mapping.id, [mapping]);
            }

            const externalKey = `${mapping.namespace}\u0000${mapping.externalId}`;
            const externalGroup = byExternalId.get(externalKey);
            if (externalGroup) {
                externalGroup.push(mapping);
            } else {
                byExternalId.set(externalKey, [mapping]);
            }
        }

        return {
            mappings,
            nodeIds,
            orphanMappings: mappings.filter(mapping => !nodeIdSet.has(mapping.id)),
            missingNodeIds: nodeIds.filter(id => !mappedIdSet.has(id)),
            duplicateInternalGroups: [...byInternalId.entries()]
                .filter(([, group]) => group.length > 1)
                .sort((left, right) => left[0] - right[0])
                .map(([, group]) => group),
            duplicateExternalGroups: [...byExternalId.entries()]
                .filter(([, group]) => group.length > 1)
                .sort((left, right) => left[0].localeCompare(right[0]))
                .map(([, group]) => group),
        };
    }

    private async listAllMappings(mappingDbPath: string): Promise<TriviumMappingRecord[]> {
        if (!fs.existsSync(mappingDbPath)) {
            return [];
        }
        const result = await this.core.querySql(mappingDbPath, {
            statement: `SELECT internal_id AS internalId, external_id AS externalId, namespace, created_at AS createdAt, updated_at AS updatedAt
                FROM ${EXTERNAL_IDS_TABLE}
                ORDER BY internal_id ASC, namespace ASC, external_id ASC`,
        });
        return result.rows.map(row => readMappingRecord(row));
    }

    private async listAllNodeIds(dbPath: string, database: string): Promise<number[]> {
        if (!fs.existsSync(dbPath)) {
            return [];
        }

        const ids: number[] = [];
        let cursor: string | null = null;
        do {
            const response = await this.core.queryTriviumPage(dbPath, {
                database,
                cypher: 'MATCH (n) RETURN n',
                page: {
                    ...(cursor ? { cursor } : {}),
                    limit: MAX_CURSOR_PAGE_LIMIT,
                },
            });

            for (const row of response.rows) {
                ids.push(getRequiredNumericId(row.n?.id, 'id'));
            }

            cursor = response.page?.nextCursor ?? null;
        } while (cursor);

        return [...new Set(ids)].sort((left, right) => left - right);
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

    private async rememberDatabaseConfig(
        mappingDbPath: string,
        request: { dim?: number; dtype?: TriviumDType; syncMode?: TriviumSyncMode; storageMode?: TriviumStorageMode },
    ): Promise<void> {
        await this.ensureSchema(mappingDbPath);
        const writes: Promise<void>[] = [];
        if (request.dim !== undefined) {
            writes.push(this.writeMetaValue(mappingDbPath, DATABASE_DIM_META_KEY, String(request.dim)));
        }
        if (request.dtype !== undefined) {
            writes.push(this.writeMetaValue(mappingDbPath, DATABASE_DTYPE_META_KEY, request.dtype));
        }
        if (request.syncMode !== undefined) {
            writes.push(this.writeMetaValue(mappingDbPath, DATABASE_SYNC_MODE_META_KEY, request.syncMode));
        }
        if (request.storageMode !== undefined) {
            writes.push(this.writeMetaValue(mappingDbPath, DATABASE_STORAGE_MODE_META_KEY, request.storageMode));
        }
        await Promise.all(writes);
    }

    private async readDatabaseConfigMeta(mappingDbPath: string): Promise<TriviumDatabaseConfigMeta> {
        const [dim, dtype, syncMode, storageMode] = await Promise.all([
            this.readMetaValue(mappingDbPath, DATABASE_DIM_META_KEY),
            this.readMetaValue(mappingDbPath, DATABASE_DTYPE_META_KEY),
            this.readMetaValue(mappingDbPath, DATABASE_SYNC_MODE_META_KEY),
            this.readMetaValue(mappingDbPath, DATABASE_STORAGE_MODE_META_KEY),
        ]);
        return {
            dim: parseOptionalPositiveInteger(dim),
            dtype: parseOptionalTriviumDType(dtype),
            syncMode: parseOptionalTriviumSyncMode(syncMode),
            storageMode: parseOptionalTriviumStorageMode(storageMode),
        };
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

function buildTriviumDatabaseRecord(
    filePath: string,
    entryName: string,
    meta: TriviumDatabaseConfigMeta,
): TriviumDatabaseRecord {
    const mainStats = fs.statSync(filePath);
    const walPath = `${filePath}.wal`;
    const vecPath = `${filePath}.vec`;
    const walStats = fs.existsSync(walPath) ? fs.statSync(walPath) : null;
    const vecStats = fs.existsSync(vecPath) ? fs.statSync(vecPath) : null;
    const timestamps = [mainStats, walStats, vecStats]
        .filter((value): value is fs.Stats => value !== null)
        .map(stats => stats.mtime.toISOString())
        .sort((left, right) => left.localeCompare(right));

    return {
        name: entryName.slice(0, -'.tdb'.length),
        fileName: entryName,
        dim: readTriviumDimension(filePath) ?? meta.dim,
        dtype: meta.dtype,
        syncMode: meta.syncMode,
        storageMode: meta.storageMode ?? (vecStats ? 'mmap' : 'rom'),
        sizeBytes: mainStats.size,
        walSizeBytes: walStats?.size ?? 0,
        vecSizeBytes: vecStats?.size ?? 0,
        totalSizeBytes: mainStats.size + (walStats?.size ?? 0) + (vecStats?.size ?? 0),
        updatedAt: timestamps.at(-1) ?? null,
    };
}

function readTriviumDimension(filePath: string): number | null {
    try {
        const handle = fs.openSync(filePath, 'r');
        try {
            const header = Buffer.alloc(10);
            const bytesRead = fs.readSync(handle, header, 0, 10, 0);
            if (bytesRead < 10 || header.toString('utf8', 0, 4) !== 'TVDB') {
                return null;
            }
            return header.readUInt32LE(6);
        } finally {
            fs.closeSync(handle);
        }
    } catch {
        return null;
    }
}

function getTriviumNamespace(value: unknown): string {
    return typeof value === 'string' && value.trim() ? value.trim() : 'default';
}

function getOptionalTriviumNamespace(value: unknown): string | null {
    return typeof value === 'string' && value.trim() ? value.trim() : null;
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

function getNonNegativeInteger(value: unknown): number {
    if (typeof value === 'number' && Number.isSafeInteger(value) && value >= 0) {
        return value;
    }
    if (typeof value === 'string' && value.trim()) {
        const parsed = Number(value);
        if (Number.isSafeInteger(parsed) && parsed >= 0) {
            return parsed;
        }
    }
    return 0;
}

function parseOptionalPositiveInteger(value: string | null): number | null {
    if (!value) {
        return null;
    }
    const parsed = Number(value);
    return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : null;
}

function parseOptionalTriviumDType(value: string | null): TriviumDType | null {
    return value === 'f32' || value === 'f16' || value === 'u64' ? value : null;
}

function parseOptionalTriviumSyncMode(value: string | null): TriviumSyncMode | null {
    return value === 'full' || value === 'normal' || value === 'off' ? value : null;
}

function parseOptionalTriviumStorageMode(value: string | null): TriviumStorageMode | null {
    return value === 'mmap' || value === 'rom' ? value : null;
}

function getBoundedPositiveInteger(value: unknown, defaultValue: number, maxValue: number, label: string): number {
    if (value == null) {
        return defaultValue;
    }
    if (typeof value === 'number' && Number.isSafeInteger(value) && value > 0) {
        return Math.min(value, maxValue);
    }
    throw new Error(`Trivium ${label} must be a positive safe integer`);
}

function buildEmptyCursorPage(page: CursorPageRequest): CursorPageInfo {
    const limit = Number.isInteger(page.limit) && Number(page.limit) > 0
        ? Math.min(Number(page.limit), MAX_CURSOR_PAGE_LIMIT)
        : DEFAULT_CURSOR_PAGE_LIMIT;
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

function readMappingRecord(row: Record<string, unknown>): TriviumMappingRecord {
    return {
        id: getRequiredNumericId(row.internalId, 'internalId'),
        externalId: getRequiredExternalId(row.externalId),
        namespace: getTriviumNamespace(row.namespace),
        createdAt: typeof row.createdAt === 'string' ? row.createdAt : '',
        updatedAt: typeof row.updatedAt === 'string' ? row.updatedAt : '',
    };
}

function readResolvedReference(row: Record<string, unknown>): TriviumResolvedNodeReference {
    return {
        id: getRequiredNumericId(row.internalId, 'internalId'),
        externalId: typeof row.externalId === 'string' ? row.externalId : null,
        namespace: typeof row.namespace === 'string' ? row.namespace : null,
    };
}

import fs from 'node:fs';
import type {
    TriviumDType,
    TriviumIndexHealth,
    TriviumListMappingsRequest,
    TriviumListMappingsResponse,
    TriviumMappingRecord,
    TriviumNodeReference,
    TriviumNodeView,
    TriviumResolvedNodeReference,
    TriviumSearchHit,
    TriviumStorageMode,
    TriviumSyncMode,
    TriviumTqlResponse,
    TriviumTqlRow,
} from '@stdo/shared-types';
import { asErrorMessage } from '../utils.js';
import { CoreService } from './core-service.js';
import {
    DATABASE_DIM_META_KEY,
    DATABASE_DTYPE_META_KEY,
    DATABASE_STORAGE_MODE_META_KEY,
    DATABASE_SYNC_MODE_META_KEY,
    DEFAULT_CURSOR_PAGE_LIMIT,
    EXTERNAL_IDS_TABLE,
    LAST_COMPACTION_META_KEY,
    LAST_CONTENT_MUTATION_META_KEY,
    LAST_INDEX_LIFECYCLE_EVENT_META_KEY,
    LAST_TEXT_INDEX_REBUILD_META_KEY,
    LAST_TEXT_INDEX_WRITE_META_KEY,
    MAX_CURSOR_PAGE_LIMIT,
    META_TABLE,
    PROPERTY_INDEXES_TABLE,
    buildEmptyCursorPage,
    getNonNegativeInteger,
    getOptionalPayloadExternalId,
    getOptionalPayloadNamespace,
    getOptionalTriviumNamespace,
    getReferenceExternalId,
    getRequiredExternalId,
    getRequiredNumericId,
    getTriviumNamespace,
    parseOptionalPositiveInteger,
    parseOptionalTriviumDType,
    parseOptionalTriviumStorageMode,
    parseOptionalTriviumSyncMode,
    readMappingRecord,
    readResolvedReference,
    type MappingIntegrityAnalysis,
    type ResolvedReference,
    type TriviumDatabaseConfigMeta,
    type TriviumIndexLifecycleMeta,
} from './trivium-internal.js';

export class TriviumMappingMetaStore {
    private readonly schemaReady = new Map<string, Promise<void>>();

    constructor(private readonly core: CoreService) {}

    async ensureSchema(mappingDbPath: string): Promise<void> {
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
                );
                CREATE TABLE IF NOT EXISTS ${PROPERTY_INDEXES_TABLE} (
                    field TEXT PRIMARY KEY,
                    source TEXT NOT NULL,
                    created_at TEXT NOT NULL,
                    updated_at TEXT NOT NULL,
                    last_used_at TEXT
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

    async resolveReference(mappingDbPath: string, reference: TriviumNodeReference, allowCreate: boolean): Promise<ResolvedReference> {
        const externalId = getReferenceExternalId(reference);
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

    async fetchMappingByExternal(mappingDbPath: string, externalId: string, namespace: string): Promise<TriviumResolvedNodeReference | null> {
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

    async resolveMappingsByInternalIds(mappingDbPath: string, ids: number[]): Promise<TriviumResolvedNodeReference[]> {
        const mappings = await this.fetchMappingsByInternalIds(mappingDbPath, ids);
        return ids.map(id => mappings.get(id) ?? { id, externalId: null, namespace: null });
    }

    async fetchMappingsByInternalIds(mappingDbPath: string, ids: number[]): Promise<Map<number, TriviumResolvedNodeReference>> {
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

    async countMappings(mappingDbPath: string): Promise<number> {
        if (!fs.existsSync(mappingDbPath)) {
            return 0;
        }
        const result = await this.core.querySql(mappingDbPath, {
            statement: `SELECT COUNT(*) AS count FROM ${EXTERNAL_IDS_TABLE}`,
        });
        return getNonNegativeInteger(result.rows[0]?.count);
    }

    async countOrphanMappings(dbPath: string, mappingDbPath: string, database: string): Promise<number> {
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

    async analyzeMappingsIntegrity(dbPath: string, mappingDbPath: string, database: string): Promise<MappingIntegrityAnalysis> {
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

    async deleteMappingsByInternalIds(mappingDbPath: string, ids: number[]): Promise<void> {
        const uniqueIds = [...new Set(ids.filter(value => Number.isSafeInteger(value) && value > 0))];
        if (uniqueIds.length === 0 || !fs.existsSync(mappingDbPath)) {
            return;
        }
        await this.core.execSql(mappingDbPath, {
            statement: `DELETE FROM ${EXTERNAL_IDS_TABLE} WHERE internal_id IN (${uniqueIds.map((_, index) => `?${index + 1}`).join(', ')})`,
            params: uniqueIds,
        });
    }

    async reconcileMappingsAfterTqlMutation(
        dbPath: string,
        mappingDbPath: string,
        database: string,
        createdIds: number[],
    ): Promise<void> {
        await this.ensureSchema(mappingDbPath);
        const uniqueCreatedIds = [...new Set(createdIds.filter(value => Number.isSafeInteger(value) && value > 0))];
        if (uniqueCreatedIds.length > 0) {
            const existingById = await this.fetchMappingsByInternalIds(mappingDbPath, uniqueCreatedIds);
            for (const id of uniqueCreatedIds) {
                const node = await this.core.getTrivium(dbPath, { database, id });
                const externalId = getOptionalPayloadExternalId(node?.payload);
                if (!externalId) {
                    continue;
                }
                const namespace = getTriviumNamespace(getOptionalPayloadNamespace(node?.payload));
                const mappedByExternal = await this.fetchMappingByExternal(mappingDbPath, externalId, namespace);
                if (mappedByExternal && mappedByExternal.id !== id) {
                    continue;
                }
                const mappedById = existingById.get(id) ?? null;
                if (mappedById?.externalId === externalId && mappedById.namespace === namespace) {
                    continue;
                }
                if (mappedById) {
                    await this.deleteMappingsByInternalIds(mappingDbPath, [id]);
                }
                await this.insertMappingWithId(mappingDbPath, id, externalId, namespace);
            }
        }

        const analysis = await this.analyzeMappingsIntegrity(dbPath, mappingDbPath, database);
        if (analysis.orphanMappings.length > 0) {
            await this.deleteMappingsByInternalIds(mappingDbPath, analysis.orphanMappings.map(item => item.id));
        }
    }

    async upsertPropertyIndexMetadata(mappingDbPath: string, field: string, source: 'manual' | 'system'): Promise<void> {
        await this.ensureSchema(mappingDbPath);
        const timestamp = new Date().toISOString();
        await this.core.execSql(mappingDbPath, {
            statement: `INSERT INTO ${PROPERTY_INDEXES_TABLE} (field, source, created_at, updated_at, last_used_at) VALUES (?1, ?2, ?3, ?4, NULL)
                ON CONFLICT(field) DO UPDATE SET source = excluded.source, updated_at = excluded.updated_at`,
            params: [field, source, timestamp, timestamp],
        });
    }

    async deletePropertyIndexMetadata(mappingDbPath: string, field: string): Promise<void> {
        if (!fs.existsSync(mappingDbPath)) {
            return;
        }
        await this.core.execSql(mappingDbPath, {
            statement: `DELETE FROM ${PROPERTY_INDEXES_TABLE} WHERE field = ?1`,
            params: [field],
        });
    }

    async listMappingsPage(mappingDbPath: string, request: TriviumListMappingsRequest = {}): Promise<TriviumListMappingsResponse> {
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

    async readMetaValue(mappingDbPath: string, key: string): Promise<string | null> {
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

    async writeMetaValue(mappingDbPath: string, key: string, value: string): Promise<void> {
        const timestamp = new Date().toISOString();
        await this.core.execSql(mappingDbPath, {
            statement: `INSERT INTO ${META_TABLE} (key, value, updated_at) VALUES (?1, ?2, ?3)
                ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`,
            params: [key, value, timestamp],
        });
    }

    async rememberDatabaseConfig(
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

    async readDatabaseConfigMeta(mappingDbPath: string): Promise<TriviumDatabaseConfigMeta> {
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

    async readIndexHealth(mappingDbPath: string, exists: boolean): Promise<TriviumIndexHealth | null> {
        if (!exists) {
            return null;
        }

        const lifecycle = await this.readIndexLifecycleMeta(mappingDbPath);
        const requiresRebuild = lifecycle.lastContentMutationAt != null
            && (lifecycle.lastTextRebuildAt == null || lifecycle.lastContentMutationAt > lifecycle.lastTextRebuildAt);
        const hasIndexSignal = lifecycle.lastTextRebuildAt != null || lifecycle.lastTextWriteAt != null;

        if (requiresRebuild) {
            return {
                status: 'stale',
                reason: lifecycle.lastTextRebuildAt
                    ? 'Trivium payload 数据在最近一次全文索引重建之后发生了变化'
                    : 'Trivium 已发生内容变更，但尚未执行全文索引重建',
                requiresRebuild: true,
                staleSince: lifecycle.lastContentMutationAt,
                lastContentMutationAt: lifecycle.lastContentMutationAt,
                lastTextWriteAt: lifecycle.lastTextWriteAt,
                lastTextRebuildAt: lifecycle.lastTextRebuildAt,
                lastCompactionAt: lifecycle.lastCompactionAt,
            };
        }

        if (hasIndexSignal) {
            return {
                status: 'fresh',
                reason: null,
                requiresRebuild: false,
                staleSince: null,
                lastContentMutationAt: lifecycle.lastContentMutationAt,
                lastTextWriteAt: lifecycle.lastTextWriteAt,
                lastTextRebuildAt: lifecycle.lastTextRebuildAt,
                lastCompactionAt: lifecycle.lastCompactionAt,
            };
        }

        return {
            status: 'missing',
            reason: 'Trivium 尚未建立全文索引',
            requiresRebuild: false,
            staleSince: null,
            lastContentMutationAt: lifecycle.lastContentMutationAt,
            lastTextWriteAt: lifecycle.lastTextWriteAt,
            lastTextRebuildAt: lifecycle.lastTextRebuildAt,
            lastCompactionAt: lifecycle.lastCompactionAt,
        };
    }

    async markContentMutation(mappingDbPath: string): Promise<void> {
        await this.writeMetaTimestamp(mappingDbPath, LAST_CONTENT_MUTATION_META_KEY);
    }

    async markTextIndexWrite(mappingDbPath: string): Promise<void> {
        await this.writeMetaTimestamp(mappingDbPath, LAST_TEXT_INDEX_WRITE_META_KEY);
    }

    async markTextIndexRebuild(mappingDbPath: string): Promise<void> {
        await this.writeMetaTimestamp(mappingDbPath, LAST_TEXT_INDEX_REBUILD_META_KEY);
    }

    async markCompaction(mappingDbPath: string): Promise<void> {
        await this.writeMetaTimestamp(mappingDbPath, LAST_COMPACTION_META_KEY);
    }

    async enrichSearchHits(mappingDbPath: string, hits: TriviumSearchHit[]): Promise<TriviumSearchHit[]> {
        const mappings = await this.fetchMappingsByInternalIds(mappingDbPath, hits.map(hit => hit.id));
        return hits.map(hit => ({
            ...hit,
            externalId: mappings.get(hit.id)?.externalId ?? null,
            namespace: mappings.get(hit.id)?.namespace ?? null,
        }));
    }

    async enrichNodes(mappingDbPath: string, nodes: TriviumNodeView[]): Promise<TriviumNodeView[]> {
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

    async enrichRows(mappingDbPath: string, rows: TriviumTqlRow[]): Promise<TriviumTqlRow[]> {
        const ids = rows.flatMap(row => Object.values(row).flatMap(node => [node.id, ...node.edges.map(edge => edge.targetId)]));
        const mappings = await this.fetchMappingsByInternalIds(mappingDbPath, ids);
        return rows.map(row => Object.fromEntries((Object.entries(row) as Array<[string, TriviumNodeView]>).map(([key, node]) => [key, {
            ...node,
            externalId: mappings.get(node.id)?.externalId ?? null,
            namespace: mappings.get(node.id)?.namespace ?? null,
            edges: node.edges.map(edge => ({
                ...edge,
                targetExternalId: mappings.get(edge.targetId)?.externalId ?? null,
                targetNamespace: mappings.get(edge.targetId)?.namespace ?? null,
            })),
        }])) as TriviumTqlRow);
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
            const response: TriviumTqlResponse = await this.core.tqlTriviumPage(dbPath, {
                database,
                query: 'MATCH (n) RETURN n',
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

    private async readIndexLifecycleMeta(mappingDbPath: string): Promise<TriviumIndexLifecycleMeta> {
        const [lastContentMutationAt, lastTextWriteAt, lastTextRebuildAt, lastCompactionAt] = await Promise.all([
            this.readMetaValue(mappingDbPath, LAST_CONTENT_MUTATION_META_KEY),
            this.readMetaValue(mappingDbPath, LAST_TEXT_INDEX_WRITE_META_KEY),
            this.readMetaValue(mappingDbPath, LAST_TEXT_INDEX_REBUILD_META_KEY),
            this.readMetaValue(mappingDbPath, LAST_COMPACTION_META_KEY),
        ]);
        return {
            lastContentMutationAt,
            lastTextWriteAt,
            lastTextRebuildAt,
            lastCompactionAt,
        };
    }

    private async writeMetaTimestamp(mappingDbPath: string, key: string): Promise<void> {
        await this.ensureSchema(mappingDbPath);
        const timestamp = await this.nextLifecycleTimestamp(mappingDbPath);
        await Promise.all([
            this.writeMetaValue(mappingDbPath, key, timestamp),
            this.writeMetaValue(mappingDbPath, LAST_INDEX_LIFECYCLE_EVENT_META_KEY, timestamp),
        ]);
    }

    private async nextLifecycleTimestamp(mappingDbPath: string): Promise<string> {
        const current = new Date();
        const last = await this.readMetaValue(mappingDbPath, LAST_INDEX_LIFECYCLE_EVENT_META_KEY);
        const lastMs = last ? Date.parse(last) : Number.NaN;
        if (Number.isFinite(lastMs) && current.getTime() <= lastMs) {
            return new Date(lastMs + 1).toISOString();
        }
        return current.toISOString();
    }
}

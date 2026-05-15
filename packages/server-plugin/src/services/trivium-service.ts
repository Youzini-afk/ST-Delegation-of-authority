import fs from 'node:fs';
import type {
    ControlTriviumBulkDeleteRequest,
    ControlTriviumBulkLinkRequest,
    ControlTriviumBulkUnlinkRequest,
    ControlTriviumBulkUpsertResponse,
    TriviumBulkDeleteRequest,
    TriviumBulkFailure,
    TriviumBulkLinkRequest,
    TriviumBulkMutationResponse,
    TriviumBulkUnlinkRequest,
    TriviumBulkUpsertRequest,
    TriviumBulkUpsertResponse,
    BmeVectorManifestRequest,
    BmeVectorManifestResponse,
    TriviumBuildTextIndexRequest,
    TriviumCheckMappingsIntegrityRequest,
    TriviumCheckMappingsIntegrityResponse,
    TriviumCompactRequest,
    TriviumCreateIndexRequest,
    TriviumDeleteRequest,
    TriviumDeleteOrphanMappingsRequest,
    TriviumDeleteOrphanMappingsResponse,
    TriviumDType,
    TriviumDatabaseRecord,
    TriviumDropIndexRequest,
    TriviumFlushRequest,
    TriviumGetRequest,
    TriviumIndexHealth,
    TriviumIndexKeywordRequest,
    TriviumIndexTextRequest,
    TriviumInsertRequest,
    TriviumInsertResponse,
    TriviumInsertWithIdRequest,
    TriviumListDatabasesResponse,
    TriviumListMappingsRequest,
    TriviumListMappingsResponse,
    TriviumMappingIntegrityIssue,
    TriviumNeighborsRequest,
    TriviumNeighborsResponse,
    TriviumNodeReference,
    TriviumNodeView,
    TriviumResolveIdRequest,
    TriviumResolveIdResponse,
    TriviumResolveManyRequest,
    TriviumResolveManyResponse,
    TriviumResolvedNodeReference,
    TriviumSearchAdvancedRequest,
    TriviumSearchHit,
    TriviumSearchHybridRequest,
    TriviumSearchHybridWithContextRequest,
    TriviumSearchHybridWithContextResponse,
    TriviumSearchRequest,
    TriviumStatRequest,
    TriviumStatResponse,
    TriviumStorageMode,
    TriviumSyncMode,
    TriviumTqlMutRequest,
    TriviumTqlMutResponse,
    TriviumTqlRequest,
    TriviumTqlResponse,
    TriviumTqlRow,
    TriviumUpsertRequest,
    TriviumUpsertResponse,
    TriviumUpdatePayloadRequest,
    TriviumUpdateVectorRequest,
} from '@stdo/shared-types';
import type { UserContext } from '../types.js';
import { asErrorMessage } from '../utils.js';
import { CoreService } from './core-service.js';
import {
    DEFAULT_INTEGRITY_SAMPLE_LIMIT,
    DEFAULT_ORPHAN_DELETE_LIMIT,
    LAST_FLUSH_META_KEY,
    MAX_CURSOR_PAGE_LIMIT,
    buildTriviumDatabaseRecord,
    type IndexedCoreMutationItem,
    type IndexedCoreUpsertItem,
    type MappingIntegrityAnalysis,
    type ResolvedReference,
    type TriviumDatabaseConfigMeta,
    type TriviumPathSet,
    getBoundedPositiveInteger,
    getRequiredExternalId,
    getRequiredNumericId,
    getTriviumDatabaseName,
    getTriviumNamespace,
    readTriviumDimension,
} from './trivium-internal.js';
import { TriviumMappingMetaStore } from './trivium-mapping-meta-store.js';
import { TriviumRepository } from './trivium-repository.js';

const MAX_TRIVIUM_BULK_ITEMS = 2000;
type ResolvedTriviumOpenOptions = { dim: number; dtype?: TriviumDType };

export class TriviumService {
    private readonly repository: TriviumRepository;
    private readonly mappingStore: TriviumMappingMetaStore;

    constructor(core: CoreService) {
        this.repository = new TriviumRepository(core);
        this.mappingStore = new TriviumMappingMetaStore(core);
    }

    async listDatabases(user: UserContext, extensionId: string): Promise<TriviumListDatabasesResponse> {
        const databases = await Promise.all(this.repository.listDatabaseEntries(user, extensionId)
            .map(async entry => {
                const [meta, indexHealth] = await Promise.all([
                    this.readDatabaseConfigMeta(entry.mappingDbPath),
                    this.readIndexHealth(entry.mappingDbPath, true),
                ]);
                return buildTriviumDatabaseRecord(entry.dbPath, entry.entryName, meta, indexHealth);
            }));

        databases.sort((left: TriviumDatabaseRecord, right: TriviumDatabaseRecord) => (right.updatedAt ?? '').localeCompare(left.updatedAt ?? ''));
        return { databases };
    }

    async insert(user: UserContext, extensionId: string, request: TriviumInsertRequest): Promise<TriviumInsertResponse> {
        const database = getTriviumDatabaseName(request.database);
        const { dbPath, mappingDbPath } = this.resolvePaths(user, extensionId, database);
        await this.ensureSchema(mappingDbPath);
        const openOptions = await this.resolveVectorWriteOptions(dbPath, mappingDbPath, database, request, request.vector);
        this.validateVectorDimension(request.vector, openOptions.dim, `Trivium database ${database}`);
        const response = await this.repository.insert(dbPath, { ...request, database, ...openOptions });
        await this.rememberDatabaseConfig(mappingDbPath, { ...request, ...openOptions });
        await this.markContentMutation(mappingDbPath);
        return response;
    }

    async insertWithId(user: UserContext, extensionId: string, request: TriviumInsertWithIdRequest): Promise<void> {
        const database = getTriviumDatabaseName(request.database);
        const { dbPath, mappingDbPath } = this.resolvePaths(user, extensionId, database);
        await this.ensureSchema(mappingDbPath);
        const openOptions = await this.resolveVectorWriteOptions(dbPath, mappingDbPath, database, request, request.vector);
        this.validateVectorDimension(request.vector, openOptions.dim, `Trivium database ${database}`);
        await this.repository.insertWithId(dbPath, { ...request, database, ...openOptions });
        await this.rememberDatabaseConfig(mappingDbPath, { ...request, ...openOptions });
        await this.markContentMutation(mappingDbPath);
    }

    async updatePayload(user: UserContext, extensionId: string, request: TriviumUpdatePayloadRequest): Promise<void> {
        const database = getTriviumDatabaseName(request.database);
        const { dbPath, mappingDbPath } = this.resolvePaths(user, extensionId, database);
        const openOptions = await this.resolveKnownDatabaseOptions(dbPath, mappingDbPath, database, request);
        await this.repository.updatePayload(dbPath, { ...request, database, ...openOptions });
        await this.markContentMutation(mappingDbPath);
    }

    async updateVector(user: UserContext, extensionId: string, request: TriviumUpdateVectorRequest): Promise<void> {
        const database = getTriviumDatabaseName(request.database);
        const { dbPath, mappingDbPath } = this.resolvePaths(user, extensionId, database);
        const openOptions = await this.resolveVectorWriteOptions(dbPath, mappingDbPath, database, request, request.vector);
        this.validateVectorDimension(request.vector, openOptions.dim, `Trivium database ${database}`);
        await this.repository.updateVector(dbPath, { ...request, database, ...openOptions });
        await this.rememberDatabaseConfig(mappingDbPath, { ...request, ...openOptions });
        await this.markContentMutation(mappingDbPath);
    }

    async indexText(user: UserContext, extensionId: string, request: TriviumIndexTextRequest): Promise<void> {
        const database = getTriviumDatabaseName(request.database);
        const { dbPath, mappingDbPath } = this.resolvePaths(user, extensionId, database);
        const openOptions = await this.resolveKnownDatabaseOptions(dbPath, mappingDbPath, database, request);
        await this.repository.indexText(dbPath, { ...request, database, ...openOptions });
        await this.markTextIndexWrite(mappingDbPath);
    }

    async indexKeyword(user: UserContext, extensionId: string, request: TriviumIndexKeywordRequest): Promise<void> {
        const database = getTriviumDatabaseName(request.database);
        const { dbPath, mappingDbPath } = this.resolvePaths(user, extensionId, database);
        const openOptions = await this.resolveKnownDatabaseOptions(dbPath, mappingDbPath, database, request);
        await this.repository.indexKeyword(dbPath, { ...request, database, ...openOptions });
        await this.markTextIndexWrite(mappingDbPath);
    }

    async buildTextIndex(user: UserContext, extensionId: string, request: TriviumBuildTextIndexRequest = {}): Promise<void> {
        const database = getTriviumDatabaseName(request.database);
        const { dbPath, mappingDbPath } = this.resolvePaths(user, extensionId, database);
        const openOptions = await this.resolveKnownDatabaseOptions(dbPath, mappingDbPath, database, request);
        await this.repository.buildTextIndex(dbPath, { ...request, database, ...openOptions });
        await this.markTextIndexRebuild(mappingDbPath);
    }

    async compact(user: UserContext, extensionId: string, request: TriviumCompactRequest = {}): Promise<void> {
        const database = getTriviumDatabaseName(request.database);
        const { dbPath, mappingDbPath } = this.resolvePaths(user, extensionId, database);
        const openOptions = await this.resolveKnownDatabaseOptions(dbPath, mappingDbPath, database, request);
        await this.repository.compact(dbPath, { ...request, database, ...openOptions });
        await this.markCompaction(mappingDbPath);
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
        if (request.items.length > MAX_TRIVIUM_BULK_ITEMS) {
            throw new Error(`Trivium bulk-upsert supports at most ${MAX_TRIVIUM_BULK_ITEMS} items per request`);
        }
        if (request.items.length === 0) {
            return {
                totalCount: 0,
                successCount: 0,
                failureCount: 0,
                failures: [],
                items: [],
            };
        }
        await this.ensureSchema(mappingDbPath);
        const openResolution = await this.resolveBulkUpsertOpenOptions(dbPath, mappingDbPath, database, request);
        if ('error' in openResolution) {
            return {
                totalCount: request.items.length,
                successCount: 0,
                failureCount: request.items.length,
                failures: request.items.map((_item, index) => ({ index, message: openResolution.error })),
                items: [],
            };
        }
        const openOptions = openResolution;

        const failures: TriviumBulkFailure[] = [];
        const prepared: IndexedCoreUpsertItem[] = [];

        for (const [index, item] of request.items.entries()) {
            try {
                this.validateVectorDimension(item.vector, openOptions.dim, `Trivium database ${database}`, index);
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
            let coreResponse: ControlTriviumBulkUpsertResponse;
            try {
                coreResponse = await this.repository.bulkUpsert(dbPath, {
                    ...request,
                    database,
                    ...openOptions,
                    items: prepared.map(item => item.request),
                });
            } catch (error) {
                const cleanupIds = prepared
                    .filter(item => item.mapping.createdMapping)
                    .map(item => item.mapping.id);
                if (cleanupIds.length > 0) {
                    await this.deleteMappingsByInternalIds(mappingDbPath, cleanupIds);
                }
                throw error;
            }
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
                .map((item: ControlTriviumBulkUpsertResponse['items'][number]) => {
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
                .sort((left: TriviumBulkUpsertResponse['items'][number], right: TriviumBulkUpsertResponse['items'][number]) => left.index - right.index);
            if (successItems.length > 0) {
                await this.rememberDatabaseConfig(mappingDbPath, { ...request, ...openOptions });
                await this.markContentMutation(mappingDbPath);
            }
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
        const openOptions = await this.resolveKnownDatabaseOptions(dbPath, mappingDbPath, database, request);
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

        return await this.runBulkMutation(prepared, failures, request.items.length, items => this.repository.bulkLink(dbPath, {
            ...request,
            database,
            ...openOptions,
            items,
        }));
    }

    async bulkUnlink(user: UserContext, extensionId: string, request: TriviumBulkUnlinkRequest): Promise<TriviumBulkMutationResponse> {
        const database = getTriviumDatabaseName(request.database);
        const { dbPath, mappingDbPath } = this.resolvePaths(user, extensionId, database);
        const openOptions = await this.resolveKnownDatabaseOptions(dbPath, mappingDbPath, database, request);
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

        return await this.runBulkMutation(prepared, failures, request.items.length, items => this.repository.bulkUnlink(dbPath, {
            ...request,
            database,
            ...openOptions,
            items,
        }));
    }

    async bulkDelete(user: UserContext, extensionId: string, request: TriviumBulkDeleteRequest): Promise<TriviumBulkMutationResponse> {
        const database = getTriviumDatabaseName(request.database);
        const { dbPath, mappingDbPath } = this.resolvePaths(user, extensionId, database);
        const openOptions = await this.resolveKnownDatabaseOptions(dbPath, mappingDbPath, database, request);
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

        const response = await this.runBulkMutation(prepared, failures, request.items.length, items => this.repository.bulkDelete(dbPath, {
            ...request,
            database,
            ...openOptions,
            items,
        }));
        const failedOriginalIndexes = new Set(response.failures.map(item => item.index));
        const deletedIds = prepared
            .filter(item => !failedOriginalIndexes.has(item.originalIndex))
            .map(item => item.id);
        if (deletedIds.length > 0) {
            await this.deleteMappingsByInternalIds(mappingDbPath, deletedIds);
            await this.markContentMutation(mappingDbPath);
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
        const openOptions = await this.resolveKnownDatabaseOptions(dbPath, mappingDbPath, database, request);
        const node = await this.repository.get(dbPath, { ...request, database, ...openOptions });
        if (!node) {
            return null;
        }
        const [enriched] = await this.enrichNodes(mappingDbPath, [node]);
        return enriched ?? node;
    }

    async neighbors(user: UserContext, extensionId: string, request: TriviumNeighborsRequest): Promise<TriviumNeighborsResponse> {
        const database = getTriviumDatabaseName(request.database);
        const { dbPath, mappingDbPath } = this.resolvePaths(user, extensionId, database);
        const openOptions = await this.resolveKnownDatabaseOptions(dbPath, mappingDbPath, database, request);
        const response = await this.repository.neighbors(dbPath, { ...request, database, ...openOptions });
        return {
            ...response,
            nodes: await this.resolveMappingsByInternalIds(mappingDbPath, response.ids),
        };
    }

    async search(user: UserContext, extensionId: string, request: TriviumSearchRequest): Promise<TriviumSearchHit[]> {
        const database = getTriviumDatabaseName(request.database);
        const { dbPath, mappingDbPath } = this.resolvePaths(user, extensionId, database);
        const openOptions = await this.resolveVectorWriteOptions(dbPath, mappingDbPath, database, request, request.vector);
        this.validateVectorDimension(request.vector, openOptions.dim, `Trivium database ${database}`);
        return await this.enrichSearchHits(mappingDbPath, await this.repository.search(dbPath, { ...request, database, ...openOptions }));
    }

    async searchAdvanced(user: UserContext, extensionId: string, request: TriviumSearchAdvancedRequest): Promise<TriviumSearchHit[]> {
        const database = getTriviumDatabaseName(request.database);
        const { dbPath, mappingDbPath } = this.resolvePaths(user, extensionId, database);
        const openOptions = await this.resolveVectorWriteOptions(dbPath, mappingDbPath, database, request, request.vector);
        this.validateVectorDimension(request.vector, openOptions.dim, `Trivium database ${database}`);
        return await this.enrichSearchHits(mappingDbPath, await this.repository.searchAdvanced(dbPath, { ...request, database, ...openOptions }));
    }

    async searchHybrid(user: UserContext, extensionId: string, request: TriviumSearchHybridRequest): Promise<TriviumSearchHit[]> {
        const database = getTriviumDatabaseName(request.database);
        const { dbPath, mappingDbPath } = this.resolvePaths(user, extensionId, database);
        const openOptions = await this.resolveVectorWriteOptions(dbPath, mappingDbPath, database, request, request.vector);
        this.validateVectorDimension(request.vector, openOptions.dim, `Trivium database ${database}`);
        return await this.enrichSearchHits(mappingDbPath, await this.repository.searchHybrid(dbPath, { ...request, database, ...openOptions }));
    }

    async searchHybridWithContext(
        user: UserContext,
        extensionId: string,
        request: TriviumSearchHybridWithContextRequest,
    ): Promise<TriviumSearchHybridWithContextResponse> {
        const database = getTriviumDatabaseName(request.database);
        const { dbPath, mappingDbPath } = this.resolvePaths(user, extensionId, database);
        const openOptions = await this.resolveVectorWriteOptions(dbPath, mappingDbPath, database, request, request.vector);
        this.validateVectorDimension(request.vector, openOptions.dim, `Trivium database ${database}`);
        const response = await this.repository.searchHybridWithContext(dbPath, { ...request, database, ...openOptions });
        return {
            ...response,
            hits: await this.enrichSearchHits(mappingDbPath, response.hits),
        };
    }

    async tql(user: UserContext, extensionId: string, request: TriviumTqlRequest): Promise<TriviumTqlRow[]> {
        const response = await this.tqlPage(user, extensionId, request);
        return response.rows;
    }

    async tqlPage(user: UserContext, extensionId: string, request: TriviumTqlRequest): Promise<TriviumTqlResponse> {
        const database = getTriviumDatabaseName(request.database);
        const { dbPath, mappingDbPath } = this.resolvePaths(user, extensionId, database);
        const openOptions = await this.resolveKnownDatabaseOptions(dbPath, mappingDbPath, database, request);
        const response = await this.repository.tqlPage(dbPath, { ...request, database, ...openOptions });
        return {
            ...response,
            rows: await this.enrichRows(mappingDbPath, response.rows),
        };
    }

    async tqlMut(user: UserContext, extensionId: string, request: TriviumTqlMutRequest): Promise<TriviumTqlMutResponse> {
        const database = getTriviumDatabaseName(request.database);
        const { dbPath, mappingDbPath } = this.resolvePaths(user, extensionId, database);
        const openOptions = await this.resolveKnownDatabaseOptions(dbPath, mappingDbPath, database, request);
        const response = await this.repository.tqlMut(dbPath, { ...request, database, ...openOptions });
        if (response.affected > 0 || response.createdIds.length > 0) {
            await this.rememberDatabaseConfig(mappingDbPath, { ...request, ...openOptions });
            await this.markContentMutation(mappingDbPath);
            await this.reconcileMappingsAfterTqlMutation(dbPath, mappingDbPath, database, response.createdIds);
        }
        return response;
    }

    async createIndex(user: UserContext, extensionId: string, request: TriviumCreateIndexRequest): Promise<void> {
        const database = getTriviumDatabaseName(request.database);
        const { dbPath, mappingDbPath } = this.resolvePaths(user, extensionId, database);
        const openOptions = await this.resolveKnownDatabaseOptions(dbPath, mappingDbPath, database, request);
        await this.repository.createIndex(dbPath, { ...request, database, ...openOptions });
        await this.upsertPropertyIndexMetadata(mappingDbPath, request.field, 'manual');
    }

    async dropIndex(user: UserContext, extensionId: string, request: TriviumDropIndexRequest): Promise<void> {
        const database = getTriviumDatabaseName(request.database);
        const { dbPath, mappingDbPath } = this.resolvePaths(user, extensionId, database);
        const openOptions = await this.resolveKnownDatabaseOptions(dbPath, mappingDbPath, database, request);
        await this.repository.dropIndex(dbPath, { ...request, database, ...openOptions });
        await this.deletePropertyIndexMetadata(mappingDbPath, request.field);
    }

    async flush(user: UserContext, extensionId: string, request: TriviumFlushRequest = {}): Promise<void> {
        const database = getTriviumDatabaseName(request.database);
        const { dbPath, mappingDbPath } = this.resolvePaths(user, extensionId, database);
        const openOptions = await this.resolveKnownDatabaseOptions(dbPath, mappingDbPath, database, request);
        await this.repository.flush(dbPath, { ...request, database, ...openOptions });
        await this.ensureSchema(mappingDbPath);
        if (fs.existsSync(dbPath)) {
            await this.rememberDatabaseConfig(mappingDbPath, { ...request, ...openOptions });
        }
        await this.writeMetaValue(mappingDbPath, LAST_FLUSH_META_KEY, new Date().toISOString());
    }

    async stat(user: UserContext, extensionId: string, request: TriviumStatRequest = {}): Promise<TriviumStatResponse> {
        const database = getTriviumDatabaseName(request.database);
        const { dbPath, mappingDbPath } = this.resolvePaths(user, extensionId, database);
        if (fs.existsSync(dbPath)) {
            const openOptions = await this.resolveKnownDatabaseOptions(dbPath, mappingDbPath, database, request);
            const stat = await this.repository.stat(dbPath, { ...request, database, ...openOptions });
            const lastFlushAt = await this.readMetaValue(mappingDbPath, LAST_FLUSH_META_KEY);
            const mappingCount = await this.countMappings(mappingDbPath);
            const indexHealth = await this.readIndexHealth(mappingDbPath, stat.exists);
            const orphanMappingCount = request.includeMappingIntegrity
                ? await this.countOrphanMappings(dbPath, mappingDbPath, database)
                : null;
            return {
                ...stat,
                lastFlushAt,
                mappingCount,
                orphanMappingCount,
                indexHealth,
            };
        }
        const stat = await this.repository.stat(dbPath, { ...request, database });
        const lastFlushAt = await this.readMetaValue(mappingDbPath, LAST_FLUSH_META_KEY);
        const mappingCount = await this.countMappings(mappingDbPath);
        const indexHealth = await this.readIndexHealth(mappingDbPath, stat.exists);
        const orphanMappingCount = request.includeMappingIntegrity
            ? await this.countOrphanMappings(dbPath, mappingDbPath, database)
            : null;
        return {
            ...stat,
            lastFlushAt,
            mappingCount,
            orphanMappingCount,
            indexHealth,
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
        return await this.mappingStore.listMappingsPage(mappingDbPath, request);
    }

    async getBmeVectorManifest(
        user: UserContext,
        extensionId: string,
        request: BmeVectorManifestRequest = {},
    ): Promise<BmeVectorManifestResponse> {
        const database = getTriviumDatabaseName(request.database);
        const { dbPath, mappingDbPath } = this.resolvePaths(user, extensionId, database);
        const exists = fs.existsSync(dbPath);
        const meta = await this.readDatabaseConfigMeta(mappingDbPath);
        const fileDim = exists ? readTriviumDimension(dbPath) : null;
        const [mappingCount, lastFlushAt] = await Promise.all([
            this.countMappings(mappingDbPath),
            this.readMetaValue(mappingDbPath, LAST_FLUSH_META_KEY),
        ]);
        let nodeCount: number | null = null;
        let updatedAt: string | null = null;
        if (exists) {
            const stat = await this.stat(user, extensionId, { database });
            nodeCount = Number.isFinite(Number(stat.nodeCount)) ? Number(stat.nodeCount) : null;
            updatedAt = stat.updatedAt ?? null;
        }
        return {
            database,
            exists,
            status: exists ? 'unknown' : 'missing',
            embeddingMode: 'client',
            serverEmbeddingSupported: false,
            vectorApplySupported: false,
            vectorManifestSupported: true,
            vectorDim: fileDim ?? meta.dim,
            dtype: meta.dtype,
            storageMode: meta.storageMode,
            syncMode: meta.syncMode,
            mappingCount,
            nodeCount,
            lastFlushAt,
            updatedAt,
        };
    }

    private async ensureSchema(mappingDbPath: string): Promise<void> {
        await this.mappingStore.ensureSchema(mappingDbPath);
    }

    private resolvePaths(user: UserContext, extensionId: string, database: string): TriviumPathSet {
        return this.repository.resolvePaths(user, extensionId, database);
    }

    private getMappingDbPath(user: UserContext, extensionId: string, database: string): string {
        return this.repository.getMappingDbPath(user, extensionId, database);
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
        return await this.mappingStore.resolveReference(mappingDbPath, reference, allowCreate);
    }

    private async fetchMappingByExternal(mappingDbPath: string, externalId: string, namespace: string): Promise<TriviumResolvedNodeReference | null> {
        return await this.mappingStore.fetchMappingByExternal(mappingDbPath, externalId, namespace);
    }

    private async resolveMappingsByInternalIds(mappingDbPath: string, ids: number[]): Promise<TriviumResolvedNodeReference[]> {
        return await this.mappingStore.resolveMappingsByInternalIds(mappingDbPath, ids);
    }

    private async fetchMappingsByInternalIds(mappingDbPath: string, ids: number[]): Promise<Map<number, TriviumResolvedNodeReference>> {
        return await this.mappingStore.fetchMappingsByInternalIds(mappingDbPath, ids);
    }

    private async countMappings(mappingDbPath: string): Promise<number> {
        return await this.mappingStore.countMappings(mappingDbPath);
    }

    private async countOrphanMappings(dbPath: string, mappingDbPath: string, database: string): Promise<number> {
        return await this.mappingStore.countOrphanMappings(dbPath, mappingDbPath, database);
    }

    private async analyzeMappingsIntegrity(dbPath: string, mappingDbPath: string, database: string): Promise<MappingIntegrityAnalysis> {
        return await this.mappingStore.analyzeMappingsIntegrity(dbPath, mappingDbPath, database);
    }

    private async deleteMappingsByInternalIds(mappingDbPath: string, ids: number[]): Promise<void> {
        await this.mappingStore.deleteMappingsByInternalIds(mappingDbPath, ids);
    }

    private async reconcileMappingsAfterTqlMutation(
        dbPath: string,
        mappingDbPath: string,
        database: string,
        createdIds: number[],
    ): Promise<void> {
        await this.mappingStore.reconcileMappingsAfterTqlMutation(dbPath, mappingDbPath, database, createdIds);
    }

    private async upsertPropertyIndexMetadata(mappingDbPath: string, field: string, source: 'manual' | 'system'): Promise<void> {
        await this.mappingStore.upsertPropertyIndexMetadata(mappingDbPath, field, source);
    }

    private async deletePropertyIndexMetadata(mappingDbPath: string, field: string): Promise<void> {
        await this.mappingStore.deletePropertyIndexMetadata(mappingDbPath, field);
    }

    private async readMetaValue(mappingDbPath: string, key: string): Promise<string | null> {
        return await this.mappingStore.readMetaValue(mappingDbPath, key);
    }

    private async writeMetaValue(mappingDbPath: string, key: string, value: string): Promise<void> {
        await this.mappingStore.writeMetaValue(mappingDbPath, key, value);
    }

    private async rememberDatabaseConfig(
        mappingDbPath: string,
        request: { dim?: number; dtype?: TriviumDType; syncMode?: TriviumSyncMode; storageMode?: TriviumStorageMode },
    ): Promise<void> {
        await this.mappingStore.rememberDatabaseConfig(mappingDbPath, request);
    }

    private async readDatabaseConfigMeta(mappingDbPath: string): Promise<TriviumDatabaseConfigMeta> {
        return await this.mappingStore.readDatabaseConfigMeta(mappingDbPath);
    }

    private async resolveBulkUpsertOpenOptions(
        dbPath: string,
        mappingDbPath: string,
        database: string,
        request: TriviumBulkUpsertRequest,
    ): Promise<ResolvedTriviumOpenOptions | { error: string }> {
        const inferredDim = request.items.find(item => Array.isArray(item.vector) && item.vector.length > 0)?.vector.length;
        try {
            return await this.resolveVectorWriteOptions(dbPath, mappingDbPath, database, request, inferredDim);
        } catch (error) {
            return { error: asErrorMessage(error) };
        }
    }

    private async resolveKnownDatabaseOptions(
        dbPath: string,
        mappingDbPath: string,
        database: string,
        request: { dim?: number; dtype?: TriviumDType },
    ): Promise<Partial<ResolvedTriviumOpenOptions>> {
        const meta = await this.readDatabaseConfigMeta(mappingDbPath);

        const dbExists = fs.existsSync(dbPath);
        this.validateDTypeCompatibility(meta.dtype, request.dtype, database, dbExists);

        const fileDim = dbExists ? readTriviumDimension(dbPath) : null;
        const explicitDim = request.dim;
        if (explicitDim !== undefined && (!Number.isSafeInteger(explicitDim) || explicitDim <= 0)) {
            throw new Error(`Trivium dim must be a positive safe integer, got ${explicitDim}`);
        }
        if (explicitDim !== undefined && fileDim !== null && explicitDim !== fileDim) {
            throw new Error(`Trivium database ${database} is ${fileDim}-dimensional; request dim is ${explicitDim}`);
        }

        return {
            ...(explicitDim !== undefined ? { dim: explicitDim } : fileDim !== null ? { dim: fileDim } : meta.dim !== null ? { dim: meta.dim } : {}),
            ...(request.dtype !== undefined ? { dtype: request.dtype } : meta.dtype !== null ? { dtype: meta.dtype } : {}),
        };
    }

    private async resolveVectorWriteOptions(
        dbPath: string,
        mappingDbPath: string,
        database: string,
        request: { dim?: number; dtype?: TriviumDType },
        vectorOrDim: number[] | number | undefined,
    ): Promise<ResolvedTriviumOpenOptions> {
        const openOptions = await this.resolveKnownDatabaseOptions(dbPath, mappingDbPath, database, request);
        if (openOptions.dim !== undefined) {
            return { ...openOptions, dim: openOptions.dim };
        }
        if (Array.isArray(vectorOrDim) && vectorOrDim.length > 0) {
            return { ...openOptions, dim: vectorOrDim.length };
        }
        if (typeof vectorOrDim === 'number' && Number.isSafeInteger(vectorOrDim) && vectorOrDim > 0) {
            return { ...openOptions, dim: vectorOrDim };
        }
        throw new Error(`Cannot infer Trivium dim for database ${database}; provide dim or at least one non-empty vector`);
    }

    private validateDTypeCompatibility(
        storedDType: TriviumDType | null,
        requestedDType: TriviumDType | undefined,
        database: string,
        dbExists: boolean,
    ): void {
        if (dbExists && storedDType !== null && requestedDType !== undefined && requestedDType !== storedDType) {
            throw new Error(`Trivium database ${database} uses dtype ${storedDType}; request dtype is ${requestedDType}`);
        }
    }

    private validateVectorDimension(vector: number[], expectedDim: number, context: string, index?: number): void {
        if (!Array.isArray(vector)) {
            throw new Error(index === undefined ? `${context} vector must be an array` : `Trivium bulk-upsert item ${index} vector must be an array`);
        }
        if (vector.length !== expectedDim) {
            throw new Error(index === undefined
                ? `${context} expects ${expectedDim}-dimensional vectors; vector has ${vector.length}`
                : `${context} expects ${expectedDim}-dimensional vectors; item ${index} has ${vector.length}`);
        }
    }

    private async readIndexHealth(mappingDbPath: string, exists: boolean): Promise<TriviumIndexHealth | null> {
        return await this.mappingStore.readIndexHealth(mappingDbPath, exists);
    }

    private async markContentMutation(mappingDbPath: string): Promise<void> {
        await this.mappingStore.markContentMutation(mappingDbPath);
    }

    private async markTextIndexWrite(mappingDbPath: string): Promise<void> {
        await this.mappingStore.markTextIndexWrite(mappingDbPath);
    }

    private async markTextIndexRebuild(mappingDbPath: string): Promise<void> {
        await this.mappingStore.markTextIndexRebuild(mappingDbPath);
    }

    private async markCompaction(mappingDbPath: string): Promise<void> {
        await this.mappingStore.markCompaction(mappingDbPath);
    }

    private async enrichSearchHits(mappingDbPath: string, hits: TriviumSearchHit[]): Promise<TriviumSearchHit[]> {
        return await this.mappingStore.enrichSearchHits(mappingDbPath, hits);
    }

    private async enrichNodes(mappingDbPath: string, nodes: TriviumNodeView[]): Promise<TriviumNodeView[]> {
        return await this.mappingStore.enrichNodes(mappingDbPath, nodes);
    }

    private async enrichRows(mappingDbPath: string, rows: TriviumTqlRow[]): Promise<TriviumTqlRow[]> {
        return await this.mappingStore.enrichRows(mappingDbPath, rows);
    }
}

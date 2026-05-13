import fs from 'node:fs';
import type {
    ControlTriviumBulkUpsertRequest,
    CursorPageInfo,
    CursorPageRequest,
    TriviumDType,
    TriviumDatabaseRecord,
    TriviumIndexHealth,
    TriviumMappingRecord,
    TriviumNodeReference,
    TriviumResolvedNodeReference,
    TriviumStorageMode,
    TriviumSyncMode,
} from '@stdo/shared-types';

export const EXTERNAL_IDS_TABLE = 'authority_trivium_external_ids';
export const META_TABLE = 'authority_trivium_meta';
export const PROPERTY_INDEXES_TABLE = 'authority_trivium_property_indexes';
export const LAST_FLUSH_META_KEY = 'last_flush_at';
export const DATABASE_DIM_META_KEY = 'database_dim';
export const DATABASE_DTYPE_META_KEY = 'database_dtype';
export const DATABASE_SYNC_MODE_META_KEY = 'database_sync_mode';
export const DATABASE_STORAGE_MODE_META_KEY = 'database_storage_mode';
export const LAST_CONTENT_MUTATION_META_KEY = 'last_content_mutation_at';
export const LAST_TEXT_INDEX_WRITE_META_KEY = 'last_text_index_write_at';
export const LAST_TEXT_INDEX_REBUILD_META_KEY = 'last_text_index_rebuild_at';
export const LAST_COMPACTION_META_KEY = 'last_compaction_at';
export const LAST_INDEX_LIFECYCLE_EVENT_META_KEY = 'last_index_lifecycle_event_at';
export const DEFAULT_CURSOR_PAGE_LIMIT = 50;
export const MAX_CURSOR_PAGE_LIMIT = 500;
export const DEFAULT_INTEGRITY_SAMPLE_LIMIT = 100;
export const DEFAULT_ORPHAN_DELETE_LIMIT = 100;

export interface TriviumPathSet {
    dbPath: string;
    mappingDbPath: string;
}

export interface TriviumDatabaseEntry extends TriviumPathSet {
    database: string;
    entryName: string;
}

export interface TriviumDatabaseConfigMeta {
    dim: number | null;
    dtype: TriviumDType | null;
    syncMode: TriviumSyncMode | null;
    storageMode: TriviumStorageMode | null;
}

export interface TriviumIndexLifecycleMeta {
    lastContentMutationAt: string | null;
    lastTextWriteAt: string | null;
    lastTextRebuildAt: string | null;
    lastCompactionAt: string | null;
}

export interface ResolvedReference extends TriviumResolvedNodeReference {
    createdMapping: boolean;
}

export interface IndexedCoreUpsertItem {
    originalIndex: number;
    mapping: ResolvedReference;
    request: ControlTriviumBulkUpsertRequest['items'][number];
}

export interface IndexedCoreMutationItem<T> {
    originalIndex: number;
    request: T;
}

export interface MappingIntegrityAnalysis {
    mappings: TriviumMappingRecord[];
    nodeIds: number[];
    orphanMappings: TriviumMappingRecord[];
    missingNodeIds: number[];
    duplicateInternalGroups: TriviumMappingRecord[][];
    duplicateExternalGroups: TriviumMappingRecord[][];
}

export function getTriviumDatabaseName(value: unknown): string {
    return typeof value === 'string' && value.trim() ? value.trim() : 'default';
}

export function buildTriviumDatabaseRecord(
    filePath: string,
    entryName: string,
    meta: TriviumDatabaseConfigMeta,
    indexHealth: TriviumIndexHealth | null,
): TriviumDatabaseRecord {
    const mainStats = fs.statSync(filePath);
    const walPath = `${filePath}.wal`;
    const vecPath = `${filePath}.vec`;
    const quiverPath = `${filePath}.quiver`;
    const walStats = fs.existsSync(walPath) ? fs.statSync(walPath) : null;
    const vecStats = fs.existsSync(vecPath) ? fs.statSync(vecPath) : null;
    const quiverStats = fs.existsSync(quiverPath) ? fs.statSync(quiverPath) : null;
    const timestamps = [mainStats, walStats, vecStats, quiverStats]
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
        quiverSizeBytes: quiverStats?.size ?? 0,
        totalSizeBytes: mainStats.size + (walStats?.size ?? 0) + (vecStats?.size ?? 0) + (quiverStats?.size ?? 0),
        updatedAt: timestamps.at(-1) ?? null,
        indexHealth,
    };
}

export function readTriviumDimension(filePath: string): number | null {
    try {
        const handle = fs.openSync(filePath, 'r');
        try {
            const header = Buffer.alloc(10);
            const bytesRead = fs.readSync(handle, header, 0, 10, 0);
            if (bytesRead < 10 || header.toString('utf8', 0, 4) !== 'TVDB') {
                return null;
            }
            const dim = header.readUInt32LE(6);
            return dim > 0 ? dim : null;
        } finally {
            fs.closeSync(handle);
        }
    } catch {
        return null;
    }
}

export function getTriviumNamespace(value: unknown): string {
    return typeof value === 'string' && value.trim() ? value.trim() : 'default';
}

export function getOptionalTriviumNamespace(value: unknown): string | null {
    return typeof value === 'string' && value.trim() ? value.trim() : null;
}

export function getRequiredExternalId(value: unknown): string {
    if (typeof value === 'string' && value.trim()) {
        return value.trim();
    }
    throw new Error('Trivium externalId must not be empty');
}

export function getOptionalPayloadExternalId(value: unknown): string | null {
    if (value && typeof value === 'object' && typeof (value as { externalId?: unknown }).externalId === 'string') {
        const externalId = (value as { externalId: string }).externalId.trim();
        return externalId ? externalId : null;
    }
    return null;
}

export function getOptionalPayloadNamespace(value: unknown): string | null {
    if (value && typeof value === 'object' && typeof (value as { namespace?: unknown }).namespace === 'string') {
        const namespace = (value as { namespace: string }).namespace.trim();
        return namespace ? namespace : null;
    }
    return null;
}

export function getRequiredNumericId(value: unknown, label = 'id'): number {
    if (typeof value === 'number' && Number.isSafeInteger(value) && value > 0) {
        return value;
    }
    throw new Error(`Trivium ${label} must be a positive safe integer`);
}

export function getNonNegativeInteger(value: unknown): number {
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

export function parseOptionalPositiveInteger(value: string | null): number | null {
    if (!value) {
        return null;
    }
    const parsed = Number(value);
    return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : null;
}

export function parseOptionalTriviumDType(value: string | null): TriviumDType | null {
    return value === 'f32' || value === 'f16' || value === 'u64' ? value : null;
}

export function parseOptionalTriviumSyncMode(value: string | null): TriviumSyncMode | null {
    return value === 'full' || value === 'normal' || value === 'off' ? value : null;
}

export function parseOptionalTriviumStorageMode(value: string | null): TriviumStorageMode | null {
    return value === 'mmap' || value === 'rom' ? value : null;
}

export function getBoundedPositiveInteger(value: unknown, defaultValue: number, maxValue: number, label: string): number {
    if (value == null) {
        return defaultValue;
    }
    if (typeof value === 'number' && Number.isSafeInteger(value) && value > 0) {
        return Math.min(value, maxValue);
    }
    throw new Error(`Trivium ${label} must be a positive safe integer`);
}

export function buildEmptyCursorPage(page: CursorPageRequest): CursorPageInfo {
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

export function readMappingRecord(row: Record<string, unknown>): TriviumMappingRecord {
    return {
        id: getRequiredNumericId(row.internalId, 'internalId'),
        externalId: getRequiredExternalId(row.externalId),
        namespace: getTriviumNamespace(row.namespace),
        createdAt: typeof row.createdAt === 'string' ? row.createdAt : '',
        updatedAt: typeof row.updatedAt === 'string' ? row.updatedAt : '',
    };
}

export function readResolvedReference(row: Record<string, unknown>): TriviumResolvedNodeReference {
    return {
        id: getRequiredNumericId(row.internalId, 'internalId'),
        externalId: typeof row.externalId === 'string' ? row.externalId : null,
        namespace: typeof row.namespace === 'string' ? row.namespace : null,
    };
}

export function getReferenceExternalId(reference: TriviumNodeReference): string | null {
    return reference.externalId?.trim() ? reference.externalId.trim() : null;
}

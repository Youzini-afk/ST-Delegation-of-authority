import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import type {
    CursorPageInfo,
    ControlTriviumBulkUpsertRequest,
    ControlTriviumBulkUpsertResponse,
    SqlExecResult,
    SqlMigrateResponse,
    SqlQueryResult,
    SqlValue,
    TriviumBulkMutationResponse,
    TriviumNodeView,
    TriviumSearchHit,
    TriviumStatResponse,
    TriviumTqlResponse,
} from '@stdo/shared-types';
import { TriviumService } from './trivium-service.js';
import type { CoreService } from './core-service.js';
import { getUserAuthorityPaths } from '../store/authority-paths.js';
import type { UserContext } from '../types.js';
import { sanitizeFileSegment } from '../utils.js';

type MappingRow = {
    id: number;
    namespace: string;
    externalId: string;
    createdAt: string;
    updatedAt: string;
};

type MockNode = TriviumNodeView;

describe('TriviumService', () => {
    const dirs: string[] = [];

    afterEach(() => {
        while (dirs.length > 0) {
            const dir = dirs.pop();
            if (dir) {
                fs.rmSync(dir, { recursive: true, force: true });
            }
        }
    });

    it('persists externalId mappings and enriches nodes, edges, and hits', async () => {
        const user = createUser(dirs);
        const trivium = new TriviumService(createMockCore());

        const upserted = await trivium.bulkUpsert(user, 'third-party/ext-a', {
            database: 'graph',
            items: [
                { externalId: 'alpha', vector: [1, 0], payload: { name: 'alpha' } },
                { externalId: 'beta', vector: [0, 1], payload: { name: 'beta' } },
            ],
        });
        expect(upserted.successCount).toBe(2);
        expect(upserted.items.map(item => item.id)).toEqual([1, 2]);
        expect(upserted.items.map(item => item.externalId)).toEqual(['alpha', 'beta']);

        const linked = await trivium.bulkLink(user, 'third-party/ext-a', {
            database: 'graph',
            items: [{ src: { externalId: 'alpha' }, dst: { externalId: 'beta' }, label: 'related' }],
        });
        expect(linked.successCount).toBe(1);

        const node = await trivium.get(user, 'third-party/ext-a', {
            database: 'graph',
            id: 1,
        });
        expect(node?.externalId).toBe('alpha');
        expect(node?.edges[0]?.targetExternalId).toBe('beta');

        const hits = await trivium.search(user, 'third-party/ext-a', {
            database: 'graph',
            vector: [1, 0],
        });
        expect(hits.map(hit => hit.externalId)).toEqual(['alpha', 'beta']);

        const neighbors = await trivium.neighbors(user, 'third-party/ext-a', {
            database: 'graph',
            id: 1,
        });
        expect(neighbors.nodes?.map(item => item.externalId)).toEqual(['beta']);
    });

    it('removes externalId mappings when mapped nodes are bulk deleted', async () => {
        const user = createUser(dirs);
        const trivium = new TriviumService(createMockCore());

        await trivium.bulkUpsert(user, 'third-party/ext-a', {
            database: 'graph',
            items: [{ externalId: 'alpha', vector: [1, 0], payload: { name: 'alpha' } }],
        });

        const deleted = await trivium.bulkDelete(user, 'third-party/ext-a', {
            database: 'graph',
            items: [{ externalId: 'alpha' }],
        });
        expect(deleted.successCount).toBe(1);

        const resolved = await trivium.resolveId(user, 'third-party/ext-a', {
            database: 'graph',
            externalId: 'alpha',
        });
        expect(resolved.id).toBeNull();
    });

    it('resolves many mappings and lists mapping pages with namespace filtering', async () => {
        const user = createUser(dirs);
        const trivium = new TriviumService(createMockCore());

        await trivium.bulkUpsert(user, 'third-party/ext-a', {
            database: 'graph',
            items: [
                { externalId: 'alpha', vector: [1, 0], payload: { name: 'alpha' } },
                { externalId: 'beta', vector: [0, 1], payload: { name: 'beta' } },
                { externalId: 'gamma', namespace: 'alt', vector: [1, 1], payload: { name: 'gamma' } },
            ],
        });

        const resolved = await trivium.resolveMany(user, 'third-party/ext-a', {
            database: 'graph',
            items: [
                { externalId: 'alpha' },
                { id: 2 },
                { externalId: 'missing' },
                { externalId: 'alpha', id: 99 },
                {},
            ],
        });

        expect(resolved.items).toEqual([
            { index: 0, id: 1, externalId: 'alpha', namespace: 'default' },
            { index: 1, id: 2, externalId: 'beta', namespace: 'default' },
            { index: 2, id: null, externalId: 'missing', namespace: 'default' },
            {
                index: 3,
                id: 1,
                externalId: 'alpha',
                namespace: 'default',
                error: 'Trivium externalId default:alpha is already mapped to 1',
            },
            {
                index: 4,
                id: null,
                externalId: null,
                namespace: null,
                error: 'Trivium id must be a positive safe integer',
            },
        ]);

        const firstPage = await trivium.listMappingsPage(user, 'third-party/ext-a', {
            database: 'graph',
            page: { limit: 2 },
        });
        expect(firstPage.mappings.map(item => `${item.namespace}:${item.externalId}`)).toEqual(['alt:gamma', 'default:alpha']);
        expect(firstPage.page).toEqual({
            nextCursor: '2',
            limit: 2,
            hasMore: true,
            totalCount: 3,
        });

        const secondPage = await trivium.listMappingsPage(user, 'third-party/ext-a', {
            database: 'graph',
            page: { cursor: '2', limit: 2 },
        });
        expect(secondPage.mappings.map(item => `${item.namespace}:${item.externalId}`)).toEqual(['default:beta']);
        expect(secondPage.page).toEqual({
            nextCursor: null,
            limit: 2,
            hasMore: false,
            totalCount: 3,
        });

        const filteredPage = await trivium.listMappingsPage(user, 'third-party/ext-a', {
            database: 'graph',
            namespace: 'alt',
            page: { limit: 5 },
        });
        expect(filteredPage.mappings.map(item => item.externalId)).toEqual(['gamma']);
        expect(filteredPage.page).toEqual({
            nextCursor: null,
            limit: 5,
            hasMore: false,
            totalCount: 1,
        });
    });

    it('reports mapping counts and opt-in orphan mapping integrity in stat', async () => {
        const user = createUser(dirs);
        const core = createMockCore();
        const trivium = new TriviumService(core);

        await trivium.bulkUpsert(user, 'third-party/ext-a', {
            database: 'graph',
            items: [
                { externalId: 'alpha', vector: [1, 0], payload: { name: 'alpha' } },
                { externalId: 'beta', vector: [0, 1], payload: { name: 'beta' } },
            ],
        });

        const basicStat = await trivium.stat(user, 'third-party/ext-a', {
            database: 'graph',
        });
        expect(basicStat.mappingCount).toBe(2);
        expect(basicStat.orphanMappingCount).toBeNull();

        const dbPath = path.join(
            getUserAuthorityPaths(user).triviumPrivateDir,
            sanitizeFileSegment('third-party/ext-a'),
            'graph.tdb',
        );
        await core.bulkDeleteTrivium(dbPath, {
            database: 'graph',
            items: [{ id: 2 }],
        });

        const integrityStat = await trivium.stat(user, 'third-party/ext-a', {
            database: 'graph',
            includeMappingIntegrity: true,
        });
        expect(integrityStat.nodeCount).toBe(1);
        expect(integrityStat.mappingCount).toBe(2);
        expect(integrityStat.orphanMappingCount).toBe(1);
    });

    it('tracks Trivium index health across rebuild and compaction lifecycle', async () => {
        const user = createUser(dirs);
        const core = createMockCore();
        const trivium = new TriviumService(core);

        await trivium.bulkUpsert(user, 'third-party/ext-a', {
            database: 'graph',
            items: [
                { externalId: 'alpha', vector: [1, 0], payload: { name: 'alpha' } },
            ],
        });

        const staleStat = await trivium.stat(user, 'third-party/ext-a', {
            database: 'graph',
        });
        expect(staleStat.indexHealth).toMatchObject({
            status: 'stale',
            requiresRebuild: true,
        });
        expect(staleStat.indexHealth?.lastContentMutationAt).toEqual(expect.any(String));
        expect(staleStat.indexHealth?.lastTextRebuildAt).toBeNull();

        await trivium.buildTextIndex(user, 'third-party/ext-a', {
            database: 'graph',
        });

        const rebuiltStat = await trivium.stat(user, 'third-party/ext-a', {
            database: 'graph',
        });
        expect(rebuiltStat.indexHealth).toMatchObject({
            status: 'fresh',
            requiresRebuild: false,
        });
        expect(rebuiltStat.indexHealth?.lastTextRebuildAt).toEqual(expect.any(String));

        await trivium.compact(user, 'third-party/ext-a', {
            database: 'graph',
        });

        const compactedStat = await trivium.stat(user, 'third-party/ext-a', {
            database: 'graph',
        });
        expect(compactedStat.indexHealth?.lastCompactionAt).toEqual(expect.any(String));

        await trivium.bulkUpsert(user, 'third-party/ext-a', {
            database: 'graph',
            items: [
                { externalId: 'alpha', vector: [1, 0], payload: { name: 'alpha-v2' } },
            ],
        });

        const restaleStat = await trivium.stat(user, 'third-party/ext-a', {
            database: 'graph',
        });
        expect(restaleStat.indexHealth).toMatchObject({
            status: 'stale',
            requiresRebuild: true,
        });

        const listed = await trivium.listDatabases(user, 'third-party/ext-a');
        expect(listed.databases[0]?.indexHealth).toMatchObject({
            status: 'stale',
            requiresRebuild: true,
        });
    });

    it('lists Trivium databases with persisted dim and dtype diagnostics', async () => {
        const user = createUser(dirs);
        const core = createMockCore();
        const trivium = new TriviumService(core);

        await trivium.bulkUpsert(user, 'third-party/ext-a', {
            database: 'graph',
            dim: 3,
            dtype: 'f16',
            syncMode: 'off',
            storageMode: 'mmap',
            items: [
                { externalId: 'alpha', vector: [1, 0, 0], payload: { name: 'alpha' } },
            ],
        });

        const dbPath = path.join(
            getUserAuthorityPaths(user).triviumPrivateDir,
            sanitizeFileSegment('third-party/ext-a'),
            'graph.tdb',
        );
        const header = Buffer.alloc(10);
        header.write('TVDB', 0, 'utf8');
        header.writeUInt32LE(3, 6);
        fs.writeFileSync(dbPath, header);
        fs.writeFileSync(`${dbPath}.vec`, Buffer.from([0]));

        const listed = await trivium.listDatabases(user, 'third-party/ext-a');
        expect(listed.databases).toHaveLength(1);
        expect(listed.databases[0]).toMatchObject({
            name: 'graph',
            dim: 3,
            dtype: 'f16',
            syncMode: 'off',
            storageMode: 'mmap',
        });
    });

    it('checks mapping integrity and deletes orphan mappings without deleting live nodes', async () => {
        const user = createUser(dirs);
        const core = createMockCore();
        const trivium = new TriviumService(core);

        await trivium.bulkUpsert(user, 'third-party/ext-a', {
            database: 'graph',
            items: [
                { externalId: 'alpha', vector: [1, 0], payload: { name: 'alpha' } },
                { externalId: 'beta', vector: [0, 1], payload: { name: 'beta' } },
            ],
        });

        const dbPath = path.join(
            getUserAuthorityPaths(user).triviumPrivateDir,
            sanitizeFileSegment('third-party/ext-a'),
            'graph.tdb',
        );
        await core.bulkDeleteTrivium(dbPath, {
            database: 'graph',
            items: [{ id: 2 }],
        });
        await core.bulkUpsertTrivium(dbPath, {
            database: 'graph',
            items: [{ id: 3, vector: [1, 1], payload: { name: 'gamma' } }],
        });

        const integrity = await trivium.checkMappingsIntegrity(user, 'third-party/ext-a', {
            database: 'graph',
            sampleLimit: 10,
        });
        expect(integrity.ok).toBe(false);
        expect(integrity.mappingCount).toBe(2);
        expect(integrity.nodeCount).toBe(2);
        expect(integrity.orphanMappingCount).toBe(1);
        expect(integrity.missingMappingCount).toBe(1);
        expect(integrity.duplicateInternalIdCount).toBe(0);
        expect(integrity.duplicateExternalIdCount).toBe(0);
        expect(integrity.issues).toEqual(expect.arrayContaining([
            expect.objectContaining({ type: 'orphanMapping', id: 2, externalId: 'beta', namespace: 'default' }),
            expect.objectContaining({ type: 'missingMapping', id: 3, externalId: null, namespace: null }),
        ]));

        const deleted = await trivium.deleteOrphanMappings(user, 'third-party/ext-a', {
            database: 'graph',
            limit: 10,
        });
        expect(deleted.scannedCount).toBe(2);
        expect(deleted.orphanCount).toBe(1);
        expect(deleted.deletedCount).toBe(1);
        expect(deleted.hasMore).toBe(false);
        expect(deleted.orphans).toEqual([
            expect.objectContaining({ id: 2, externalId: 'beta', namespace: 'default' }),
        ]);

        const betaMapping = await trivium.resolveId(user, 'third-party/ext-a', {
            database: 'graph',
            externalId: 'beta',
        });
        expect(betaMapping.id).toBeNull();

        const remainingNode = await trivium.get(user, 'third-party/ext-a', {
            database: 'graph',
            id: 3,
        });
        expect(remainingNode?.id).toBe(3);

        const afterDelete = await trivium.checkMappingsIntegrity(user, 'third-party/ext-a', {
            database: 'graph',
            sampleLimit: 10,
        });
        expect(afterDelete.orphanMappingCount).toBe(0);
        expect(afterDelete.missingMappingCount).toBe(1);
    });

    it('returns page-aware enriched TQL responses while keeping array wrappers compatible', async () => {
        const user = createUser(dirs);
        const trivium = new TriviumService(createMockCore());

        await trivium.bulkUpsert(user, 'third-party/ext-a', {
            database: 'graph',
            items: [
                { externalId: 'alpha', vector: [1, 0], payload: { name: 'alpha' } },
                { externalId: 'beta', vector: [0, 1], payload: { name: 'beta' } },
            ],
        });

        const tqlPage = await trivium.tqlPage(user, 'third-party/ext-a', {
            database: 'graph',
            query: 'MATCH (n) RETURN n',
            page: { limit: 1 },
        });
        expect(tqlPage.rows).toHaveLength(1);
        expect(tqlPage.rows[0]?.n?.externalId).toBe('alpha');
        expect(tqlPage.page).toEqual({
            nextCursor: '1',
            limit: 1,
            hasMore: true,
            totalCount: 2,
        });

        const tqlRows = await trivium.tql(user, 'third-party/ext-a', {
            database: 'graph',
            query: 'MATCH (n) RETURN n',
            page: { limit: 1 },
        });
        expect(tqlRows.map(row => row.n?.externalId)).toEqual(['alpha']);
    });
});

function createMockCore(): CoreService {
    const mappings = new Map<string, { nextId: number; rows: MappingRow[]; meta: Map<string, string> }>();
    const databases = new Map<string, Map<number, MockNode>>();

    function toPage(totalCount: number, limit: number, offset = 0): CursorPageInfo {
        const nextOffset = offset + limit;
        return {
            nextCursor: nextOffset < totalCount ? String(nextOffset) : null,
            limit,
            hasMore: nextOffset < totalCount,
            totalCount,
        };
    }

    function touch(filePath: string): void {
        fs.mkdirSync(path.dirname(filePath), { recursive: true });
        if (!fs.existsSync(filePath)) {
            fs.writeFileSync(filePath, '');
        }
    }

    function getMappingStore(dbPath: string) {
        let store = mappings.get(dbPath);
        if (!store) {
            store = { nextId: 1, rows: [], meta: new Map<string, string>() };
            mappings.set(dbPath, store);
        }
        return store;
    }

    function getDatabase(dbPath: string) {
        let store = databases.get(dbPath);
        if (!store) {
            store = new Map<number, MockNode>();
            databases.set(dbPath, store);
        }
        return store;
    }

    function toQueryResult(rows: Record<string, SqlValue>[], page?: CursorPageInfo): SqlQueryResult {
        return {
            kind: 'query',
            columns: rows[0] ? Object.keys(rows[0]) : [],
            rows,
            rowCount: rows.length,
            ...(page ? { page } : {}),
        };
    }

    function toExecResult(rowsAffected: number, lastInsertRowid: number | null): SqlExecResult {
        return {
            kind: 'exec',
            rowsAffected,
            lastInsertRowid,
        };
    }

    function toBulkMutationResponse(totalCount: number, failures: TriviumBulkMutationResponse['failures']): TriviumBulkMutationResponse {
        return {
            totalCount,
            successCount: totalCount - failures.length,
            failureCount: failures.length,
            failures,
        };
    }

    return {
        async migrateSql(dbPath: string): Promise<SqlMigrateResponse> {
            touch(dbPath);
            getMappingStore(dbPath);
            return {
                tableName: 'authority_sql_migrations',
                applied: ['001_authority_trivium_mapping'],
                skipped: [],
                latestId: '001_authority_trivium_mapping',
            };
        },
        async querySql(dbPath: string, request: { statement: string; params?: unknown[]; page?: { cursor?: string; limit?: number } }): Promise<SqlQueryResult> {
            const store = getMappingStore(dbPath);
            if (request.statement.includes('FROM authority_trivium_external_ids') && request.statement.includes('external_id = ?2')) {
                const namespace = String(request.params?.[0] ?? 'default');
                const externalId = String(request.params?.[1] ?? '');
                const row = store.rows.find(item => item.namespace === namespace && item.externalId === externalId);
                return toQueryResult(row ? [{ internalId: row.id, externalId: row.externalId, namespace: row.namespace }] : []);
            }
            if (request.statement.includes('SELECT COUNT(*) AS count FROM authority_trivium_external_ids')) {
                return toQueryResult([{ count: store.rows.length }]);
            }
            if (request.statement.includes('FROM authority_trivium_external_ids') && request.statement.includes('internal_id IN')) {
                const ids = (request.params ?? []).map(value => Number(value));
                return toQueryResult(store.rows
                    .filter(row => ids.includes(row.id))
                    .map(row => ({ internalId: row.id, externalId: row.externalId, namespace: row.namespace })));
            }
            if (request.statement.includes('SELECT internal_id AS internalId FROM authority_trivium_external_ids ORDER BY internal_id ASC')) {
                return toQueryResult([...store.rows]
                    .sort((left, right) => left.id - right.id)
                    .map(row => ({ internalId: row.id })));
            }
            if (request.statement.includes('FROM authority_trivium_external_ids') && request.statement.includes('created_at AS createdAt')) {
                const namespace = request.statement.includes('WHERE namespace = ?1')
                    ? String(request.params?.[0] ?? '')
                    : null;
                const rows = [...store.rows]
                    .filter(row => namespace == null || row.namespace === namespace)
                    .sort((left, right) => {
                        if (left.namespace !== right.namespace) {
                            return left.namespace.localeCompare(right.namespace);
                        }
                        if (left.externalId !== right.externalId) {
                            return left.externalId.localeCompare(right.externalId);
                        }
                        return left.id - right.id;
                    })
                    .map(row => ({
                        internalId: row.id,
                        externalId: row.externalId,
                        namespace: row.namespace,
                        createdAt: row.createdAt,
                        updatedAt: row.updatedAt,
                    }));
                if (!request.page) {
                    return toQueryResult(rows);
                }
                const offset = Number(request.page.cursor ?? '0');
                const limit = request.page.limit ?? 50;
                return toQueryResult(rows.slice(offset, offset + limit), toPage(rows.length, limit, offset));
            }
            if (request.statement.includes('FROM authority_trivium_meta')) {
                const key = String(request.params?.[0] ?? '');
                const value = store.meta.get(key);
                return toQueryResult(value == null ? [] : [{ value }]);
            }
            return toQueryResult([]);
        },
        async execSql(dbPath: string, request: { statement: string; params?: unknown[] }): Promise<SqlExecResult> {
            touch(dbPath);
            const store = getMappingStore(dbPath);
            if (request.statement.includes('INSERT INTO authority_trivium_external_ids (namespace, external_id')) {
                const namespace = String(request.params?.[0] ?? 'default');
                const externalId = String(request.params?.[1] ?? '');
                const createdAt = String(request.params?.[2] ?? new Date().toISOString());
                const updatedAt = String(request.params?.[3] ?? createdAt);
                if (store.rows.some(row => row.namespace === namespace && row.externalId === externalId)) {
                    throw new Error('duplicate mapping');
                }
                const id = store.nextId++;
                store.rows.push({ id, namespace, externalId, createdAt, updatedAt });
                return toExecResult(1, id);
            }
            if (request.statement.includes('INSERT INTO authority_trivium_external_ids (internal_id, namespace, external_id')) {
                const id = Number(request.params?.[0] ?? 0);
                const namespace = String(request.params?.[1] ?? 'default');
                const externalId = String(request.params?.[2] ?? '');
                const createdAt = String(request.params?.[3] ?? new Date().toISOString());
                const updatedAt = String(request.params?.[4] ?? createdAt);
                if (store.rows.some(row => row.id === id || (row.namespace === namespace && row.externalId === externalId))) {
                    throw new Error('duplicate mapping');
                }
                store.rows.push({ id, namespace, externalId, createdAt, updatedAt });
                store.nextId = Math.max(store.nextId, id + 1);
                return toExecResult(1, id);
            }
            if (request.statement.includes('DELETE FROM authority_trivium_external_ids WHERE internal_id IN')) {
                const ids = new Set((request.params ?? []).map(value => Number(value)));
                const before = store.rows.length;
                store.rows = store.rows.filter(row => !ids.has(row.id));
                return toExecResult(before - store.rows.length, null);
            }
            if (request.statement.includes('INSERT INTO authority_trivium_meta')) {
                const key = String(request.params?.[0] ?? '');
                const value = String(request.params?.[1] ?? '');
                store.meta.set(key, value);
                return toExecResult(1, null);
            }
            return toExecResult(0, null);
        },
        async bulkUpsertTrivium(dbPath: string, request: ControlTriviumBulkUpsertRequest): Promise<ControlTriviumBulkUpsertResponse> {
            touch(dbPath);
            const store = getDatabase(dbPath);
            const items = request.items.map((item, index) => {
                const existing = store.get(item.id);
                store.set(item.id, {
                    id: item.id,
                    vector: [...item.vector],
                    payload: item.payload,
                    edges: existing?.edges ?? [],
                    numEdges: existing?.edges.length ?? 0,
                });
                return {
                    index,
                    id: item.id,
                    action: existing ? 'updated' as const : 'inserted' as const,
                };
            });
            return {
                totalCount: request.items.length,
                successCount: request.items.length,
                failureCount: 0,
                failures: [],
                items,
            };
        },
        async bulkLinkTrivium(dbPath: string, request: { items: Array<{ src: number; dst: number; label?: string; weight?: number }> }): Promise<TriviumBulkMutationResponse> {
            const store = getDatabase(dbPath);
            const failures: TriviumBulkMutationResponse['failures'] = [];
            for (const [index, item] of request.items.entries()) {
                const src = store.get(item.src);
                const dst = store.get(item.dst);
                if (!src || !dst) {
                    failures.push({ index, message: 'missing node' });
                    continue;
                }
                src.edges.push({ targetId: item.dst, label: item.label ?? 'related', weight: item.weight ?? 1 });
                src.numEdges = src.edges.length;
            }
            return toBulkMutationResponse(request.items.length, failures);
        },
        async bulkUnlinkTrivium(): Promise<TriviumBulkMutationResponse> {
            return toBulkMutationResponse(0, []);
        },
        async bulkDeleteTrivium(dbPath: string, request: { items: Array<{ id: number }> }): Promise<TriviumBulkMutationResponse> {
            const store = getDatabase(dbPath);
            const failures: TriviumBulkMutationResponse['failures'] = [];
            for (const [index, item] of request.items.entries()) {
                if (!store.delete(item.id)) {
                    failures.push({ index, message: 'missing node' });
                    continue;
                }
                for (const node of store.values()) {
                    node.edges = node.edges.filter(edge => edge.targetId !== item.id);
                    node.numEdges = node.edges.length;
                }
            }
            return toBulkMutationResponse(request.items.length, failures);
        },
        async getTrivium(dbPath: string, request: { id: number }): Promise<TriviumNodeView | null> {
            const node = getDatabase(dbPath).get(request.id);
            return node ? JSON.parse(JSON.stringify(node)) : null;
        },
        async neighborsTrivium(dbPath: string, request: { id: number }) {
            const node = getDatabase(dbPath).get(request.id);
            return { ids: node?.edges.map(edge => edge.targetId) ?? [] };
        },
        async searchTrivium(dbPath: string): Promise<TriviumSearchHit[]> {
            return [...getDatabase(dbPath).values()]
                .sort((left, right) => left.id - right.id)
                .map(node => ({ id: node.id, score: 1, payload: node.payload }));
        },
        async tqlTriviumPage(dbPath: string, request: { page?: { cursor?: string; limit?: number } }): Promise<TriviumTqlResponse> {
            const rows = [...getDatabase(dbPath).values()]
                .sort((left, right) => left.id - right.id)
                .map(node => ({ n: JSON.parse(JSON.stringify(node)) as TriviumNodeView }));
            const offset = Number(request.page?.cursor ?? '0');
            const limit = request.page?.limit ?? rows.length;
            return {
                rows: rows.slice(offset, offset + limit),
                ...(request.page ? { page: toPage(rows.length, limit, offset) } : {}),
            };
        },
        async buildTextIndexTrivium(): Promise<void> {
            return undefined;
        },
        async compactTrivium(dbPath: string): Promise<void> {
            touch(dbPath);
        },
        async statTrivium(dbPath: string, request: { database?: string }): Promise<TriviumStatResponse> {
            const database = String(request.database ?? 'default');
            const nodes = [...getDatabase(dbPath).values()].sort((left, right) => left.id - right.id);
            return {
                name: database,
                fileName: `${database}.tdb`,
                dim: nodes[0]?.vector.length ?? null,
                dtype: 'f32',
                syncMode: null,
                storageMode: null,
                sizeBytes: 0,
                walSizeBytes: 0,
                vecSizeBytes: 0,
                totalSizeBytes: 0,
                updatedAt: null,
                indexHealth: null,
                database,
                filePath: dbPath,
                exists: databases.has(dbPath),
                nodeCount: nodes.length,
                edgeCount: nodes.reduce((sum, node) => sum + node.edges.length, 0),
                textIndexCount: 0,
                lastFlushAt: null,
                mappingCount: 0,
                orphanMappingCount: null,
                vectorDim: nodes[0]?.vector.length ?? null,
                databaseSize: 0,
                walSize: 0,
                vecSize: 0,
                estimatedMemoryBytes: 0,
            };
        },
    } as unknown as CoreService;
}

function createUser(dirs: string[]): UserContext {
    const rootDir = fs.mkdtempSync(path.join(os.tmpdir(), 'authority-trivium-'));
    dirs.push(rootDir);
    return {
        handle: 'alice',
        isAdmin: false,
        rootDir,
    };
}

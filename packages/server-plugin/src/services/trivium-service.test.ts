import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import type {
    ControlTriviumBulkUpsertRequest,
    ControlTriviumBulkUpsertResponse,
    SqlExecResult,
    SqlMigrateResponse,
    SqlQueryResult,
    SqlValue,
    TriviumBulkMutationResponse,
    TriviumNodeView,
    TriviumSearchHit,
} from '@stdo/shared-types';
import { TriviumService } from './trivium-service.js';
import type { CoreService } from './core-service.js';
import type { UserContext } from '../types.js';

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
});

function createMockCore(): CoreService {
    const mappings = new Map<string, { nextId: number; rows: MappingRow[]; meta: Map<string, string> }>();
    const databases = new Map<string, Map<number, MockNode>>();

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

    function toQueryResult(rows: Record<string, SqlValue>[]): SqlQueryResult {
        return {
            kind: 'query',
            columns: rows[0] ? Object.keys(rows[0]) : [],
            rows,
            rowCount: rows.length,
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
        async querySql(dbPath: string, request: { statement: string; params?: unknown[] }): Promise<SqlQueryResult> {
            const store = getMappingStore(dbPath);
            if (request.statement.includes('FROM authority_trivium_external_ids') && request.statement.includes('external_id = ?2')) {
                const namespace = String(request.params?.[0] ?? 'default');
                const externalId = String(request.params?.[1] ?? '');
                const row = store.rows.find(item => item.namespace === namespace && item.externalId === externalId);
                return toQueryResult(row ? [{ internalId: row.id, externalId: row.externalId, namespace: row.namespace }] : []);
            }
            if (request.statement.includes('FROM authority_trivium_external_ids') && request.statement.includes('internal_id IN')) {
                const ids = (request.params ?? []).map(value => Number(value));
                return toQueryResult(store.rows
                    .filter(row => ids.includes(row.id))
                    .map(row => ({ internalId: row.id, externalId: row.externalId, namespace: row.namespace })));
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

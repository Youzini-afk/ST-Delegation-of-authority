import { afterEach, describe, expect, it, vi } from 'vitest';
import { CoreService } from './core-service.js';
import { AuthorityServiceError } from '../utils.js';

describe('CoreService', () => {
    const originalFetch = globalThis.fetch;

    afterEach(() => {
        globalThis.fetch = originalFetch;
        vi.restoreAllMocks();
    });

    it('passes page to sql query requests', async () => {
        const fetchMock = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
            return new Response(JSON.stringify({
                kind: 'query',
                columns: ['id'],
                rows: [{ id: 1 }],
                rowCount: 1,
                page: {
                    nextCursor: '10',
                    limit: 10,
                    hasMore: true,
                    totalCount: 100,
                },
            }), {
                status: 200,
                headers: { 'content-type': 'application/json' },
            });
        });
        globalThis.fetch = fetchMock as typeof globalThis.fetch;

        const service = new CoreService();
        const serviceWithState = service as unknown as {
            status: { state: 'running'; port: number; lastError: string | null };
            token: string;
        };
        serviceWithState.status = {
            state: 'running',
            port: 43123,
            lastError: null,
        };
        serviceWithState.token = 'test-token';

        const result = await service.querySql('C:/tmp/example.sqlite', {
            statement: 'SELECT id FROM sample ORDER BY id',
            page: { cursor: '10', limit: 10 },
        });

        expect(result.page).toEqual({
            nextCursor: '10',
            limit: 10,
            hasMore: true,
            totalCount: 100,
        });
        expect(fetchMock).toHaveBeenCalledTimes(1);

        const [, init] = fetchMock.mock.calls[0] ?? [];
        const body = JSON.parse(String(init?.body ?? '{}')) as {
            dbPath: string;
            statement: string;
            params: unknown[];
            page?: { cursor?: string; limit?: number };
        };
        expect(body.dbPath).toBe('C:/tmp/example.sqlite');
        expect(body.statement).toBe('SELECT id FROM sample ORDER BY id');
        expect(body.params).toEqual([]);
        expect(body.page).toEqual({ cursor: '10', limit: 10 });
    });

    it('maps core 4xx size failures to structured limit errors', async () => {
        const fetchMock = vi.fn(async () => {
            return new Response(JSON.stringify({
                error: 'Blob content exceeds 16777216 bytes',
            }), {
                status: 413,
                headers: { 'content-type': 'application/json' },
            });
        });
        globalThis.fetch = fetchMock as typeof globalThis.fetch;

        const service = new CoreService();
        const serviceWithState = service as unknown as {
            status: { state: 'running'; port: number; lastError: string | null };
            token: string;
        };
        serviceWithState.status = {
            state: 'running',
            port: 43123,
            lastError: null,
        };
        serviceWithState.token = 'test-token';

        const error = await service.querySql('C:/tmp/example.sqlite', {
            statement: 'SELECT 1',
        }).catch(value => value);

        expect(error).toBeInstanceOf(AuthorityServiceError);
        expect(error).toMatchObject({
            status: 413,
            code: 'limit_exceeded',
            category: 'limit',
        });
    });
});

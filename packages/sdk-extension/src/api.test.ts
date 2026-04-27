import { beforeEach, describe, expect, it, vi } from 'vitest';

const getRequestHeadersMock = vi.hoisted(() => vi.fn(() => ({
    Accept: 'application/json',
    'Content-Type': 'application/json',
})));

vi.mock('/script.js', () => ({
    getRequestHeaders: getRequestHeadersMock,
}));

describe('authorityRequest', () => {
    beforeEach(() => {
        getRequestHeadersMock.mockClear();
        vi.unstubAllGlobals();
    });

    it('exposes structured code and details on AuthorityApiError', async () => {
        const fetchMock = vi.fn().mockResolvedValue({
            status: 403,
            ok: false,
            statusText: 'Forbidden',
            headers: new Headers({
                'content-type': 'application/json',
            }),
            json: vi.fn().mockResolvedValue({
                error: 'Permission not granted: storage.kv',
                code: 'permission_not_granted',
                category: 'permission',
                details: {
                    resource: 'storage.kv',
                    target: '*',
                    key: 'storage.kv:*',
                    riskLevel: 'low',
                },
            }),
            text: vi.fn(),
        } satisfies Partial<Response>);
        vi.stubGlobal('fetch', fetchMock);

        const { AuthorityApiError, authorityRequest } = await import('./api.js');
        const error = await authorityRequest('/storage/kv/get').catch(value => value);

        expect(error).toBeInstanceOf(AuthorityApiError);
        expect(error).toMatchObject({
            status: 403,
            code: 'permission_not_granted',
            category: 'permission',
            details: {
                resource: 'storage.kv',
                target: '*',
                key: 'storage.kv:*',
                riskLevel: 'low',
            },
        });
    });

    it('promotes structured session payloads to AuthoritySessionError', async () => {
        const fetchMock = vi.fn().mockResolvedValue({
            status: 401,
            ok: false,
            statusText: 'Unauthorized',
            headers: new Headers({
                'content-type': 'application/json',
            }),
            json: vi.fn().mockResolvedValue({
                error: 'Invalid authority session',
                code: 'invalid_session',
                category: 'session',
            }),
            text: vi.fn(),
        } satisfies Partial<Response>);
        vi.stubGlobal('fetch', fetchMock);

        const { AuthoritySessionError, authorityRequest, isInvalidSessionError } = await import('./api.js');
        const error = await authorityRequest('/storage/kv/get').catch(value => value);

        expect(error).toBeInstanceOf(AuthoritySessionError);
        expect(isInvalidSessionError(error)).toBe(true);
        expect(error).toMatchObject({
            status: 401,
            code: 'invalid_session',
            category: 'session',
        });
    });
});

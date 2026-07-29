import { afterEach, describe, expect, it, vi } from 'vitest';
import type { AuthorityRuntime } from '../runtime.js';
import type { AuthorityRequest, AuthorityResponse, SessionRecord } from '../types.js';
import { registerJobsAndEventsRoutes } from './jobs-events-routes.js';

type Handler = (req: AuthorityRequest, res: AuthorityResponse) => void | Promise<void>;

afterEach(() => {
    vi.useRealTimers();
});

describe('Authority event stream tickets', () => {
    it('exchanges the session header for a channel-bound one-time ticket', async () => {
        const fixture = setup();
        const issuedResponse = response();
        await fixture.post.get('/events/ticket')!(request({ body: { channel: 'extension:third-party/ext-a' } }), issuedResponse.res);
        const issued = vi.mocked(issuedResponse.res.json).mock.calls[0]![0] as { ticket: string; expiresAt: string };

        expect(issued.ticket).toMatch(/^[A-Za-z0-9_-]{43}$/);
        expect(JSON.stringify(issued)).not.toContain('session-token');
        expect(fixture.runtime.permissions.authorize).toHaveBeenCalledWith(
            expect.objectContaining({ handle: 'alice' }),
            fixture.session,
            { resource: 'events.stream', target: 'extension:third-party/ext-a' },
        );

        const streamResponse = response();
        await fixture.get.get('/events/stream')!(request({ query: { ticket: issued.ticket } }), streamResponse.res);
        expect(fixture.runtime.events.register).toHaveBeenCalledWith(
            expect.any(String),
            'alice',
            'extension:third-party/ext-a',
            streamResponse.res,
        );
        expect(fixture.runtime.sessions.assertSession).toHaveBeenCalledTimes(1);

        await expect(fixture.get.get('/events/stream')!(
            request({ query: { ticket: issued.ticket } }),
            response().res,
        )).rejects.toThrow('invalid or expired');
        expect(fixture.runtime.events.register).toHaveBeenCalledTimes(1);
    });

    it('rejects the former long-lived session-token query transport', async () => {
        const fixture = setup();

        await expect(fixture.get.get('/events/stream')!(
            request({ query: { authoritySessionToken: 'session-token' } }),
            response().res,
        )).rejects.toThrow('invalid or expired');
        expect(fixture.runtime.sessions.assertSession).not.toHaveBeenCalled();
    });

    it('binds a ticket to the issuing ST user and closes broker registration on disconnect', async () => {
        const fixture = setup();
        const issuedResponse = response();
        await fixture.post.get('/events/ticket')!(request({ body: {} }), issuedResponse.res);
        const issued = vi.mocked(issuedResponse.res.json).mock.calls[0]![0] as { ticket: string };

        await expect(fixture.get.get('/events/stream')!(
            request({ query: { ticket: issued.ticket }, handle: 'bob' }),
            response().res,
        )).rejects.toThrow('owner mismatch');

        const secondResponse = response();
        await fixture.post.get('/events/ticket')!(request({ body: {} }), secondResponse.res);
        const second = vi.mocked(secondResponse.res.json).mock.calls[0]![0] as { ticket: string };
        const streamResponse = response();
        await fixture.get.get('/events/stream')!(request({ query: { ticket: second.ticket } }), streamResponse.res);
        streamResponse.closeListener?.();
        expect(fixture.closeBroker).toHaveBeenCalledTimes(1);
    });

    it('expires tickets without retaining a reusable credential', async () => {
        vi.useFakeTimers();
        const fixture = setup();
        const issuedResponse = response();
        await fixture.post.get('/events/ticket')!(request({ body: {} }), issuedResponse.res);
        const issued = vi.mocked(issuedResponse.res.json).mock.calls[0]![0] as { ticket: string };

        await vi.advanceTimersByTimeAsync(30_001);
        await expect(fixture.get.get('/events/stream')!(
            request({ query: { ticket: issued.ticket } }),
            response().res,
        )).rejects.toThrow('invalid or expired');
    });
});

function setup() {
    const get = new Map<string, Handler>();
    const post = new Map<string, Handler>();
    const session = {
        token: 'session-token',
        userHandle: 'alice',
        isAdmin: false,
        extension: { id: 'third-party/ext-a', displayName: 'Ext A', version: '1.0.0', installType: 'local' },
    } as SessionRecord;
    const closeBroker = vi.fn();
    const runtime = {
        sessions: { assertSession: vi.fn().mockResolvedValue(session) },
        permissions: { authorize: vi.fn().mockResolvedValue(true) },
        events: { register: vi.fn(() => closeBroker) },
    } as unknown as AuthorityRuntime;
    const fail = vi.fn((_runtime, _req, _res, _extensionId, error: unknown) => {
        throw error;
    });
    registerJobsAndEventsRoutes({
        get: (path, handler) => get.set(path, handler),
        post: (path, handler) => post.set(path, handler),
    }, runtime, fail);
    return { runtime, session, get, post, closeBroker };
}

function request(options: {
    body?: unknown;
    query?: Record<string, string>;
    handle?: string;
} = {}): AuthorityRequest {
    return {
        headers: { 'x-authority-session-token': 'session-token' },
        ...(options.body === undefined ? {} : { body: options.body }),
        ...(options.query === undefined ? {} : { query: options.query }),
        user: {
            profile: { handle: options.handle ?? 'alice', admin: false },
            directories: { root: `C:\\users\\${options.handle ?? 'alice'}` },
        },
    };
}

function response(): { res: AuthorityResponse; closeListener: (() => void) | null } {
    let closeListener: (() => void) | null = null;
    const res = {} as AuthorityResponse;
    Object.assign(res, {
        status: vi.fn(() => res),
        json: vi.fn(),
        send: vi.fn(),
        setHeader: vi.fn(),
        write: vi.fn(),
        end: vi.fn(),
        on: vi.fn((event: string, listener: () => void) => {
            if (event === 'close') closeListener = listener;
        }),
    });
    return {
        res,
        get closeListener() {
            return closeListener;
        },
    };
}

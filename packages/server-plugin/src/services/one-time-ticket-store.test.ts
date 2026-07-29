import { afterEach, describe, expect, it, vi } from 'vitest';
import { OneTimeTicketStore } from './one-time-ticket-store.js';

afterEach(() => {
    vi.useRealTimers();
});

describe('OneTimeTicketStore', () => {
    it('issues opaque tickets that can be consumed exactly once', () => {
        const store = new OneTimeTicketStore<{ owner: string }>();
        const issued = store.issue({ owner: 'alice' });

        expect(issued.ticket).toMatch(/^[A-Za-z0-9_-]{43}$/);
        expect(store.consume(issued.ticket)).toEqual({ owner: 'alice' });
        expect(store.consume(issued.ticket)).toBeNull();
    });

    it('rejects malformed and expired tickets', () => {
        vi.useFakeTimers();
        let now = 1_000;
        const store = new OneTimeTicketStore<string>(1_000, () => now);
        const issued = store.issue('value');

        expect(store.consume('not-a-ticket')).toBeNull();
        now += 1_001;
        vi.advanceTimersByTime(1_001);
        expect(store.consume(issued.ticket)).toBeNull();
    });
});

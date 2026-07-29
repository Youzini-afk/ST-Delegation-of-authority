import crypto from 'node:crypto';

export const DEFAULT_ONE_TIME_TICKET_TTL_MS = 30_000;

interface TicketRecord<T> {
    value: T;
    expiresAt: number;
    timer: ReturnType<typeof setTimeout>;
}

export interface IssuedOneTimeTicket {
    ticket: string;
    expiresAt: string;
}

/** In-memory, short-lived bearer exchange for browser transports without headers. */
export class OneTimeTicketStore<T> {
    private readonly records = new Map<string, TicketRecord<T>>();

    constructor(
        private readonly ttlMs = DEFAULT_ONE_TIME_TICKET_TTL_MS,
        private readonly now: () => number = Date.now,
    ) {
        if (!Number.isSafeInteger(ttlMs) || ttlMs < 1_000 || ttlMs > 5 * 60_000) {
            throw new Error('One-time ticket TTL must be between 1000 and 300000 ms');
        }
    }

    issue(value: T): IssuedOneTimeTicket {
        this.pruneExpired();
        let ticket: string;
        do {
            ticket = crypto.randomBytes(32).toString('base64url');
        } while (this.records.has(ticket));
        const expiresAt = this.now() + this.ttlMs;
        const timer = setTimeout(() => this.expire(ticket), this.ttlMs);
        timer.unref?.();
        this.records.set(ticket, { value, expiresAt, timer });
        return { ticket, expiresAt: new Date(expiresAt).toISOString() };
    }

    consume(ticket: unknown): T | null {
        if (typeof ticket !== 'string' || !/^[A-Za-z0-9_-]{32,128}$/.test(ticket)) {
            return null;
        }
        const record = this.records.get(ticket);
        if (!record) {
            return null;
        }
        clearTimeout(record.timer);
        this.records.delete(ticket);
        return record.expiresAt > this.now() ? record.value : null;
    }

    private expire(ticket: string): void {
        const record = this.records.get(ticket);
        if (!record) return;
        clearTimeout(record.timer);
        this.records.delete(ticket);
    }

    private pruneExpired(): void {
        const now = this.now();
        for (const [ticket, record] of this.records) {
            if (record.expiresAt <= now) this.expire(ticket);
        }
    }
}

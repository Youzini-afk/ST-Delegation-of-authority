import { describe, expect, it, vi } from 'vitest';
import { MAX_KV_VALUE_BYTES } from '../constants.js';
import { AuthorityServiceError } from '../utils.js';
import type { UserContext } from '../types.js';
import type { CoreService } from './core-service.js';
import { IdempotencyService } from './idempotency-service.js';
import type { IdempotencyRecord } from './idempotency-service.js';
import { StorageService } from './storage-service.js';

/**
 * Direct unit tests for the durable-ish `IdempotencyService`.
 *
 * The wrapper-level tests in `companion-module-loader-service.test.ts`
 * exercise the `ctx.idempotency` capability end-to-end through a companion
 * module; these tests exercise the underlying service directly so a
 * regression in the lookup / cache / fingerprint-mismatch logic surfaces
 * without going through the companion loader.
 *
 * The service uses a real {@link StorageService} backed by a mock core
 * with in-memory KV stubs (mirroring storage-service.test.ts). The
 * StorageService requires a `UserContext` to resolve the per-user kvDir;
 * the tests create a fixture user.
 */
describe('IdempotencyService', () => {
    const ownerExtensionId = 'third-party/idem-extension';
    const key = 'chat:123';
    const fingerprint = 'fp-v1';
    const user: UserContext = {
        handle: 'alice',
        isAdmin: false,
        rootDir: '/tmp/authority-idempotency-test',
    };

    it('getRecord returns null when no record exists', async () => {
        const service = createService();
        const result = await service.getRecord(user, ownerExtensionId, key);
        expect(result).toBeNull();
    });

    it('getRecord returns the stored record when one exists', async () => {
        const service = createService();
        await service.record(user, ownerExtensionId, key, fingerprint, { ok: true, value: 42 }, 60_000);
        const result = await service.getRecord(user, ownerExtensionId, key);
        expect(result).not.toBeNull();
        expect(result?.fingerprint).toBe(fingerprint);
        expect(result?.responseJson).toBe(JSON.stringify({ ok: true, value: 42 }));
        expect(typeof result?.expiresAt).toBe('number');
        expect(typeof result?.createdAt).toBe('number');
        expect(result?.expiresAt).toBeGreaterThan(result!.createdAt);
    });

    it('getRecord returns null when the record has expired (treated as not found)', async () => {
        const service = createService();
        // Record with ttlMs = -1000; expiresAt = createdAt - 1000, so the
        // record is already 1 second in the past by the time it is stored.
        // The service treats `expiresAt < Date.now()` as expired; this
        // avoids relying on Date.now()'s millisecond resolution.
        await service.record(user, ownerExtensionId, key, fingerprint, { ok: true }, -1000);
        const result = await service.getRecord(user, ownerExtensionId, key);
        expect(result).toBeNull();
    });

    it('getRecord returns null when the stored value fails to parse (defensive)', async () => {
        const storage = createMockStorage();
        // Poison the KV with a non-record value.
        await storage.setKv(user, ownerExtensionId, `idempotency:${ownerExtensionId}:${key}`, 'not-an-object');
        const service = new IdempotencyService(storage);
        const result = await service.getRecord(user, ownerExtensionId, key);
        expect(result).toBeNull();
    });

    it('getRecord returns null when the stored value is missing required fields', async () => {
        const storage = createMockStorage();
        // Poison the KV with a partial record (missing fingerprint).
        await storage.setKv(user, ownerExtensionId, `idempotency:${ownerExtensionId}:${key}`, {
            responseJson: '{}',
            expiresAt: Date.now() + 60_000,
            createdAt: Date.now(),
        });
        const service = new IdempotencyService(storage);
        const result = await service.getRecord(user, ownerExtensionId, key);
        expect(result).toBeNull();
    });

    it('record stores JSON-serialized response under the prefixed KV key', async () => {
        const storage = createMockStorage();
        const service = new IdempotencyService(storage);
        await service.record(user, ownerExtensionId, key, fingerprint, { ok: true, items: [1, 2, 3] }, 60_000);
        // Inspect the underlying KV store to confirm the key shape and the
        // stored record shape. The KV key is `idempotency:${ownerExtensionId}:${key}`.
        const stored = await storage.getKv(user, ownerExtensionId, `idempotency:${ownerExtensionId}:${key}`);
        expect(stored).not.toBeNull();
        const record = stored as IdempotencyRecord;
        expect(record.responseJson).toBe(JSON.stringify({ ok: true, items: [1, 2, 3] }));
        expect(record.fingerprint).toBe(fingerprint);
        expect(typeof record.expiresAt).toBe('number');
        expect(typeof record.createdAt).toBe('number');
    });

    it('record skips caching when the response exceeds the 128 KiB cap (warning logged)', async () => {
        const service = createService();
        // Build a response whose serialized JSON exceeds MAX_KV_VALUE_BYTES
        // (128 KiB). 200 KiB is well above the cap.
        const oversized = 'x'.repeat(200 * 1024);
        const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
        await service.record(user, ownerExtensionId, key, fingerprint, { data: oversized }, 60_000);
        // The cache must be empty; a lookup returns null.
        const result = await service.getRecord(user, ownerExtensionId, key);
        expect(result).toBeNull();
        // A warning must have been logged so operators can see why caching
        // was skipped.
        expect(warnSpy).toHaveBeenCalled();
        const warnArg = String(warnSpy.mock.calls[0]?.[0] ?? '');
        expect(warnArg).toMatch(/exceeds.*cap|caching skipped/i);
        warnSpy.mockRestore();
    });

    it('record skips caching when the FULL record exceeds the cap even if responseJson is under it', async () => {
        // Regression: previously the cap check measured only
        // `responseJson`, so a response whose `responseJson` was just
        // under MAX_KV_VALUE_BYTES would be cached even though the full
        // stored record (responseJson + fingerprint + expiresAt +
        // createdAt overhead) pushed the KV value over the cap,
        // triggering production KV enforcement rejection. The fix
        // measures the FULL serialized record.
        const service = createService();
        // Build a payload whose `responseJson` is just UNDER the cap
        // but whose full record is just OVER. The full-record overhead
        // is ~95 bytes (fingerprint + expiresAt + createdAt + JSON
        // wrapper), so a payload that puts responseJson at
        // MAX_KV_VALUE_BYTES - 10 leaves the full record ~85 bytes
        // over the cap.
        const responseJsonOverhead = '{"data":"'.length + '"}'.length; // 10
        const payload = 'x'.repeat(MAX_KV_VALUE_BYTES - responseJsonOverhead - 10);
        const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
        await service.record(user, ownerExtensionId, key, fingerprint, { data: payload }, 60_000);
        // The cache MUST be empty: the full record exceeds the cap.
        const result = await service.getRecord(user, ownerExtensionId, key);
        expect(result).toBeNull();
        // A warning must have been logged.
        expect(warnSpy).toHaveBeenCalled();
        const warnArg = String(warnSpy.mock.calls[0]?.[0] ?? '');
        expect(warnArg).toMatch(/full record.*exceeds|caching skipped/i);
        warnSpy.mockRestore();
    });

    it('record at exactly the 128 KiB cap is cached (boundary)', async () => {
        const service = createService();
        // The full serialized record (not just `responseJson`) must be
        // at or under MAX_KV_VALUE_BYTES to be cached. Build a payload
        // whose FULL record serializes to exactly MAX_KV_VALUE_BYTES
        // by measuring the per-record overhead first.
        //
        // The stored record is
        // `{"responseJson":"<responseJson>","fingerprint":"fp-v1","expiresAt":<num>,"createdAt":<num>}`
        // where `responseJson` is `JSON.stringify({ data: payload })` =
        // `'{"data":"' + payload + '"}'`. The 4 `"` chars in
        // `responseJson` are JSON-escaped as `\"` inside the record,
        // but the payload chars (`x`) are embedded verbatim. So the
        // difference between a sample record (empty payload) and the
        // actual record (N-byte payload) is exactly N bytes.
        const sampleRecord: IdempotencyRecord = {
            responseJson: JSON.stringify({ data: '' }),
            fingerprint,
            expiresAt: Date.now() + 60_000,
            createdAt: Date.now(),
        };
        const sampleSize = Buffer.byteLength(JSON.stringify(sampleRecord), 'utf8');
        const payload = 'x'.repeat(Math.max(0, MAX_KV_VALUE_BYTES - sampleSize));
        const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
        await service.record(user, ownerExtensionId, key, fingerprint, { data: payload }, 60_000);
        const result = await service.getRecord(user, ownerExtensionId, key);
        expect(result).not.toBeNull();
        expect(warnSpy).not.toHaveBeenCalled();
        warnSpy.mockRestore();
    });

    it('record skips caching when JSON.stringify(response) returns undefined (undefined value)', async () => {
        // Regression: previously `JSON.stringify(undefined)` returned
        // `undefined` (not a string, and without throwing), which then
        // crashed `Buffer.byteLength(undefined, 'utf8')`. The fix
        // treats `undefined` from `JSON.stringify` as "cannot cache".
        const service = createService();
        const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
        await service.record(user, ownerExtensionId, key, fingerprint, undefined, 60_000);
        // The cache must be empty.
        const result = await service.getRecord(user, ownerExtensionId, key);
        expect(result).toBeNull();
        // A warning must have been logged.
        expect(warnSpy).toHaveBeenCalled();
        const warnArg = String(warnSpy.mock.calls[0]?.[0] ?? '');
        expect(warnArg).toMatch(/serialized to undefined|caching skipped/i);
        warnSpy.mockRestore();
    });

    it('record skips caching when JSON.stringify(response) returns undefined (function value)', async () => {
        // Same regression as above, but for a function-typed response.
        // `JSON.stringify(fn)` returns `undefined` (not a string, not
        // a throw).
        const service = createService();
        const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
        await service.record(user, ownerExtensionId, key, fingerprint, () => 'should-not-cache', 60_000);
        const result = await service.getRecord(user, ownerExtensionId, key);
        expect(result).toBeNull();
        expect(warnSpy).toHaveBeenCalled();
        const warnArg = String(warnSpy.mock.calls[0]?.[0] ?? '');
        expect(warnArg).toMatch(/serialized to undefined|caching skipped/i);
        warnSpy.mockRestore();
    });

    it('record skips caching when JSON.stringify(response) returns undefined (symbol value)', async () => {
        // Same regression as above, but for a symbol-typed response.
        // `JSON.stringify(Symbol('x'))` returns `undefined`.
        const service = createService();
        const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
        await service.record(user, ownerExtensionId, key, fingerprint, Symbol('sym'), 60_000);
        const result = await service.getRecord(user, ownerExtensionId, key);
        expect(result).toBeNull();
        expect(warnSpy).toHaveBeenCalled();
        const warnArg = String(warnSpy.mock.calls[0]?.[0] ?? '');
        expect(warnArg).toMatch(/serialized to undefined|caching skipped/i);
        warnSpy.mockRestore();
    });

    it('run executes fn on first call and caches the result', async () => {
        const service = createService();
        const fn = vi.fn().mockResolvedValue({ ok: true, n: 1 });
        const result1 = await service.run(user, ownerExtensionId, key, fingerprint, fn, 60_000);
        expect(result1).toEqual({ ok: true, n: 1 });
        expect(fn).toHaveBeenCalledTimes(1);
        // The result must be cached.
        const record = await service.getRecord(user, ownerExtensionId, key);
        expect(record?.responseJson).toBe(JSON.stringify({ ok: true, n: 1 }));
    });

    it('run returns the cached result on second call with matching fingerprint (fn not called)', async () => {
        const service = createService();
        const fn = vi.fn().mockResolvedValue({ ok: true, n: 1 });
        const result1 = await service.run(user, ownerExtensionId, key, fingerprint, fn, 60_000);
        const result2 = await service.run(user, ownerExtensionId, key, fingerprint, fn, 60_000);
        expect(result1).toEqual(result2);
        // fn must have been called only once; the second call returned the
        // cached response.
        expect(fn).toHaveBeenCalledTimes(1);
    });

    it('run throws idempotency_conflict (409) on fingerprint mismatch', async () => {
        const service = createService();
        const fn = vi.fn().mockResolvedValue({ ok: true, n: 1 });
        // First call caches with fingerprint 'fp-v1'.
        await service.run(user, ownerExtensionId, key, 'fp-v1', fn, 60_000);
        // Second call with a different fingerprint must throw a structured
        // 409 concurrency conflict, NOT a cache replay.
        let caught: unknown;
        try {
            await service.run(user, ownerExtensionId, key, 'fp-v2', fn, 60_000);
        } catch (error) {
            caught = error;
        }
        expect(caught).toBeInstanceOf(AuthorityServiceError);
        const err = caught as AuthorityServiceError;
        expect(err.status).toBe(409);
        expect(err.code).toBe('idempotency_conflict');
        expect(err.category).toBe('concurrency');
        const details = err.details as { key: string; expectedFingerprint: string; actualFingerprint: string };
        expect(details.key).toBe(key);
        expect(details.expectedFingerprint).toBe('fp-v2');
        expect(details.actualFingerprint).toBe('fp-v1');
        // fn was called only once (during the first call); the mismatched
        // retry must NOT execute fn.
        expect(fn).toHaveBeenCalledTimes(1);
    });

    it('run re-executes fn when the cached record has expired', async () => {
        const service = createService();
        const fn = vi.fn()
            .mockResolvedValueOnce({ ok: true, n: 1 })
            .mockResolvedValueOnce({ ok: true, n: 2 });
        // First call with ttlMs = -1000; the record is stored with
        // expiresAt = createdAt - 1000 (already expired). This avoids
        // relying on Date.now()'s millisecond resolution.
        const result1 = await service.run(user, ownerExtensionId, key, fingerprint, fn, -1000);
        expect(result1).toEqual({ ok: true, n: 1 });
        // Second call: the cached record is expired (expiresAt < Date.now()),
        // so fn must be re-executed.
        const result2 = await service.run(user, ownerExtensionId, key, fingerprint, fn, 60_000);
        expect(result2).toEqual({ ok: true, n: 2 });
        expect(fn).toHaveBeenCalledTimes(2);
    });

    it('run propagates fn errors WITHOUT caching (retry re-executes fn)', async () => {
        const service = createService();
        const fn = vi.fn().mockRejectedValue(new Error('boom'));
        let caught: unknown;
        try {
            await service.run(user, ownerExtensionId, key, fingerprint, fn, 60_000);
        } catch (error) {
            caught = error;
        }
        expect(caught).toBeInstanceOf(Error);
        expect((caught as Error).message).toBe('boom');
        // The cache must be empty; a future retry re-executes fn.
        const record = await service.getRecord(user, ownerExtensionId, key);
        expect(record).toBeNull();
        // A second call must re-execute fn (no cached replay).
        let secondCaught: unknown;
        try {
            await service.run(user, ownerExtensionId, key, fingerprint, fn, 60_000);
        } catch (error) {
            secondCaught = error;
        }
        expect(fn).toHaveBeenCalledTimes(2);
        expect((secondCaught as Error).message).toBe('boom');
    });

    it('run does NOT cache when the response exceeds the 128 KiB cap (warns and returns result)', async () => {
        const service = createService();
        const oversized = 'x'.repeat(200 * 1024);
        const fn = vi.fn().mockResolvedValue({ data: oversized });
        const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
        const result1 = await service.run(user, ownerExtensionId, key, fingerprint, fn, 60_000);
        // The result is still returned to the caller (caching is best-effort).
        expect(result1).toEqual({ data: oversized });
        // But the cache is empty because the response was too large.
        const record = await service.getRecord(user, ownerExtensionId, key);
        expect(record).toBeNull();
        // A second call must re-execute fn (no cached replay).
        const fn2 = vi.fn().mockResolvedValue({ data: oversized });
        await service.run(user, ownerExtensionId, key, fingerprint, fn2, 60_000);
        expect(fn2).toHaveBeenCalledTimes(1);
        expect(warnSpy).toHaveBeenCalled();
        warnSpy.mockRestore();
    });

    it('concurrent same-key calls both execute fn (no in-process singleflight — limitation)', async () => {
        const service = createService();
        // Two concurrent run() calls with the same key. The service does
        // NOT singleflight in-process; both execute fn and both attempt to
        // cache. The second record() overwrites the first.
        const fn = vi.fn().mockImplementation(async (label: string) => {
            await new Promise(resolve => setTimeout(resolve, 10));
            return { label };
        });
        const [a, b] = await Promise.all([
            service.run(user, ownerExtensionId, key, fingerprint, () => fn('A'), 60_000),
            service.run(user, ownerExtensionId, key, fingerprint, () => fn('B'), 60_000),
        ]);
        // Both calls executed fn; both returned their respective results.
        expect(fn).toHaveBeenCalledTimes(2);
        expect([a, b]).toEqual(expect.arrayContaining([{ label: 'A' }, { label: 'B' }]));
        // The cache now holds whichever call landed last; a follow-up call
        // with the same fingerprint returns the cached result without
        // calling fn. The cached result is a JSON.parse'd copy of either
        // 'A' or 'B', so we assert by label rather than by reference.
        const fn3 = vi.fn().mockResolvedValue({ label: 'C' });
        const result3 = await service.run<{ label: string }>(user, ownerExtensionId, key, fingerprint, fn3, 60_000);
        expect(fn3).not.toHaveBeenCalled();
        expect(typeof result3.label).toBe('string');
        expect(['A', 'B']).toContain(result3.label);
    });

    it('isolates records by ownerExtensionId (per-extension KV scoping)', async () => {
        const service = createService();
        const fn = vi.fn().mockResolvedValue({ ok: true });
        await service.run(user, 'third-party/ext-a', 'shared-key', fingerprint, fn, 60_000);
        await service.run(user, 'third-party/ext-b', 'shared-key', fingerprint, fn, 60_000);
        // Two records cached under different owner extension ids; fn was
        // called twice (one per extension). Same idempotency key under
        // different owners must NOT collide.
        expect(fn).toHaveBeenCalledTimes(2);
        // Lookups for both owners return the cached records.
        const a = await service.getRecord(user, 'third-party/ext-a', 'shared-key');
        const b = await service.getRecord(user, 'third-party/ext-b', 'shared-key');
        expect(a).not.toBeNull();
        expect(b).not.toBeNull();
    });

    it('isolates records by key within the same ownerExtensionId', async () => {
        const service = createService();
        const fn = vi.fn().mockResolvedValue({ ok: true });
        await service.run(user, ownerExtensionId, 'key-A', fingerprint, fn, 60_000);
        await service.run(user, ownerExtensionId, 'key-B', fingerprint, fn, 60_000);
        // Two records cached under different keys; fn was called twice.
        expect(fn).toHaveBeenCalledTimes(2);
        const a = await service.getRecord(user, ownerExtensionId, 'key-A');
        const b = await service.getRecord(user, ownerExtensionId, 'key-B');
        expect(a).not.toBeNull();
        expect(b).not.toBeNull();
    });
});

function createService(): IdempotencyService {
    return new IdempotencyService(createMockStorage());
}

function createMockStorage(): StorageService {
    const kvStores = new Map<string, Map<string, unknown>>();
    const mockCore = {
        async getStorageKv(dbPath: string, request: { key: string }) {
            const store = kvStores.get(dbPath) ?? new Map<string, unknown>();
            kvStores.set(dbPath, store);
            return store.get(request.key);
        },
        async setStorageKv(dbPath: string, request: { key: string; value: unknown }) {
            const store = kvStores.get(dbPath) ?? new Map<string, unknown>();
            kvStores.set(dbPath, store);
            store.set(request.key, request.value);
        },
        async deleteStorageKv(dbPath: string, request: { key: string }) {
            kvStores.get(dbPath)?.delete(request.key);
        },
        async listStorageKv(dbPath: string) {
            const store = kvStores.get(dbPath) ?? new Map<string, unknown>();
            kvStores.set(dbPath, store);
            return Object.fromEntries(store.entries());
        },
    } as unknown as CoreService;
    return new StorageService(mockCore);
}

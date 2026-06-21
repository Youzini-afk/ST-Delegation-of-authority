import { MAX_KV_VALUE_BYTES } from '../constants.js';
import type { UserContext } from '../types.js';
import { AuthorityServiceError } from '../utils.js';
import type { StorageService } from './storage-service.js';

/**
 * Phase C durable-ish idempotency replay for companion transactions.
 *
 * The service is backed by {@link StorageService} KV (per-extension sqlite
 * via the host's core). When a transaction succeeds, the wrapper caches the
 * response keyed by the companion-supplied idempotency key + a request
 * fingerprint. On retry with the same key + matching fingerprint, the
 * cached response is returned instead of re-executing the transaction. This
 * prevents duplicate side effects when a caller retries a successful request
 * that the caller believes may not have committed (e.g. process crash
 * between the server committing and the client receiving the response).
 *
 * Boundary contract (non-negotiable):
 *
 * - ONLY successful results are cached. If `fn` throws, the error is
 *   propagated and NOTHING is cached. Errors, CAS conflicts, and timeouts
 *   are never cached. A retry after an error re-executes `fn`.
 * - Records are scoped to `ownerExtensionId` in two layers: (1) the KV
 *   sqlite file is selected by `ownerExtensionId` (StorageService already
 *   isolates per-extension), and (2) the KV key is prefixed with
 *   `idempotency:${ownerExtensionId}:` so two extensions picking the same
 *   idempotency key cannot collide even within the same per-extension
 *   database. The companion `ctx.idempotency` wrapper additionally
 *   prefixes the caller-supplied key with `ownerExtensionId:` so two
 *   companion modules with the same owner cannot collide either.
 * - The cached value is capped at {@link MAX_KV_VALUE_BYTES} (128 KiB).
 *   Responses whose serialized JSON exceeds this cap are NOT cached; the
 *   service logs a warning and the wrapper proceeds without caching.
 *   A retry after such a response re-executes `fn`.
 * - TTL: default 24 h, hard cap 7 d. The wrapper clamps caller-supplied
 *   `ttlMs` to the 7 d cap; the service stores `expiresAt = createdAt +
 *   ttlMs` and treats expired records as not found on lookup.
 * - "Lost success cache" window: if the process crashes between `fn`
 *   resolving successfully and the KV write landing, the retry re-executes
 *   `fn` and may hit a CAS conflict (e.g. an upstream unique constraint
 *   violation). This is acceptable for v1; the alternative would be a
 *   two-phase commit (write a pending record before `fn`, flip to
 *   committed after) which is out of scope. Document as a known limitation.
 * - NO in-process singleflight. Two concurrent `run(...)` calls with the
 *   same key both execute `fn` and both attempt to cache; the second
 *   `record(...)` overwrites the first. In-process serialization is the
 *   responsibility of the `ctx.locks` wrapper (Phase B); the idempotency
 *   wrapper is for cross-restart replay, not in-process concurrency.
 *
 * The service methods take `user` as the first parameter because the
 * underlying {@link StorageService.getKv}/{@link StorageService.setKv}
 * require a {@link UserContext} to resolve the per-user kvDir. The
 * companion `ctx.idempotency` wrapper captures `user` at build time (the
 * same pattern used by the trivium, sql, and audit wrappers) and passes
 * it through.
 */
export class IdempotencyService {
    constructor(private readonly storage: StorageService) {}

    /**
     * Look up an idempotency record by owner extension + key. Returns `null`
     * when the record is absent, when the stored value fails to parse, or
     * when the record has expired (treated as not found). An expired record
     * is NOT deleted here; the next `record(...)` call for the same key
     * overwrites it in place.
     */
    async getRecord(user: UserContext, ownerExtensionId: string, key: string): Promise<IdempotencyRecord | null> {
        const stored = await this.storage.getKv(user, ownerExtensionId, buildKvKey(ownerExtensionId, key));
        if (!isIdempotencyRecord(stored)) {
            return null;
        }
        if (stored.expiresAt < Date.now()) {
            // Treat expired as not found so the caller re-executes fn.
            return null;
        }
        return stored;
    }

    /**
     * Cache a successful response keyed by owner extension + key + fingerprint.
     * Serializes the FULL record `{ responseJson, fingerprint, expiresAt,
     * createdAt }` to JSON; if the full serialized form exceeds
     * {@link MAX_KV_VALUE_BYTES} (128 KiB) the call is a no-op and a warning
     * is logged so a future retry re-executes `fn` instead of returning an
     * over-cap cached value. The full-record check (not just `responseJson`)
     * matters because production KV enforcement rejects values larger than
     * the cap and the stored object adds `fingerprint` / `expiresAt` /
     * `createdAt` overhead on top of `responseJson`; a response whose
     * `responseJson` is just under the cap can still push the full record
     * over.
     */
    async record(
        user: UserContext,
        ownerExtensionId: string,
        key: string,
        fingerprint: string,
        response: unknown,
        ttlMs: number,
    ): Promise<void> {
        const responseJson = serializeResponse(response);
        if (responseJson === null) {
            // Serialization failed (e.g. circular references), the
            // response was `undefined`/a function/a symbol (so
            // `JSON.stringify` returned `undefined`), or the
            // `responseJson` itself was non-finite. Skip caching; a
            // future retry re-executes fn. The warning was already
            // logged inside serializeResponse.
            return;
        }
        const now = Date.now();
        const record: IdempotencyRecord = {
            responseJson,
            fingerprint,
            expiresAt: now + ttlMs,
            createdAt: now,
        };
        // Serialize the FULL record and check its byte size against
        // the cap. The stored KV value is this object (not just
        // `responseJson`), so production KV enforcement measures the
        // full record. A `responseJson` just under the cap can push
        // the full record over once `fingerprint` / `expiresAt` /
        // `createdAt` overhead is added; skip caching and log a
        // warning so a future retry re-executes fn.
        const recordJson = serializeRecord(record);
        if (recordJson === null) {
            // Record serialization failed OR returned `undefined`.
            // Skip caching; the warning was already logged inside
            // serializeRecord.
            return;
        }
        if (Buffer.byteLength(recordJson, 'utf8') > MAX_KV_VALUE_BYTES) {
            // The full record exceeds the cap. We do NOT truncate or
            // compress; a future retry re-executes fn.
            console.warn(
                `[authority] IdempotencyService.record: full record ${Buffer.byteLength(recordJson, 'utf8')} bytes exceeds ${MAX_KV_VALUE_BYTES} byte cap; caching skipped.`,
            );
            return;
        }
        await this.storage.setKv(user, ownerExtensionId, buildKvKey(ownerExtensionId, key), record);
    }

    /**
     * Idempotent execution with cached replay.
     *
     * 1. Look up the record by `ownerExtensionId` + `key`.
     * 2. If a non-expired record exists with a MATCHING fingerprint,
     *    return `JSON.parse(record.responseJson)` so the caller sees the
     *    same response the original successful call produced. `fn` is NOT
     *    called.
     * 3. If a non-expired record exists with a MISMATCHED fingerprint,
     *    throw `AuthorityServiceError(409, 'idempotency_conflict',
     *    'concurrency', { key, expectedFingerprint, actualFingerprint })`.
     *    The fingerprint mismatch means the caller retried with a different
     *    request body under the same idempotency key; this is a concurrency
     *    violation, not a recoverable retry.
     * 4. If no record exists (or the record is expired), execute `fn`. If
     *    `fn` resolves successfully, cache the result via `record(...)`
     *    and return it. If `fn` rejects, propagate the error WITHOUT
     *    caching — a retry after an error re-executes `fn`.
     *
     * Note: `run` does NOT take a `user` argument because the wrapper-level
     * callers always have a user; the underlying `getRecord`/`record`
     * methods take `user` and the wrapper passes it through.
     */
    async run<T>(
        user: UserContext,
        ownerExtensionId: string,
        key: string,
        fingerprint: string,
        fn: () => Promise<T>,
        ttlMs: number,
    ): Promise<T> {
        const existing = await this.getRecord(user, ownerExtensionId, key);
        if (existing) {
            if (existing.fingerprint === fingerprint) {
                // Cache hit: replay the cached response. JSON.parse is
                // safe here because `record(...)` only stores successfully
                // serialized JSON.
                return JSON.parse(existing.responseJson) as T;
            }
            // Fingerprint mismatch: the caller retried with a different
            // request body under the same idempotency key. Surface a
            // structured concurrency conflict so the caller can decide
            // whether to retry with a fresh key.
            throw new AuthorityServiceError(
                `Idempotency fingerprint mismatch for key '${key}'`,
                409,
                'idempotency_conflict',
                'concurrency',
                {
                    key,
                    expectedFingerprint: fingerprint,
                    actualFingerprint: existing.fingerprint,
                },
            );
        }
        // Cache miss or expired: execute fn. Errors propagate; the cache
        // is left untouched so a retry after an error re-executes fn.
        const result = await fn();
        // Best-effort cache. If the response is too large or fails to
        // serialize, `record(...)` logs a warning and returns without
        // storing; the next retry re-executes fn. This is the documented
        // "lost success cache" window for v1.
        await this.record(user, ownerExtensionId, key, fingerprint, result, ttlMs);
        return result;
    }
}

/**
 * Cached idempotency record stored in KV. `responseJson` is the JSON-
 * serialized successful response (the deserialized form is returned on
 * replay). `fingerprint` is the caller-supplied request fingerprint
 * (e.g. a hash of the request body); a mismatch on retry surfaces a 409
 * `idempotency_conflict`. `expiresAt` is epoch milliseconds; records
 * past this point are treated as not found. `createdAt` is preserved for
 * diagnostics.
 */
export interface IdempotencyRecord {
    responseJson: string;
    fingerprint: string;
    expiresAt: number;
    createdAt: number;
}

/**
 * Build the KV key for an idempotency record. The key is prefixed with
 * `idempotency:` (namespace) and `ownerExtensionId` (defense-in-depth on
 * top of the per-extension sqlite scoping) so two extensions picking the
 * same idempotency key cannot collide within the same per-extension
 * database.
 */
function buildKvKey(ownerExtensionId: string, key: string): string {
    return `idempotency:${ownerExtensionId}:${key}`;
}

/**
 * Serialize a response for KV storage. Returns `null` when:
 * - `JSON.stringify(response)` throws (e.g. circular references, BigInt), or
 * - `JSON.stringify(response)` returns `undefined` (when `response` is
 *   `undefined`, a function, or a symbol — `JSON.stringify` returns
 *   `undefined` for these top-level values rather than throwing).
 *
 * Both cases log a warning so the operator can see why a response was not
 * cached; the caller (`record`) treats `null` as "skip caching". The size
 * cap is NOT checked here; the caller checks the FULL serialized record
 * (including `fingerprint` / `expiresAt` / `createdAt` overhead) after
 * assembling the record.
 */
function serializeResponse(response: unknown): string | null {
    let responseJson: string | undefined;
    try {
        responseJson = JSON.stringify(response);
    } catch (error) {
        // The companion handler ctx has already validated response
        // serializability at the host boundary (module_response_not_serializable),
        // but a defensive try/catch here protects against edge cases like
        // BigInt or recursive structures that pass JSON.stringify's first
        // pass but fail on the second.
        console.warn(
            `[authority] IdempotencyService.record: failed to serialize response; caching skipped. Error: ${error instanceof Error ? error.message : String(error)}`,
        );
        return null;
    }
    if (responseJson === undefined) {
        // JSON.stringify returns `undefined` (not a string, and without
        // throwing) when the top-level value is `undefined`, a function,
        // or a symbol. The host boundary validation should catch these
        // before they reach the wrapper, but we check defensively so
        // `Buffer.byteLength` never receives a non-string argument
        // downstream.
        console.warn(
            `[authority] IdempotencyService.record: response serialized to undefined (undefined/function/symbol); caching skipped.`,
        );
        return null;
    }
    return responseJson;
}

/**
 * Serialize the full {@link IdempotencyRecord} for the KV value size
 * check. Returns `null` when:
 * - `JSON.stringify(record)` throws, or
 * - `JSON.stringify(record)` returns `undefined`.
 *
 * The record is a plain object with primitive fields, so this should never
 * fire in practice, but the check is defensive: if a future field type
 * changes introduce a non-serializable value, we skip caching rather than
 * crashing on `Buffer.byteLength(undefined, 'utf8')`. The size cap itself
 * is enforced by the caller (`record`), not here.
 */
function serializeRecord(record: IdempotencyRecord): string | null {
    let recordJson: string | undefined;
    try {
        recordJson = JSON.stringify(record);
    } catch (error) {
        console.warn(
            `[authority] IdempotencyService.record: failed to serialize record; caching skipped. Error: ${error instanceof Error ? error.message : String(error)}`,
        );
        return null;
    }
    if (recordJson === undefined) {
        // Should not happen for a plain record object, but check
        // defensively so `Buffer.byteLength` never receives a
        // non-string argument.
        console.warn(
            `[authority] IdempotencyService.record: record serialized to undefined; caching skipped.`,
        );
        return null;
    }
    return recordJson;
}

/**
 * Type guard for {@link IdempotencyRecord}. Defensive: if the stored value
 * was written by a future version with extra fields or a different shape,
 * treat it as not found so the caller re-executes fn.
 */
function isIdempotencyRecord(value: unknown): value is IdempotencyRecord {
    if (!value || typeof value !== 'object') {
        return false;
    }
    const record = value as Record<string, unknown>;
    return (
        typeof record.responseJson === 'string'
        && typeof record.fingerprint === 'string'
        && typeof record.expiresAt === 'number'
        && typeof record.createdAt === 'number'
    );
}

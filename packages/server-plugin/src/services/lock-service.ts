import { AuthorityServiceError } from '../utils.js';

/**
 * Per-process in-memory lock service for serializing work keyed by an
 * arbitrary `scopeKey`.
 *
 * Phase B scope: companion modules call `ctx.locks.withLock(...)` to
 * serialize per-resource work (e.g. per-chat graph commits) so two
 * concurrent transactions targeting the same resource cannot interleave
 * their reads and writes. Locks are per-process only: they are NOT
 * crash-durable and NOT cross-process. The ST server is a single
 * process; that invariant is what makes this safe. Idempotency (Phase C)
 * provides durability across crashes; this service provides in-process
 * concurrency safety only.
 *
 * Boundary contract (non-negotiable):
 *
 * - Per-process only. NOT crash-durable. NOT cross-process. Single-process
 *   ST server invariant.
 * - Locks are held in a single in-memory `Map<string, Promise<unknown>>`
 *   keyed by `scopeKey`. No persistence, no IPC, no file-based locking.
 * - Locks are released in a `finally` block when the holder's `fn`
 *   settles (success or failure). A throwing `fn` still releases the
 *   lock; the error propagates to the caller.
 * - Timeout: when `options.timeoutMs` is provided and positive, lock
 *   acquisition races against a timer. If the timer fires before the
 *   lock is acquired, the service throws
 *   `AuthorityServiceError(408, 'lock_timeout', 'concurrency', { scopeKey, timeoutMs })`.
 *   The timed-out waiter never acquired the lock, so it does NOT
 *   unblock later waiters: the chain tail it published stays pending
 *   until the current holder releases. A new caller arriving after the
 *   timeout chains on that pending tail and waits for the holder.
 * - No nested acquisition detection for v1. Acquiring the same scopeKey
 *   nestedly from the same async context WILL deadlock because the
 *   second call waits on the first's promise. Companion modules must
 *   not do this. Document as a known limitation; future work could add
 *   re-entrancy tracking if a real use case emerges.
 * - No fairness guarantees beyond FIFO ordering through the promise
 *   chain. Waiters are served in the order they called `withLock`.
 *
 * Implementation note: each `withLock` call chains on the current
 * promise for `scopeKey` and stores its own chained promise
 * (`previous.then(() => ourRelease)`) as the new latest. The chained
 * promise settles only when BOTH the previous holder has released AND
 * this caller has called `releaseOurs()` — so a timed-out waiter's
 * chained promise stays pending until the current holder releases,
 * preventing later waiters from bypassing the holder. Map entry
 * cleanup is deferred until the chained promise actually settles, and
 * gated on an identity check (`map.get(scopeKey) === chained`) so a
 * later waiter's entry is never deleted by an earlier one. This keeps
 * the map from growing unboundedly with stale Promise references
 * without risking deletion while a holder is still active.
 */
export class LockService {
    private readonly locks = new Map<string, Promise<unknown>>();

    /**
     * Serialize `fn` against all other `withLock` calls for the same
     * `scopeKey`. The lock is acquired after all prior waiters for this
     * scopeKey finish (success or failure), held while `fn` runs, and
     * released in a `finally` block when `fn` settles.
     *
     * @param scopeKey Arbitrary non-empty string identifying the lock
     *                 scope. Callers are responsible for prefixing
     *                 scopeKeys to avoid cross-module interference; the
     *                 companion `ctx.locks` wrapper does this
     *                 automatically using the owner extension id.
     * @param options  Optional `{ timeoutMs }`. When positive, lock
     *                 acquisition races against a timer; if the timer
     *                 fires first, throws
     *                 `AuthorityServiceError(408, 'lock_timeout', 'concurrency', { scopeKey, timeoutMs })`.
     * @param fn       Async function to run while holding the lock. Its
     *                 return value is returned to the caller. If it
     *                 throws, the error propagates to the caller; the
     *                 lock is still released.
     * @returns        Whatever `fn` returns.
     */
    async withLock<T>(
        scopeKey: string,
        options: { timeoutMs?: number },
        fn: () => Promise<T>,
    ): Promise<T> {
        // Capture the current chain tail. Each waiter chains on the
        // previous tail so FIFO ordering is preserved through the
        // promise chain: a later caller cannot skip the waiters that
        // registered before it.
        const previous = this.locks.get(scopeKey) ?? Promise.resolve();
        let releaseOurs!: () => void;
        const ourRelease = new Promise<void>((resolve) => {
            releaseOurs = resolve;
        });
        // `chained` settles only when BOTH `previous` has settled AND
        // we have called `releaseOurs()`. The next waiter captures
        // `chained` as their `previous`, so they wait for our turn to
        // end — not merely for us to register. This is what preserves
        // FIFO ordering under contention.
        const chained = previous.then(() => ourRelease);
        this.locks.set(scopeKey, chained);

        // Acquisition waits only for `previous` to settle (the prior
        // holder to release). It does NOT wait for `ourRelease`.
        const acquire = previous.then(() => undefined);

        // Track whether we actually acquired the lock. A timed-out
        // waiter never acquired and must NOT delete the map entry
        // synchronously (the current holder is still running).
        let acquired = false;

        let timer: ReturnType<typeof setTimeout> | undefined;
        try {
            if (options.timeoutMs && options.timeoutMs > 0) {
                const timeoutMs = options.timeoutMs;
                const timeoutPromise = new Promise<never>((_, reject) => {
                    timer = setTimeout(() => {
                        reject(
                            new AuthorityServiceError(
                                `Lock acquisition timed out after ${timeoutMs} ms for scope '${scopeKey}'`,
                                408,
                                'lock_timeout',
                                'concurrency',
                                { scopeKey, timeoutMs },
                            ),
                        );
                    }, timeoutMs);
                    // Allow the Node process to exit even if the timer is
                    // still pending (companion modules should not hang the
                    // process, but the timeout is the safety net).
                    if (
                        timer
                        && typeof timer === 'object'
                        && 'unref' in timer
                        && typeof timer.unref === 'function'
                    ) {
                        timer.unref();
                    }
                });
                try {
                    await Promise.race([acquire, timeoutPromise]);
                } finally {
                    if (timer) {
                        clearTimeout(timer);
                    }
                }
            } else {
                await acquire;
            }
            acquired = true;
            return await fn();
        } finally {
            // Always resolve `ourRelease`. If we acquired and ran fn,
            // this unblocks the next waiter once `previous` has also
            // settled. If we timed out before acquiring, this is
            // harmless: `chained` is still gated on `previous` (the
            // current holder's release), so later waiters do NOT skip
            // the current holder. This is the crux of the Phase B fix
            // — a timed-out waiter must not let later waiters bypass
            // the current holder.
            releaseOurs();
            if (acquired) {
                // Synchronous cleanup: we acquired, so `previous` has
                // settled and we just resolved `ourRelease`. If our
                // `chained` is still the latest map entry (no later
                // waiter registered), delete it now so the map does
                // not retain a stale Promise reference. If a later
                // waiter registered, the map points to their chained
                // promise and we leave it alone; they will clean it
                // up themselves when they settle.
                if (this.locks.get(scopeKey) === chained) {
                    this.locks.delete(scopeKey);
                }
            } else {
                // We timed out before acquiring. The current holder
                // is still running, so `chained` is still pending
                // (gated on `previous`). Synchronous cleanup here
                // would delete the map entry while the holder is
                // still active — allowing a new caller to see an
                // empty map and acquire immediately, running
                // concurrently with the holder (the Phase B
                // blocker). Defer cleanup until `chained` actually
                // settles (i.e., the current holder releases AND
                // `ourRelease` has been resolved, which we just
                // did). The identity check ensures we only delete
                // our own entry; a later waiter's entry is left for
                // them to clean up.
                chained.then(() => {
                    if (this.locks.get(scopeKey) === chained) {
                        this.locks.delete(scopeKey);
                    }
                });
            }
        }
    }
}

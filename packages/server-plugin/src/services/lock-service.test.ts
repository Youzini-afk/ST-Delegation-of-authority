import { describe, expect, it } from 'vitest';
import { AuthorityServiceError } from '../utils.js';
import { LockService } from './lock-service.js';

/**
 * Direct unit tests for the in-memory `LockService`.
 *
 * The wrapper-level tests in `companion-module-loader-service.test.ts`
 * exercise the `ctx.locks` capability end-to-end through a companion
 * module; these tests exercise the underlying service directly so a
 * regression in the chained-promise / finally-release logic surfaces
 * without going through the companion loader.
 */
describe('LockService', () => {
    it('serializes concurrent calls to the same scopeKey (FIFO ordering)', async () => {
        const service = new LockService();
        const order: string[] = [];

        const slowFn = async (label: string): Promise<string> => {
            order.push(`start:${label}`);
            await new Promise(resolve => setTimeout(resolve, 30));
            order.push(`end:${label}`);
            return label;
        };

        const results = await Promise.all([
            service.withLock('scope', {}, () => slowFn('A')),
            service.withLock('scope', {}, () => slowFn('B')),
            service.withLock('scope', {}, () => slowFn('C')),
        ]);

        // Return values are preserved in caller order.
        expect(results).toEqual(['A', 'B', 'C']);
        // Each waiter's start strictly follows the prior waiter's end.
        // FIFO ordering comes from the promise-chain structure.
        expect(order).toEqual([
            'start:A', 'end:A',
            'start:B', 'end:B',
            'start:C', 'end:C',
        ]);
    });

    it('runs different scopeKeys concurrently (no cross-scope serialization)', async () => {
        const service = new LockService();
        const startTimes: number[] = [];

        const fn = async (): Promise<void> => {
            startTimes.push(Date.now());
            await new Promise(resolve => setTimeout(resolve, 60));
        };

        await Promise.all([
            service.withLock('scope-1', {}, fn),
            service.withLock('scope-2', {}, fn),
        ]);

        // Both should start within ~30 ms of each other (concurrent).
        // The 60 ms hold time means serialized execution would yield a
        // >= 60 ms gap; we allow a generous 30 ms tolerance for jitter.
        expect(startTimes).toHaveLength(2);
        const gap = Math.abs(startTimes[0]! - startTimes[1]!);
        expect(gap).toBeLessThan(30);
    });

    it('throws lock_timeout when the lock cannot be acquired within timeoutMs', async () => {
        const service = new LockService();
        // Hold the lock for 200 ms.
        const holder = service.withLock('scope', {}, async () => {
            await new Promise(resolve => setTimeout(resolve, 200));
            return 'holder';
        });
        // Try to acquire with a 50 ms timeout.
        let caught: unknown;
        try {
            await service.withLock('scope', { timeoutMs: 50 }, async () => 'fast');
        } catch (error) {
            caught = error;
        }
        expect(caught).toBeInstanceOf(AuthorityServiceError);
        const err = caught as AuthorityServiceError;
        expect(err.status).toBe(408);
        expect(err.code).toBe('lock_timeout');
        expect(err.category).toBe('concurrency');
        const details = err.details as { scopeKey: string; timeoutMs: number };
        expect(details.scopeKey).toBe('scope');
        expect(details.timeoutMs).toBe(50);

        // Wait for the holder to finish so the test cleans up.
        await holder;
    });

    it('releases the lock after a timeout so the next caller can acquire it', async () => {
        const service = new LockService();
        // Hold the lock for 100 ms.
        const holder = service.withLock('scope', {}, async () => {
            await new Promise(resolve => setTimeout(resolve, 100));
            return 'holder';
        });
        // Wait for the holder to finish.
        await holder;
        // Now the lock should be free; a new caller should succeed without
        // a timeout, even though the prior caller's chain was set in the
        // map and the timeout path left it in place. The finally block
        // must have released + cleaned up.
        const result = await service.withLock('scope', { timeoutMs: 500 }, async () => 'after');
        expect(result).toBe('after');
    });

    it('propagates fn errors to the caller AND releases the lock', async () => {
        const service = new LockService();
        await expect(
            service.withLock('scope', {}, async () => {
                throw new Error('boom');
            }),
        ).rejects.toThrow('boom');
        // The lock should be released even though fn threw; the next
        // caller should succeed immediately without a timeout.
        const result = await service.withLock('scope', { timeoutMs: 500 }, async () => 'ok');
        expect(result).toBe('ok');
    });

    it('cleans up the map entry in finally (no stale Promise references)', async () => {
        const service = new LockService();
        // Access the private field via a cast for whitebox inspection.
        const locks = (service as unknown as { locks: Map<string, Promise<unknown>> }).locks;
        expect(locks.size).toBe(0);

        await service.withLock('scope', {}, async () => 'first');
        // After the only waiter settles, the map entry should be deleted.
        expect(locks.size).toBe(0);

        await service.withLock('scope', {}, async () => {
            await new Promise(resolve => setTimeout(resolve, 10));
            return 'second';
        });
        expect(locks.size).toBe(0);
    });

    it('cleans up the map entry when concurrent waiters all settle', async () => {
        const service = new LockService();
        const locks = (service as unknown as { locks: Map<string, Promise<unknown>> }).locks;

        await Promise.all([
            service.withLock('scope', {}, async () => {
                await new Promise(resolve => setTimeout(resolve, 10));
                return 'a';
            }),
            service.withLock('scope', {}, async () => {
                await new Promise(resolve => setTimeout(resolve, 10));
                return 'b';
            }),
            service.withLock('scope', {}, async () => {
                await new Promise(resolve => setTimeout(resolve, 10));
                return 'c';
            }),
        ]);

        // After all three settle, the map should be empty.
        expect(locks.size).toBe(0);
    });

    it('cleans up the map entry when fn throws', async () => {
        const service = new LockService();
        const locks = (service as unknown as { locks: Map<string, Promise<unknown>> }).locks;

        await expect(
            service.withLock('scope', {}, async () => {
                throw new Error('boom');
            }),
        ).rejects.toThrow('boom');

        // The map entry must be deleted even when fn threw.
        expect(locks.size).toBe(0);
    });

    it('cleans up the map entry when acquisition times out', async () => {
        const service = new LockService();
        const locks = (service as unknown as { locks: Map<string, Promise<unknown>> }).locks;

        // Hold the lock for 100 ms.
        const holder = service.withLock('scope', {}, async () => {
            await new Promise(resolve => setTimeout(resolve, 100));
            return 'holder';
        });

        // Time out trying to acquire.
        await expect(
            service.withLock('scope', { timeoutMs: 30 }, async () => 'never'),
        ).rejects.toThrow();

        // Wait for the holder to finish so cleanup runs.
        await holder;

        // The timed-out waiter's map entry is NOT deleted synchronously
        // (that was the Phase B blocker: it would delete while the holder
        // was still active). Cleanup is deferred until the chain tail
        // settles, which happens in a microtask after the holder's
        // release propagates. Drain microtasks before asserting.
        await new Promise(resolve => setTimeout(resolve, 0));

        // The map entry should be deleted once the chain settles.
        expect(locks.size).toBe(0);
    });

    it('returns the fn return value to the caller', async () => {
        const service = new LockService();
        const result = await service.withLock('scope', {}, async () => ({ value: 42 }));
        expect(result).toEqual({ value: 42 });
    });

    it('treats a missing timeoutMs as "wait forever" (no timeout error)', async () => {
        const service = new LockService();
        // Hold the lock briefly; a concurrent caller with no timeout should
        // simply wait and then succeed.
        const holder = service.withLock('scope', {}, async () => {
            await new Promise(resolve => setTimeout(resolve, 50));
            return 'holder';
        });
        const result = await service.withLock('scope', {}, async () => 'after');
        await holder;
        expect(result).toBe('after');
    });

    it('treats a zero or negative timeoutMs as "no timeout" (defensive)', async () => {
        const service = new LockService();
        // Hold the lock briefly.
        const holder = service.withLock('scope', {}, async () => {
            await new Promise(resolve => setTimeout(resolve, 50));
            return 'holder';
        });
        // timeoutMs = 0 must NOT throw; the service treats non-positive
        // timeouts as "no timeout" rather than "immediate timeout".
        const result = await service.withLock('scope', { timeoutMs: 0 }, async () => 'zero');
        await holder;
        expect(result).toBe('zero');
    });

    // ----------------------------------------------------------------
    // Phase B blocker regression tests.
    //
    // The original implementation had a cleanup bug: when a waiter
    // timed out before acquiring, its `finally` block synchronously
    // deleted the map entry (if its chained promise was still the
    // latest) EVEN THOUGH the current holder was still running. A new
    // caller arriving after the timeout then saw an empty map and
    // acquired immediately, running concurrently with the holder.
    // This violated the required serialization/FIFO invariant.
    //
    // The fix defers map cleanup until the waiter's chained promise
    // actually settles (i.e., the prior holder has released AND the
    // waiter has released its own slot). A timed-out waiter's chained
    // promise stays pending until the current holder releases, so a
    // later caller chains on that pending promise and waits.
    // ----------------------------------------------------------------

    it('new caller C after waiter B timeout but before holder A release waits for A', async () => {
        const service = new LockService();
        const events: string[] = [];

        // A acquires and holds for 200 ms.
        const holderA = service.withLock('scope', {}, async () => {
            events.push('A:start');
            await new Promise(resolve => setTimeout(resolve, 200));
            events.push('A:end');
            return 'A';
        });

        // Let A acquire and start running.
        await new Promise(resolve => setTimeout(resolve, 20));

        // B tries to acquire with a 50 ms timeout. B times out while A
        // still holds the lock.
        await expect(
            service.withLock('scope', { timeoutMs: 50 }, async () => 'B'),
        ).rejects.toMatchObject({ code: 'lock_timeout' });
        events.push('B:timed-out');

        // C calls withLock AFTER B timed out but BEFORE A releases. C
        // must wait for A to release; it must NOT run concurrently with
        // A. (Phase B blocker regression: previously B's timeout
        // cleanup deleted the map entry, so C saw an empty map and
        // acquired immediately, running concurrently with A.)
        const callerC = service.withLock('scope', {}, async () => {
            events.push('C:start');
            await new Promise(resolve => setTimeout(resolve, 10));
            events.push('C:end');
            return 'C';
        });

        // While A is still holding, C must not have started.
        await new Promise(resolve => setTimeout(resolve, 50));
        expect(events).not.toContain('C:start');

        await holderA;
        const cResult = await callerC;
        expect(cResult).toBe('C');

        // C must have started AFTER A ended (no concurrent execution).
        const aEndIdx = events.indexOf('A:end');
        const cStartIdx = events.indexOf('C:start');
        expect(aEndIdx).toBeGreaterThanOrEqual(0);
        expect(cStartIdx).toBeGreaterThan(aEndIdx);
    });

    it('timed-out waiter does not corrupt map (entry remains pending so C chains on the prior holder)', async () => {
        const service = new LockService();
        const locks = (service as unknown as { locks: Map<string, Promise<unknown>> }).locks;

        // A acquires and holds for 200 ms.
        const holderA = service.withLock('scope', {}, async () => {
            await new Promise(resolve => setTimeout(resolve, 200));
            return 'A';
        });
        // Let A acquire and set the map entry.
        await new Promise(resolve => setTimeout(resolve, 20));
        expect(locks.size).toBe(1);

        // B times out trying to acquire.
        await expect(
            service.withLock('scope', { timeoutMs: 30 }, async () => 'B'),
        ).rejects.toMatchObject({ code: 'lock_timeout' });

        // Critical invariant: the map entry must NOT have been deleted
        // by B's timeout cleanup. A new caller C arriving now must chain
        // on the existing entry and wait for A to release, rather than
        // seeing an empty map and acquiring immediately (which would
        // run concurrently with A — the Phase B blocker).
        expect(locks.size).toBe(1);
        const entryAfterTimeout = locks.get('scope');
        expect(entryAfterTimeout).toBeDefined();

        // The entry must still be pending (A has not released yet).
        // It represents the chain tail and only settles when the
        // current holder releases.
        let entrySettled = false;
        void entryAfterTimeout!.then(() => { entrySettled = true; });
        await new Promise(resolve => setTimeout(resolve, 10));
        expect(entrySettled).toBe(false);

        // After A releases, the entry settles and the deferred cleanup
        // removes it from the map.
        await holderA;
        // Drain microtasks so the deferred cleanup runs.
        await new Promise(resolve => setTimeout(resolve, 10));
        expect(entrySettled).toBe(true);
        expect(locks.size).toBe(0);
    });

    it('a third waiter D after B and C timeouts still chains on the holder', async () => {
        // Stress test: multiple successive timeouts must not corrupt
        // the chain. Each timed-out waiter publishes a chained promise
        // that stays pending until the holder releases; the next
        // waiter chains on that pending promise, not on an empty map.
        const service = new LockService();
        const events: string[] = [];

        const holderA = service.withLock('scope', {}, async () => {
            events.push('A:start');
            await new Promise(resolve => setTimeout(resolve, 200));
            events.push('A:end');
            return 'A';
        });
        await new Promise(resolve => setTimeout(resolve, 20));

        // B times out, then C times out, then D times out — all while A
        // holds the lock. Each must NOT delete the map entry.
        await expect(
            service.withLock('scope', { timeoutMs: 30 }, async () => 'B'),
        ).rejects.toMatchObject({ code: 'lock_timeout' });
        await expect(
            service.withLock('scope', { timeoutMs: 30 }, async () => 'C'),
        ).rejects.toMatchObject({ code: 'lock_timeout' });
        await expect(
            service.withLock('scope', { timeoutMs: 30 }, async () => 'D'),
        ).rejects.toMatchObject({ code: 'lock_timeout' });

        // After three timeouts, the map must still have a single entry
        // (the chain tail) that is pending because A still holds.
        const locks = (service as unknown as { locks: Map<string, Promise<unknown>> }).locks;
        expect(locks.size).toBe(1);
        const tail = locks.get('scope');
        expect(tail).toBeDefined();
        let tailSettled = false;
        void tail!.then(() => { tailSettled = true; });
        await new Promise(resolve => setTimeout(resolve, 10));
        expect(tailSettled).toBe(false);

        // E arrives after all the timeouts but before A releases. E
        // must wait for A.
        const callerE = service.withLock('scope', {}, async () => {
            events.push('E:start');
            return 'E';
        });
        await new Promise(resolve => setTimeout(resolve, 30));
        expect(events).not.toContain('E:start');

        await holderA;
        const eResult = await callerE;
        expect(eResult).toBe('E');
        expect(events).toContain('E:start');
        // E started after A ended.
        expect(events.indexOf('E:start')).toBeGreaterThan(events.indexOf('A:end'));
    });
});

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { SseBroker } from '../events/sse-broker.js';
import { JobService } from './job-service.js';
import type { UserContext } from '../types.js';

describe('JobService', () => {
    const dirs: string[] = [];

    beforeEach(() => {
        vi.useFakeTimers();
    });

    afterEach(() => {
        vi.useRealTimers();
        while (dirs.length > 0) {
            const dir = dirs.pop();
            if (dir) {
                fs.rmSync(dir, { recursive: true, force: true });
            }
        }
    });

    it('creates and completes builtin delay jobs', async () => {
        const user = createUser(dirs);
        const jobs = new JobService(new SseBroker());

        const job = jobs.create(user, 'third-party/ext-a', 'delay', { durationMs: 500, message: 'done' });
        expect(job.status).toBe('queued');

        await vi.advanceTimersByTimeAsync(250);
        expect(jobs.get(user, job.id)?.status).toBe('running');

        await vi.advanceTimersByTimeAsync(500);
        const completed = jobs.get(user, job.id);
        expect(completed?.status).toBe('completed');
        expect(completed?.progress).toBe(100);
        expect(completed?.summary).toBe('done');
    });

    it('cancels inflight jobs', () => {
        const user = createUser(dirs);
        const jobs = new JobService(new SseBroker());

        const job = jobs.create(user, 'third-party/ext-a', 'delay', { durationMs: 2000 });
        const cancelled = jobs.cancel(user, 'third-party/ext-a', job.id);

        expect(cancelled.status).toBe('cancelled');
        expect(jobs.get(user, job.id)?.status).toBe('cancelled');
    });
});

function createUser(dirs: string[]): UserContext {
    const rootDir = fs.mkdtempSync(path.join(os.tmpdir(), 'authority-jobs-'));
    dirs.push(rootDir);
    return {
        handle: 'alice',
        isAdmin: false,
        rootDir,
    };
}

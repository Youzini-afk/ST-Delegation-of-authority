import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { JobService } from './job-service.js';
import type { CoreService } from './core-service.js';
import type { StoredJobRecord, UserContext } from '../types.js';

describe('JobService', () => {
    const dirs: string[] = [];

    afterEach(() => {
        while (dirs.length > 0) {
            const dir = dirs.pop();
            if (dir) {
                fs.rmSync(dir, { recursive: true, force: true });
            }
        }
    });

    it('creates builtin delay jobs through core', async () => {
        const user = createUser(dirs);
        const jobs = new JobService(createMockCore());

        const job = await jobs.create(user, 'third-party/ext-a', 'delay', { durationMs: 500, message: 'done' });
        expect(job.status).toBe('queued');
        expect(job.extensionId).toBe('third-party/ext-a');
        expect(await jobs.get(user, job.id)).toEqual(job);
    });

    it('cancels jobs through core', async () => {
        const user = createUser(dirs);
        const jobs = new JobService(createMockCore());

        const job = await jobs.create(user, 'third-party/ext-a', 'delay', { durationMs: 2000 });
        const cancelled = await jobs.cancel(user, 'third-party/ext-a', job.id);

        expect(cancelled.status).toBe('cancelled');
        expect((await jobs.get(user, job.id))?.status).toBe('cancelled');
    });
});

function createMockCore(): CoreService {
    const jobs = new Map<string, StoredJobRecord>();
    return {
        async listControlJobs(_dbPath: string, request: { extensionId?: string }) {
            return [...jobs.values()]
                .filter(job => !request.extensionId || job.extensionId === request.extensionId)
                .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt));
        },
        async getControlJob(_dbPath: string, request: { jobId: string }) {
            return jobs.get(request.jobId) ?? null;
        },
        async createControlJob(_dbPath: string, request: { extensionId: string; type: string; payload?: Record<string, unknown> }) {
            const timestamp = new Date().toISOString();
            const job: StoredJobRecord = {
                id: `job-${jobs.size + 1}`,
                extensionId: request.extensionId,
                type: request.type,
                status: 'queued',
                createdAt: timestamp,
                updatedAt: timestamp,
                progress: 0,
                channel: `extension:${request.extensionId}`,
                ...(request.payload ? { payload: request.payload } : {}),
            };
            jobs.set(job.id, job);
            return job;
        },
        async cancelControlJob(_dbPath: string, request: { extensionId: string; jobId: string }) {
            const job = jobs.get(request.jobId);
            if (!job || job.extensionId !== request.extensionId) {
                throw new Error('Job not found');
            }
            const next: StoredJobRecord = {
                ...job,
                status: 'cancelled',
                updatedAt: new Date().toISOString(),
                summary: 'Cancelled by user',
            };
            jobs.set(job.id, next);
            return next;
        },
    } as unknown as CoreService;
}

function createUser(dirs: string[]): UserContext {
    const rootDir = fs.mkdtempSync(path.join(os.tmpdir(), 'authority-jobs-'));
    dirs.push(rootDir);
    return {
        handle: 'alice',
        isAdmin: false,
        rootDir,
    };
}

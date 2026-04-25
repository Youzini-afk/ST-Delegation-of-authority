import { BUILTIN_JOB_TYPES } from '../constants.js';
import { SseBroker } from '../events/sse-broker.js';
import { getUserAuthorityPaths } from '../store/authority-paths.js';
import type { StoredJobRecord, UserContext } from '../types.js';
import { nowIso, randomToken } from '../utils.js';
import { CoreService } from './core-service.js';

interface InflightTask {
    timer: NodeJS.Timeout;
}

export class JobService {
    private readonly inflight = new Map<string, InflightTask>();

    constructor(
        private readonly events: SseBroker,
        private readonly core: CoreService,
    ) {}

    async list(user: UserContext, extensionId?: string): Promise<StoredJobRecord[]> {
        const paths = getUserAuthorityPaths(user);
        return await this.core.listControlJobs(paths.controlDbFile, {
            userHandle: user.handle,
            ...(extensionId ? { extensionId } : {}),
        });
    }

    async get(user: UserContext, jobId: string): Promise<StoredJobRecord | null> {
        const paths = getUserAuthorityPaths(user);
        return await this.core.getControlJob(paths.controlDbFile, {
            userHandle: user.handle,
            jobId,
        });
    }

    async create(user: UserContext, extensionId: string, type: string, payload: Record<string, unknown>): Promise<StoredJobRecord> {
        if (!BUILTIN_JOB_TYPES.includes(type as typeof BUILTIN_JOB_TYPES[number])) {
            throw new Error(`Unsupported job type: ${type}`);
        }

        const id = randomToken();
        const timestamp = nowIso();
        const job: StoredJobRecord = {
            id,
            extensionId,
            type,
            status: 'queued',
            createdAt: timestamp,
            updatedAt: timestamp,
            progress: 0,
            payload,
            channel: `extension:${extensionId}`,
        };

        await this.writeJob(user, job);
        this.runDelayJob(user, job);
        return job;
    }

    async cancel(user: UserContext, extensionId: string, jobId: string): Promise<StoredJobRecord> {
        const job = await this.get(user, jobId);
        if (!job || job.extensionId !== extensionId) {
            throw new Error('Job not found');
        }

        const task = this.inflight.get(jobId);
        if (task) {
            clearInterval(task.timer);
            this.inflight.delete(jobId);
        }

        const next: StoredJobRecord = {
            ...job,
            status: 'cancelled',
            updatedAt: nowIso(),
            summary: 'Cancelled by user',
        };
        await this.writeJob(user, next);
        this.events.emit(user.handle, extensionId, 'authority.job', next);
        return next;
    }

    private runDelayJob(user: UserContext, job: StoredJobRecord): void {
        const durationMs = Number(job.payload?.durationMs ?? 3000);
        const startedAt = Date.now();
        const timer = setInterval(() => {
            void this.advanceDelayJob(user, job, durationMs, startedAt, timer).catch(() => {
                clearInterval(timer);
                this.inflight.delete(job.id);
            });
        }, 250);

        this.inflight.set(job.id, { timer });

        void this.promoteDelayJob(user, job, durationMs).catch(() => {
            clearInterval(timer);
            this.inflight.delete(job.id);
        });
    }

    private async promoteDelayJob(user: UserContext, job: StoredJobRecord, durationMs: number): Promise<void> {
        const current = await this.get(user, job.id);
        if (!current || current.status === 'cancelled') {
            const task = this.inflight.get(job.id);
            if (task) {
                clearInterval(task.timer);
                this.inflight.delete(job.id);
            }
            return;
        }

        const runningJob: StoredJobRecord = {
            ...current,
            status: 'running',
            updatedAt: nowIso(),
            summary: `Running delay job for ${durationMs}ms`,
        };
        await this.writeJob(user, runningJob);
        this.events.emit(user.handle, job.extensionId, 'authority.job', runningJob);
    }

    private async advanceDelayJob(
        user: UserContext,
        job: StoredJobRecord,
        durationMs: number,
        startedAt: number,
        timer: NodeJS.Timeout,
    ): Promise<void> {
        const current = await this.get(user, job.id);
        if (!current || current.status === 'cancelled') {
            clearInterval(timer);
            this.inflight.delete(job.id);
            return;
        }

        const elapsed = Date.now() - startedAt;
        const progress = Math.min(100, Math.round((elapsed / durationMs) * 100));

        if (progress >= 100) {
            clearInterval(timer);
            this.inflight.delete(job.id);
            const completed: StoredJobRecord = {
                ...current,
                status: 'completed',
                progress: 100,
                updatedAt: nowIso(),
                summary: String(job.payload?.message ?? 'Delay completed'),
                result: {
                    elapsedMs: durationMs,
                    message: job.payload?.message ?? 'Delay completed',
                },
            };
            await this.writeJob(user, completed);
            this.events.emit(user.handle, job.extensionId, 'authority.job', completed);
            return;
        }

        const update: StoredJobRecord = {
            ...current,
            progress,
            updatedAt: nowIso(),
        };
        await this.writeJob(user, update);
        this.events.emit(user.handle, job.extensionId, 'authority.job', update);
    }

    private async writeJob(user: UserContext, job: StoredJobRecord): Promise<void> {
        const paths = getUserAuthorityPaths(user);
        await this.core.upsertControlJob(paths.controlDbFile, {
            userHandle: user.handle,
            job,
        });
    }
}


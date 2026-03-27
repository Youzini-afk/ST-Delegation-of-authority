import { BUILTIN_JOB_TYPES } from '../constants.js';
import { SseBroker } from '../events/sse-broker.js';
import { getUserAuthorityPaths } from '../store/authority-paths.js';
import type { JobsFile, StoredJobRecord, UserContext } from '../types.js';
import { atomicWriteJson, nowIso, randomToken, readJsonFile } from '../utils.js';

interface InflightTask {
    timer: NodeJS.Timeout;
}

export class JobService {
    private readonly inflight = new Map<string, InflightTask>();

    constructor(private readonly events: SseBroker) {}

    list(user: UserContext, extensionId?: string): StoredJobRecord[] {
        const paths = getUserAuthorityPaths(user);
        const file = readJsonFile<JobsFile>(paths.jobsFile, { entries: {} });
        return Object.values(file.entries)
            .filter(job => !extensionId || job.extensionId === extensionId)
            .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt));
    }

    get(user: UserContext, jobId: string): StoredJobRecord | null {
        return this.list(user).find(job => job.id === jobId) ?? null;
    }

    create(user: UserContext, extensionId: string, type: string, payload: Record<string, unknown>): StoredJobRecord {
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

        this.writeJob(user, job);
        this.runDelayJob(user, job);
        return job;
    }

    cancel(user: UserContext, extensionId: string, jobId: string): StoredJobRecord {
        const job = this.get(user, jobId);
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
        this.writeJob(user, next);
        this.events.emit(user.handle, extensionId, 'authority.job', next);
        return next;
    }

    private runDelayJob(user: UserContext, job: StoredJobRecord): void {
        const durationMs = Number(job.payload?.durationMs ?? 3000);
        const startedAt = Date.now();

        const runningJob: StoredJobRecord = {
            ...job,
            status: 'running',
            updatedAt: nowIso(),
            summary: `Running delay job for ${durationMs}ms`,
        };
        this.writeJob(user, runningJob);
        this.events.emit(user.handle, job.extensionId, 'authority.job', runningJob);

        const timer = setInterval(() => {
            const current = this.get(user, job.id);
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
                this.writeJob(user, completed);
                this.events.emit(user.handle, job.extensionId, 'authority.job', completed);
                return;
            }

            const update: StoredJobRecord = {
                ...current,
                progress,
                updatedAt: nowIso(),
            };
            this.writeJob(user, update);
            this.events.emit(user.handle, job.extensionId, 'authority.job', update);
        }, 250);

        this.inflight.set(job.id, { timer });
    }

    private writeJob(user: UserContext, job: StoredJobRecord): void {
        const paths = getUserAuthorityPaths(user);
        const file = readJsonFile<JobsFile>(paths.jobsFile, { entries: {} });
        file.entries[job.id] = job;
        atomicWriteJson(paths.jobsFile, file);
    }
}


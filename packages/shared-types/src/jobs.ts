import type { CursorPageInfo, CursorPageRequest, JobStatus } from './common.js';

export type JobAttemptEvent = 'started' | 'retryScheduled' | 'completed' | 'failed' | 'cancelled' | 'recovered';

export interface JobAttemptRecord {
    attempt: number;
    event: JobAttemptEvent;
    timestamp: string;
    summary?: string;
    error?: string;
    backoffMs?: number;
}

export interface JobRecord {
    id: string;
    extensionId: string;
    type: string;
    status: JobStatus;
    createdAt: string;
    updatedAt: string;
    progress: number;
    summary?: string;
    error?: string;
    startedAt?: string;
    finishedAt?: string;
    timeoutMs?: number;
    idempotencyKey?: string;
    attempt?: number;
    maxAttempts?: number;
    cancelRequestedAt?: string;
    attemptHistory?: JobAttemptRecord[];
}

export interface JobListRequest {
    page?: CursorPageRequest;
}

export interface JobListResponse {
    jobs: JobRecord[];
    page: CursorPageInfo;
}

import type { ControlJobCreateRequest } from '@stdo/shared-types';
import { BUILTIN_JOB_TYPES } from '../constants.js';
import { getUserAuthorityPaths } from '../store/authority-paths.js';
import type { StoredJobRecord, UserContext } from '../types.js';
import { CoreService } from './core-service.js';

export interface JobCreateOptions {
    timeoutMs?: number;
    idempotencyKey?: string;
    maxAttempts?: number;
}

export class JobService {
    constructor(private readonly core: CoreService) {}

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

    async create(user: UserContext, extensionId: string, type: string, payload: Record<string, unknown>, options: Record<string, unknown> = {}): Promise<StoredJobRecord> {
        if (!BUILTIN_JOB_TYPES.includes(type as typeof BUILTIN_JOB_TYPES[number])) {
            throw new Error(`Unsupported job type: ${type}`);
        }

        const paths = getUserAuthorityPaths(user);
        const request: ControlJobCreateRequest = {
            userHandle: user.handle,
            extensionId,
            type,
            payload,
        };
        if (typeof options.timeoutMs === 'number') request.timeoutMs = options.timeoutMs;
        if (typeof options.idempotencyKey === 'string') request.idempotencyKey = options.idempotencyKey;
        if (typeof options.maxAttempts === 'number') request.maxAttempts = options.maxAttempts;
        return await this.core.createControlJob(paths.controlDbFile, request);
    }

    async cancel(user: UserContext, extensionId: string, jobId: string): Promise<StoredJobRecord> {
        const paths = getUserAuthorityPaths(user);
        return await this.core.cancelControlJob(paths.controlDbFile, {
            userHandle: user.handle,
            extensionId,
            jobId,
        });
    }
}


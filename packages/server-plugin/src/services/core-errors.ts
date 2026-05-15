import type { AuthorityErrorCategory, AuthorityErrorCode } from '@stdo/shared-types';
import { AuthorityServiceError } from '../utils.js';

export function extractCoreErrorMessage(payload: unknown, statusCode: number): string {
    if (payload && typeof payload === 'object' && 'error' in payload) {
        return String((payload as { error: unknown }).error);
    }

    if (typeof payload === 'string' && payload.trim()) {
        return payload.trim();
    }

    return `authority-core request failed with ${statusCode}`;
}

export function buildCoreRequestError(requestPath: string, payload: unknown, statusCode: number): AuthorityServiceError {
    const message = extractCoreErrorMessage(payload, statusCode);
    const coreCode = extractCoreErrorCode(payload, message);
    const backpressure = mapCoreBackpressureError(coreCode, statusCode);
    if (backpressure) {
        return new AuthorityServiceError(message, backpressure.status, backpressure.code, backpressure.category, {
            requestPath,
            source: 'core',
            statusCode,
        });
    }

    if (statusCode === 408 || statusCode === 504 || /timed?\s*out|timeout/i.test(message)) {
        return new AuthorityServiceError(message, statusCode, 'timeout', 'timeout', {
            requestPath,
            source: 'core',
            statusCode,
        });
    }

    if (statusCode === 413 || statusCode === 429 || /exceeds|too large|max/i.test(message)) {
        return new AuthorityServiceError(message, statusCode, 'limit_exceeded', 'limit', {
            requestPath,
            source: 'core',
            statusCode,
        });
    }

    if (statusCode >= 400 && statusCode < 500) {
        return new AuthorityServiceError(message, statusCode, 'validation_error', 'validation', {
            requestPath,
            source: 'core',
            statusCode,
        });
    }

    return new AuthorityServiceError(message, statusCode >= 500 ? statusCode : 500, 'core_request_failed', 'core', {
        requestPath,
        source: 'core',
        statusCode,
    });
}

export function extractCoreErrorCode(payload: unknown, message: string): string | null {
    if (payload && typeof payload === 'object') {
        for (const key of ['code', 'errorCode', 'kind']) {
            if (key in payload) {
                const value = (payload as Record<string, unknown>)[key];
                if (typeof value === 'string' && value.trim()) {
                    return value.trim();
                }
            }
        }
    }

    if (/\bjob_queue_full\b|\bqueue_full\b/i.test(message)) {
        return 'job_queue_full';
    }
    if (/\bconcurrency_limit_exceeded\b/i.test(message)) {
        return 'concurrency_limit_exceeded';
    }

    return null;
}

export function mapCoreBackpressureError(code: string | null, statusCode: number): { status: number; code: AuthorityErrorCode; category: AuthorityErrorCategory } | null {
    if (statusCode !== 503) {
        return null;
    }

    if (code === 'job_queue_full' || code === 'queue_full') {
        return { status: 503, code: 'job_queue_full', category: 'backpressure' };
    }

    if (code === 'concurrency_limit_exceeded') {
        return { status: 503, code: 'concurrency_limit_exceeded', category: 'backpressure' };
    }

    return null;
}

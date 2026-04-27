import { getRequestHeaders } from '/script.js';
import type { AuthorityErrorCategory, AuthorityErrorCode, AuthorityErrorPayload } from '@stdo/shared-types';
import { AUTHORITY_VERSION } from './version.js';

export const AUTHORITY_API_BASE = '/api/plugins/authority';
export const AUTHORITY_EXTENSION_NAME = 'third-party/st-authority-sdk';
export const AUTHORITY_EXTENSION_ID = 'third-party/st-authority-sdk';
export const AUTHORITY_EXTENSION_DISPLAY_NAME = '扩展权限中心';
export const AUTHORITY_EXTENSION_VERSION = AUTHORITY_VERSION;
export const SESSION_HEADER = 'x-authority-session-token';

export interface AuthorityRequestOptions {
    method?: 'GET' | 'POST';
    body?: unknown;
    sessionToken?: string;
    signal?: AbortSignal;
}

export class AuthorityApiError extends Error {
    readonly code: AuthorityErrorCode | undefined;
    readonly category: AuthorityErrorCategory | undefined;
    readonly details: AuthorityErrorPayload['details'] | undefined;

    constructor(
        message: string,
        public readonly status: number,
        public readonly payload?: unknown,
    ) {
        super(message);
        this.name = 'AuthorityApiError';
        if (isAuthorityErrorPayload(payload)) {
            this.code = payload.code;
            this.category = payload.category;
            this.details = payload.details;
        }
    }
}

export class AuthorityAuthError extends AuthorityApiError {
    constructor(message: string, status: number, payload?: unknown) {
        super(message, status, payload);
        this.name = 'AuthorityAuthError';
    }
}

export class AuthoritySessionError extends AuthorityApiError {
    constructor(message: string, status: number, payload?: unknown) {
        super(message, status, payload);
        this.name = 'AuthoritySessionError';
    }
}

export class AuthorityValidationError extends AuthorityApiError {
    constructor(message: string, status: number, payload?: unknown) {
        super(message, status, payload);
        this.name = 'AuthorityValidationError';
    }
}

export class AuthorityLimitError extends AuthorityApiError {
    constructor(message: string, status: number, payload?: unknown) {
        super(message, status, payload);
        this.name = 'AuthorityLimitError';
    }
}

export class AuthorityTimeoutError extends AuthorityApiError {
    constructor(message: string, status: number, payload?: unknown) {
        super(message, status, payload);
        this.name = 'AuthorityTimeoutError';
    }
}

export class AuthorityCoreError extends AuthorityApiError {
    constructor(message: string, status: number, payload?: unknown) {
        super(message, status, payload);
        this.name = 'AuthorityCoreError';
    }
}

export async function authorityRequest<T>(path: string, options: AuthorityRequestOptions = {}): Promise<T> {
    const hasBody = options.body !== undefined;
    const headers = {
        ...getRequestHeaders({ omitContentType: !hasBody }),
    };

    if (!hasBody) {
        delete headers['Content-Type'];
    }

    if (options.sessionToken) {
        headers[SESSION_HEADER] = options.sessionToken;
    }

    const requestInit: RequestInit = {
        method: options.method ?? (hasBody ? 'POST' : 'GET'),
        headers,
    };

    if (hasBody) {
        requestInit.body = JSON.stringify(options.body);
    }

    if (options.signal) {
        requestInit.signal = options.signal;
    }

    const response = await fetch(`${AUTHORITY_API_BASE}${path}`, requestInit);

    if (response.status === 204) {
        return undefined as T;
    }

    const payload = await readResponsePayload(response);
    if (!response.ok) {
        throw createAuthorityApiError(getErrorMessage(payload, response.statusText), response.status, payload);
    }

    return payload as T;
}

export function isInvalidSessionError(error: unknown): boolean {
    return error instanceof AuthoritySessionError && error.code === 'invalid_session';
}

export function buildEventStreamUrl(sessionToken: string, channel: string): string {
    const url = new URL(`${AUTHORITY_API_BASE}/events/stream`, window.location.origin);
    url.searchParams.set('authoritySessionToken', sessionToken);
    url.searchParams.set('channel', channel);
    return url.toString();
}

export function hostnameFromUrl(url: string): string {
    return new URL(url, window.location.origin).hostname.toLowerCase();
}

async function readResponsePayload(response: Response): Promise<unknown> {
    const contentType = response.headers.get('content-type') ?? '';
    if (contentType.includes('application/json')) {
        return await response.json();
    }

    const text = await response.text();
    return text || undefined;
}

function getErrorMessage(payload: unknown, fallback: string): string {
    if (typeof payload === 'string' && payload.trim()) {
        return payload.trim();
    }

    if (payload && typeof payload === 'object' && 'error' in payload) {
        return String((payload as { error: unknown }).error);
    }

    return fallback || '权限中心请求失败';
}

function isAuthorityErrorPayload(payload: unknown): payload is AuthorityErrorPayload {
    return typeof payload === 'object'
        && payload !== null
        && 'error' in payload
        && typeof (payload as { error?: unknown }).error === 'string';
}

function createAuthorityApiError(message: string, status: number, payload?: unknown): AuthorityApiError {
    const category = isAuthorityErrorPayload(payload) ? payload.category : undefined;
    switch (category) {
        case 'permission':
            return new AuthorityApiError(message, status, payload);
        case 'auth':
            return new AuthorityAuthError(message, status, payload);
        case 'session':
            return new AuthoritySessionError(message, status, payload);
        case 'validation':
            return new AuthorityValidationError(message, status, payload);
        case 'limit':
            return new AuthorityLimitError(message, status, payload);
        case 'timeout':
            return new AuthorityTimeoutError(message, status, payload);
        case 'core':
            return new AuthorityCoreError(message, status, payload);
        default:
            break;
    }

    if (status === 401) {
        return new AuthorityAuthError(message, status, payload);
    }
    if (status === 408 || status === 504) {
        return new AuthorityTimeoutError(message, status, payload);
    }
    if (status === 413 || status === 429) {
        return new AuthorityLimitError(message, status, payload);
    }
    if (status >= 400 && status < 500) {
        return new AuthorityValidationError(message, status, payload);
    }
    return new AuthorityCoreError(message, status, payload);
}

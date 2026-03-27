import { getRequestHeaders } from '/script.js';

export const AUTHORITY_API_BASE = '/api/plugins/authority';
export const AUTHORITY_EXTENSION_NAME = 'third-party/st-authority-sdk';
export const AUTHORITY_EXTENSION_ID = 'third-party/st-authority-sdk';
export const AUTHORITY_EXTENSION_DISPLAY_NAME = 'Authority Security Center';
export const AUTHORITY_EXTENSION_VERSION = '0.1.0';
export const SESSION_HEADER = 'x-authority-session-token';

export interface AuthorityRequestOptions {
    method?: 'GET' | 'POST';
    body?: unknown;
    sessionToken?: string;
    signal?: AbortSignal;
}

export class AuthorityApiError extends Error {
    constructor(
        message: string,
        public readonly status: number,
        public readonly payload?: unknown,
    ) {
        super(message);
        this.name = 'AuthorityApiError';
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
        throw new AuthorityApiError(getErrorMessage(payload, response.statusText), response.status, payload);
    }

    return payload as T;
}

export function isInvalidSessionError(error: unknown): boolean {
    return error instanceof AuthorityApiError && /authority session/i.test(error.message);
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

    return fallback || 'Authority request failed';
}

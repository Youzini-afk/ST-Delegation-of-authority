import { getRequestHeaders } from '/script.js';
export const AUTHORITY_API_BASE = '/api/plugins/authority';
export const AUTHORITY_EXTENSION_NAME = 'third-party/st-authority-sdk';
export const AUTHORITY_EXTENSION_ID = 'third-party/st-authority-sdk';
export const AUTHORITY_EXTENSION_DISPLAY_NAME = 'Authority Security Center';
export const AUTHORITY_EXTENSION_VERSION = '0.1.0';
export const SESSION_HEADER = 'x-authority-session-token';
export class AuthorityApiError extends Error {
    status;
    payload;
    constructor(message, status, payload) {
        super(message);
        this.status = status;
        this.payload = payload;
        this.name = 'AuthorityApiError';
    }
}
export async function authorityRequest(path, options = {}) {
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
    const requestInit = {
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
        return undefined;
    }
    const payload = await readResponsePayload(response);
    if (!response.ok) {
        throw new AuthorityApiError(getErrorMessage(payload, response.statusText), response.status, payload);
    }
    return payload;
}
export function isInvalidSessionError(error) {
    return error instanceof AuthorityApiError && /authority session/i.test(error.message);
}
export function buildEventStreamUrl(sessionToken, channel) {
    const url = new URL(`${AUTHORITY_API_BASE}/events/stream`, window.location.origin);
    url.searchParams.set('authoritySessionToken', sessionToken);
    url.searchParams.set('channel', channel);
    return url.toString();
}
export function hostnameFromUrl(url) {
    return new URL(url, window.location.origin).hostname.toLowerCase();
}
async function readResponsePayload(response) {
    const contentType = response.headers.get('content-type') ?? '';
    if (contentType.includes('application/json')) {
        return await response.json();
    }
    const text = await response.text();
    return text || undefined;
}
function getErrorMessage(payload, fallback) {
    if (typeof payload === 'string' && payload.trim()) {
        return payload.trim();
    }
    if (payload && typeof payload === 'object' && 'error' in payload) {
        return String(payload.error);
    }
    return fallback || 'Authority request failed';
}
//# sourceMappingURL=api.js.map
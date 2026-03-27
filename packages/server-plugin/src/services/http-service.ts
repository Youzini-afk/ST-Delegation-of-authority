import type { UserContext } from '../types.js';
import { MAX_HTTP_BODY_BYTES, MAX_HTTP_RESPONSE_BYTES } from '../constants.js';
import { normalizeHostname } from '../utils.js';

export interface HttpFetchInput {
    url: string;
    method?: string;
    headers?: Record<string, string>;
    body?: string;
}

export class HttpService {
    async fetch(_user: UserContext, input: HttpFetchInput): Promise<Record<string, unknown>> {
        const bodySize = Buffer.byteLength(input.body ?? '');
        if (bodySize > MAX_HTTP_BODY_BYTES) {
            throw new Error(`HTTP request body exceeds ${MAX_HTTP_BODY_BYTES} bytes`);
        }

        const requestInit: RequestInit = {
            method: input.method ?? 'GET',
            headers: input.headers ?? {},
            redirect: 'follow',
        };

        if (input.body !== undefined) {
            requestInit.body = input.body;
        }

        const response = await fetch(input.url, requestInit);

        const buffer = Buffer.from(await response.arrayBuffer());
        if (buffer.byteLength > MAX_HTTP_RESPONSE_BYTES) {
            throw new Error(`HTTP response exceeds ${MAX_HTTP_RESPONSE_BYTES} bytes`);
        }

        const contentType = response.headers.get('content-type') ?? 'application/octet-stream';
        const isTextual = /(json|text|xml|javascript|html)/i.test(contentType);

        const headers: Record<string, string> = {};
        response.headers.forEach((value, key) => {
            headers[key] = value;
        });

        return {
            url: input.url,
            hostname: normalizeHostname(input.url),
            status: response.status,
            ok: response.ok,
            headers,
            body: isTextual ? buffer.toString('utf8') : buffer.toString('base64'),
            bodyEncoding: isTextual ? 'utf8' : 'base64',
            contentType,
        };
    }
}

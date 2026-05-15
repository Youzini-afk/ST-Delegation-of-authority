import type { HttpBodyEncoding } from './common.js';
import type { DataTransferInitResponse } from './transfers.js';

export interface ControlHttpFetchRequest {
    url: string;
    method?: string;
    headers?: Record<string, string>;
    body?: string;
    bodyEncoding?: HttpBodyEncoding;
    bodySourcePath?: string;
}

export interface ControlHttpFetchOpenRequest extends ControlHttpFetchRequest {
    responsePath: string;
}

export interface ControlHttpFetchOpenResponse {
    url: string;
    hostname: string;
    status: number;
    ok: boolean;
    headers: Record<string, string>;
    bodyEncoding: HttpBodyEncoding;
    contentType: string;
    sizeBytes: number;
}

export interface HttpFetchRequest {
    url: string;
    method?: string;
    headers?: Record<string, string>;
    body?: string;
    bodyEncoding?: HttpBodyEncoding;
}

export interface HttpFetchResponse {
    url: string;
    hostname: string;
    status: number;
    ok: boolean;
    headers: Record<string, string>;
    body: string;
    bodyEncoding: HttpBodyEncoding;
    contentType: string;
}

export interface HttpFetchOpenRequest extends HttpFetchRequest {
    bodyTransferId?: string;
}

export interface HttpFetchOpenInlineResponse extends HttpFetchResponse {
    mode: 'inline';
}

export interface HttpFetchOpenTransferResponse {
    mode: 'transfer';
    url: string;
    hostname: string;
    status: number;
    ok: boolean;
    headers: Record<string, string>;
    bodyEncoding: HttpBodyEncoding;
    contentType: string;
    transfer: DataTransferInitResponse;
}

export type HttpFetchOpenResponse = HttpFetchOpenInlineResponse | HttpFetchOpenTransferResponse;

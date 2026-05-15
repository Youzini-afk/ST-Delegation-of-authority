import type { DataTransferInitResponse } from './transfers.js';

export interface ControlKvGetRequest {
    key: string;
}

export interface ControlKvSetRequest {
    key: string;
    value: unknown;
}

export interface ControlKvDeleteRequest {
    key: string;
}

export interface ControlKvListRequest {}

export interface ControlKvResponse {
    value?: unknown;
}

export interface ControlKvListResponse {
    entries: Record<string, unknown>;
}

export interface BlobPutRequest {
    name: string;
    content: string;
    encoding?: 'utf8' | 'base64';
    contentType?: string;
}

export interface BlobRecord {
    id: string;
    name: string;
    contentType: string;
    size: number;
    updatedAt: string;
}

export interface BlobGetResponse {
    record: BlobRecord;
    content: string;
    encoding: 'base64';
}

export interface BlobOpenReadInlineResponse extends BlobGetResponse {
    mode: 'inline';
}

export interface BlobOpenReadTransferResponse {
    mode: 'transfer';
    record: BlobRecord;
    encoding: 'base64';
    transfer: DataTransferInitResponse;
}

export type BlobOpenReadResponse = BlobOpenReadInlineResponse | BlobOpenReadTransferResponse;

export interface ControlBlobScopeRequest {
    userHandle: string;
    extensionId: string;
    blobDir: string;
}

export interface ControlBlobPutRequest extends ControlBlobScopeRequest, BlobPutRequest {
    sourcePath?: string;
}

export interface ControlBlobGetRequest extends ControlBlobScopeRequest {
    id: string;
}

export interface ControlBlobOpenReadResponse {
    record: BlobRecord;
    sourcePath: string;
}

export interface ControlBlobDeleteRequest extends ControlBlobScopeRequest {
    id: string;
}

export interface ControlBlobListRequest extends ControlBlobScopeRequest {}

export interface ControlBlobListResponse {
    entries: BlobRecord[];
}

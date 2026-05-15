import type { AuthorityInlineThresholdKey, DataTransferResource } from './common.js';

export interface DataTransferInitRequest {
    resource: DataTransferResource;
    purpose?: AuthorityInlineThresholdKey;
}

export interface DataTransferInitResponse {
    transferId: string;
    resource: DataTransferResource;
    purpose?: AuthorityInlineThresholdKey;
    chunkSize: number;
    maxBytes: number;
    createdAt: string;
    updatedAt: string;
    sizeBytes: number;
    direction: 'upload' | 'download';
    checksumSha256?: string;
    resumable: boolean;
}

export interface DataTransferAppendRequest {
    offset: number;
    content: string;
}

export interface DataTransferAppendResponse {
    transferId: string;
    sizeBytes: number;
    updatedAt: string;
    checksumSha256: string;
}

export type DataTransferStatusResponse = DataTransferInitResponse;

export interface DataTransferManifestChunk {
    index: number;
    offset: number;
    sizeBytes: number;
    checksumSha256: string;
}

export interface DataTransferManifestResponse {
    transferId: string;
    resource: DataTransferResource;
    purpose?: AuthorityInlineThresholdKey;
    chunkSize: number;
    maxBytes: number;
    createdAt: string;
    updatedAt: string;
    sizeBytes: number;
    direction: 'upload' | 'download';
    checksumSha256?: string;
    resumable: boolean;
    chunkCount: number;
    chunks: DataTransferManifestChunk[];
}

export interface DataTransferReadRequest {
    offset: number;
    limit?: number;
}

export interface DataTransferReadResponse {
    transferId: string;
    offset: number;
    content: string;
    encoding: 'base64';
    sizeBytes: number;
    eof: boolean;
    updatedAt: string;
    checksumSha256?: string;
}

export interface BlobTransferCommitRequest {
    transferId: string;
    name: string;
    contentType?: string;
    expectedChecksumSha256?: string;
}

export interface PrivateFileTransferCommitRequest {
    transferId: string;
    path: string;
    createParents?: boolean;
    expectedChecksumSha256?: string;
}

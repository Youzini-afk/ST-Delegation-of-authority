import type { PrivateFileEncoding, PrivateFileKind } from './common.js';
import type { DataTransferInitResponse } from './transfers.js';

export interface PrivateFileEntry {
    name: string;
    path: string;
    kind: PrivateFileKind;
    sizeBytes: number;
    updatedAt: string;
}

export interface PrivateFileUsageSummary {
    fileCount: number;
    directoryCount: number;
    totalSizeBytes: number;
    latestUpdatedAt: string | null;
}

export interface PrivateFileScopeRequest {
    path: string;
}

export interface PrivateFileMkdirRequest extends PrivateFileScopeRequest {
    recursive?: boolean;
}

export interface PrivateFileReadDirRequest extends PrivateFileScopeRequest {
    limit?: number;
}

export interface PrivateFileWriteRequest extends PrivateFileScopeRequest {
    content: string;
    encoding?: PrivateFileEncoding;
    createParents?: boolean;
}

export interface PrivateFileReadRequest extends PrivateFileScopeRequest {
    encoding?: PrivateFileEncoding;
}

export interface PrivateFileDeleteRequest extends PrivateFileScopeRequest {
    recursive?: boolean;
}

export interface PrivateFileStatRequest extends PrivateFileScopeRequest {}

export interface PrivateFileResponse {
    entry: PrivateFileEntry;
}

export interface PrivateFileReadResponse {
    entry: PrivateFileEntry;
    content: string;
    encoding: PrivateFileEncoding;
}

export interface PrivateFileOpenReadInlineResponse extends PrivateFileReadResponse {
    mode: 'inline';
}

export interface PrivateFileOpenReadTransferResponse {
    mode: 'transfer';
    entry: PrivateFileEntry;
    encoding: PrivateFileEncoding;
    transfer: DataTransferInitResponse;
}

export type PrivateFileOpenReadResponse = PrivateFileOpenReadInlineResponse | PrivateFileOpenReadTransferResponse;

export interface PrivateFileListResponse {
    entries: PrivateFileEntry[];
}

export interface PrivateFileDeleteResponse {
    ok: true;
}

export interface ControlPrivateFileScopeRequest extends PrivateFileScopeRequest {
    rootDir: string;
}

export interface ControlPrivateFileMkdirRequest extends ControlPrivateFileScopeRequest {
    recursive?: boolean;
}

export interface ControlPrivateFileReadDirRequest extends ControlPrivateFileScopeRequest {
    limit?: number;
}

export interface ControlPrivateFileWriteRequest extends ControlPrivateFileScopeRequest {
    content: string;
    encoding?: PrivateFileEncoding;
    createParents?: boolean;
    sourcePath?: string;
}

export interface ControlPrivateFileReadRequest extends ControlPrivateFileScopeRequest {
    encoding?: PrivateFileEncoding;
}

export interface ControlPrivateFileOpenReadResponse {
    entry: PrivateFileEntry;
    sourcePath: string;
}

export interface ControlPrivateFileDeleteRequest extends ControlPrivateFileScopeRequest {
    recursive?: boolean;
}

export interface ControlPrivateFileStatRequest extends ControlPrivateFileScopeRequest {}

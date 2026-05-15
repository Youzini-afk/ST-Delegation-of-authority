export type NativeMigrationTarget = 'data' | 'third-party';

export type NativeMigrationApplyMode = 'skip' | 'overwrite';

export type NativeMigrationEntryAction = 'create' | 'overwrite' | 'reject';

export type NativeMigrationOperationStatus = 'previewed' | 'applying' | 'applied' | 'rolling_back' | 'rolled_back' | 'failed' | 'needs_rollback';

export interface NativeMigrationPreviewRequest {
    target: NativeMigrationTarget;
    transferId: string;
    fileName?: string;
}

export interface NativeMigrationApplyRequest {
    operationId: string;
    mode: NativeMigrationApplyMode;
}

export interface NativeMigrationRollbackRequest {
    operationId: string;
}

export interface NativeMigrationEntryPreview {
    archivePath: string;
    targetPath: string;
    sizeBytes: number;
    compressedSizeBytes: number;
    action: NativeMigrationEntryAction;
    reason?: string;
}

export interface NativeMigrationJournalEntry {
    archivePath: string;
    targetPath: string;
    action: 'created' | 'overwritten' | 'skipped' | 'pending_overwrite';
    sizeBytes: number;
    checksumSha256?: string;
    previousChecksumSha256?: string;
    backupPath?: string;
}

export interface NativeMigrationOperation {
    id: string;
    target: NativeMigrationTarget;
    status: NativeMigrationOperationStatus;
    createdAt: string;
    updatedAt: string;
    sourceFileName: string;
    sourceSizeBytes: number;
    entryCount: number;
    totalSizeBytes: number;
    skippedCount: number;
    createdCount: number;
    overwrittenCount: number;
    warnings: string[];
    error?: string;
    entries?: NativeMigrationEntryPreview[];
    journal?: NativeMigrationJournalEntry[];
}

export interface NativeMigrationOperationListResponse {
    operations: NativeMigrationOperation[];
}

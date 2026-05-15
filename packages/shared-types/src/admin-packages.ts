import type { DataTransferInitResponse } from './transfers.js';
import type { BlobRecord } from './storage.js';
import type { ControlGrantRecord, ControlPoliciesResponse } from './control.js';
import type { AuthorityUsageSummaryResponse } from './diagnostics.js';
import type { ControlExtensionRecord } from './session.js';
import type { SqlDatabaseRecord } from './sql.js';
import type { TriviumDatabaseRecord } from './trivium.js';

export type AuthorityPackageImportMode = 'merge' | 'replace';

export type AuthorityPackageOperationKind = 'export' | 'import';

export type AuthorityPackageOperationStatus = 'queued' | 'running' | 'completed' | 'failed';

export interface AuthorityPackageArtifactSummary {
    fileName: string;
    mediaType: string;
    sizeBytes: number;
    checksumSha256: string;
}

export interface AuthorityArtifactDownloadResponse {
    artifact: AuthorityPackageArtifactSummary;
    transfer: DataTransferInitResponse;
}

export interface AuthorityPortableBlobPackageEntry {
    record: BlobRecord;
    contentBase64: string;
    checksumSha256: string;
}

export interface AuthorityPortablePrivateFilePackageEntry {
    path: string;
    sizeBytes: number;
    updatedAt: string | null;
    contentBase64: string;
    checksumSha256: string;
}

export interface AuthorityPortableSqlDatabasePackageEntry {
    record: SqlDatabaseRecord;
    contentBase64: string;
    checksumSha256: string;
}

export interface AuthorityPortableTriviumDatabasePackageEntry {
    record: TriviumDatabaseRecord;
    databaseContentBase64: string;
    databaseChecksumSha256: string;
    mappingContentBase64?: string;
    mappingChecksumSha256?: string;
}

export interface AuthorityPortableExtensionPackage {
    extension: ControlExtensionRecord;
    grants: ControlGrantRecord[];
    kvEntries: Record<string, unknown>;
    blobs: AuthorityPortableBlobPackageEntry[];
    files: AuthorityPortablePrivateFilePackageEntry[];
    sqlDatabases: AuthorityPortableSqlDatabasePackageEntry[];
    triviumDatabases: AuthorityPortableTriviumDatabasePackageEntry[];
}

export interface AuthorityPortablePackageManifest {
    format: 'authority-portable-package-v1';
    generatedAt: string;
    extensionIds: string[];
    includesPolicies: boolean;
    includesUsageSummary: boolean;
}

export interface AuthorityPortablePackage {
    manifest: AuthorityPortablePackageManifest;
    policies?: ControlPoliciesResponse;
    usageSummary?: AuthorityUsageSummaryResponse;
    extensions: AuthorityPortableExtensionPackage[];
}

export interface AuthorityPortablePackageArchiveFileEntry {
    path: string;
    mediaType: string;
    sizeBytes: number;
    checksumSha256: string;
}

export interface AuthorityPortableBlobArchiveEntry {
    record: BlobRecord;
    archivePath: string;
    sizeBytes: number;
    checksumSha256: string;
}

export interface AuthorityPortablePrivateFileArchiveEntry {
    path: string;
    archivePath: string;
    sizeBytes: number;
    updatedAt: string | null;
    checksumSha256: string;
}

export interface AuthorityPortableSqlDatabaseArchiveEntry {
    record: SqlDatabaseRecord;
    archivePath: string;
    sizeBytes: number;
    checksumSha256: string;
}

export interface AuthorityPortableTriviumDatabaseArchiveEntry {
    record: TriviumDatabaseRecord;
    databaseArchivePath: string;
    databaseSizeBytes: number;
    databaseChecksumSha256: string;
    mappingArchivePath?: string;
    mappingSizeBytes?: number;
    mappingChecksumSha256?: string;
}

export interface AuthorityPortablePackageArchiveExtension {
    extensionId: string;
    extensionPath: string;
    grantsPath: string;
    kvEntriesPath: string;
    blobs: AuthorityPortableBlobArchiveEntry[];
    files: AuthorityPortablePrivateFileArchiveEntry[];
    sqlDatabases: AuthorityPortableSqlDatabaseArchiveEntry[];
    triviumDatabases: AuthorityPortableTriviumDatabaseArchiveEntry[];
}

export interface AuthorityPortablePackageArchiveManifest {
    format: 'authority-portable-package-archive-v2';
    generatedAt: string;
    packageManifest: AuthorityPortablePackageManifest;
    entries: AuthorityPortablePackageArchiveFileEntry[];
    policiesPath?: string;
    usageSummaryPath?: string;
    extensions: AuthorityPortablePackageArchiveExtension[];
}

export interface AuthorityExportPackageRequest {
    extensionIds?: string[];
    includePolicies?: boolean;
    includeUsageSummary?: boolean;
}

export interface AuthorityPackageImportSummary {
    extensionCount: number;
    grantCount: number;
    kvEntryCount: number;
    blobCount: number;
    fileCount: number;
    sqlDatabaseCount: number;
    triviumDatabaseCount: number;
    policyExtensionCount: number;
}

export interface AuthorityPackageImportRequest {
    transferId: string;
    mode?: AuthorityPackageImportMode;
    fileName?: string;
}

export interface AuthorityPackageOperation {
    id: string;
    kind: AuthorityPackageOperationKind;
    status: AuthorityPackageOperationStatus;
    progress: number;
    summary?: string;
    error?: string;
    createdAt: string;
    updatedAt: string;
    startedAt?: string;
    finishedAt?: string;
    exportRequest?: AuthorityExportPackageRequest;
    importMode?: AuthorityPackageImportMode;
    sourceFileName?: string;
    artifact?: AuthorityPackageArtifactSummary;
    importSummary?: AuthorityPackageImportSummary;
    warnings?: string[];
}

export interface AuthorityPackageOperationListResponse {
    operations: AuthorityPackageOperation[];
}

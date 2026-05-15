import type { CursorPageInfo } from './common.js';
import type { AuthorityGrant, AuthorityPolicyEntry } from './permissions.js';
import type { ControlAuditRecentResponse, ControlPoliciesResponse } from './control.js';
import type { JobListResponse, JobRecord } from './jobs.js';
import type { AuthorityProbeResponse } from './probe.js';
import type { PrivateFileUsageSummary } from './private-fs.js';
import type { ControlExtensionRecord } from './session.js';
import type { SqlDatabaseRecord } from './sql.js';
import type { TriviumDatabaseRecord } from './trivium.js';

export interface AuthorityExtensionStorageSummary {
    kvEntries: number;
    blobCount: number;
    blobBytes: number;
    databaseCount: number;
    databaseBytes: number;
    sqlDatabaseCount: number;
    sqlDatabaseBytes: number;
    triviumDatabaseCount: number;
    triviumDatabaseBytes: number;
    files: PrivateFileUsageSummary;
}

export interface AuthorityUsageSummaryExtension {
    extension: ControlExtensionRecord;
    grantedCount: number;
    deniedCount: number;
    storage: AuthorityExtensionStorageSummary;
}

export interface AuthorityUsageSummaryTotals extends AuthorityExtensionStorageSummary {
    extensionCount: number;
}

export interface AuthorityUsageSummaryResponse {
    generatedAt: string;
    totals: AuthorityUsageSummaryTotals;
    extensions: AuthorityUsageSummaryExtension[];
}

export interface AuthorityDiagnosticExtensionSnapshot {
    extension: ControlExtensionRecord;
    grants: AuthorityGrant[];
    policies: AuthorityPolicyEntry[];
    activity: ControlAuditRecentResponse;
    jobs: JobRecord[];
    jobsPage: CursorPageInfo;
    databases: SqlDatabaseRecord[];
    triviumDatabases: TriviumDatabaseRecord[];
    storage: AuthorityExtensionStorageSummary;
}

export interface AuthorityDiagnosticBundleResponse {
    generatedAt: string;
    probe: AuthorityProbeResponse;
    policies: ControlPoliciesResponse;
    usageSummary: AuthorityUsageSummaryResponse;
    jobs: JobListResponse;
    releaseMetadata: Record<string, unknown> | null;
    extensions: AuthorityDiagnosticExtensionSnapshot[];
}

export interface AuthorityDiagnosticArchiveFile {
    path: string;
    mediaType: string;
    encoding: 'utf8' | 'base64';
    content: string;
    sizeBytes: number;
    checksumSha256: string;
}

export interface AuthorityDiagnosticBundleArchive {
    format: 'authority-diagnostic-bundle-archive-v1';
    generatedAt: string;
    files: AuthorityDiagnosticArchiveFile[];
}

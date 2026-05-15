import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import type {
    AuthorityDiagnosticArchiveFile,
    AuthorityDiagnosticBundleArchive,
    AuthorityDiagnosticBundleResponse,
    AuthorityExportPackageRequest,
    AuthorityPackageArtifactSummary,
    AuthorityPackageImportRequest,
    AuthorityPackageImportSummary,
    AuthorityPackageOperation,
    AuthorityPortableBlobArchiveEntry,
    AuthorityPortableExtensionPackage,
    AuthorityPortablePackage,
    AuthorityPortablePackageArchiveExtension,
    AuthorityPortablePackageArchiveManifest,
    AuthorityPortablePrivateFileArchiveEntry,
    AuthorityPortableSqlDatabaseArchiveEntry,
    AuthorityPortableTriviumDatabaseArchiveEntry,
    BlobRecord,
    ControlExtensionRecord,
    ControlGrantRecord,
    ControlPoliciesResponse,
    SqlDatabaseRecord,
    TriviumDatabaseRecord,
} from '@stdo/shared-types';
import { getGlobalAuthorityPaths, getUserAuthorityPaths } from '../store/authority-paths.js';
import type { UserContext } from '../types.js';
import { asErrorMessage, atomicWriteJson, ensureDir, nowIso, readJsonFile, resolveContainedPath, sanitizeFileSegment } from '../utils.js';
import { CoreService } from './core-service.js';
import { ExtensionService } from './extension-service.js';
import { PermissionService } from './permission-service.js';
import { PolicyService } from './policy-service.js';
import { PrivateFsService } from './private-fs-service.js';
import { StorageService } from './storage-service.js';
import { TriviumService } from './trivium-service.js';
import { createZipArchive, isZipArchive, readZipArchive } from './zip-archive.js';
import {
    buildArchiveFileEntry,
    buildArtifactSummary,
    buildIndexedArchivePath,
    decodeBase64Checked,
    hashBytes,
    hashText,
    newestTimestamp,
    normalizeExportRequest,
    sanitizeArtifactFileName,
    sanitizeTimestamp,
    tryGunzip,
    type ArchiveBuildFile,
} from './admin-package-helpers.js';

interface StoredPackageOperation extends AuthorityPackageOperation {
    artifactPath?: string | undefined;
    sourcePath?: string | undefined;
}

interface OperationArtifactLocation {
    artifact: AuthorityPackageArtifactSummary;
    filePath: string;
}

interface PortablePackageReadResult {
    portablePackage: AuthorityPortablePackage;
    warnings: string[];
}

const PORTABLE_PACKAGE_FORMAT = 'authority-portable-package-v1';
const PORTABLE_PACKAGE_ARCHIVE_FORMAT = 'authority-portable-package-archive-v2';
const PORTABLE_PACKAGE_ARCHIVE_MANIFEST_PATH = 'manifest.json';
const DIAGNOSTIC_ARCHIVE_FORMAT = 'authority-diagnostic-bundle-archive-v1';
const OPERATION_RECOVERY_ERROR = 'operation_recovery_required';

export class AdminPackageService {
    private readonly recoveredUsers = new Set<string>();

    constructor(
        private readonly core: CoreService,
        private readonly extensions: ExtensionService,
        private readonly permissions: PermissionService,
        private readonly policies: PolicyService,
        private readonly storage: StorageService,
        private readonly files: PrivateFsService,
        private readonly trivium: TriviumService,
    ) {}

    listOperations(user: UserContext): AuthorityPackageOperation[] {
        this.recoverUserOperations(user);
        return this.loadOperations(user)
            .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt))
            .map(operation => this.toPublicOperation(operation));
    }

    getOperation(user: UserContext, operationId: string): AuthorityPackageOperation | null {
        this.recoverUserOperations(user);
        const operation = this.loadOperation(user, operationId);
        return operation ? this.toPublicOperation(operation) : null;
    }

    startExport(user: UserContext, request: AuthorityExportPackageRequest = {}): AuthorityPackageOperation {
        this.recoverUserOperations(user);
        const timestamp = nowIso();
        const operation: StoredPackageOperation = {
            id: crypto.randomUUID(),
            kind: 'export',
            status: 'queued',
            progress: 0,
            createdAt: timestamp,
            updatedAt: timestamp,
            exportRequest: normalizeExportRequest(request),
            warnings: [],
        };
        this.saveOperation(user, operation);
        this.runOperation(user, operation.id);
        return this.toPublicOperation(operation);
    }

    startImport(user: UserContext, request: AuthorityPackageImportRequest, sourcePath: string): AuthorityPackageOperation {
        this.recoverUserOperations(user);
        const timestamp = nowIso();
        const operationId = crypto.randomUUID();
        const workDir = this.getOperationWorkDir(user, operationId);
        ensureDir(workDir);
        const sourceFileName = sanitizeArtifactFileName((request.fileName ?? path.basename(sourcePath)) || 'authority-package.authoritypkg.zip');
        const storedSourcePath = path.join(workDir, sourceFileName);
        fs.copyFileSync(sourcePath, storedSourcePath);
        const operation: StoredPackageOperation = {
            id: operationId,
            kind: 'import',
            status: 'queued',
            progress: 0,
            createdAt: timestamp,
            updatedAt: timestamp,
            importMode: request.mode === 'merge' ? 'merge' : 'replace',
            sourceFileName,
            sourcePath: storedSourcePath,
            warnings: [],
        };
        this.saveOperation(user, operation);
        this.runOperation(user, operation.id);
        return this.toPublicOperation(operation);
    }

    resume(user: UserContext, operationId: string): AuthorityPackageOperation {
        this.recoverUserOperations(user);
        const operation = this.requireOperation(user, operationId);
        if (operation.status !== 'failed') {
            throw new Error('Only failed import/export operations can be resumed');
        }
        const resetOperation: StoredPackageOperation = {
            ...operation,
            status: 'queued',
            progress: 0,
            updatedAt: nowIso(),
            warnings: [],
        };
        delete resetOperation.summary;
        delete resetOperation.error;
        delete resetOperation.startedAt;
        delete resetOperation.finishedAt;
        if (operation.kind === 'export') {
            delete resetOperation.artifact;
            delete resetOperation.artifactPath;
            delete resetOperation.importSummary;
            delete resetOperation.sourceFileName;
        }
        if (operation.artifactPath) {
            fs.rmSync(operation.artifactPath, { force: true });
        }
        this.saveOperation(user, resetOperation);
        this.runOperation(user, operationId);
        return this.toPublicOperation(resetOperation);
    }

    getArtifact(user: UserContext, operationId: string): OperationArtifactLocation {
        this.recoverUserOperations(user);
        const operation = this.requireOperation(user, operationId);
        if (!operation.artifact || !operation.artifactPath || !fs.existsSync(operation.artifactPath)) {
            throw new Error('Operation artifact is not available');
        }
        return {
            artifact: operation.artifact,
            filePath: operation.artifactPath,
        };
    }

    createDiagnosticArchive(user: UserContext, bundle: AuthorityDiagnosticBundleResponse): OperationArtifactLocation {
        this.recoverUserOperations(user);
        const generatedAt = bundle.generatedAt || nowIso();
        const archive: AuthorityDiagnosticBundleArchive = {
            format: DIAGNOSTIC_ARCHIVE_FORMAT,
            generatedAt,
            files: this.buildDiagnosticArchiveFiles(bundle),
        };
        const fileName = `authority-diagnostic-bundle-${sanitizeTimestamp(generatedAt)}.json.gz`;
        return this.writeStandaloneArtifact(user, 'diagnostic', fileName, archive);
    }

    private runOperation(user: UserContext, operationId: string): void {
        void Promise.resolve().then(async () => {
            const current = this.requireOperation(user, operationId);
            if (current.kind === 'export') {
                await this.executeExport(user, current);
                return;
            }
            await this.executeImport(user, current);
        }).catch(() => undefined);
    }

    private async executeExport(user: UserContext, operation: StoredPackageOperation): Promise<void> {
        let current = this.markRunning(user, operation);
        try {
            const request = normalizeExportRequest(current.exportRequest);
            const extensions = await this.resolveExportExtensions(user, request.extensionIds);
            const totalSteps = Math.max(3, extensions.length * 6 + 2);
            let completedSteps = 0;

            current = this.updateProgress(user, current.id, completedSteps, totalSteps, '正在收集高层导出包元数据');
            const nextPackage: AuthorityPortablePackage = {
                manifest: {
                    format: PORTABLE_PACKAGE_FORMAT,
                    generatedAt: nowIso(),
                    extensionIds: extensions.map(extension => extension.id),
                    includesPolicies: request.includePolicies !== false,
                    includesUsageSummary: request.includeUsageSummary !== false,
                },
                extensions: [],
            };

            if (request.includePolicies !== false) {
                nextPackage.policies = await this.policies.getPolicies(user);
            }
            completedSteps += 1;
            current = this.updateProgress(user, current.id, completedSteps, totalSteps, '已读取管理员策略');

            if (request.includeUsageSummary !== false) {
                nextPackage.usageSummary = await this.buildUsageSummary(user, extensions);
            }
            completedSteps += 1;
            current = this.updateProgress(user, current.id, completedSteps, totalSteps, '已读取 usage summary');

            for (const extension of extensions) {
                const extensionPackage = await this.exportExtensionPackage(user, extension, phase => {
                    completedSteps += 1;
                    current = this.updateProgress(
                        user,
                        current.id,
                        completedSteps,
                        totalSteps,
                        `${extension.displayName || extension.id} · ${phase}`,
                    );
                });
                nextPackage.extensions.push(extensionPackage);
            }

            const artifact = this.writePortablePackageArtifact(user, current.id, nextPackage);
            current = this.completeOperation(user, current.id, {
                progress: 100,
                summary: `已生成 ${nextPackage.extensions.length} 个扩展的高层导出包`,
                artifact: artifact.artifact,
                artifactPath: artifact.filePath,
            });
        } catch (error) {
            this.failOperation(user, current.id, error);
        }
    }

    private async executeImport(user: UserContext, operation: StoredPackageOperation): Promise<void> {
        let current = this.markRunning(user, operation);
        try {
            if (!current.sourcePath || !fs.existsSync(current.sourcePath)) {
                throw new Error('Import source package is not available');
            }
            const readResult = this.readPortablePackage(current.sourcePath);
            const portablePackage = readResult.portablePackage;
            const totalSteps = Math.max(2, portablePackage.extensions.length * 5 + (portablePackage.policies ? 1 : 0));
            let completedSteps = 0;
            const mode = current.importMode === 'merge' ? 'merge' : 'replace';
            const summary: AuthorityPackageImportSummary = {
                extensionCount: portablePackage.extensions.length,
                grantCount: 0,
                kvEntryCount: 0,
                blobCount: 0,
                fileCount: 0,
                sqlDatabaseCount: 0,
                triviumDatabaseCount: 0,
                policyExtensionCount: portablePackage.policies ? Object.keys(portablePackage.policies.extensions).length : 0,
            };
            const warnings: string[] = [...readResult.warnings];

            if (portablePackage.policies) {
                if (mode === 'replace') {
                    await this.replacePolicies(user, portablePackage.policies);
                } else {
                    await this.mergePolicies(user, portablePackage.policies);
                }
                completedSteps += 1;
                current = this.updateProgress(user, current.id, completedSteps, totalSteps, '已回放管理员策略');
            }

            for (const extensionPackage of portablePackage.extensions) {
                if (mode === 'replace') {
                    await this.clearExtensionState(user, extensionPackage.extension.id);
                }
                await this.importExtensionPackage(user, extensionPackage, summary, warnings);
                completedSteps += 5;
                current = this.updateProgress(
                    user,
                    current.id,
                    completedSteps,
                    totalSteps,
                    `${extensionPackage.extension.displayName || extensionPackage.extension.id} · 已回放`,
                );
            }

            this.completeOperation(user, current.id, {
                progress: 100,
                summary: `已导入 ${summary.extensionCount} 个扩展的高层包`,
                importSummary: summary,
                warnings,
            });
        } catch (error) {
            this.failOperation(user, current.id, error);
        }
    }

    private async exportExtensionPackage(
        user: UserContext,
        extension: ControlExtensionRecord,
        advance: (phase: string) => void,
    ): Promise<AuthorityPortableExtensionPackage> {
        const grants = await this.permissions.listPersistentGrants(user, extension.id) as ControlGrantRecord[];
        advance('grants');

        const kvEntries = await this.storage.listKv(user, extension.id);
        advance('kv');

        const blobs = await this.exportBlobs(user, extension.id, await this.storage.listBlobs(user, extension.id));
        advance('blobs');

        const files = this.exportPrivateFiles(user, extension.id);
        advance('files');

        const sqlDatabases = await this.exportSqlDatabases(user, extension.id, await this.listPrivateSqlDatabases(user, extension.id));
        advance('sql');

        const triviumDatabases = await this.exportTriviumDatabases(user, extension.id, (await this.trivium.listDatabases(user, extension.id)).databases);
        advance('trivium');

        return {
            extension,
            grants,
            kvEntries,
            blobs,
            files,
            sqlDatabases,
            triviumDatabases,
        };
    }

    private async importExtensionPackage(
        user: UserContext,
        extensionPackage: AuthorityPortableExtensionPackage,
        summary: AuthorityPackageImportSummary,
        warnings: string[],
    ): Promise<void> {
        const extensionId = extensionPackage.extension.id;
        const paths = getUserAuthorityPaths(user);

        for (const grant of extensionPackage.grants) {
            await this.core.upsertControlGrant(paths.controlDbFile, {
                userHandle: user.handle,
                extensionId,
                grant,
            });
        }
        summary.grantCount += extensionPackage.grants.length;

        for (const [key, value] of Object.entries(extensionPackage.kvEntries)) {
            await this.storage.setKv(user, extensionId, key, value);
        }
        summary.kvEntryCount += Object.keys(extensionPackage.kvEntries).length;

        for (const blob of extensionPackage.blobs) {
            const payload = decodeBase64Checked(blob.contentBase64, blob.checksumSha256, `blob ${blob.record.name}`);
            await this.storage.putBlob(user, extensionId, blob.record.name, payload.toString('base64'), 'base64', blob.record.contentType);
        }
        summary.blobCount += extensionPackage.blobs.length;

        for (const file of extensionPackage.files) {
            decodeBase64Checked(file.contentBase64, file.checksumSha256, `private file ${file.path}`);
            await this.files.writeFile(user, extensionId, {
                path: file.path,
                content: file.contentBase64,
                encoding: 'base64',
                createParents: true,
            });
        }
        summary.fileCount += extensionPackage.files.length;

        for (const database of extensionPackage.sqlDatabases) {
            const bytes = decodeBase64Checked(database.contentBase64, database.checksumSha256, `sql database ${database.record.name}`);
            const dbPath = this.resolvePrivateSqlDatabasePath(user, extensionId, database.record.name);
            ensureDir(path.dirname(dbPath));
            fs.writeFileSync(dbPath, bytes);
        }
        summary.sqlDatabaseCount += extensionPackage.sqlDatabases.length;

        for (const database of extensionPackage.triviumDatabases) {
            const bytes = decodeBase64Checked(database.databaseContentBase64, database.databaseChecksumSha256, `trivium database ${database.record.name}`);
            const dbPath = this.resolvePrivateTriviumDatabasePath(user, extensionId, database.record.name);
            ensureDir(path.dirname(dbPath));
            fs.rmSync(`${dbPath}.quiver`, { force: true });
            fs.writeFileSync(dbPath, bytes);
            const mappingPath = this.resolvePrivateTriviumMappingPath(user, extensionId, database.record.name);
            if (database.mappingContentBase64 && database.mappingChecksumSha256) {
                const mappingBytes = decodeBase64Checked(database.mappingContentBase64, database.mappingChecksumSha256, `trivium mapping ${database.record.name}`);
                ensureDir(path.dirname(mappingPath));
                fs.writeFileSync(mappingPath, mappingBytes);
            } else {
                fs.rmSync(mappingPath, { force: true });
            }
        }
        summary.triviumDatabaseCount += extensionPackage.triviumDatabases.length;

        if (!extensionPackage.extension.displayName?.trim()) {
            warnings.push(`扩展 ${extensionId} 在导出包中没有 displayName，导入后会等待扩展自身再次上报元数据。`);
        }
    }

    private async buildUsageSummary(
        user: UserContext,
        extensions: ControlExtensionRecord[],
    ): Promise<NonNullable<AuthorityPortablePackage['usageSummary']>> {
        const generatedAt = nowIso();
        const entries = await Promise.all(extensions.map(async extension => {
            const grants = await this.permissions.listPersistentGrants(user, extension.id);
            const sqlDatabases = await this.listPrivateSqlDatabases(user, extension.id);
            const triviumDatabases = (await this.trivium.listDatabases(user, extension.id)).databases;
            const storage = await this.buildExtensionStorageSummary(user, extension.id, sqlDatabases, triviumDatabases);
            return {
                extension,
                grantedCount: grants.filter(grant => grant.status === 'granted').length,
                deniedCount: grants.filter(grant => grant.status === 'denied' || grant.status === 'blocked').length,
                storage,
            };
        }));

        const totals = entries.reduce((aggregate, entry) => ({
            extensionCount: aggregate.extensionCount + 1,
            kvEntries: aggregate.kvEntries + entry.storage.kvEntries,
            blobCount: aggregate.blobCount + entry.storage.blobCount,
            blobBytes: aggregate.blobBytes + entry.storage.blobBytes,
            databaseCount: aggregate.databaseCount + entry.storage.databaseCount,
            databaseBytes: aggregate.databaseBytes + entry.storage.databaseBytes,
            sqlDatabaseCount: aggregate.sqlDatabaseCount + entry.storage.sqlDatabaseCount,
            sqlDatabaseBytes: aggregate.sqlDatabaseBytes + entry.storage.sqlDatabaseBytes,
            triviumDatabaseCount: aggregate.triviumDatabaseCount + entry.storage.triviumDatabaseCount,
            triviumDatabaseBytes: aggregate.triviumDatabaseBytes + entry.storage.triviumDatabaseBytes,
            files: {
                fileCount: aggregate.files.fileCount + entry.storage.files.fileCount,
                directoryCount: aggregate.files.directoryCount + entry.storage.files.directoryCount,
                totalSizeBytes: aggregate.files.totalSizeBytes + entry.storage.files.totalSizeBytes,
                latestUpdatedAt: newestTimestamp(aggregate.files.latestUpdatedAt, entry.storage.files.latestUpdatedAt),
            },
        }), {
            extensionCount: 0,
            kvEntries: 0,
            blobCount: 0,
            blobBytes: 0,
            databaseCount: 0,
            databaseBytes: 0,
            sqlDatabaseCount: 0,
            sqlDatabaseBytes: 0,
            triviumDatabaseCount: 0,
            triviumDatabaseBytes: 0,
            files: {
                fileCount: 0,
                directoryCount: 0,
                totalSizeBytes: 0,
                latestUpdatedAt: null as string | null,
            },
        });

        return {
            generatedAt,
            totals,
            extensions: entries,
        };
    }

    private async buildExtensionStorageSummary(
        user: UserContext,
        extensionId: string,
        sqlDatabases: SqlDatabaseRecord[],
        triviumDatabases: TriviumDatabaseRecord[],
    ) {
        const [kvEntries, blobs, files] = await Promise.all([
            this.storage.listKv(user, extensionId),
            this.storage.listBlobs(user, extensionId),
            this.files.getUsageSummary(user, extensionId),
        ]);
        return {
            kvEntries: Object.keys(kvEntries).length,
            blobCount: blobs.length,
            blobBytes: blobs.reduce((sum, blob) => sum + blob.size, 0),
            databaseCount: sqlDatabases.length + triviumDatabases.length,
            databaseBytes: sqlDatabases.reduce((sum, database) => sum + database.sizeBytes, 0)
                + triviumDatabases.reduce((sum, database) => sum + database.totalSizeBytes, 0),
            sqlDatabaseCount: sqlDatabases.length,
            sqlDatabaseBytes: sqlDatabases.reduce((sum, database) => sum + database.sizeBytes, 0),
            triviumDatabaseCount: triviumDatabases.length,
            triviumDatabaseBytes: triviumDatabases.reduce((sum, database) => sum + database.totalSizeBytes, 0),
            files,
        };
    }

    private async exportBlobs(user: UserContext, extensionId: string, records: BlobRecord[]) {
        return await Promise.all(records.map(async record => {
            const opened = await this.storage.openBlobRead(user, extensionId, record.id);
            const bytes = fs.readFileSync(opened.sourcePath);
            return {
                record,
                contentBase64: bytes.toString('base64'),
                checksumSha256: hashBytes(bytes),
            };
        }));
    }

    private exportPrivateFiles(user: UserContext, extensionId: string) {
        const rootDir = this.resolvePrivateFilesRoot(user, extensionId);
        if (!fs.existsSync(rootDir)) {
            return [];
        }
        const entries: AuthorityPortableExtensionPackage['files'] = [];
        const walk = (currentDir: string, virtualPrefix: string): void => {
            for (const entry of fs.readdirSync(currentDir, { withFileTypes: true })) {
                const fullPath = path.join(currentDir, entry.name);
                const stats = fs.lstatSync(fullPath);
                if (stats.isSymbolicLink()) {
                    continue;
                }
                const virtualPath = `${virtualPrefix}/${entry.name}`.replace(/\\/g, '/');
                if (entry.isDirectory()) {
                    walk(fullPath, virtualPath);
                    continue;
                }
                if (!entry.isFile()) {
                    continue;
                }
                const bytes = fs.readFileSync(fullPath);
                entries.push({
                    path: virtualPath,
                    sizeBytes: bytes.byteLength,
                    updatedAt: new Date(stats.mtimeMs).toISOString(),
                    contentBase64: bytes.toString('base64'),
                    checksumSha256: hashBytes(bytes),
                });
            }
        };
        walk(rootDir, '');
        entries.sort((left, right) => left.path.localeCompare(right.path));
        return entries;
    }

    private async exportSqlDatabases(user: UserContext, extensionId: string, records: SqlDatabaseRecord[]) {
        return await Promise.all(records.map(async record => {
            const filePath = this.resolvePrivateSqlDatabasePath(user, extensionId, record.name);
            const bytes = fs.existsSync(filePath) ? fs.readFileSync(filePath) : Buffer.alloc(0);
            return {
                record,
                contentBase64: bytes.toString('base64'),
                checksumSha256: hashBytes(bytes),
            };
        }));
    }

    private async exportTriviumDatabases(user: UserContext, extensionId: string, records: TriviumDatabaseRecord[]) {
        return await Promise.all(records.map(async record => {
            const dbPath = this.resolvePrivateTriviumDatabasePath(user, extensionId, record.name);
            const mappingPath = this.resolvePrivateTriviumMappingPath(user, extensionId, record.name);
            const databaseBytes = fs.existsSync(dbPath) ? fs.readFileSync(dbPath) : Buffer.alloc(0);
            const mappingBytes = fs.existsSync(mappingPath) ? fs.readFileSync(mappingPath) : null;
            return {
                record,
                databaseContentBase64: databaseBytes.toString('base64'),
                databaseChecksumSha256: hashBytes(databaseBytes),
                ...(mappingBytes
                    ? {
                        mappingContentBase64: mappingBytes.toString('base64'),
                        mappingChecksumSha256: hashBytes(mappingBytes),
                    }
                    : {}),
            };
        }));
    }

    private async listPrivateSqlDatabases(user: UserContext, extensionId: string): Promise<SqlDatabaseRecord[]> {
        const databaseDir = this.resolvePrivateSqlDatabaseDir(user, extensionId);
        if (!fs.existsSync(databaseDir)) {
            return [];
        }
        const databases = await Promise.all(fs.readdirSync(databaseDir, { withFileTypes: true })
            .filter(entry => entry.isFile() && entry.name.endsWith('.sqlite'))
            .map(async entry => {
                const databaseName = entry.name.slice(0, -'.sqlite'.length);
                const stat = await this.core.statSql(this.resolvePrivateSqlDatabasePath(user, extensionId, databaseName), {
                    database: databaseName,
                });
                return {
                    name: stat.name,
                    fileName: stat.fileName,
                    sizeBytes: stat.sizeBytes,
                    updatedAt: stat.updatedAt,
                    runtimeConfig: stat.runtimeConfig,
                    slowQuery: stat.slowQuery,
                } satisfies SqlDatabaseRecord;
            }));
        databases.sort((left, right) => (right.updatedAt ?? '').localeCompare(left.updatedAt ?? ''));
        return databases;
    }

    private async clearExtensionState(user: UserContext, extensionId: string): Promise<void> {
        const paths = getUserAuthorityPaths(user);
        await this.permissions.resetPersistentGrants(user, extensionId);
        const blobs = await this.storage.listBlobs(user, extensionId);
        for (const blob of blobs) {
            await this.storage.deleteBlob(user, extensionId, blob.id);
        }
        fs.rmSync(this.resolvePrivateFilesRoot(user, extensionId), { recursive: true, force: true });
        fs.rmSync(resolveContainedPath(paths.kvDir, `${sanitizeFileSegment(extensionId)}.sqlite`), { force: true });
        fs.rmSync(this.resolvePrivateSqlDatabaseDir(user, extensionId), { recursive: true, force: true });
        fs.rmSync(this.resolvePrivateTriviumDatabaseDir(user, extensionId), { recursive: true, force: true });
    }

    private async mergePolicies(user: UserContext, document: ControlPoliciesResponse): Promise<void> {
        await this.policies.saveGlobalPolicies(user, {
            defaults: document.defaults,
            extensions: document.extensions,
            limits: document.limits,
        });
    }

    private async replacePolicies(user: UserContext, document: ControlPoliciesResponse): Promise<void> {
        await this.core.getControlPolicies(getGlobalAuthorityPaths().controlDbFile, { userHandle: user.handle });
        await this.core.execSql(getGlobalAuthorityPaths().controlDbFile, {
            statement: `DELETE FROM authority_policy_documents WHERE name = 'global'`,
        });
        await this.mergePolicies(user, document);
    }

    private readPortablePackage(filePath: string): PortablePackageReadResult {
        const rawBytes = fs.readFileSync(filePath);
        if (isZipArchive(rawBytes)) {
            return this.readPortablePackageArchive(rawBytes);
        }
        const text = tryGunzip(rawBytes).toString('utf8');
        const payload = JSON.parse(text) as AuthorityPortablePackage;
        if (payload?.manifest?.format !== PORTABLE_PACKAGE_FORMAT) {
            throw new Error(`Unsupported package format: ${String(payload?.manifest?.format ?? 'unknown')}`);
        }
        return {
            portablePackage: payload,
            warnings: ['导入源包使用 legacy 单文件 .json.gz 格式；建议重新导出为新的 .authoritypkg.zip 多文件包。'],
        };
    }

    private readPortablePackageArchive(rawBytes: Buffer): PortablePackageReadResult {
        const archiveFiles = readZipArchive(rawBytes);
        const manifest = this.parseArchiveJson<AuthorityPortablePackageArchiveManifest>(
            archiveFiles,
            PORTABLE_PACKAGE_ARCHIVE_MANIFEST_PATH,
            'portable package archive manifest',
        );
        if (manifest?.format !== PORTABLE_PACKAGE_ARCHIVE_FORMAT) {
            throw new Error(`Unsupported package archive format: ${String(manifest?.format ?? 'unknown')}`);
        }
        if (manifest.packageManifest?.format !== PORTABLE_PACKAGE_FORMAT) {
            throw new Error(`Unsupported logical package format inside archive: ${String(manifest.packageManifest?.format ?? 'unknown')}`);
        }
        this.validatePortablePackageArchiveManifest(manifest, archiveFiles);

        const portablePackage: AuthorityPortablePackage = {
            manifest: manifest.packageManifest,
            extensions: [],
        };

        if (manifest.policiesPath) {
            portablePackage.policies = this.parseArchiveJson<ControlPoliciesResponse>(archiveFiles, manifest.policiesPath, 'portable package policies');
        }
        if (manifest.usageSummaryPath) {
            portablePackage.usageSummary = this.parseArchiveJson<NonNullable<AuthorityPortablePackage['usageSummary']>>(
                archiveFiles,
                manifest.usageSummaryPath,
                'portable package usage summary',
            );
        }

        for (const extensionRef of manifest.extensions) {
            const extension = this.parseArchiveJson<ControlExtensionRecord>(archiveFiles, extensionRef.extensionPath, `extension ${extensionRef.extensionId} metadata`);
            if (extension.id !== extensionRef.extensionId) {
                throw new Error(`Portable package extension metadata mismatch: expected ${extensionRef.extensionId}, received ${extension.id}`);
            }
            const grants = this.parseArchiveJson<ControlGrantRecord[]>(archiveFiles, extensionRef.grantsPath, `extension ${extension.id} grants`);
            const kvEntries = this.parseArchiveJson<Record<string, unknown>>(archiveFiles, extensionRef.kvEntriesPath, `extension ${extension.id} kv entries`);
            const blobs = extensionRef.blobs.map(blob => {
                const bytes = this.requireArchiveBinary(archiveFiles, blob.archivePath, blob.checksumSha256, `blob ${blob.record.name}`);
                return {
                    record: blob.record,
                    contentBase64: bytes.toString('base64'),
                    checksumSha256: blob.checksumSha256,
                };
            });
            const files = extensionRef.files.map(file => {
                const bytes = this.requireArchiveBinary(archiveFiles, file.archivePath, file.checksumSha256, `private file ${file.path}`);
                return {
                    path: file.path,
                    sizeBytes: file.sizeBytes,
                    updatedAt: file.updatedAt,
                    contentBase64: bytes.toString('base64'),
                    checksumSha256: file.checksumSha256,
                };
            });
            const sqlDatabases = extensionRef.sqlDatabases.map(database => {
                const bytes = this.requireArchiveBinary(archiveFiles, database.archivePath, database.checksumSha256, `sql database ${database.record.name}`);
                return {
                    record: database.record,
                    contentBase64: bytes.toString('base64'),
                    checksumSha256: database.checksumSha256,
                };
            });
            const triviumDatabases = extensionRef.triviumDatabases.map(database => {
                const databaseBytes = this.requireArchiveBinary(
                    archiveFiles,
                    database.databaseArchivePath,
                    database.databaseChecksumSha256,
                    `trivium database ${database.record.name}`,
                );
                const nextDatabase = {
                    record: database.record,
                    databaseContentBase64: databaseBytes.toString('base64'),
                    databaseChecksumSha256: database.databaseChecksumSha256,
                } as AuthorityPortableExtensionPackage['triviumDatabases'][number];
                if (database.mappingArchivePath && database.mappingChecksumSha256) {
                    const mappingBytes = this.requireArchiveBinary(
                        archiveFiles,
                        database.mappingArchivePath,
                        database.mappingChecksumSha256,
                        `trivium mapping ${database.record.name}`,
                    );
                    nextDatabase.mappingContentBase64 = mappingBytes.toString('base64');
                    nextDatabase.mappingChecksumSha256 = database.mappingChecksumSha256;
                }
                return nextDatabase;
            });
            portablePackage.extensions.push({
                extension,
                grants,
                kvEntries,
                blobs,
                files,
                sqlDatabases,
                triviumDatabases,
            });
        }

        return {
            portablePackage,
            warnings: [],
        };
    }

    private validatePortablePackageArchiveManifest(
        manifest: AuthorityPortablePackageArchiveManifest,
        archiveFiles: Map<string, Buffer>,
    ): void {
        const seen = new Set<string>();
        for (const entry of manifest.entries) {
            if (seen.has(entry.path)) {
                throw new Error(`Portable package archive contains duplicate manifest entry: ${entry.path}`);
            }
            seen.add(entry.path);
            const bytes = archiveFiles.get(entry.path);
            if (!bytes) {
                throw new Error(`Portable package archive is missing file: ${entry.path}`);
            }
            if (bytes.byteLength !== entry.sizeBytes) {
                throw new Error(`Portable package archive file size mismatch: ${entry.path}`);
            }
            const checksum = hashBytes(bytes);
            if (checksum !== entry.checksumSha256) {
                throw new Error(`Portable package archive file checksum mismatch: ${entry.path}`);
            }
        }

        const referencedPaths = new Set<string>();
        if (manifest.policiesPath) {
            referencedPaths.add(manifest.policiesPath);
        }
        if (manifest.usageSummaryPath) {
            referencedPaths.add(manifest.usageSummaryPath);
        }
        for (const extension of manifest.extensions) {
            referencedPaths.add(extension.extensionPath);
            referencedPaths.add(extension.grantsPath);
            referencedPaths.add(extension.kvEntriesPath);
            for (const blob of extension.blobs) {
                referencedPaths.add(blob.archivePath);
            }
            for (const file of extension.files) {
                referencedPaths.add(file.archivePath);
            }
            for (const database of extension.sqlDatabases) {
                referencedPaths.add(database.archivePath);
            }
            for (const database of extension.triviumDatabases) {
                referencedPaths.add(database.databaseArchivePath);
                if (database.mappingArchivePath) {
                    referencedPaths.add(database.mappingArchivePath);
                }
            }
        }

        for (const referencedPath of referencedPaths) {
            if (!seen.has(referencedPath)) {
                throw new Error(`Portable package archive manifest is missing entry metadata for: ${referencedPath}`);
            }
        }
    }

    private parseArchiveJson<T>(archiveFiles: Map<string, Buffer>, archivePath: string, label: string): T {
        const bytes = archiveFiles.get(archivePath);
        if (!bytes) {
            throw new Error(`${label} is missing from the portable package archive`);
        }
        return JSON.parse(bytes.toString('utf8')) as T;
    }

    private requireArchiveBinary(
        archiveFiles: Map<string, Buffer>,
        archivePath: string,
        checksumSha256: string,
        label: string,
    ): Buffer {
        const bytes = archiveFiles.get(archivePath);
        if (!bytes) {
            throw new Error(`${label} is missing from the portable package archive`);
        }
        const checksum = hashBytes(bytes);
        if (checksum !== checksumSha256) {
            throw new Error(`${label} checksum mismatch: expected ${checksumSha256}, received ${checksum}`);
        }
        return bytes;
    }

    private writePortablePackageArtifact(
        user: UserContext,
        operationId: string,
        portablePackage: AuthorityPortablePackage,
    ): OperationArtifactLocation {
        const filePath = path.join(
            this.getOperationWorkDir(user, operationId),
            sanitizeArtifactFileName(`authority-export-package-${sanitizeTimestamp(portablePackage.manifest.generatedAt)}.authoritypkg.zip`),
        );
        ensureDir(path.dirname(filePath));

        const { manifest, files } = this.buildPortablePackageArchive(portablePackage);
        const archiveBytes = createZipArchive([
            {
                path: PORTABLE_PACKAGE_ARCHIVE_MANIFEST_PATH,
                bytes: Buffer.from(JSON.stringify(manifest, null, 2), 'utf8'),
                compression: 'deflate',
            },
            ...files.map(file => ({
                path: file.path,
                bytes: file.bytes,
                compression: file.mediaType === 'application/json' ? 'deflate' as const : 'auto' as const,
            })),
        ]);
        fs.writeFileSync(filePath, archiveBytes);
        return {
            artifact: buildArtifactSummary(path.basename(filePath), archiveBytes, 'application/zip'),
            filePath,
        };
    }

    private buildPortablePackageArchive(portablePackage: AuthorityPortablePackage): {
        manifest: AuthorityPortablePackageArchiveManifest;
        files: ArchiveBuildFile[];
    } {
        const files: ArchiveBuildFile[] = [];
        const pushJsonFile = (archivePath: string, value: unknown): string => {
            files.push({
                path: archivePath,
                mediaType: 'application/json',
                bytes: Buffer.from(JSON.stringify(value, null, 2), 'utf8'),
            });
            return archivePath;
        };
        const pushBinaryFile = (archivePath: string, bytes: Buffer, mediaType = 'application/octet-stream'): string => {
            files.push({
                path: archivePath,
                mediaType,
                bytes,
            });
            return archivePath;
        };

        const policiesPath = portablePackage.policies ? pushJsonFile('policies.json', portablePackage.policies) : undefined;
        const usageSummaryPath = portablePackage.usageSummary ? pushJsonFile('usage-summary.json', portablePackage.usageSummary) : undefined;
        const extensions: AuthorityPortablePackageArchiveExtension[] = portablePackage.extensions.map((extensionPackage, extensionIndex) => {
            const extensionDir = `extensions/${String(extensionIndex).padStart(3, '0')}-${sanitizeFileSegment(extensionPackage.extension.id)}`;
            const extensionPath = pushJsonFile(`${extensionDir}/extension.json`, extensionPackage.extension);
            const grantsPath = pushJsonFile(`${extensionDir}/grants.json`, extensionPackage.grants);
            const kvEntriesPath = pushJsonFile(`${extensionDir}/kv.json`, extensionPackage.kvEntries);

            const blobs: AuthorityPortableBlobArchiveEntry[] = extensionPackage.blobs.map((blob, blobIndex) => {
                const bytes = decodeBase64Checked(blob.contentBase64, blob.checksumSha256, `blob ${blob.record.name}`);
                const archivePath = pushBinaryFile(
                    buildIndexedArchivePath(`${extensionDir}/blobs`, blobIndex, blob.record.name || blob.record.id || 'blob.bin'),
                    bytes,
                    blob.record.contentType || 'application/octet-stream',
                );
                return {
                    record: blob.record,
                    archivePath,
                    sizeBytes: bytes.byteLength,
                    checksumSha256: hashBytes(bytes),
                };
            });

            const privateFiles: AuthorityPortablePrivateFileArchiveEntry[] = extensionPackage.files.map((file, fileIndex) => {
                const bytes = decodeBase64Checked(file.contentBase64, file.checksumSha256, `private file ${file.path}`);
                const archivePath = pushBinaryFile(
                    buildIndexedArchivePath(`${extensionDir}/files`, fileIndex, file.path || 'file.bin'),
                    bytes,
                );
                return {
                    path: file.path,
                    archivePath,
                    sizeBytes: bytes.byteLength,
                    updatedAt: file.updatedAt,
                    checksumSha256: hashBytes(bytes),
                };
            });

            const sqlDatabases: AuthorityPortableSqlDatabaseArchiveEntry[] = extensionPackage.sqlDatabases.map((database, databaseIndex) => {
                const bytes = decodeBase64Checked(database.contentBase64, database.checksumSha256, `sql database ${database.record.name}`);
                const archivePath = pushBinaryFile(
                    buildIndexedArchivePath(`${extensionDir}/sql`, databaseIndex, database.record.fileName || `${database.record.name}.sqlite`),
                    bytes,
                );
                return {
                    record: database.record,
                    archivePath,
                    sizeBytes: bytes.byteLength,
                    checksumSha256: hashBytes(bytes),
                };
            });

            const triviumDatabases: AuthorityPortableTriviumDatabaseArchiveEntry[] = extensionPackage.triviumDatabases.map((database, databaseIndex) => {
                const databaseBytes = decodeBase64Checked(
                    database.databaseContentBase64,
                    database.databaseChecksumSha256,
                    `trivium database ${database.record.name}`,
                );
                const databaseArchivePath = pushBinaryFile(
                    buildIndexedArchivePath(`${extensionDir}/trivium`, databaseIndex, database.record.fileName || `${database.record.name}.tdb`),
                    databaseBytes,
                );
                const nextDatabase: AuthorityPortableTriviumDatabaseArchiveEntry = {
                    record: database.record,
                    databaseArchivePath,
                    databaseSizeBytes: databaseBytes.byteLength,
                    databaseChecksumSha256: hashBytes(databaseBytes),
                };
                if (database.mappingContentBase64 && database.mappingChecksumSha256) {
                    const mappingBytes = decodeBase64Checked(
                        database.mappingContentBase64,
                        database.mappingChecksumSha256,
                        `trivium mapping ${database.record.name}`,
                    );
                    nextDatabase.mappingArchivePath = pushBinaryFile(
                        buildIndexedArchivePath(`${extensionDir}/trivium`, databaseIndex, `${database.record.name}.mapping.sqlite`),
                        mappingBytes,
                    );
                    nextDatabase.mappingSizeBytes = mappingBytes.byteLength;
                    nextDatabase.mappingChecksumSha256 = hashBytes(mappingBytes);
                }
                return nextDatabase;
            });

            return {
                extensionId: extensionPackage.extension.id,
                extensionPath,
                grantsPath,
                kvEntriesPath,
                blobs,
                files: privateFiles,
                sqlDatabases,
                triviumDatabases,
            };
        });

        const manifest: AuthorityPortablePackageArchiveManifest = {
            format: PORTABLE_PACKAGE_ARCHIVE_FORMAT,
            generatedAt: portablePackage.manifest.generatedAt,
            packageManifest: portablePackage.manifest,
            entries: files.map(file => buildArchiveFileEntry(file)),
            ...(policiesPath ? { policiesPath } : {}),
            ...(usageSummaryPath ? { usageSummaryPath } : {}),
            extensions,
        };
        return {
            manifest,
            files,
        };
    }

    private buildDiagnosticArchiveFiles(bundle: AuthorityDiagnosticBundleResponse): AuthorityDiagnosticArchiveFile[] {
        const files: AuthorityDiagnosticArchiveFile[] = [];
        files.push(this.buildUtf8ArchiveFile('bundle.json', bundle));
        files.push(this.buildUtf8ArchiveFile('probe.json', bundle.probe));
        files.push(this.buildUtf8ArchiveFile('policies.json', bundle.policies));
        files.push(this.buildUtf8ArchiveFile('usage-summary.json', bundle.usageSummary));
        files.push(this.buildUtf8ArchiveFile('jobs.json', bundle.jobs));
        files.push(this.buildUtf8ArchiveFile('extensions/index.json', bundle.extensions.map(extension => ({
            id: extension.extension.id,
            displayName: extension.extension.displayName,
            storage: extension.storage,
            jobs: extension.jobsPage,
        }))));
        for (const extension of bundle.extensions) {
            files.push(this.buildUtf8ArchiveFile(
                `extensions/${sanitizeFileSegment(extension.extension.id)}.json`,
                extension,
            ));
        }
        if (bundle.releaseMetadata) {
            files.push(this.buildUtf8ArchiveFile('release-metadata.json', bundle.releaseMetadata));
        }
        return files;
    }

    private buildUtf8ArchiveFile(pathName: string, value: unknown): AuthorityDiagnosticArchiveFile {
        const content = JSON.stringify(value, null, 2);
        return {
            path: pathName,
            mediaType: 'application/json',
            encoding: 'utf8',
            content,
            sizeBytes: Buffer.byteLength(content),
            checksumSha256: hashText(content),
        };
    }

    private resolveExportExtensions(user: UserContext, extensionIds?: string[]): Promise<ControlExtensionRecord[]> {
        return extensionIds && extensionIds.length > 0
            ? Promise.all(extensionIds.map(async extensionId => {
                const extension = await this.extensions.getExtension(user, extensionId);
                if (!extension) {
                    throw new Error(`Extension not found: ${extensionId}`);
                }
                return extension;
            }))
            : this.extensions.listExtensions(user);
    }

    private recoverUserOperations(user: UserContext): void {
        const recoveryKey = `${user.handle}\u0000${user.rootDir}`;
        if (this.recoveredUsers.has(recoveryKey)) {
            return;
        }
        for (const operation of this.loadOperations(user)) {
            if (operation.status !== 'queued' && operation.status !== 'running') {
                continue;
            }
            const recovered: StoredPackageOperation = {
                ...operation,
                status: 'failed',
                progress: 0,
                summary: '运行中的导入导出任务在服务重启后需要手动恢复',
                error: OPERATION_RECOVERY_ERROR,
                updatedAt: nowIso(),
                finishedAt: nowIso(),
            };
            this.saveOperation(user, recovered);
        }
        this.recoveredUsers.add(recoveryKey);
    }

    private markRunning(user: UserContext, operation: StoredPackageOperation): StoredPackageOperation {
        const running: StoredPackageOperation = {
            ...operation,
            status: 'running',
            progress: 1,
            summary: operation.kind === 'export' ? '正在构建高层导出包' : '正在回放高层导入包',
            startedAt: nowIso(),
            updatedAt: nowIso(),
            warnings: [],
        };
        delete running.error;
        delete running.finishedAt;
        this.saveOperation(user, running);
        return running;
    }

    private updateProgress(
        user: UserContext,
        operationId: string,
        completedSteps: number,
        totalSteps: number,
        summary: string,
    ): StoredPackageOperation {
        const operation = this.requireOperation(user, operationId);
        const next: StoredPackageOperation = {
            ...operation,
            progress: Math.max(1, Math.min(99, Math.round((completedSteps / Math.max(1, totalSteps)) * 100))),
            summary,
            updatedAt: nowIso(),
        };
        this.saveOperation(user, next);
        return next;
    }

    private completeOperation(
        user: UserContext,
        operationId: string,
        patch: Partial<StoredPackageOperation>,
    ): StoredPackageOperation {
        const operation = this.requireOperation(user, operationId);
        const completed: StoredPackageOperation = {
            ...operation,
            ...patch,
            status: 'completed',
            progress: 100,
            updatedAt: nowIso(),
            finishedAt: nowIso(),
        };
        delete completed.error;
        this.saveOperation(user, completed);
        return completed;
    }

    private failOperation(user: UserContext, operationId: string, error: unknown): void {
        const operation = this.requireOperation(user, operationId);
        const failed: StoredPackageOperation = {
            ...operation,
            status: 'failed',
            updatedAt: nowIso(),
            finishedAt: nowIso(),
            error: asErrorMessage(error),
            summary: operation.kind === 'export' ? '高层导出包生成失败' : '高层导入包回放失败',
        };
        this.saveOperation(user, failed);
    }

    private writeStandaloneArtifact(
        user: UserContext,
        prefix: string,
        fileName: string,
        payload: unknown,
    ): OperationArtifactLocation {
        const artifactId = `${prefix}-${crypto.randomUUID()}`;
        const filePath = path.join(this.getStandaloneArtifactsDir(user), artifactId, sanitizeArtifactFileName(fileName));
        ensureDir(path.dirname(filePath));
        const bytes = zlib.gzipSync(Buffer.from(JSON.stringify(payload), 'utf8'));
        fs.writeFileSync(filePath, bytes);
        return {
            artifact: buildArtifactSummary(path.basename(filePath), bytes, 'application/gzip'),
            filePath,
        };
    }

    private loadOperations(user: UserContext): StoredPackageOperation[] {
        const dirPath = this.getOperationsDir(user);
        if (!fs.existsSync(dirPath)) {
            return [];
        }
        return fs.readdirSync(dirPath)
            .filter(entry => entry.endsWith('.json'))
            .map(entry => readJsonFile<StoredPackageOperation | null>(path.join(dirPath, entry), null))
            .filter((entry): entry is StoredPackageOperation => Boolean(entry));
    }

    private loadOperation(user: UserContext, operationId: string): StoredPackageOperation | null {
        return readJsonFile<StoredPackageOperation | null>(this.getOperationStatePath(user, operationId), null);
    }

    private requireOperation(user: UserContext, operationId: string): StoredPackageOperation {
        const operation = this.loadOperation(user, operationId);
        if (!operation) {
            throw new Error('Import/export operation not found');
        }
        return operation;
    }

    private saveOperation(user: UserContext, operation: StoredPackageOperation): void {
        atomicWriteJson(this.getOperationStatePath(user, operation.id), operation);
    }

    private toPublicOperation(operation: StoredPackageOperation): AuthorityPackageOperation {
        const { artifactPath: _artifactPath, sourcePath: _sourcePath, ...publicOperation } = operation;
        return publicOperation;
    }

    private getOperationsDir(user: UserContext): string {
        return path.join(this.getPackagesRoot(user), 'operations');
    }

    private getStandaloneArtifactsDir(user: UserContext): string {
        return path.join(this.getPackagesRoot(user), 'standalone');
    }

    private getOperationStatePath(user: UserContext, operationId: string): string {
        return resolveContainedPath(this.getOperationsDir(user), `${sanitizeFileSegment(operationId)}.json`);
    }

    private getOperationWorkDir(user: UserContext, operationId: string): string {
        return resolveContainedPath(this.getPackagesRoot(user), 'work', sanitizeFileSegment(operationId));
    }

    private getPackagesRoot(user: UserContext): string {
        return path.join(path.dirname(getUserAuthorityPaths(user).controlDbFile), 'admin-packages');
    }

    private resolvePrivateFilesRoot(user: UserContext, extensionId: string): string {
        return resolveContainedPath(getUserAuthorityPaths(user).filesDir, sanitizeFileSegment(extensionId));
    }

    private resolvePrivateSqlDatabaseDir(user: UserContext, extensionId: string): string {
        return resolveContainedPath(getUserAuthorityPaths(user).sqlPrivateDir, sanitizeFileSegment(extensionId));
    }

    private resolvePrivateSqlDatabasePath(user: UserContext, extensionId: string, databaseName: string): string {
        return resolveContainedPath(this.resolvePrivateSqlDatabaseDir(user, extensionId), `${sanitizeFileSegment(databaseName)}.sqlite`);
    }

    private resolvePrivateTriviumDatabaseDir(user: UserContext, extensionId: string): string {
        return resolveContainedPath(getUserAuthorityPaths(user).triviumPrivateDir, sanitizeFileSegment(extensionId));
    }

    private resolvePrivateTriviumDatabasePath(user: UserContext, extensionId: string, databaseName: string): string {
        return resolveContainedPath(this.resolvePrivateTriviumDatabaseDir(user, extensionId), `${sanitizeFileSegment(databaseName)}.tdb`);
    }

    private resolvePrivateTriviumMappingPath(user: UserContext, extensionId: string, databaseName: string): string {
        return resolveContainedPath(this.resolvePrivateTriviumDatabaseDir(user, extensionId), '__mapping__', `${sanitizeFileSegment(databaseName)}.sqlite`);
    }
}

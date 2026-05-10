import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import type {
    NativeMigrationApplyMode,
    NativeMigrationEntryPreview,
    NativeMigrationJournalEntry,
    NativeMigrationOperation,
    NativeMigrationTarget,
} from '@stdo/shared-types';
import { NATIVE_MIGRATION_MAX_COMPRESSED_BYTES } from '../constants.js';
import { getGlobalAuthorityPaths } from '../store/authority-paths.js';
import {
    asErrorMessage,
    atomicWriteJson,
    ensureDir,
    isPathInside,
    nowIso,
    readJsonFile,
    resolveContainedPath,
    resolveRuntimePath,
    sanitizeFileSegment,
} from '../utils.js';
import { extractSafeZipPlan, scanSafeZip, type SafeZipEntry } from './safe-zip.js';

interface NativeMigrationPreviewOptions {
    sourceFileName?: string;
    adoptSource?: boolean;
}

interface NativeMigrationServiceOptions {
    dataRoot?: string;
    sillyTavernRoot?: string;
    migrationRoot?: string;
}

interface StoredNativeMigrationOperation extends NativeMigrationOperation {
    sourcePath: string;
    rootPath: string;
    entries: NativeMigrationEntryPreview[];
    journal: NativeMigrationJournalEntry[];
}

interface PlannedWrite {
    entry: SafeZipEntry;
    preview: NativeMigrationEntryPreview;
    targetPath: string;
    tempPath: string;
    previousChecksumSha256?: string;
    backupPath?: string;
}

interface ExistingTargetInfo {
    exists: boolean;
    checksumSha256?: string;
}

export class NativeMigrationService {
    constructor(private readonly options: NativeMigrationServiceOptions = {}) {}

    async preview(target: NativeMigrationTarget, sourcePath: string, options: NativeMigrationPreviewOptions = {}): Promise<NativeMigrationOperation> {
        const normalizedTarget = normalizeMigrationTarget(target);
        const operationId = crypto.randomUUID();
        const sourceFileName = options.sourceFileName?.trim() || path.basename(sourcePath);
        const operationSourcePath = this.getOperationSourcePath(operationId, sourceFileName);
        ensureDir(path.dirname(operationSourcePath));

        try {
            stageSourceArchive(sourcePath, operationSourcePath, Boolean(options.adoptSource));
            const scan = await scanSafeZip(operationSourcePath, { maxCompressedBytes: NATIVE_MIGRATION_MAX_COMPRESSED_BYTES });
            const rootPath = this.getTargetRoot(normalizedTarget);
            const entries = markDuplicateTargetPaths(scan.entries.map(entry => mapMigrationEntry(normalizedTarget, rootPath, entry)));
            const timestamp = nowIso();
            const rejectedCount = entries.filter(entry => entry.action === 'reject').length;
            const operation: StoredNativeMigrationOperation = {
                id: operationId,
                target: normalizedTarget,
                status: 'previewed',
                createdAt: timestamp,
                updatedAt: timestamp,
                sourceFileName,
                sourceSizeBytes: scan.sizeBytes,
                sourcePath: operationSourcePath,
                rootPath,
                entryCount: entries.length,
                totalSizeBytes: entries.reduce((sum, entry) => sum + entry.sizeBytes, 0),
                skippedCount: 0,
                createdCount: 0,
                overwrittenCount: 0,
                warnings: rejectedCount > 0 ? [`${rejectedCount} entries are blocked and must be removed before apply.`] : [],
                entries,
                journal: [],
            };
            this.saveOperation(operation);
            return this.toPublicOperation(operation);
        } catch (error) {
            fs.rmSync(this.getOperationWorkDir(operationId), { recursive: true, force: true });
            throw error;
        }
    }

    listOperations(): NativeMigrationOperation[] {
        return this.loadOperations()
            .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt))
            .map(operation => this.toPublicOperation(operation));
    }

    getOperation(operationId: string): NativeMigrationOperation | null {
        const operation = this.loadOperation(operationId);
        return operation ? this.toPublicOperation(operation) : null;
    }

    async apply(operationId: string, mode: NativeMigrationApplyMode): Promise<NativeMigrationOperation> {
        const operation = this.requireOperation(operationId);
        if (operation.status !== 'previewed') {
            throw new Error('Only previewed native migration operations can be applied');
        }
        if (operation.entries.some(entry => entry.action === 'reject')) {
            throw new Error('Native migration preview contains rejected entries');
        }

        const applyMode = normalizeApplyMode(mode);
        const entriesByPath = new Map(operation.entries.map(entry => [entry.archivePath, entry]));
        const scan = await scanSafeZip(operation.sourcePath, { maxCompressedBytes: NATIVE_MIGRATION_MAX_COMPRESSED_BYTES });
        const applying: StoredNativeMigrationOperation = {
            ...operation,
            status: 'applying',
            updatedAt: nowIso(),
            journal: [],
        };
        this.saveOperation(applying);

        const journal: NativeMigrationJournalEntry[] = [];
        const writesByArchivePath = new Map<string, PlannedWrite>();
        const extractDir = this.getOperationExtractDir(operation.id);
        fs.rmSync(extractDir, { recursive: true, force: true });

        try {
            for (const scannedEntry of scan.entries) {
                const preview = entriesByPath.get(scannedEntry.path);
                if (!preview) {
                    throw new Error(`Native migration preview is stale for entry: ${scannedEntry.path}`);
                }
                const targetPath = prepareNativeWriteTarget(operation.rootPath, preview.targetPath);
                const existing = readExistingTargetInfo(targetPath);
                if (existing.exists && applyMode === 'skip') {
                    journal.push({
                        archivePath: preview.archivePath,
                        targetPath: preview.targetPath,
                        action: 'skipped',
                        sizeBytes: preview.sizeBytes,
                        ...(existing.checksumSha256 ? { previousChecksumSha256: existing.checksumSha256 } : {}),
                    });
                    this.saveOperation({ ...applying, updatedAt: nowIso(), journal });
                    continue;
                }
                const tempPath = resolveContainedPath(extractDir, `${String(writesByArchivePath.size).padStart(8, '0')}-${crypto.randomUUID()}.tmp`);
                writesByArchivePath.set(scannedEntry.path, {
                    entry: scannedEntry,
                    preview,
                    targetPath,
                    tempPath,
                    ...(existing.checksumSha256 ? { previousChecksumSha256: existing.checksumSha256 } : {}),
                });
            }

            await extractSafeZipPlan(operation.sourcePath, [...writesByArchivePath.values()].map(write => ({
                entry: write.entry,
                destinationPath: write.tempPath,
            })), {
                maxCompressedBytes: NATIVE_MIGRATION_MAX_COMPRESSED_BYTES,
                onExtractedEntry: extractedEntry => {
                    const write = writesByArchivePath.get(extractedEntry.path);
                    if (!write) {
                        throw new Error(`Native migration extracted unplanned entry: ${extractedEntry.path}`);
                    }
                    const existing = readExistingTargetInfo(write.targetPath);
                    if (existing.exists) {
                        if (!existing.checksumSha256) {
                            throw new Error(`Native migration existing target checksum is unavailable: ${write.preview.targetPath}`);
                        }
                        write.backupPath = resolveContainedPath(
                            this.getOperationBackupsDir(operation.id),
                            `${String(journal.length).padStart(8, '0')}-${crypto.randomUUID()}.bak`,
                        );
                        ensureDir(path.dirname(write.backupPath));
                        fs.copyFileSync(write.targetPath, write.backupPath);
                        write.previousChecksumSha256 = existing.checksumSha256;
                        journal.push({
                            archivePath: write.preview.archivePath,
                            targetPath: write.preview.targetPath,
                            action: 'pending_overwrite',
                            sizeBytes: write.preview.sizeBytes,
                            previousChecksumSha256: write.previousChecksumSha256,
                            backupPath: write.backupPath,
                        });
                        this.saveOperation({ ...applying, status: 'needs_rollback', updatedAt: nowIso(), journal });
                    }
                    ensureDir(path.dirname(write.targetPath));
                    fs.renameSync(write.tempPath, write.targetPath);
                    const completedEntry: NativeMigrationJournalEntry = {
                        archivePath: write.preview.archivePath,
                        targetPath: write.preview.targetPath,
                        action: existing.exists ? 'overwritten' : 'created',
                        sizeBytes: write.preview.sizeBytes,
                        checksumSha256: extractedEntry.checksumSha256,
                        ...(write.previousChecksumSha256 ? { previousChecksumSha256: write.previousChecksumSha256 } : {}),
                        ...(write.backupPath ? { backupPath: write.backupPath } : {}),
                    };
                    if (existing.exists) {
                        journal[journal.length - 1] = completedEntry;
                    } else {
                        journal.push(completedEntry);
                    }
                    this.saveOperation({ ...applying, updatedAt: nowIso(), journal });
                },
            });

            const applied: StoredNativeMigrationOperation = {
                ...operation,
                status: 'applied',
                updatedAt: nowIso(),
                skippedCount: journal.filter(entry => entry.action === 'skipped').length,
                createdCount: journal.filter(entry => entry.action === 'created').length,
                overwrittenCount: journal.filter(entry => entry.action === 'overwritten').length,
                journal,
            };
            this.saveOperation(applied);
            return this.toPublicOperation(applied);
        } catch (error) {
            const rollbackWarnings = rollbackJournal(operation.rootPath, journal);
            const failed: StoredNativeMigrationOperation = {
                ...operation,
                status: 'failed',
                updatedAt: nowIso(),
                error: asErrorMessage(error),
                warnings: [...operation.warnings, ...rollbackWarnings],
                journal,
            };
            this.saveOperation(failed);
            throw error;
        } finally {
            fs.rmSync(extractDir, { recursive: true, force: true });
        }
    }

    rollback(operationId: string): NativeMigrationOperation {
        const operation = this.requireOperation(operationId);
        if (operation.status !== 'applied' && operation.status !== 'needs_rollback') {
            throw new Error('Only applied native migration operations can be rolled back');
        }
        const rollingBack: StoredNativeMigrationOperation = {
            ...operation,
            status: 'rolling_back',
            updatedAt: nowIso(),
        };
        this.saveOperation(rollingBack);
        const warnings = rollbackJournal(operation.rootPath, operation.journal);
        const rolledBack: StoredNativeMigrationOperation = {
            ...operation,
            status: 'rolled_back',
            updatedAt: nowIso(),
            warnings: [...operation.warnings, ...warnings],
        };
        this.saveOperation(rolledBack);
        return this.toPublicOperation(rolledBack);
    }

    private loadOperations(): StoredNativeMigrationOperation[] {
        const dirPath = this.getOperationsDir();
        if (!fs.existsSync(dirPath)) {
            return [];
        }
        return fs.readdirSync(dirPath)
            .filter(entry => entry.endsWith('.json'))
            .map(entry => readJsonFile<StoredNativeMigrationOperation | null>(path.join(dirPath, entry), null))
            .filter((entry): entry is StoredNativeMigrationOperation => Boolean(entry));
    }

    private loadOperation(operationId: string): StoredNativeMigrationOperation | null {
        return readJsonFile<StoredNativeMigrationOperation | null>(this.getOperationStatePath(operationId), null);
    }

    private requireOperation(operationId: string): StoredNativeMigrationOperation {
        const operation = this.loadOperation(operationId);
        if (!operation) {
            throw new Error('Native migration operation not found');
        }
        return operation;
    }

    private saveOperation(operation: StoredNativeMigrationOperation): void {
        atomicWriteJson(this.getOperationStatePath(operation.id), operation);
    }

    private toPublicOperation(operation: StoredNativeMigrationOperation): NativeMigrationOperation {
        const { sourcePath: _sourcePath, rootPath: _rootPath, journal, ...publicOperation } = operation;
        return {
            ...publicOperation,
            journal: journal.map(({ backupPath: _backupPath, ...entry }) => entry),
        };
    }

    private getTargetRoot(target: NativeMigrationTarget): string {
        return target === 'data'
            ? this.getDataRoot()
            : resolveContainedPath(this.getSillyTavernRoot(), 'public', 'scripts', 'extensions', 'third-party');
    }

    private getDataRoot(): string {
        if (this.options.dataRoot) {
            return resolveRuntimePath(this.options.dataRoot);
        }
        const globalState = globalThis as typeof globalThis & { DATA_ROOT?: string };
        return resolveRuntimePath(typeof globalState.DATA_ROOT === 'string' && globalState.DATA_ROOT.trim() ? globalState.DATA_ROOT : 'data');
    }

    private getSillyTavernRoot(): string {
        if (this.options.sillyTavernRoot) {
            return resolveRuntimePath(this.options.sillyTavernRoot);
        }
        const dataRoot = this.getDataRoot();
        return path.basename(dataRoot) === 'data' ? path.dirname(dataRoot) : process.cwd();
    }

    private getOperationsDir(): string {
        return path.join(this.getMigrationRoot(), 'operations');
    }

    private getOperationStatePath(operationId: string): string {
        return resolveContainedPath(this.getOperationsDir(), `${sanitizeFileSegment(operationId)}.json`);
    }

    private getOperationWorkDir(operationId: string): string {
        return resolveContainedPath(this.getMigrationRoot(), 'work', sanitizeFileSegment(operationId));
    }

    private getOperationSourcePath(operationId: string, sourceFileName: string): string {
        return resolveContainedPath(this.getOperationWorkDir(operationId), `${sanitizeFileSegment(sourceFileName)}.zip`);
    }

    private getOperationBackupsDir(operationId: string): string {
        return resolveContainedPath(this.getOperationWorkDir(operationId), 'backups');
    }

    private getOperationExtractDir(operationId: string): string {
        return resolveContainedPath(this.getOperationWorkDir(operationId), 'extract');
    }

    private getMigrationRoot(): string {
        return this.options.migrationRoot
            ? resolveRuntimePath(this.options.migrationRoot)
            : path.join(path.dirname(getGlobalAuthorityPaths().controlDbFile), 'native-migrations');
    }
}

function stageSourceArchive(sourcePath: string, destinationPath: string, adoptSource: boolean): void {
    const resolvedSource = path.resolve(sourcePath);
    const metadata = fs.lstatSync(resolvedSource);
    if (metadata.isSymbolicLink()) {
        throw new Error('Native migration source archive symlink is not allowed');
    }
    if (!metadata.isFile()) {
        throw new Error('Native migration source archive must be a file');
    }
    if (adoptSource) {
        try {
            fs.renameSync(resolvedSource, destinationPath);
            return;
        } catch {
            fs.copyFileSync(resolvedSource, destinationPath);
            fs.rmSync(resolvedSource, { force: true });
            return;
        }
    }
    fs.copyFileSync(resolvedSource, destinationPath);
}

function mapMigrationEntry(target: NativeMigrationTarget, rootPath: string, entry: SafeZipEntry): NativeMigrationEntryPreview {
    const targetPath = target === 'data'
        ? mapDataArchivePath(entry.path)
        : mapThirdPartyArchivePath(entry.path);
    if (!targetPath) {
        return buildRejectedEntry(entry, targetPath, 'Archive entry maps to an empty target path');
    }

    const absoluteTarget = resolveContainedPath(rootPath, targetPath);
    const rejectedReason = getPreviewRejectionReason(absoluteTarget);
    if (rejectedReason) {
        return buildRejectedEntry(entry, targetPath, rejectedReason);
    }
    return {
        archivePath: entry.path,
        targetPath,
        sizeBytes: entry.uncompressedSizeBytes,
        compressedSizeBytes: entry.compressedSizeBytes,
        action: fs.existsSync(absoluteTarget) ? 'overwrite' : 'create',
    };
}

function markDuplicateTargetPaths(entries: NativeMigrationEntryPreview[]): NativeMigrationEntryPreview[] {
    const counts = new Map<string, number>();
    for (const entry of entries) {
        const key = entry.targetPath.normalize('NFC').toLowerCase();
        counts.set(key, (counts.get(key) ?? 0) + 1);
    }
    return entries.map(entry => {
        const key = entry.targetPath.normalize('NFC').toLowerCase();
        if ((counts.get(key) ?? 0) <= 1 || entry.action === 'reject') {
            return entry;
        }
        return {
            ...entry,
            action: 'reject',
            reason: 'Multiple archive entries map to the same target path',
        };
    });
}

function buildRejectedEntry(entry: SafeZipEntry, targetPath: string, reason: string): NativeMigrationEntryPreview {
    return {
        archivePath: entry.path,
        targetPath,
        sizeBytes: entry.uncompressedSizeBytes,
        compressedSizeBytes: entry.compressedSizeBytes,
        action: 'reject',
        reason,
    };
}

function getPreviewRejectionReason(targetPath: string): string | null {
    if (!fs.existsSync(targetPath)) {
        return null;
    }
    const metadata = fs.lstatSync(targetPath);
    if (metadata.isSymbolicLink()) {
        return 'Target path is a symlink';
    }
    if (!metadata.isFile()) {
        return 'Target path is not a regular file';
    }
    return null;
}

function mapDataArchivePath(archivePath: string): string {
    return stripPrefix(archivePath, 'data/') ?? archivePath;
}

function mapThirdPartyArchivePath(archivePath: string): string {
    return stripPrefix(archivePath, 'public/scripts/extensions/third-party/')
        ?? stripPrefix(archivePath, 'extensions/third-party/')
        ?? stripPrefix(archivePath, 'third-party/')
        ?? archivePath;
}

function stripPrefix(value: string, prefix: string): string | null {
    return value.startsWith(prefix) ? value.slice(prefix.length) : null;
}

function normalizeMigrationTarget(value: NativeMigrationTarget): NativeMigrationTarget {
    if (value === 'data' || value === 'third-party') {
        return value;
    }
    throw new Error(`Unsupported native migration target: ${String(value)}`);
}

function normalizeApplyMode(value: NativeMigrationApplyMode): NativeMigrationApplyMode {
    if (value === 'skip' || value === 'overwrite') {
        return value;
    }
    throw new Error(`Unsupported native migration apply mode: ${String(value)}`);
}

function prepareNativeWriteTarget(rootPath: string, relativePath: string): string {
    ensureDir(rootPath);
    const targetPath = resolveContainedPath(rootPath, relativePath);
    ensureDir(path.dirname(targetPath));
    const realRoot = fs.realpathSync(rootPath);
    const realParent = fs.realpathSync(path.dirname(targetPath));
    if (!isPathInside(realRoot, realParent)) {
        throw new Error(`Native migration target parent escapes target root: ${relativePath}`);
    }
    if (fs.existsSync(targetPath)) {
        const metadata = fs.lstatSync(targetPath);
        if (metadata.isSymbolicLink()) {
            throw new Error(`Native migration refuses to overwrite symlink target: ${relativePath}`);
        }
        if (!metadata.isFile()) {
            throw new Error(`Native migration target is not a regular file: ${relativePath}`);
        }
    }
    return targetPath;
}

function readExistingTargetInfo(targetPath: string): ExistingTargetInfo {
    if (!fs.existsSync(targetPath)) {
        return { exists: false };
    }
    const metadata = fs.lstatSync(targetPath);
    if (metadata.isSymbolicLink()) {
        throw new Error(`Native migration refuses to write through symlink target: ${targetPath}`);
    }
    if (!metadata.isFile()) {
        throw new Error(`Native migration target is not a regular file: ${targetPath}`);
    }
    return {
        exists: true,
        checksumSha256: computeFileSha256(targetPath),
    };
}

function rollbackJournal(rootPath: string, journal: NativeMigrationJournalEntry[]): string[] {
    const warnings: string[] = [];
    for (const entry of [...journal].reverse()) {
        try {
            if (entry.action === 'skipped') {
                continue;
            }
            const targetPath = resolveContainedPath(rootPath, entry.targetPath);
            if (entry.action === 'pending_overwrite') {
                if (!entry.backupPath || !fs.existsSync(entry.backupPath)) {
                    throw new Error(`Missing backup file: ${entry.targetPath}`);
                }
                if (entry.previousChecksumSha256 && computeFileSha256(entry.backupPath) !== entry.previousChecksumSha256) {
                    throw new Error(`Backup checksum mismatch: ${entry.targetPath}`);
                }
                ensureDir(path.dirname(targetPath));
                fs.copyFileSync(entry.backupPath, targetPath);
                continue;
            }
            if (entry.checksumSha256 && fs.existsSync(targetPath) && computeFileSha256(targetPath) !== entry.checksumSha256) {
                throw new Error(`Current file differs from migration-written file: ${entry.targetPath}`);
            }
            if (entry.action === 'created') {
                fs.rmSync(targetPath, { force: true });
                pruneEmptyDirs(path.dirname(targetPath), rootPath);
                continue;
            }
            if (entry.action === 'overwritten') {
                if (!entry.backupPath || !fs.existsSync(entry.backupPath)) {
                    throw new Error(`Missing backup file: ${entry.targetPath}`);
                }
                if (entry.previousChecksumSha256 && computeFileSha256(entry.backupPath) !== entry.previousChecksumSha256) {
                    throw new Error(`Backup checksum mismatch: ${entry.targetPath}`);
                }
                ensureDir(path.dirname(targetPath));
                fs.copyFileSync(entry.backupPath, targetPath);
            }
        } catch (error) {
            warnings.push(`Rollback skipped ${entry.targetPath}: ${asErrorMessage(error)}`);
        }
    }
    return warnings;
}

function computeFileSha256(filePath: string): string {
    const hash = crypto.createHash('sha256');
    const handle = fs.openSync(filePath, 'r');
    try {
        const buffer = Buffer.allocUnsafe(1024 * 1024);
        let position = 0;
        while (true) {
            const bytesRead = fs.readSync(handle, buffer, 0, buffer.byteLength, position);
            if (bytesRead === 0) {
                break;
            }
            hash.update(buffer.subarray(0, bytesRead));
            position += bytesRead;
        }
    } finally {
        fs.closeSync(handle);
    }
    return hash.digest('hex');
}

function pruneEmptyDirs(startDir: string, stopDir: string): void {
    let current = path.resolve(startDir);
    const stop = path.resolve(stopDir);
    while (current !== stop && isPathInside(stop, current)) {
        try {
            fs.rmdirSync(current);
        } catch {
            return;
        }
        current = path.dirname(current);
    }
}

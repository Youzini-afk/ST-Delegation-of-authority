import childProcess from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { AUTHORITY_MANAGED_HOST_BRIDGE_DIR } from '../constants.js';
import type { HostBridgeStatusSnapshot } from '../types.js';
import { atomicWriteFile, atomicWriteJson, ensureDir, isPathInside, nowIso, readJsonFile } from '../utils.js';

const RECORD_SCHEMA_VERSION = 1;
const AUTO_INSTALL_DISABLED = new Set(['0', 'false', 'off', 'no']);

interface HostBridgeManifest {
    schemaVersion: number;
    bridgeVersion: string;
    host: 'sillytavern';
    supportedPackageVersions: string[];
    patchModule: string;
    assets: Array<{ source: string; target: string }>;
    syntaxCheckTargets: string[];
}

interface HostBridgePatchModule {
    bridgeMarker: string;
    targetFiles: string[];
    apply(relativePath: string, source: string): string;
}

interface HostBridgeTargetRecord {
    relativePath: string;
    kind: 'patch' | 'asset';
    originalExists: boolean;
    originalHash: string | null;
    patchedHash: string | null;
    backupPath: string | null;
}

interface HostBridgeInstallRecord {
    schemaVersion: 1;
    operationId: string;
    bridgeVersion: string;
    stRoot: string;
    hostPackageVersion: string;
    artifactHash: string;
    phase: 'applying' | 'ready' | 'rolling_back' | 'rolled_back' | 'error';
    createdAt: string;
    updatedAt: string;
    error?: string;
    targets: HostBridgeTargetRecord[];
}

export interface HostBridgeServiceOptions {
    pluginRoot: string;
    stateDir: string;
    resolveSillyTavernRoot: () => string | null;
    env?: NodeJS.ProcessEnv;
    logger?: Pick<typeof console, 'info' | 'warn' | 'error'>;
}

export class HostBridgeService {
    private readonly pluginRoot: string;
    private readonly stateDir: string;
    private readonly resolveSillyTavernRoot: () => string | null;
    private readonly env: NodeJS.ProcessEnv;
    private readonly logger: Pick<typeof console, 'info' | 'warn' | 'error'>;
    private readonly runtimeRequire: NodeRequire;
    private status: HostBridgeStatusSnapshot;

    constructor(options: HostBridgeServiceOptions) {
        this.pluginRoot = path.resolve(options.pluginRoot);
        this.stateDir = path.resolve(options.stateDir);
        this.resolveSillyTavernRoot = options.resolveSillyTavernRoot;
        this.env = options.env ?? process.env;
        this.logger = options.logger ?? console;
        this.runtimeRequire = resolveRuntimeRequire();
        this.status = this.buildStatus('missing', 'Authority Host Bridge has not been inspected yet.');
    }

    getStatus(): HostBridgeStatusSnapshot {
        return { ...this.status };
    }

    async bootstrap(): Promise<HostBridgeStatusSnapshot> {
        const inspected = await this.inspect();
        if (inspected.status === 'ready' || inspected.status === 'conflict' || inspected.status === 'error') {
            return inspected;
        }
        if (AUTO_INSTALL_DISABLED.has(this.env.AUTHORITY_HOST_BRIDGE_AUTO_INSTALL?.trim().toLowerCase() ?? '')) {
            return this.setStatus('missing', 'Authority Host Bridge is not installed and automatic installation is disabled.');
        }
        return inspected.operationId
            ? await this.repair()
            : await this.install();
    }

    async inspect(): Promise<HostBridgeStatusSnapshot> {
        try {
            const context = this.resolveContext();
            const record = this.readRecord(context.stRoot);
            if (record?.phase === 'applying' || record?.phase === 'rolling_back') {
                this.logger.warn(`[authority] Recovering interrupted Host Bridge operation ${record.operationId}.`);
                await this.rollbackRecord(record, true);
                return this.setStatus('rolled_back', 'Recovered an interrupted Host Bridge operation.', context, record.operationId, true);
            }
            if (!record || record.phase === 'rolled_back' || record.phase === 'error') {
                if (this.hasUnmanagedBridgeMarkers(context)) {
                    return this.setStatus('conflict', 'Host Bridge markers exist without a matching Authority install record.', context);
                }
                return this.setStatus('missing', 'Authority Host Bridge is not installed.', context);
            }
            if (record.bridgeVersion !== context.manifest.bridgeVersion || record.artifactHash !== context.artifactHash) {
                return this.setStatus('missing', 'Authority Host Bridge update is available.', context, record.operationId, true);
            }
            const verification = this.verifyRecord(record);
            if (!verification.ok) {
                return this.setStatus('conflict', verification.message, context, record.operationId);
            }
            return this.setStatus('ready', 'Authority Host Bridge is installed and verified.', context, record.operationId);
        } catch (error) {
            return this.setStatus('error', errorMessage(error));
        }
    }

    async install(options: { repair?: boolean } = {}): Promise<HostBridgeStatusSnapshot> {
        let context: ReturnType<HostBridgeService['resolveContext']>;
        try {
            context = this.resolveContext();
        } catch (error) {
            return this.setStatus('error', errorMessage(error));
        }

        const existing = this.readRecord(context.stRoot);
        if (existing?.phase === 'ready') {
            const verification = this.verifyRecord(existing);
            if (verification.ok && existing.bridgeVersion === context.manifest.bridgeVersion && existing.artifactHash === context.artifactHash) {
                return this.setStatus('ready', 'Authority Host Bridge is already installed and verified.', context, existing.operationId);
            }
            if (!options.repair) {
                return this.setStatus('conflict', verification.ok
                    ? 'Authority Host Bridge update requires a controlled repair operation.'
                    : verification.message, context, existing.operationId);
            }
            const rollback = await this.rollbackRecord(existing, false);
            if (!rollback.ok) {
                return this.setStatus('conflict', rollback.message, context, existing.operationId);
            }
        }

        const operationId = crypto.randomUUID();
        const operationDir = path.join(this.operationRoot(context.stRoot), operationId);
        const record: HostBridgeInstallRecord = {
            schemaVersion: RECORD_SCHEMA_VERSION,
            operationId,
            bridgeVersion: context.manifest.bridgeVersion,
            stRoot: context.stRoot,
            hostPackageVersion: context.hostPackageVersion,
            artifactHash: context.artifactHash,
            phase: 'applying',
            createdAt: nowIso(),
            updatedAt: nowIso(),
            targets: [],
        };

        try {
            ensureDir(operationDir);
            for (const relativePath of context.patch.targetFiles) {
                record.targets.push(this.backupTarget(context.stRoot, operationDir, relativePath, 'patch'));
            }
            for (const asset of context.manifest.assets) {
                record.targets.push(this.backupTarget(context.stRoot, operationDir, asset.target, 'asset'));
            }
            this.writeRecord(record);

            for (const target of record.targets.filter(item => item.kind === 'patch')) {
                const targetPath = this.resolveHostTarget(context.stRoot, target.relativePath);
                const source = fs.readFileSync(targetPath, 'utf8');
                atomicWriteFile(targetPath, context.patch.apply(target.relativePath, source));
                target.patchedHash = hashFile(targetPath);
                record.updatedAt = nowIso();
                this.writeRecord(record);
            }
            for (const asset of context.manifest.assets) {
                const sourcePath = this.resolveBundleTarget(context.bundleDir, asset.source);
                const targetPath = this.resolveHostTarget(context.stRoot, asset.target);
                atomicWriteFile(targetPath, fs.readFileSync(sourcePath));
                const target = record.targets.find(item => item.kind === 'asset' && item.relativePath === normalizeRelative(asset.target));
                if (target) target.patchedHash = hashFile(targetPath);
                record.updatedAt = nowIso();
                this.writeRecord(record);
            }

            this.runSyntaxChecks(context);
            record.phase = 'ready';
            record.updatedAt = nowIso();
            this.writeRecord(record);
            this.logger.info(`[authority] Host Bridge ${record.bridgeVersion} installed for ${context.stRoot}. Restart SillyTavern to activate it.`);
            return this.setStatus(existing ? 'updated' : 'installed', 'Authority Host Bridge installed successfully. Restart SillyTavern to activate it.', context, operationId, true);
        } catch (error) {
            record.phase = 'error';
            record.error = errorMessage(error);
            record.updatedAt = nowIso();
            this.writeRecord(record);
            const rollback = await this.rollbackRecord(record, true);
            const message = rollback.ok
                ? `Host Bridge installation failed and was rolled back: ${record.error}`
                : `Host Bridge installation failed; automatic rollback also failed: ${record.error}; ${rollback.message}`;
            this.logger.error(`[authority] ${message}`);
            return this.setStatus('error', message, context, operationId);
        }
    }

    async repair(): Promise<HostBridgeStatusSnapshot> {
        return await this.install({ repair: true });
    }

    async rollback(options: { force?: boolean } = {}): Promise<HostBridgeStatusSnapshot> {
        try {
            const context = this.resolveContext();
            const record = this.readRecord(context.stRoot);
            if (!record || record.phase === 'rolled_back') {
                return this.setStatus('rolled_back', 'Authority Host Bridge is already absent.', context, record?.operationId ?? null, true);
            }
            const result = await this.rollbackRecord(record, Boolean(options.force));
            if (!result.ok) {
                return this.setStatus('conflict', result.message, context, record.operationId);
            }
            return this.setStatus('rolled_back', 'Authority Host Bridge was rolled back. Restart SillyTavern to activate the original host files.', context, record.operationId, true);
        } catch (error) {
            return this.setStatus('error', errorMessage(error));
        }
    }

    private resolveContext() {
        const bundleDir = path.join(this.pluginRoot, AUTHORITY_MANAGED_HOST_BRIDGE_DIR);
        const manifestPath = path.join(bundleDir, 'manifest.json');
        if (!fs.existsSync(manifestPath)) {
            throw new Error('Managed Authority Host Bridge bundle is missing.');
        }
        const manifest = readJsonFile<HostBridgeManifest | null>(manifestPath, null);
        if (!manifest || manifest.schemaVersion !== 1 || manifest.host !== 'sillytavern' || !manifest.bridgeVersion) {
            throw new Error('Managed Authority Host Bridge manifest is invalid.');
        }
        const stRoot = this.resolveSillyTavernRoot();
        if (!stRoot) {
            throw new Error('Unable to resolve the SillyTavern root for Host Bridge installation.');
        }
        const packageJson = readJsonFile<{ name?: string; version?: string }>(path.join(stRoot, 'package.json'), {});
        const hostPackageVersion = String(packageJson.version ?? 'unknown');
        if (!manifest.supportedPackageVersions.includes(hostPackageVersion)) {
            throw new Error(`SillyTavern ${hostPackageVersion} is not supported by Host Bridge ${manifest.bridgeVersion}.`);
        }
        const patchPath = this.resolveBundleTarget(bundleDir, manifest.patchModule);
        if (this.runtimeRequire.cache) {
            delete this.runtimeRequire.cache[patchPath];
        }
        const patch = this.runtimeRequire(patchPath) as HostBridgePatchModule;
        if (!patch || !Array.isArray(patch.targetFiles) || typeof patch.apply !== 'function' || !patch.bridgeMarker) {
            throw new Error('Managed Authority Host Bridge patch module is invalid.');
        }
        return {
            bundleDir,
            manifest,
            patch,
            stRoot: path.resolve(stRoot),
            hostPackageVersion,
            artifactHash: hashDirectory(bundleDir),
        };
    }

    private hasUnmanagedBridgeMarkers(context: ReturnType<HostBridgeService['resolveContext']>): boolean {
        return context.patch.targetFiles.some(relativePath => {
            const targetPath = this.resolveHostTarget(context.stRoot, relativePath);
            return fs.existsSync(targetPath) && fs.readFileSync(targetPath, 'utf8').includes(context.patch.bridgeMarker);
        });
    }

    private backupTarget(stRoot: string, operationDir: string, relativePath: string, kind: HostBridgeTargetRecord['kind']): HostBridgeTargetRecord {
        const normalized = normalizeRelative(relativePath);
        const targetPath = this.resolveHostTarget(stRoot, normalized);
        const originalExists = fs.existsSync(targetPath);
        const backupPath = originalExists ? path.join(operationDir, 'original', ...normalized.split('/')) : null;
        if (originalExists && backupPath) {
            ensureDir(path.dirname(backupPath));
            fs.copyFileSync(targetPath, backupPath);
        }
        return {
            relativePath: normalized,
            kind,
            originalExists,
            originalHash: originalExists ? hashFile(targetPath) : null,
            patchedHash: null,
            backupPath,
        };
    }

    private verifyRecord(record: HostBridgeInstallRecord): { ok: true } | { ok: false; message: string } {
        for (const target of record.targets) {
            const targetPath = this.resolveHostTarget(record.stRoot, target.relativePath);
            if (!target.patchedHash || !fs.existsSync(targetPath)) {
                return { ok: false, message: `Host Bridge target is missing: ${target.relativePath}` };
            }
            const currentHash = hashFile(targetPath);
            if (currentHash !== target.patchedHash) {
                return { ok: false, message: `Host Bridge target drift detected: ${target.relativePath}` };
            }
        }
        return { ok: true };
    }

    private async rollbackRecord(record: HostBridgeInstallRecord, force: boolean): Promise<{ ok: true } | { ok: false; message: string }> {
        if (!force) {
            for (const target of record.targets) {
                const targetPath = this.resolveHostTarget(record.stRoot, target.relativePath);
                if (!fs.existsSync(targetPath) || !target.patchedHash) continue;
                const currentHash = hashFile(targetPath);
                if (currentHash !== target.patchedHash && currentHash !== target.originalHash) {
                    return { ok: false, message: `Refusing to overwrite drifted Host Bridge target: ${target.relativePath}` };
                }
            }
        }
        record.phase = 'rolling_back';
        record.updatedAt = nowIso();
        this.writeRecord(record);
        try {
            for (const target of [...record.targets].reverse()) {
                const targetPath = this.resolveHostTarget(record.stRoot, target.relativePath);
                if (target.originalExists) {
                    if (!target.backupPath || !fs.existsSync(target.backupPath)) {
                        return { ok: false, message: `Host Bridge backup is missing: ${target.relativePath}` };
                    }
                    atomicWriteFile(targetPath, fs.readFileSync(target.backupPath));
                } else {
                    fs.rmSync(targetPath, { force: true });
                }
            }
            record.phase = 'rolled_back';
            record.updatedAt = nowIso();
            delete record.error;
            this.writeRecord(record);
            return { ok: true };
        } catch (error) {
            record.phase = 'error';
            record.error = errorMessage(error);
            record.updatedAt = nowIso();
            this.writeRecord(record);
            return { ok: false, message: record.error };
        }
    }

    private runSyntaxChecks(context: ReturnType<HostBridgeService['resolveContext']>): void {
        for (const relativePath of context.manifest.syntaxCheckTargets) {
            const targetPath = this.resolveHostTarget(context.stRoot, relativePath);
            const result = childProcess.spawnSync(process.execPath, ['--check', targetPath], {
                cwd: context.stRoot,
                env: this.env,
                encoding: 'utf8',
                windowsHide: true,
            });
            if (result.error || result.status !== 0) {
                const detail = [result.error?.message, result.stderr?.trim(), result.stdout?.trim()].filter(Boolean).join('\n');
                throw new Error(`Syntax validation failed for ${relativePath}${detail ? `: ${detail}` : ''}`);
            }
        }
    }

    private recordPath(stRoot: string): string {
        return path.join(this.stateDir, 'records', `${rootKey(stRoot)}.json`);
    }

    private operationRoot(stRoot: string): string {
        return path.join(this.stateDir, 'operations', rootKey(stRoot));
    }

    private readRecord(stRoot: string): HostBridgeInstallRecord | null {
        const record = readJsonFile<HostBridgeInstallRecord | null>(this.recordPath(stRoot), null);
        return record?.schemaVersion === RECORD_SCHEMA_VERSION ? record : null;
    }

    private writeRecord(record: HostBridgeInstallRecord): void {
        atomicWriteJson(this.recordPath(record.stRoot), record);
    }

    private resolveHostTarget(stRoot: string, relativePath: string): string {
        const target = path.resolve(stRoot, normalizeRelative(relativePath));
        if (!isPathInside(stRoot, target) || target === path.resolve(stRoot)) {
            throw new Error(`Host Bridge target escapes SillyTavern root: ${relativePath}`);
        }
        return target;
    }

    private resolveBundleTarget(bundleDir: string, relativePath: string): string {
        const target = path.resolve(bundleDir, normalizeRelative(relativePath));
        if (!isPathInside(bundleDir, target) || target === path.resolve(bundleDir) || !fs.existsSync(target)) {
            throw new Error(`Host Bridge bundle path is invalid: ${relativePath}`);
        }
        return target;
    }

    private setStatus(
        status: HostBridgeStatusSnapshot['status'],
        message: string,
        context?: { manifest: HostBridgeManifest; hostPackageVersion: string; stRoot: string },
        operationId: string | null = null,
        requiresRestart = false,
    ): HostBridgeStatusSnapshot {
        this.status = this.buildStatus(status, message, context, operationId, requiresRestart);
        return this.getStatus();
    }

    private buildStatus(
        status: HostBridgeStatusSnapshot['status'],
        message: string,
        context?: { manifest: HostBridgeManifest; hostPackageVersion: string; stRoot: string },
        operationId: string | null = null,
        requiresRestart = false,
    ): HostBridgeStatusSnapshot {
        return {
            status,
            message,
            bridgeVersion: context?.manifest.bridgeVersion ?? null,
            hostPackageVersion: context?.hostPackageVersion ?? null,
            sillyTavernRoot: context?.stRoot ?? null,
            operationId,
            requiresRestart,
            checkedAt: nowIso(),
        };
    }
}

function rootKey(stRoot: string): string {
    return crypto.createHash('sha256').update(path.resolve(stRoot).toLowerCase()).digest('hex').slice(0, 24);
}

function normalizeRelative(value: string): string {
    return value.replace(/\\/g, '/').replace(/^\.\//, '');
}

function hashFile(filePath: string): string {
    return crypto.createHash('sha256').update(fs.readFileSync(filePath)).digest('hex');
}

function hashDirectory(rootDir: string): string {
    const hash = crypto.createHash('sha256');
    for (const filePath of listFiles(rootDir)) {
        hash.update(path.relative(rootDir, filePath).replace(/\\/g, '/'));
        hash.update('\0');
        hash.update(fs.readFileSync(filePath));
        hash.update('\0');
    }
    return hash.digest('hex');
}

function listFiles(rootDir: string): string[] {
    const files: string[] = [];
    const visit = (currentDir: string) => {
        for (const entry of fs.readdirSync(currentDir, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
            const fullPath = path.join(currentDir, entry.name);
            if (entry.isDirectory()) visit(fullPath);
            else if (entry.isFile()) files.push(fullPath);
        }
    };
    visit(rootDir);
    return files;
}

function errorMessage(error: unknown): string {
    return error instanceof Error ? error.message : String(error);
}

function resolveRuntimeRequire(): NodeRequire {
    if (typeof __non_webpack_require__ !== 'undefined') {
        return __non_webpack_require__;
    }
    return createRequire(import.meta.url);
}

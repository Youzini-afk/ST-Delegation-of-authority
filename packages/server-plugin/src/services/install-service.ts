import crypto from 'node:crypto';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
    AUTHORITY_MANAGED_FILE,
    AUTHORITY_MANAGED_CORE_DIR,
    AUTHORITY_MANAGED_SDK_DIR,
    AUTHORITY_PLUGIN_ID,
    AUTHORITY_RELEASE_FILE,
    AUTHORITY_SDK_EXTENSION_ID,
} from '../constants.js';
import type {
    AdminGitUpdateSummary,
    AuthorityCoreManagedMetadata,
    AuthorityManagedMetadata,
    AuthorityReleaseMetadata,
    InstallStatusSnapshot,
} from '../types.js';
import { atomicWriteJson, nowIso, readJsonFile } from '../utils.js';

interface InstallServiceOptions {
    runtimeDir?: string;
    cwd?: string;
    env?: NodeJS.ProcessEnv;
    logger?: Pick<typeof console, 'info' | 'warn' | 'error'>;
}

const DEFAULT_VERSION = '0.0.0-dev';
const TEXT_HASH_EXTENSIONS = new Set([
    '.cjs',
    '.css',
    '.html',
    '.js',
    '.json',
    '.map',
    '.md',
    '.mjs',
    '.svg',
    '.txt',
    '.yaml',
    '.yml',
]);
const CORE_AUTOBUILD_DISABLED_VALUES = new Set(['0', 'false', 'off', 'no']);

interface ManagedCoreArtifactSummary {
    platformDir: string;
    binaryPath: string;
    metadata: AuthorityCoreManagedMetadata;
    binarySha256: string;
}

export class InstallService {
    private readonly runtimeDir: string;
    private readonly pluginRoot: string;
    private readonly cwd: string;
    private readonly env: NodeJS.ProcessEnv;
    private readonly logger: Pick<typeof console, 'info' | 'warn' | 'error'>;
    private releaseMetadata: AuthorityReleaseMetadata | null;
    private coreBuildMessage: string | null;
    private status: InstallStatusSnapshot;

    constructor(options: InstallServiceOptions = {}) {
        this.runtimeDir = path.resolve(options.runtimeDir ?? __dirname);
        this.pluginRoot = resolvePluginRoot(this.runtimeDir);
        this.cwd = path.resolve(options.cwd ?? process.cwd());
        this.env = options.env ?? process.env;
        this.logger = options.logger ?? console;
        this.releaseMetadata = readReleaseMetadata(this.pluginRoot);
        this.coreBuildMessage = null;
        const expectedCorePlatform = getCurrentCorePlatform(this.env);

        this.status = {
            installStatus: 'missing',
            installMessage: 'Authority SDK deployment has not run yet.',
            pluginVersion: this.getPluginVersion(),
            sdkBundledVersion: this.getBundledSdkVersion(),
            sdkDeployedVersion: null,
            coreBundledVersion: this.releaseMetadata?.coreVersion ?? null,
            coreArtifactPlatform: this.getCoreArtifactPlatforms().includes(expectedCorePlatform)
                ? expectedCorePlatform
                : this.releaseMetadata?.coreArtifactPlatform ?? null,
            coreArtifactPlatforms: this.getCoreArtifactPlatforms(),
            coreArtifactHash: this.releaseMetadata?.coreArtifactHash ?? null,
            coreBinarySha256: this.releaseMetadata?.coreArtifacts?.[expectedCorePlatform]?.binarySha256
                ?? this.releaseMetadata?.coreBinarySha256
                ?? null,
            coreVerified: false,
            coreMessage: null,
        };
    }

    getStatus(): InstallStatusSnapshot {
        return {
            ...this.status,
            coreArtifactPlatforms: [...this.status.coreArtifactPlatforms],
        };
    }

    async bootstrap(): Promise<InstallStatusSnapshot> {
        this.refreshReleaseMetadata();
        this.coreBuildMessage = this.ensureCurrentPlatformCore();
        this.refreshReleaseMetadata();
        const bundledDir = path.join(this.pluginRoot, AUTHORITY_MANAGED_SDK_DIR);
        try {
            if (!this.releaseMetadata || !fs.existsSync(bundledDir)) {
                return this.setStatus('missing', 'Managed Authority SDK bundle is not embedded in this plugin build.', {
                    sdkDeployedVersion: null,
                    coreVerified: false,
                    coreMessage: 'Managed Authority SDK bundle is not embedded in this plugin build.',
                });
            }

            const coreCheck = this.verifyBundledCore();
            const coreVerified = coreCheck.ok;
            const coreMessage = coreCheck.ok ? coreCheck.message : coreCheck.message;

            const sillyTavernRoot = this.resolveSillyTavernRoot();
            if (!sillyTavernRoot) {
                return this.setStatus('missing', 'Unable to resolve the SillyTavern root for managed SDK deployment.', {
                    sdkDeployedVersion: null,
                    coreVerified,
                    coreMessage,
                });
            }

            const targetDir = path.join(
                sillyTavernRoot,
                'public',
                'scripts',
                'extensions',
                'third-party',
                'st-authority-sdk',
            );
            const managedFile = path.join(targetDir, AUTHORITY_MANAGED_FILE);
            const existingManaged = readJsonFile<AuthorityManagedMetadata | null>(managedFile, null);

            if (!fs.existsSync(targetDir)) {
                this.deployBundledSdk(bundledDir, targetDir);
                return this.setStatus('installed', buildInstallMessage('deployed', targetDir, coreCheck), {
                    sdkDeployedVersion: this.releaseMetadata.sdkVersion,
                    coreVerified,
                    coreMessage,
                });
            }

            if (!existingManaged || existingManaged.managedBy !== AUTHORITY_PLUGIN_ID) {
                return this.setStatus('conflict', `Authority SDK target already exists and is not managed by ${AUTHORITY_PLUGIN_ID}.`, {
                    sdkDeployedVersion: null,
                    coreVerified,
                    coreMessage,
                });
            }

            const currentHash = hashDirectory(targetDir, new Set([AUTHORITY_MANAGED_FILE]));
            const needsUpdate = existingManaged.sdkVersion !== this.releaseMetadata.sdkVersion
                || existingManaged.assetHash !== this.releaseMetadata.assetHash
                || currentHash !== this.releaseMetadata.assetHash;

            if (needsUpdate) {
                this.deployBundledSdk(bundledDir, targetDir);
                return this.setStatus('updated', buildInstallMessage('updated', targetDir, coreCheck), {
                    sdkDeployedVersion: this.releaseMetadata.sdkVersion,
                    coreVerified,
                    coreMessage,
                });
            }

            return this.setStatus('ready', buildInstallMessage('ready', targetDir, coreCheck), {
                sdkDeployedVersion: existingManaged.sdkVersion,
                coreVerified,
                coreMessage,
            });
        } catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            this.logger.error(`[authority] Managed SDK deployment failed: ${message}`);
            return this.setStatus('error', message, {
                sdkDeployedVersion: null,
                coreVerified: false,
                coreMessage: message,
            });
        }
    }

    getPluginRoot(): string {
        return this.pluginRoot;
    }

    redeployBundledSdk(): Promise<InstallStatusSnapshot> {
        return this.bootstrap();
    }

    pullLatestFromGit(): AdminGitUpdateSummary {
        if (!fs.existsSync(path.join(this.pluginRoot, '.git'))) {
            throw new Error('当前 Authority 插件目录不是 Git 仓库，无法执行服务端插件更新。');
        }

        const branch = runGit(this.pluginRoot, ['rev-parse', '--abbrev-ref', 'HEAD'], this.env).stdout || null;
        const previousRevision = runGit(this.pluginRoot, ['rev-parse', 'HEAD'], this.env).stdout || null;
        const pullResult = runGit(this.pluginRoot, ['pull', '--ff-only'], this.env, true);
        const currentRevision = runGit(this.pluginRoot, ['rev-parse', 'HEAD'], this.env).stdout || null;

        this.refreshReleaseMetadata();

        return {
            pluginRoot: this.pluginRoot,
            branch,
            previousRevision,
            currentRevision,
            changed: previousRevision !== currentRevision,
            stdout: pullResult.stdout || null,
            stderr: pullResult.stderr || null,
        };
    }

    private refreshReleaseMetadata(): void {
        this.releaseMetadata = readReleaseMetadata(this.pluginRoot);
        this.status = {
            ...this.status,
            pluginVersion: this.getPluginVersion(),
            sdkBundledVersion: this.getBundledSdkVersion(),
            coreBundledVersion: this.releaseMetadata?.coreVersion ?? null,
            coreArtifactPlatform: this.getResolvedCoreArtifactPlatform(),
            coreArtifactPlatforms: this.getCoreArtifactPlatforms(),
            coreArtifactHash: this.releaseMetadata?.coreArtifactHash ?? null,
            coreBinarySha256: this.getCoreBinarySha256(),
        };
    }

    private getPluginVersion(): string {
        return this.releaseMetadata?.pluginVersion ?? readPackageVersion(this.pluginRoot) ?? DEFAULT_VERSION;
    }

    private getBundledSdkVersion(): string {
        return this.releaseMetadata?.sdkVersion ?? readBundledSdkVersion(this.pluginRoot) ?? this.getPluginVersion();
    }

    private getCoreArtifactPlatforms(): string[] {
        return Array.from(new Set([
            ...getReleaseCorePlatforms(this.releaseMetadata),
            ...getManagedCorePlatforms(this.pluginRoot),
        ])).sort();
    }

    private getResolvedCoreArtifactPlatform(): string | null {
        const expectedCorePlatform = getCurrentCorePlatform(this.env);
        const coreArtifactPlatforms = this.getCoreArtifactPlatforms();
        return coreArtifactPlatforms.includes(expectedCorePlatform)
            ? expectedCorePlatform
            : this.releaseMetadata?.coreArtifactPlatform ?? null;
    }

    private getCoreBinarySha256(): string | null {
        const expectedCorePlatform = getCurrentCorePlatform(this.env);
        return this.releaseMetadata?.coreArtifacts?.[expectedCorePlatform]?.binarySha256
            ?? readManagedCoreArtifact(this.pluginRoot, expectedCorePlatform)?.binarySha256
            ?? this.releaseMetadata?.coreBinarySha256
            ?? null;
    }

    private resolveSillyTavernRoot(): string | null {
        const envRoot = this.env.AUTHORITY_ST_ROOT?.trim();
        const candidates = [
            this.cwd,
            path.resolve(this.pluginRoot, '..', '..'),
            envRoot ? path.resolve(envRoot) : null,
        ];

        for (const candidate of candidates) {
            if (candidate && isSillyTavernRoot(candidate)) {
                return candidate;
            }
        }

        return null;
    }

    private deployBundledSdk(bundledDir: string, targetDir: string): void {
        const parentDir = path.dirname(targetDir);
        fs.mkdirSync(parentDir, { recursive: true });
        const backupDir = fs.existsSync(targetDir)
            ? path.join(parentDir, `${path.basename(targetDir)}.authority-backup-${Date.now()}-${crypto.randomUUID()}`)
            : null;
        if (backupDir) {
            fs.renameSync(targetDir, backupDir);
        }

        try {
            fs.cpSync(bundledDir, targetDir, { recursive: true, force: true });

            const metadata: AuthorityManagedMetadata = {
                managedBy: AUTHORITY_PLUGIN_ID,
                pluginVersion: this.releaseMetadata?.pluginVersion ?? this.status.pluginVersion,
                sdkVersion: this.releaseMetadata?.sdkVersion ?? this.status.sdkBundledVersion,
                assetHash: this.releaseMetadata?.assetHash ?? hashDirectory(targetDir, new Set([AUTHORITY_MANAGED_FILE])),
                installedAt: nowIso(),
                targetPath: targetDir,
            };

            atomicWriteJson(path.join(targetDir, AUTHORITY_MANAGED_FILE), metadata);
            if (backupDir) {
                fs.rmSync(backupDir, { recursive: true, force: true });
            }
            this.logger.info(`[authority] Managed SDK deployed to ${targetDir}`);
        } catch (error) {
            fs.rmSync(targetDir, { recursive: true, force: true });
            if (backupDir && fs.existsSync(backupDir)) {
                fs.renameSync(backupDir, targetDir);
            }
            throw error;
        }
    }

    private ensureCurrentPlatformCore(): string | null {
        const expectedPlatform = getCurrentCorePlatform(this.env);
        if (readManagedCoreArtifact(this.pluginRoot, expectedPlatform)) {
            return null;
        }
        const expectedLibc = getCorePlatformLibc(expectedPlatform);

        if (isCoreAutobuildDisabled(this.env)) {
            return `Managed authority-core for ${expectedPlatform} is missing and local core build is disabled by AUTHORITY_CORE_AUTOBUILD.`;
        }

        if (!canBuildCoreFromSource(this.pluginRoot)) {
            return `Managed authority-core for ${expectedPlatform} is missing and local source build is unavailable. Install the multi-platform package, or run npm run build:core from a full source checkout.`;
        }

        const cargoCheck = spawnSync('cargo', ['--version'], {
            cwd: this.pluginRoot,
            env: this.env,
            encoding: 'utf8',
            windowsHide: true,
        });
        if (cargoCheck.error || cargoCheck.status !== 0) {
            return `Managed authority-core for ${expectedPlatform} is missing and Cargo is not available. Install Rust/Cargo, then run npm run build:core in the plugin directory.`;
        }

        const binaryName = process.platform === 'win32' ? 'authority-core.exe' : 'authority-core';
        const targetDir = path.join(this.pluginRoot, AUTHORITY_MANAGED_CORE_DIR, expectedPlatform);
        const beforeBuild = fs.existsSync(targetDir) ? fs.mkdtempSync(path.join(os.tmpdir(), 'authority-core-autobuild-')) : null;
        if (beforeBuild) {
            fs.cpSync(targetDir, beforeBuild, { recursive: true, force: true });
        }
        this.logger.info(`[authority] Managed authority-core for ${expectedPlatform} is missing; building it locally from source.`);
        const build = spawnSync(process.execPath, ['./scripts/build-core.mjs'], {
            cwd: this.pluginRoot,
            env: {
                ...this.env,
                AUTHORITY_CORE_PLATFORM_ID: expectedPlatform,
                AUTHORITY_CORE_TARGET_PLATFORM: process.platform,
                AUTHORITY_CORE_TARGET_ARCH: process.arch,
                ...(expectedLibc ? { AUTHORITY_CORE_TARGET_LIBC: expectedLibc } : {}),
                AUTHORITY_CORE_BINARY_NAME: binaryName,
            },
            encoding: 'utf8',
            windowsHide: true,
        });
        if (build.error || build.status !== 0) {
            if (beforeBuild) {
                fs.rmSync(targetDir, { recursive: true, force: true });
                fs.cpSync(beforeBuild, targetDir, { recursive: true, force: true });
                fs.rmSync(beforeBuild, { recursive: true, force: true });
            } else {
                fs.rmSync(targetDir, { recursive: true, force: true });
            }
            const detail = [
                build.error ? build.error.message : '',
                build.stderr?.trim() ?? '',
                build.stdout?.trim() ?? '',
            ].filter(Boolean).join('\n');
            return `Managed authority-core for ${expectedPlatform} is missing and local source build failed${detail ? `: ${detail}` : '.'}`;
        }
        if (beforeBuild) {
            fs.rmSync(beforeBuild, { recursive: true, force: true });
        }

        return `Managed authority-core for ${expectedPlatform} was built locally from source.`;
    }

    private verifyBundledCore(): { ok: true; platform: string; message: string | null } | { ok: false; message: string } {
        const release = this.releaseMetadata;
        if (!release) {
            return { ok: false, message: 'Authority release metadata is missing.' };
        }

        const expectedPlatform = getCurrentCorePlatform(this.env);
        const expectedLibc = getCorePlatformLibc(expectedPlatform);
        const releasePlatforms = getReleaseCorePlatforms(release);
        const localArtifact = readManagedCoreArtifact(this.pluginRoot, expectedPlatform);
        if (!localArtifact) {
            const platformMessage = releasePlatforms.length > 0 && !releasePlatforms.includes(expectedPlatform)
                ? `Managed authority-core artifacts target ${releasePlatforms.join(', ')}, but this runtime needs ${expectedPlatform}.`
                : `Managed authority-core metadata is missing for ${expectedPlatform}.`;
            return {
                ok: false,
                message: [platformMessage, this.coreBuildMessage].filter(Boolean).join(' '),
            };
        }

        const { metadata, binarySha256, platformDir } = localArtifact;
        if (metadata.managedBy !== AUTHORITY_PLUGIN_ID) {
            return {
                ok: false,
                message: `Managed authority-core metadata for ${expectedPlatform} is invalid.`,
            };
        }

        if (metadata.platform !== process.platform || metadata.arch !== process.arch) {
            return {
                ok: false,
                message: `Managed authority-core metadata platform mismatch: ${metadata.platform}-${metadata.arch}.`,
            };
        }
        if ((metadata.libc ?? null) !== expectedLibc) {
            return {
                ok: false,
                message: `Managed authority-core metadata libc mismatch: expected ${expectedLibc ?? 'unspecified'}, found ${metadata.libc ?? 'unspecified'}.`,
            };
        }

        if (release.coreVersion && metadata.version !== release.coreVersion) {
            return {
                ok: false,
                message: `Managed authority-core version mismatch: expected ${release.coreVersion}, found ${metadata.version}.`,
            };
        }

        if (metadata.binarySha256 !== binarySha256) {
            return {
                ok: false,
                message: 'Managed authority-core binary hash does not match its metadata.',
            };
        }

        const releaseArtifact = release.coreArtifacts?.[expectedPlatform];
        if (releaseArtifact && releaseArtifact.binarySha256 !== binarySha256) {
            return {
                ok: false,
                message: 'Managed authority-core binary hash does not match platform release metadata.',
            };
        }
        if (!releaseArtifact && releasePlatforms.includes(expectedPlatform) && release.coreBinarySha256 && release.coreBinarySha256 !== binarySha256) {
            return {
                ok: false,
                message: 'Managed authority-core binary hash does not match release metadata.',
            };
        }

        const warnings: string[] = [];
        if (!releaseArtifact && releasePlatforms.length > 0 && !releasePlatforms.includes(expectedPlatform)) {
            warnings.push(`Managed authority-core release metadata targets ${releasePlatforms.join(', ')}, but ${expectedPlatform} is available locally and verified against its local metadata.`);
        }
        if (this.coreBuildMessage) {
            warnings.push(this.coreBuildMessage);
        }
        if (releaseArtifact) {
            const platformArtifactHash = hashDirectory(platformDir);
            if (releaseArtifact.artifactHash !== platformArtifactHash) {
                warnings.push('Managed authority-core platform artifact hash drift detected. SDK deployment remains enabled because the core binary itself is verified.');
            }
        }

        if (release.coreArtifactHash) {
            const artifactHash = hashDirectory(path.join(this.pluginRoot, AUTHORITY_MANAGED_CORE_DIR));
            if (artifactHash !== release.coreArtifactHash) {
                warnings.push('Managed authority-core artifact directory hash drift detected. SDK deployment remains enabled because the current platform binary is verified.');
            }
        }

        return {
            ok: true,
            platform: expectedPlatform,
            message: warnings.length > 0 ? warnings.join(' ') : null,
        };
    }

    private setStatus(
        installStatus: InstallStatusSnapshot['installStatus'],
        installMessage: string,
        patch: Partial<Pick<InstallStatusSnapshot, 'sdkDeployedVersion' | 'coreVerified' | 'coreMessage'>> = {},
    ): InstallStatusSnapshot {
        this.status = {
            ...this.status,
            ...patch,
            installStatus,
            installMessage,
        };

        const prefix = `[authority] ${installStatus.toUpperCase()}`;
        if (installStatus === 'error') {
            this.logger.error(`${prefix}: ${installMessage}`);
        } else if (installStatus === 'conflict' || installStatus === 'missing') {
            this.logger.warn(`${prefix}: ${installMessage}`);
        } else {
            this.logger.info(`${prefix}: ${installMessage}`);
        }

        return this.getStatus();
    }
}

function buildInstallMessage(
    kind: 'deployed' | 'updated' | 'ready',
    targetDir: string,
    coreCheck: { ok: true; platform: string; message: string | null } | { ok: false; message: string },
): string {
    const prefix = kind === 'deployed'
        ? `Authority SDK deployed to ${targetDir}.`
        : kind === 'updated'
            ? `Authority SDK refreshed at ${targetDir}.`
            : `Authority SDK is already available at ${targetDir}.`;

    if (!coreCheck.ok) {
        return `${prefix} Core verification warning: ${coreCheck.message}`;
    }

    if (coreCheck.message) {
        return `${prefix} Core verified for ${coreCheck.platform} with warnings: ${coreCheck.message}`;
    }

    return `${prefix} Core artifact verified for ${coreCheck.platform}.`;
}

function resolvePluginRoot(runtimeDir: string): string {
    let current = runtimeDir;

    while (true) {
        if (fs.existsSync(path.join(current, AUTHORITY_RELEASE_FILE))) {
            return current;
        }

        const packageJsonPath = path.join(current, 'package.json');
        if (fs.existsSync(packageJsonPath)) {
            const packageJson = readJsonFile<{ name?: string }>(packageJsonPath, {});
            if (packageJson.name === AUTHORITY_PLUGIN_ID) {
                return current;
            }
        }

        const parent = path.dirname(current);
        if (parent === current) {
            return runtimeDir;
        }
        current = parent;
    }
}

function readReleaseMetadata(pluginRoot: string): AuthorityReleaseMetadata | null {
    return readJsonFile<AuthorityReleaseMetadata | null>(path.join(pluginRoot, AUTHORITY_RELEASE_FILE), null);
}

function runGit(
    cwd: string,
    args: string[],
    env: NodeJS.ProcessEnv,
    allowNoisyOutput = false,
): { stdout: string; stderr: string } {
    const result = spawnSync('git', args, {
        cwd,
        env,
        encoding: 'utf8',
        windowsHide: true,
    });

    const stdout = (result.stdout ?? '').trim();
    const stderr = (result.stderr ?? '').trim();

    if (result.error) {
        throw result.error;
    }

    if (typeof result.status === 'number' && result.status !== 0) {
        const message = [stderr, stdout].filter(Boolean).join('\n') || `git ${args.join(' ')} failed with exit code ${result.status}`;
        throw new Error(message);
    }

    if (!allowNoisyOutput && stderr) {
        return { stdout, stderr: '' };
    }

    return { stdout, stderr };
}

function getCurrentCorePlatform(env: NodeJS.ProcessEnv = process.env): string {
    const basePlatform = `${process.platform}-${process.arch}`;
    return getCurrentLinuxLibc(env) === 'musl'
        ? `${basePlatform}-musl`
        : basePlatform;
}

function getCurrentLinuxLibc(env: NodeJS.ProcessEnv): 'musl' | 'gnu' | null {
    if (process.platform !== 'linux') {
        return null;
    }

    const override = env.AUTHORITY_CORE_LIBC?.trim().toLowerCase();
    if (override === 'musl') {
        return 'musl';
    }
    if (override === 'gnu' || override === 'glibc') {
        return 'gnu';
    }

    const report = process.report?.getReport?.() as { header?: { glibcVersionRuntime?: string; glibcVersionCompiler?: string } } | undefined;
    const header = report?.header;
    return header?.glibcVersionRuntime || header?.glibcVersionCompiler ? 'gnu' : 'musl';
}

function getCorePlatformLibc(platformId: string): string | null {
    return platformId.endsWith('-musl') ? 'musl' : null;
}

function getReleaseCorePlatforms(release: AuthorityReleaseMetadata | null): string[] {
    if (!release) {
        return [];
    }

    if (Array.isArray(release.coreArtifactPlatforms) && release.coreArtifactPlatforms.length > 0) {
        return [...release.coreArtifactPlatforms].sort();
    }

    if (release.coreArtifacts && Object.keys(release.coreArtifacts).length > 0) {
        return Object.keys(release.coreArtifacts).sort();
    }

    return release.coreArtifactPlatform ? [release.coreArtifactPlatform] : [];
}

function getManagedCorePlatforms(pluginRoot: string): string[] {
    const coreRoot = path.join(pluginRoot, AUTHORITY_MANAGED_CORE_DIR);
    if (!fs.existsSync(coreRoot)) {
        return [];
    }

    return fs.readdirSync(coreRoot, { withFileTypes: true })
        .filter(entry => entry.isDirectory())
        .map(entry => entry.name)
        .sort();
}

function readManagedCoreArtifact(pluginRoot: string, platformId: string): ManagedCoreArtifactSummary | null {
    const platformDir = path.join(pluginRoot, AUTHORITY_MANAGED_CORE_DIR, platformId);
    const metadataPath = path.join(platformDir, 'authority-core.json');
    const metadata = readJsonFile<AuthorityCoreManagedMetadata | null>(metadataPath, null);
    if (!metadata) {
        return null;
    }

    const binaryPath = path.join(platformDir, metadata.binaryName);
    if (!fs.existsSync(binaryPath)) {
        return null;
    }

    return {
        platformDir,
        binaryPath,
        metadata,
        binarySha256: hashFile(binaryPath),
    };
}

function isCoreAutobuildDisabled(env: NodeJS.ProcessEnv): boolean {
    return CORE_AUTOBUILD_DISABLED_VALUES.has(env.AUTHORITY_CORE_AUTOBUILD?.trim().toLowerCase() ?? '');
}

function canBuildCoreFromSource(pluginRoot: string): boolean {
    return fs.existsSync(path.join(pluginRoot, 'scripts', 'build-core.mjs'))
        && fs.existsSync(path.join(pluginRoot, 'crates', 'authority-core', 'Cargo.toml'));
}

function readPackageVersion(pluginRoot: string): string | null {
    const packageJsonPath = path.join(pluginRoot, 'package.json');
    if (!fs.existsSync(packageJsonPath)) {
        return null;
    }

    return readJsonFile<{ version?: string }>(packageJsonPath, {}).version ?? null;
}

function readBundledSdkVersion(pluginRoot: string): string | null {
    const manifestPath = path.join(pluginRoot, AUTHORITY_MANAGED_SDK_DIR, 'manifest.json');
    if (!fs.existsSync(manifestPath)) {
        return null;
    }

    return readJsonFile<{ version?: string }>(manifestPath, {}).version ?? null;
}

function isSillyTavernRoot(candidate: string): boolean {
    return fs.existsSync(path.join(candidate, 'plugins'))
        && fs.existsSync(path.join(candidate, 'public', 'scripts', 'extensions'));
}

function hashDirectory(rootDir: string, ignoreNames = new Set<string>()): string {
    const hash = crypto.createHash('sha256');
    for (const filePath of listFiles(rootDir, ignoreNames)) {
        const relativePath = path.relative(rootDir, filePath).replace(/\\/g, '/');
        hash.update(relativePath);
        hash.update('\0');
        hash.update(readStableHashContent(filePath));
        hash.update('\0');
    }
    return hash.digest('hex');
}

function hashFile(filePath: string): string {
    return crypto.createHash('sha256').update(fs.readFileSync(filePath)).digest('hex');
}

function readStableHashContent(filePath: string): Buffer {
    const content = fs.readFileSync(filePath);
    if (!TEXT_HASH_EXTENSIONS.has(path.extname(filePath).toLowerCase())) {
        return content;
    }

    return Buffer.from(content.toString('utf8').replace(/\r\n?/g, '\n'), 'utf8');
}

function listFiles(rootDir: string, ignoreNames: Set<string>): string[] {
    const files: string[] = [];

    if (!fs.existsSync(rootDir)) {
        return files;
    }

    const visit = (currentDir: string): void => {
        const entries = fs.readdirSync(currentDir, { withFileTypes: true })
            .filter(entry => !ignoreNames.has(entry.name))
            .sort((left, right) => left.name.localeCompare(right.name));

        for (const entry of entries) {
            const fullPath = path.join(currentDir, entry.name);
            if (entry.isDirectory()) {
                visit(fullPath);
            } else if (entry.isFile()) {
                files.push(fullPath);
            }
        }
    };

    visit(rootDir);
    return files;
}

import crypto from 'node:crypto';
import fs from 'node:fs';
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

export class InstallService {
    private readonly runtimeDir: string;
    private readonly pluginRoot: string;
    private readonly cwd: string;
    private readonly env: NodeJS.ProcessEnv;
    private readonly logger: Pick<typeof console, 'info' | 'warn' | 'error'>;
    private readonly releaseMetadata: AuthorityReleaseMetadata | null;
    private status: InstallStatusSnapshot;

    constructor(options: InstallServiceOptions = {}) {
        this.runtimeDir = path.resolve(options.runtimeDir ?? __dirname);
        this.pluginRoot = resolvePluginRoot(this.runtimeDir);
        this.cwd = path.resolve(options.cwd ?? process.cwd());
        this.env = options.env ?? process.env;
        this.logger = options.logger ?? console;
        this.releaseMetadata = readReleaseMetadata(this.pluginRoot);

        const pluginVersion = this.releaseMetadata?.pluginVersion ?? readPackageVersion(this.pluginRoot) ?? DEFAULT_VERSION;
        const sdkBundledVersion = this.releaseMetadata?.sdkVersion ?? readBundledSdkVersion(this.pluginRoot) ?? pluginVersion;
        const coreArtifactPlatforms = getReleaseCorePlatforms(this.releaseMetadata);
        const expectedCorePlatform = getCurrentCorePlatform();

        this.status = {
            installStatus: 'missing',
            installMessage: 'Authority SDK deployment has not run yet.',
            pluginVersion,
            sdkBundledVersion,
            sdkDeployedVersion: null,
            coreBundledVersion: this.releaseMetadata?.coreVersion ?? null,
            coreArtifactPlatform: coreArtifactPlatforms.includes(expectedCorePlatform)
                ? expectedCorePlatform
                : this.releaseMetadata?.coreArtifactPlatform ?? null,
            coreArtifactPlatforms,
            coreArtifactHash: this.releaseMetadata?.coreArtifactHash ?? null,
            coreBinarySha256: this.releaseMetadata?.coreArtifacts?.[expectedCorePlatform]?.binarySha256
                ?? this.releaseMetadata?.coreBinarySha256
                ?? null,
            coreVerified: false,
        };
    }

    getStatus(): InstallStatusSnapshot {
        return {
            ...this.status,
            coreArtifactPlatforms: [...this.status.coreArtifactPlatforms],
        };
    }

    async bootstrap(): Promise<InstallStatusSnapshot> {
        const bundledDir = path.join(this.pluginRoot, AUTHORITY_MANAGED_SDK_DIR);
        try {
            if (!this.releaseMetadata || !fs.existsSync(bundledDir)) {
                return this.setStatus('missing', 'Managed Authority SDK bundle is not embedded in this plugin build.', {
                    sdkDeployedVersion: null,
                    coreVerified: false,
                });
            }

            const coreCheck = this.verifyBundledCore();
            if (!coreCheck.ok) {
                return this.setStatus('missing', coreCheck.message, {
                    sdkDeployedVersion: null,
                    coreVerified: false,
                });
            }

            const sillyTavernRoot = this.resolveSillyTavernRoot();
            if (!sillyTavernRoot) {
                return this.setStatus('missing', 'Unable to resolve the SillyTavern root for managed SDK deployment.', {
                    sdkDeployedVersion: null,
                    coreVerified: true,
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
                return this.setStatus('installed', `Authority SDK deployed to ${targetDir}. Core artifact verified for ${coreCheck.platform}.`, {
                    sdkDeployedVersion: this.releaseMetadata.sdkVersion,
                    coreVerified: true,
                });
            }

            if (!existingManaged || existingManaged.managedBy !== AUTHORITY_PLUGIN_ID) {
                return this.setStatus('conflict', `Authority SDK target already exists and is not managed by ${AUTHORITY_PLUGIN_ID}. Core artifact verified for ${coreCheck.platform}.`, {
                    sdkDeployedVersion: null,
                    coreVerified: true,
                });
            }

            const currentHash = hashDirectory(targetDir, new Set([AUTHORITY_MANAGED_FILE]));
            const needsUpdate = existingManaged.sdkVersion !== this.releaseMetadata.sdkVersion
                || existingManaged.assetHash !== this.releaseMetadata.assetHash
                || currentHash !== this.releaseMetadata.assetHash;

            if (needsUpdate) {
                this.deployBundledSdk(bundledDir, targetDir);
                return this.setStatus('updated', `Authority SDK refreshed at ${targetDir}. Core artifact verified for ${coreCheck.platform}.`, {
                    sdkDeployedVersion: this.releaseMetadata.sdkVersion,
                    coreVerified: true,
                });
            }

            return this.setStatus('ready', `Authority SDK is already available at ${targetDir}. Core artifact verified for ${coreCheck.platform}.`, {
                sdkDeployedVersion: existingManaged.sdkVersion,
                coreVerified: true,
            });
        } catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            this.logger.error(`[authority] Managed SDK deployment failed: ${message}`);
            return this.setStatus('error', message, {
                sdkDeployedVersion: null,
                coreVerified: false,
            });
        }
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

    private verifyBundledCore(): { ok: true; platform: string } | { ok: false; message: string } {
        const release = this.releaseMetadata;
        if (!release) {
            return { ok: false, message: 'Authority release metadata is missing.' };
        }

        const expectedPlatform = getCurrentCorePlatform();
        const releasePlatforms = getReleaseCorePlatforms(release);
        if (releasePlatforms.length > 0 && !releasePlatforms.includes(expectedPlatform)) {
            return {
                ok: false,
                message: `Managed authority-core artifacts target ${releasePlatforms.join(', ')}, but this runtime needs ${expectedPlatform}.`,
            };
        }

        const platformDir = path.join(this.pluginRoot, AUTHORITY_MANAGED_CORE_DIR, expectedPlatform);
        const metadataPath = path.join(platformDir, 'authority-core.json');
        if (!fs.existsSync(metadataPath)) {
            return {
                ok: false,
                message: `Managed authority-core metadata is missing for ${expectedPlatform}.`,
            };
        }

        const metadata = readJsonFile<AuthorityCoreManagedMetadata | null>(metadataPath, null);
        if (!metadata || metadata.managedBy !== AUTHORITY_PLUGIN_ID) {
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

        if (release.coreVersion && metadata.version !== release.coreVersion) {
            return {
                ok: false,
                message: `Managed authority-core version mismatch: expected ${release.coreVersion}, found ${metadata.version}.`,
            };
        }

        const binaryPath = path.join(platformDir, metadata.binaryName);
        if (!fs.existsSync(binaryPath)) {
            return {
                ok: false,
                message: `Managed authority-core binary is missing: ${binaryPath}.`,
            };
        }

        const binarySha256 = hashFile(binaryPath);
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

        if (!releaseArtifact && release.coreBinarySha256 && release.coreBinarySha256 !== binarySha256) {
            return {
                ok: false,
                message: 'Managed authority-core binary hash does not match release metadata.',
            };
        }

        if (releaseArtifact) {
            const platformArtifactHash = hashDirectory(platformDir);
            if (releaseArtifact.artifactHash !== platformArtifactHash) {
                return {
                    ok: false,
                    message: 'Managed authority-core platform artifact hash does not match release metadata.',
                };
            }
        }

        if (release.coreArtifactHash) {
            const artifactHash = hashDirectory(path.join(this.pluginRoot, AUTHORITY_MANAGED_CORE_DIR));
            if (artifactHash !== release.coreArtifactHash) {
                return {
                    ok: false,
                    message: 'Managed authority-core artifact hash does not match release metadata.',
                };
            }
        }

        return { ok: true, platform: expectedPlatform };
    }

    private setStatus(
        installStatus: InstallStatusSnapshot['installStatus'],
        installMessage: string,
        patch: Partial<Pick<InstallStatusSnapshot, 'sdkDeployedVersion' | 'coreVerified'>> = {},
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

function getCurrentCorePlatform(): string {
    return `${process.platform}-${process.arch}`;
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
        hash.update(fs.readFileSync(filePath));
        hash.update('\0');
    }
    return hash.digest('hex');
}

function hashFile(filePath: string): string {
    return crypto.createHash('sha256').update(fs.readFileSync(filePath)).digest('hex');
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

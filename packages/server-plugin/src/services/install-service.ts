import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import {
    AUTHORITY_MANAGED_FILE,
    AUTHORITY_MANAGED_SDK_DIR,
    AUTHORITY_PLUGIN_ID,
    AUTHORITY_RELEASE_FILE,
    AUTHORITY_SDK_EXTENSION_ID,
} from '../constants.js';
import type {
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

        this.status = {
            installStatus: 'missing',
            installMessage: 'Authority SDK deployment has not run yet.',
            pluginVersion,
            sdkBundledVersion,
            sdkDeployedVersion: null,
        };
    }

    getStatus(): InstallStatusSnapshot {
        return { ...this.status };
    }

    async bootstrap(): Promise<InstallStatusSnapshot> {
        const bundledDir = path.join(this.pluginRoot, AUTHORITY_MANAGED_SDK_DIR);
        try {
            if (!this.releaseMetadata || !fs.existsSync(bundledDir)) {
                return this.setStatus('missing', 'Managed Authority SDK bundle is not embedded in this plugin build.');
            }

            const sillyTavernRoot = this.resolveSillyTavernRoot();
            if (!sillyTavernRoot) {
                return this.setStatus('missing', 'Unable to resolve the SillyTavern root for managed SDK deployment.');
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
                return this.setStatus('installed', `Authority SDK deployed to ${targetDir}.`, this.releaseMetadata.sdkVersion);
            }

            if (!existingManaged || existingManaged.managedBy !== AUTHORITY_PLUGIN_ID) {
                return this.setStatus('conflict', `Authority SDK target already exists and is not managed by ${AUTHORITY_PLUGIN_ID}.`, null);
            }

            const currentHash = hashDirectory(targetDir, new Set([AUTHORITY_MANAGED_FILE]));
            const needsUpdate = existingManaged.sdkVersion !== this.releaseMetadata.sdkVersion
                || existingManaged.assetHash !== this.releaseMetadata.assetHash
                || currentHash !== this.releaseMetadata.assetHash;

            if (needsUpdate) {
                this.deployBundledSdk(bundledDir, targetDir);
                return this.setStatus('updated', `Authority SDK refreshed at ${targetDir}.`, this.releaseMetadata.sdkVersion);
            }

            return this.setStatus('ready', `Authority SDK is already available at ${targetDir}.`, existingManaged.sdkVersion);
        } catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            this.logger.error(`[authority] Managed SDK deployment failed: ${message}`);
            return this.setStatus('error', message);
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
        fs.rmSync(targetDir, { recursive: true, force: true });
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
        this.logger.info(`[authority] Managed SDK deployed to ${targetDir}`);
    }

    private setStatus(
        installStatus: InstallStatusSnapshot['installStatus'],
        installMessage: string,
        sdkDeployedVersion: string | null = null,
    ): InstallStatusSnapshot {
        this.status = {
            ...this.status,
            installStatus,
            installMessage,
            sdkDeployedVersion,
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

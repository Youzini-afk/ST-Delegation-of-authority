import fs from 'node:fs';
import crypto from 'node:crypto';
import path from 'node:path';
import process from 'node:process';
import { AUTHORITY_MANAGED_CORE_DIR } from '../constants.js';
import type { AuthorityCoreManagedMetadata } from '../types.js';
import { resolveRuntimePath } from '../utils.js';

export interface CoreArtifact {
    binaryPath: string;
    metadata: AuthorityCoreManagedMetadata;
}

export function readArtifact(root: string, env: NodeJS.ProcessEnv): CoreArtifact | null {
    const platformId = getCurrentCorePlatform(env);
    const expectedLibc = getCorePlatformLibc(platformId);
    const platformDir = path.join(root, platformId);
    const metadataPath = path.join(platformDir, 'authority-core.json');
    if (!fs.existsSync(metadataPath)) {
        return null;
    }

    let metadata: AuthorityCoreManagedMetadata;
    try {
        metadata = JSON.parse(fs.readFileSync(metadataPath, 'utf8')) as AuthorityCoreManagedMetadata;
    } catch {
        return null;
    }

    if (metadata.managedBy !== 'authority' || metadata.platform !== process.platform || metadata.arch !== process.arch || (metadata.libc ?? null) !== expectedLibc) {
        return null;
    }

    const binaryPath = path.join(platformDir, metadata.binaryName);
    if (!fs.existsSync(binaryPath)) {
        return null;
    }
    if (process.platform !== 'win32') {
        ensureExecutable(binaryPath);
    }

    const binarySha256 = crypto.createHash('sha256').update(fs.readFileSync(binaryPath)).digest('hex');
    if (metadata.binarySha256 !== binarySha256) {
        return null;
    }

    return {
        binaryPath,
        metadata,
    };
}

export function ensureExecutable(filePath: string): void {
    try {
        const stat = fs.statSync(filePath);
        if ((stat.mode & 0o111) === 0) {
            fs.chmodSync(filePath, stat.mode | 0o755);
        }
    } catch {
    }
}

export function describeMissingManagedCore(roots: string[], env: NodeJS.ProcessEnv): string {
    const expectedPlatform = getCurrentCorePlatform(env);
    const discoveredPlatforms = Array.from(new Set(
        roots.flatMap(root => listManagedCorePlatforms(root)),
    )).sort();
    const platformHint = discoveredPlatforms.length > 0
        ? `Found managed platforms: ${discoveredPlatforms.join(', ')}.`
        : 'No managed core platform directories were found.';
    const libcHint = expectedPlatform.endsWith('-musl')
        ? ' Detected Linux musl runtime; glibc Linux binaries are not compatible.'
        : '';
    return `Authority core binary for ${expectedPlatform} was not found under ${AUTHORITY_MANAGED_CORE_DIR}. ${platformHint}${libcHint} Install the multi-platform package, or run npm run build:core in a full source checkout for this platform.`;
}

export function getCurrentCorePlatform(env: NodeJS.ProcessEnv): string {
    const basePlatform = `${process.platform}-${process.arch}`;
    return getCurrentLinuxLibc(env) === 'musl'
        ? `${basePlatform}-musl`
        : basePlatform;
}

export function getCurrentLinuxLibc(env: NodeJS.ProcessEnv): 'musl' | 'gnu' | null {
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

export function getCorePlatformLibc(platformId: string): string | null {
    return platformId.endsWith('-musl') ? 'musl' : null;
}

export function listManagedCorePlatforms(root: string): string[] {
    if (!fs.existsSync(root)) {
        return [];
    }

    try {
        return fs.readdirSync(root, { withFileTypes: true })
            .filter(entry => entry.isDirectory())
            .map(entry => entry.name);
    } catch {
        return [];
    }
}

export function resolveCoreDataRoot(value: string | undefined, cwd: string): string {
    const configuredRoot = typeof value === 'string' && value.trim()
        ? value
        : 'data';
    return resolveRuntimePath(configuredRoot, cwd);
}

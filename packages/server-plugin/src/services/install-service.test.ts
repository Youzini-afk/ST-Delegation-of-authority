import crypto from 'node:crypto';
import childProcess from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { AUTHORITY_VERSION } from '../version.js';
import {
    AUTHORITY_MANAGED_CORE_DIR,
    AUTHORITY_MANAGED_FILE,
    AUTHORITY_PLUGIN_ID,
    AUTHORITY_RELEASE_FILE,
    AUTHORITY_SDK_EXTENSION_ID,
} from '../constants.js';
import type { AuthorityManagedMetadata, AuthorityReleaseMetadata } from '../types.js';
import { InstallService } from './install-service.js';

const cleanupDirs: string[] = [];
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

describe('InstallService', () => {
    afterEach(() => {
        vi.restoreAllMocks();
        while (cleanupDirs.length > 0) {
            const dir = cleanupDirs.pop();
            if (dir) {
                fs.rmSync(dir, { recursive: true, force: true });
            }
        }
    });

    it('deploys the bundled SDK when the target directory is missing', async () => {
        const setup = createInstallFixture();
        const service = createService(setup);

        const status = await service.bootstrap();
        const targetDir = getTargetDir(setup.sillyTavernRoot);
        const managed = readJson<AuthorityManagedMetadata>(path.join(targetDir, AUTHORITY_MANAGED_FILE));

        expect(status.installStatus).toBe('installed');
        expect(status.sdkDeployedVersion).toBe(AUTHORITY_VERSION);
        expect(status.coreVerified).toBe(true);
        expect(fs.existsSync(path.join(targetDir, 'index.js'))).toBe(true);
        expect(managed.managedBy).toBe(AUTHORITY_PLUGIN_ID);
        expect(managed.sdkVersion).toBe(AUTHORITY_VERSION);
    });

    it('is idempotent when the bundled SDK is already deployed', async () => {
        const setup = createInstallFixture();
        const service = createService(setup);

        await service.bootstrap();
        const status = await service.bootstrap();

        expect(status.installStatus).toBe('ready');
        expect(status.sdkDeployedVersion).toBe(AUTHORITY_VERSION);
        expect(status.coreVerified).toBe(true);
    });

    it('updates the deployed SDK when the bundled version changes', async () => {
        const setup = createInstallFixture({ sdkVersion: AUTHORITY_VERSION, sdkScript: `window.STAuthority={version:"${AUTHORITY_VERSION}"};\n` });
        const initialService = createService(setup);
        await initialService.bootstrap();

        writeBundledSdk(setup.pluginRoot, '0.2.0', 'window.STAuthority={version:"0.2.0"};\n');
        const updatedService = createService(setup);
        const status = await updatedService.bootstrap();
        const deployedScript = fs.readFileSync(path.join(getTargetDir(setup.sillyTavernRoot), 'index.js'), 'utf8');

        expect(status.installStatus).toBe('updated');
        expect(status.sdkDeployedVersion).toBe('0.2.0');
        expect(status.coreVerified).toBe(true);
        expect(deployedScript).toContain('0.2.0');
    });

    it('does not overwrite an unmanaged target directory', async () => {
        const setup = createInstallFixture();
        const targetDir = getTargetDir(setup.sillyTavernRoot);
        fs.mkdirSync(targetDir, { recursive: true });
        fs.writeFileSync(path.join(targetDir, 'index.js'), 'window.LegacyAuthority=true;\n', 'utf8');

        const service = createService(setup);
        const status = await service.bootstrap();

        expect(status.installStatus).toBe('conflict');
        expect(status.coreVerified).toBe(true);
        expect(fs.readFileSync(path.join(targetDir, 'index.js'), 'utf8')).toContain('LegacyAuthority');
        expect(fs.existsSync(path.join(targetDir, AUTHORITY_MANAGED_FILE))).toBe(false);
    });

    it('repairs drift in an authority-managed target directory', async () => {
        const setup = createInstallFixture();
        const service = createService(setup);
        await service.bootstrap();

        const targetDir = getTargetDir(setup.sillyTavernRoot);
        fs.writeFileSync(path.join(targetDir, 'index.js'), 'window.STAuthority={version:"tampered"};\n', 'utf8');

        const status = await service.bootstrap();

        expect(status.installStatus).toBe('updated');
        expect(status.coreVerified).toBe(true);
        expect(fs.readFileSync(path.join(targetDir, 'index.js'), 'utf8')).toContain(AUTHORITY_VERSION);
    });

    it('restores the previous managed SDK when an update copy fails', async () => {
        const setup = createInstallFixture({ sdkVersion: AUTHORITY_VERSION, sdkScript: `window.STAuthority={version:"${AUTHORITY_VERSION}"};\n` });
        const service = createService(setup);
        await service.bootstrap();
        const targetDir = getTargetDir(setup.sillyTavernRoot);

        writeBundledSdk(setup.pluginRoot, '0.2.0', 'window.STAuthority={version:"0.2.0"};\n');
        vi.spyOn(fs, 'cpSync').mockImplementationOnce(() => {
            throw new Error('simulated copy failure');
        });
        const failedService = createService(setup);
        const status = await failedService.bootstrap();

        expect(status.installStatus).toBe('error');
        expect(status.coreVerified).toBe(false);
        expect(fs.readFileSync(path.join(targetDir, 'index.js'), 'utf8')).toContain(AUTHORITY_VERSION);
        expect(readJson<AuthorityManagedMetadata>(path.join(targetDir, AUTHORITY_MANAGED_FILE)).sdkVersion).toBe(AUTHORITY_VERSION);
    });

    it('deploys the SDK but reports a core warning when the bundled core artifact is absent', async () => {
        const setup = createInstallFixture();
        fs.rmSync(path.join(setup.pluginRoot, AUTHORITY_MANAGED_CORE_DIR), { recursive: true, force: true });
        const service = createService(setup, { AUTHORITY_CORE_AUTOBUILD: '0' });

        const status = await service.bootstrap();

        expect(status.installStatus).toBe('installed');
        expect(status.coreVerified).toBe(false);
        expect(status.installMessage).toContain('Core verification warning');
        expect(status.coreMessage).toContain('local core build is disabled');
        expect(fs.existsSync(path.join(getTargetDir(setup.sillyTavernRoot), 'index.js'))).toBe(true);
    });

    it('builds the current platform core locally when release metadata only lists another platform', async () => {
        const setup = createInstallFixture();
        rewriteReleaseAsOtherPlatformOnly(setup.pluginRoot);
        writeSourceBuildMarkers(setup.pluginRoot);
        vi.spyOn(childProcess, 'spawnSync').mockImplementation((command, args, options) => {
            if (command === 'cargo') {
                return { status: 0, stdout: 'cargo 1.0.0\n', stderr: '' } as childProcess.SpawnSyncReturns<string>;
            }
            if (command === process.execPath && Array.isArray(args) && args.includes('./scripts/build-core.mjs')) {
                writeBuiltCoreFromEnv(setup.pluginRoot, AUTHORITY_VERSION, options?.env);
                return { status: 0, stdout: 'built\n', stderr: '' } as childProcess.SpawnSyncReturns<string>;
            }
            throw new Error(`Unexpected spawnSync call: ${String(command)} ${String(args)}`);
        });
        const service = createService(setup);

        const status = await service.bootstrap();

        expect(status.installStatus).toBe('installed');
        expect(status.coreVerified).toBe(true);
        expect(status.coreArtifactPlatform).toBe(`${process.platform}-${process.arch}`);
        expect(status.coreArtifactPlatforms).toContain(`${process.platform}-${process.arch}`);
        expect(status.coreMessage).toContain('was built locally from source');
        expect(status.coreMessage).toContain('release metadata targets');
    });

    it('reports a precise warning when current platform core is missing and local source is unavailable', async () => {
        const setup = createInstallFixture();
        rewriteReleaseAsOtherPlatformOnly(setup.pluginRoot);
        const service = createService(setup);

        const status = await service.bootstrap();

        expect(status.installStatus).toBe('installed');
        expect(status.coreVerified).toBe(false);
        expect(status.coreMessage).toContain(`this runtime needs ${process.platform}-${process.arch}`);
        expect(status.coreMessage).toContain('local source build is unavailable');
    });

    it('verifies the current platform from multi-platform core metadata', async () => {
        const setup = createInstallFixture();
        addExtraCoreArtifact(setup.pluginRoot, 'android', 'arm64');
        const service = createService(setup);

        const status = await service.bootstrap();

        expect(status.installStatus).toBe('installed');
        expect(status.coreVerified).toBe(true);
        expect(status.coreArtifactPlatform).toBe(`${process.platform}-${process.arch}`);
        expect(status.coreArtifactPlatforms).toContain(`${process.platform}-${process.arch}`);
        expect(status.coreArtifactPlatforms).toContain('android-arm64');
    });

    it.runIf(process.platform === 'linux')('prefers the linux musl core artifact when the runtime is musl', async () => {
        const setup = createInstallFixture();
        addExtraCoreArtifact(setup.pluginRoot, 'linux', process.arch, 'musl');
        const service = createService(setup, {
            AUTHORITY_CORE_LIBC: 'musl',
            AUTHORITY_CORE_AUTOBUILD: '0',
        });

        const status = await service.bootstrap();

        expect(status.installStatus).toBe('installed');
        expect(status.coreVerified).toBe(true);
        expect(status.coreArtifactPlatform).toBe(`linux-${process.arch}-musl`);
        expect(status.coreArtifactPlatforms).toContain(`linux-${process.arch}-musl`);
    });

    it('accepts managed core text files with CRLF line endings when release metadata was hashed with LF', async () => {
        const setup = createInstallFixture();
        const platformDir = path.join(setup.pluginRoot, AUTHORITY_MANAGED_CORE_DIR, `${process.platform}-${process.arch}`);
        const metadataPath = path.join(platformDir, 'authority-core.json');
        const metadataText = fs.readFileSync(metadataPath, 'utf8');
        fs.writeFileSync(metadataPath, metadataText.replace(/\n/g, '\r\n'), 'utf8');

        const service = createService(setup);
        const status = await service.bootstrap();

        expect(status.installStatus).toBe('installed');
        expect(status.coreVerified).toBe(true);
    });

    it('keeps SDK deployment enabled when core platform artifact hash drifts but binary verification still passes', async () => {
        const setup = createInstallFixture();
        const platformDir = path.join(setup.pluginRoot, AUTHORITY_MANAGED_CORE_DIR, `${process.platform}-${process.arch}`);
        const metadataPath = path.join(platformDir, 'authority-core.json');
        const metadata = readJson<Record<string, unknown>>(metadataPath);
        fs.writeFileSync(metadataPath, JSON.stringify({
            ...metadata,
            builtAt: '2030-01-01T00:00:00.000Z',
        }, null, 2), 'utf8');

        const service = createService(setup);
        const status = await service.bootstrap();

        expect(status.installStatus).toBe('installed');
        expect(status.coreVerified).toBe(true);
        expect(status.coreMessage).toContain('platform artifact hash drift detected');
        expect(fs.existsSync(path.join(getTargetDir(setup.sillyTavernRoot), 'index.js'))).toBe(true);
    });

    it('keeps SDK deployment enabled when managed core root artifact hash drifts because of another platform directory', async () => {
        const setup = createInstallFixture();
        const originalRelease = readJson<AuthorityReleaseMetadata>(path.join(setup.pluginRoot, AUTHORITY_RELEASE_FILE));
        const originalRootArtifactHash = originalRelease.coreArtifactHash ?? '';
        addExtraCoreArtifact(setup.pluginRoot, 'android', 'arm64');

        const releasePath = path.join(setup.pluginRoot, AUTHORITY_RELEASE_FILE);
        const release = readJson<AuthorityReleaseMetadata>(releasePath);
        release.coreArtifactHash = originalRootArtifactHash;
        fs.writeFileSync(releasePath, JSON.stringify(release, null, 2), 'utf8');

        const service = createService(setup);
        const status = await service.bootstrap();

        expect(status.installStatus).toBe('installed');
        expect(status.coreVerified).toBe(true);
        expect(status.coreMessage).toContain('artifact directory hash drift detected');
    });
});

interface InstallFixture {
    pluginRoot: string;
    sillyTavernRoot: string;
}

function createInstallFixture(options: { sdkVersion?: string; sdkScript?: string } = {}): InstallFixture {
    const baseDir = fs.mkdtempSync(path.join(os.tmpdir(), 'authority-install-'));
    cleanupDirs.push(baseDir);

    const pluginRoot = path.join(baseDir, 'plugin-root');
    const sillyTavernRoot = path.join(baseDir, 'SillyTavern');
    fs.mkdirSync(path.join(pluginRoot, 'runtime'), { recursive: true });
    fs.mkdirSync(path.join(sillyTavernRoot, 'plugins'), { recursive: true });
    fs.mkdirSync(path.join(sillyTavernRoot, 'public', 'scripts', 'extensions'), { recursive: true });

    writeBundledSdk(
        pluginRoot,
        options.sdkVersion ?? AUTHORITY_VERSION,
        options.sdkScript ?? `window.STAuthority={version:"${AUTHORITY_VERSION}"};\n`,
    );

    return {
        pluginRoot,
        sillyTavernRoot,
    };
}

function createService(setup: InstallFixture, env: NodeJS.ProcessEnv = {}): InstallService {
    return new InstallService({
        runtimeDir: path.join(setup.pluginRoot, 'runtime'),
        cwd: setup.sillyTavernRoot,
        env,
        logger: {
            info() {},
            warn() {},
            error() {},
        },
    });
}

function writeBundledSdk(pluginRoot: string, sdkVersion: string, sdkScript: string): void {
    const bundledDir = path.join(pluginRoot, 'managed', 'sdk-extension');
    fs.rmSync(bundledDir, { recursive: true, force: true });
    fs.mkdirSync(bundledDir, { recursive: true });
    fs.writeFileSync(path.join(bundledDir, 'index.js'), sdkScript, 'utf8');
    fs.writeFileSync(path.join(bundledDir, 'style.css'), '.authority{}\n', 'utf8');
    fs.writeFileSync(path.join(bundledDir, 'menu-button.html'), '<button>Authority</button>\n', 'utf8');
    fs.writeFileSync(path.join(bundledDir, 'security-center.html'), '<div>Authority Security Center</div>\n', 'utf8');
    fs.writeFileSync(path.join(bundledDir, 'permission-dialog.html'), '<div>Permission</div>\n', 'utf8');
    fs.writeFileSync(path.join(bundledDir, 'manifest.json'), JSON.stringify({
        display_name: 'Authority Security Center',
        js: 'index.js',
        css: 'style.css',
        version: sdkVersion,
    }, null, 2), 'utf8');

    const core = writeBundledCore(pluginRoot, sdkVersion);
    const release: AuthorityReleaseMetadata = {
        pluginId: AUTHORITY_PLUGIN_ID,
        pluginVersion: sdkVersion,
        sdkExtensionId: AUTHORITY_SDK_EXTENSION_ID,
        sdkVersion,
        assetHash: hashDirectory(bundledDir),
        coreVersion: sdkVersion,
        coreArtifactHash: core.artifactHash,
        coreArtifactPlatform: core.artifactPlatform,
        coreArtifactPlatforms: [core.artifactPlatform],
        coreArtifacts: {
            [core.artifactPlatform]: {
                platform: process.platform,
                arch: process.arch,
                binaryName: core.binaryName,
                binarySha256: core.binarySha256,
                artifactHash: core.platformArtifactHash,
            },
        },
        coreBinarySha256: core.binarySha256,
        buildTime: new Date().toISOString(),
    };

    fs.writeFileSync(path.join(pluginRoot, AUTHORITY_RELEASE_FILE), JSON.stringify(release, null, 2), 'utf8');
}

function writeBundledCore(pluginRoot: string, version: string, clearRoot = true): { artifactHash: string; artifactPlatform: string; binaryName: string; binarySha256: string; platformArtifactHash: string } {
    const artifactPlatform = `${process.platform}-${process.arch}`;
    const binaryName = process.platform === 'win32' ? 'authority-core.exe' : 'authority-core';
    const coreRoot = path.join(pluginRoot, AUTHORITY_MANAGED_CORE_DIR);
    const platformDir = path.join(coreRoot, artifactPlatform);
    const binaryPath = path.join(platformDir, binaryName);
    if (clearRoot) {
        fs.rmSync(coreRoot, { recursive: true, force: true });
    }
    fs.mkdirSync(platformDir, { recursive: true });
    fs.writeFileSync(binaryPath, `authority-core ${version}\n`, 'utf8');
    const binarySha256 = hashFile(binaryPath);
    fs.writeFileSync(path.join(platformDir, 'authority-core.json'), JSON.stringify({
        managedBy: AUTHORITY_PLUGIN_ID,
        version,
        platform: process.platform,
        arch: process.arch,
        binaryName,
        binarySha256,
        builtAt: new Date().toISOString(),
    }, null, 2), 'utf8');
    return {
        artifactHash: hashDirectory(coreRoot),
        artifactPlatform,
        binaryName,
        binarySha256,
        platformArtifactHash: hashDirectory(platformDir),
    };
}

function writeBuiltCoreFromEnv(pluginRoot: string, version: string, env: NodeJS.ProcessEnv | undefined): void {
    const platform = env?.AUTHORITY_CORE_TARGET_PLATFORM ?? process.platform;
    const arch = env?.AUTHORITY_CORE_TARGET_ARCH ?? process.arch;
    const platformId = env?.AUTHORITY_CORE_PLATFORM_ID ?? `${platform}-${arch}`;
    const libc = env?.AUTHORITY_CORE_TARGET_LIBC ?? (platformId.endsWith('-musl') ? 'musl' : null);
    const binaryName = env?.AUTHORITY_CORE_BINARY_NAME ?? (platform === 'win32' ? 'authority-core.exe' : 'authority-core');
    const platformDir = path.join(pluginRoot, AUTHORITY_MANAGED_CORE_DIR, platformId);
    const binaryPath = path.join(platformDir, binaryName);
    fs.mkdirSync(platformDir, { recursive: true });
    fs.writeFileSync(binaryPath, `authority-core ${version} ${platformId}\n`, 'utf8');
    const binarySha256 = hashFile(binaryPath);
    fs.writeFileSync(path.join(platformDir, 'authority-core.json'), JSON.stringify({
        managedBy: AUTHORITY_PLUGIN_ID,
        version,
        platform,
        arch,
        ...(libc ? { libc } : {}),
        binaryName,
        binarySha256,
        builtAt: new Date().toISOString(),
    }, null, 2), 'utf8');
}

function rewriteReleaseAsOtherPlatformOnly(pluginRoot: string): void {
    const releasePath = path.join(pluginRoot, AUTHORITY_RELEASE_FILE);
    const release = readJson<AuthorityReleaseMetadata>(releasePath);
    const coreRoot = path.join(pluginRoot, AUTHORITY_MANAGED_CORE_DIR);
    const { platform, arch } = getOtherPlatform();
    const platformId = `${platform}-${arch}`;
    const platformDir = path.join(coreRoot, platformId);
    const binaryName = platform === 'win32' ? 'authority-core.exe' : 'authority-core';
    fs.rmSync(coreRoot, { recursive: true, force: true });
    fs.mkdirSync(platformDir, { recursive: true });
    const binaryPath = path.join(platformDir, binaryName);
    fs.writeFileSync(binaryPath, `authority-core ${release.coreVersion} ${platformId}\n`, 'utf8');
    const binarySha256 = hashFile(binaryPath);
    fs.writeFileSync(path.join(platformDir, 'authority-core.json'), JSON.stringify({
        managedBy: AUTHORITY_PLUGIN_ID,
        version: release.coreVersion,
        platform,
        arch,
        binaryName,
        binarySha256,
        builtAt: new Date().toISOString(),
    }, null, 2), 'utf8');

    release.coreArtifactPlatform = platformId;
    release.coreArtifactPlatforms = [platformId];
    release.coreArtifacts = {
        [platformId]: {
            platform,
            arch,
            binaryName,
            binarySha256,
            artifactHash: hashDirectory(platformDir),
        },
    };
    release.coreArtifactHash = hashDirectory(coreRoot);
    release.coreBinarySha256 = binarySha256;
    fs.writeFileSync(releasePath, JSON.stringify(release, null, 2), 'utf8');
}

function writeSourceBuildMarkers(pluginRoot: string): void {
    fs.mkdirSync(path.join(pluginRoot, 'scripts'), { recursive: true });
    fs.mkdirSync(path.join(pluginRoot, 'crates', 'authority-core'), { recursive: true });
    fs.writeFileSync(path.join(pluginRoot, 'scripts', 'build-core.mjs'), `
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

const root = process.cwd();
const platform = process.env.AUTHORITY_CORE_TARGET_PLATFORM || process.platform;
const arch = process.env.AUTHORITY_CORE_TARGET_ARCH || process.arch;
const binaryName = process.env.AUTHORITY_CORE_BINARY_NAME || (platform === 'win32' ? 'authority-core.exe' : 'authority-core');
const platformId = process.env.AUTHORITY_CORE_PLATFORM_ID || platform + '-' + arch;
const libc = platformId.endsWith('-musl') ? 'musl' : null;
const platformDir = path.join(root, 'managed', 'core', platformId);
const binaryPath = path.join(platformDir, binaryName);
fs.mkdirSync(platformDir, { recursive: true });
fs.writeFileSync(binaryPath, 'authority-core ${AUTHORITY_VERSION} ' + platformId + '\\n', 'utf8');
const binarySha256 = crypto.createHash('sha256').update(fs.readFileSync(binaryPath)).digest('hex');
fs.writeFileSync(path.join(platformDir, 'authority-core.json'), JSON.stringify({
  managedBy: 'authority',
  version: '${AUTHORITY_VERSION}',
  platform,
  arch,
  ...(libc ? { libc } : {}),
  binaryName,
  binarySha256,
  builtAt: new Date().toISOString()
}, null, 2), 'utf8');
console.log('built ' + binaryPath);
`, 'utf8');
    fs.writeFileSync(path.join(pluginRoot, 'crates', 'authority-core', 'Cargo.toml'), '[package]\nname = "authority-core"\n', 'utf8');
}

function getOtherPlatform(): { platform: NodeJS.Platform; arch: NodeJS.Architecture } {
    const current = `${process.platform}-${process.arch}`;
    if (current !== 'win32-x64') {
        return { platform: 'win32', arch: 'x64' };
    }
    return { platform: 'linux', arch: 'x64' };
}

function addExtraCoreArtifact(pluginRoot: string, platform: string, arch: string, libc?: string): void {
    const releasePath = path.join(pluginRoot, AUTHORITY_RELEASE_FILE);
    const release = readJson<AuthorityReleaseMetadata>(releasePath);
    const platformId = libc ? `${platform}-${arch}-${libc}` : `${platform}-${arch}`;
    const binaryName = platform === 'win32' ? 'authority-core.exe' : 'authority-core';
    const coreRoot = path.join(pluginRoot, AUTHORITY_MANAGED_CORE_DIR);
    const platformDir = path.join(coreRoot, platformId);
    const binaryPath = path.join(platformDir, binaryName);
    fs.mkdirSync(platformDir, { recursive: true });
    fs.writeFileSync(binaryPath, `authority-core ${release.coreVersion} ${platformId}\n`, 'utf8');
    const binarySha256 = hashFile(binaryPath);
    fs.writeFileSync(path.join(platformDir, 'authority-core.json'), JSON.stringify({
        managedBy: AUTHORITY_PLUGIN_ID,
        version: release.coreVersion,
        platform,
        arch,
        ...(libc ? { libc } : {}),
        binaryName,
        binarySha256,
        builtAt: new Date().toISOString(),
    }, null, 2), 'utf8');

    release.coreArtifactPlatforms = Array.from(new Set([
        ...(release.coreArtifactPlatforms ?? []),
        platformId,
    ])).sort();
    release.coreArtifacts = {
        ...(release.coreArtifacts ?? {}),
        [platformId]: {
            platform,
            arch,
            ...(libc ? { libc } : {}),
            binaryName,
            binarySha256,
            artifactHash: hashDirectory(platformDir),
        },
    };
    release.coreArtifactHash = hashDirectory(coreRoot);
    fs.writeFileSync(releasePath, JSON.stringify(release, null, 2), 'utf8');
}

function getTargetDir(sillyTavernRoot: string): string {
    return path.join(sillyTavernRoot, 'public', 'scripts', 'extensions', 'third-party', 'st-authority-sdk');
}

function readJson<T>(filePath: string): T {
    return JSON.parse(fs.readFileSync(filePath, 'utf8')) as T;
}

function hashDirectory(rootDir: string): string {
    const hash = crypto.createHash('sha256');
    for (const filePath of listFiles(rootDir)) {
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

function listFiles(rootDir: string): string[] {
    const files: string[] = [];
    const visit = (currentDir: string): void => {
        const entries = fs.readdirSync(currentDir, { withFileTypes: true })
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

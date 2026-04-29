import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { readAuthorityVersion } from './versioning.mjs';

const [, , mode] = process.argv;
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

if (mode !== 'sync' && mode !== 'check') {
    console.error('Usage: node scripts/installable.mjs <sync|check>');
    process.exit(1);
}

function readCoreArtifacts(managedCoreDir) {
    const entries = fs.readdirSync(managedCoreDir, { withFileTypes: true }).filter(entry => entry.isDirectory());
    if (entries.length === 0) {
        throw new Error('No managed authority-core artifact directory found.');
    }

    return Object.fromEntries(entries
        .map(entry => entry.name)
        .sort()
        .map(platformId => {
            const platformDir = path.join(managedCoreDir, platformId);
            const metadata = readJson(path.join(platformDir, 'authority-core.json'));
            const expectedPlatformId = metadata.libc
                ? `${metadata.platform}-${metadata.arch}-${metadata.libc}`
                : `${metadata.platform}-${metadata.arch}`;
            if (platformId !== expectedPlatformId) {
                throw new Error(`Managed authority-core metadata mismatch: ${platformId} contains ${expectedPlatformId}.`);
            }

            const binaryPath = path.join(platformDir, metadata.binaryName);
            assertExists(binaryPath, `Managed authority-core binary missing for ${platformId}.`);
            const binarySha256 = hashFile(binaryPath);
            if (metadata.binarySha256 !== binarySha256) {
                throw new Error(`Managed authority-core binary hash mismatch for ${platformId}.`);
            }

            return [platformId, {
                platform: metadata.platform,
                arch: metadata.arch,
                ...(metadata.libc ? { libc: metadata.libc } : {}),
                binaryName: metadata.binaryName,
                binarySha256,
                artifactHash: hashDirectory(platformDir),
            }];
        }));
}

function choosePrimaryCoreArtifactPlatform(coreArtifactPlatforms) {
    const currentPlatform = getCurrentCorePlatform();
    return coreArtifactPlatforms.includes(currentPlatform)
        ? currentPlatform
        : coreArtifactPlatforms[0];
}

function getCurrentCorePlatform() {
    const basePlatform = `${process.platform}-${process.arch}`;
    return getCurrentLinuxLibc() === 'musl'
        ? `${basePlatform}-musl`
        : basePlatform;
}

function getCurrentLinuxLibc() {
    if (process.platform !== 'linux') {
        return null;
    }

    const override = process.env.AUTHORITY_CORE_LIBC?.trim().toLowerCase();
    if (override === 'musl') {
        return 'musl';
    }
    if (override === 'gnu' || override === 'glibc') {
        return 'gnu';
    }

    const header = process.report?.getReport?.()?.header;
    return header?.glibcVersionRuntime || header?.glibcVersionCompiler ? 'gnu' : 'musl';
}

const repoRoot = fileURLToPath(new URL('..', import.meta.url));
const pluginVersion = readAuthorityVersion();
const stageDir = fs.mkdtempSync(path.join(os.tmpdir(), 'authority-installable-'));

try {
    const staged = stageInstallable();

    if (mode === 'sync') {
        syncInstallable(staged);
        console.log('Installable runtime synchronized.');
    } else {
        checkInstallable(staged);
        console.log('Installable runtime is up to date.');
    }
} finally {
    fs.rmSync(stageDir, { recursive: true, force: true });
}

function stageInstallable() {
    const serverDist = path.join(repoRoot, 'packages', 'server-plugin', 'dist', 'authority');
    const sdkDist = path.join(repoRoot, 'packages', 'sdk-extension', 'dist', 'extension');
    const coreDist = path.join(repoRoot, 'managed', 'core');

    assertExists(path.join(serverDist, 'index.cjs'), 'Run `npm run build` before staging installable outputs.');
    assertExists(path.join(sdkDist, 'manifest.json'), 'Run `npm run build` before staging installable outputs.');
    assertExists(coreDist, 'Run `npm run build:core` before staging installable outputs.');

    const runtimeDir = path.join(stageDir, 'runtime');
    const managedSdkDir = path.join(stageDir, 'managed', 'sdk-extension');
    const managedCoreDir = path.join(stageDir, 'managed', 'core');
    fs.mkdirSync(runtimeDir, { recursive: true });
    fs.mkdirSync(managedSdkDir, { recursive: true });
    fs.mkdirSync(managedCoreDir, { recursive: true });

    copyFile(path.join(serverDist, 'index.cjs'), path.join(runtimeDir, 'index.cjs'));
    copyOptionalFile(path.join(serverDist, 'index.cjs.map'), path.join(runtimeDir, 'index.cjs.map'));

    copySdkRuntime(sdkDist, managedSdkDir);
    patchSdkManifest(path.join(managedSdkDir, 'manifest.json'));
    fs.cpSync(coreDist, managedCoreDir, { recursive: true, force: true });

    validateRuntimeArtifacts(runtimeDir, managedSdkDir, managedCoreDir);

    const assetHash = hashDirectory(managedSdkDir);
    const coreArtifactHash = hashDirectory(managedCoreDir);
    const buildTime = resolveBuildTime(pluginVersion, assetHash, coreArtifactHash);
    const coreArtifacts = readCoreArtifacts(managedCoreDir);
    const coreArtifactPlatforms = Object.keys(coreArtifacts).sort();
    const coreArtifactPlatform = choosePrimaryCoreArtifactPlatform(coreArtifactPlatforms);

    const release = {
        pluginId: 'authority',
        pluginVersion,
        sdkExtensionId: 'third-party/st-authority-sdk',
        sdkVersion: pluginVersion,
        assetHash,
        coreVersion: pluginVersion,
        coreArtifactHash,
        coreArtifactPlatform,
        coreArtifactPlatforms,
        coreArtifacts,
        coreBinarySha256: coreArtifacts[coreArtifactPlatform].binarySha256,
        buildTime,
    };

    const releasePath = path.join(stageDir, '.authority-release.json');
    fs.writeFileSync(releasePath, JSON.stringify(release, null, 2), 'utf8');

    return {
        runtimeDir,
        managedSdkDir,
        managedCoreDir,
        releasePath,
    };
}

function syncInstallable(staged) {
    const runtimeTarget = path.join(repoRoot, 'runtime');
    const managedTarget = path.join(repoRoot, 'managed', 'sdk-extension');
    const managedCoreTarget = path.join(repoRoot, 'managed', 'core');
    const releaseTarget = path.join(repoRoot, '.authority-release.json');

    fs.rmSync(runtimeTarget, { recursive: true, force: true });
    fs.rmSync(managedTarget, { recursive: true, force: true });
    fs.rmSync(managedCoreTarget, { recursive: true, force: true });
    fs.mkdirSync(path.dirname(managedTarget), { recursive: true });

    fs.cpSync(staged.runtimeDir, runtimeTarget, { recursive: true, force: true });
    fs.cpSync(staged.managedSdkDir, managedTarget, { recursive: true, force: true });
    fs.cpSync(staged.managedCoreDir, managedCoreTarget, { recursive: true, force: true });
    copyFile(staged.releasePath, releaseTarget);
}

function checkInstallable(staged) {
    const expected = [
        { staged: staged.runtimeDir, actual: path.join(repoRoot, 'runtime') },
        { staged: staged.managedSdkDir, actual: path.join(repoRoot, 'managed', 'sdk-extension') },
        { staged: staged.managedCoreDir, actual: path.join(repoRoot, 'managed', 'core') },
    ];

    for (const pair of expected) {
        compareDirectories(pair.actual, pair.staged);
    }

    compareFiles(path.join(repoRoot, '.authority-release.json'), staged.releasePath);
}

function copySdkRuntime(sourceDir, targetDir) {
    const entries = fs.readdirSync(sourceDir, { withFileTypes: true });
    for (const entry of entries) {
        if (entry.name.endsWith('.d.ts')) {
            continue;
        }
        if (entry.name.endsWith('.test.js') || entry.name.endsWith('.test.js.map')) {
            continue;
        }

        const sourcePath = path.join(sourceDir, entry.name);
        const targetPath = path.join(targetDir, entry.name);
        if (entry.isDirectory()) {
            copySdkRuntime(sourcePath, targetPath);
            continue;
        }

        copyFile(sourcePath, targetPath);
    }
}

function patchSdkManifest(manifestPath) {
    const manifest = readJson(manifestPath);
    manifest.version = pluginVersion;
    fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2), 'utf8');
}

function validateRuntimeArtifacts(runtimeDir, managedSdkDir, managedCoreDir) {
    const invalidTokens = [
        '@stdo/',
        `${path.sep}node_modules${path.sep}`,
        repoRoot.replace(/\\/g, '/'),
        repoRoot.replace(/\//g, '\\'),
    ];

    const jsFiles = [
        ...listFiles(runtimeDir).filter(filePath => filePath.endsWith('.cjs') || filePath.endsWith('.js')),
        ...listFiles(managedSdkDir).filter(filePath => filePath.endsWith('.js')),
        ...listFiles(managedCoreDir).filter(filePath => filePath.endsWith('.json')),
    ];

    for (const filePath of jsFiles) {
        const content = fs.readFileSync(filePath, 'utf8');
        for (const token of invalidTokens) {
            if (content.includes(token)) {
                throw new Error(`Installable runtime contains a forbidden runtime reference (${token}) in ${path.relative(repoRoot, filePath)}`);
            }
        }
    }
}

function compareDirectories(actualDir, stagedDir) {
    assertExists(actualDir, `Tracked installable directory is missing: ${path.relative(repoRoot, actualDir)}`);

    const actualFiles = listFiles(actualDir).map(filePath => path.relative(actualDir, filePath).replace(/\\/g, '/')).sort();
    const stagedFiles = listFiles(stagedDir).map(filePath => path.relative(stagedDir, filePath).replace(/\\/g, '/')).sort();

    if (JSON.stringify(actualFiles) !== JSON.stringify(stagedFiles)) {
        throw new Error(`Installable file list mismatch for ${path.relative(repoRoot, actualDir)}`);
    }

    for (const relativePath of actualFiles) {
        compareFiles(path.join(actualDir, relativePath), path.join(stagedDir, relativePath));
    }
}

function compareFiles(actualPath, stagedPath) {
    assertExists(actualPath, `Tracked installable file is missing: ${path.relative(repoRoot, actualPath)}`);
    const actual = fs.readFileSync(actualPath);
    const staged = fs.readFileSync(stagedPath);
    if (!actual.equals(staged)) {
        throw new Error(`Installable file drift detected: ${path.relative(repoRoot, actualPath)}`);
    }
}

function resolveBuildTime(nextPluginVersion, nextAssetHash, nextCoreArtifactHash) {
    const releasePath = path.join(repoRoot, '.authority-release.json');
    if (fs.existsSync(releasePath)) {
        const currentRelease = readJson(releasePath);
        if (
            currentRelease.pluginVersion === nextPluginVersion
            && currentRelease.assetHash === nextAssetHash
            && currentRelease.coreArtifactHash === nextCoreArtifactHash
            && typeof currentRelease.buildTime === 'string'
        ) {
            return currentRelease.buildTime;
        }
    }

    return new Date().toISOString();
}

function hashDirectory(rootDir) {
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

function hashFile(filePath) {
    return crypto.createHash('sha256').update(fs.readFileSync(filePath)).digest('hex');
}

function readStableHashContent(filePath) {
    const content = fs.readFileSync(filePath);
    if (!TEXT_HASH_EXTENSIONS.has(path.extname(filePath).toLowerCase())) {
        return content;
    }

    return Buffer.from(content.toString('utf8').replace(/\r\n?/g, '\n'), 'utf8');
}

function listFiles(rootDir) {
    const files = [];

    if (!fs.existsSync(rootDir)) {
        return files;
    }

    const visit = currentDir => {
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

function copyFile(sourcePath, targetPath) {
    fs.mkdirSync(path.dirname(targetPath), { recursive: true });
    fs.copyFileSync(sourcePath, targetPath);
}

function copyOptionalFile(sourcePath, targetPath) {
    if (fs.existsSync(sourcePath)) {
        copyFile(sourcePath, targetPath);
    }
}

function assertExists(targetPath, message) {
    if (!fs.existsSync(targetPath)) {
        throw new Error(message);
    }
}

function readJson(filePath) {
    return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

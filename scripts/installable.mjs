import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const [, , mode] = process.argv;

if (mode !== 'sync' && mode !== 'check') {
    console.error('Usage: node scripts/installable.mjs <sync|check>');
    process.exit(1);
}

const repoRoot = fileURLToPath(new URL('..', import.meta.url));
const rootPackage = readJson(path.join(repoRoot, 'package.json'));
const pluginVersion = String(rootPackage.version ?? '0.0.0-dev');
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

    assertExists(path.join(serverDist, 'index.cjs'), 'Run `npm run build` before staging installable outputs.');
    assertExists(path.join(sdkDist, 'manifest.json'), 'Run `npm run build` before staging installable outputs.');

    const runtimeDir = path.join(stageDir, 'runtime');
    const managedSdkDir = path.join(stageDir, 'managed', 'sdk-extension');
    fs.mkdirSync(runtimeDir, { recursive: true });
    fs.mkdirSync(managedSdkDir, { recursive: true });

    copyFile(path.join(serverDist, 'index.cjs'), path.join(runtimeDir, 'index.cjs'));
    copyOptionalFile(path.join(serverDist, 'index.cjs.map'), path.join(runtimeDir, 'index.cjs.map'));

    copySdkRuntime(sdkDist, managedSdkDir);
    patchSdkManifest(path.join(managedSdkDir, 'manifest.json'));

    validateRuntimeArtifacts(runtimeDir, managedSdkDir);

    const assetHash = hashDirectory(managedSdkDir);
    const buildTime = resolveBuildTime(pluginVersion, assetHash);

    const release = {
        pluginId: 'authority',
        pluginVersion,
        sdkExtensionId: 'third-party/st-authority-sdk',
        sdkVersion: pluginVersion,
        assetHash,
        buildTime,
    };

    const releasePath = path.join(stageDir, '.authority-release.json');
    fs.writeFileSync(releasePath, JSON.stringify(release, null, 2), 'utf8');

    return {
        runtimeDir,
        managedSdkDir,
        releasePath,
    };
}

function syncInstallable(staged) {
    const runtimeTarget = path.join(repoRoot, 'runtime');
    const managedTarget = path.join(repoRoot, 'managed', 'sdk-extension');
    const releaseTarget = path.join(repoRoot, '.authority-release.json');

    fs.rmSync(runtimeTarget, { recursive: true, force: true });
    fs.rmSync(managedTarget, { recursive: true, force: true });
    fs.mkdirSync(path.dirname(managedTarget), { recursive: true });

    fs.cpSync(staged.runtimeDir, runtimeTarget, { recursive: true, force: true });
    fs.cpSync(staged.managedSdkDir, managedTarget, { recursive: true, force: true });
    copyFile(staged.releasePath, releaseTarget);
}

function checkInstallable(staged) {
    const expected = [
        { staged: staged.runtimeDir, actual: path.join(repoRoot, 'runtime') },
        { staged: staged.managedSdkDir, actual: path.join(repoRoot, 'managed', 'sdk-extension') },
    ];

    for (const pair of expected) {
        compareDirectories(pair.actual, pair.staged);
    }

    compareFiles(path.join(repoRoot, '.authority-release.json'), staged.releasePath);
}

function copySdkRuntime(sourceDir, targetDir) {
    const entries = fs.readdirSync(sourceDir, { withFileTypes: true });
    for (const entry of entries) {
        if (entry.isDirectory()) {
            continue;
        }

        if (entry.name.endsWith('.d.ts')) {
            continue;
        }

        copyFile(path.join(sourceDir, entry.name), path.join(targetDir, entry.name));
    }
}

function patchSdkManifest(manifestPath) {
    const manifest = readJson(manifestPath);
    manifest.version = pluginVersion;
    fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2), 'utf8');
}

function validateRuntimeArtifacts(runtimeDir, managedSdkDir) {
    const invalidTokens = [
        '@stdo/',
        `${path.sep}node_modules${path.sep}`,
        repoRoot.replace(/\\/g, '/'),
        repoRoot.replace(/\//g, '\\'),
    ];

    const jsFiles = [
        ...listFiles(runtimeDir).filter(filePath => filePath.endsWith('.cjs') || filePath.endsWith('.js')),
        ...listFiles(managedSdkDir).filter(filePath => filePath.endsWith('.js')),
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

function resolveBuildTime(nextPluginVersion, nextAssetHash) {
    const releasePath = path.join(repoRoot, '.authority-release.json');
    if (fs.existsSync(releasePath)) {
        const currentRelease = readJson(releasePath);
        if (currentRelease.pluginVersion === nextPluginVersion && currentRelease.assetHash === nextAssetHash && typeof currentRelease.buildTime === 'string') {
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
        hash.update(fs.readFileSync(filePath));
        hash.update('\0');
    }
    return hash.digest('hex');
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

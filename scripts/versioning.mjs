import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const repoRoot = fileURLToPath(new URL('..', import.meta.url));
const rootPackagePath = path.join(repoRoot, 'package.json');
const packageLockPath = path.join(repoRoot, 'package-lock.json');
const cargoTomlPath = path.join(repoRoot, 'crates', 'authority-core', 'Cargo.toml');
const cargoLockPath = path.join(repoRoot, 'Cargo.lock');
const readmePath = path.join(repoRoot, 'README.md');

function readJson(filePath) {
    return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

function writeJson(filePath, value) {
    fs.writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
}

function writeText(filePath, value) {
    fs.writeFileSync(filePath, value.endsWith('\n') ? value : `${value}\n`, 'utf8');
}

function updateJson(filePath, updater) {
    const value = readJson(filePath);
    updater(value);
    writeJson(filePath, value);
}

function updateText(filePath, updater) {
    const current = fs.readFileSync(filePath, 'utf8');
    const next = updater(current);
    if (next === current) {
        return;
    }
    writeText(filePath, next);
}

export function readAuthorityVersion() {
    const rootPackage = readJson(rootPackagePath);
    return String(rootPackage.version ?? '0.0.0-dev');
}

export function parseAuthorityVersion(version) {
    const match = /^(\d+)\.(\d+)\.(\d+)$/.exec(version.trim());
    if (!match) {
        throw new Error(`Unsupported version format: ${version}`);
    }
    return {
        major: Number(match[1]),
        minor: Number(match[2]),
        patch: Number(match[3]),
    };
}

export function formatNextAuthorityVersion(version) {
    const { major, minor, patch } = parseAuthorityVersion(version);
    if (patch >= 9) {
        return `${major}.${minor + 1}.0`;
    }
    return `${major}.${minor}.${patch + 1}`;
}

function syncWorkspacePackages(version) {
    updateJson(path.join(repoRoot, 'packages', 'shared-types', 'package.json'), value => {
        value.version = version;
    });

    for (const packageName of ['server-plugin', 'sdk-extension', 'example-extension']) {
        updateJson(path.join(repoRoot, 'packages', packageName, 'package.json'), value => {
            value.version = version;
            value.dependencies ??= {};
            value.dependencies['@stdo/shared-types'] = version;
        });
    }
}

function syncStaticMetadata(version) {
    updateJson(path.join(repoRoot, 'packages', 'server-plugin', 'static', 'package.json'), value => {
        value.version = version;
    });

    for (const manifestPath of [
        path.join(repoRoot, 'packages', 'sdk-extension', 'static', 'manifest.json'),
        path.join(repoRoot, 'packages', 'example-extension', 'static', 'manifest.json'),
    ]) {
        updateJson(manifestPath, value => {
            value.version = version;
        });
    }
}

function syncVersionModules(version) {
    const moduleContent = `export const AUTHORITY_VERSION = '${version}';\n`;
    writeText(path.join(repoRoot, 'packages', 'shared-types', 'src', 'version.ts'), moduleContent);
    writeText(path.join(repoRoot, 'packages', 'server-plugin', 'src', 'version.ts'), moduleContent);
    writeText(path.join(repoRoot, 'packages', 'sdk-extension', 'src', 'version.ts'), moduleContent);
    writeText(path.join(repoRoot, 'packages', 'example-extension', 'src', 'version.ts'), moduleContent);
}

function syncCargoVersion(version) {
    updateText(cargoTomlPath, current => current.replace(/^version = ".*"$/m, `version = "${version}"`));
    updateText(cargoLockPath, current => current.replace(/(\[\[package\]\]\r?\nname = "authority-core"\r?\nversion = ")([^"]+)(")/, `$1${version}$3`));
}

function syncPackageLock(version) {
    updateJson(packageLockPath, value => {
        value.version = version;
        value.packages ??= {};
        if (value.packages['']) {
            value.packages[''].version = version;
        }

        const workspacePackages = {
            'packages/shared-types': {
                version,
            },
            'packages/server-plugin': {
                version,
                dependencyVersion: version,
            },
            'packages/sdk-extension': {
                version,
                dependencyVersion: version,
            },
            'packages/example-extension': {
                version,
                dependencyVersion: version,
            },
        };

        for (const [key, config] of Object.entries(workspacePackages)) {
            const entry = value.packages[key];
            if (!entry) {
                continue;
            }
            entry.version = config.version;
            if (config.dependencyVersion) {
                entry.dependencies ??= {};
                entry.dependencies['@stdo/shared-types'] = config.dependencyVersion;
            }
        }
    });
}

function syncReadme(version) {
    updateText(readmePath, current => current.replace(/(- \*\*版本\*\*：`)([^`]+)(`)/, `$1${version}$3`));
}

export function syncAuthorityVersionFiles(version = readAuthorityVersion()) {
    syncWorkspacePackages(version);
    syncStaticMetadata(version);
    syncVersionModules(version);
    syncCargoVersion(version);
    syncPackageLock(version);
    syncReadme(version);
    return version;
}

export function bumpAuthorityVersion() {
    const rootPackage = readJson(rootPackagePath);
    const currentVersion = String(rootPackage.version ?? '0.0.0-dev');
    const nextVersion = formatNextAuthorityVersion(currentVersion);
    rootPackage.version = nextVersion;
    writeJson(rootPackagePath, rootPackage);
    syncAuthorityVersionFiles(nextVersion);
    return nextVersion;
}

function isDirectExecution() {
    return Boolean(process.argv[1]) && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
}

if (isDirectExecution()) {
    const command = process.argv[2] ?? '';
    switch (command) {
        case 'sync':
            console.log(syncAuthorityVersionFiles());
            break;
        case 'bump':
            console.log(bumpAuthorityVersion());
            break;
        default:
            console.error('Usage: node scripts/versioning.mjs <sync|bump>');
            process.exit(1);
    }
}

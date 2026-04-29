import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { readAuthorityVersion } from './versioning.mjs';

const repoRoot = fileURLToPath(new URL('..', import.meta.url));
const manifestPath = path.join(repoRoot, 'crates', 'authority-core', 'Cargo.toml');
const version = readAuthorityVersion();
const profile = process.env.AUTHORITY_CORE_PROFILE === 'debug' ? 'debug' : 'release';
const targetPlatform = process.env.AUTHORITY_CORE_TARGET_PLATFORM || process.platform;
const targetArch = process.env.AUTHORITY_CORE_TARGET_ARCH || process.arch;
const targetTriple = process.env.AUTHORITY_CORE_TARGET_TRIPLE || '';
const targetLibc = resolveTargetLibc();
const platformId = process.env.AUTHORITY_CORE_PLATFORM_ID || (targetLibc === 'musl' ? `${targetPlatform}-${targetArch}-musl` : `${targetPlatform}-${targetArch}`);
const binaryName = process.env.AUTHORITY_CORE_BINARY_NAME || (targetPlatform === 'win32' ? 'authority-core.exe' : 'authority-core');
const managedRoot = path.join(repoRoot, 'managed', 'core', platformId);
const metadataPath = path.join(managedRoot, 'authority-core.json');
const targetBinaryPath = path.join(managedRoot, binaryName);
const cargoArgs = ['build', '--manifest-path', manifestPath];

if (profile === 'release') {
    cargoArgs.push('--release');
}

if (targetTriple) {
    cargoArgs.push('--target', targetTriple);
}

const result = spawnSync('cargo', cargoArgs, {
    cwd: repoRoot,
    stdio: 'inherit',
});

if (result.status !== 0) {
    process.exit(result.status ?? 1);
}

const builtBinaryPath = targetTriple
    ? path.join(repoRoot, 'target', targetTriple, profile, binaryName)
    : path.join(repoRoot, 'target', profile, binaryName);

if (!fs.existsSync(builtBinaryPath)) {
    throw new Error(`Built core binary not found at ${builtBinaryPath}`);
}

const existingMetadata = fs.existsSync(metadataPath)
    ? JSON.parse(fs.readFileSync(metadataPath, 'utf8'))
    : null;
fs.rmSync(managedRoot, { recursive: true, force: true });
fs.mkdirSync(managedRoot, { recursive: true });
fs.copyFileSync(builtBinaryPath, targetBinaryPath);

const binarySha256 = crypto.createHash('sha256').update(fs.readFileSync(targetBinaryPath)).digest('hex');
const builtAt = existingMetadata
    && existingMetadata.version === version
    && existingMetadata.platform === targetPlatform
    && existingMetadata.arch === targetArch
    && (existingMetadata.libc ?? null) === targetLibc
    && existingMetadata.binaryName === binaryName
    && existingMetadata.binarySha256 === binarySha256
    && typeof existingMetadata.builtAt === 'string'
    ? existingMetadata.builtAt
    : new Date().toISOString();
const metadata = {
    managedBy: 'authority',
    version,
    platform: targetPlatform,
    arch: targetArch,
    ...(targetLibc ? { libc: targetLibc } : {}),
    binaryName,
    binarySha256,
    builtAt,
};

fs.writeFileSync(metadataPath, `${JSON.stringify(metadata, null, 2)}\n`, 'utf8');

function resolveTargetLibc() {
    if (targetPlatform !== 'linux') {
        return null;
    }

    const override = process.env.AUTHORITY_CORE_TARGET_LIBC?.trim().toLowerCase();
    if (override === 'musl') {
        return 'musl';
    }
    if (override === 'gnu' || override === 'glibc') {
        return null;
    }

    if (targetTriple.includes('musl')) {
        return 'musl';
    }
    if (targetTriple.includes('gnu')) {
        return null;
    }

    const header = process.report?.getReport?.()?.header;
    return header?.glibcVersionRuntime || header?.glibcVersionCompiler ? null : 'musl';
}
console.log(`Authority core prepared at ${targetBinaryPath}`);

import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const repoRoot = fileURLToPath(new URL('..', import.meta.url));
const manifestPath = path.join(repoRoot, 'crates', 'authority-core', 'Cargo.toml');
const rootPackage = JSON.parse(fs.readFileSync(path.join(repoRoot, 'package.json'), 'utf8'));
const version = String(rootPackage.version ?? '0.0.0-dev');
const profile = process.env.AUTHORITY_CORE_PROFILE === 'debug' ? 'debug' : 'release';
const binaryName = process.platform === 'win32' ? 'authority-core.exe' : 'authority-core';
const managedRoot = path.join(repoRoot, 'managed', 'core', `${process.platform}-${process.arch}`);
const metadataPath = path.join(managedRoot, 'authority-core.json');
const targetBinaryPath = path.join(managedRoot, binaryName);
const cargoArgs = ['build', '--manifest-path', manifestPath];

if (profile === 'release') {
    cargoArgs.push('--release');
}

const result = spawnSync('cargo', cargoArgs, {
    cwd: repoRoot,
    stdio: 'inherit',
});

if (result.status !== 0) {
    process.exit(result.status ?? 1);
}

const builtBinaryPath = path.join(repoRoot, 'target', profile, binaryName);

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
    && existingMetadata.platform === process.platform
    && existingMetadata.arch === process.arch
    && existingMetadata.binaryName === binaryName
    && existingMetadata.binarySha256 === binarySha256
    && typeof existingMetadata.builtAt === 'string'
    ? existingMetadata.builtAt
    : new Date().toISOString();
const metadata = {
    managedBy: 'authority',
    version,
    platform: process.platform,
    arch: process.arch,
    binaryName,
    binarySha256,
    builtAt,
};

fs.writeFileSync(metadataPath, JSON.stringify(metadata, null, 2), 'utf8');
console.log(`Authority core prepared at ${targetBinaryPath}`);

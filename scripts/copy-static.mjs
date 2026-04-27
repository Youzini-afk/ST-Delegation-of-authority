import fs from 'node:fs';
import path from 'node:path';
import { readAuthorityVersion } from './versioning.mjs';

const [, , packageDirArg, staticDirArg, outDirArg] = process.argv;

if (!packageDirArg || !staticDirArg || !outDirArg) {
    console.error('Usage: node scripts/copy-static.mjs <packageDir> <staticDir> <outDir>');
    process.exit(1);
}

const packageDir = path.resolve(packageDirArg);
const staticDir = path.join(packageDir, staticDirArg);
const outDir = path.join(packageDir, outDirArg);

if (!fs.existsSync(staticDir)) {
    process.exit(0);
}

fs.mkdirSync(outDir, { recursive: true });
fs.cpSync(staticDir, outDir, { recursive: true, force: true });

const version = readAuthorityVersion();
for (const metadataName of ['manifest.json', 'package.json']) {
    const metadataPath = path.join(outDir, metadataName);
    if (!fs.existsSync(metadataPath)) {
        continue;
    }

    const metadata = JSON.parse(fs.readFileSync(metadataPath, 'utf8'));
    metadata.version = version;
    fs.writeFileSync(metadataPath, `${JSON.stringify(metadata, null, 2)}\n`, 'utf8');
}

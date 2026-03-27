import fs from 'node:fs';
import path from 'node:path';

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


import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = fileURLToPath(new URL('..', import.meta.url));
const sourceDir = path.join(repoRoot, 'managed', 'core');
const targetDir = path.join(repoRoot, 'packages', 'server-plugin', 'dist', 'authority', 'managed', 'core');

if (!fs.existsSync(sourceDir)) {
    process.exit(0);
}

fs.rmSync(targetDir, { recursive: true, force: true });
fs.mkdirSync(path.dirname(targetDir), { recursive: true });
fs.cpSync(sourceDir, targetDir, { recursive: true, force: true });

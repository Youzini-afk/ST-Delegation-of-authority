import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = fileURLToPath(new URL('..', import.meta.url));
const workspaceRoot = path.resolve(repoRoot, '..');
const sillyTavernRoot = path.join(workspaceRoot, 'SillyTavern');

const targets = [
    path.join(sillyTavernRoot, 'plugins', 'authority'),
    path.join(sillyTavernRoot, 'public', 'scripts', 'extensions', 'third-party', 'st-authority-sdk'),
    path.join(sillyTavernRoot, 'public', 'scripts', 'extensions', 'third-party', 'st-authority-example'),
];

for (const target of targets) {
    if (fs.existsSync(target)) {
        fs.rmSync(target, { recursive: true, force: true });
        console.log(`Removed ${target}`);
    }
}

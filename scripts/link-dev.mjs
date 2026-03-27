import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = fileURLToPath(new URL('..', import.meta.url));
const workspaceRoot = path.resolve(repoRoot, '..');
const sillyTavernRoot = path.join(workspaceRoot, 'SillyTavern');

const links = [
    {
        source: path.join(repoRoot, 'packages', 'server-plugin', 'dist', 'authority'),
        target: path.join(sillyTavernRoot, 'plugins', 'authority'),
    },
    {
        source: path.join(repoRoot, 'packages', 'sdk-extension', 'dist', 'extension'),
        target: path.join(sillyTavernRoot, 'public', 'scripts', 'extensions', 'third-party', 'st-authority-sdk'),
    },
    {
        source: path.join(repoRoot, 'packages', 'example-extension', 'dist', 'extension'),
        target: path.join(sillyTavernRoot, 'public', 'scripts', 'extensions', 'third-party', 'st-authority-example'),
    },
];

for (const link of links) {
    if (!fs.existsSync(link.source)) {
        throw new Error(`Build output not found: ${link.source}`);
    }

    if (fs.existsSync(link.target)) {
        fs.rmSync(link.target, { recursive: true, force: true });
    }

    fs.symlinkSync(link.source, link.target, 'junction');
    console.log(`Linked ${link.target} -> ${link.source}`);
}

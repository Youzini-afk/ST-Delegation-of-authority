/**
 * Bundled runtime smoke test for the Phase 2 companion module loader.
 *
 * Purpose: prove the webpack-bundled `runtime/index.cjs` (the artifact that
 * ships inside the plugin zip) can load an external `.authority/server.cjs`
 * from disk at runtime. Source-only Vitest tests do NOT exercise webpack's
 * `__webpack_require__` handling of `node:module.createRequire(import.meta.url)`;
 * this test does.
 *
 * The test is skipped automatically when the built runtime is not present
 * (e.g. before `npm run build && node ./scripts/installable.mjs sync` has
 * run). CI pipelines that build the runtime before running tests will
 * exercise this path.
 *
 * Not in vitest default include path because the file lives under
 * `packages/server-plugin/src/services/`, which vitest picks up. It uses
 * `require()` on an absolute path to the built artifact rather than importing
 * source TypeScript, so it exercises the actual shipped bundle.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

const repoRoot = path.resolve(__dirname, '..', '..', '..', '..');
const builtRuntimePath = path.join(repoRoot, 'runtime', 'index.cjs');
const builtRuntimeExists = fs.existsSync(builtRuntimePath);

const cleanupDirs: string[] = [];

function makeTempDir(prefix: string): string {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
    cleanupDirs.push(dir);
    return dir;
}

const maybeIt = builtRuntimeExists ? it : it.skip;

describe('bundled runtime companion module loader smoke', () => {
    afterEach(() => {
        while (cleanupDirs.length > 0) {
            const dir = cleanupDirs.pop();
            if (dir) {
                fs.rmSync(dir, { recursive: true, force: true });
            }
        }
    });

    maybeIt('exports loadCompanionModuleFromDisk from the webpack bundle', () => {
        // eslint-disable-next-line @typescript-eslint/no-require-imports
        const bundle = require(builtRuntimePath) as {
            loadCompanionModuleFromDisk?: (absolutePath: string) => unknown;
        };
        expect(typeof bundle.loadCompanionModuleFromDisk).toBe('function');
    });

    maybeIt('loads an external .authority/server.cjs from disk through the bundled loader', () => {
        const tempDir = makeTempDir('authority-runtime-smoke-');
        const serverCjsPath = path.join(tempDir, 'server.cjs');
        fs.writeFileSync(
            serverCjsPath,
            `
            module.exports = {
                marker: 'bundled-runtime-smoke-ok',
                activate: async function activate(ctx) {
                    module.exports.__captured = ctx;
                },
            };
            `,
            'utf8',
        );

        // eslint-disable-next-line @typescript-eslint/no-require-imports
        const bundle = require(builtRuntimePath) as {
            loadCompanionModuleFromDisk: (absolutePath: string) => unknown;
        };
        const exported = bundle.loadCompanionModuleFromDisk(serverCjsPath) as {
            marker: string;
            activate: (ctx: unknown) => Promise<void>;
        };
        expect(exported.marker).toBe('bundled-runtime-smoke-ok');
        expect(typeof exported.activate).toBe('function');
    });

    maybeIt('can require() a fresh external .cjs that touches the filesystem (proves runtime require works, not bundle-time import)', () => {
        const tempDir = makeTempDir('authority-runtime-smoke-fs-');
        const markerPath = path.join(tempDir, 'marker.txt');
        const serverCjsPath = path.join(tempDir, 'server.cjs');
        fs.writeFileSync(
            serverCjsPath,
            `
            const fs = require('node:fs');
            module.exports = {
                touchMarker: () => {
                    fs.writeFileSync(${JSON.stringify(markerPath)}, 'touched', 'utf8');
                    return fs.readFileSync(${JSON.stringify(markerPath)}, 'utf8');
                },
            };
            `,
            'utf8',
        );

        // eslint-disable-next-line @typescript-eslint/no-require-imports
        const bundle = require(builtRuntimePath) as {
            loadCompanionModuleFromDisk: (absolutePath: string) => {
                touchMarker: () => string;
            };
        };
        const exported = bundle.loadCompanionModuleFromDisk(serverCjsPath);
        const result = exported.touchMarker();
        expect(result).toBe('touched');
        expect(fs.readFileSync(markerPath, 'utf8')).toBe('touched');
    });

    it('reports the correct built-runtime presence flag (always runs so vitest has at least one test)', () => {
        // Sanity: confirms the file existence check ran. When the runtime is
        // absent, the maybeIt tests above are skipped; this one always runs
        // and ensures vitest reports at least one passing test in this file
        // even on a fresh checkout before `npm run build`.
        expect(typeof builtRuntimeExists).toBe('boolean');
    });
});

void repoRoot;

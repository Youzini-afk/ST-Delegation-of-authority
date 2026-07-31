import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { HostBridgeService } from './host-bridge-service.js';

const cleanupDirs: string[] = [];

describe('HostBridgeService', () => {
    afterEach(() => {
        while (cleanupDirs.length > 0) {
            fs.rmSync(cleanupDirs.pop()!, { recursive: true, force: true });
        }
    });

    it('installs, verifies, and rolls back a managed bridge', async () => {
        const fixture = createFixture();
        const service = createService(fixture);

        const installed = await service.install();
        expect(installed.status).toBe('installed');
        expect(installed.requiresRestart).toBe(true);
        expect(fs.readFileSync(path.join(fixture.stRoot, 'host.js'), 'utf8')).toContain('authority-host-bridge:test');
        expect(fs.existsSync(path.join(fixture.stRoot, 'bridge.js'))).toBe(true);

        const ready = await service.inspect();
        expect(ready.status).toBe('ready');

        const rolledBack = await service.rollback();
        expect(rolledBack.status).toBe('rolled_back');
        expect(fs.readFileSync(path.join(fixture.stRoot, 'host.js'), 'utf8')).toBe('export const value = "ORIGINAL";\n');
        expect(fs.existsSync(path.join(fixture.stRoot, 'bridge.js'))).toBe(false);
    });

    it('refuses to repair a target changed after installation', async () => {
        const fixture = createFixture();
        const service = createService(fixture);
        await service.install();

        fs.writeFileSync(path.join(fixture.stRoot, 'host.js'), 'export const value = "USER_EDIT";\n', 'utf8');

        const inspected = await service.inspect();
        expect(inspected.status).toBe('conflict');
        expect(inspected.message).toContain('drift');

        const repaired = await service.repair();
        expect(repaired.status).toBe('conflict');
        expect(fs.readFileSync(path.join(fixture.stRoot, 'host.js'), 'utf8')).toContain('USER_EDIT');

        const inspectedAgain = await createService(fixture).inspect();
        expect(inspectedAgain.status).toBe('conflict');
        expect(fs.readFileSync(path.join(fixture.stRoot, 'host.js'), 'utf8')).toContain('USER_EDIT');
    });

    it('recovers an interrupted applying journal before a new install', async () => {
        const fixture = createFixture();
        const service = createService(fixture);
        await service.install();

        const recordsDir = path.join(fixture.stateDir, 'records');
        const recordFile = fs.readdirSync(recordsDir).map(name => path.join(recordsDir, name))[0]!;
        const record = JSON.parse(fs.readFileSync(recordFile, 'utf8'));
        record.phase = 'applying';
        fs.writeFileSync(recordFile, JSON.stringify(record, null, 2), 'utf8');

        const recovered = await createService(fixture).inspect();
        expect(recovered.status).toBe('rolled_back');
        expect(fs.readFileSync(path.join(fixture.stRoot, 'host.js'), 'utf8')).toContain('ORIGINAL');
        expect(fs.existsSync(path.join(fixture.stRoot, 'bridge.js'))).toBe(false);
    });

    it('performs a controlled automatic upgrade for a verified managed bridge', async () => {
        const fixture = createFixture();
        const service = createService(fixture);
        await service.install();

        const manifestPath = path.join(fixture.pluginRoot, 'managed', 'host-bridge', 'manifest.json');
        const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
        manifest.bridgeVersion = 'test-2';
        fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2), 'utf8');
        fs.writeFileSync(
            path.join(fixture.pluginRoot, 'managed', 'host-bridge', 'assets', 'bridge.js'),
            'export const bridge = "upgraded";\n',
            'utf8',
        );

        const upgraded = await createService(fixture).bootstrap();

        expect(upgraded.status).toBe('updated');
        expect(upgraded.bridgeVersion).toBe('test-2');
        expect(fs.readFileSync(path.join(fixture.stRoot, 'bridge.js'), 'utf8')).toContain('upgraded');
        expect((await createService(fixture).inspect()).status).toBe('ready');
    });
});

function createFixture() {
    const baseDir = fs.mkdtempSync(path.join(os.tmpdir(), 'authority-host-bridge-'));
    cleanupDirs.push(baseDir);
    const pluginRoot = path.join(baseDir, 'plugin');
    const bundleDir = path.join(pluginRoot, 'managed', 'host-bridge');
    const stRoot = path.join(baseDir, 'SillyTavern');
    const stateDir = path.join(baseDir, 'state');
    fs.mkdirSync(path.join(bundleDir, 'assets'), { recursive: true });
    fs.mkdirSync(path.join(stRoot, 'plugins'), { recursive: true });
    fs.mkdirSync(path.join(stRoot, 'public', 'scripts', 'extensions'), { recursive: true });
    fs.writeFileSync(path.join(stRoot, 'package.json'), JSON.stringify({ name: 'sillytavern', version: '1.18.0', type: 'module' }), 'utf8');
    fs.writeFileSync(path.join(stRoot, 'host.js'), 'export const value = "ORIGINAL";\n', 'utf8');
    fs.writeFileSync(path.join(bundleDir, 'assets', 'bridge.js'), 'export const bridge = true;\n', 'utf8');
    fs.writeFileSync(path.join(bundleDir, 'patch.cjs'), [
        "'use strict';",
        "const marker = 'authority-host-bridge:test';",
        'module.exports = {',
        '  bridgeMarker: marker,',
        "  targetFiles: ['host.js'],",
        '  apply(_path, source) {',
        "    if (source.includes(marker)) return source;",
        "    if (!source.includes('ORIGINAL')) throw new Error('anchor missing');",
        "    return `// ${marker}\\n${source.replace('ORIGINAL', 'PATCHED')}`;",
        '  },',
        '};',
        '',
    ].join('\n'), 'utf8');
    fs.writeFileSync(path.join(bundleDir, 'manifest.json'), JSON.stringify({
        schemaVersion: 1,
        bridgeVersion: 'test-1',
        host: 'sillytavern',
        supportedPackageVersions: ['1.18.0'],
        patchModule: 'patch.cjs',
        assets: [{ source: 'assets/bridge.js', target: 'bridge.js' }],
        syntaxCheckTargets: ['host.js', 'bridge.js'],
    }, null, 2), 'utf8');
    return { pluginRoot, stRoot, stateDir };
}

function createService(fixture: ReturnType<typeof createFixture>) {
    return new HostBridgeService({
        pluginRoot: fixture.pluginRoot,
        stateDir: fixture.stateDir,
        resolveSillyTavernRoot: () => fixture.stRoot,
        logger: { info() {}, warn() {}, error() {} },
    });
}

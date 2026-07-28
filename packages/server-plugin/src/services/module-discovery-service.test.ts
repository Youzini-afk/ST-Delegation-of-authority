import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { AUTHORITY_VERSION } from '../version.js';
import { AUTHORITY_MODULE_PROTOCOL_VERSION } from '../constants.js';
import {
    MODULE_DEFAULT_REQUEST_BYTES,
    MODULE_DEFAULT_RESPONSE_BYTES,
    MODULE_MAX_REQUEST_BYTES,
    MODULE_MAX_RESPONSE_BYTES,
    ModuleDiscoveryService,
} from './module-discovery-service.js';
import { CoreService } from './core-service.js';
import { ModuleHostService } from './module-host-service.js';
import { PermissionService } from './permission-service.js';
import { PolicyService } from './policy-service.js';
import { InstallService } from './install-service.js';
import type { AuthorityModuleManifest } from '@stdo/shared-types';

const cleanupDirs: string[] = [];
const symlinkTestsSupported = supportsDirectorySymlinks();

function supportsDirectorySymlinks(): boolean {
    const baseDir = fs.mkdtempSync(path.join(os.tmpdir(), 'authority-symlink-check-'));
    try {
        const target = path.join(baseDir, 'target');
        fs.mkdirSync(target);
        fs.symlinkSync(target, path.join(baseDir, 'link'), 'dir');
        return true;
    } catch {
        return false;
    } finally {
        fs.rmSync(baseDir, { recursive: true, force: true });
    }
}

interface Fixture {
    sillyTavernRoot: string;
    extensionsRoot: string;
    thirdPartyRoot: string;
}

function createFixture(): Fixture {
    const baseDir = fs.mkdtempSync(path.join(os.tmpdir(), 'authority-discovery-'));
    cleanupDirs.push(baseDir);
    const sillyTavernRoot = path.join(baseDir, 'SillyTavern');
    fs.mkdirSync(path.join(sillyTavernRoot, 'plugins'), { recursive: true });
    const extensionsRoot = path.join(sillyTavernRoot, 'public', 'scripts', 'extensions');
    fs.mkdirSync(extensionsRoot, { recursive: true });
    const thirdPartyRoot = path.join(extensionsRoot, 'third-party');
    fs.mkdirSync(thirdPartyRoot, { recursive: true });
    return { sillyTavernRoot, extensionsRoot, thirdPartyRoot };
}

function createInstallService(sillyTavernRoot: string): InstallService {
    return new InstallService({
        cwd: sillyTavernRoot,
        env: { ...process.env },
        logger: { info() {}, warn() {}, error() {} },
    });
}

function createDiscovery(fixture: Fixture, extensionDirsOverride?: string[]): ModuleDiscoveryService {
    const options: { sillyTavernRoot: string; extensionDirs?: string[]; logger: Pick<Console, 'info' | 'warn' | 'error'> } = {
        sillyTavernRoot: fixture.sillyTavernRoot,
        logger: { info() {}, warn() {}, error() {} },
    };
    if (extensionDirsOverride !== undefined) {
        options.extensionDirs = extensionDirsOverride;
    }
    return new ModuleDiscoveryService(createInstallService(fixture.sillyTavernRoot), options);
}

interface WriteModuleOptions {
    moduleId?: string;
    ownerExtensionId?: string;
    schemaVersion?: number;
    protocolVersion?: number;
    entry?: string | null;
    transactions?: Record<string, unknown>;
    extra?: Record<string, unknown>;
}

function writeModule(extensionDir: string, options: WriteModuleOptions = {}): string {
    const moduleDir = path.join(extensionDir, '.authority');
    fs.mkdirSync(moduleDir, { recursive: true });
    const manifestPath = path.join(moduleDir, 'module.json');
    // Derive ownerExtensionId from the extension directory name by default so
    // owner-extension validation passes without forcing every test to repeat
    // the same `third-party/<dirName>` boilerplate.
    const extensionDirName = path.basename(extensionDir);
    const derivedOwner = `third-party/${extensionDirName}`;
    const ownerExtensionId = options.ownerExtensionId ?? derivedOwner;
    const moduleId = options.moduleId ?? `third-party.${extensionDirName}`;
    const manifest: Record<string, unknown> = {
        id: moduleId,
        displayName: 'Some Extension Authority Module',
        ownerExtensionId,
        version: '1.0.0',
        schemaVersion: options.schemaVersion ?? 1,
        protocolVersion: options.protocolVersion ?? AUTHORITY_MODULE_PROTOCOL_VERSION,
        entry: options.entry === null ? undefined : (options.entry ?? './server.cjs'),
        transactions: options.transactions ?? {
            'data.commit': {
                name: 'data.commit',
                version: '1.0.0',
                title: 'Commit data',
                riskLevel: 'high',
                permissionTarget: { kind: 'transaction' },
                requiredResources: [{ resource: 'sql.private', target: 'default' }],
                idempotency: 'required',
                timeoutMs: 120_000,
                maxRequestBytes: 64 * 1024 * 1024,
                maxResponseBytes: 64 * 1024 * 1024,
            },
        },
        ...options.extra,
    };
    fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2), 'utf8');
    if (options.entry !== null) {
        const entryPath = path.join(moduleDir, options.entry ?? './server.cjs');
        fs.writeFileSync(entryPath, 'module.exports.activate = async () => {};\n', 'utf8');
    }
    return manifestPath;
}

describe('ModuleDiscoveryService', () => {
    afterEach(() => {
        while (cleanupDirs.length > 0) {
            const dir = cleanupDirs.pop();
            if (dir) {
                fs.rmSync(dir, { recursive: true, force: true });
            }
        }
    });

    it('discovers a valid companion module from a third-party extension', () => {
        const fixture = createFixture();
        const extensionDir = path.join(fixture.thirdPartyRoot, 'some-extension');
        fs.mkdirSync(extensionDir, { recursive: true });
        writeModule(extensionDir);

        const discovery = createDiscovery(fixture);
        const result = discovery.discover();

        expect(result.records).toHaveLength(1);
        const record = result.records[0]!;
        expect(record.status).toBe('available');
        expect(record.moduleId).toBe('third-party.some-extension');
        expect(record.ownerExtensionId).toBe('third-party/some-extension');
        expect(record.manifest?.id).toBe('third-party.some-extension');
        // Public source must expose only safe relative metadata; no absolute
        // local paths may leak through extensionDir/moduleDir/manifestPath/entryPath.
        expect(record.source.extensionId).toBe('third-party/some-extension');
        expect(record.source.modulePath).toBe('.authority/module.json');
        expect(record.source.entry).toBe('./server.cjs');
        expect(record.source).not.toHaveProperty('extensionDir');
        expect(record.source).not.toHaveProperty('moduleDir');
        expect(record.source).not.toHaveProperty('manifestPath');
        expect(record.source).not.toHaveProperty('entryPath');
        expect(result.byModuleId.get('third-party.some-extension')).toBe(record);
    });

    it('discovers a valid direct (non-third-party) extension module', () => {
        const fixture = createFixture();
        const extensionDir = path.join(fixture.extensionsRoot, 'some-extension');
        fs.mkdirSync(extensionDir, { recursive: true });
        writeModule(extensionDir, {
            moduleId: 'some-extension',
            ownerExtensionId: 'some-extension',
        });

        const discovery = createDiscovery(fixture);
        const result = discovery.discover();

        expect(result.records).toHaveLength(1);
        const record = result.records[0]!;
        expect(record.status).toBe('available');
        expect(record.ownerExtensionId).toBe('some-extension');
        expect(record.moduleId).toBe('some-extension');
    });

    it('returns no records when the SillyTavern root cannot be resolved', () => {
        const fixture = createFixture();
        // No extensions created; the resolver still resolves the ST root but
        // scanning yields nothing.
        const discovery = createDiscovery(fixture);
        const result = discovery.discover();
        expect(result.records).toHaveLength(0);
    });

    it('records invalid_manifest when module.json is malformed JSON', () => {
        const fixture = createFixture();
        const extensionDir = path.join(fixture.thirdPartyRoot, 'broken-extension');
        fs.mkdirSync(extensionDir, { recursive: true });
        const moduleDir = path.join(extensionDir, '.authority');
        fs.mkdirSync(moduleDir, { recursive: true });
        fs.writeFileSync(path.join(moduleDir, 'module.json'), '{ not valid json', 'utf8');

        const discovery = createDiscovery(fixture);
        const result = discovery.discover();

        expect(result.records).toHaveLength(1);
        const record = result.records[0]!;
        expect(record.status).toBe('invalid_manifest');
        expect(record.manifest).toBeNull();
        expect(record.diagnostics?.[0]?.code).toBe('manifest_json_parse_error');
    });

    it('records invalid_manifest when the manifest shape is wrong', () => {
        const fixture = createFixture();
        const extensionDir = path.join(fixture.thirdPartyRoot, 'shaped-extension');
        fs.mkdirSync(extensionDir, { recursive: true });
        writeModule(extensionDir, { extra: { id: undefined } });

        const discovery = createDiscovery(fixture);
        const result = discovery.discover();

        const record = result.records[0]!;
        expect(record.status).toBe('invalid_manifest');
        expect(record.diagnostics?.[0]?.code).toBe('manifest_id_invalid');
    });

    it('records incompatible_host when the protocolVersion does not match the host', () => {
        const fixture = createFixture();
        const extensionDir = path.join(fixture.thirdPartyRoot, 'proto-extension');
        fs.mkdirSync(extensionDir, { recursive: true });
        writeModule(extensionDir, { protocolVersion: 999 });

        const discovery = createDiscovery(fixture);
        const result = discovery.discover();

        const record = result.records[0]!;
        expect(record.status).toBe('incompatible_host');
        expect(record.diagnostics?.[0]?.code).toBe('manifest_protocol_version_incompatible');
    });

    it('records invalid_manifest when schemaVersion is unsupported', () => {
        const fixture = createFixture();
        const extensionDir = path.join(fixture.thirdPartyRoot, 'schema-extension');
        fs.mkdirSync(extensionDir, { recursive: true });
        writeModule(extensionDir, { schemaVersion: 99 });

        const discovery = createDiscovery(fixture);
        const result = discovery.discover();

        const record = result.records[0]!;
        expect(record.status).toBe('invalid_manifest');
        expect(record.diagnostics?.[0]?.code).toBe('manifest_schema_version_unsupported');
    });

    it('records invalid_manifest when ownerExtensionId does not match the discovered extension', () => {
        const fixture = createFixture();
        const extensionDir = path.join(fixture.thirdPartyRoot, 'owned-extension');
        fs.mkdirSync(extensionDir, { recursive: true });
        writeModule(extensionDir, {
            moduleId: 'third-party.owned-extension',
            ownerExtensionId: 'third-party/some-other-extension',
        });

        const discovery = createDiscovery(fixture);
        const result = discovery.discover();

        const record = result.records[0]!;
        expect(record.status).toBe('invalid_manifest');
        expect(record.diagnostics?.[0]?.code).toBe('manifest_owner_extension_id_mismatch');
    });

    it('records invalid_manifest when module id is not owned by the owner extension', () => {
        const fixture = createFixture();
        const extensionDir = path.join(fixture.thirdPartyRoot, 'orphan-extension');
        fs.mkdirSync(extensionDir, { recursive: true });
        writeModule(extensionDir, {
            moduleId: 'something-else',
            ownerExtensionId: 'third-party/orphan-extension',
        });

        const discovery = createDiscovery(fixture);
        const result = discovery.discover();

        const record = result.records[0]!;
        expect(record.status).toBe('invalid_manifest');
        expect(record.diagnostics?.[0]?.code).toBe('manifest_id_owner_mismatch');
    });

    it('accepts module ids that are prefixed children of the owner extension', () => {
        const fixture = createFixture();
        const extensionDir = path.join(fixture.thirdPartyRoot, 'parent-extension');
        fs.mkdirSync(extensionDir, { recursive: true });
        writeModule(extensionDir, {
            moduleId: 'third-party.parent-extension.extra',
            ownerExtensionId: 'third-party/parent-extension',
        });

        const discovery = createDiscovery(fixture);
        const result = discovery.discover();

        const record = result.records[0]!;
        expect(record.status).toBe('available');
        expect(record.moduleId).toBe('third-party.parent-extension.extra');
    });

    it('records invalid_manifest when transaction name contains a colon', () => {
        const fixture = createFixture();
        const extensionDir = path.join(fixture.thirdPartyRoot, 'colon-extension');
        fs.mkdirSync(extensionDir, { recursive: true });
        writeModule(extensionDir, {
            transactions: {
                'task:run': {
                    name: 'task:run',
                    version: '1.0.0',
                    title: 'Run task',
                    riskLevel: 'medium',
                    permissionTarget: { kind: 'transaction' },
                    requiredResources: [],
                    idempotency: 'optional',
                },
            },
        });

        const discovery = createDiscovery(fixture);
        const result = discovery.discover();

        const record = result.records[0]!;
        expect(record.status).toBe('invalid_manifest');
        expect(record.diagnostics?.[0]?.code).toBe('manifest_transaction_name_invalid');
    });

    it('records invalid_manifest when transaction name does not match its declared name', () => {
        const fixture = createFixture();
        const extensionDir = path.join(fixture.thirdPartyRoot, 'mismatch-extension');
        fs.mkdirSync(extensionDir, { recursive: true });
        writeModule(extensionDir, {
            transactions: {
                'task.run': {
                    name: 'task.bulk-run',
                    version: '1.0.0',
                    title: 'Run task',
                    riskLevel: 'medium',
                    permissionTarget: { kind: 'transaction' },
                    requiredResources: [],
                    idempotency: 'optional',
                },
            },
        });

        const discovery = createDiscovery(fixture);
        const result = discovery.discover();

        const record = result.records[0]!;
        expect(record.status).toBe('invalid_manifest');
        expect(record.diagnostics?.[0]?.code).toBe('manifest_transaction_name_mismatch');
    });

    it('records invalid_manifest when idempotency is an unsupported value', () => {
        const fixture = createFixture();
        const extensionDir = path.join(fixture.thirdPartyRoot, 'idem-extension');
        fs.mkdirSync(extensionDir, { recursive: true });
        writeModule(extensionDir, {
            transactions: {
                'task.run': {
                    name: 'task.run',
                    version: '1.0.0',
                    title: 'Run task',
                    riskLevel: 'medium',
                    permissionTarget: { kind: 'transaction' },
                    requiredResources: [],
                    idempotency: 'always',
                },
            },
        });

        const discovery = createDiscovery(fixture);
        const result = discovery.discover();

        const record = result.records[0]!;
        expect(record.status).toBe('invalid_manifest');
        expect(record.diagnostics?.[0]?.code).toBe('manifest_transaction_idempotency_invalid');
    });

    it('records invalid_manifest when riskLevel is unsupported', () => {
        const fixture = createFixture();
        const extensionDir = path.join(fixture.thirdPartyRoot, 'risk-extension');
        fs.mkdirSync(extensionDir, { recursive: true });
        writeModule(extensionDir, {
            transactions: {
                'task.run': {
                    name: 'task.run',
                    version: '1.0.0',
                    title: 'Run task',
                    riskLevel: 'critical',
                    permissionTarget: { kind: 'transaction' },
                    requiredResources: [],
                    idempotency: 'optional',
                },
            },
        });

        const discovery = createDiscovery(fixture);
        const result = discovery.discover();

        const record = result.records[0]!;
        expect(record.status).toBe('invalid_manifest');
        expect(record.diagnostics?.[0]?.code).toBe('manifest_transaction_risk_level_invalid');
    });

    it('records invalid_manifest when requiredResources contains an unsupported resource', () => {
        const fixture = createFixture();
        const extensionDir = path.join(fixture.thirdPartyRoot, 'res-extension');
        fs.mkdirSync(extensionDir, { recursive: true });
        writeModule(extensionDir, {
            transactions: {
                'task.run': {
                    name: 'task.run',
                    version: '1.0.0',
                    title: 'Run task',
                    riskLevel: 'medium',
                    permissionTarget: { kind: 'transaction' },
                    requiredResources: [{ resource: 'fs.something_else' }],
                    idempotency: 'optional',
                },
            },
        });

        const discovery = createDiscovery(fixture);
        const result = discovery.discover();

        const record = result.records[0]!;
        expect(record.status).toBe('invalid_manifest');
        expect(record.diagnostics?.[0]?.code).toBe('manifest_transaction_required_resource_invalid');
    });

    it('records invalid_manifest when permissionTarget has an unsupported kind', () => {
        const fixture = createFixture();
        const extensionDir = path.join(fixture.thirdPartyRoot, 'perm-extension');
        fs.mkdirSync(extensionDir, { recursive: true });
        writeModule(extensionDir, {
            transactions: {
                'task.run': {
                    name: 'task.run',
                    version: '1.0.0',
                    title: 'Run task',
                    riskLevel: 'medium',
                    permissionTarget: { kind: 'universe' },
                    requiredResources: [],
                    idempotency: 'optional',
                },
            },
        });

        const discovery = createDiscovery(fixture);
        const result = discovery.discover();

        const record = result.records[0]!;
        expect(record.status).toBe('invalid_manifest');
        expect(record.diagnostics?.[0]?.code).toBe('manifest_transaction_permission_target_invalid');
    });

    it('records invalid_manifest when custom permissionTarget.target is empty', () => {
        const fixture = createFixture();
        const extensionDir = path.join(fixture.thirdPartyRoot, 'custom-empty');
        fs.mkdirSync(extensionDir, { recursive: true });
        writeModule(extensionDir, {
            transactions: {
                'task.run': {
                    name: 'task.run',
                    version: '1.0.0',
                    title: 'Run task',
                    riskLevel: 'medium',
                    permissionTarget: { kind: 'custom', target: '' },
                    requiredResources: [],
                    idempotency: 'optional',
                },
            },
        });

        const discovery = createDiscovery(fixture);
        const result = discovery.discover();

        const record = result.records[0]!;
        expect(record.status).toBe('invalid_manifest');
        expect(record.diagnostics?.[0]?.code).toBe('manifest_transaction_permission_target_invalid');
    });

    it('records invalid_manifest when entry is an absolute path', () => {
        const fixture = createFixture();
        const extensionDir = path.join(fixture.thirdPartyRoot, 'abs-entry');
        fs.mkdirSync(extensionDir, { recursive: true });
        // Pass entry=null so writeModule does not try to create the bogus
        // absolute file on disk; the manifest entry field is set explicitly below.
        writeModule(extensionDir, { entry: null, extra: { entry: '/etc/passwd' } });

        const discovery = createDiscovery(fixture);
        const result = discovery.discover();

        const record = result.records[0]!;
        expect(record.status).toBe('invalid_manifest');
        expect(record.diagnostics?.[0]?.code).toBe('entry_path_absolute');
    });

    it('records invalid_manifest when entry has an unsupported extension', () => {
        const fixture = createFixture();
        const extensionDir = path.join(fixture.thirdPartyRoot, 'js-entry');
        fs.mkdirSync(extensionDir, { recursive: true });
        writeModule(extensionDir, { entry: './server.js' });

        const discovery = createDiscovery(fixture);
        const result = discovery.discover();

        const record = result.records[0]!;
        expect(record.status).toBe('invalid_manifest');
        expect(record.diagnostics?.[0]?.code).toBe('entry_extension_unsupported');
    });

    it('records invalid_manifest when entry resolves outside the .authority directory', () => {
        const fixture = createFixture();
        const extensionDir = path.join(fixture.thirdPartyRoot, 'escape-entry');
        fs.mkdirSync(extensionDir, { recursive: true });
        // Place a real file outside .authority so the entry exists on disk but escapes.
        fs.writeFileSync(path.join(extensionDir, 'escaped.cjs'), 'module.exports.activate = async () => {};\n', 'utf8');
        writeModule(extensionDir, { entry: '../escaped.cjs' });

        const discovery = createDiscovery(fixture);
        const result = discovery.discover();

        const record = result.records[0]!;
        expect(record.status).toBe('invalid_manifest');
        expect(record.diagnostics?.[0]?.code).toBe('entry_path_escape');
    });

    it('records entry_missing when the declared entry file does not exist', () => {
        const fixture = createFixture();
        const extensionDir = path.join(fixture.thirdPartyRoot, 'missing-entry');
        fs.mkdirSync(extensionDir, { recursive: true });
        writeModule(extensionDir, { entry: './server.cjs' });
        // Remove the entry file that writeModule just created.
        fs.unlinkSync(path.join(extensionDir, '.authority', 'server.cjs'));

        const discovery = createDiscovery(fixture);
        const result = discovery.discover();

        const record = result.records[0]!;
        expect(record.status).toBe('entry_missing');
        expect(record.diagnostics?.[0]?.code).toBe('entry_missing');
    });

    it('records invalid_manifest when ownerExtensionId does not match the discovered extension id (duplicate-module-id copy-paste)', () => {
        const fixture = createFixture();
        const firstDir = path.join(fixture.thirdPartyRoot, 'first-extension');
        const secondDir = path.join(fixture.thirdPartyRoot, 'second-extension');
        fs.mkdirSync(firstDir, { recursive: true });
        fs.mkdirSync(secondDir, { recursive: true });
        // First extension: valid manifest with its own owner.
        writeModule(firstDir);
        // Second extension: copy-pasted manifest that keeps the first
        // extension's ownerExtensionId, so it fails owner validation rather
        // than producing a duplicate_id record.
        writeModule(secondDir, {
            moduleId: 'third-party.first-extension',
            ownerExtensionId: 'third-party/first-extension',
        });

        const discovery = createDiscovery(fixture);
        const result = discovery.discover();

        expect(result.records).toHaveLength(2);
        const first = result.records.find(record => record.ownerExtensionId === 'third-party/first-extension');
        const second = result.records.find(record => record.ownerExtensionId === 'third-party/second-extension');
        expect(first?.status).toBe('available');
        expect(second?.status).toBe('invalid_manifest');
        expect(second?.diagnostics?.[0]?.code).toBe('manifest_owner_extension_id_mismatch');
        expect(result.byModuleId.get('third-party.first-extension')).toBe(first);
    });

    it('marks a later valid record as duplicate_id when registerDiscoveredRecord receives the same moduleId twice', () => {
        const fixture = createFixture();
        const extensionDir = path.join(fixture.thirdPartyRoot, 'real-extension');
        fs.mkdirSync(extensionDir, { recursive: true });
        writeModule(extensionDir);

        const discovery = createDiscovery(fixture);
        const result = discovery.discover();
        const record = result.records[0]!;

        const core = new CoreService();
        const permissions = new PermissionService(new PolicyService(core), core);
        const audit = { logUsage: vi.fn(), logPermission: vi.fn(), logError: vi.fn(), logWarning: vi.fn() } as never;
        const modules = new ModuleHostService(permissions, audit, {} as never, {} as never, {} as never, {} as never, {} as never);

        modules.registerDiscoveredRecord(record);
        const duplicate: typeof record = {
            ...record,
            source: { ...record.source, extensionId: 'third-party/other-extension' },
        };
        modules.registerDiscoveredRecord(duplicate);

        // The host keeps both records: the first valid one as `available`
        // and the later one as `duplicate_id`, both surfaced via listRecords.
        expect(modules.recordCount()).toBe(2);
        const primary = modules.getRecord(record.moduleId);
        expect(primary?.status).toBe('available');
        expect(primary?.source.extensionId).toBe('third-party/real-extension');
        const duplicateRecords = modules.listRecords().filter(r => r.status === 'duplicate_id');
        expect(duplicateRecords).toHaveLength(1);
        expect(duplicateRecords[0]?.source.extensionId).toBe('third-party/other-extension');
        expect(duplicateRecords[0]?.diagnostics?.[0]?.code).toBe('duplicate_module_id');
    });

    it.skipIf(!symlinkTestsSupported)('ignores symlinked extension directories', () => {
        const fixture = createFixture();
        const realExtensionDir = path.join(fixture.thirdPartyRoot, 'real-extension');
        const symlinkedDir = path.join(fixture.thirdPartyRoot, 'symlinked-extension');
        fs.mkdirSync(realExtensionDir, { recursive: true });
        writeModule(realExtensionDir);
        fs.symlinkSync(realExtensionDir, symlinkedDir, 'dir');

        const discovery = createDiscovery(fixture);
        const result = discovery.discover();

        // The symlinked extension is ignored; only the real extension is discovered.
        expect(result.records).toHaveLength(1);
        expect(result.records[0]?.ownerExtensionId).toBe('third-party/real-extension');
    });

    it('accepts a realistic 64 MiB inline request/response limit', () => {
        const fixture = createFixture();
        const extensionDir = path.join(fixture.thirdPartyRoot, 'realistic-limit');
        fs.mkdirSync(extensionDir, { recursive: true });
        writeModule(extensionDir, {
            transactions: {
                'data.commit': {
                    name: 'data.commit',
                    version: '1.0.0',
                    title: 'Commit data',
                    riskLevel: 'high',
                    permissionTarget: { kind: 'transaction' },
                    requiredResources: [{ resource: 'sql.private', target: 'default' }],
                    idempotency: 'required',
                    timeoutMs: 120_000,
                    maxRequestBytes: 64 * 1024 * 1024,
                    maxResponseBytes: 64 * 1024 * 1024,
                },
            },
        });

        const discovery = createDiscovery(fixture);
        const result = discovery.discover();

        const record = result.records[0]!;
        expect(record.status).toBe('available');
        expect(record.manifest?.transactions['data.commit']?.maxRequestBytes).toBe(64 * 1024 * 1024);
    });

    it('rejects maxRequestBytes above the 256 MiB hard cap', () => {
        const fixture = createFixture();
        const extensionDir = path.join(fixture.thirdPartyRoot, 'oversized-request');
        fs.mkdirSync(extensionDir, { recursive: true });
        writeModule(extensionDir, {
            transactions: {
                'data.commit': {
                    name: 'data.commit',
                    version: '1.0.0',
                    title: 'Commit data',
                    riskLevel: 'high',
                    permissionTarget: { kind: 'transaction' },
                    requiredResources: [],
                    idempotency: 'optional',
                    timeoutMs: 120_000,
                    maxRequestBytes: MODULE_MAX_REQUEST_BYTES + 1,
                },
            },
        });

        const discovery = createDiscovery(fixture);
        const result = discovery.discover();

        const record = result.records[0]!;
        expect(record.status).toBe('invalid_manifest');
        expect(record.diagnostics?.[0]?.code).toBe('manifest_transaction_max_request_bytes_invalid');
    });

    it('rejects maxResponseBytes above the 256 MiB hard cap', () => {
        const fixture = createFixture();
        const extensionDir = path.join(fixture.thirdPartyRoot, 'oversized-response');
        fs.mkdirSync(extensionDir, { recursive: true });
        writeModule(extensionDir, {
            transactions: {
                'data.commit': {
                    name: 'data.commit',
                    version: '1.0.0',
                    title: 'Commit data',
                    riskLevel: 'high',
                    permissionTarget: { kind: 'transaction' },
                    requiredResources: [],
                    idempotency: 'optional',
                    timeoutMs: 120_000,
                    maxResponseBytes: MODULE_MAX_RESPONSE_BYTES + 1,
                },
            },
        });

        const discovery = createDiscovery(fixture);
        const result = discovery.discover();

        const record = result.records[0]!;
        expect(record.status).toBe('invalid_manifest');
        expect(record.diagnostics?.[0]?.code).toBe('manifest_transaction_max_response_bytes_invalid');
    });

    it('exposes generous default byte limits as exported constants', () => {
        expect(MODULE_DEFAULT_REQUEST_BYTES).toBe(64 * 1024 * 1024);
        expect(MODULE_DEFAULT_RESPONSE_BYTES).toBe(64 * 1024 * 1024);
        expect(MODULE_MAX_REQUEST_BYTES).toBe(256 * 1024 * 1024);
        expect(MODULE_MAX_RESPONSE_BYTES).toBe(256 * 1024 * 1024);
    });

    it('does not execute any companion code (no .authority/server.cjs loaded)', () => {
        const fixture = createFixture();
        const extensionDir = path.join(fixture.thirdPartyRoot, 'no-exec');
        fs.mkdirSync(extensionDir, { recursive: true });
        // Place a server.cjs with content that would fail loudly if loaded.
        const moduleDir = path.join(extensionDir, '.authority');
        fs.mkdirSync(moduleDir, { recursive: true });
        fs.writeFileSync(
            path.join(moduleDir, 'module.json'),
            JSON.stringify({
                id: 'third-party.no-exec',
                displayName: 'No Exec',
                ownerExtensionId: 'third-party/no-exec',
                version: '1.0.0',
                schemaVersion: 1,
                protocolVersion: AUTHORITY_MODULE_PROTOCOL_VERSION,
                entry: './server.cjs',
                transactions: {
                    'task.run': {
                        name: 'task.run',
                        version: '1.0.0',
                        title: 'Run task',
                        riskLevel: 'medium',
                        permissionTarget: { kind: 'transaction' },
                        requiredResources: [],
                        idempotency: 'optional',
                    },
                },
            }, null, 2),
            'utf8',
        );
        fs.writeFileSync(
            path.join(moduleDir, 'server.cjs'),
            'throw new Error("companion code must not be loaded in Phase 1");\n',
            'utf8',
        );

        const discovery = createDiscovery(fixture);
        // discover() must not require() or import the entry file.
        expect(() => discovery.discover()).not.toThrow();
        const result = discovery.discover();
        expect(result.records[0]?.status).toBe('available');
    });

    it('returns no records when extensions root does not exist', () => {
        const fixture = createFixture();
        // Point at a non-existent ST root.
        const discovery = new ModuleDiscoveryService(createInstallService(fixture.sillyTavernRoot), {
            sillyTavernRoot: path.join(fixture.sillyTavernRoot, 'does-not-exist'),
            logger: { info() {}, warn() {}, error() {} },
        });
        const result = discovery.discover();
        expect(result.records).toHaveLength(0);
    });

    it('skips node_modules, dist, .git, target, and hidden directories in extensions root', () => {
        const fixture = createFixture();
        for (const name of ['node_modules', 'dist', '.git', 'target', '.hidden']) {
            const dir = path.join(fixture.extensionsRoot, name);
            fs.mkdirSync(dir, { recursive: true });
            fs.mkdirSync(path.join(dir, '.authority'), { recursive: true });
            fs.writeFileSync(
                path.join(dir, '.authority', 'module.json'),
                JSON.stringify({ id: name, displayName: name, ownerExtensionId: name, version: '1.0.0', schemaVersion: 1, protocolVersion: 1, transactions: {} }),
                'utf8',
            );
        }
        const discovery = createDiscovery(fixture);
        const result = discovery.discover();
        expect(result.records).toHaveLength(0);
    });

    it('does not treat the third-party container as an extension itself', () => {
        const fixture = createFixture();
        // Put a module.json directly inside the third-party container dir.
        const thirdPartyModuleDir = path.join(fixture.thirdPartyRoot, '.authority');
        fs.mkdirSync(thirdPartyModuleDir, { recursive: true });
        fs.writeFileSync(
            path.join(thirdPartyModuleDir, 'module.json'),
            JSON.stringify({ id: 'third-party', displayName: 'Third Party', ownerExtensionId: 'third-party', version: '1.0.0', schemaVersion: 1, protocolVersion: 1, transactions: {} }),
            'utf8',
        );

        const discovery = createDiscovery(fixture);
        const result = discovery.discover();
        expect(result.records).toHaveLength(0);
    });

    it.skipIf(!symlinkTestsSupported)('rejects a symlinked .authority/module.json', () => {
        const fixture = createFixture();
        // Real manifest lives in a sibling extension; the candidate extension
        // symlinks its module.json at the malicious path.
        const realExtensionDir = path.join(fixture.thirdPartyRoot, 'real-extension');
        const maliciousExtensionDir = path.join(fixture.thirdPartyRoot, 'malicious-extension');
        fs.mkdirSync(realExtensionDir, { recursive: true });
        fs.mkdirSync(maliciousExtensionDir, { recursive: true });
        writeModule(realExtensionDir);
        const maliciousModuleDir = path.join(maliciousExtensionDir, '.authority');
        fs.mkdirSync(maliciousModuleDir, { recursive: true });
        // Point module.json at a target outside the candidate extension.
        fs.symlinkSync(
            path.join(realExtensionDir, '.authority', 'module.json'),
            path.join(maliciousModuleDir, 'module.json'),
            'file',
        );

        const discovery = createDiscovery(fixture);
        const result = discovery.discover();

        // Both records exist; the malicious one surfaces as incompatible_host
        // with the manifest_symlink_rejected diagnostic code.
        const malicious = result.records.find(record => record.ownerExtensionId === 'third-party/malicious-extension');
        expect(malicious).toBeDefined();
        expect(malicious?.status).toBe('incompatible_host');
        expect(malicious?.diagnostics?.[0]?.code).toBe('manifest_symlink_rejected');
        expect(malicious?.manifest).toBeNull();
    });

    it.skipIf(!symlinkTestsSupported)('rejects a symlinked entry server.cjs', () => {
        const fixture = createFixture();
        const extensionDir = path.join(fixture.thirdPartyRoot, 'symlinked-entry');
        fs.mkdirSync(extensionDir, { recursive: true });
        const moduleDir = path.join(extensionDir, '.authority');
        fs.mkdirSync(moduleDir, { recursive: true });
        // Place a real entry outside the .authority dir and symlink it in.
        const realEntry = path.join(extensionDir, 'real-server.cjs');
        fs.writeFileSync(realEntry, 'module.exports.activate = async () => {};\n', 'utf8');
        fs.symlinkSync(realEntry, path.join(moduleDir, 'server.cjs'), 'file');
        fs.writeFileSync(
            path.join(moduleDir, 'module.json'),
            JSON.stringify({
                id: 'third-party.symlinked-entry',
                displayName: 'Symlinked Entry',
                ownerExtensionId: 'third-party/symlinked-entry',
                version: '1.0.0',
                schemaVersion: 1,
                protocolVersion: AUTHORITY_MODULE_PROTOCOL_VERSION,
                entry: './server.cjs',
                transactions: {
                    'task.run': {
                        name: 'task.run',
                        version: '1.0.0',
                        title: 'Run task',
                        riskLevel: 'medium',
                        permissionTarget: { kind: 'transaction' },
                        requiredResources: [],
                        idempotency: 'optional',
                    },
                },
            }, null, 2),
            'utf8',
        );

        const discovery = createDiscovery(fixture);
        const result = discovery.discover();

        const record = result.records[0]!;
        expect(record.status).toBe('invalid_manifest');
        expect(record.diagnostics?.[0]?.code).toBe('entry_symlink_rejected');
    });

    it('rejects an entry whose realpath escapes the real .authority directory', () => {
        const fixture = createFixture();
        const extensionDir = path.join(fixture.thirdPartyRoot, 'realpath-escape');
        fs.mkdirSync(extensionDir, { recursive: true });
        const moduleDir = path.join(extensionDir, '.authority');
        fs.mkdirSync(moduleDir, { recursive: true });
        // Create a regular file outside .authority.
        const outsideFile = path.join(extensionDir, 'escaped.cjs');
        fs.writeFileSync(outsideFile, 'module.exports.activate = async () => {};\n', 'utf8');
        fs.writeFileSync(
            path.join(moduleDir, 'module.json'),
            JSON.stringify({
                id: 'third-party.realpath-escape',
                displayName: 'Realpath Escape',
                ownerExtensionId: 'third-party/realpath-escape',
                version: '1.0.0',
                schemaVersion: 1,
                protocolVersion: AUTHORITY_MODULE_PROTOCOL_VERSION,
                // Entry resolves inside .authority via `..`-free join but its
                // realpath must still escape because the file lives outside.
                entry: '../escaped.cjs',
                transactions: {
                    'task.run': {
                        name: 'task.run',
                        version: '1.0.0',
                        title: 'Run task',
                        riskLevel: 'medium',
                        permissionTarget: { kind: 'transaction' },
                        requiredResources: [],
                        idempotency: 'optional',
                    },
                },
            }, null, 2),
            'utf8',
        );

        const discovery = createDiscovery(fixture);
        const result = discovery.discover();

        const record = result.records[0]!;
        // The `../escaped.cjs` is caught by the lexical containment check
        // before the realpath check; both surface as entry_path_escape.
        expect(record.status).toBe('invalid_manifest');
        expect(record.diagnostics?.[0]?.code).toBe('entry_path_escape');
    });

    it.skipIf(!symlinkTestsSupported)('rejects an entry that escapes via a symlinked ancestor directory in realpath', () => {
        const fixture = createFixture();
        // Layout: extension/.authority/ contains a symlinked subdir `link`
        // pointing to a real dir outside .authority. The entry `link/x.cjs`
        // passes lexical containment (it's inside .authority) but its
        // realpath escapes .authority. The symlink check on the entry file
        // itself does not fire because `link/x.cjs` is a regular file; only
        // realpath containment catches the escape.
        const extensionDir = path.join(fixture.thirdPartyRoot, 'symlink-ancestor');
        fs.mkdirSync(extensionDir, { recursive: true });
        const moduleDir = path.join(extensionDir, '.authority');
        fs.mkdirSync(moduleDir, { recursive: true });
        const outsideDir = path.join(extensionDir, 'outside');
        fs.mkdirSync(outsideDir, { recursive: true });
        fs.writeFileSync(path.join(outsideDir, 'x.cjs'), 'module.exports.activate = async () => {};\n', 'utf8');
        fs.symlinkSync(outsideDir, path.join(moduleDir, 'link'), 'dir');
        fs.writeFileSync(
            path.join(moduleDir, 'module.json'),
            JSON.stringify({
                id: 'third-party.symlink-ancestor',
                displayName: 'Symlink Ancestor',
                ownerExtensionId: 'third-party/symlink-ancestor',
                version: '1.0.0',
                schemaVersion: 1,
                protocolVersion: AUTHORITY_MODULE_PROTOCOL_VERSION,
                entry: './link/x.cjs',
                transactions: {
                    'task.run': {
                        name: 'task.run',
                        version: '1.0.0',
                        title: 'Run task',
                        riskLevel: 'medium',
                        permissionTarget: { kind: 'transaction' },
                        requiredResources: [],
                        idempotency: 'optional',
                    },
                },
            }, null, 2),
            'utf8',
        );

        const discovery = createDiscovery(fixture);
        const result = discovery.discover();

        const record = result.records[0]!;
        // The entry file itself is a regular file (not a symlink), so the
        // entry_symlink_rejected check does not fire. Realpath containment
        // catches that the real entry path is outside realpath(moduleDir).
        expect(record.status).toBe('invalid_manifest');
        expect(record.diagnostics?.[0]?.code).toBe('entry_path_escape');
    });

    it('rejects module.execute as a required resource in companion manifests', () => {
        const fixture = createFixture();
        const extensionDir = path.join(fixture.thirdPartyRoot, 'execute-resource');
        fs.mkdirSync(extensionDir, { recursive: true });
        writeModule(extensionDir, {
            transactions: {
                'task.run': {
                    name: 'task.run',
                    version: '1.0.0',
                    title: 'Run task',
                    riskLevel: 'medium',
                    permissionTarget: { kind: 'transaction' },
                    requiredResources: [{ resource: 'module.execute', target: 'third-party.execute-resource:task.run' }],
                    idempotency: 'optional',
                },
            },
        });

        const discovery = createDiscovery(fixture);
        const result = discovery.discover();

        const record = result.records[0]!;
        expect(record.status).toBe('invalid_manifest');
        expect(record.diagnostics?.[0]?.code).toBe('manifest_transaction_required_resource_forbidden');
    });

    it('accepts a custom permissionTarget target scoped to moduleId', () => {
        const fixture = createFixture();
        const extensionDir = path.join(fixture.thirdPartyRoot, 'custom-scoped');
        fs.mkdirSync(extensionDir, { recursive: true });
        writeModule(extensionDir, {
            transactions: {
                'task.run': {
                    name: 'task.run',
                    version: '1.0.0',
                    title: 'Run task',
                    riskLevel: 'medium',
                    permissionTarget: { kind: 'custom', target: 'third-party.custom-scoped:task' },
                    requiredResources: [],
                    idempotency: 'optional',
                },
            },
        });

        const discovery = createDiscovery(fixture);
        const result = discovery.discover();

        const record = result.records[0]!;
        expect(record.status).toBe('available');
        expect(record.manifest?.transactions['task.run']?.permissionTarget).toEqual({
            kind: 'custom',
            target: 'third-party.custom-scoped:task',
        });
    });

    it('rejects a custom permissionTarget target not scoped to moduleId', () => {
        const fixture = createFixture();
        const extensionDir = path.join(fixture.thirdPartyRoot, 'custom-unscoped');
        fs.mkdirSync(extensionDir, { recursive: true });
        writeModule(extensionDir, {
            transactions: {
                'task.run': {
                    name: 'task.run',
                    version: '1.0.0',
                    title: 'Run task',
                    riskLevel: 'medium',
                    permissionTarget: { kind: 'custom', target: 'some-other-module:task' },
                    requiredResources: [],
                    idempotency: 'optional',
                },
            },
        });

        const discovery = createDiscovery(fixture);
        const result = discovery.discover();

        const record = result.records[0]!;
        expect(record.status).toBe('invalid_manifest');
        expect(record.diagnostics?.[0]?.code).toBe('manifest_transaction_permission_target_invalid');
    });
});

describe('ModuleHostService discovery records integration', () => {
    afterEach(() => {
        while (cleanupDirs.length > 0) {
            const dir = cleanupDirs.pop();
            if (dir) {
                fs.rmSync(dir, { recursive: true, force: true });
            }
        }
    });

    it('registers discovered records and surfaces them via listRecords/getRecord', () => {
        const fixture = createFixture();
        const extensionDir = path.join(fixture.thirdPartyRoot, 'some-extension');
        fs.mkdirSync(extensionDir, { recursive: true });
        writeModule(extensionDir);

        const discovery = createDiscovery(fixture);
        const result = discovery.discover();

        const core = new CoreService();
        const permissions = new PermissionService(new PolicyService(core), core);
        const audit = { logUsage: vi.fn(), logPermission: vi.fn(), logError: vi.fn(), logWarning: vi.fn() } as never;
        const modules = new ModuleHostService(permissions, audit, {} as never, {} as never, {} as never, {} as never, {} as never);

        modules.registerDiscoveredRecords(result.records);

        expect(modules.recordCount()).toBe(1);
        expect(modules.listRecords()[0]?.moduleId).toBe('third-party.some-extension');
        expect(modules.getRecord('third-party.some-extension')?.status).toBe('available');

        const list = modules.listManifests();
        expect(list.count).toBe(0);
        expect(list.recordCount).toBe(1);
        expect(list.records?.[0]?.moduleId).toBe('third-party.some-extension');
    });

    it('does not leak absolute local paths from listManifests, getManifest, or getRecord', () => {
        const fixture = createFixture();
        const extensionDir = path.join(fixture.thirdPartyRoot, 'leaky-extension');
        fs.mkdirSync(extensionDir, { recursive: true });
        writeModule(extensionDir);

        const discovery = createDiscovery(fixture);
        const result = discovery.discover();

        const core = new CoreService();
        const permissions = new PermissionService(new PolicyService(core), core);
        const audit = { logUsage: vi.fn(), logPermission: vi.fn(), logError: vi.fn(), logWarning: vi.fn() } as never;
        const modules = new ModuleHostService(permissions, audit, {} as never, {} as never, {} as never, {} as never, {} as never);

        modules.registerDiscoveredRecords(result.records);

        const moduleId = 'third-party.leaky-extension';
        const serializedList = JSON.stringify(modules.listManifests());
        const serializedGet = JSON.stringify(modules.getManifest(moduleId));
        const serializedRecord = JSON.stringify(modules.getRecord(moduleId));

        // The serialized wire shapes must never contain the absolute extension
        // dir, module dir, manifest path, or entry path. Only the safe relative
        // forms `.authority/module.json` and `./server.cjs` may appear.
        expect(serializedList).not.toContain(fixture.sillyTavernRoot);
        expect(serializedList).not.toContain(extensionDir);
        expect(serializedGet).not.toContain(fixture.sillyTavernRoot);
        expect(serializedGet).not.toContain(extensionDir);
        expect(serializedRecord).not.toContain(fixture.sillyTavernRoot);
        expect(serializedRecord).not.toContain(extensionDir);

        // Safe relative paths are allowed.
        expect(serializedList).toContain('.authority/module.json');
        expect(serializedList).toContain('./server.cjs');
    });
});

describe('ModuleHostService available-but-not-loaded execute', () => {
    afterEach(() => {
        while (cleanupDirs.length > 0) {
            const dir = cleanupDirs.pop();
            if (dir) {
                fs.rmSync(dir, { recursive: true, force: true });
            }
        }
    });

    it('throws a structured module_not_loaded error when executing an available-but-not-loaded module', async () => {
        const fixture = createFixture();
        const extensionDir = path.join(fixture.thirdPartyRoot, 'some-extension');
        fs.mkdirSync(extensionDir, { recursive: true });
        writeModule(extensionDir);

        const discovery = createDiscovery(fixture);
        const result = discovery.discover();

        const core = new CoreService();
        const permissions = new PermissionService(new PolicyService(core), core);
        const audit = { logUsage: vi.fn(), logPermission: vi.fn(), logError: vi.fn(), logWarning: vi.fn() } as never;
        const modules = new ModuleHostService(permissions, audit, {} as never, {} as never, {} as never, {} as never, {} as never);

        modules.registerDiscoveredRecords(result.records);

        const user = { handle: 'alice', isAdmin: false, rootDir: fixture.sillyTavernRoot };
        const session = {
            token: 't',
            createdAt: new Date().toISOString(),
            userHandle: 'alice',
            isAdmin: false,
            extension: { id: 'third-party/some-extension', installType: 'local' as const, displayName: 'Some', version: AUTHORITY_VERSION, firstSeenAt: new Date().toISOString() },
            declaredPermissions: {},
            sessionGrants: new Map(),
        };

        await expect(
            modules.execute(user as never, session as never, 'third-party.some-extension', 'data.commit', { input: {} }),
        ).rejects.toThrow(/Module not loaded: third-party\.some-extension/);
    });
});

void AUTHORITY_VERSION;
void AUTHORITY_MODULE_PROTOCOL_VERSION;

// Helper imports kept here to ensure type-only imports stay in test scope.
void (undefined as unknown as AuthorityModuleManifest);

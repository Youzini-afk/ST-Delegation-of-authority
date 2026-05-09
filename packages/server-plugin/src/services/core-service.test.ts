import crypto from 'node:crypto';
import { EventEmitter } from 'node:events';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { PassThrough } from 'node:stream';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { CoreService } from './core-service.js';
import { AuthorityServiceError } from '../utils.js';
import { AUTHORITY_MANAGED_CORE_DIR, AUTHORITY_PLUGIN_ID } from '../constants.js';

vi.mock('node:child_process', async importOriginal => {
    const actual = await importOriginal<typeof import('node:child_process')>();
    return {
        ...actual,
        spawn: vi.fn(),
    };
});

describe('CoreService', () => {
    const originalFetch = globalThis.fetch;
    const cleanupDirs: string[] = [];

    afterEach(() => {
        globalThis.fetch = originalFetch;
        vi.restoreAllMocks();
        while (cleanupDirs.length > 0) {
            const dir = cleanupDirs.pop();
            if (dir) {
                fs.rmSync(dir, { recursive: true, force: true });
            }
        }
    });

    it('passes page to sql query requests', async () => {
        const fetchMock = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
            return new Response(JSON.stringify({
                kind: 'query',
                columns: ['id'],
                rows: [{ id: 1 }],
                rowCount: 1,
                page: {
                    nextCursor: '10',
                    limit: 10,
                    hasMore: true,
                    totalCount: 100,
                },
            }), {
                status: 200,
                headers: { 'content-type': 'application/json' },
            });
        });
        globalThis.fetch = fetchMock as typeof globalThis.fetch;

        const service = new CoreService();
        const serviceWithState = service as unknown as {
            status: { state: 'running'; port: number; lastError: string | null };
            token: string;
        };
        serviceWithState.status = {
            state: 'running',
            port: 43123,
            lastError: null,
        };
        serviceWithState.token = 'test-token';

        const result = await service.querySql('C:/tmp/example.sqlite', {
            statement: 'SELECT id FROM sample ORDER BY id',
            page: { cursor: '10', limit: 10 },
        });

        expect(result.page).toEqual({
            nextCursor: '10',
            limit: 10,
            hasMore: true,
            totalCount: 100,
        });
        expect(fetchMock).toHaveBeenCalledTimes(1);

        const [, init] = fetchMock.mock.calls[0] ?? [];
        const body = JSON.parse(String(init?.body ?? '{}')) as {
            dbPath: string;
            statement: string;
            params: unknown[];
            page?: { cursor?: string; limit?: number };
        };
        expect(body.dbPath).toBe('C:/tmp/example.sqlite');
        expect(body.statement).toBe('SELECT id FROM sample ORDER BY id');
        expect(body.params).toEqual([]);
        expect(body.page).toEqual({ cursor: '10', limit: 10 });
    });

    it('maps core 4xx size failures to structured limit errors', async () => {
        const fetchMock = vi.fn(async () => {
            return new Response(JSON.stringify({
                error: 'Blob content exceeds 16777216 bytes',
            }), {
                status: 413,
                headers: { 'content-type': 'application/json' },
            });
        });
        globalThis.fetch = fetchMock as typeof globalThis.fetch;

        const service = new CoreService();
        const serviceWithState = service as unknown as {
            status: { state: 'running'; port: number; lastError: string | null };
            token: string;
        };
        serviceWithState.status = {
            state: 'running',
            port: 43123,
            lastError: null,
        };
        serviceWithState.token = 'test-token';

        const error = await service.querySql('C:/tmp/example.sqlite', {
            statement: 'SELECT 1',
        }).catch(value => value);

        expect(error).toBeInstanceOf(AuthorityServiceError);
        expect(error).toMatchObject({
            status: 413,
            code: 'limit_exceeded',
            category: 'limit',
        });
    });

    it('maps core job queue saturation to a structured 503 backpressure error', async () => {
        const fetchMock = vi.fn(async () => {
            return new Response(JSON.stringify({
                error: 'core job queue is full',
                code: 'job_queue_full',
            }), {
                status: 503,
                headers: { 'content-type': 'application/json' },
            });
        });
        globalThis.fetch = fetchMock as typeof globalThis.fetch;

        const service = createRunningCoreService();
        const error = await service.querySql('C:/tmp/example.sqlite', {
            statement: 'SELECT 1',
        }).catch(value => value);

        expect(error).toBeInstanceOf(AuthorityServiceError);
        expect(error).toMatchObject({
            status: 503,
            code: 'job_queue_full',
            category: 'backpressure',
        });
        expect((error as AuthorityServiceError).details).toMatchObject({
            source: 'core',
            statusCode: 503,
        });
    });

    it('maps core concurrency saturation to a structured 503 backpressure error', async () => {
        const fetchMock = vi.fn(async () => {
            return new Response(JSON.stringify({
                error: 'concurrency limit exceeded',
                code: 'concurrency_limit_exceeded',
            }), {
                status: 503,
                headers: { 'content-type': 'application/json' },
            });
        });
        globalThis.fetch = fetchMock as typeof globalThis.fetch;

        const service = createRunningCoreService();
        const error = await service.querySql('C:/tmp/example.sqlite', {
            statement: 'SELECT 1',
        }).catch(value => value);

        expect(error).toBeInstanceOf(AuthorityServiceError);
        expect(error).toMatchObject({
            status: 503,
            code: 'concurrency_limit_exceeded',
            category: 'backpressure',
        });
        expect((error as AuthorityServiceError).details).toMatchObject({
            source: 'core',
            statusCode: 503,
        });
    });

    it('starts managed core from the SillyTavern root with an absolute data root', async () => {
        const baseDir = fs.mkdtempSync(path.join(os.tmpdir(), 'authority-core-service-'));
        cleanupDirs.push(baseDir);
        const pluginRoot = path.join(baseDir, 'plugins', 'ST-Delegation-of-authority');
        const runtimeDir = path.join(pluginRoot, 'dist');
        fs.mkdirSync(runtimeDir, { recursive: true });
        writeCurrentCoreArtifact(pluginRoot);

        const child = createMockChildProcess();
        vi.mocked(spawn).mockReturnValue(child);
        globalThis.fetch = vi.fn(async () => new Response(JSON.stringify({
            ok: true,
            startedAt: new Date().toISOString(),
            limits: {},
        }), {
            status: 200,
            headers: { 'content-type': 'application/json' },
        })) as typeof globalThis.fetch;

        const service = new CoreService({
            runtimeDir,
            cwd: baseDir,
            env: {},
            logger: {
                info() {},
                warn() {},
                error() {},
            },
        });

        await service.start();

        expect(spawn).toHaveBeenCalledTimes(1);
        const [, , options] = vi.mocked(spawn).mock.calls[0] ?? [];
        expect(options?.cwd).toBe(baseDir);
        expect(options?.env).toMatchObject({
            AUTHORITY_CORE_DATA_ROOT: path.join(baseDir, 'data'),
        });

        await service.stop();
    });

    it('reports the expected platform and discovered managed platforms when core is missing', async () => {
        const baseDir = fs.mkdtempSync(path.join(os.tmpdir(), 'authority-core-service-'));
        cleanupDirs.push(baseDir);
        const pluginRoot = path.join(baseDir, 'plugin-root');
        fs.mkdirSync(path.join(pluginRoot, 'runtime'), { recursive: true });
        const { platform, arch } = getOtherPlatform();
        writeForeignCoreArtifact(pluginRoot, platform, arch);
        const platformId = `${platform}-${arch}`;

        const service = new CoreService({
            runtimeDir: path.join(pluginRoot, 'runtime'),
            cwd: baseDir,
            env: {},
            logger: {
                info() {},
                warn() {},
                error() {},
            },
        });

        const status = await service.start();

        expect(status.state).toBe('missing');
        expect(status.lastError).toContain(`Authority core binary for ${process.platform}-${process.arch}`);
        expect(status.lastError).toContain(`Found managed platforms: ${platformId}`);
        expect(status.lastError).toContain('npm run build:core');
    });

    it.runIf(process.platform === 'linux')('reports linux musl as the expected platform when the runtime is musl', async () => {
        const baseDir = fs.mkdtempSync(path.join(os.tmpdir(), 'authority-core-service-'));
        cleanupDirs.push(baseDir);
        const pluginRoot = path.join(baseDir, 'plugin-root');
        fs.mkdirSync(path.join(pluginRoot, 'runtime'), { recursive: true });
        writeForeignCoreArtifact(pluginRoot, 'linux', process.arch);

        const service = new CoreService({
            runtimeDir: path.join(pluginRoot, 'runtime'),
            cwd: baseDir,
            env: {
                AUTHORITY_CORE_LIBC: 'musl',
            },
            logger: {
                info() {},
                warn() {},
                error() {},
            },
        });

        const status = await service.start();

        expect(status.state).toBe('missing');
        expect(status.lastError).toContain(`Authority core binary for linux-${process.arch}-musl`);
        expect(status.lastError).toContain('glibc Linux binaries are not compatible');
    });
});

function createRunningCoreService(): CoreService {
    const service = new CoreService();
    const serviceWithState = service as unknown as {
        status: { state: 'running'; port: number; lastError: string | null };
        token: string;
    };
    serviceWithState.status = {
        state: 'running',
        port: 43123,
        lastError: null,
    };
    serviceWithState.token = 'test-token';
    return service;
}

function getOtherPlatform(): { platform: NodeJS.Platform; arch: NodeJS.Architecture } {
    const current = `${process.platform}-${process.arch}`;
    if (current !== 'win32-x64') {
        return { platform: 'win32', arch: 'x64' };
    }
    return { platform: 'linux', arch: 'x64' };
}

function writeForeignCoreArtifact(pluginRoot: string, platform: string, arch: string): void {
    const platformId = `${platform}-${arch}`;
    const binaryName = platform === 'win32' ? 'authority-core.exe' : 'authority-core';
    const platformDir = path.join(pluginRoot, AUTHORITY_MANAGED_CORE_DIR, platformId);
    const binaryPath = path.join(platformDir, binaryName);
    fs.mkdirSync(platformDir, { recursive: true });
    fs.writeFileSync(binaryPath, `authority-core ${platformId}\n`, 'utf8');
    const binarySha256 = crypto.createHash('sha256').update(fs.readFileSync(binaryPath)).digest('hex');
    fs.writeFileSync(path.join(platformDir, 'authority-core.json'), JSON.stringify({
        managedBy: AUTHORITY_PLUGIN_ID,
        version: 'test',
        platform,
        arch,
        binaryName,
        binarySha256,
        builtAt: new Date().toISOString(),
    }, null, 2), 'utf8');
}

function writeCurrentCoreArtifact(pluginRoot: string): void {
    const libc = getCurrentLinuxLibc();
    const platformId = libc === 'musl'
        ? `${process.platform}-${process.arch}-musl`
        : `${process.platform}-${process.arch}`;
    const binaryName = process.platform === 'win32' ? 'authority-core.exe' : 'authority-core';
    const platformDir = path.join(pluginRoot, AUTHORITY_MANAGED_CORE_DIR, platformId);
    const binaryPath = path.join(platformDir, binaryName);
    fs.mkdirSync(platformDir, { recursive: true });
    fs.writeFileSync(binaryPath, `authority-core ${platformId}\n`, 'utf8');
    const binarySha256 = crypto.createHash('sha256').update(fs.readFileSync(binaryPath)).digest('hex');
    fs.writeFileSync(path.join(platformDir, 'authority-core.json'), JSON.stringify({
        managedBy: AUTHORITY_PLUGIN_ID,
        version: 'test',
        platform: process.platform,
        arch: process.arch,
        binaryName,
        binarySha256,
        ...(libc === null ? {} : { libc }),
        builtAt: new Date().toISOString(),
    }, null, 2), 'utf8');
}

function getCurrentLinuxLibc(): 'musl' | null {
    if (process.platform !== 'linux') {
        return null;
    }
    const report = process.report?.getReport?.() as { header?: { glibcVersionRuntime?: string; glibcVersionCompiler?: string } } | undefined;
    const header = report?.header;
    return header?.glibcVersionRuntime || header?.glibcVersionCompiler ? null : 'musl';
}

function createMockChildProcess(): ReturnType<typeof spawn> {
    const child = new EventEmitter() as ReturnType<typeof spawn> & {
        stdout: PassThrough;
        stderr: PassThrough;
        pid: number;
        exitCode: number | null;
        killed: boolean;
        kill: ReturnType<typeof vi.fn>;
    };
    child.stdout = new PassThrough();
    child.stderr = new PassThrough();
    child.pid = 12345;
    child.exitCode = null;
    child.killed = false;
    child.kill = vi.fn(() => {
        child.killed = true;
        child.exitCode = 0;
        queueMicrotask(() => child.emit('exit', 0, null));
        return true;
    });
    return child;
}

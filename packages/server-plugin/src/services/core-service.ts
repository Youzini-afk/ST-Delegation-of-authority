import fs from 'node:fs';
import net from 'node:net';
import path from 'node:path';
import process from 'node:process';
import { spawn, type ChildProcess } from 'node:child_process';
import type { SqlBatchRequest, SqlBatchResponse, SqlExecRequest, SqlExecResult, SqlQueryRequest, SqlQueryResult } from '@stdo/shared-types';
import { AUTHORITY_MANAGED_CORE_DIR } from '../constants.js';
import type { AuthorityCoreHealthSnapshot, AuthorityCoreManagedMetadata, AuthorityCoreStatus, CoreRuntimeState } from '../types.js';
import { asErrorMessage, randomToken } from '../utils.js';

interface CoreArtifact {
    binaryPath: string;
    metadata: AuthorityCoreManagedMetadata;
}

interface CoreServiceOptions {
    runtimeDir?: string;
    cwd?: string;
    env?: NodeJS.ProcessEnv;
    logger?: Pick<typeof console, 'info' | 'warn' | 'error'>;
}

interface CoreSqlRequestPayload {
    dbPath: string;
    statement: string;
    params?: SqlQueryRequest['params'];
}

interface CoreSqlBatchRequestPayload {
    dbPath: string;
    statements: SqlBatchRequest['statements'];
}

const HEALTH_TIMEOUT_MS = 5000;
const HEALTH_POLL_INTERVAL_MS = 150;
const CORE_API_VERSION = 'authority-core/v1';

export class CoreService {
    private readonly runtimeDir: string;
    private readonly cwd: string;
    private readonly env: NodeJS.ProcessEnv;
    private readonly logger: Pick<typeof console, 'info' | 'warn' | 'error'>;
    private child: ChildProcess | null = null;
    private token: string | null = null;
    private stopping = false;
    private status: AuthorityCoreStatus;

    constructor(options: CoreServiceOptions = {}) {
        this.runtimeDir = path.resolve(options.runtimeDir ?? __dirname);
        this.cwd = path.resolve(options.cwd ?? process.cwd());
        this.env = options.env ?? process.env;
        this.logger = options.logger ?? console;
        this.status = {
            enabled: true,
            state: 'stopped',
            platform: process.platform,
            arch: process.arch,
            binaryPath: null,
            port: null,
            pid: null,
            version: null,
            startedAt: null,
            lastError: null,
            health: null,
        };
    }

    getStatus(): AuthorityCoreStatus {
        return {
            ...this.status,
            health: this.status.health ? { ...this.status.health } : null,
        };
    }

    async start(): Promise<AuthorityCoreStatus> {
        if (this.status.state === 'running') {
            await this.refreshHealth();
            return this.getStatus();
        }

        if (this.status.state === 'starting') {
            return this.waitUntilReady();
        }

        if (this.child) {
            await this.stop();
        }

        const artifact = this.resolveArtifact();
        if (!artifact) {
            this.setStatus('missing', {
                binaryPath: null,
                version: null,
                lastError: `Authority core binary not found under ${AUTHORITY_MANAGED_CORE_DIR}`,
                port: null,
                pid: null,
                startedAt: null,
                health: null,
            });
            return this.getStatus();
        }

        const port = await getAvailablePort();
        const token = randomToken();
        const child = spawn(artifact.binaryPath, [], {
            cwd: path.dirname(artifact.binaryPath),
            env: {
                ...this.env,
                AUTHORITY_CORE_HOST: '127.0.0.1',
                AUTHORITY_CORE_PORT: String(port),
                AUTHORITY_CORE_TOKEN: token,
                AUTHORITY_CORE_VERSION: artifact.metadata.version,
                AUTHORITY_CORE_API_VERSION: CORE_API_VERSION,
            },
            stdio: ['ignore', 'pipe', 'pipe'],
            windowsHide: true,
        });

        this.child = child;
        this.token = token;
        this.stopping = false;
        this.attachProcessListeners(child);
        this.setStatus('starting', {
            binaryPath: artifact.binaryPath,
            version: artifact.metadata.version,
            port,
            pid: child.pid ?? null,
            startedAt: null,
            lastError: null,
            health: null,
        });

        try {
            const health = await this.waitForHealth(port, token);
            this.setStatus('running', {
                binaryPath: artifact.binaryPath,
                version: artifact.metadata.version,
                port,
                pid: child.pid ?? null,
                startedAt: health.startedAt,
                lastError: null,
                health,
            });
            return this.getStatus();
        } catch (error) {
            const message = asErrorMessage(error);
            this.logger.error(`[authority] Failed to start authority-core: ${message}`);
            await this.stop();
            this.setStatus('error', {
                binaryPath: artifact.binaryPath,
                version: artifact.metadata.version,
                port,
                pid: null,
                startedAt: null,
                lastError: message,
                health: null,
            });
            return this.getStatus();
        }
    }

    async stop(): Promise<void> {
        const child = this.child;
        if (!child) {
            if (this.status.state !== 'missing') {
                this.setStatus('stopped', {
                    pid: null,
                    port: null,
                    startedAt: null,
                    health: null,
                    lastError: this.status.lastError,
                });
            }
            return;
        }

        this.stopping = true;
        const closePromise = onceChildExit(child);
        child.kill();
        await Promise.race([
            closePromise,
            delay(1000),
        ]);
        if (child.exitCode === null && !child.killed) {
            child.kill('SIGKILL');
            await Promise.race([
                closePromise,
                delay(1000),
            ]);
        }
        this.child = null;
        this.token = null;
        this.setStatus('stopped', {
            pid: null,
            port: null,
            startedAt: null,
            health: null,
        });
    }

    async refreshHealth(): Promise<AuthorityCoreHealthSnapshot | null> {
        if (!this.token || !this.status.port) {
            return null;
        }

        try {
            const health = await fetchHealth(this.status.port, this.token);
            this.status = {
                ...this.status,
                state: 'running',
                startedAt: health.startedAt,
                health,
                lastError: null,
            };
            return health;
        } catch (error) {
            const message = asErrorMessage(error);
            this.status = {
                ...this.status,
                state: 'error',
                health: null,
                lastError: message,
            };
            return null;
        }
    }

    async querySql(dbPath: string, request: SqlQueryRequest): Promise<SqlQueryResult> {
        return await this.request('/v1/sql/query', {
            dbPath,
            statement: request.statement,
            params: request.params ?? [],
        } satisfies CoreSqlRequestPayload);
    }

    async execSql(dbPath: string, request: SqlExecRequest): Promise<SqlExecResult> {
        return await this.request('/v1/sql/exec', {
            dbPath,
            statement: request.statement,
            params: request.params ?? [],
        } satisfies CoreSqlRequestPayload);
    }

    async batchSql(dbPath: string, request: SqlBatchRequest): Promise<SqlBatchResponse> {
        return await this.request('/v1/sql/batch', {
            dbPath,
            statements: request.statements,
        } satisfies CoreSqlBatchRequestPayload);
    }

    private attachProcessListeners(child: ChildProcess): void {
        child.stdout?.on('data', chunk => {
            const text = String(chunk).trim();
            if (text) {
                this.logger.info(`[authority-core] ${text}`);
            }
        });

        child.stderr?.on('data', chunk => {
            const text = String(chunk).trim();
            if (text) {
                this.logger.warn(`[authority-core] ${text}`);
            }
        });

        child.on('exit', (code, signal) => {
            const currentPid = this.child?.pid;
            if (currentPid !== child.pid) {
                return;
            }

            this.child = null;
            this.token = null;
            const state: CoreRuntimeState = this.stopping ? 'stopped' : 'error';
            const lastError = this.stopping ? this.status.lastError : `authority-core exited with code ${code ?? 'null'} and signal ${signal ?? 'null'}`;
            this.setStatus(state, {
                pid: null,
                port: null,
                startedAt: null,
                health: null,
                lastError,
            });
            this.stopping = false;
        });
    }

    private async waitUntilReady(): Promise<AuthorityCoreStatus> {
        const startedAt = Date.now();
        while (Date.now() - startedAt < HEALTH_TIMEOUT_MS) {
            if (this.status.state !== 'starting') {
                return this.getStatus();
            }
            await delay(HEALTH_POLL_INTERVAL_MS);
        }
        return this.getStatus();
    }

    private async waitForHealth(port: number, token: string): Promise<AuthorityCoreHealthSnapshot> {
        const startedAt = Date.now();
        while (Date.now() - startedAt < HEALTH_TIMEOUT_MS) {
            const child = this.child;
            if (!child) {
                throw new Error('authority-core process disappeared before becoming healthy');
            }
            if (child.exitCode !== null) {
                throw new Error(`authority-core exited before becoming healthy with code ${child.exitCode}`);
            }
            try {
                return await fetchHealth(port, token);
            } catch {
                await delay(HEALTH_POLL_INTERVAL_MS);
            }
        }
        throw new Error(`authority-core did not become healthy within ${HEALTH_TIMEOUT_MS}ms`);
    }

    private resolveArtifact(): CoreArtifact | null {
        for (const root of this.resolveManagedCoreRoots()) {
            const artifact = readArtifact(root);
            if (artifact) {
                return artifact;
            }
        }
        return null;
    }

    private resolveManagedCoreRoots(): string[] {
        const explicitRoot = this.env.AUTHORITY_CORE_ROOT?.trim();
        const candidates = new Set<string>();
        if (explicitRoot) {
            candidates.add(path.resolve(explicitRoot));
        }

        for (const origin of [this.runtimeDir, this.cwd]) {
            let current = path.resolve(origin);
            while (true) {
                candidates.add(path.join(current, AUTHORITY_MANAGED_CORE_DIR));
                const parent = path.dirname(current);
                if (parent === current) {
                    break;
                }
                current = parent;
            }
        }

        return [...candidates];
    }

    private setStatus(state: CoreRuntimeState, patch: Partial<AuthorityCoreStatus>): void {
        this.status = {
            ...this.status,
            ...patch,
            state,
        };
    }

    private async request<T>(requestPath: string, body: unknown): Promise<T> {
        let status = this.getStatus();
        if (status.state !== 'running' || !this.token || !status.port) {
            status = await this.start();
        }

        if (status.state !== 'running' || !this.token || !status.port) {
            throw new Error(status.lastError ?? 'Authority core is not available');
        }

        const response = await fetch(`http://127.0.0.1:${status.port}${requestPath}`, {
            method: 'POST',
            headers: {
                'content-type': 'application/json',
                'x-authority-core-token': this.token,
            },
            body: JSON.stringify(body),
        });
        const payload = await readCorePayload(response);

        if (!response.ok) {
            throw new Error(extractCoreErrorMessage(payload, response.status));
        }

        return payload as T;
    }
}

function readArtifact(root: string): CoreArtifact | null {
    const platformDir = path.join(root, `${process.platform}-${process.arch}`);
    const metadataPath = path.join(platformDir, 'authority-core.json');
    if (!fs.existsSync(metadataPath)) {
        return null;
    }

    const metadata = JSON.parse(fs.readFileSync(metadataPath, 'utf8')) as AuthorityCoreManagedMetadata;
    const binaryPath = path.join(platformDir, metadata.binaryName);
    if (!fs.existsSync(binaryPath)) {
        return null;
    }

    return {
        binaryPath,
        metadata,
    };
}

async function fetchHealth(port: number, token: string): Promise<AuthorityCoreHealthSnapshot> {
    const response = await fetch(`http://127.0.0.1:${port}/health`, {
        headers: {
            'x-authority-core-token': token,
        },
    });

    if (!response.ok) {
        throw new Error(`authority-core health check failed with ${response.status}`);
    }

    return await response.json() as AuthorityCoreHealthSnapshot;
}

async function getAvailablePort(): Promise<number> {
    return await new Promise((resolve, reject) => {
        const server = net.createServer();
        server.unref();
        server.on('error', reject);
        server.listen(0, '127.0.0.1', () => {
            const address = server.address();
            if (!address || typeof address === 'string') {
                server.close(() => reject(new Error('Unable to resolve an ephemeral authority-core port')));
                return;
            }
            const { port } = address;
            server.close(error => {
                if (error) {
                    reject(error);
                    return;
                }
                resolve(port);
            });
        });
    });
}

function onceChildExit(child: ChildProcess): Promise<void> {
    return new Promise(resolve => {
        child.once('exit', () => resolve());
    });
}

async function readCorePayload(response: Response): Promise<unknown> {
    const contentType = response.headers.get('content-type') ?? '';
    if (contentType.includes('application/json')) {
        return await response.json();
    }

    const text = await response.text();
    return text || undefined;
}

function extractCoreErrorMessage(payload: unknown, statusCode: number): string {
    if (payload && typeof payload === 'object' && 'error' in payload) {
        return String((payload as { error: unknown }).error);
    }

    if (typeof payload === 'string' && payload.trim()) {
        return payload.trim();
    }

    return `authority-core request failed with ${statusCode}`;
}

function delay(durationMs: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, durationMs));
}

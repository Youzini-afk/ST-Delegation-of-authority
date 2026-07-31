import { spawn, type ChildProcess } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import type { AgentToolDescriptor, AgentWorkspaceRecord } from '@stdo/shared-types';
import { atomicWriteFile, ensureDir, fsyncDirectory, isPathInside } from '../utils.js';
import { WorkspaceHistoryService } from './workspace-history-service.js';

const SHELL_OUTPUT_PREVIEW_BYTES = 256 * 1024;
const ARTIFACT_DEFAULT_PAGE_BYTES = 256 * 1024;
const SKIPPED_SEARCH_DIRS = new Set(['.git', 'node_modules']);

export interface AgentHostToolContext {
    workspace: AgentWorkspaceRecord;
    sessionId: string;
    runId: string;
    invocationId: string;
    signal: AbortSignal;
}

export class AgentHostToolService {
    private readonly descriptors = createDescriptors();
    private readonly artifacts: AgentToolArtifactStore;

    constructor(private readonly history: WorkspaceHistoryService, artifactRoot?: string) {
        this.artifacts = new AgentToolArtifactStore(artifactRoot ?? path.join(history.storeDir, 'agent-tool-artifacts'));
    }

    list(): AgentToolDescriptor[] {
        return this.descriptors.map(descriptor => structuredClone(descriptor));
    }

    get(toolId: string): AgentToolDescriptor | undefined {
        const descriptor = this.descriptors.find(tool => tool.id === toolId);
        return descriptor ? structuredClone(descriptor) : undefined;
    }

    checkpointPaths(toolId: string, input: unknown): string[] {
        const args = objectInput(input);
        if (toolId === 'host_write_file' || toolId === 'host_replace_text') {
            return [requiredString(args.path, 'path', 2_000)];
        }
        if (toolId === 'host_shell') {
            return ['.'];
        }
        return [];
    }

    approvalSummary(toolId: string, input: unknown): string {
        const args = objectInput(input);
        if (toolId === 'host_write_file') {
            return `Write ${requiredString(args.path, 'path', 2_000)}`;
        }
        if (toolId === 'host_replace_text') {
            return `Replace text in ${requiredString(args.path, 'path', 2_000)}`;
        }
        if (toolId === 'host_shell') {
            return `Full host command; effects outside the workspace and changes under .git or node_modules cannot be rolled back: ${requiredString(args.command, 'command', 32_000).slice(0, 500)}`;
        }
        return this.get(toolId)?.title ?? toolId;
    }

    async execute(toolId: string, input: unknown, context: AgentHostToolContext): Promise<unknown> {
        if (context.signal.aborted) {
            throw abortError(context.signal);
        }
        const args = objectInput(input);
        switch (toolId) {
            case 'host_list_files':
                return listFiles(context.workspace.rootPath, args);
            case 'host_read_file':
                return readFile(context.workspace.rootPath, args);
            case 'host_search_text':
                return searchText(context.workspace.rootPath, args, context.signal);
            case 'host_write_file':
                return writeFile(context.workspace.rootPath, args, context.signal);
            case 'host_replace_text':
                return replaceText(context.workspace.rootPath, args, context.signal);
            case 'host_shell':
                return await runShell(context.workspace.rootPath, args, context, this.artifacts);
            case 'host_read_artifact':
                return this.artifacts.read(context.sessionId, args);
            case 'host_workspace_status':
                return await this.history.status(context.workspace.id);
            case 'host_workspace_history':
                return this.history.listCommits(context.workspace.id, optionalInteger(args.limit, 'limit', 1) ?? 20);
            case 'host_workspace_diff': {
                const from = optionalCommitId(args.fromCommitId, 'fromCommitId');
                const to = optionalCommitId(args.toCommitId, 'toCommitId');
                if (from !== undefined || to !== undefined) {
                    return this.history.diff(context.workspace.id, from ?? null, to ?? null);
                }
                const commits = this.history.listCommits(context.workspace.id, 2);
                return this.history.diff(context.workspace.id, commits[1]?.id ?? null, commits[0]?.id ?? null);
            }
            default:
                throw new Error(`Unknown host tool: ${toolId}`);
        }
    }
}

function createDescriptors(): AgentToolDescriptor[] {
    const host = (input: Omit<AgentToolDescriptor, 'execution' | 'source'>): AgentToolDescriptor => ({
        ...input,
        execution: 'host',
        source: { kind: 'host', handler: input.id },
    });
    return [
        host({
            id: 'host_list_files',
            title: 'List workspace files',
            description: 'List files and directories without following symbolic links.',
            inputSchema: objectSchema({
                path: { type: 'string', description: 'Workspace-relative path; defaults to .' },
                maxDepth: { type: 'integer', minimum: 0 },
            }),
            riskLevel: 'low',
            approvalPolicy: 'never',
            mutatesWorkspace: false,
        }),
        host({
            id: 'host_read_file',
            title: 'Read workspace file',
            description: 'Read a UTF-8 text file, optionally limited to a 1-based line range.',
            inputSchema: objectSchema({
                path: { type: 'string' },
                startLine: { type: 'integer', minimum: 1 },
                endLine: { type: 'integer', minimum: 1 },
            }, ['path']),
            riskLevel: 'low',
            approvalPolicy: 'never',
            mutatesWorkspace: false,
        }),
        host({
            id: 'host_search_text',
            title: 'Search workspace text',
            description: 'Search text files for a literal string without following symbolic links.',
            inputSchema: objectSchema({
                query: { type: 'string' },
                path: { type: 'string', description: 'Workspace-relative path; defaults to .' },
                caseSensitive: { type: 'boolean' },
                maxDepth: { type: 'integer', minimum: 0 },
            }, ['query']),
            riskLevel: 'low',
            approvalPolicy: 'never',
            mutatesWorkspace: false,
        }),
        host({
            id: 'host_write_file',
            title: 'Write workspace file',
            description: 'Atomically create or replace a UTF-8 file. Parent directories are created safely.',
            inputSchema: objectSchema({ path: { type: 'string' }, content: { type: 'string' } }, ['path', 'content']),
            riskLevel: 'medium',
            approvalPolicy: 'on-mutation',
            mutatesWorkspace: true,
        }),
        host({
            id: 'host_replace_text',
            title: 'Replace workspace text',
            description: 'Atomically replace one or all exact text occurrences in a UTF-8 file.',
            inputSchema: objectSchema({
                path: { type: 'string' },
                find: { type: 'string' },
                replace: { type: 'string' },
                all: { type: 'boolean' },
                expectedMatches: { type: 'integer', minimum: 1 },
            }, ['path', 'find', 'replace']),
            riskLevel: 'medium',
            approvalPolicy: 'on-mutation',
            mutatesWorkspace: true,
        }),
        host({
            id: 'host_shell',
            title: 'Run workspace command',
            description: 'Run an unrestricted host shell command with the workspace as cwd. The workspace is checkpointed except .git and node_modules; those paths and effects outside it cannot be rolled back, so approval is always required.',
            inputSchema: objectSchema({
                command: { type: 'string' },
                timeoutMs: { type: 'integer', minimum: 1 },
            }, ['command']),
            riskLevel: 'high',
            approvalPolicy: 'always',
            mutatesWorkspace: true,
        }),
        host({
            id: 'host_read_artifact',
            title: 'Read complete tool output',
            description: 'Page through a persistent Authority tool-output artifact by byte offset. Omit length for the next 256 KiB page; dataBase64 preserves the exact bytes.',
            inputSchema: objectSchema({
                artifactId: { type: 'string' },
                startByte: { type: 'integer', minimum: 0 },
                length: { type: 'integer', minimum: 1 },
                verify: { type: 'boolean', description: 'Stream and verify the complete artifact SHA-256 before returning this page.' },
            }, ['artifactId']),
            riskLevel: 'low',
            approvalPolicy: 'never',
            mutatesWorkspace: false,
        }),
        host({
            id: 'host_workspace_status',
            title: 'Inspect workspace status',
            description: 'Compare tracked workspace files with the current Authority history head.',
            inputSchema: objectSchema({}),
            riskLevel: 'low',
            approvalPolicy: 'never',
            mutatesWorkspace: false,
        }),
        host({
            id: 'host_workspace_history',
            title: 'Inspect workspace history',
            description: 'List recent recoverable Authority workspace commits.',
            inputSchema: objectSchema({ limit: { type: 'integer', minimum: 1 } }),
            riskLevel: 'low',
            approvalPolicy: 'never',
            mutatesWorkspace: false,
        }),
        host({
            id: 'host_workspace_diff',
            title: 'Inspect workspace diff',
            description: 'Diff two Authority history commits; with no ids, diff the newest two commits.',
            inputSchema: objectSchema({
                fromCommitId: { type: ['string', 'null'] },
                toCommitId: { type: ['string', 'null'] },
            }),
            riskLevel: 'low',
            approvalPolicy: 'never',
            mutatesWorkspace: false,
        }),
    ];
}

function listFiles(root: string, args: Record<string, unknown>): unknown {
    const relativePath = optionalString(args.path, 'path', 2_000) ?? '.';
    const maxDepth = optionalInteger(args.maxDepth, 'maxDepth', 0) ?? 2;
    const start = resolveSafePath(root, relativePath, true);
    const entries: Array<{ path: string; kind: 'file' | 'directory' | 'symlink'; sizeBytes?: number }> = [];
    const visit = (absolutePath: string, logicalPath: string, depth: number): void => {
        const stat = fs.lstatSync(absolutePath);
        const kind = stat.isSymbolicLink() ? 'symlink' : stat.isDirectory() ? 'directory' : 'file';
        entries.push({ path: logicalPath, kind, ...(stat.isFile() ? { sizeBytes: stat.size } : {}) });
        if (kind !== 'directory' || depth >= maxDepth) {
            return;
        }
        assertContainedDirectory(root, absolutePath);
        const directory = fs.opendirSync(absolutePath);
        try {
            let entry: fs.Dirent | null;
            while ((entry = directory.readSync()) !== null) {
                visit(path.join(absolutePath, entry.name), joinLogical(logicalPath, entry.name), depth + 1);
            }
        } finally {
            directory.closeSync();
        }
    };
    visit(start.absolutePath, start.relativePath, 0);
    return { entries, truncated: false };
}

function readFile(root: string, args: Record<string, unknown>): unknown {
    const relativePath = requiredString(args.path, 'path', 2_000);
    const resolved = resolveSafePath(root, relativePath, false);
    const content = readTextFile(root, resolved.absolutePath, relativePath);
    if (content.includes('\0')) {
        throw new Error(`File is not UTF-8 text: ${relativePath}`);
    }
    const lines = content.split(/\r?\n/);
    const startLine = optionalInteger(args.startLine, 'startLine', 1, Math.max(1, lines.length)) ?? 1;
    const endLine = optionalInteger(args.endLine, 'endLine', startLine, Math.max(startLine, lines.length)) ?? lines.length;
    const selected = lines.slice(startLine - 1, endLine).join('\n');
    return {
        path: resolved.relativePath,
        startLine,
        endLine: Math.min(endLine, lines.length),
        totalLines: lines.length,
        content: selected,
        truncated: false,
    };
}

function searchText(root: string, args: Record<string, unknown>, signal: AbortSignal): unknown {
    const query = requiredString(args.query, 'query', undefined, false);
    if (!query) {
        throw new Error('query must not be empty');
    }
    const relativePath = optionalString(args.path, 'path', 2_000) ?? '.';
    const caseSensitive = optionalBoolean(args.caseSensitive, 'caseSensitive') ?? false;
    const maxDepth = optionalInteger(args.maxDepth, 'maxDepth', 0) ?? 8;
    const start = resolveSafePath(root, relativePath, true);
    const needle = caseSensitive ? query : query.toLocaleLowerCase();
    const results: Array<{ path: string; line: number; text: string }> = [];
    let filesScanned = 0;
    let bytesScanned = 0;
    const visit = (absolutePath: string, logicalPath: string, depth: number): void => {
        if (signal.aborted) throw abortError(signal);
        const stat = fs.lstatSync(absolutePath);
        if (stat.isSymbolicLink()) {
            return;
        }
        if (stat.isDirectory()) {
            if (depth >= maxDepth) {
                return;
            }
            assertContainedDirectory(root, absolutePath);
            const directory = fs.opendirSync(absolutePath);
            try {
                let entry: fs.Dirent | null;
                while ((entry = directory.readSync()) !== null) {
                    if (entry.isDirectory() && SKIPPED_SEARCH_DIRS.has(entry.name)) {
                        continue;
                    }
                    visit(path.join(absolutePath, entry.name), joinLogical(logicalPath, entry.name), depth + 1);
                }
            } finally {
                directory.closeSync();
            }
            return;
        }
        if (!stat.isFile()) {
            return;
        }
        filesScanned += 1;
        bytesScanned += stat.size;
        const content = readTextFile(root, absolutePath, logicalPath);
        if (content.includes('\0')) {
            return;
        }
        const lines = content.split(/\r?\n/);
        for (let index = 0; index < lines.length; index += 1) {
            const line = lines[index] ?? '';
            const haystack = caseSensitive ? line : line.toLocaleLowerCase();
            if (haystack.includes(needle)) {
                results.push({ path: logicalPath, line: index + 1, text: line });
            }
        }
    };
    visit(start.absolutePath, start.relativePath, 0);
    return { query, results, filesScanned, bytesScanned, truncated: false };
}

function writeFile(root: string, args: Record<string, unknown>, signal: AbortSignal): unknown {
    const relativePath = requiredString(args.path, 'path', 2_000);
    const content = requiredString(args.content, 'content', undefined, false);
    const resolved = resolveSafeWritePath(root, relativePath);
    if (signal.aborted) {
        throw abortError(signal);
    }
    // ponytail: Node has no portable dirfd-relative atomic rename; repeated realpath/lstat checks cover ordinary races.
    // Move writes into a native openat/handle layer if hostile same-account filesystem races enter the threat model.
    atomicWriteFile(resolved.absolutePath, content);
    return { path: resolved.relativePath, bytesWritten: Buffer.byteLength(content) };
}

function replaceText(root: string, args: Record<string, unknown>, signal: AbortSignal): unknown {
    const relativePath = requiredString(args.path, 'path', 2_000);
    const find = requiredString(args.find, 'find', undefined, false);
    const replacement = requiredString(args.replace, 'replace', undefined, false);
    if (!find) {
        throw new Error('find must not be empty');
    }
    const replaceAll = optionalBoolean(args.all, 'all') ?? false;
    const resolved = resolveSafePath(root, relativePath, false);
    const content = readTextFile(root, resolved.absolutePath, relativePath);
    const matches = countOccurrences(content, find);
    const expectedMatches = optionalInteger(args.expectedMatches, 'expectedMatches', 1, Number.MAX_SAFE_INTEGER);
    if (matches === 0 || (expectedMatches !== null && matches !== expectedMatches)) {
        throw new Error(expectedMatches === null
            ? `Text was not found in ${relativePath}`
            : `Expected ${expectedMatches} matches in ${relativePath}, found ${matches}`);
    }
    const next = replaceAll ? content.split(find).join(replacement) : content.replace(find, replacement);
    const writeTarget = resolveSafeWritePath(root, relativePath);
    if (readTextFile(root, writeTarget.absolutePath, relativePath) !== content) {
        throw new Error(`Workspace file changed before replacement: ${relativePath}`);
    }
    if (signal.aborted) {
        throw abortError(signal);
    }
    atomicWriteFile(writeTarget.absolutePath, next);
    return { path: resolved.relativePath, replacements: replaceAll ? matches : 1 };
}

async function runShell(
    root: string,
    args: Record<string, unknown>,
    context: AgentHostToolContext,
    artifacts: AgentToolArtifactStore,
): Promise<unknown> {
    assertWorkspaceRoot(root);
    const command = requiredString(args.command, 'command');
    const timeoutMs = optionalInteger(args.timeoutMs, 'timeoutMs', 1);
    if (context.signal.aborted) {
        throw abortError(context.signal);
    }
    const child = spawn(command, {
        cwd: root,
        env: sanitizedEnvironment(context.runId),
        shell: true,
        stdio: ['ignore', 'pipe', 'pipe'],
        windowsHide: true,
        detached: process.platform !== 'win32',
    });
    const stdout = artifacts.capture(context.sessionId, context.invocationId, 'stdout');
    const stderr = artifacts.capture(context.sessionId, context.invocationId, 'stderr');
    child.stdout?.on('data', chunk => stdout.push(Buffer.from(chunk)));
    child.stderr?.on('data', chunk => stderr.push(Buffer.from(chunk)));
    let timedOut = false;
    let aborted = false;
    let forceKillTimer: NodeJS.Timeout | null = null;
    const onAbort = () => {
        aborted = true;
        forceKillTimer ??= terminateProcessTree(child);
    };
    context.signal.addEventListener('abort', onAbort, { once: true });
    const timer = timeoutMs === null ? null : setTimeout(() => {
        timedOut = true;
        forceKillTimer ??= terminateProcessTree(child);
    }, timeoutMs);
    try {
        const exit = await new Promise<{ code: number | null; signal: NodeJS.Signals | null }>((resolve, reject) => {
            child.once('error', reject);
            child.once('close', (code, exitSignal) => resolve({ code, signal: exitSignal }));
        });
        if (aborted) {
            throw abortError(context.signal);
        }
        const stdoutResult = stdout.finish();
        const stderrResult = stderr.finish();
        return {
            command,
            exitCode: exit.code,
            signal: exit.signal,
            timedOut,
            stdout: stdoutResult.preview,
            stderr: stderrResult.preview,
            stdoutTruncated: stdoutResult.artifact !== undefined,
            stderrTruncated: stderrResult.artifact !== undefined,
            ...(stdoutResult.artifact ? { stdoutArtifact: stdoutResult.artifact } : {}),
            ...(stderrResult.artifact ? { stderrArtifact: stderrResult.artifact } : {}),
        };
    } catch (error) {
        stdout.discard();
        stderr.discard();
        throw error;
    } finally {
        if (timer) clearTimeout(timer);
        if (forceKillTimer) {
            clearTimeout(forceKillTimer);
        }
        context.signal.removeEventListener('abort', onAbort);
    }
}

interface AgentToolArtifactMetadata {
    format: 'authority-agent-tool-artifact/v1';
    artifactId: string;
    invocationId: string;
    stream: string;
    bytes: number;
    sha256: string;
    encoding: 'utf8';
    createdAt: string;
}

class AgentToolArtifactStore {
    constructor(private readonly root: string) {
        ensureDir(this.root);
    }

    capture(sessionId: string, invocationId: string, stream: string): AgentToolArtifactCapture {
        const sessionDir = this.sessionDir(sessionId);
        const existed = fs.existsSync(sessionDir);
        ensureDir(sessionDir);
        if (!existed) fsyncDirectory(this.root);
        return new AgentToolArtifactCapture(sessionDir, invocationId, stream);
    }

    read(sessionId: string, args: Record<string, unknown>): unknown {
        const artifactId = requiredString(args.artifactId, 'artifactId', 128);
        if (!/^[a-zA-Z0-9._-]+$/.test(artifactId)) throw new Error('artifactId is invalid');
        const sessionDir = this.sessionDir(sessionId);
        const metadataPath = path.join(sessionDir, `${artifactId}.json`);
        const contentPath = path.join(sessionDir, `${artifactId}.txt`);
        const metadata = JSON.parse(fs.readFileSync(metadataPath, 'utf8')) as AgentToolArtifactMetadata;
        if (metadata.format !== 'authority-agent-tool-artifact/v1'
            || metadata.artifactId !== artifactId
            || !Number.isSafeInteger(metadata.bytes)
            || metadata.bytes < 0
            || !/^[a-f0-9]{64}$/.test(metadata.sha256)
            || typeof metadata.stream !== 'string'
            || metadata.encoding !== 'utf8') {
            throw new Error(`Tool artifact metadata is invalid: ${artifactId}`);
        }
        const stats = fs.lstatSync(contentPath);
        if (!stats.isFile() || stats.isSymbolicLink() || stats.size !== metadata.bytes) {
            throw new Error(`Tool artifact content does not match its metadata: ${artifactId}`);
        }
        const startByte = optionalInteger(args.startByte, 'startByte', 0) ?? 0;
        const requestedLength = optionalInteger(args.length, 'length', 1);
        if (startByte > metadata.bytes) throw new Error(`startByte exceeds tool artifact size: ${metadata.bytes}`);
        const length = Math.min(requestedLength ?? ARTIFACT_DEFAULT_PAGE_BYTES, metadata.bytes - startByte);
        const verify = optionalBoolean(args.verify, 'verify') ?? false;
        if (verify && sha256File(contentPath) !== metadata.sha256) {
            throw new Error(`Tool artifact failed SHA-256 verification: ${artifactId}`);
        }
        const descriptor = fs.openSync(contentPath, 'r');
        try {
            const buffer = Buffer.alloc(length);
            const bytesRead = length > 0 ? fs.readSync(descriptor, buffer, 0, length, startByte) : 0;
            const endByte = startByte + bytesRead;
            return {
                artifactId,
                stream: metadata.stream,
                encoding: metadata.encoding,
                sha256: metadata.sha256,
                startByte,
                endByte,
                totalBytes: metadata.bytes,
                content: buffer.subarray(0, bytesRead).toString('utf8'),
                contentEncoding: 'utf8-lossy',
                dataBase64: buffer.subarray(0, bytesRead).toString('base64'),
                integrityVerified: verify,
                nextByte: endByte < metadata.bytes ? endByte : null,
            };
        } finally {
            fs.closeSync(descriptor);
        }
    }

    private sessionDir(sessionId: string): string {
        if (!/^[a-zA-Z0-9._-]+$/.test(sessionId)) throw new Error('Agent session id is invalid');
        return path.join(this.root, sessionId);
    }
}

class AgentToolArtifactCapture {
    private readonly artifactId = crypto.randomUUID();
    private readonly temporaryPath: string;
    private readonly finalPath: string;
    private readonly metadataPath: string;
    private readonly descriptor: number;
    private readonly digest = crypto.createHash('sha256');
    private readonly previewChunks: Buffer[] = [];
    private previewBytes = 0;
    private totalBytes = 0;
    private closed = false;
    private descriptorOpen = true;

    constructor(
        sessionDir: string,
        private readonly invocationId: string,
        private readonly stream: string,
    ) {
        this.temporaryPath = path.join(sessionDir, `${this.artifactId}.tmp`);
        this.finalPath = path.join(sessionDir, `${this.artifactId}.txt`);
        this.metadataPath = path.join(sessionDir, `${this.artifactId}.json`);
        this.descriptor = fs.openSync(this.temporaryPath, 'wx');
    }

    push(chunk: Buffer): void {
        if (this.closed) return;
        fs.writeSync(this.descriptor, chunk);
        this.digest.update(chunk);
        this.totalBytes += chunk.length;
        const remaining = SHELL_OUTPUT_PREVIEW_BYTES - this.previewBytes;
        if (remaining > 0) {
            const preview = chunk.subarray(0, remaining);
            this.previewChunks.push(preview);
            this.previewBytes += preview.length;
        }
    }

    finish(): { preview: string; artifact?: Omit<AgentToolArtifactMetadata, 'format' | 'invocationId' | 'createdAt'> } {
        if (this.closed) throw new Error('Tool artifact capture is already closed');
        try {
            try {
                fs.fsyncSync(this.descriptor);
            } finally {
                fs.closeSync(this.descriptor);
                this.descriptorOpen = false;
            }
            const preview = Buffer.concat(this.previewChunks).toString('utf8');
            if (this.totalBytes <= SHELL_OUTPUT_PREVIEW_BYTES) {
                fs.rmSync(this.temporaryPath, { force: true });
                this.closed = true;
                return { preview };
            }
            const metadata: AgentToolArtifactMetadata = {
                format: 'authority-agent-tool-artifact/v1',
                artifactId: this.artifactId,
                invocationId: this.invocationId,
                stream: this.stream,
                bytes: this.totalBytes,
                sha256: this.digest.digest('hex'),
                encoding: 'utf8',
                createdAt: new Date().toISOString(),
            };
            fs.renameSync(this.temporaryPath, this.finalPath);
            atomicWriteFile(this.metadataPath, `${JSON.stringify(metadata)}\n`);
            this.closed = true;
            return {
                preview: `${preview}\n\n[Complete output is available through host_read_artifact: ${this.artifactId}]`,
                artifact: {
                    artifactId: metadata.artifactId,
                    stream: metadata.stream,
                    bytes: metadata.bytes,
                    sha256: metadata.sha256,
                    encoding: metadata.encoding,
                },
            };
        } catch (error) {
            this.closed = true;
            fs.rmSync(this.temporaryPath, { force: true });
            fs.rmSync(this.finalPath, { force: true });
            fs.rmSync(this.metadataPath, { force: true });
            throw error;
        }
    }

    discard(): void {
        if (this.closed) return;
        this.closed = true;
        try {
            if (this.descriptorOpen) {
                fs.closeSync(this.descriptor);
                this.descriptorOpen = false;
            }
        } finally {
            fs.rmSync(this.temporaryPath, { force: true });
        }
    }
}

function sha256File(filePath: string): string {
    const digest = crypto.createHash('sha256');
    const descriptor = fs.openSync(filePath, 'r');
    const buffer = Buffer.allocUnsafe(64 * 1024);
    try {
        while (true) {
            const bytesRead = fs.readSync(descriptor, buffer, 0, buffer.length, null);
            if (bytesRead === 0) break;
            digest.update(buffer.subarray(0, bytesRead));
        }
        return digest.digest('hex');
    } finally {
        fs.closeSync(descriptor);
    }
}

function terminateProcessTree(child: ChildProcess): NodeJS.Timeout | null {
    if (!child.pid || child.exitCode !== null) {
        return null;
    }
    if (process.platform === 'win32') {
        const killer = spawn('taskkill', ['/pid', String(child.pid), '/T', '/F'], {
            stdio: 'ignore',
            windowsHide: true,
        });
        killer.once('error', () => child.kill());
        killer.once('close', code => {
            if (code !== 0) {
                child.kill();
            }
        });
        killer.unref();
        return null;
    }
    try {
        process.kill(-child.pid, 'SIGTERM');
    } catch {
        child.kill();
    }
    const timer = setTimeout(() => {
        try {
            process.kill(-child.pid!, 'SIGKILL');
        } catch {
            child.kill('SIGKILL');
        }
    }, 1_000);
    timer.unref();
    return timer;
}

function sanitizedEnvironment(runId: string): NodeJS.ProcessEnv {
    const allowed = process.platform === 'win32'
        ? new Set(['path', 'pathext', 'systemroot', 'comspec', 'temp', 'tmp', 'userprofile', 'localappdata', 'appdata', 'programdata'])
        : new Set(['PATH', 'HOME', 'USER', 'LOGNAME', 'SHELL', 'TMPDIR', 'LANG', 'LC_ALL', 'TERM']);
    const environment: NodeJS.ProcessEnv = {};
    for (const [name, value] of Object.entries(process.env)) {
        if (allowed.has(process.platform === 'win32' ? name.toLowerCase() : name)) {
            environment[name] = value;
        }
    }
    environment.DOA_AGENT_RUN_ID = runId;
    return environment;
}

function resolveSafeWritePath(root: string, input: string): { absolutePath: string; relativePath: string } {
    const relativePath = normalizeRelativePath(input, false);
    const segments = relativePath.split('/');
    const realRoot = assertWorkspaceRoot(root);
    let current = realRoot;
    for (const segment of segments.slice(0, -1)) {
        current = path.join(current, segment);
        try {
            fs.mkdirSync(current);
        } catch (error) {
            if (!isFsError(error, 'EEXIST')) {
                throw error;
            }
        }
        const stat = fs.lstatSync(current);
        if (!stat.isDirectory() || stat.isSymbolicLink()) {
            throw new Error(`Workspace path traverses a non-directory: ${relativePath}`);
        }
        assertContainedDirectory(realRoot, current);
    }
    const absolutePath = path.join(realRoot, ...segments);
    try {
        const stat = fs.lstatSync(absolutePath);
        if (stat.isSymbolicLink() || !stat.isFile()) {
            throw new Error(`Workspace write target is not a regular file: ${relativePath}`);
        }
        const realTarget = fs.realpathSync.native(absolutePath);
        if (!isPathInside(realRoot, realTarget) || !samePath(absolutePath, realTarget)) {
            throw new Error(`Workspace write target escapes its root: ${relativePath}`);
        }
    } catch (error) {
        if (!isFsError(error, 'ENOENT')) {
            throw error;
        }
    }
    return { absolutePath, relativePath };
}

function readTextFile(root: string, absolutePath: string, logicalPath: string): string {
    const before = fs.lstatSync(absolutePath);
    if (!before.isFile() || before.isSymbolicLink()) {
        throw new Error(`Not a readable text file: ${logicalPath}`);
    }
    const realRoot = assertWorkspaceRoot(root);
    const realTarget = fs.realpathSync.native(absolutePath);
    if (!isPathInside(realRoot, realTarget) || !samePath(absolutePath, realTarget)) {
        throw new Error(`Workspace file escapes its root: ${logicalPath}`);
    }
    const descriptor = fs.openSync(absolutePath, fs.constants.O_RDONLY | (fs.constants.O_NOFOLLOW ?? 0));
    try {
        const opened = fs.fstatSync(descriptor);
        assertSameFile(before, opened, logicalPath);
        const content = fs.readFileSync(descriptor, 'utf8');
        assertSameFile(opened, fs.fstatSync(descriptor), logicalPath);
        if (content.includes('\0')) {
            throw new Error(`File is not UTF-8 text: ${logicalPath}`);
        }
        return content;
    } finally {
        fs.closeSync(descriptor);
    }
}

function assertContainedDirectory(root: string, absolutePath: string): void {
    const stat = fs.lstatSync(absolutePath);
    const real = fs.realpathSync.native(absolutePath);
    if (!stat.isDirectory() || stat.isSymbolicLink() || !isPathInside(root, real) || !samePath(absolutePath, real)) {
        throw new Error(`Workspace directory escapes its root: ${absolutePath}`);
    }
}

function assertSameFile(before: fs.Stats, after: fs.Stats, logicalPath: string): void {
    if (
        !after.isFile()
        || before.dev !== after.dev
        || before.ino !== after.ino
        || before.size !== after.size
        || before.mtimeMs !== after.mtimeMs
    ) {
        throw new Error(`Workspace file changed while it was being read: ${logicalPath}`);
    }
}

function resolveSafePath(root: string, input: string, allowRoot: boolean): { absolutePath: string; relativePath: string } {
    const relativePath = normalizeRelativePath(input, allowRoot);
    const realRoot = assertWorkspaceRoot(root);
    const absolutePath = relativePath === '.' ? realRoot : path.join(realRoot, ...relativePath.split('/'));
    let current = realRoot;
    if (relativePath !== '.') {
        for (const segment of relativePath.split('/')) {
            current = path.join(current, segment);
            const stat = fs.lstatSync(current);
            if (stat.isSymbolicLink()) {
                throw new Error(`Workspace path traverses a symbolic link: ${relativePath}`);
            }
        }
    }
    const real = fs.realpathSync.native(absolutePath);
    if (!isPathInside(realRoot, real) || !samePath(absolutePath, real)) {
        throw new Error(`Workspace path escapes its root: ${relativePath}`);
    }
    return { absolutePath: real, relativePath };
}

function assertWorkspaceRoot(root: string): string {
    const absolute = path.resolve(root);
    const stat = fs.lstatSync(absolute);
    const real = fs.realpathSync.native(absolute);
    if (!stat.isDirectory() || stat.isSymbolicLink() || !samePath(absolute, real)) {
        throw new Error(`Workspace root is not a real directory: ${root}`);
    }
    return real;
}

function normalizeRelativePath(input: string, allowRoot: boolean): string {
    const raw = requiredString(input, 'path', 2_000).replace(/\\/g, '/');
    if (raw.includes('\0') || path.posix.isAbsolute(raw) || path.win32.isAbsolute(raw) || /^[a-zA-Z]:/.test(raw)) {
        throw new Error(`Invalid workspace path: ${input}`);
    }
    const normalized = path.posix.normalize(raw).replace(/^\.\//, '').replace(/\/$/, '');
    if (!normalized || normalized === '.') {
        if (allowRoot) {
            return '.';
        }
        throw new Error('Workspace file path must not be empty');
    }
    if (normalized === '..' || normalized.startsWith('../')) {
        throw new Error(`Workspace path escapes its root: ${input}`);
    }
    return normalized;
}

function objectInput(input: unknown): Record<string, unknown> {
    if (!input || typeof input !== 'object' || Array.isArray(input)) {
        throw new Error('Tool arguments must be a JSON object');
    }
    return input as Record<string, unknown>;
}

function requiredString(value: unknown, label: string, maxLength?: number, trim = true): string {
    if (typeof value !== 'string') {
        throw new Error(`${label} must be a string`);
    }
    const result = trim ? value.trim() : value;
    if ((trim && !result) || (maxLength !== undefined && result.length > maxLength)) {
        throw new Error(maxLength === undefined
            ? `${label} must ${trim ? 'not be empty' : 'be a string'}`
            : `${label} must contain between ${trim ? 1 : 0} and ${maxLength} characters`);
    }
    return result;
}

function optionalString(value: unknown, label: string, maxLength: number): string | null {
    return value === undefined || value === null ? null : requiredString(value, label, maxLength);
}

function optionalBoolean(value: unknown, label: string): boolean | null {
    if (value === undefined || value === null) {
        return null;
    }
    if (typeof value !== 'boolean') {
        throw new Error(`${label} must be a boolean`);
    }
    return value;
}

function optionalInteger(value: unknown, label: string, minimum: number, maximum = Number.MAX_SAFE_INTEGER): number | null {
    if (value === undefined || value === null) {
        return null;
    }
    if (!Number.isSafeInteger(value) || (value as number) < minimum || (value as number) > maximum) {
        throw new Error(`${label} must be an integer between ${minimum} and ${maximum}`);
    }
    return value as number;
}

function optionalCommitId(value: unknown, label: string): string | null | undefined {
    if (value === undefined) {
        return undefined;
    }
    if (value === null) {
        return null;
    }
    const result = requiredString(value, label, 64);
    if (!/^[a-f0-9]{64}$/.test(result)) {
        throw new Error(`${label} must be a SHA-256 commit id or null`);
    }
    return result;
}

function countOccurrences(content: string, find: string): number {
    let count = 0;
    let offset = 0;
    while ((offset = content.indexOf(find, offset)) !== -1) {
        count += 1;
        offset += find.length;
    }
    return count;
}

function joinLogical(parent: string, child: string): string {
    return parent === '.' ? child : `${parent}/${child}`;
}

function samePath(left: string, right: string): boolean {
    return process.platform === 'win32'
        ? path.resolve(left).toLowerCase() === path.resolve(right).toLowerCase()
        : path.resolve(left) === path.resolve(right);
}

function isFsError(error: unknown, code: string): error is NodeJS.ErrnoException {
    return error instanceof Error && (error as NodeJS.ErrnoException).code === code;
}

function abortError(signal: AbortSignal): Error {
    return signal.reason instanceof Error ? signal.reason : Object.assign(new Error('Agent run cancelled'), { name: 'AbortError' });
}

function objectSchema(properties: Record<string, unknown>, required: string[] = []): Record<string, unknown> {
    return { type: 'object', properties, required, additionalProperties: false };
}

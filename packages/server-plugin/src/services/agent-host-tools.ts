import { spawn, type ChildProcess } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import type { AgentToolDescriptor, AgentWorkspaceRecord } from '@stdo/shared-types';
import { atomicWriteFile, isPathInside } from '../utils.js';
import { WorkspaceHistoryService } from './workspace-history-service.js';

const MAX_FILE_BYTES = 2 * 1024 * 1024;
const MAX_TOOL_TEXT = 256 * 1024;
const MAX_LIST_ENTRIES = 1_000;
const MAX_SEARCH_FILES = 5_000;
const MAX_SEARCH_RESULTS = 200;
const MAX_SEARCH_BYTES = 32 * 1024 * 1024;
const MAX_SEARCH_MS = 2_000;
const SKIPPED_SEARCH_DIRS = new Set(['.git', 'node_modules']);

export interface AgentHostToolContext {
    workspace: AgentWorkspaceRecord;
    runId: string;
    signal: AbortSignal;
}

export class AgentHostToolService {
    private readonly descriptors = createDescriptors();

    constructor(private readonly history: WorkspaceHistoryService) {}

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
                return searchText(context.workspace.rootPath, args);
            case 'host_write_file':
                return writeFile(context.workspace.rootPath, args, context.signal);
            case 'host_replace_text':
                return replaceText(context.workspace.rootPath, args, context.signal);
            case 'host_shell':
                return await runShell(context.workspace.rootPath, args, context.runId, context.signal);
            case 'host_workspace_status':
                return await this.history.status(context.workspace.id);
            case 'host_workspace_history':
                return this.history.listCommits(context.workspace.id, optionalInteger(args.limit, 'limit', 1, 100) ?? 20);
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
                maxDepth: { type: 'integer', minimum: 0, maximum: 10 },
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
                maxDepth: { type: 'integer', minimum: 0, maximum: 20 },
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
                timeoutMs: { type: 'integer', minimum: 1_000, maximum: 600_000 },
            }, ['command']),
            riskLevel: 'high',
            approvalPolicy: 'always',
            mutatesWorkspace: true,
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
            inputSchema: objectSchema({ limit: { type: 'integer', minimum: 1, maximum: 100 } }),
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
    const maxDepth = optionalInteger(args.maxDepth, 'maxDepth', 0, 10) ?? 2;
    const start = resolveSafePath(root, relativePath, true);
    const entries: Array<{ path: string; kind: 'file' | 'directory' | 'symlink'; sizeBytes?: number }> = [];
    let outputBytes = 0;
    let truncated = false;
    const visit = (absolutePath: string, logicalPath: string, depth: number): void => {
        if (entries.length >= MAX_LIST_ENTRIES) {
            truncated = true;
            return;
        }
        const stat = fs.lstatSync(absolutePath);
        const kind = stat.isSymbolicLink() ? 'symlink' : stat.isDirectory() ? 'directory' : 'file';
        outputBytes += Buffer.byteLength(logicalPath) + 64;
        if (outputBytes > MAX_TOOL_TEXT) {
            truncated = true;
            return;
        }
        entries.push({ path: logicalPath, kind, ...(stat.isFile() ? { sizeBytes: stat.size } : {}) });
        if (kind !== 'directory' || depth >= maxDepth) {
            return;
        }
        assertContainedDirectory(root, absolutePath);
        const directory = fs.opendirSync(absolutePath);
        try {
            let entry: fs.Dirent | null;
            while (!truncated && (entry = directory.readSync()) !== null) {
                visit(path.join(absolutePath, entry.name), joinLogical(logicalPath, entry.name), depth + 1);
            }
        } finally {
            directory.closeSync();
        }
    };
    visit(start.absolutePath, start.relativePath, 0);
    return { entries, truncated };
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
        content: selected.slice(0, MAX_TOOL_TEXT),
        truncated: selected.length > MAX_TOOL_TEXT,
    };
}

function searchText(root: string, args: Record<string, unknown>): unknown {
    const query = requiredString(args.query, 'query', 500, false);
    if (!query) {
        throw new Error('query must not be empty');
    }
    const relativePath = optionalString(args.path, 'path', 2_000) ?? '.';
    const caseSensitive = optionalBoolean(args.caseSensitive, 'caseSensitive') ?? false;
    const maxDepth = optionalInteger(args.maxDepth, 'maxDepth', 0, 20) ?? 8;
    const start = resolveSafePath(root, relativePath, true);
    const needle = caseSensitive ? query : query.toLocaleLowerCase();
    const results: Array<{ path: string; line: number; text: string }> = [];
    let filesScanned = 0;
    let bytesScanned = 0;
    let truncated = false;
    const deadline = Date.now() + MAX_SEARCH_MS;
    const visit = (absolutePath: string, logicalPath: string, depth: number): void => {
        if (truncated || Date.now() >= deadline) {
            truncated = true;
            return;
        }
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
                while (!truncated && (entry = directory.readSync()) !== null) {
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
        if (!stat.isFile() || stat.size > MAX_FILE_BYTES) {
            return;
        }
        filesScanned += 1;
        bytesScanned += stat.size;
        if (filesScanned > MAX_SEARCH_FILES || bytesScanned > MAX_SEARCH_BYTES) {
            truncated = true;
            return;
        }
        const content = readTextFile(root, absolutePath, logicalPath);
        if (content.includes('\0')) {
            return;
        }
        const lines = content.split(/\r?\n/);
        for (let index = 0; index < lines.length; index += 1) {
            const line = lines[index] ?? '';
            const haystack = caseSensitive ? line : line.toLocaleLowerCase();
            if (haystack.includes(needle)) {
                results.push({ path: logicalPath, line: index + 1, text: line.slice(0, 500) });
                if (results.length >= MAX_SEARCH_RESULTS) {
                    truncated = true;
                    return;
                }
            }
        }
    };
    visit(start.absolutePath, start.relativePath, 0);
    return { query, results, filesScanned: Math.min(filesScanned, MAX_SEARCH_FILES), bytesScanned: Math.min(bytesScanned, MAX_SEARCH_BYTES), truncated };
}

function writeFile(root: string, args: Record<string, unknown>, signal: AbortSignal): unknown {
    const relativePath = requiredString(args.path, 'path', 2_000);
    const content = requiredString(args.content, 'content', MAX_FILE_BYTES, false);
    if (Buffer.byteLength(content) > MAX_FILE_BYTES) {
        throw new Error(`content exceeds the ${MAX_FILE_BYTES} byte file limit`);
    }
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
    const find = requiredString(args.find, 'find', MAX_FILE_BYTES, false);
    const replacement = requiredString(args.replace, 'replace', MAX_FILE_BYTES, false);
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
    if (Buffer.byteLength(next) > MAX_FILE_BYTES) {
        throw new Error(`Replacement exceeds the ${MAX_FILE_BYTES} byte file limit`);
    }
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
    runId: string,
    signal: AbortSignal,
): Promise<unknown> {
    assertWorkspaceRoot(root);
    const command = requiredString(args.command, 'command', 32_000);
    const timeoutMs = optionalInteger(args.timeoutMs, 'timeoutMs', 1_000, 600_000) ?? 120_000;
    if (signal.aborted) {
        throw abortError(signal);
    }
    const child = spawn(command, {
        cwd: root,
        env: sanitizedEnvironment(runId),
        shell: true,
        stdio: ['ignore', 'pipe', 'pipe'],
        windowsHide: true,
        detached: process.platform !== 'win32',
    });
    const stdout = new CappedOutput(MAX_TOOL_TEXT);
    const stderr = new CappedOutput(MAX_TOOL_TEXT);
    child.stdout?.on('data', chunk => stdout.push(Buffer.from(chunk)));
    child.stderr?.on('data', chunk => stderr.push(Buffer.from(chunk)));
    let timedOut = false;
    let aborted = false;
    let forceKillTimer: NodeJS.Timeout | null = null;
    const onAbort = () => {
        aborted = true;
        forceKillTimer ??= terminateProcessTree(child);
    };
    signal.addEventListener('abort', onAbort, { once: true });
    const timer = setTimeout(() => {
        timedOut = true;
        forceKillTimer ??= terminateProcessTree(child);
    }, timeoutMs);
    try {
        const exit = await new Promise<{ code: number | null; signal: NodeJS.Signals | null }>((resolve, reject) => {
            child.once('error', reject);
            child.once('close', (code, exitSignal) => resolve({ code, signal: exitSignal }));
        });
        if (aborted) {
            throw abortError(signal);
        }
        return {
            command,
            exitCode: exit.code,
            signal: exit.signal,
            timedOut,
            stdout: stdout.text(),
            stderr: stderr.text(),
            stdoutTruncated: stdout.truncated,
            stderrTruncated: stderr.truncated,
        };
    } finally {
        clearTimeout(timer);
        if (forceKillTimer) {
            clearTimeout(forceKillTimer);
        }
        signal.removeEventListener('abort', onAbort);
    }
}

class CappedOutput {
    private readonly chunks: Buffer[] = [];
    private length = 0;
    truncated = false;

    constructor(private readonly limit: number) {}

    push(chunk: Buffer): void {
        const remaining = this.limit - this.length;
        if (remaining > 0) {
            const kept = chunk.subarray(0, remaining);
            this.chunks.push(kept);
            this.length += kept.length;
        }
        if (chunk.length > remaining) {
            this.truncated = true;
        }
    }

    text(): string {
        return Buffer.concat(this.chunks).toString('utf8');
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
    if (!before.isFile() || before.isSymbolicLink() || before.size > MAX_FILE_BYTES) {
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

function requiredString(value: unknown, label: string, maxLength: number, trim = true): string {
    if (typeof value !== 'string') {
        throw new Error(`${label} must be a string`);
    }
    const result = trim ? value.trim() : value;
    if ((trim && !result) || result.length > maxLength) {
        throw new Error(`${label} must contain between ${trim ? 1 : 0} and ${maxLength} characters`);
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

function optionalInteger(value: unknown, label: string, minimum: number, maximum: number): number | null {
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

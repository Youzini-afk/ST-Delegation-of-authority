import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type {
    AgentWorkspaceRecord,
    AgentWorkspaceRegisterRequest,
    WorkspaceCheckpointRequest,
    WorkspaceCheckpointResponse,
    WorkspaceCommitActor,
    WorkspaceCommitObject,
    WorkspaceDiffEntry,
    WorkspaceDiffResponse,
    WorkspaceObjectId,
    WorkspaceRefRecord,
    WorkspaceRollbackRequest,
    WorkspaceRollbackResponse,
    WorkspaceStatusResponse,
    WorkspaceTreeEntry,
    WorkspaceTreeEntryKind,
    WorkspaceTreeObject,
} from '@stdo/shared-types';
import { atomicWriteFile, atomicWriteJson, AuthorityServiceError, ensureDir, isPathInside } from '../utils.js';

const STORE_FORMAT = 'authority-workspaces/v1';
const REF_JOURNAL_FORMAT = 'authority-workspace-ref-journal/v1';
const ROLLBACK_JOURNAL_FORMAT = 'authority-workspace-rollback-journal/v1';
const COMPLETED_ROLLBACK_FORMAT = 'authority-workspace-rollback-completed/v1';
const SYMLINK_FORMAT = 'authority-workspace-symlink/v1';
const OID_PATTERN = /^[a-f0-9]{64}$/;
const SAFE_NAME_PATTERN = /^[a-zA-Z0-9._-]+$/;
const DEFAULT_REF = 'main';
const DEFAULT_LOCK_TIMEOUT_MS = 15_000;
const DEFAULT_STALE_LOCK_MS = 30 * 60_000;
const EXCLUDED_SEGMENTS = new Set(['.git', 'node_modules']);

interface WorkspaceRegistry {
    format: typeof STORE_FORMAT;
    workspaces: AgentWorkspaceRecord[];
}

interface RefJournal {
    format: typeof REF_JOURNAL_FORMAT;
    workspaceId: string;
    expectedGeneration: number;
    next: WorkspaceRefRecord;
    createdAt: string;
}

interface RollbackJournal {
    format: typeof ROLLBACK_JOURNAL_FORMAT;
    workspaceId: string;
    operationId: string;
    targetCommitId: WorkspaceObjectId;
    previousHead: WorkspaceObjectId | null;
    previousGeneration: number;
    safetyCommitId: WorkspaceObjectId;
    safetyGeneration: number;
    rollbackCommitId: WorkspaceObjectId;
    trackedPaths: string[];
    changedPaths: number;
    startedAt: string;
}

interface CompletedRollback {
    format: typeof COMPLETED_ROLLBACK_FORMAT;
    workspaceId: string;
    operationId: string;
    targetCommitId: WorkspaceObjectId;
    rollbackCommitId: WorkspaceObjectId;
    changedPaths: number;
    warnings: string[];
    completedAt: string;
}

interface LockRecord {
    token: string;
    pid: number;
    hostname: string;
    createdAt: number;
}

interface SymlinkObject {
    format: typeof SYMLINK_FORMAT;
    target: string;
}

interface ObjectStats {
    storedBytes: number;
    reusedBytes: number;
}

interface TreeNode {
    kind: 'tree';
    mode: number;
    oid?: WorkspaceObjectId;
    synthetic?: boolean;
    children: Map<string, SnapshotNode>;
}

interface LeafNode {
    kind: 'blob' | 'symlink';
    mode: number;
    oid: WorkspaceObjectId;
    sizeBytes?: number;
}

type SnapshotNode = TreeNode | LeafNode;

export interface WorkspaceHistoryServiceOptions {
    now?: () => string;
    lockTimeoutMs?: number;
    staleLockMs?: number;
}

export function resolveWorkspaceHistoryStore(dataRoot: string): string {
    return path.resolve(dataRoot, '_authority-global', 'authority', 'state', 'agent-workspaces');
}

export class WorkspaceHistoryService {
    private readonly now: () => string;
    private readonly lockTimeoutMs: number;
    private readonly staleLockMs: number;

    constructor(
        public readonly storeDir: string,
        options: WorkspaceHistoryServiceOptions = {},
    ) {
        this.storeDir = path.resolve(storeDir);
        this.now = options.now ?? (() => new Date().toISOString());
        this.lockTimeoutMs = options.lockTimeoutMs ?? DEFAULT_LOCK_TIMEOUT_MS;
        this.staleLockMs = options.staleLockMs ?? DEFAULT_STALE_LOCK_MS;
    }

    async registerWorkspace(input: AgentWorkspaceRegisterRequest): Promise<AgentWorkspaceRecord> {
        return await this.withLock('registry', async () => {
            if (typeof input.rootPath !== 'string' || !input.rootPath.trim()) {
                throw validationError('Workspace rootPath is required');
            }
            if (input.id !== undefined && typeof input.id !== 'string') {
                throw validationError('Workspace id must be a string');
            }
            if (input.displayName !== undefined && typeof input.displayName !== 'string') {
                throw validationError('Workspace displayName must be a string');
            }
            if (input.defaultRef !== undefined && typeof input.defaultRef !== 'string') {
                throw validationError('Workspace defaultRef must be a string');
            }
            const rootPath = this.resolveWorkspaceRoot(input.rootPath);
            const registry = this.readRegistry();
            const existingByRoot = registry.workspaces.find(workspace => samePath(workspace.rootPath, rootPath));
            if (existingByRoot) {
                return this.withCurrentHead(existingByRoot);
            }

            const id = input.id?.trim() || crypto.randomUUID();
            if (id.length > 128 || !isSafeName(id)) {
                throw validationError('Workspace id contains invalid characters');
            }
            if (registry.workspaces.some(workspace => workspace.id === id)) {
                throw workspaceConflict(`Workspace already exists: ${id}`);
            }

            const defaultRef = input.defaultRef?.trim() || DEFAULT_REF;
            if (defaultRef.length > 128 || !isSafeName(defaultRef)) {
                throw validationError('Workspace ref contains invalid characters');
            }
            const timestamp = this.now();
            const workspace: AgentWorkspaceRecord = {
                id,
                displayName: input.displayName?.trim() || path.basename(rootPath),
                rootPath,
                defaultRef,
                headCommitId: null,
                createdAt: timestamp,
                updatedAt: timestamp,
            };
            this.writeRef({
                format: 'authority-workspace-ref/v1',
                workspaceId: id,
                name: defaultRef,
                head: null,
                generation: 0,
                updatedAt: timestamp,
            });
            registry.workspaces.push(workspace);
            registry.workspaces.sort((left, right) => left.id.localeCompare(right.id));
            this.writeRegistry(registry);
            return workspace;
        });
    }

    listWorkspaces(): AgentWorkspaceRecord[] {
        return this.readRegistry().workspaces.map(workspace => this.withCurrentHead(workspace));
    }

    getWorkspace(workspaceId: string): AgentWorkspaceRecord {
        return this.withCurrentHead(this.getStoredWorkspace(workspaceId));
    }

    async checkpoint(
        workspaceId: string,
        request: WorkspaceCheckpointRequest,
        actor: WorkspaceCommitActor,
    ): Promise<WorkspaceCheckpointResponse> {
        return await this.withLock(`workspace-${workspaceId}`, async () => {
            this.assertNoPendingRollback(workspaceId);
            const workspace = this.getStoredWorkspace(workspaceId);
            this.recoverRefJournal(workspace);
            return this.checkpointLocked(workspace, request, actor);
        });
    }

    listCommits(workspaceId: string, limit = 100): WorkspaceCommitObject[] {
        if (!Number.isSafeInteger(limit) || limit < 1 || limit > 500) {
            throw validationError('Workspace commit limit must be an integer between 1 and 500');
        }
        const workspace = this.getStoredWorkspace(workspaceId);
        const ref = this.readRef(workspace);
        const commits: WorkspaceCommitObject[] = [];
        let nextId = ref.head;
        while (nextId && commits.length < limit) {
            const commit = this.readCommit(nextId, workspace.id);
            commits.push(commit);
            nextId = commit.parents[0] ?? null;
        }
        return commits;
    }

    diff(workspaceId: string, fromCommitId: string | null, toCommitId: string | null): WorkspaceDiffResponse {
        const workspace = this.getStoredWorkspace(workspaceId);
        if ((fromCommitId !== null && !OID_PATTERN.test(fromCommitId)) || (toCommitId !== null && !OID_PATTERN.test(toCommitId))) {
            throw validationError('Workspace diff commit ids must be SHA-256 commit ids');
        }
        const before = fromCommitId ? this.loadCommitTree(this.readCommit(fromCommitId, workspace.id)) : emptyTree();
        const after = toCommitId ? this.loadCommitTree(this.readCommit(toCommitId, workspace.id)) : emptyTree();
        return {
            workspaceId,
            fromCommitId,
            toCommitId,
            entries: diffNodes(before, after),
        };
    }

    async status(workspaceId: string): Promise<WorkspaceStatusResponse> {
        return await this.withLock(`workspace-${workspaceId}`, async () => {
            const workspace = this.getStoredWorkspace(workspaceId);
            this.recoverRefJournal(workspace);
            const ref = this.readRef(workspace);
            const head = ref.head ? this.readCommit(ref.head, workspace.id) : null;
            const trackedPaths = head ? trackedPathsFromCommit(head) : [];
            const expected = head ? scopeTree(this.loadCommitTree(head), trackedPaths) : emptyTree();
            const actual = this.captureTrackedWorkspace(workspace, trackedPaths, createObjectStats());
            const changes = diffNodes(expected, actual);
            const pending = this.readRollbackJournal(workspace.id);
            return {
                workspace: this.withCurrentHead(workspace),
                dirty: changes.length > 0,
                changes,
                pendingRollback: pending ? {
                    operationId: pending.operationId,
                    targetCommitId: pending.targetCommitId,
                    rollbackCommitId: pending.rollbackCommitId,
                    startedAt: pending.startedAt,
                } : null,
            };
        });
    }

    async rollback(
        workspaceId: string,
        request: WorkspaceRollbackRequest,
        actor: WorkspaceCommitActor,
    ): Promise<WorkspaceRollbackResponse> {
        return await this.withLock(`workspace-${workspaceId}`, async () => {
            if (typeof request.targetCommitId !== 'string' || !OID_PATTERN.test(request.targetCommitId)) {
                throw validationError('Rollback targetCommitId must be a SHA-256 commit id');
            }
            if (request.force !== undefined && typeof request.force !== 'boolean') {
                throw validationError('Rollback force must be a boolean');
            }
            if (request.message !== undefined && typeof request.message !== 'string') {
                throw validationError('Rollback message must be a string');
            }
            if (request.operationId !== undefined && typeof request.operationId !== 'string') {
                throw validationError('Rollback operationId must be a string');
            }
            const operationId = request.operationId || crypto.randomUUID();
            if (operationId.length > 128 || !isSafeName(operationId)) {
                throw validationError('Rollback operationId contains invalid characters');
            }
            const workspace = this.getStoredWorkspace(workspaceId);
            this.recoverRefJournal(workspace);
            const completed = this.readCompletedRollback(workspace.id, operationId);
            if (completed) {
                if (completed.targetCommitId !== request.targetCommitId) {
                    throw workspaceConflict(`Rollback operation id was already used: ${operationId}`);
                }
                this.removeMatchingRollbackJournal(workspace.id, operationId);
                return this.completedRollbackResponse(workspace, completed);
            }
            const pending = this.readRollbackJournal(workspace.id);
            if (pending) {
                if (pending.operationId !== operationId || pending.targetCommitId !== request.targetCommitId) {
                    throw workspaceConflict(`Workspace rollback requires recovery: ${workspace.id}`);
                }
                return this.resumeRollbackLocked(workspace, pending);
            }

            const ref = this.readRef(workspace);
            const target = this.readCommit(request.targetCommitId, workspace.id);
            const head = ref.head ? this.readCommit(ref.head, workspace.id) : null;
            const headPaths = head ? trackedPathsFromCommit(head) : [];
            const restorePaths = trackedPathsFromCommit(target);
            const safetyPaths = minimizePaths([
                ...headPaths,
                ...restorePaths,
            ]);
            const expected = head ? scopeTree(this.loadCommitTree(head), headPaths) : emptyTree();
            const actualHead = this.captureTrackedWorkspace(workspace, headPaths, createObjectStats());
            const targetTree = scopeTree(this.loadCommitTree(target), restorePaths);
            const currentTree = this.captureTrackedWorkspace(workspace, restorePaths, createObjectStats());
            const dirtyChanges = mergeDiffEntries(
                diffNodes(expected, actualHead),
                diffNodes(currentTree, targetTree).filter(change => !isTrackedPath(change.path, headPaths)),
            );
            if (dirtyChanges.length > 0 && request.force !== true) {
                throw workspaceConflict('Workspace differs from its current history head', dirtyChanges);
            }

            const stats = createObjectStats();
            const actual = this.captureTrackedWorkspace(workspace, safetyPaths, stats);
            const safetyCommit = this.createCommit({
                workspace,
                tree: this.finalizeTree(actual, stats),
                parents: ref.head ? [ref.head] : [],
                message: `Before rollback to ${target.id.slice(0, 12)}`,
                actor,
                metadata: { authorityTrackedPaths: safetyPaths, rollbackSafetyFor: target.id, operationId },
            });
            this.writeCommit(safetyCommit);
            const rollbackCommit = this.createCommit({
                workspace,
                tree: target.tree,
                parents: [safetyCommit.id],
                message: request.message?.trim() || `Rollback to ${target.id.slice(0, 12)}`,
                actor,
                metadata: { authorityTrackedPaths: restorePaths, rollbackOf: target.id, operationId },
            });
            this.writeCommit(rollbackCommit);
            const journal: RollbackJournal = {
                format: ROLLBACK_JOURNAL_FORMAT,
                workspaceId: workspace.id,
                operationId,
                targetCommitId: target.id,
                previousHead: ref.head,
                previousGeneration: ref.generation,
                safetyCommitId: safetyCommit.id,
                safetyGeneration: ref.generation + 1,
                rollbackCommitId: rollbackCommit.id,
                trackedPaths: safetyPaths,
                changedPaths: diffNodes(currentTree, targetTree).length,
                startedAt: this.now(),
            };
            atomicWriteJson(this.rollbackJournalPath(workspace.id), journal);
            return this.resumeRollbackLocked(workspace, journal);
        });
    }

    async resumeRollback(workspaceId: string): Promise<WorkspaceRollbackResponse> {
        return await this.withLock(`workspace-${workspaceId}`, async () => {
            const workspace = this.getStoredWorkspace(workspaceId);
            this.recoverRefJournal(workspace);
            const journal = this.readRollbackJournal(workspace.id);
            if (!journal) {
                throw validationError(`Workspace has no pending rollback: ${workspace.id}`);
            }
            const completed = this.readCompletedRollback(workspace.id, journal.operationId);
            if (completed) {
                this.removeRollbackJournal(workspace.id);
                return this.completedRollbackResponse(workspace, completed);
            }
            return this.resumeRollbackLocked(workspace, journal);
        });
    }

    private resumeRollbackLocked(
        workspace: AgentWorkspaceRecord,
        initialJournal: RollbackJournal,
    ): WorkspaceRollbackResponse {
        let journal = initialJournal;
        const target = this.readCommit(journal.targetCommitId, workspace.id);
        let rollbackCommit = this.readCommit(journal.rollbackCommitId, workspace.id);
        let ref = this.readRef(workspace);

        if (ref.head === rollbackCommit.id && ref.generation === journal.safetyGeneration + 1) {
            return this.finishRollback(workspace, journal, rollbackCommit, []);
        }
        if (ref.head === journal.previousHead && ref.generation === journal.previousGeneration) {
            ref = this.publishRef(workspace, ref, journal.safetyCommitId);
        } else if (ref.head !== journal.safetyCommitId || ref.generation !== journal.safetyGeneration) {
            throw workspaceConflict('Pending rollback no longer matches the workspace head');
        }

        let stable = false;
        for (let attempt = 0; attempt < 3; attempt += 1) {
            const safetyCommit = this.readCommit(journal.safetyCommitId, workspace.id);
            const expectedSafety = scopeTree(this.loadCommitTree(safetyCommit), journal.trackedPaths);
            const actualSafety = this.captureTrackedWorkspace(workspace, journal.trackedPaths, createObjectStats());
            if (diffNodes(expectedSafety, actualSafety).length === 0) {
                stable = true;
                break;
            }
            if (attempt === 2) {
                break;
            }
            journal = this.restageRollbackSafety(workspace, journal, ref, actualSafety);
            rollbackCommit = this.readCommit(journal.rollbackCommitId, workspace.id);
            ref = this.publishRef(workspace, ref, journal.safetyCommitId);
        }
        if (!stable) {
            throw workspaceConflict('Workspace kept changing while preparing rollback; retry recovery when writes are idle');
        }

        const restorePaths = trackedPathsFromCommit(target);
        const currentTree = this.captureTrackedWorkspace(workspace, restorePaths, createObjectStats());
        const targetTree = scopeTree(this.loadCommitTree(target), restorePaths);
        const warnings = this.applyTree(workspace, currentTree, targetTree);
        this.publishRef(workspace, ref, rollbackCommit.id);
        return this.finishRollback(workspace, journal, rollbackCommit, warnings);
    }

    private restageRollbackSafety(
        workspace: AgentWorkspaceRecord,
        journal: RollbackJournal,
        ref: WorkspaceRefRecord,
        actual: TreeNode,
    ): RollbackJournal {
        const previousSafety = this.readCommit(journal.safetyCommitId, workspace.id);
        const previousRollback = this.readCommit(journal.rollbackCommitId, workspace.id);
        const stats = createObjectStats();
        const safetyCommit = this.createCommit({
            workspace,
            tree: this.finalizeTree(actual, stats),
            parents: ref.head ? [ref.head] : [],
            message: previousSafety.message,
            actor: previousSafety.actor,
            ...(previousSafety.runId ? { runId: previousSafety.runId } : {}),
            ...(previousSafety.toolCallId ? { toolCallId: previousSafety.toolCallId } : {}),
            ...(previousSafety.metadata ? { metadata: previousSafety.metadata } : {}),
        });
        this.writeCommit(safetyCommit);
        const rollbackCommit = this.createCommit({
            workspace,
            tree: previousRollback.tree,
            parents: [safetyCommit.id],
            message: previousRollback.message,
            actor: previousRollback.actor,
            ...(previousRollback.runId ? { runId: previousRollback.runId } : {}),
            ...(previousRollback.toolCallId ? { toolCallId: previousRollback.toolCallId } : {}),
            ...(previousRollback.metadata ? { metadata: previousRollback.metadata } : {}),
        });
        this.writeCommit(rollbackCommit);
        const next: RollbackJournal = {
            ...journal,
            previousHead: ref.head,
            previousGeneration: ref.generation,
            safetyCommitId: safetyCommit.id,
            safetyGeneration: ref.generation + 1,
            rollbackCommitId: rollbackCommit.id,
        };
        atomicWriteJson(this.rollbackJournalPath(workspace.id), next);
        return next;
    }

    private finishRollback(
        workspace: AgentWorkspaceRecord,
        journal: RollbackJournal,
        rollbackCommit: WorkspaceCommitObject,
        warnings: string[],
    ): WorkspaceRollbackResponse {
        const completed: CompletedRollback = {
            format: COMPLETED_ROLLBACK_FORMAT,
            workspaceId: workspace.id,
            operationId: journal.operationId,
            targetCommitId: journal.targetCommitId,
            rollbackCommitId: rollbackCommit.id,
            changedPaths: journal.changedPaths,
            warnings,
            completedAt: this.now(),
        };
        this.writeCompletedRollback(completed);
        this.removeRollbackJournal(workspace.id);
        return this.completedRollbackResponse(workspace, completed);
    }

    private completedRollbackResponse(
        workspace: AgentWorkspaceRecord,
        completed: CompletedRollback,
    ): WorkspaceRollbackResponse {
        return {
            operationId: completed.operationId,
            workspace: this.withCurrentHead(workspace),
            restoredCommitId: completed.targetCommitId,
            rollbackCommit: this.readCommit(completed.rollbackCommitId, workspace.id),
            changedPaths: completed.changedPaths,
            warnings: completed.warnings,
        };
    }

    private checkpointLocked(
        workspace: AgentWorkspaceRecord,
        request: WorkspaceCheckpointRequest,
        actor: WorkspaceCommitActor,
    ): WorkspaceCheckpointResponse {
        if (typeof request.message !== 'string') {
            throw validationError('Checkpoint message is required');
        }
        if (request.paths !== undefined && (!Array.isArray(request.paths) || request.paths.some(entry => typeof entry !== 'string'))) {
            throw validationError('Checkpoint paths must be an array of strings');
        }
        if ((request.paths?.length ?? 0) > 1_000) {
            throw validationError('Checkpoint paths exceed the 1000 item limit');
        }
        if (request.metadata !== undefined && (!request.metadata || typeof request.metadata !== 'object' || Array.isArray(request.metadata))) {
            throw validationError('Checkpoint metadata must be an object');
        }
        if (request.runId !== undefined && typeof request.runId !== 'string') {
            throw validationError('Checkpoint runId must be a string');
        }
        if (request.toolCallId !== undefined && typeof request.toolCallId !== 'string') {
            throw validationError('Checkpoint toolCallId must be a string');
        }
        const message = request.message.trim();
        if (!message) {
            throw validationError('Checkpoint message is required');
        }
        if (message.length > 1_000) {
            throw validationError('Checkpoint message exceeds 1000 characters');
        }
        const ref = this.readRef(workspace);
        const parent = ref.head ? this.readCommit(ref.head, workspace.id) : null;
        let tree = parent ? this.loadCommitTree(parent) : emptyTree();
        const requestedPaths = normalizeRequestedPaths(request.paths);
        const trackedPaths = minimizePaths([
            ...(parent ? trackedPathsFromCommit(parent) : []),
            ...requestedPaths,
        ]);
        const stats = createObjectStats();
        for (const relativePath of requestedPaths) {
            const captured = this.capturePath(workspace, relativePath, stats);
            tree = setTreePath(tree, relativePath, captured);
        }
        const treeId = this.finalizeTree(tree, stats);
        const metadata = {
            ...(request.metadata ?? {}),
            authorityTrackedPaths: trackedPaths,
        };
        const commit = this.createCommit({
            workspace,
            tree: treeId,
            parents: ref.head ? [ref.head] : [],
            message,
            actor,
            ...(request.runId ? { runId: request.runId } : {}),
            ...(request.toolCallId ? { toolCallId: request.toolCallId } : {}),
            metadata,
        });
        this.writeCommit(commit);
        this.publishRef(workspace, ref, commit.id);
        return {
            workspace: this.withCurrentHead(workspace),
            commit,
            changedPaths: diffNodes(parent ? this.loadCommitTree(parent) : emptyTree(), tree).length,
            storedBytes: stats.storedBytes,
            reusedBytes: stats.reusedBytes,
        };
    }

    private captureTrackedWorkspace(
        workspace: AgentWorkspaceRecord,
        trackedPaths: string[],
        stats: ObjectStats,
    ): TreeNode {
        this.assertWorkspaceRoot(workspace);
        let tree = emptyTree();
        for (const relativePath of trackedPaths) {
            const captured = this.captureScopedPath(workspace, relativePath, stats);
            tree = captured.node
                ? setTreePath(tree, captured.path, captured.node)
                : ensureTreeAncestors(tree, relativePath);
        }
        return tree;
    }

    private captureScopedPath(
        workspace: AgentWorkspaceRecord,
        relativePath: string,
        stats: ObjectStats,
    ): { path: string; node?: SnapshotNode } {
        if (relativePath === '.') {
            return { path: '.', node: this.scanNode(workspace, workspace.rootPath, '.', stats) };
        }
        const segments = relativePath.split('/');
        let absolutePath = workspace.rootPath;
        for (let index = 0; index < segments.length; index += 1) {
            absolutePath = path.join(absolutePath, segments[index]!);
            const currentPath = segments.slice(0, index + 1).join('/');
            if (this.isExcluded(workspace, currentPath, absolutePath)) {
                throw new Error(`Workspace history excludes path: ${currentPath}`);
            }
            let stat: fs.Stats;
            try {
                stat = fs.lstatSync(absolutePath);
            } catch (error) {
                if (isFsError(error, 'ENOENT') || isFsError(error, 'ENOTDIR')) {
                    return { path: relativePath };
                }
                throw error;
            }
            if (index === segments.length - 1 || !stat.isDirectory() || stat.isSymbolicLink()) {
                return { path: currentPath, node: this.scanNode(workspace, absolutePath, currentPath, stats) };
            }
        }
        return { path: relativePath };
    }

    private capturePath(workspace: AgentWorkspaceRecord, relativePath: string, stats: ObjectStats): SnapshotNode | undefined {
        const absolutePath = this.resolveSafeWorkspacePath(workspace, relativePath);
        if (this.isExcluded(workspace, relativePath, absolutePath)) {
            throw new Error(`Workspace history excludes path: ${relativePath}`);
        }
        try {
            return this.scanNode(workspace, absolutePath, relativePath, stats);
        } catch (error) {
            if (isFsError(error, 'ENOENT')) {
                return undefined;
            }
            throw error;
        }
    }

    private scanNode(
        workspace: AgentWorkspaceRecord,
        absolutePath: string,
        relativePath: string,
        stats: ObjectStats,
    ): SnapshotNode {
        const stat = fs.lstatSync(absolutePath);
        const mode = stat.mode & 0o777;
        if (stat.isSymbolicLink()) {
            const payload: SymlinkObject = { format: SYMLINK_FORMAT, target: fs.readlinkSync(absolutePath) };
            assertSameFile(stat, fs.lstatSync(absolutePath), relativePath);
            const object = Buffer.from(canonicalJson(payload), 'utf8');
            return { kind: 'symlink', mode, oid: this.writeObject(object, stats), sizeBytes: object.byteLength };
        }
        if (stat.isFile()) {
            const descriptor = fs.openSync(absolutePath, fs.constants.O_RDONLY | (fs.constants.O_NOFOLLOW ?? 0));
            let content: Buffer;
            try {
                assertSameFile(stat, fs.fstatSync(descriptor), relativePath);
                content = fs.readFileSync(descriptor);
                assertSameFile(stat, fs.fstatSync(descriptor), relativePath);
            } finally {
                fs.closeSync(descriptor);
            }
            return { kind: 'blob', mode, oid: this.writeObject(content, stats), sizeBytes: content.byteLength };
        }
        if (!stat.isDirectory()) {
            throw new Error(`Unsupported workspace entry: ${relativePath}`);
        }

        const children = new Map<string, SnapshotNode>();
        const childKeys = new Set<string>();
        const entries = fs.readdirSync(absolutePath, { withFileTypes: true })
            .sort((left, right) => left.name.localeCompare(right.name));
        for (const entry of entries) {
            validateEntryName(entry.name);
            const childKey = fileNameKey(entry.name);
            if (childKeys.has(childKey)) {
                throw new Error(`Workspace contains colliding names: ${relativePath}/${entry.name}`);
            }
            childKeys.add(childKey);
            const childRelative = relativePath === '.' ? entry.name : `${relativePath}/${entry.name}`;
            const childAbsolute = path.join(absolutePath, entry.name);
            if (this.isExcluded(workspace, childRelative, childAbsolute)) {
                continue;
            }
            children.set(entry.name, this.scanNode(workspace, childAbsolute, childRelative, stats));
        }
        assertSameFile(stat, fs.lstatSync(absolutePath), relativePath);
        return { kind: 'tree', mode, children };
    }

    private finalizeTree(tree: TreeNode, stats: ObjectStats): WorkspaceObjectId {
        return this.finalizeNode(tree, stats);
    }

    private finalizeNode(node: SnapshotNode, stats: ObjectStats): WorkspaceObjectId {
        if (node.kind !== 'tree') {
            return node.oid;
        }
        if (node.oid) {
            return node.oid;
        }
        const entries = [...node.children.entries()]
            .sort(([left], [right]) => left.localeCompare(right))
            .map(([name, child]): WorkspaceTreeEntry => ({
                name,
                kind: child.kind,
                oid: this.finalizeNode(child, stats),
                mode: child.mode,
                ...(child.kind !== 'tree' && child.sizeBytes !== undefined ? { sizeBytes: child.sizeBytes } : {}),
            }));
        const treeObject: WorkspaceTreeObject = { format: 'authority-workspace-tree/v1', entries };
        node.oid = this.writeObject(Buffer.from(canonicalJson(treeObject), 'utf8'), stats);
        return node.oid;
    }

    private loadCommitTree(commit: WorkspaceCommitObject): TreeNode {
        return this.loadTree(commit.tree, new Set());
    }

    private loadTree(oid: WorkspaceObjectId, ancestors: Set<WorkspaceObjectId>): TreeNode {
        if (ancestors.has(oid)) {
            throw new Error(`Workspace tree cycle detected at ${oid}`);
        }
        const nextAncestors = new Set(ancestors);
        nextAncestors.add(oid);
        const value = parseJson<WorkspaceTreeObject>(this.readObject(oid).toString('utf8'), `tree object ${oid}`);
        if (value.format !== 'authority-workspace-tree/v1' || !Array.isArray(value.entries)) {
            throw new Error(`Invalid workspace tree object: ${oid}`);
        }
        const children = new Map<string, SnapshotNode>();
        const childKeys = new Set<string>();
        for (const entry of value.entries) {
            validateTreeEntry(entry);
            const childKey = fileNameKey(entry.name);
            if (childKeys.has(childKey)) {
                throw new Error(`Duplicate workspace tree entry: ${entry.name}`);
            }
            childKeys.add(childKey);
            if (entry.kind === 'tree') {
                const childTree = this.loadTree(entry.oid, nextAncestors);
                childTree.mode = entry.mode;
                children.set(entry.name, childTree);
            } else {
                children.set(entry.name, {
                    kind: entry.kind,
                    mode: entry.mode,
                    oid: entry.oid,
                    ...(entry.sizeBytes === undefined ? {} : { sizeBytes: entry.sizeBytes }),
                });
            }
        }
        return { kind: 'tree', mode: 0o755, oid, children };
    }

    private applyTree(workspace: AgentWorkspaceRecord, current: TreeNode, target: TreeNode): string[] {
        // ponytail: Node has no portable openat/renameat; use native dirfd operations if hostile same-account path swaps enter the threat model.
        const warnings: string[] = [];
        for (const name of childNames(current, target)) {
            this.applyNode(workspace, name, getTreeChild(current, name), getTreeChild(target, name), warnings);
        }
        return warnings;
    }

    private applyNode(
        workspace: AgentWorkspaceRecord,
        relativePath: string,
        current: SnapshotNode | undefined,
        target: SnapshotNode | undefined,
        warnings: string[],
    ): void {
        if (nodesEqual(current, target)) {
            return;
        }
        this.assertWorkspaceNodeUnchanged(workspace, relativePath, current);
        const absolutePath = this.resolveSafeWorkspacePath(workspace, relativePath);
        if (!target) {
            this.removeWorkspaceNode(workspace, relativePath, current, warnings);
            return;
        }
        if (current?.kind === 'tree' && target.kind === 'tree') {
            ensureDir(absolutePath);
            this.assertWorkspaceDirectory(workspace, relativePath);
            for (const name of childNames(current, target)) {
                this.applyNode(
                    workspace,
                    `${relativePath}/${name}`,
                    getTreeChild(current, name),
                    getTreeChild(target, name),
                    warnings,
                );
            }
            if (!target.synthetic) {
                applyMode(absolutePath, target.mode);
            }
            return;
        }

        if (current) {
            this.removeWorkspaceNode(workspace, relativePath, current, warnings);
        }
        ensureDir(path.dirname(absolutePath));
        this.resolveSafeWorkspacePath(workspace, relativePath);
        if (target.kind === 'tree') {
            ensureDir(absolutePath);
            this.assertWorkspaceDirectory(workspace, relativePath);
            for (const [name, child] of [...target.children.entries()].sort(([left], [right]) => left.localeCompare(right))) {
                this.applyNode(workspace, `${relativePath}/${name}`, undefined, child, warnings);
            }
            if (!target.synthetic) {
                applyMode(absolutePath, target.mode);
            }
            return;
        }
        if (target.kind === 'blob') {
            this.assertWorkspaceNodeUnchanged(workspace, relativePath, undefined);
            atomicWriteFile(absolutePath, this.readObject(target.oid));
            applyMode(absolutePath, target.mode);
            return;
        }

        const symlink = parseJson<SymlinkObject>(this.readObject(target.oid).toString('utf8'), `symlink object ${target.oid}`);
        if (symlink.format !== SYMLINK_FORMAT || typeof symlink.target !== 'string' || symlink.target.includes('\0')) {
            throw new Error(`Invalid workspace symlink object: ${target.oid}`);
        }
        try {
            this.assertWorkspaceNodeUnchanged(workspace, relativePath, undefined);
            fs.symlinkSync(symlink.target, absolutePath);
        } catch (error) {
            warnings.push(`Could not restore symlink ${relativePath}: ${error instanceof Error ? error.message : String(error)}`);
            throw error;
        }
    }

    private removeWorkspaceNode(
        workspace: AgentWorkspaceRecord,
        relativePath: string,
        current: SnapshotNode | undefined,
        warnings: string[],
    ): void {
        if (!current) {
            return;
        }
        this.assertWorkspaceNodeUnchanged(workspace, relativePath, current);
        const absolutePath = this.resolveSafeWorkspacePath(workspace, relativePath);
        if (!isPathInside(workspace.rootPath, absolutePath) || samePath(workspace.rootPath, absolutePath)) {
            throw new Error(`Refusing to remove path outside workspace: ${absolutePath}`);
        }
        if (current.kind !== 'tree') {
            fs.rmSync(absolutePath, { force: true });
            return;
        }
        for (const [name, child] of [...current.children.entries()].sort(([left], [right]) => left.localeCompare(right))) {
            this.removeWorkspaceNode(workspace, `${relativePath}/${name}`, child, warnings);
        }
        try {
            fs.rmdirSync(absolutePath);
        } catch (error) {
            if (isFsError(error, 'ENOENT')) {
                return;
            }
            if (isFsError(error, 'ENOTEMPTY') || isFsError(error, 'EEXIST')) {
                warnings.push(`Preserved non-empty directory outside the tracked snapshot: ${relativePath}`);
                return;
            }
            throw error;
        }
    }

    private assertWorkspaceNodeUnchanged(
        workspace: AgentWorkspaceRecord,
        relativePath: string,
        expected: SnapshotNode | undefined,
    ): void {
        if (expected?.kind === 'tree') {
            this.assertWorkspaceDirectory(workspace, relativePath, expected.synthetic ? undefined : expected.mode);
            return;
        }
        let actual: SnapshotNode | undefined;
        try {
            actual = this.capturePath(workspace, relativePath, createObjectStats());
        } catch (error) {
            if (isFsError(error, 'ENOTDIR')) {
                actual = undefined;
            } else {
                throw error;
            }
        }
        if (!nodesEqual(expected, actual)) {
            throw workspaceConflict(`Workspace path changed while rollback was applying: ${relativePath}`);
        }
    }

    private assertWorkspaceDirectory(
        workspace: AgentWorkspaceRecord,
        relativePath: string,
        expectedMode?: number,
    ): void {
        const absolutePath = this.resolveSafeWorkspacePath(workspace, relativePath);
        const stat = fs.lstatSync(absolutePath);
        if (stat.isSymbolicLink() || !stat.isDirectory() || (expectedMode !== undefined && (stat.mode & 0o777) !== expectedMode)) {
            throw workspaceConflict(`Workspace directory changed while rollback was applying: ${relativePath}`);
        }
    }

    private resolveSafeWorkspacePath(workspace: AgentWorkspaceRecord, relativePath: string): string {
        this.assertWorkspaceRoot(workspace);
        const normalized = normalizeRelativePath(relativePath);
        const absolutePath = normalized === '.'
            ? workspace.rootPath
            : path.resolve(workspace.rootPath, ...normalized.split('/'));
        if (!isPathInside(workspace.rootPath, absolutePath)) {
            throw new Error(`Path escapes workspace: ${relativePath}`);
        }
        if (normalized === '.') {
            return absolutePath;
        }

        let current = workspace.rootPath;
        const segments = normalized.split('/');
        for (const segment of segments.slice(0, -1)) {
            current = path.join(current, segment);
            try {
                if (fs.lstatSync(current).isSymbolicLink()) {
                    throw new Error(`Path traverses a symlink: ${relativePath}`);
                }
            } catch (error) {
                if (isFsError(error, 'ENOENT')) {
                    break;
                }
                throw error;
            }
        }
        return absolutePath;
    }

    private assertWorkspaceRoot(workspace: AgentWorkspaceRecord): void {
        const stat = fs.lstatSync(workspace.rootPath);
        if (!stat.isDirectory() || stat.isSymbolicLink() || !samePath(fs.realpathSync.native(workspace.rootPath), workspace.rootPath)) {
            throw new Error(`Workspace root changed or is no longer a real directory: ${workspace.rootPath}`);
        }
    }

    private isExcluded(workspace: AgentWorkspaceRecord, relativePath: string, absolutePath: string): boolean {
        const segments = relativePath === '.' ? [] : relativePath.split('/');
        return segments.some(segment => EXCLUDED_SEGMENTS.has(process.platform === 'win32' ? segment.toLowerCase() : segment))
            || samePath(absolutePath, this.storeDir)
            || isPathInside(this.storeDir, absolutePath);
    }

    private createCommit(input: {
        workspace: AgentWorkspaceRecord;
        tree: WorkspaceObjectId;
        parents: WorkspaceObjectId[];
        message: string;
        actor: WorkspaceCommitActor;
        runId?: string;
        toolCallId?: string;
        metadata?: Record<string, unknown>;
    }): WorkspaceCommitObject {
        const unsigned = {
            format: 'authority-workspace-commit/v1' as const,
            workspaceId: input.workspace.id,
            tree: input.tree,
            parents: input.parents,
            message: input.message,
            createdAt: this.now(),
            actor: input.actor,
            ...(input.runId ? { runId: input.runId } : {}),
            ...(input.toolCallId ? { toolCallId: input.toolCallId } : {}),
            ...(input.metadata ? { metadata: input.metadata } : {}),
        };
        return { ...unsigned, id: sha256(Buffer.from(canonicalJson(unsigned), 'utf8')) };
    }

    private writeCommit(commit: WorkspaceCommitObject): void {
        const filePath = this.commitPath(commit.id);
        if (fs.existsSync(filePath)) {
            this.readCommit(commit.id, commit.workspaceId);
            return;
        }
        atomicWriteJson(filePath, commit);
    }

    private readCommit(commitId: string, workspaceId?: string): WorkspaceCommitObject {
        assertOid(commitId);
        const filePath = this.commitPath(commitId);
        if (!fs.existsSync(filePath)) {
            throw new Error(`Workspace commit not found: ${commitId}`);
        }
        const commit = parseJson<WorkspaceCommitObject>(fs.readFileSync(filePath, 'utf8'), `commit ${commitId}`);
        if (commit.format !== 'authority-workspace-commit/v1' || commit.id !== commitId || !Array.isArray(commit.parents)) {
            throw new Error(`Invalid workspace commit: ${commitId}`);
        }
        assertOid(commit.tree);
        for (const parent of commit.parents) {
            assertOid(parent);
        }
        if (workspaceId && commit.workspaceId !== workspaceId) {
            throw new Error(`Commit ${commitId} belongs to another workspace`);
        }
        const { id: _id, ...unsigned } = commit;
        if (sha256(Buffer.from(canonicalJson(unsigned), 'utf8')) !== commitId) {
            throw new Error(`Workspace commit hash mismatch: ${commitId}`);
        }
        return commit;
    }

    private writeObject(content: Buffer, stats: ObjectStats): WorkspaceObjectId {
        const oid = sha256(content);
        const filePath = this.objectPath(oid);
        if (fs.existsSync(filePath)) {
            stats.reusedBytes += content.byteLength;
            return oid;
        }
        atomicWriteFile(filePath, content);
        stats.storedBytes += content.byteLength;
        return oid;
    }

    private readObject(oid: WorkspaceObjectId): Buffer {
        assertOid(oid);
        const filePath = this.objectPath(oid);
        if (!fs.existsSync(filePath)) {
            throw new Error(`Workspace object not found: ${oid}`);
        }
        const content = fs.readFileSync(filePath);
        if (sha256(content) !== oid) {
            throw new Error(`Workspace object hash mismatch: ${oid}`);
        }
        return content;
    }

    private publishRef(
        workspace: AgentWorkspaceRecord,
        expected: WorkspaceRefRecord,
        head: WorkspaceObjectId,
    ): WorkspaceRefRecord {
        const current = this.readRef(workspace);
        if (current.generation !== expected.generation || current.head !== expected.head) {
            throw workspaceConflict(`Workspace ref changed while updating ${workspace.id}`);
        }
        const next: WorkspaceRefRecord = {
            ...current,
            head,
            generation: current.generation + 1,
            updatedAt: this.now(),
        };
        const journal: RefJournal = {
            format: REF_JOURNAL_FORMAT,
            workspaceId: workspace.id,
            expectedGeneration: current.generation,
            next,
            createdAt: this.now(),
        };
        atomicWriteJson(this.refJournalPath(workspace.id), journal);
        this.writeRef(next);
        fs.rmSync(this.refJournalPath(workspace.id), { force: true });
        return next;
    }

    private recoverRefJournal(workspace: AgentWorkspaceRecord): void {
        const filePath = this.refJournalPath(workspace.id);
        if (!fs.existsSync(filePath)) {
            return;
        }
        const journal = parseJson<RefJournal>(fs.readFileSync(filePath, 'utf8'), `ref journal ${workspace.id}`);
        if (journal.format !== REF_JOURNAL_FORMAT || journal.workspaceId !== workspace.id) {
            throw new Error(`Invalid workspace ref journal: ${workspace.id}`);
        }
        if (
            journal.next.format !== 'authority-workspace-ref/v1'
            || journal.next.workspaceId !== workspace.id
            || journal.next.name !== workspace.defaultRef
            || journal.next.generation !== journal.expectedGeneration + 1
            || !OID_PATTERN.test(journal.next.head ?? '')
        ) {
            throw new Error(`Invalid workspace ref journal target: ${workspace.id}`);
        }
        const current = this.readRef(workspace);
        if (current.generation === journal.expectedGeneration) {
            this.writeRef(journal.next);
        } else if (current.generation === journal.next.generation && current.head !== journal.next.head) {
            throw workspaceConflict(`Workspace ref journal conflicts with current head: ${workspace.id}`);
        } else if (current.generation < journal.next.generation) {
            throw workspaceConflict(`Workspace ref generation moved backwards: ${workspace.id}`);
        }
        fs.rmSync(filePath, { force: true });
    }

    private readRef(workspace: AgentWorkspaceRecord): WorkspaceRefRecord {
        const filePath = this.refPath(workspace.id, workspace.defaultRef);
        if (!fs.existsSync(filePath)) {
            return {
                format: 'authority-workspace-ref/v1',
                workspaceId: workspace.id,
                name: workspace.defaultRef,
                head: null,
                generation: 0,
                updatedAt: workspace.createdAt,
            };
        }
        const ref = parseJson<WorkspaceRefRecord>(fs.readFileSync(filePath, 'utf8'), `workspace ref ${workspace.id}`);
        if (
            ref.format !== 'authority-workspace-ref/v1'
            || ref.workspaceId !== workspace.id
            || ref.name !== workspace.defaultRef
            || !Number.isSafeInteger(ref.generation)
            || ref.generation < 0
            || (ref.head !== null && !OID_PATTERN.test(ref.head))
        ) {
            throw new Error(`Invalid workspace ref: ${workspace.id}`);
        }
        return ref;
    }

    private writeRef(ref: WorkspaceRefRecord): void {
        atomicWriteJson(this.refPath(ref.workspaceId, ref.name), ref);
    }

    private readRegistry(): WorkspaceRegistry {
        this.ensureStore();
        const filePath = this.registryPath();
        if (!fs.existsSync(filePath)) {
            return { format: STORE_FORMAT, workspaces: [] };
        }
        const registry = parseJson<WorkspaceRegistry>(fs.readFileSync(filePath, 'utf8'), 'workspace registry');
        if (registry.format !== STORE_FORMAT || !Array.isArray(registry.workspaces)) {
            throw new Error('Invalid workspace registry');
        }
        for (const workspace of registry.workspaces) {
            validateWorkspaceRecord(workspace);
        }
        return registry;
    }

    private writeRegistry(registry: WorkspaceRegistry): void {
        atomicWriteJson(this.registryPath(), registry);
    }

    private getStoredWorkspace(workspaceId: string): AgentWorkspaceRecord {
        if (workspaceId.length > 128 || !isSafeName(workspaceId)) {
            throw validationError('Workspace id contains invalid characters');
        }
        const workspace = this.readRegistry().workspaces.find(entry => entry.id === workspaceId);
        if (!workspace) {
            throw new AuthorityServiceError(`Workspace not found: ${workspaceId}`, 404, 'validation_error', 'validation');
        }
        return workspace;
    }

    private withCurrentHead(workspace: AgentWorkspaceRecord): AgentWorkspaceRecord {
        const ref = this.readRef(workspace);
        return { ...workspace, headCommitId: ref.head, updatedAt: ref.updatedAt };
    }

    private resolveWorkspaceRoot(rootPath: string): string {
        const resolved = path.resolve(rootPath);
        let stat: fs.Stats;
        try {
            stat = fs.statSync(resolved);
        } catch (error) {
            if (isFsError(error, 'ENOENT')) {
                throw validationError(`Workspace root does not exist: ${resolved}`);
            }
            throw error;
        }
        if (!stat.isDirectory()) {
            throw validationError(`Workspace root is not a directory: ${resolved}`);
        }
        return fs.realpathSync.native(resolved);
    }

    private readRollbackJournal(workspaceId: string): RollbackJournal | null {
        const filePath = this.rollbackJournalPath(workspaceId);
        if (!fs.existsSync(filePath)) {
            return null;
        }
        const journal = parseJson<RollbackJournal>(fs.readFileSync(filePath, 'utf8'), `rollback journal ${workspaceId}`);
        if (
            journal.format !== ROLLBACK_JOURNAL_FORMAT
            || journal.workspaceId !== workspaceId
            || typeof journal.operationId !== 'string'
            || !OID_PATTERN.test(journal.targetCommitId)
            || (journal.previousHead !== null && !OID_PATTERN.test(journal.previousHead))
            || !Number.isSafeInteger(journal.previousGeneration)
            || journal.previousGeneration < 0
            || !OID_PATTERN.test(journal.safetyCommitId)
            || journal.safetyGeneration !== journal.previousGeneration + 1
            || !OID_PATTERN.test(journal.rollbackCommitId)
            || !Array.isArray(journal.trackedPaths)
            || journal.trackedPaths.some(entry => typeof entry !== 'string')
            || !Number.isSafeInteger(journal.changedPaths)
            || journal.changedPaths < 0
            || typeof journal.startedAt !== 'string'
        ) {
            throw new Error(`Invalid workspace rollback journal: ${workspaceId}`);
        }
        assertSafeName(journal.operationId, 'rollback operation id');
        return journal;
    }

    private readCompletedRollback(workspaceId: string, operationId: string): CompletedRollback | null {
        const filePath = this.completedRollbackPath(workspaceId, operationId);
        if (!fs.existsSync(filePath)) {
            return null;
        }
        const completed = parseJson<CompletedRollback>(
            fs.readFileSync(filePath, 'utf8'),
            `completed rollback ${workspaceId}/${operationId}`,
        );
        if (
            completed.format !== COMPLETED_ROLLBACK_FORMAT
            || completed.workspaceId !== workspaceId
            || completed.operationId !== operationId
            || !OID_PATTERN.test(completed.targetCommitId)
            || !OID_PATTERN.test(completed.rollbackCommitId)
            || !Number.isSafeInteger(completed.changedPaths)
            || completed.changedPaths < 0
            || !Array.isArray(completed.warnings)
            || completed.warnings.some(entry => typeof entry !== 'string')
            || typeof completed.completedAt !== 'string'
        ) {
            throw new Error(`Invalid completed rollback: ${workspaceId}/${operationId}`);
        }
        return completed;
    }

    private writeCompletedRollback(completed: CompletedRollback): void {
        const filePath = this.completedRollbackPath(completed.workspaceId, completed.operationId);
        if (fs.existsSync(filePath)) {
            const existing = this.readCompletedRollback(completed.workspaceId, completed.operationId);
            if (canonicalJson(existing) !== canonicalJson(completed)) {
                throw workspaceConflict(`Rollback operation id was already used: ${completed.operationId}`);
            }
            return;
        }
        atomicWriteJson(filePath, completed);
    }

    private removeMatchingRollbackJournal(workspaceId: string, operationId: string): void {
        const journal = this.readRollbackJournal(workspaceId);
        if (journal?.operationId === operationId) {
            this.removeRollbackJournal(workspaceId);
        }
    }

    private assertNoPendingRollback(workspaceId: string): void {
        if (this.readRollbackJournal(workspaceId)) {
            throw workspaceConflict(`Workspace rollback requires recovery: ${workspaceId}`);
        }
    }

    private removeRollbackJournal(workspaceId: string): void {
        fs.rmSync(this.rollbackJournalPath(workspaceId), { force: true });
    }

    private ensureStore(): void {
        for (const dir of ['objects', 'commits', 'refs', 'journals', 'rollbacks', 'operations', 'locks']) {
            ensureDir(path.join(this.storeDir, dir));
        }
    }

    private registryPath(): string {
        return path.join(this.storeDir, 'workspaces.json');
    }

    private objectPath(oid: WorkspaceObjectId): string {
        assertOid(oid);
        return path.join(this.storeDir, 'objects', oid);
    }

    private commitPath(commitId: WorkspaceObjectId): string {
        assertOid(commitId);
        return path.join(this.storeDir, 'commits', `${commitId}.json`);
    }

    private refPath(workspaceId: string, refName: string): string {
        assertSafeName(workspaceId, 'workspace id');
        assertSafeName(refName, 'workspace ref');
        return path.join(this.storeDir, 'refs', workspaceId, `${refName}.json`);
    }

    private refJournalPath(workspaceId: string): string {
        assertSafeName(workspaceId, 'workspace id');
        return path.join(this.storeDir, 'journals', `${workspaceId}.json`);
    }

    private rollbackJournalPath(workspaceId: string): string {
        assertSafeName(workspaceId, 'workspace id');
        return path.join(this.storeDir, 'rollbacks', `${workspaceId}.json`);
    }

    private completedRollbackPath(workspaceId: string, operationId: string): string {
        assertSafeName(workspaceId, 'workspace id');
        assertSafeName(operationId, 'rollback operation id');
        return path.join(this.storeDir, 'operations', workspaceId, `${operationId}.json`);
    }

    private async withLock<T>(name: string, run: () => Promise<T> | T): Promise<T> {
        this.ensureStore();
        assertSafeName(name, 'lock name');
        const lockPath = path.join(this.storeDir, 'locks', `${name}.lock`);
        const token = crypto.randomUUID();
        const deadline = Date.now() + this.lockTimeoutMs;
        while (true) {
            try {
                const descriptor = fs.openSync(lockPath, 'wx');
                try {
                    const lock: LockRecord = { token, pid: process.pid, hostname: os.hostname(), createdAt: Date.now() };
                    fs.writeFileSync(descriptor, JSON.stringify(lock));
                    fs.fsyncSync(descriptor);
                } finally {
                    fs.closeSync(descriptor);
                }
                break;
            } catch (error) {
                if (!isFsError(error, 'EEXIST')) {
                    throw error;
                }
                if (this.isStaleLock(lockPath) && this.claimStaleLock(lockPath)) {
                    continue;
                }
                if (Date.now() >= deadline) {
                    throw new Error(`Timed out waiting for workspace history lock: ${name}`);
                }
                await delay(50);
            }
        }
        try {
            return await run();
        } finally {
            this.releaseOwnedLock(lockPath, token);
        }
    }

    private isStaleLock(lockPath: string): boolean {
        try {
            const lock = parseJson<Partial<LockRecord>>(fs.readFileSync(lockPath, 'utf8'), 'workspace lock');
            if (lock.hostname === os.hostname() && Number.isSafeInteger(lock.pid)) {
                return !isProcessAlive(lock.pid as number);
            }
            if (typeof lock.hostname === 'string' && lock.hostname) {
                return false;
            }
            return Date.now() - Number(lock.createdAt ?? fs.statSync(lockPath).mtimeMs) > this.staleLockMs;
        } catch {
            try {
                return Date.now() - fs.statSync(lockPath).mtimeMs > this.staleLockMs;
            } catch {
                return false;
            }
        }
    }

    private claimStaleLock(lockPath: string): boolean {
        const claimedPath = `${lockPath}.${crypto.randomUUID()}.stale`;
        try {
            fs.renameSync(lockPath, claimedPath);
            fs.rmSync(claimedPath, { force: true });
            return true;
        } catch (error) {
            fs.rmSync(claimedPath, { force: true });
            if (isFsError(error, 'ENOENT') || isFsError(error, 'EACCES') || isFsError(error, 'EPERM')) {
                return false;
            }
            throw error;
        }
    }

    private releaseOwnedLock(lockPath: string, token: string): void {
        try {
            const lock = parseJson<Partial<LockRecord>>(fs.readFileSync(lockPath, 'utf8'), 'workspace lock');
            if (lock.token === token) {
                fs.rmSync(lockPath, { force: true });
            }
        } catch (error) {
            if (!isFsError(error, 'ENOENT')) {
                throw error;
            }
        }
    }
}

function emptyTree(synthetic = false): TreeNode {
    return { kind: 'tree', mode: 0o755, ...(synthetic ? { synthetic: true } : {}), children: new Map() };
}

function scopeTree(tree: TreeNode, trackedPaths: string[]): TreeNode {
    if (trackedPaths.includes('.')) {
        return tree;
    }
    let scoped = emptyTree();
    for (const relativePath of trackedPaths) {
        const found = findScopedNode(tree, relativePath);
        scoped = found.node
            ? setTreePath(scoped, found.path, found.node)
            : ensureTreeAncestors(scoped, relativePath);
    }
    return scoped;
}

function findScopedNode(tree: TreeNode, relativePath: string): { path: string; node?: SnapshotNode } {
    if (relativePath === '.') {
        return { path: '.', node: tree };
    }
    const segments = relativePath.split('/');
    let current: SnapshotNode = tree;
    for (let index = 0; index < segments.length; index += 1) {
        if (current.kind !== 'tree') {
            return { path: segments.slice(0, index).join('/'), node: current };
        }
        const child = getTreeChild(current, segments[index]!);
        if (!child) {
            return { path: relativePath };
        }
        current = child;
    }
    return { path: relativePath, node: current };
}

function ensureTreeAncestors(root: TreeNode, relativePath: string): TreeNode {
    if (relativePath === '.') {
        return root;
    }
    let current = root;
    delete current.oid;
    for (const segment of relativePath.split('/').slice(0, -1)) {
        const existing = getTreeChild(current, segment);
        if (existing?.kind === 'tree') {
            current = existing;
        } else if (existing) {
            return root;
        } else {
            const created = emptyTree(true);
            setTreeChild(current, segment, created);
            current = created;
        }
        delete current.oid;
    }
    return root;
}

function createObjectStats(): ObjectStats {
    return { storedBytes: 0, reusedBytes: 0 };
}

function setTreePath(root: TreeNode, relativePath: string, value: SnapshotNode | undefined): TreeNode {
    if (relativePath === '.') {
        if (value && value.kind !== 'tree') {
            throw new Error('Workspace root must be a directory');
        }
        return value ?? emptyTree();
    }
    const segments = relativePath.split('/');
    let current = root;
    delete current.oid;
    for (const segment of segments.slice(0, -1)) {
        const existing = getTreeChild(current, segment);
        if (existing?.kind === 'tree') {
            current = existing;
        } else if (!value) {
            return root;
        } else {
            const created = emptyTree(true);
            setTreeChild(current, segment, created);
            current = created;
        }
        delete current.oid;
    }
    const name = segments[segments.length - 1];
    if (!name) {
        throw new Error(`Invalid workspace path: ${relativePath}`);
    }
    if (value) {
        setTreeChild(current, name, value);
    } else {
        deleteTreeChild(current, name);
    }
    return root;
}

function normalizeRequestedPaths(paths: string[] | undefined): string[] {
    if (!paths || paths.length === 0) {
        return ['.'];
    }
    return minimizePaths(paths.map(normalizeRelativePath));
}

function normalizeRelativePath(value: string): string {
    const input = value.replace(/\\/g, '/');
    if (!input) {
        throw validationError('Workspace path must not be empty');
    }
    if (input === '.') {
        return '.';
    }
    if (input.includes('\0') || path.posix.isAbsolute(input) || /^[a-zA-Z]:\//.test(input)) {
        throw validationError(`Invalid workspace path: ${value}`);
    }
    const normalized = path.posix.normalize(input).replace(/^\.\//, '').replace(/\/$/, '');
    if (!normalized || normalized === '.') {
        return '.';
    }
    if (normalized === '..' || normalized.startsWith('../')) {
        throw validationError(`Path escapes workspace: ${value}`);
    }
    for (const segment of normalized.split('/')) {
        try {
            validateEntryName(segment);
        } catch {
            throw validationError(`Invalid workspace path: ${value}`);
        }
    }
    return normalized;
}

function minimizePaths(paths: string[]): string[] {
    const unique = [...new Set(paths.map(normalizeRelativePath))].sort((left, right) => {
        const depth = left.split('/').length - right.split('/').length;
        return depth || left.localeCompare(right);
    });
    const result: string[] = [];
    for (const candidate of unique) {
        const candidateKey = logicalPathKey(candidate);
        if (result.some(parent => {
            const parentKey = logicalPathKey(parent);
            return parent === '.' || candidateKey === parentKey || candidateKey.startsWith(`${parentKey}/`);
        })) {
            continue;
        }
        result.push(candidate);
    }
    return result.sort();
}

function trackedPathsFromCommit(commit: WorkspaceCommitObject): string[] {
    const value = commit.metadata?.authorityTrackedPaths;
    if (!Array.isArray(value) || value.some(entry => typeof entry !== 'string')) {
        return [];
    }
    return minimizePaths(value as string[]);
}

function isTrackedPath(relativePath: string, trackedPaths: string[]): boolean {
    const pathKey = logicalPathKey(relativePath);
    return trackedPaths.some(trackedPath => {
        const trackedKey = logicalPathKey(trackedPath);
        return trackedPath === '.' || pathKey === trackedKey || pathKey.startsWith(`${trackedKey}/`);
    });
}

function mergeDiffEntries(...groups: WorkspaceDiffEntry[][]): WorkspaceDiffEntry[] {
    const entries = new Map<string, WorkspaceDiffEntry>();
    for (const group of groups) {
        for (const entry of group) {
            entries.set(logicalPathKey(entry.path), entry);
        }
    }
    return [...entries.values()].sort((left, right) => left.path.localeCompare(right.path));
}

function getTreeChild(tree: TreeNode, name: string): SnapshotNode | undefined {
    const key = fileNameKey(name);
    for (const [candidate, child] of tree.children) {
        if (fileNameKey(candidate) === key) {
            return child;
        }
    }
    return undefined;
}

function setTreeChild(tree: TreeNode, name: string, child: SnapshotNode): void {
    const key = fileNameKey(name);
    for (const candidate of tree.children.keys()) {
        if (fileNameKey(candidate) === key) {
            tree.children.set(candidate, child);
            return;
        }
    }
    tree.children.set(name, child);
}

function deleteTreeChild(tree: TreeNode, name: string): void {
    const key = fileNameKey(name);
    for (const candidate of tree.children.keys()) {
        if (fileNameKey(candidate) === key) {
            tree.children.delete(candidate);
            return;
        }
    }
}

function childNames(...trees: TreeNode[]): string[] {
    const names = new Map<string, string>();
    for (const tree of trees) {
        for (const name of tree.children.keys()) {
            const key = fileNameKey(name);
            if (!names.has(key)) {
                names.set(key, name);
            }
        }
    }
    return [...names.values()].sort((left, right) => left.localeCompare(right));
}

function diffNodes(before: TreeNode, after: TreeNode): WorkspaceDiffEntry[] {
    const entries: WorkspaceDiffEntry[] = [];
    diffTreeChildren(before, after, '', entries);
    return entries.sort((left, right) => left.path.localeCompare(right.path));
}

function diffTreeChildren(before: TreeNode, after: TreeNode, prefix: string, output: WorkspaceDiffEntry[]): void {
    for (const name of childNames(before, after)) {
        const childPath = prefix ? `${prefix}/${name}` : name;
        diffNode(getTreeChild(before, name), getTreeChild(after, name), childPath, output);
    }
}

function diffNode(
    before: SnapshotNode | undefined,
    after: SnapshotNode | undefined,
    relativePath: string,
    output: WorkspaceDiffEntry[],
): void {
    if (nodesEqual(before, after)) {
        return;
    }
    if (before?.kind === 'tree' && after?.kind === 'tree') {
        if (before.mode !== after.mode) {
            output.push({
                path: relativePath,
                status: 'modified',
                beforeKind: 'tree',
                afterKind: 'tree',
                ...(before.oid ? { beforeOid: before.oid } : {}),
                ...(after.oid ? { afterOid: after.oid } : {}),
            });
        }
        diffTreeChildren(before, after, relativePath, output);
        return;
    }
    if (!before && after?.kind === 'tree' && after.children.size > 0) {
        for (const [name, child] of after.children) {
            diffNode(undefined, child, `${relativePath}/${name}`, output);
        }
        return;
    }
    if (before?.kind === 'tree' && before.children.size > 0 && !after) {
        for (const [name, child] of before.children) {
            diffNode(child, undefined, `${relativePath}/${name}`, output);
        }
        return;
    }
    output.push({
        path: relativePath,
        status: !before ? 'added' : !after ? 'deleted' : before.kind === after.kind ? 'modified' : 'type_changed',
        ...(before ? { beforeKind: before.kind, beforeOid: before.oid } : {}),
        ...(after ? { afterKind: after.kind, afterOid: after.oid } : {}),
        ...(before?.kind !== 'tree' && before?.sizeBytes !== undefined ? { beforeSizeBytes: before.sizeBytes } : {}),
        ...(after?.kind !== 'tree' && after?.sizeBytes !== undefined ? { afterSizeBytes: after.sizeBytes } : {}),
    });
}

function nodesEqual(left: SnapshotNode | undefined, right: SnapshotNode | undefined): boolean {
    if (!left || !right || left.kind !== right.kind || left.mode !== right.mode) {
        return left === right;
    }
    if (left.kind !== 'tree' && right.kind !== 'tree') {
        return left.oid === right.oid;
    }
    if (left.kind !== 'tree' || right.kind !== 'tree' || left.children.size !== right.children.size) {
        return false;
    }
    for (const [name, child] of left.children) {
        if (!nodesEqual(child, getTreeChild(right, name))) {
            return false;
        }
    }
    return true;
}

function validateTreeEntry(entry: WorkspaceTreeEntry): void {
    if (
        !entry
        || typeof entry.name !== 'string'
        || !isTreeKind(entry.kind)
        || !OID_PATTERN.test(entry.oid)
        || !Number.isSafeInteger(entry.mode)
    ) {
        throw new Error('Invalid workspace tree entry');
    }
    validateEntryName(entry.name);
}

function validateEntryName(name: string): void {
    if (!name || name === '.' || name === '..' || name.includes('/') || name.includes('\\') || name.includes('\0')) {
        throw new Error(`Invalid workspace entry name: ${name}`);
    }
    if (process.platform === 'win32') {
        const stem = name.split('.')[0]?.toUpperCase() ?? '';
        if (
            /[<>:"|?*]/.test(name)
            || /[ .]$/.test(name)
            || /^(CON|PRN|AUX|NUL|COM[1-9]|LPT[1-9])$/.test(stem)
        ) {
            throw new Error(`Invalid Windows workspace entry name: ${name}`);
        }
    }
}

function fileNameKey(value: string): string {
    return process.platform === 'win32' ? value.toLowerCase() : value;
}

function logicalPathKey(value: string): string {
    return process.platform === 'win32' ? value.toLowerCase() : value;
}

function validateWorkspaceRecord(workspace: AgentWorkspaceRecord): void {
    if (!workspace || typeof workspace !== 'object') {
        throw new Error('Invalid workspace registry entry');
    }
    assertSafeName(workspace.id, 'workspace id');
    assertSafeName(workspace.defaultRef, 'workspace ref');
    if (
        typeof workspace.displayName !== 'string'
        || !workspace.displayName.trim()
        || typeof workspace.rootPath !== 'string'
        || !path.isAbsolute(workspace.rootPath)
        || (workspace.headCommitId !== null && !OID_PATTERN.test(workspace.headCommitId))
        || typeof workspace.createdAt !== 'string'
        || typeof workspace.updatedAt !== 'string'
    ) {
        throw new Error(`Invalid workspace registry entry: ${workspace.id}`);
    }
}

function isTreeKind(value: unknown): value is WorkspaceTreeEntryKind {
    return value === 'blob' || value === 'tree' || value === 'symlink';
}

function canonicalJson(value: unknown): string {
    if (value === null || typeof value === 'string' || typeof value === 'boolean') {
        return JSON.stringify(value);
    }
    if (typeof value === 'number') {
        if (!Number.isFinite(value)) {
            throw new Error('Workspace history values must be finite numbers');
        }
        return JSON.stringify(value);
    }
    if (Array.isArray(value)) {
        return `[${value.map(item => canonicalJson(item)).join(',')}]`;
    }
    if (typeof value === 'object') {
        const entries = Object.entries(value as Record<string, unknown>)
            .filter(([, item]) => item !== undefined)
            .sort(([left], [right]) => left.localeCompare(right));
        return `{${entries.map(([key, item]) => `${JSON.stringify(key)}:${canonicalJson(item)}`).join(',')}}`;
    }
    throw new Error(`Unsupported workspace history value: ${typeof value}`);
}

function parseJson<T>(value: string, label: string): T {
    try {
        return JSON.parse(value) as T;
    } catch (error) {
        throw new Error(`Invalid ${label}: ${error instanceof Error ? error.message : String(error)}`);
    }
}

function sha256(content: Buffer): string {
    return crypto.createHash('sha256').update(content).digest('hex');
}

function assertOid(value: string): void {
    if (!OID_PATTERN.test(value)) {
        throw new Error(`Invalid workspace object id: ${value}`);
    }
}

function assertSafeName(value: string, label: string): void {
    if (!isSafeName(value)) {
        throw new Error(`Invalid ${label}: ${value}`);
    }
}

function isSafeName(value: string): boolean {
    return SAFE_NAME_PATTERN.test(value) && value !== '.' && value !== '..';
}

function workspaceConflict(message: string, changes: WorkspaceDiffEntry[] = []): AuthorityServiceError {
    const error = new AuthorityServiceError(message, 409, 'workspace_conflict', 'concurrency', {
        changes: changes.slice(0, 100),
        totalChanges: changes.length,
    });
    error.name = 'WorkspaceConflictError';
    return error;
}

function validationError(message: string): AuthorityServiceError {
    return new AuthorityServiceError(message, 400, 'validation_error', 'validation');
}

function samePath(left: string, right: string): boolean {
    const normalize = (value: string) => process.platform === 'win32' ? path.resolve(value).toLowerCase() : path.resolve(value);
    return normalize(left) === normalize(right);
}

function isFsError(error: unknown, code: string): error is NodeJS.ErrnoException {
    return error instanceof Error && (error as NodeJS.ErrnoException).code === code;
}

function assertSameFile(before: fs.Stats, after: fs.Stats, relativePath: string): void {
    const sameKind = before.isFile() === after.isFile()
        && before.isDirectory() === after.isDirectory()
        && before.isSymbolicLink() === after.isSymbolicLink();
    const unchangedFile = !before.isFile()
        || (before.size === after.size && before.mtimeMs === after.mtimeMs);
    if (before.dev !== after.dev || before.ino !== after.ino || !sameKind || !unchangedFile) {
        throw workspaceConflict(`Workspace path changed while it was being captured: ${relativePath}`);
    }
}

function isProcessAlive(pid: number): boolean {
    try {
        process.kill(pid, 0);
        return true;
    } catch (error) {
        return !isFsError(error, 'ESRCH');
    }
}

function applyMode(filePath: string, mode: number): void {
    if (process.platform !== 'win32') {
        fs.chmodSync(filePath, mode);
    }
}

function delay(milliseconds: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, milliseconds));
}

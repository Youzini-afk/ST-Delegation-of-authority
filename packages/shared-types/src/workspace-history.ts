export type WorkspaceObjectId = string;

export type WorkspaceTreeEntryKind = 'blob' | 'tree' | 'symlink';

export interface WorkspaceTreeEntry {
    name: string;
    kind: WorkspaceTreeEntryKind;
    oid: WorkspaceObjectId;
    mode: number;
    sizeBytes?: number;
}

export interface WorkspaceTreeObject {
    format: 'authority-workspace-tree/v1';
    entries: WorkspaceTreeEntry[];
}

export interface WorkspaceCommitActor {
    kind: 'agent' | 'user' | 'rescue' | 'system';
    id?: string;
}

export interface WorkspaceCommitObject {
    format: 'authority-workspace-commit/v1';
    id: WorkspaceObjectId;
    workspaceId: string;
    tree: WorkspaceObjectId;
    parents: WorkspaceObjectId[];
    message: string;
    createdAt: string;
    actor: WorkspaceCommitActor;
    runId?: string;
    toolCallId?: string;
    metadata?: Record<string, unknown>;
}

export interface WorkspaceRefRecord {
    format: 'authority-workspace-ref/v1';
    workspaceId: string;
    name: string;
    head: WorkspaceObjectId | null;
    generation: number;
    updatedAt: string;
}

export interface AgentWorkspaceRecord {
    id: string;
    displayName: string;
    rootPath: string;
    defaultRef: string;
    headCommitId: WorkspaceObjectId | null;
    createdAt: string;
    updatedAt: string;
}

export interface AgentWorkspaceRegisterRequest {
    id?: string;
    displayName?: string;
    rootPath: string;
    defaultRef?: string;
}

export interface AgentWorkspaceListResponse {
    workspaces: AgentWorkspaceRecord[];
}

export interface WorkspaceCheckpointRequest {
    message: string;
    runId?: string;
    toolCallId?: string;
    paths?: string[];
    metadata?: Record<string, unknown>;
}

export interface WorkspaceCheckpointResponse {
    workspace: AgentWorkspaceRecord;
    commit: WorkspaceCommitObject;
    changedPaths: number;
    storedBytes: number;
    reusedBytes: number;
}

export type WorkspaceDiffStatus = 'added' | 'modified' | 'deleted' | 'type_changed';

export interface WorkspaceDiffEntry {
    path: string;
    status: WorkspaceDiffStatus;
    beforeKind?: WorkspaceTreeEntryKind;
    afterKind?: WorkspaceTreeEntryKind;
    beforeOid?: WorkspaceObjectId;
    afterOid?: WorkspaceObjectId;
    beforeSizeBytes?: number;
    afterSizeBytes?: number;
}

export interface WorkspaceDiffResponse {
    workspaceId: string;
    fromCommitId: WorkspaceObjectId | null;
    toCommitId: WorkspaceObjectId | null;
    entries: WorkspaceDiffEntry[];
}

export interface WorkspaceRollbackRequest {
    targetCommitId: WorkspaceObjectId;
    operationId?: string;
    force?: boolean;
    message?: string;
}

export interface WorkspaceRollbackResponse {
    operationId: string;
    workspace: AgentWorkspaceRecord;
    restoredCommitId: WorkspaceObjectId;
    rollbackCommit: WorkspaceCommitObject;
    changedPaths: number;
    warnings: string[];
}

export interface WorkspaceCommitListResponse {
    workspace: AgentWorkspaceRecord;
    commits: WorkspaceCommitObject[];
}

export interface WorkspaceStatusResponse {
    workspace: AgentWorkspaceRecord;
    dirty: boolean;
    changes: WorkspaceDiffEntry[];
    pendingRollback: {
        operationId: string;
        targetCommitId: WorkspaceObjectId;
        rollbackCommitId: WorkspaceObjectId;
        startedAt: string;
    } | null;
}

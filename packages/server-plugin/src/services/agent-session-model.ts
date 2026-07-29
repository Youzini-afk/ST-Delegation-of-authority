import type {
    AgentApprovalStatus,
    AgentExecutionMode,
    AgentToolExecution,
    AgentToolInvocationStatus,
} from '@stdo/shared-types';

export const AGENT_SESSION_MAIN_REF = 'main';

export type AgentSessionRunStatus =
    | 'queued'
    | 'running'
    | 'waiting_approval'
    | 'cancelling'
    | 'suspended'
    | 'completed'
    | 'failed'
    | 'cancelled';

export type AgentSessionQueueKind = 'steer' | 'follow_up' | 'next_run';

export interface AgentSessionDefinition {
    id: string;
    callerUserHandle: string;
    callerExtensionId: string;
    workspaceId: string;
    title: string;
    profileId: string;
    mode: AgentExecutionMode;
    allowedTools: string[];
    maxSteps: number;
    createdAt: string;
    updatedAt: string;
    archivedAt?: string;
}

export interface AgentSessionRefState {
    name: string;
    leafEntryId: string | null;
    activeRunId: string | null;
    createdAt: string;
    updatedAt: string;
}

interface AgentConversationEntryBase {
    id: string;
    sequence: number;
    ref: string;
    parentId: string | null;
    timestamp: string;
    runId?: string;
}

export interface AgentConversationMessageEntry extends AgentConversationEntryBase {
    kind: 'message';
    role: 'system' | 'user' | 'assistant' | 'tool';
    content: string | null;
    toolCallId?: string;
    toolCalls?: Array<{
        id: string;
        name: string;
        arguments: string;
    }>;
    stepId?: string;
    consumedQueueId?: string;
}

export interface AgentConversationCompactionEntry extends AgentConversationEntryBase {
    kind: 'compaction';
    summary: string;
    firstKeptEntryId: string;
    retainedEntryIds: string[];
    tokensBefore?: number;
}

export interface AgentConversationBranchSummaryEntry extends AgentConversationEntryBase {
    kind: 'branch_summary';
    fromEntryId: string;
    summary: string;
}

export type AgentConversationEntry =
    | AgentConversationMessageEntry
    | AgentConversationCompactionEntry
    | AgentConversationBranchSummaryEntry;

export interface AgentSessionRunState {
    id: string;
    ref: string;
    triggerMessageId: string;
    status: AgentSessionRunStatus;
    profileId: string;
    mode: AgentExecutionMode;
    allowedTools: string[];
    maxSteps: number;
    stepCount: number;
    createdAt: string;
    updatedAt: string;
    startedAt?: string;
    suspendedAt?: string;
    finishedAt?: string;
    cancelRequestedAt?: string;
    suspensionReason?: string;
    finalText?: string;
    error?: string;
    resumeCount: number;
}

export interface AgentSessionStepState {
    id: string;
    runId: string;
    index: number;
    status: 'running' | 'completed' | 'failed' | 'cancelled' | 'interrupted';
    createdAt: string;
    updatedAt: string;
    finishedAt?: string;
    finishReason?: string | null;
    usage?: unknown;
    error?: string;
}

export interface AgentSessionGenerationState {
    id: string;
    runId: string;
    stepId: string;
    attempt: number;
    status: 'running' | 'completed' | 'failed' | 'cancelled' | 'interrupted' | 'timed_out';
    createdAt: string;
    updatedAt: string;
    finishedAt?: string;
    responseStarted: boolean;
    providerRequestId?: string;
    finishReason?: string | null;
    usage?: unknown;
    error?: string;
}

export interface AgentSessionToolInvocationState {
    id: string;
    runId: string;
    stepId: string;
    callId: string;
    toolId: string;
    execution: AgentToolExecution;
    arguments: unknown;
    status: AgentToolInvocationStatus;
    createdAt: string;
    updatedAt: string;
    startedAt?: string;
    finishedAt?: string;
    deadlineAt?: string;
    claimId?: string;
    idempotencyKey?: string;
    result?: unknown;
    error?: string;
    beforeCommitId?: string;
    afterCommitId?: string;
    failureCommitId?: string;
}

export interface AgentSessionApprovalState {
    id: string;
    runId: string;
    invocationId: string;
    title: string;
    summary: string;
    arguments: unknown;
    riskLevel: 'low' | 'medium' | 'high';
    status: AgentApprovalStatus;
    createdAt: string;
    updatedAt: string;
    expiresAt?: string;
    resolvedAt?: string;
    resolvedByUserHandle?: string;
}

export interface AgentSessionPendingMessage {
    id: string;
    ref: string;
    kind: AgentSessionQueueKind;
    content: string;
    runId?: string;
    createdAt: string;
}

export interface AgentSessionSnapshot {
    session: AgentSessionDefinition;
    lastSequence: number;
    lastHash: string;
    refs: AgentSessionRefState[];
    conversation: AgentConversationEntry[];
    activePaths: Record<string, string[]>;
    runs: AgentSessionRunState[];
    steps: AgentSessionStepState[];
    generations: AgentSessionGenerationState[];
    invocations: AgentSessionToolInvocationState[];
    approvals: AgentSessionApprovalState[];
    pendingMessages: AgentSessionPendingMessage[];
}

interface AgentSessionEntryBase {
    id: string;
    type: string;
    timestamp: string;
}

export interface AgentSessionCreatedEntry extends AgentSessionEntryBase {
    type: 'session.created';
    callerUserHandle: string;
    callerExtensionId: string;
    workspaceId: string;
    title: string;
    profileId: string;
    mode: AgentExecutionMode;
    allowedTools: string[];
    maxSteps: number;
}

export interface AgentSessionUpdatedEntry extends AgentSessionEntryBase {
    type: 'session.updated';
    title?: string;
    profileId?: string;
    mode?: AgentExecutionMode;
    allowedTools?: string[];
    maxSteps?: number;
    archived?: boolean;
}

export interface AgentSessionRefCreatedEntry extends AgentSessionEntryBase {
    type: 'ref.created';
    ref: string;
    fromEntryId: string | null;
}

export interface AgentSessionRefMovedEntry extends AgentSessionEntryBase {
    type: 'ref.moved';
    ref: string;
    targetEntryId: string | null;
}

export interface AgentSessionConversationMessageLogEntry extends AgentSessionEntryBase {
    type: 'conversation.message';
    ref: string;
    parentId: string | null;
    role: AgentConversationMessageEntry['role'];
    content: string | null;
    toolCallId?: string;
    toolCalls?: AgentConversationMessageEntry['toolCalls'];
    runId?: string;
    stepId?: string;
    consumedQueueId?: string;
}

export interface AgentSessionConversationCompactedLogEntry extends AgentSessionEntryBase {
    type: 'conversation.compacted';
    ref: string;
    parentId: string | null;
    summary: string;
    firstKeptEntryId: string;
    retainedEntryIds: string[];
    tokensBefore?: number;
    runId?: string;
}

export interface AgentSessionConversationBranchSummaryLogEntry extends AgentSessionEntryBase {
    type: 'conversation.branch_summary';
    ref: string;
    parentId: string | null;
    fromEntryId: string;
    summary: string;
    runId?: string;
}

export interface AgentSessionQueueAddedEntry extends AgentSessionEntryBase {
    type: 'queue.added';
    queueId: string;
    ref: string;
    kind: AgentSessionQueueKind;
    content: string;
    runId?: string;
}

export interface AgentSessionQueueRemovedEntry extends AgentSessionEntryBase {
    type: 'queue.removed';
    queueId: string;
    reason: 'cancelled' | 'superseded' | 'run_finished';
}

export interface AgentSessionRunAcceptedEntry extends AgentSessionEntryBase {
    type: 'run.accepted';
    runId: string;
    ref: string;
    triggerMessageId: string;
    profileId: string;
    mode: AgentExecutionMode;
    allowedTools: string[];
    maxSteps: number;
}

export interface AgentSessionRunStartedEntry extends AgentSessionEntryBase {
    type: 'run.started';
    runId: string;
}

export interface AgentSessionRunResumedEntry extends AgentSessionEntryBase {
    type: 'run.resumed';
    runId: string;
}

export interface AgentSessionRunSuspendedEntry extends AgentSessionEntryBase {
    type: 'run.suspended';
    runId: string;
    reason: string;
}

export interface AgentSessionRunCancelRequestedEntry extends AgentSessionEntryBase {
    type: 'run.cancel_requested';
    runId: string;
}

export interface AgentSessionRunFinishedEntry extends AgentSessionEntryBase {
    type: 'run.finished';
    runId: string;
    outcome: 'completed' | 'failed' | 'cancelled';
    finalText?: string;
    error?: string;
}

export interface AgentSessionStepStartedEntry extends AgentSessionEntryBase {
    type: 'step.started';
    runId: string;
    stepId: string;
    index: number;
}

export interface AgentSessionStepFinishedEntry extends AgentSessionEntryBase {
    type: 'step.finished';
    runId: string;
    stepId: string;
    outcome: 'completed' | 'failed' | 'cancelled' | 'interrupted';
    finishReason?: string | null;
    usage?: unknown;
    error?: string;
}

export interface AgentSessionGenerationStartedEntry extends AgentSessionEntryBase {
    type: 'generation.started';
    runId: string;
    stepId: string;
    generationId: string;
    attempt: number;
}

export interface AgentSessionGenerationFinishedEntry extends AgentSessionEntryBase {
    type: 'generation.finished';
    runId: string;
    stepId: string;
    generationId: string;
    outcome: 'completed' | 'failed' | 'cancelled' | 'interrupted' | 'timed_out';
    responseStarted: boolean;
    providerRequestId?: string;
    finishReason?: string | null;
    usage?: unknown;
    error?: string;
}

export interface AgentSessionToolRequestedEntry extends AgentSessionEntryBase {
    type: 'tool.requested';
    runId: string;
    stepId: string;
    invocationId: string;
    callId: string;
    toolId: string;
    execution: AgentToolExecution;
    arguments: unknown;
    deadlineAt?: string;
}

export interface AgentSessionApprovalRequestedEntry extends AgentSessionEntryBase {
    type: 'approval.requested';
    approvalId: string;
    runId: string;
    invocationId: string;
    title: string;
    summary: string;
    arguments: unknown;
    riskLevel: AgentSessionApprovalState['riskLevel'];
    expiresAt?: string;
}

export interface AgentSessionApprovalResolvedEntry extends AgentSessionEntryBase {
    type: 'approval.resolved';
    approvalId: string;
    decision: 'approved' | 'denied' | 'expired' | 'cancelled';
    resolvedByUserHandle?: string;
}

export interface AgentSessionToolStartedEntry extends AgentSessionEntryBase {
    type: 'tool.started';
    invocationId: string;
    claimId?: string;
    idempotencyKey?: string;
}

export interface AgentSessionToolFinishedEntry extends AgentSessionEntryBase {
    type: 'tool.finished';
    invocationId: string;
    outcome: 'completed' | 'failed' | 'cancelled' | 'outcome_unknown' | 'timed_out';
    result?: unknown;
    error?: string;
}

export interface AgentSessionWorkspaceCheckpointEntry extends AgentSessionEntryBase {
    type: 'workspace.checkpointed';
    invocationId: string;
    phase: 'before' | 'after' | 'failure';
    commitId: string;
}

export type AgentSessionJournalEntry =
    | AgentSessionCreatedEntry
    | AgentSessionUpdatedEntry
    | AgentSessionRefCreatedEntry
    | AgentSessionRefMovedEntry
    | AgentSessionConversationMessageLogEntry
    | AgentSessionConversationCompactedLogEntry
    | AgentSessionConversationBranchSummaryLogEntry
    | AgentSessionQueueAddedEntry
    | AgentSessionQueueRemovedEntry
    | AgentSessionRunAcceptedEntry
    | AgentSessionRunStartedEntry
    | AgentSessionRunResumedEntry
    | AgentSessionRunSuspendedEntry
    | AgentSessionRunCancelRequestedEntry
    | AgentSessionRunFinishedEntry
    | AgentSessionStepStartedEntry
    | AgentSessionStepFinishedEntry
    | AgentSessionGenerationStartedEntry
    | AgentSessionGenerationFinishedEntry
    | AgentSessionToolRequestedEntry
    | AgentSessionApprovalRequestedEntry
    | AgentSessionApprovalResolvedEntry
    | AgentSessionToolStartedEntry
    | AgentSessionToolFinishedEntry
    | AgentSessionWorkspaceCheckpointEntry;

export interface AgentSessionJournalRecord {
    format: 'authority-agent-session-journal/v1';
    sessionId: string;
    sequence: number;
    previousHash: string | null;
    entry: AgentSessionJournalEntry;
    hash: string;
}

export interface AgentSessionProjection {
    session: AgentSessionDefinition | null;
    lastSequence: number;
    lastHash: string;
    refs: Map<string, AgentSessionRefState>;
    conversation: Map<string, AgentConversationEntry>;
    runs: Map<string, AgentSessionRunState>;
    steps: Map<string, AgentSessionStepState>;
    generations: Map<string, AgentSessionGenerationState>;
    invocations: Map<string, AgentSessionToolInvocationState>;
    approvals: Map<string, AgentSessionApprovalState>;
    pendingMessages: Map<string, AgentSessionPendingMessage>;
    entryBodies: Map<string, string>;
}

export function createAgentSessionProjection(): AgentSessionProjection {
    return {
        session: null,
        lastSequence: 0,
        lastHash: '',
        refs: new Map(),
        conversation: new Map(),
        runs: new Map(),
        steps: new Map(),
        generations: new Map(),
        invocations: new Map(),
        approvals: new Map(),
        pendingMessages: new Map(),
        entryBodies: new Map(),
    };
}

export function applyAgentSessionRecord(
    projection: AgentSessionProjection,
    record: AgentSessionJournalRecord,
    canonicalEntry: string,
): void {
    if (projection.entryBodies.has(record.entry.id)) {
        throw new Error(`Duplicate Agent session entry id: ${record.entry.id}`);
    }
    if (record.sequence !== projection.lastSequence + 1) {
        throw new Error(`Agent session sequence is not contiguous at ${record.sequence}`);
    }
    if (record.previousHash !== (projection.lastSequence === 0 ? null : projection.lastHash)) {
        throw new Error(`Agent session hash chain is broken at sequence ${record.sequence}`);
    }
    if (projection.session && projection.session.id !== record.sessionId) {
        throw new Error(`Agent session record belongs to a different session: ${record.sessionId}`);
    }

    applyEntry(projection, record);
    projection.lastSequence = record.sequence;
    projection.lastHash = record.hash;
    projection.entryBodies.set(record.entry.id, canonicalEntry);
    if (projection.session) {
        projection.session.updatedAt = record.entry.timestamp;
    }
}

export function snapshotAgentSession(projection: AgentSessionProjection): AgentSessionSnapshot {
    if (!projection.session) {
        throw new Error('Agent session has no creation entry');
    }
    const refs = sortByCreated([...projection.refs.values()]);
    const activePaths = Object.fromEntries(refs.map(ref => [ref.name, activePath(projection, ref.leafEntryId)]));
    return {
        session: structuredClone(projection.session),
        lastSequence: projection.lastSequence,
        lastHash: projection.lastHash,
        refs: structuredClone(refs),
        conversation: structuredClone(sortBySequence([...projection.conversation.values()])),
        activePaths,
        runs: structuredClone(sortByCreated([...projection.runs.values()])),
        steps: structuredClone(sortByCreated([...projection.steps.values()])),
        generations: structuredClone(sortByCreated([...projection.generations.values()])),
        invocations: structuredClone(sortByCreated([...projection.invocations.values()])),
        approvals: structuredClone(sortByCreated([...projection.approvals.values()])),
        pendingMessages: structuredClone(sortByCreated([...projection.pendingMessages.values()])),
    };
}

function applyEntry(projection: AgentSessionProjection, record: AgentSessionJournalRecord): void {
    const entry = record.entry;
    if (entry.type !== 'session.created' && !projection.session) {
        throw new Error('Agent session journal must begin with session.created');
    }

    switch (entry.type) {
        case 'session.created': {
            if (projection.session || record.sequence !== 1 || record.sessionId !== entry.id) {
                throw new Error('Agent session has an invalid creation entry');
            }
            projection.session = {
                id: record.sessionId,
                callerUserHandle: entry.callerUserHandle,
                callerExtensionId: entry.callerExtensionId,
                workspaceId: entry.workspaceId,
                title: entry.title,
                profileId: entry.profileId,
                mode: entry.mode,
                allowedTools: [...entry.allowedTools],
                maxSteps: entry.maxSteps,
                createdAt: entry.timestamp,
                updatedAt: entry.timestamp,
            };
            projection.refs.set(AGENT_SESSION_MAIN_REF, {
                name: AGENT_SESSION_MAIN_REF,
                leafEntryId: null,
                activeRunId: null,
                createdAt: entry.timestamp,
                updatedAt: entry.timestamp,
            });
            return;
        }
        case 'session.updated': {
            const session = requireSession(projection);
            if (entry.title !== undefined) session.title = entry.title;
            if (entry.profileId !== undefined) session.profileId = entry.profileId;
            if (entry.mode !== undefined) session.mode = entry.mode;
            if (entry.allowedTools !== undefined) session.allowedTools = [...entry.allowedTools];
            if (entry.maxSteps !== undefined) session.maxSteps = entry.maxSteps;
            if (entry.archived === true) session.archivedAt = entry.timestamp;
            if (entry.archived === false) delete session.archivedAt;
            return;
        }
        case 'ref.created': {
            if (projection.refs.has(entry.ref)) throw new Error(`Agent session ref already exists: ${entry.ref}`);
            requireConversationEntry(projection, entry.fromEntryId, true);
            projection.refs.set(entry.ref, {
                name: entry.ref,
                leafEntryId: entry.fromEntryId,
                activeRunId: null,
                createdAt: entry.timestamp,
                updatedAt: entry.timestamp,
            });
            return;
        }
        case 'ref.moved': {
            const ref = requireRef(projection, entry.ref);
            if (ref.activeRunId) throw new Error(`Cannot move Agent session ref with an active run: ${entry.ref}`);
            requireConversationEntry(projection, entry.targetEntryId, true);
            ref.leafEntryId = entry.targetEntryId;
            ref.updatedAt = entry.timestamp;
            return;
        }
        case 'conversation.message': {
            const ref = requireAppendParent(projection, entry.ref, entry.parentId);
            const run = entry.runId === undefined ? undefined : requireRun(projection, entry.runId);
            if (run && run.ref !== entry.ref) throw new Error(`Agent conversation run belongs to another ref: ${entry.runId}`);
            if (entry.stepId !== undefined) {
                if (!run) throw new Error(`Agent conversation step requires a run: ${entry.stepId}`);
                const step = requireStep(projection, entry.stepId);
                if (step.runId !== run.id) throw new Error(`Agent conversation step belongs to another run: ${entry.stepId}`);
                if (entry.role === 'assistant' && activeGeneration(projection, entry.stepId)) {
                    throw new Error(`Cannot append an Agent assistant message while generation is active: ${entry.stepId}`);
                }
            }
            if (entry.consumedQueueId !== undefined) consumeQueuedMessage(projection, entry);
            projection.conversation.set(entry.id, {
                id: entry.id,
                kind: 'message' as const,
                sequence: record.sequence,
                ref: entry.ref,
                parentId: entry.parentId,
                timestamp: entry.timestamp,
                role: entry.role,
                content: entry.content,
                ...(entry.toolCallId === undefined ? {} : { toolCallId: entry.toolCallId }),
                ...(entry.toolCalls === undefined ? {} : { toolCalls: structuredClone(entry.toolCalls) }),
                ...(entry.runId === undefined ? {} : { runId: entry.runId }),
                ...(entry.stepId === undefined ? {} : { stepId: entry.stepId }),
                ...(entry.consumedQueueId === undefined ? {} : { consumedQueueId: entry.consumedQueueId }),
            });
            advanceRef(ref, entry.id, entry.timestamp);
            return;
        }
        case 'conversation.compacted': {
            const ref = requireAppendParent(projection, entry.ref, entry.parentId);
            if (entry.runId !== undefined && requireRun(projection, entry.runId).ref !== entry.ref) {
                throw new Error(`Agent compaction run belongs to another ref: ${entry.runId}`);
            }
            requireConversationEntry(projection, entry.firstKeptEntryId);
            for (const retainedId of entry.retainedEntryIds) requireConversationEntry(projection, retainedId);
            projection.conversation.set(entry.id, {
                id: entry.id,
                kind: 'compaction' as const,
                sequence: record.sequence,
                ref: entry.ref,
                parentId: entry.parentId,
                timestamp: entry.timestamp,
                summary: entry.summary,
                firstKeptEntryId: entry.firstKeptEntryId,
                retainedEntryIds: [...entry.retainedEntryIds],
                ...(entry.tokensBefore === undefined ? {} : { tokensBefore: entry.tokensBefore }),
                ...(entry.runId === undefined ? {} : { runId: entry.runId }),
            });
            advanceRef(ref, entry.id, entry.timestamp);
            return;
        }
        case 'conversation.branch_summary': {
            const ref = requireAppendParent(projection, entry.ref, entry.parentId);
            if (entry.runId !== undefined && requireRun(projection, entry.runId).ref !== entry.ref) {
                throw new Error(`Agent branch summary run belongs to another ref: ${entry.runId}`);
            }
            requireConversationEntry(projection, entry.fromEntryId);
            projection.conversation.set(entry.id, {
                id: entry.id,
                kind: 'branch_summary' as const,
                sequence: record.sequence,
                ref: entry.ref,
                parentId: entry.parentId,
                timestamp: entry.timestamp,
                fromEntryId: entry.fromEntryId,
                summary: entry.summary,
                ...(entry.runId === undefined ? {} : { runId: entry.runId }),
            });
            advanceRef(ref, entry.id, entry.timestamp);
            return;
        }
        case 'queue.added': {
            if (projection.pendingMessages.has(entry.queueId)) throw new Error(`Queued Agent message already exists: ${entry.queueId}`);
            const ref = requireRef(projection, entry.ref);
            if (entry.kind !== 'next_run') {
                if (!entry.runId || ref.activeRunId !== entry.runId) {
                    throw new Error(`${entry.kind} requires the active Agent run`);
                }
            } else if (entry.runId !== undefined) {
                const run = requireRun(projection, entry.runId);
                if (run.ref !== entry.ref) throw new Error(`Queued Agent message run belongs to another ref: ${entry.queueId}`);
            }
            projection.pendingMessages.set(entry.queueId, {
                id: entry.queueId,
                ref: entry.ref,
                kind: entry.kind,
                content: entry.content,
                ...(entry.runId === undefined ? {} : { runId: entry.runId }),
                createdAt: entry.timestamp,
            });
            return;
        }
        case 'queue.removed': {
            if (!projection.pendingMessages.delete(entry.queueId)) throw new Error(`Queued Agent message not found: ${entry.queueId}`);
            return;
        }
        case 'run.accepted': {
            if (projection.runs.has(entry.runId)) throw new Error(`Agent session run already exists: ${entry.runId}`);
            const ref = requireRef(projection, entry.ref);
            if (ref.activeRunId) throw new Error(`Agent session ref already has an active run: ${entry.ref}`);
            const trigger = requireConversationEntry(projection, entry.triggerMessageId);
            if (trigger.kind !== 'message' || trigger.role !== 'user' || ref.leafEntryId !== trigger.id) {
                throw new Error('Agent run trigger must be the active user message');
            }
            projection.runs.set(entry.runId, {
                id: entry.runId,
                ref: entry.ref,
                triggerMessageId: entry.triggerMessageId,
                status: 'queued',
                profileId: entry.profileId,
                mode: entry.mode,
                allowedTools: [...entry.allowedTools],
                maxSteps: entry.maxSteps,
                stepCount: 0,
                createdAt: entry.timestamp,
                updatedAt: entry.timestamp,
                resumeCount: 0,
            });
            ref.activeRunId = entry.runId;
            ref.updatedAt = entry.timestamp;
            return;
        }
        case 'run.started': {
            const run = requireRunStatus(projection, entry.runId, ['queued']);
            run.status = 'running';
            run.startedAt = entry.timestamp;
            run.updatedAt = entry.timestamp;
            return;
        }
        case 'run.resumed': {
            const run = requireRunStatus(projection, entry.runId, ['suspended']);
            run.status = 'running';
            run.resumeCount += 1;
            run.updatedAt = entry.timestamp;
            delete run.suspendedAt;
            delete run.suspensionReason;
            return;
        }
        case 'run.suspended': {
            const run = requireRunStatus(projection, entry.runId, ['queued', 'running', 'cancelling']);
            run.status = 'suspended';
            run.suspendedAt = entry.timestamp;
            run.suspensionReason = entry.reason;
            run.updatedAt = entry.timestamp;
            return;
        }
        case 'run.cancel_requested': {
            const run = requireRunStatus(projection, entry.runId, ['queued', 'running', 'waiting_approval', 'suspended']);
            run.status = 'cancelling';
            run.cancelRequestedAt = entry.timestamp;
            run.updatedAt = entry.timestamp;
            return;
        }
        case 'run.finished': {
            const run = requireRunStatus(projection, entry.runId, ['queued', 'running', 'waiting_approval', 'cancelling', 'suspended']);
            if (activeStep(projection, entry.runId)) throw new Error(`Cannot finish Agent run with an active step: ${entry.runId}`);
            run.status = entry.outcome;
            run.finishedAt = entry.timestamp;
            run.updatedAt = entry.timestamp;
            if (entry.finalText !== undefined) run.finalText = entry.finalText;
            if (entry.error !== undefined) run.error = entry.error;
            const ref = requireRef(projection, run.ref);
            if (ref.activeRunId !== run.id) throw new Error(`Agent run is not active on ref ${run.ref}`);
            ref.activeRunId = null;
            ref.updatedAt = entry.timestamp;
            return;
        }
        case 'step.started': {
            const run = requireRunStatus(projection, entry.runId, ['running']);
            if (projection.steps.has(entry.stepId)) throw new Error(`Agent step already exists: ${entry.stepId}`);
            if (activeStep(projection, entry.runId)) throw new Error(`Agent run already has an active step: ${entry.runId}`);
            if (entry.index !== run.stepCount + 1 || entry.index > run.maxSteps) throw new Error(`Invalid Agent step index: ${entry.index}`);
            projection.steps.set(entry.stepId, {
                id: entry.stepId,
                runId: entry.runId,
                index: entry.index,
                status: 'running',
                createdAt: entry.timestamp,
                updatedAt: entry.timestamp,
            });
            return;
        }
        case 'step.finished': {
            const step = requireStepStatus(projection, entry.stepId, ['running']);
            if (step.runId !== entry.runId) throw new Error(`Agent step does not belong to run: ${entry.stepId}`);
            if (activeGeneration(projection, entry.stepId)) throw new Error(`Cannot finish Agent step with an active generation: ${entry.stepId}`);
            if (activeInvocation(projection, entry.stepId)) throw new Error(`Cannot finish Agent step with an active tool: ${entry.stepId}`);
            step.status = entry.outcome;
            step.finishedAt = entry.timestamp;
            step.updatedAt = entry.timestamp;
            if (entry.finishReason !== undefined) step.finishReason = entry.finishReason;
            if (entry.usage !== undefined) step.usage = structuredClone(entry.usage);
            if (entry.error !== undefined) step.error = entry.error;
            const run = requireRun(projection, entry.runId);
            run.stepCount = Math.max(run.stepCount, step.index);
            run.updatedAt = entry.timestamp;
            return;
        }
        case 'generation.started': {
            const step = requireStepStatus(projection, entry.stepId, ['running']);
            if (step.runId !== entry.runId) throw new Error(`Agent generation step does not belong to run: ${entry.stepId}`);
            if (projection.generations.has(entry.generationId)) throw new Error(`Agent generation already exists: ${entry.generationId}`);
            if (activeGeneration(projection, entry.stepId)) throw new Error(`Agent step already has an active generation: ${entry.stepId}`);
            const attempts = [...projection.generations.values()].filter(item => item.stepId === entry.stepId).length;
            if (entry.attempt !== attempts + 1) throw new Error(`Invalid Agent generation attempt: ${entry.attempt}`);
            projection.generations.set(entry.generationId, {
                id: entry.generationId,
                runId: entry.runId,
                stepId: entry.stepId,
                attempt: entry.attempt,
                status: 'running',
                createdAt: entry.timestamp,
                updatedAt: entry.timestamp,
                responseStarted: false,
            });
            return;
        }
        case 'generation.finished': {
            const generation = requireGenerationStatus(projection, entry.generationId, ['running']);
            if (generation.runId !== entry.runId || generation.stepId !== entry.stepId) {
                throw new Error(`Agent generation identity mismatch: ${entry.generationId}`);
            }
            generation.status = entry.outcome;
            generation.responseStarted = entry.responseStarted;
            generation.finishedAt = entry.timestamp;
            generation.updatedAt = entry.timestamp;
            if (entry.providerRequestId !== undefined) generation.providerRequestId = entry.providerRequestId;
            if (entry.finishReason !== undefined) generation.finishReason = entry.finishReason;
            if (entry.usage !== undefined) generation.usage = structuredClone(entry.usage);
            if (entry.error !== undefined) generation.error = entry.error;
            return;
        }
        case 'tool.requested': {
            const step = requireStepStatus(projection, entry.stepId, ['running']);
            if (step.runId !== entry.runId) throw new Error(`Agent tool step does not belong to run: ${entry.stepId}`);
            if (activeGeneration(projection, entry.stepId)) throw new Error(`Cannot request an Agent tool while generation is active: ${entry.stepId}`);
            if (projection.invocations.has(entry.invocationId)) throw new Error(`Agent tool invocation already exists: ${entry.invocationId}`);
            if ([...projection.invocations.values()].some(item => item.runId === entry.runId && item.callId === entry.callId)) {
                throw new Error(`Duplicate Agent tool call id: ${entry.callId}`);
            }
            projection.invocations.set(entry.invocationId, {
                id: entry.invocationId,
                runId: entry.runId,
                stepId: entry.stepId,
                callId: entry.callId,
                toolId: entry.toolId,
                execution: entry.execution,
                arguments: structuredClone(entry.arguments),
                status: 'pending' as const,
                createdAt: entry.timestamp,
                updatedAt: entry.timestamp,
                ...(entry.deadlineAt === undefined ? {} : { deadlineAt: entry.deadlineAt }),
            });
            return;
        }
        case 'approval.requested': {
            if (projection.approvals.has(entry.approvalId)) throw new Error(`Agent approval already exists: ${entry.approvalId}`);
            const invocation = requireInvocationStatus(projection, entry.invocationId, ['pending']);
            if (invocation.runId !== entry.runId) throw new Error(`Agent approval run mismatch: ${entry.approvalId}`);
            projection.approvals.set(entry.approvalId, {
                id: entry.approvalId,
                runId: entry.runId,
                invocationId: entry.invocationId,
                title: entry.title,
                summary: entry.summary,
                arguments: structuredClone(entry.arguments),
                riskLevel: entry.riskLevel,
                status: 'pending' as const,
                createdAt: entry.timestamp,
                updatedAt: entry.timestamp,
                ...(entry.expiresAt === undefined ? {} : { expiresAt: entry.expiresAt }),
            });
            invocation.status = 'waiting_approval';
            invocation.updatedAt = entry.timestamp;
            const run = requireRunStatus(projection, entry.runId, ['running']);
            run.status = 'waiting_approval';
            run.updatedAt = entry.timestamp;
            return;
        }
        case 'approval.resolved': {
            const approval = requireApprovalStatus(projection, entry.approvalId, ['pending']);
            approval.status = entry.decision;
            approval.updatedAt = entry.timestamp;
            approval.resolvedAt = entry.timestamp;
            if (entry.resolvedByUserHandle !== undefined) approval.resolvedByUserHandle = entry.resolvedByUserHandle;
            const invocation = requireInvocationStatus(projection, approval.invocationId, ['waiting_approval']);
            invocation.status = entry.decision === 'approved' ? 'pending' : 'cancelled';
            invocation.updatedAt = entry.timestamp;
            const run = requireRunStatus(projection, approval.runId, ['waiting_approval']);
            if (![...projection.approvals.values()].some(item => item.runId === run.id && item.status === 'pending')) {
                run.status = 'running';
                run.updatedAt = entry.timestamp;
            }
            return;
        }
        case 'tool.started': {
            const invocation = requireInvocationStatus(projection, entry.invocationId, ['pending']);
            invocation.status = 'claimed';
            invocation.startedAt = entry.timestamp;
            invocation.updatedAt = entry.timestamp;
            if (entry.claimId !== undefined) invocation.claimId = entry.claimId;
            if (entry.idempotencyKey !== undefined) invocation.idempotencyKey = entry.idempotencyKey;
            return;
        }
        case 'tool.finished': {
            const invocation = requireInvocationStatus(projection, entry.invocationId, ['pending', 'claimed', 'cancelled']);
            invocation.status = entry.outcome;
            invocation.finishedAt = entry.timestamp;
            invocation.updatedAt = entry.timestamp;
            if (entry.result !== undefined) invocation.result = structuredClone(entry.result);
            if (entry.error !== undefined) invocation.error = entry.error;
            return;
        }
        case 'workspace.checkpointed': {
            const invocation = requireInvocation(projection, entry.invocationId);
            if (entry.phase === 'before') invocation.beforeCommitId = entry.commitId;
            if (entry.phase === 'after') invocation.afterCommitId = entry.commitId;
            if (entry.phase === 'failure') invocation.failureCommitId = entry.commitId;
            invocation.updatedAt = entry.timestamp;
            return;
        }
    }
}

function requireSession(projection: AgentSessionProjection): AgentSessionDefinition {
    if (!projection.session) throw new Error('Agent session has not been created');
    return projection.session;
}

function requireRef(projection: AgentSessionProjection, name: string): AgentSessionRefState {
    const ref = projection.refs.get(name);
    if (!ref) throw new Error(`Agent session ref not found: ${name}`);
    return ref;
}

function requireAppendParent(projection: AgentSessionProjection, refName: string, parentId: string | null): AgentSessionRefState {
    const ref = requireRef(projection, refName);
    if (ref.leafEntryId !== parentId) throw new Error(`Agent conversation parent is not the active leaf for ref ${refName}`);
    requireConversationEntry(projection, parentId, true);
    return ref;
}

function requireConversationEntry(
    projection: AgentSessionProjection,
    id: string | null,
    allowNull = false,
): AgentConversationEntry {
    if (id === null && allowNull) return null as never;
    const entry = id === null ? undefined : projection.conversation.get(id);
    if (!entry) throw new Error(`Agent conversation entry not found: ${id ?? '<root>'}`);
    return entry;
}

function requireRun(projection: AgentSessionProjection, id: string): AgentSessionRunState {
    const run = projection.runs.get(id);
    if (!run) throw new Error(`Agent session run not found: ${id}`);
    return run;
}

function requireRunStatus(
    projection: AgentSessionProjection,
    id: string,
    statuses: AgentSessionRunStatus[],
): AgentSessionRunState {
    const run = requireRun(projection, id);
    if (!statuses.includes(run.status)) throw new Error(`Agent run ${id} is ${run.status}; expected ${statuses.join(' or ')}`);
    return run;
}

function requireStep(projection: AgentSessionProjection, id: string): AgentSessionStepState {
    const step = projection.steps.get(id);
    if (!step) throw new Error(`Agent step not found: ${id}`);
    return step;
}

function requireStepStatus(
    projection: AgentSessionProjection,
    id: string,
    statuses: AgentSessionStepState['status'][],
): AgentSessionStepState {
    const step = requireStep(projection, id);
    if (!statuses.includes(step.status)) throw new Error(`Agent step ${id} is ${step.status}; expected ${statuses.join(' or ')}`);
    return step;
}

function requireGenerationStatus(
    projection: AgentSessionProjection,
    id: string,
    statuses: AgentSessionGenerationState['status'][],
): AgentSessionGenerationState {
    const generation = projection.generations.get(id);
    if (!generation) throw new Error(`Agent generation not found: ${id}`);
    if (!statuses.includes(generation.status)) throw new Error(`Agent generation ${id} is ${generation.status}; expected ${statuses.join(' or ')}`);
    return generation;
}

function requireInvocation(projection: AgentSessionProjection, id: string): AgentSessionToolInvocationState {
    const invocation = projection.invocations.get(id);
    if (!invocation) throw new Error(`Agent tool invocation not found: ${id}`);
    return invocation;
}

function requireInvocationStatus(
    projection: AgentSessionProjection,
    id: string,
    statuses: AgentToolInvocationStatus[],
): AgentSessionToolInvocationState {
    const invocation = requireInvocation(projection, id);
    if (!statuses.includes(invocation.status)) {
        throw new Error(`Agent tool invocation ${id} is ${invocation.status}; expected ${statuses.join(' or ')}`);
    }
    return invocation;
}

function requireApprovalStatus(
    projection: AgentSessionProjection,
    id: string,
    statuses: AgentApprovalStatus[],
): AgentSessionApprovalState {
    const approval = projection.approvals.get(id);
    if (!approval) throw new Error(`Agent approval not found: ${id}`);
    if (!statuses.includes(approval.status)) throw new Error(`Agent approval ${id} is ${approval.status}; expected ${statuses.join(' or ')}`);
    return approval;
}

function activeStep(projection: AgentSessionProjection, runId: string): AgentSessionStepState | undefined {
    return [...projection.steps.values()].find(step => step.runId === runId && step.status === 'running');
}

function activeGeneration(projection: AgentSessionProjection, stepId: string): AgentSessionGenerationState | undefined {
    return [...projection.generations.values()].find(generation => generation.stepId === stepId && generation.status === 'running');
}

function activeInvocation(projection: AgentSessionProjection, stepId: string): AgentSessionToolInvocationState | undefined {
    const terminal = new Set<AgentToolInvocationStatus>(['completed', 'failed', 'cancelled', 'outcome_unknown', 'timed_out']);
    return [...projection.invocations.values()].find(invocation => invocation.stepId === stepId && !terminal.has(invocation.status));
}

function consumeQueuedMessage(
    projection: AgentSessionProjection,
    entry: AgentSessionConversationMessageLogEntry,
): void {
    const queued = projection.pendingMessages.get(entry.consumedQueueId!);
    if (!queued) throw new Error(`Queued Agent message not found: ${entry.consumedQueueId}`);
    if (queued.ref !== entry.ref || queued.content !== entry.content || entry.role !== 'user') {
        throw new Error(`Queued Agent message does not match conversation entry: ${entry.consumedQueueId}`);
    }
    projection.pendingMessages.delete(queued.id);
}

function advanceRef(ref: AgentSessionRefState, entryId: string, timestamp: string): void {
    ref.leafEntryId = entryId;
    ref.updatedAt = timestamp;
}

function activePath(projection: AgentSessionProjection, leafId: string | null): string[] {
    const result: string[] = [];
    const visited = new Set<string>();
    let current = leafId;
    while (current !== null) {
        if (visited.has(current)) throw new Error(`Agent conversation contains a parent cycle at ${current}`);
        visited.add(current);
        const entry = requireConversationEntry(projection, current);
        result.push(entry.id);
        current = entry.parentId;
    }
    return result.reverse();
}

function sortBySequence<T extends { sequence: number }>(values: T[]): T[] {
    return values.sort((left, right) => left.sequence - right.sequence);
}

function sortByCreated<T extends { createdAt: string; id?: string; name?: string }>(values: T[]): T[] {
    return values.sort((left, right) => left.createdAt.localeCompare(right.createdAt)
        || (left.id ?? left.name ?? '').localeCompare(right.id ?? right.name ?? ''));
}

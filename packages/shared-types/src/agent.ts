import type { CursorPageInfo, CursorPageRequest } from './common.js';
import type { RiskLevel } from './permissions.js';

export type AgentExecutionMode = 'plan' | 'ask' | 'auto';

export type AgentRunStatus =
    | 'queued'
    | 'running'
    | 'waiting_approval'
    | 'waiting_browser_tool'
    | 'completed'
    | 'failed'
    | 'cancelled'
    | 'interrupted';

export type AgentToolExecution = 'host' | 'module' | 'browser';

export type AgentToolApprovalPolicy = 'never' | 'on-mutation' | 'always';

export type AgentToolSource =
    | { kind: 'host'; handler: string }
    | { kind: 'module'; moduleId: string; transactionName: string }
    | { kind: 'browser'; userHandle: string; extensionId: string; browserInstanceId: string; registrationId: string };

export interface AgentToolDescriptor {
    id: string;
    title: string;
    description: string;
    inputSchema: Record<string, unknown>;
    outputSchema?: Record<string, unknown>;
    execution: AgentToolExecution;
    riskLevel: RiskLevel;
    approvalPolicy: AgentToolApprovalPolicy;
    mutatesWorkspace: boolean;
    source: AgentToolSource;
}

export interface AgentLlmProfileInput {
    id?: string;
    displayName: string;
    provider: 'openai-compatible';
    baseUrl: string;
    model: string;
    apiKey?: string;
    temperature?: number;
    maxOutputTokens?: number;
    timeoutMs?: number;
}

export interface AgentLlmProfile {
    id: string;
    displayName: string;
    provider: 'openai-compatible';
    baseUrl: string;
    model: string;
    apiKeyConfigured: boolean;
    apiKeyMasked: string | null;
    apiKeyFingerprint: string | null;
    temperature: number | null;
    maxOutputTokens: number | null;
    timeoutMs: number;
    createdAt: string;
    updatedAt: string;
}

/**
 * Durable Agent v2 transport model. A Session is the long-lived product
 * object; Runs and their lower-level records remain execution diagnostics.
 */
export type AgentSessionRunStatus =
    | 'queued'
    | 'running'
    | 'waiting_approval'
    | 'waiting_tool'
    | 'cancelling'
    | 'suspended'
    | 'completed'
    | 'failed'
    | 'cancelled';

export type AgentSessionStatus = 'idle' | AgentSessionRunStatus;
export type AgentSessionQueueKind = 'steer' | 'follow_up' | 'next_run';
export type AgentSessionDelivery = 'auto' | 'steer' | 'follow_up';
export type AgentProviderRequestState = 'not_sent' | 'sent_or_unknown' | 'response_received';

export interface AgentSessionCreateRequest {
    workspaceId: string;
    profileId?: string;
    title?: string;
    mode?: AgentExecutionMode;
    allowedTools?: string[];
    maxSteps?: number;
    message?: string;
    instructions?: string;
    context?: unknown;
}

export interface AgentSessionUpdateRequest {
    title?: string;
    profileId?: string;
    mode?: AgentExecutionMode;
    allowedTools?: string[];
    maxSteps?: number;
    archived?: boolean;
}

export interface AgentSessionSendRequest {
    content: string;
    ref?: string;
    delivery?: AgentSessionDelivery;
}

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

export interface AgentSessionSummary extends AgentSessionDefinition {
    status: AgentSessionStatus;
    activeRunId: string | null;
    activeRunStatus: AgentSessionRunStatus | null;
    messageCount: number;
    pendingApprovalCount: number;
    pendingMessageCount: number;
    lastMessagePreview: string | null;
    lastSequence: number;
}

export interface AgentSessionListRequest {
    page?: CursorPageRequest;
    archived?: boolean;
}

export interface AgentSessionListResponse {
    sessions: AgentSessionSummary[];
    page: CursorPageInfo;
}

export interface AgentSessionRef {
    name: string;
    leafEntryId: string | null;
    activeRunId: string | null;
    createdAt: string;
    updatedAt: string;
}

interface AgentSessionConversationEntryBase {
    id: string;
    sequence: number;
    ref: string;
    parentId: string | null;
    timestamp: string;
    runId?: string;
}

export interface AgentSessionConversationMessage extends AgentSessionConversationEntryBase {
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

export interface AgentSessionConversationCompaction extends AgentSessionConversationEntryBase {
    kind: 'compaction';
    summary: string;
    firstKeptEntryId: string;
    retainedEntryIds: string[];
    tokensBefore?: number;
}

export interface AgentSessionConversationBranchSummary extends AgentSessionConversationEntryBase {
    kind: 'branch_summary';
    fromEntryId: string;
    summary: string;
}

export type AgentSessionConversationEntry =
    | AgentSessionConversationMessage
    | AgentSessionConversationCompaction
    | AgentSessionConversationBranchSummary;

export interface AgentSessionRun {
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

export interface AgentSessionStep {
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

export interface AgentSessionGeneration {
    id: string;
    runId: string;
    stepId: string;
    attempt: number;
    status: 'running' | 'completed' | 'failed' | 'cancelled' | 'interrupted' | 'timed_out';
    createdAt: string;
    updatedAt: string;
    finishedAt?: string;
    providerRequestState: AgentProviderRequestState;
    providerRequestId?: string;
    finishReason?: string | null;
    usage?: unknown;
    error?: string;
}

export interface AgentSessionToolInvocation {
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
    result?: unknown;
    error?: string;
    beforeCommitId?: string;
    afterCommitId?: string;
    failureCommitId?: string;
}

export interface AgentSessionApproval {
    id: string;
    runId: string;
    invocationId: string;
    title: string;
    summary: string;
    arguments: unknown;
    riskLevel: RiskLevel;
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
    refs: AgentSessionRef[];
    conversation: AgentSessionConversationEntry[];
    activePaths: Record<string, string[]>;
    runs: AgentSessionRun[];
    steps: AgentSessionStep[];
    generations: AgentSessionGeneration[];
    invocations: AgentSessionToolInvocation[];
    approvals: AgentSessionApproval[];
    pendingMessages: AgentSessionPendingMessage[];
}

export interface AgentSessionSendResponse {
    snapshot: AgentSessionSnapshot;
    runId: string | null;
    queuedMessageId: string | null;
}

export interface AgentSessionEvent {
    sessionId: string;
    sequence: number;
    type: string;
    timestamp: string;
}

export interface AgentSessionBrowserToolClaimResponse {
    sessionId: string | null;
    invocation: AgentSessionToolInvocation | null;
}

export interface AgentRunCreateRequest {
    goal: string;
    context?: unknown;
    instructions?: string;
    workspaceId: string;
    profileId?: string;
    mode?: AgentExecutionMode;
    allowedTools?: string[];
    maxSteps?: number;
}

export interface AgentRunRecord {
    id: string;
    callerUserHandle: string;
    callerExtensionId: string;
    workspaceId: string;
    profileId: string;
    goal: string;
    mode: AgentExecutionMode;
    status: AgentRunStatus;
    allowedTools: string[];
    stepCount: number;
    maxSteps: number;
    createdAt: string;
    updatedAt: string;
    startedAt?: string;
    finishedAt?: string;
    finalText?: string;
    error?: string;
    headCommitId?: string;
    pendingApprovalId?: string;
}

export interface AgentRunListRequest {
    page?: CursorPageRequest;
    status?: AgentRunStatus;
}

export interface AgentRunListResponse {
    runs: AgentRunRecord[];
    page: CursorPageInfo;
}

export interface AgentRunPruneRequest {
    retainLatest?: number;
}

export interface AgentRunPruneResponse {
    deletedRuns: number;
    reclaimedBytes: number;
    retainedTerminalRuns: number;
    activeRuns: number;
}

export type AgentRunEventType =
    | 'run.created'
    | 'run.started'
    | 'assistant.message'
    | 'tool.requested'
    | 'tool.waiting_approval'
    | 'tool.waiting_browser'
    | 'tool.approval_resolved'
    | 'tool.started'
    | 'tool.completed'
    | 'tool.failed'
    | 'workspace.checkpoint'
    | 'run.completed'
    | 'run.failed'
    | 'run.cancelled'
    | 'run.interrupted';

export interface AgentRunEvent {
    sequence: number;
    runId: string;
    type: AgentRunEventType;
    timestamp: string;
    payload?: unknown;
}

export interface AgentRunMessage {
    role: 'system' | 'user' | 'assistant' | 'tool';
    content: string | null;
    toolCallId?: string;
    toolCalls?: Array<{
        id: string;
        name: string;
        arguments: string;
    }>;
}

export interface AgentRunDetail {
    run: AgentRunRecord;
    messages: AgentRunMessage[];
    events: AgentRunEvent[];
    invocations: AgentToolInvocation[];
    approvals: AgentApprovalRecord[];
    context?: unknown;
    instructions?: string;
}

export type AgentToolInvocationStatus =
    | 'pending'
    | 'waiting_approval'
    | 'claimed'
    | 'completed'
    | 'failed'
    | 'cancelled'
    | 'outcome_unknown'
    | 'timed_out';

export interface AgentToolInvocation {
    callId: string;
    runId: string;
    toolId: string;
    execution: AgentToolExecution;
    arguments: unknown;
    status: AgentToolInvocationStatus;
    createdAt: string;
    updatedAt: string;
    deadlineAt: string;
    browserInstanceId?: string;
    claimId?: string;
    result?: unknown;
    error?: string;
}

export interface AgentToolResultRequest {
    runId: string;
    callId: string;
    claimId: string;
    browserInstanceId: string;
    status: 'completed' | 'failed' | 'cancelled';
    result?: unknown;
    error?: string;
}

export type AgentApprovalStatus = 'pending' | 'approved' | 'denied' | 'expired' | 'cancelled';

export interface AgentApprovalRecord {
    id: string;
    runId: string;
    callId: string;
    toolId: string;
    title: string;
    summary: string;
    arguments: unknown;
    riskLevel: RiskLevel;
    status: AgentApprovalStatus;
    createdAt: string;
    updatedAt: string;
    expiresAt?: string;
    resolvedAt?: string;
    resolvedByUserHandle?: string;
}

export interface AgentApprovalResolveRequest {
    decision: 'approve' | 'deny';
}

export interface AgentBrowserToolRegistrationRequest {
    browserInstanceId: string;
    leaseDurationMs?: number;
    tools: Array<Omit<AgentToolDescriptor, 'execution' | 'source'>>;
}

export interface AgentBrowserToolRegistrationResponse {
    browserInstanceId: string;
    registrationId: string;
    leaseExpiresAt: string;
    tools: AgentToolDescriptor[];
}

export interface AgentBrowserToolClaimRequest {
    browserInstanceId: string;
    claimId: string;
    callId?: string;
}

export interface AgentBrowserToolClaimResponse {
    invocation: AgentToolInvocation | null;
}

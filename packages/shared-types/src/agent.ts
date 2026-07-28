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
    | { kind: 'browser'; extensionId: string; browserInstanceId: string };

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
    temperature: number | null;
    maxOutputTokens: number | null;
    timeoutMs: number;
    createdAt: string;
    updatedAt: string;
}

export interface AgentRunCreateRequest {
    goal: string;
    context?: unknown;
    instructions?: string;
    workspaceId?: string;
    profileId?: string;
    mode?: AgentExecutionMode;
    allowedTools?: string[];
    maxSteps?: number;
}

export interface AgentRunRecord {
    id: string;
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

export type AgentRunEventType =
    | 'run.created'
    | 'run.started'
    | 'assistant.message'
    | 'tool.requested'
    | 'tool.waiting_approval'
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

export type AgentToolInvocationStatus =
    | 'pending'
    | 'waiting_approval'
    | 'claimed'
    | 'completed'
    | 'failed'
    | 'cancelled'
    | 'timed_out';

export interface AgentToolInvocation {
    callId: string;
    runId: string;
    toolId: string;
    arguments: unknown;
    status: AgentToolInvocationStatus;
    createdAt: string;
    updatedAt: string;
    deadlineAt: string;
    browserInstanceId?: string;
    result?: unknown;
    error?: string;
}

export interface AgentToolResultRequest {
    callId: string;
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
    leaseExpiresAt: string;
    tools: AgentToolDescriptor[];
}

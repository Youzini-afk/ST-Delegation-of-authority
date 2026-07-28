import crypto from 'node:crypto';
import type {
    AgentApprovalRecord,
    AgentApprovalResolveRequest,
    AgentExecutionMode,
    AgentLlmProfile,
    AgentLlmProfileInput,
    AgentRunCreateRequest,
    AgentRunDetail,
    AgentRunEvent,
    AgentRunMessage,
    AgentRunRecord,
    AgentToolDescriptor,
    AgentToolInvocation,
} from '@stdo/shared-types';
import { AgentHostToolService } from './agent-host-tools.js';
import {
    AgentLlmClient,
    type AgentCompletionRequester,
    type AgentLlmToolDefinition,
} from './agent-llm-client.js';
import { AgentStoreService } from './agent-store-service.js';
import { WorkspaceHistoryService } from './workspace-history-service.js';

const DEFAULT_MAX_STEPS = 24;
const HARD_MAX_STEPS = 64;
const MAX_CONTEXT_CHARS = 64 * 1024;
const MAX_TOOL_ARGUMENT_CHARS = 128 * 1024;
const MAX_TOOL_RESULT_CHARS = 256 * 1024;
const TERMINAL_RUNS = new Set(['completed', 'failed', 'cancelled', 'interrupted']);

type ApprovalDecision = 'approved' | 'denied' | 'expired' | 'cancelled';

export interface AgentServiceOptions {
    requestCompletion?: AgentCompletionRequester;
    maxConcurrentRuns?: number;
    approvalTimeoutMs?: number;
    shutdownTimeoutMs?: number;
}

export class AgentService {
    private readonly requestCompletion: AgentCompletionRequester;
    private readonly maxConcurrentRuns: number;
    private readonly approvalTimeoutMs: number;
    private readonly shutdownTimeoutMs: number;
    private readonly queue: string[] = [];
    private readonly tasks = new Map<string, Promise<void>>();
    private readonly controllers = new Map<string, AbortController>();
    private readonly approvalWaiters = new Map<string, (decision: ApprovalDecision) => void>();
    private startPromise: Promise<AgentRunRecord[]> | null = null;
    private started = false;
    private stopping = false;
    private stopped = false;

    constructor(
        private readonly store: AgentStoreService,
        private readonly history: WorkspaceHistoryService,
        private readonly hostTools: AgentHostToolService,
        options: AgentServiceOptions = {},
    ) {
        const client = new AgentLlmClient();
        this.requestCompletion = options.requestCompletion ?? client.complete.bind(client);
        this.maxConcurrentRuns = options.maxConcurrentRuns ?? 2;
        this.approvalTimeoutMs = options.approvalTimeoutMs ?? 10 * 60_000;
        this.shutdownTimeoutMs = options.shutdownTimeoutMs ?? 5_000;
        if (!Number.isSafeInteger(this.maxConcurrentRuns) || this.maxConcurrentRuns < 1 || this.maxConcurrentRuns > 16) {
            throw new Error('maxConcurrentRuns must be an integer between 1 and 16');
        }
        if (!Number.isSafeInteger(this.approvalTimeoutMs) || this.approvalTimeoutMs < 1 || this.approvalTimeoutMs > 24 * 60 * 60_000) {
            throw new Error('approvalTimeoutMs must be an integer between 1 ms and 24 hours');
        }
        if (!Number.isSafeInteger(this.shutdownTimeoutMs) || this.shutdownTimeoutMs < 1 || this.shutdownTimeoutMs > 60_000) {
            throw new Error('shutdownTimeoutMs must be an integer between 1 and 60000 ms');
        }
    }

    start(): Promise<AgentRunRecord[]> {
        if (this.stopped) {
            return Promise.reject(new Error('Agent service cannot restart after it has stopped'));
        }
        if (this.started) {
            return Promise.resolve([]);
        }
        if (this.startPromise) {
            return this.startPromise;
        }
        this.stopping = false;
        this.startPromise = (async () => {
            await new Promise<void>(resolve => setImmediate(resolve));
            try {
                if (this.stopping) {
                    return [];
                }
                const interrupted = this.store.start();
                this.started = true;
                return interrupted;
            } finally {
                this.startPromise = null;
            }
        })();
        return this.startPromise;
    }

    async stop(): Promise<void> {
        this.stopping = true;
        this.stopped = true;
        await this.startPromise?.catch(() => []);
        for (const runId of this.queue.splice(0)) {
            this.interruptRun(runId, 'Agent host stopped before the run started');
        }
        for (const [runId, controller] of this.controllers) {
            this.interruptRun(runId, 'Agent host stopped while the run was active');
            controller.abort(new Error('Agent host stopped'));
        }
        for (const resolve of this.approvalWaiters.values()) {
            resolve('cancelled');
        }
        const settled = Promise.allSettled([...this.tasks.values()]);
        const completed = await Promise.race([settled.then(() => true), delay(this.shutdownTimeoutMs).then(() => false)]);
        if (!completed) {
            console.warn(`[authority] ${this.tasks.size} Agent run(s) did not stop within ${this.shutdownTimeoutMs} ms`);
        }
        this.started = false;
    }

    upsertProfile(input: AgentLlmProfileInput): AgentLlmProfile {
        return this.store.upsertProfile(input);
    }

    listProfiles(): AgentLlmProfile[] {
        return this.store.listProfiles();
    }

    getProfile(profileId: string): AgentLlmProfile {
        return this.store.getProfile(profileId);
    }

    deleteProfile(profileId: string): boolean {
        if (this.store.listRuns().some(run => run.profileId === profileId && !TERMINAL_RUNS.has(run.status))) {
            throw new Error(`LLM profile is in use by an active Agent run: ${profileId}`);
        }
        return this.store.deleteProfile(profileId);
    }

    listTools(): AgentToolDescriptor[] {
        return this.hostTools.list();
    }

    listRuns(): AgentRunRecord[] {
        return this.store.listRuns();
    }

    getRun(runId: string): AgentRunDetail {
        return this.store.getRun(runId);
    }

    createRun(request: AgentRunCreateRequest, callerExtensionId = 'authority'): AgentRunRecord {
        if (!this.started || this.stopping) {
            throw new Error('Agent service is not running');
        }
        const goal = requiredText(request.goal, 'Agent goal', 20_000);
        const caller = requiredText(callerExtensionId, 'Agent caller extension id', 128);
        const instructions = request.instructions === undefined
            ? undefined
            : requiredText(request.instructions, 'Agent instructions', 20_000);
        const contextText = serializeContext(request.context);
        const mode = normalizeMode(request.mode);
        const maxSteps = request.maxSteps ?? DEFAULT_MAX_STEPS;
        if (!Number.isSafeInteger(maxSteps) || maxSteps < 1 || maxSteps > HARD_MAX_STEPS) {
            throw new Error(`Agent maxSteps must be an integer between 1 and ${HARD_MAX_STEPS}`);
        }
        const workspace = selectOne(
            request.workspaceId,
            this.history.listWorkspaces(),
            item => item.id,
            'workspace',
        );
        const profile = selectOne(
            request.profileId,
            this.store.listProfiles(),
            item => item.id,
            'LLM profile',
        );
        const availableTools = this.hostTools.list();
        const allowedTools = normalizeAllowedTools(request.allowedTools, availableTools);
        const timestamp = this.store.nowIso();
        const id = crypto.randomUUID();
        const run: AgentRunRecord = {
            id,
            callerExtensionId: caller,
            workspaceId: workspace.id,
            profileId: profile.id,
            goal,
            mode,
            status: 'queued',
            allowedTools,
            stepCount: 0,
            maxSteps,
            createdAt: timestamp,
            updatedAt: timestamp,
            ...(workspace.headCommitId ? { headCommitId: workspace.headCommitId } : {}),
        };
        const detail: AgentRunDetail = {
            run,
            messages: [
                { role: 'system', content: systemPrompt(workspace.rootPath, mode) },
                { role: 'user', content: userPrompt(goal, instructions, contextText) },
            ],
            events: [{ sequence: 1, runId: id, type: 'run.created', timestamp, payload: { mode, allowedTools } }],
            invocations: [],
            approvals: [],
            ...(request.context === undefined ? {} : { context: structuredClone(request.context) }),
            ...(instructions ? { instructions } : {}),
        };
        this.store.createRun(detail);
        this.queue.push(id);
        this.drainQueue();
        return structuredClone(run);
    }

    cancelRun(runId: string): AgentRunRecord {
        const current = this.store.getRun(runId);
        if (TERMINAL_RUNS.has(current.run.status)) {
            return current.run;
        }
        const timestamp = this.store.nowIso();
        const detail = this.store.updateRun(runId, run => {
            run.run.status = 'cancelled';
            run.run.finishedAt = timestamp;
            run.run.error = 'Cancelled by user';
            delete run.run.pendingApprovalId;
            cancelPendingRecords(run, timestamp, 'Cancelled by user');
            appendEvent(run, 'run.cancelled', timestamp);
        });
        const queueIndex = this.queue.indexOf(runId);
        if (queueIndex !== -1) {
            this.queue.splice(queueIndex, 1);
        }
        this.controllers.get(runId)?.abort(new Error('Agent run cancelled'));
        for (const [key, resolve] of this.approvalWaiters) {
            if (key.startsWith(`${runId}:`)) {
                resolve('cancelled');
            }
        }
        return detail.run;
    }

    resolveApproval(runId: string, approvalId: string, request: AgentApprovalResolveRequest): AgentApprovalRecord {
        if (request.decision !== 'approve' && request.decision !== 'deny') {
            throw new Error('Approval decision must be approve or deny');
        }
        const waiter = this.approvalWaiters.get(`${runId}:${approvalId}`);
        if (!waiter) {
            throw new Error(`Agent approval waiter is unavailable: ${approvalId}`);
        }
        const timestamp = this.store.nowIso();
        let resolved!: AgentApprovalRecord;
        this.store.updateRun(runId, detail => {
            const approval = detail.approvals.find(item => item.id === approvalId);
            if (!approval) {
                throw new Error(`Agent approval not found: ${approvalId}`);
            }
            if (approval.status !== 'pending' || detail.run.pendingApprovalId !== approvalId) {
                throw new Error(`Agent approval is no longer pending: ${approvalId}`);
            }
            approval.status = request.decision === 'approve' ? 'approved' : 'denied';
            approval.updatedAt = timestamp;
            approval.resolvedAt = timestamp;
            detail.run.status = 'running';
            delete detail.run.pendingApprovalId;
            appendEvent(detail, 'tool.approval_resolved', timestamp, {
                approvalId,
                callId: approval.callId,
                decision: request.decision,
            });
            resolved = structuredClone(approval);
        });
        waiter(request.decision === 'approve' ? 'approved' : 'denied');
        return resolved;
    }

    private drainQueue(): void {
        if (this.stopping) {
            return;
        }
        while (this.tasks.size < this.maxConcurrentRuns && this.queue.length > 0) {
            const runId = this.queue.shift()!;
            const task = this.executeRun(runId)
                .catch(error => console.warn(`[authority] Agent run ${runId} failed: ${error instanceof Error ? error.message : String(error)}`))
                .finally(() => {
                    this.tasks.delete(runId);
                    this.controllers.delete(runId);
                    this.drainQueue();
                });
            this.tasks.set(runId, task);
        }
    }

    private async executeRun(runId: string): Promise<void> {
        const controller = new AbortController();
        this.controllers.set(runId, controller);
        const startedAt = this.store.nowIso();
        this.store.updateRun(runId, detail => {
            if (detail.run.status !== 'queued') {
                throw new Error(`Agent run is not queued: ${runId}`);
            }
            detail.run.status = 'running';
            detail.run.startedAt = startedAt;
            appendEvent(detail, 'run.started', startedAt);
        });
        try {
            while (!controller.signal.aborted) {
                const detail = this.store.getRun(runId);
                if (TERMINAL_RUNS.has(detail.run.status)) {
                    return;
                }
                if (detail.run.stepCount >= detail.run.maxSteps) {
                    throw new Error(`Agent reached the ${detail.run.maxSteps} step limit`);
                }
                const descriptors = this.allowedDescriptors(detail.run);
                const llmTools = mapLlmTools(descriptors);
                const profile = this.store.getProfileForRequest(detail.run.profileId);
                const completion = await this.requestCompletion(profile, {
                    messages: detail.messages,
                    tools: llmTools.definitions,
                    signal: controller.signal,
                });
                this.assertRunActive(runId, controller.signal);
                const messageAt = this.store.nowIso();
                this.store.updateRun(runId, run => {
                    run.run.stepCount += 1;
                    run.messages.push(completion.message);
                    appendEvent(run, 'assistant.message', messageAt, {
                        content: completion.message.content,
                        toolCalls: completion.message.toolCalls,
                        finishReason: completion.finishReason,
                        usage: completion.usage,
                    });
                });
                const calls = completion.message.toolCalls ?? [];
                if (calls.length === 0) {
                    this.completeRun(runId, completion.message.content ?? '');
                    return;
                }
                for (const call of calls) {
                    if (controller.signal.aborted) {
                        throw abortError(controller.signal);
                    }
                    const toolId = llmTools.nameToId.get(call.name);
                    if (!toolId) {
                        this.appendToolProtocolError(runId, call.id, `Unknown tool requested by model: ${call.name}`);
                        continue;
                    }
                    const descriptor = descriptors.find(tool => tool.id === toolId)!;
                    let input: unknown;
                    try {
                        input = parseToolArguments(call.arguments);
                    } catch (error) {
                        this.appendToolProtocolError(runId, call.id, errorMessage(error));
                        continue;
                    }
                    await this.executeTool(runId, call.id, descriptor, input, controller.signal);
                }
            }
            throw abortError(controller.signal);
        } catch (error) {
            const current = this.store.getRun(runId).run;
            if (TERMINAL_RUNS.has(current.status)) {
                return;
            }
            if (this.stopping) {
                this.interruptRun(runId, 'Agent host stopped while the run was active');
            } else if (controller.signal.aborted) {
                this.cancelRun(runId);
            } else {
                this.failRun(runId, errorMessage(error));
            }
        }
    }

    private async executeTool(
        runId: string,
        callId: string,
        descriptor: AgentToolDescriptor,
        input: unknown,
        signal: AbortSignal,
    ): Promise<void> {
        const current = this.store.getRun(runId);
        if (current.invocations.some(invocation => invocation.callId === callId)) {
            this.appendToolProtocolError(runId, callId, `Duplicate tool call id: ${callId}`);
            return;
        }
        if (current.run.mode === 'plan' && descriptor.mutatesWorkspace) {
            this.appendToolProtocolError(runId, callId, `Tool is unavailable in plan mode: ${descriptor.id}`);
            return;
        }
        const timestamp = this.store.nowIso();
        const invocation: AgentToolInvocation = {
            callId,
            runId,
            toolId: descriptor.id,
            arguments: structuredClone(input),
            status: 'pending',
            createdAt: timestamp,
            updatedAt: timestamp,
            deadlineAt: new Date(Date.parse(timestamp) + 10 * 60_000).toISOString(),
        };
        this.store.updateRun(runId, detail => {
            detail.invocations.push(invocation);
            appendEvent(detail, 'tool.requested', timestamp, { callId, toolId: descriptor.id, arguments: input });
        });

        const requiresApproval = descriptor.approvalPolicy === 'always'
            || (current.run.mode === 'ask' && descriptor.approvalPolicy === 'on-mutation' && descriptor.mutatesWorkspace);
        if (requiresApproval) {
            const decision = await this.waitForApproval(runId, invocation, descriptor, input);
            if (decision === 'cancelled') {
                throw abortError(signal);
            }
            if (decision === 'denied') {
                this.failTool(runId, callId, 'Tool execution was denied by the user', 'cancelled');
                return;
            }
            if (decision === 'expired') {
                this.failTool(runId, callId, 'Tool approval expired before the user responded', 'timed_out');
                return;
            }
        }

        this.assertRunActive(runId, signal);
        const startedAt = this.store.nowIso();
        this.store.updateRun(runId, detail => {
            const stored = findInvocation(detail, callId);
            stored.status = 'claimed';
            stored.updatedAt = startedAt;
            appendEvent(detail, 'tool.started', startedAt, { callId, toolId: descriptor.id });
        });
        try {
            const detail = this.store.getRun(runId);
            const workspace = this.history.getWorkspace(detail.run.workspaceId);
            let result: unknown;
            if (descriptor.mutatesWorkspace) {
                const paths = this.hostTools.checkpointPaths(descriptor.id, input);
                const mutation = await this.history.runMutation(workspace.id, {
                    beforeMessage: `Before ${descriptor.title}`,
                    afterMessage: `After ${descriptor.title}`,
                    failureMessage: `Partial changes from failed ${descriptor.title}`,
                    paths,
                    runId,
                    toolCallId: callId,
                    metadata: { agentToolId: descriptor.id },
                }, { kind: 'agent', id: runId }, () => this.hostTools.execute(descriptor.id, input, {
                    workspace,
                    runId,
                    signal,
                }));
                result = mutation.value;
                const checkpointAt = this.store.nowIso();
                this.store.updateRun(runId, run => {
                    run.run.headCommitId = mutation.after.commit.id;
                    appendEvent(run, 'workspace.checkpoint', checkpointAt, {
                        callId,
                        beforeCommitId: mutation.before.commit.id,
                        afterCommitId: mutation.after.commit.id,
                        changedPaths: mutation.after.changedPaths,
                        paths,
                    });
                });
            } else {
                result = await this.hostTools.execute(descriptor.id, input, { workspace, runId, signal });
            }
            this.assertRunActive(runId, signal);
            this.completeTool(runId, callId, result);
        } catch (error) {
            const failedHead = this.history.getWorkspace(current.run.workspaceId).headCommitId;
            if (failedHead && failedHead !== this.store.getRun(runId).run.headCommitId) {
                const checkpointAt = this.store.nowIso();
                this.store.updateRun(runId, run => {
                    run.run.headCommitId = failedHead;
                    appendEvent(run, 'workspace.checkpoint', checkpointAt, {
                        callId,
                        afterCommitId: failedHead,
                        failed: true,
                    });
                });
            }
            if (signal.aborted || TERMINAL_RUNS.has(this.store.getRun(runId).run.status)) {
                throw error;
            }
            this.failTool(runId, callId, errorMessage(error), 'failed');
        }
    }

    private async waitForApproval(
        runId: string,
        invocation: AgentToolInvocation,
        descriptor: AgentToolDescriptor,
        input: unknown,
    ): Promise<ApprovalDecision> {
        const approvalId = crypto.randomUUID();
        const timestamp = this.store.nowIso();
        const approval: AgentApprovalRecord = {
            id: approvalId,
            runId,
            callId: invocation.callId,
            toolId: descriptor.id,
            title: descriptor.title,
            summary: this.hostTools.approvalSummary(descriptor.id, input),
            arguments: structuredClone(input),
            riskLevel: descriptor.riskLevel,
            status: 'pending',
            createdAt: timestamp,
            updatedAt: timestamp,
            expiresAt: new Date(Date.parse(timestamp) + this.approvalTimeoutMs).toISOString(),
        };
        const key = `${runId}:${approvalId}`;
        let resolveDecision!: (decision: ApprovalDecision) => void;
        const decision = new Promise<ApprovalDecision>(resolve => {
            resolveDecision = resolve;
            this.approvalWaiters.set(key, resolve);
        });
        this.store.updateRun(runId, detail => {
            findInvocation(detail, invocation.callId).status = 'waiting_approval';
            findInvocation(detail, invocation.callId).updatedAt = timestamp;
            detail.approvals.push(approval);
            detail.run.status = 'waiting_approval';
            detail.run.pendingApprovalId = approvalId;
            appendEvent(detail, 'tool.waiting_approval', timestamp, {
                approvalId,
                callId: invocation.callId,
                toolId: descriptor.id,
            });
        });
        const timer = setTimeout(() => {
            const expiredAt = this.store.nowIso();
            try {
                this.store.updateRun(runId, detail => {
                    const storedApproval = detail.approvals.find(item => item.id === approvalId);
                    if (!storedApproval || storedApproval.status !== 'pending') {
                        return;
                    }
                    storedApproval.status = 'expired';
                    storedApproval.updatedAt = expiredAt;
                    storedApproval.resolvedAt = expiredAt;
                    const storedInvocation = findInvocation(detail, invocation.callId);
                    storedInvocation.status = 'timed_out';
                    storedInvocation.updatedAt = expiredAt;
                    detail.run.status = 'running';
                    delete detail.run.pendingApprovalId;
                    appendEvent(detail, 'tool.approval_resolved', expiredAt, {
                        approvalId,
                        callId: invocation.callId,
                        decision: 'expired',
                    });
                });
                resolveDecision('expired');
            } catch (error) {
                console.warn(`[authority] Unable to expire Agent approval ${approvalId}: ${errorMessage(error)}`);
                resolveDecision('cancelled');
            }
        }, this.approvalTimeoutMs);
        timer.unref();
        try {
            return await decision;
        } finally {
            clearTimeout(timer);
            this.approvalWaiters.delete(key);
        }
    }

    private completeTool(runId: string, callId: string, result: unknown): void {
        const timestamp = this.store.nowIso();
        const bounded = boundedToolValue(result);
        this.store.updateRun(runId, detail => {
            const invocation = findInvocation(detail, callId);
            invocation.status = 'completed';
            invocation.updatedAt = timestamp;
            invocation.result = structuredClone(bounded);
            detail.messages.push({ role: 'tool', toolCallId: callId, content: JSON.stringify({ ok: true, result: bounded }) });
            appendEvent(detail, 'tool.completed', timestamp, { callId, toolId: invocation.toolId, result: bounded });
        });
    }

    private failTool(
        runId: string,
        callId: string,
        message: string,
        status: AgentToolInvocation['status'],
    ): void {
        const timestamp = this.store.nowIso();
        this.store.updateRun(runId, detail => {
            const invocation = findInvocation(detail, callId);
            invocation.status = status;
            invocation.updatedAt = timestamp;
            invocation.error = message;
            detail.messages.push({ role: 'tool', toolCallId: callId, content: JSON.stringify({ ok: false, error: message }) });
            appendEvent(detail, 'tool.failed', timestamp, { callId, toolId: invocation.toolId, error: message });
        });
    }

    private appendToolProtocolError(runId: string, callId: string, message: string): void {
        const timestamp = this.store.nowIso();
        this.store.updateRun(runId, detail => {
            detail.messages.push({ role: 'tool', toolCallId: callId, content: JSON.stringify({ ok: false, error: message }) });
            appendEvent(detail, 'tool.failed', timestamp, { callId, error: message });
        });
    }

    private allowedDescriptors(run: AgentRunRecord): AgentToolDescriptor[] {
        const allowed = new Set(run.allowedTools);
        return this.hostTools.list().filter(tool => allowed.has(tool.id) && (run.mode !== 'plan' || !tool.mutatesWorkspace));
    }

    private assertRunActive(runId: string, signal: AbortSignal): void {
        if (signal.aborted) {
            throw abortError(signal);
        }
        const status = this.store.getRun(runId).run.status;
        if (status !== 'running') {
            throw new Error(`Agent run is no longer active: ${status}`);
        }
    }

    private completeRun(runId: string, finalText: string): void {
        const timestamp = this.store.nowIso();
        this.store.updateRun(runId, detail => {
            detail.run.status = 'completed';
            detail.run.finalText = finalText;
            detail.run.finishedAt = timestamp;
            delete detail.run.error;
            appendEvent(detail, 'run.completed', timestamp, { finalText });
        });
    }

    private failRun(runId: string, message: string): void {
        const timestamp = this.store.nowIso();
        this.store.updateRun(runId, detail => {
            detail.run.status = 'failed';
            detail.run.error = message;
            detail.run.finishedAt = timestamp;
            delete detail.run.pendingApprovalId;
            cancelPendingRecords(detail, timestamp, message);
            appendEvent(detail, 'run.failed', timestamp, { error: message });
        });
    }

    private interruptRun(runId: string, message: string): void {
        const current = this.store.getRun(runId);
        if (TERMINAL_RUNS.has(current.run.status)) {
            return;
        }
        const timestamp = this.store.nowIso();
        this.store.updateRun(runId, detail => {
            detail.run.status = 'interrupted';
            detail.run.error = message;
            detail.run.finishedAt = timestamp;
            delete detail.run.pendingApprovalId;
            cancelPendingRecords(detail, timestamp, message);
            appendEvent(detail, 'run.interrupted', timestamp, { reason: message });
        });
    }
}

function appendEvent(detail: AgentRunDetail, type: AgentRunEvent['type'], timestamp: string, payload?: unknown): void {
    detail.events.push({
        sequence: (detail.events.at(-1)?.sequence ?? 0) + 1,
        runId: detail.run.id,
        type,
        timestamp,
        ...(payload === undefined ? {} : { payload }),
    });
}

function findInvocation(detail: AgentRunDetail, callId: string): AgentToolInvocation {
    const invocation = detail.invocations.find(item => item.callId === callId);
    if (!invocation) {
        throw new Error(`Agent tool invocation not found: ${callId}`);
    }
    return invocation;
}

function cancelPendingRecords(detail: AgentRunDetail, timestamp: string, message: string): void {
    for (const approval of detail.approvals) {
        if (approval.status === 'pending') {
            approval.status = 'cancelled';
            approval.updatedAt = timestamp;
            approval.resolvedAt = timestamp;
        }
    }
    for (const invocation of detail.invocations) {
        if (invocation.status === 'pending' || invocation.status === 'waiting_approval' || invocation.status === 'claimed') {
            invocation.status = 'cancelled';
            invocation.updatedAt = timestamp;
            invocation.error = message;
        }
    }
}

function mapLlmTools(descriptors: AgentToolDescriptor[]): {
    definitions: AgentLlmToolDefinition[];
    nameToId: Map<string, string>;
} {
    const nameToId = new Map<string, string>();
    const definitions = descriptors.map(descriptor => {
        const name = llmToolName(descriptor.id);
        if (nameToId.has(name)) {
            throw new Error(`Agent tool name collision: ${descriptor.id}`);
        }
        nameToId.set(name, descriptor.id);
        return {
            type: 'function' as const,
            function: {
                name,
                description: descriptor.description,
                parameters: descriptor.inputSchema,
            },
        };
    });
    return { definitions, nameToId };
}

function llmToolName(toolId: string): string {
    const normalized = toolId.replace(/[^a-zA-Z0-9_-]/g, '_');
    if (normalized === toolId && normalized.length <= 64) {
        return normalized;
    }
    return `${normalized.slice(0, 51)}_${crypto.createHash('sha256').update(toolId).digest('hex').slice(0, 12)}`;
}

function normalizeMode(value: unknown): AgentExecutionMode {
    if (value === undefined) {
        return 'ask';
    }
    if (value !== 'plan' && value !== 'ask' && value !== 'auto') {
        throw new Error('Agent mode must be plan, ask, or auto');
    }
    return value;
}

function normalizeAllowedTools(value: unknown, available: AgentToolDescriptor[]): string[] {
    const ids = new Set(available.map(tool => tool.id));
    if (value === undefined) {
        return [...ids];
    }
    if (!Array.isArray(value) || value.length > 128 || value.some(item => typeof item !== 'string')) {
        throw new Error('allowedTools must be an array of at most 128 tool ids');
    }
    const result = [...new Set(value as string[])];
    for (const id of result) {
        if (!ids.has(id)) {
            throw new Error(`Unknown Agent tool: ${id}`);
        }
    }
    return result;
}

function selectOne<T>(requestedId: string | undefined, items: T[], id: (item: T) => string, label: string): T {
    if (requestedId !== undefined) {
        const selected = items.find(item => id(item) === requestedId);
        if (!selected) {
            throw new Error(`Agent ${label} not found: ${requestedId}`);
        }
        return selected;
    }
    if (items.length !== 1) {
        throw new Error(items.length === 0
            ? `No Agent ${label} is configured`
            : `Agent ${label} must be selected because multiple are configured`);
    }
    return items[0]!;
}

function parseToolArguments(value: string): unknown {
    if (value.length > MAX_TOOL_ARGUMENT_CHARS) {
        throw new Error('Tool arguments exceed the 128 KB limit');
    }
    let parsed: unknown;
    try {
        parsed = JSON.parse(value);
    } catch (error) {
        throw new Error(`Tool arguments are invalid JSON: ${errorMessage(error)}`);
    }
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
        throw new Error('Tool arguments must be a JSON object');
    }
    return parsed;
}

function serializeContext(context: unknown): string | undefined {
    if (context === undefined) {
        return undefined;
    }
    let value: string;
    try {
        value = JSON.stringify(context);
    } catch (error) {
        throw new Error(`Agent context must be JSON serializable: ${errorMessage(error)}`);
    }
    if (value.length > MAX_CONTEXT_CHARS) {
        throw new Error('Agent context exceeds the 64 KB limit');
    }
    return value;
}

function boundedToolValue(value: unknown): unknown {
    const normalized = value === undefined ? null : value;
    const serialized = JSON.stringify(normalized);
    if (serialized.length <= MAX_TOOL_RESULT_CHARS) {
        return normalized;
    }
    return {
        truncated: true,
        originalChars: serialized.length,
        preview: serialized.slice(0, MAX_TOOL_RESULT_CHARS - 1_000),
    };
}

function requiredText(value: unknown, label: string, maxLength: number): string {
    if (typeof value !== 'string' || !value.trim()) {
        throw new Error(`${label} is required`);
    }
    const result = value.trim();
    if (result.length > maxLength) {
        throw new Error(`${label} exceeds ${maxLength} characters`);
    }
    return result;
}

function systemPrompt(workspaceRoot: string, mode: AgentExecutionMode): string {
    return [
        'You are Authority Agent, an IDE-grade operator for a registered SillyTavern workspace.',
        `Workspace root: ${workspaceRoot}`,
        `Execution mode: ${mode}.`,
        'Inspect relevant files before changing them. Use registered tools for every action and rely on their returned results.',
        'Keep writes narrow. Shell commands checkpoint the workspace except .git and node_modules, and always require approval because those paths and effects outside the workspace cannot be rolled back.',
        mode === 'plan'
            ? 'Plan mode is read-only: analyze and return a concrete plan without modifying files or running mutating commands.'
            : mode === 'ask'
                ? 'Ask mode pauses before each workspace mutation so the user can approve or deny it.'
                : 'Auto mode may execute workspace mutations without pausing; every mutation is still checkpointed for rollback.',
        'When the goal is complete, return a concise final result and verification status.',
    ].join('\n');
}

function userPrompt(goal: string, instructions?: string, context?: string): string {
    return [
        `Goal:\n${goal}`,
        ...(instructions ? [`Additional instructions:\n${instructions}`] : []),
        ...(context ? [`Caller context (JSON):\n${context}`] : []),
    ].join('\n\n');
}

function errorMessage(error: unknown): string {
    return error instanceof Error ? error.message : String(error);
}

function abortError(signal: AbortSignal): Error {
    return signal.reason instanceof Error ? signal.reason : Object.assign(new Error('Agent run cancelled'), { name: 'AbortError' });
}

function delay(milliseconds: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, milliseconds));
}

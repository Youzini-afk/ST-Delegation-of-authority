import crypto from 'node:crypto';
import type {
    AgentRunMessage,
    AgentToolDescriptor,
} from '@stdo/shared-types';
import { AgentHostToolService } from './agent-host-tools.js';
import type {
    AgentCompletionRequester,
    AgentLlmCompletionResponse,
    AgentLlmToolDefinition,
} from './agent-llm-client.js';
import type {
    AgentConversationMessageEntry,
    AgentSessionApprovalState,
    AgentSessionRunState,
    AgentSessionSnapshot,
} from './agent-session-model.js';
import { AgentSessionJournalService } from './agent-session-journal-service.js';
import { AgentSessionRecoveryService } from './agent-session-recovery-service.js';
import type { AgentSessionWriter } from './agent-session-store-service.js';
import { AgentStoreService } from './agent-store-service.js';
import { AgentSessionToolExecutor, type AgentSessionToolExecutorHost } from './agent-session-tool-executor.js';
import { AgentToolRegistryService } from './agent-tool-registry-service.js';
import {
    activeStep,
    conversationMessages,
    errorMessage,
    isPlanSafeTool,
    isTimeoutMessage,
    mapLlmTools,
    parseToolArguments,
    requireRef,
    requireRun,
    TERMINAL_TOOLS,
} from './agent-session-runtime-support.js';

export interface AgentSessionRunExecutorHost extends AgentSessionToolExecutorHost {
    enqueue(sessionId: string, runId: string): void;
    scheduleApprovalExpiry(sessionId: string, approval: AgentSessionApprovalState): void;
    finishRunAndStartFollowUp(
        writer: AgentSessionWriter,
        runId: string,
        outcome: 'completed' | 'failed' | 'cancelled',
        finalText?: string,
        error?: string,
    ): string | null;
}

export interface AgentSessionRunExecutorOptions {
    requestCompletion: AgentCompletionRequester;
    approvalTimeoutMs: number;
}

interface PreparedGeneration {
    profileId: string;
    messages: AgentRunMessage[];
    tools: AgentLlmToolDefinition[];
    stepId: string;
    generationId: string;
}

/**
 * Executes one durable Run. Scheduling, writer ownership, timers and public
 * commands stay in the runtime coordinator; this class owns the model/tool
 * loop and its intent-before-effect protocol.
 */
export class AgentSessionRunExecutor {
    private readonly requestCompletion: AgentCompletionRequester;
    private readonly approvalTimeoutMs: number;

    constructor(
        private readonly profileStore: AgentStoreService,
        private readonly hostTools: AgentHostToolService,
        private readonly tools: AgentToolRegistryService,
        private readonly toolExecutor: AgentSessionToolExecutor,
        private readonly journal: AgentSessionJournalService,
        private readonly recovery: AgentSessionRecoveryService,
        private readonly host: AgentSessionRunExecutorHost,
        options: AgentSessionRunExecutorOptions,
    ) {
        this.requestCompletion = options.requestCompletion;
        this.approvalTimeoutMs = options.approvalTimeoutMs;
    }

    async execute(sessionId: string, runId: string, signal: AbortSignal): Promise<void> {
        await this.host.perform(sessionId, writer => {
            const run = requireRun(writer.snapshot(), runId);
            if (run.status === 'queued') {
                this.host.append(writer, {
                    id: crypto.randomUUID(),
                    type: 'run.started',
                    timestamp: this.host.now(),
                    runId,
                });
            }
        });
        while (!signal.aborted && !this.host.isStopping()) {
            const snapshot = await this.host.perform(sessionId, writer => writer.snapshot());
            const run = requireRun(snapshot, runId);
            if (run.status !== 'running') return;
            const step = activeStep(snapshot, runId);
            if (step) {
                const shouldContinue = await this.continueStep(sessionId, runId, step.id, signal);
                if (!shouldContinue) return;
                continue;
            }
            const prepared = await this.host.perform(sessionId, writer => this.prepareGeneration(writer, runId));
            if (!prepared) return;
            let completion: AgentLlmCompletionResponse;
            try {
                completion = await this.requestCompletion(this.profileStore.getProfileForRequest(prepared.profileId), {
                    messages: prepared.messages,
                    tools: prepared.tools,
                    signal,
                });
            } catch (error) {
                await this.host.perform(sessionId, writer => {
                    this.finishGenerationFailure(writer, runId, prepared, error, signal);
                });
                return;
            }
            const accepted = await this.host.perform(
                sessionId,
                writer => this.acceptCompletion(writer, runId, prepared, completion),
            );
            if (!accepted) return;
        }
        await this.host.perform(sessionId, writer => {
            const run = requireRun(writer.snapshot(), runId);
            if (run.status === 'cancelling') {
                this.journal.finalizeCancellation(writer, runId, 'Cancelled by user');
            } else if (run.status === 'running') {
                this.recovery.interruptActiveRun(writer, runId, 'Agent host stopped while the run was active');
            }
        });
    }

    private prepareGeneration(writer: AgentSessionWriter, runId: string): PreparedGeneration | null {
        this.consumeSteeringMessages(writer, runId);
        let snapshot = writer.snapshot();
        const run = requireRun(snapshot, runId);
        if (run.status !== 'running') return null;
        if (run.stepCount >= run.maxSteps) {
            const nextRunId = this.host.finishRunAndStartFollowUp(
                writer,
                runId,
                'failed',
                undefined,
                `Agent reached the ${run.maxSteps} step limit`,
            );
            if (nextRunId) queueMicrotask(() => this.host.enqueue(snapshot.session.id, nextRunId));
            return null;
        }
        const catalog = this.tools.list(snapshot.session.callerUserHandle, snapshot.session.callerExtensionId);
        const availableIds = new Set(catalog.map(tool => tool.id));
        const missing = run.allowedTools.filter(id => !availableIds.has(id));
        if (missing.length > 0) {
            this.host.append(writer, {
                id: crypto.randomUUID(),
                type: 'run.suspended',
                timestamp: this.host.now(),
                runId,
                reason: `Agent capabilities are unavailable: ${missing.join(', ')}`,
            });
            return null;
        }
        const descriptors = catalog.filter(tool => run.allowedTools.includes(tool.id)
            && (run.mode !== 'plan' || isPlanSafeTool(tool)));
        const stepId = crypto.randomUUID();
        const generationId = crypto.randomUUID();
        this.host.append(writer, {
            id: crypto.randomUUID(),
            type: 'step.started',
            timestamp: this.host.now(),
            runId,
            stepId,
            index: run.stepCount + 1,
        });
        this.host.append(writer, {
            id: crypto.randomUUID(),
            type: 'generation.started',
            timestamp: this.host.now(),
            runId,
            stepId,
            generationId,
            attempt: 1,
        });
        snapshot = writer.snapshot();
        return {
            profileId: run.profileId,
            messages: conversationMessages(snapshot, run),
            tools: mapLlmTools(descriptors).definitions,
            stepId,
            generationId,
        };
    }

    private acceptCompletion(
        writer: AgentSessionWriter,
        runId: string,
        prepared: PreparedGeneration,
        completion: AgentLlmCompletionResponse,
    ): boolean {
        const snapshot = writer.snapshot();
        const run = requireRun(snapshot, runId);
        const generation = snapshot.generations.find(item => item.id === prepared.generationId);
        if (!generation || generation.status !== 'running') return false;
        if (run.status === 'cancelling') {
            this.host.append(writer, {
                id: crypto.randomUUID(),
                type: 'generation.finished',
                timestamp: this.host.now(),
                runId,
                stepId: prepared.stepId,
                generationId: prepared.generationId,
                outcome: 'cancelled',
                providerRequestState: 'response_received',
                ...(completion.providerRequestId ? { providerRequestId: completion.providerRequestId } : {}),
                error: 'Model response arrived after cancellation was requested',
            });
            this.journal.finalizeCancellation(writer, runId, 'Cancelled by user');
            return false;
        }
        if (run.status !== 'running') return false;
        if (this.host.isStopping()) {
            const message = 'Model response arrived after the Agent host began stopping';
            this.host.append(writer, {
                id: crypto.randomUUID(),
                type: 'generation.finished',
                timestamp: this.host.now(),
                runId,
                stepId: prepared.stepId,
                generationId: prepared.generationId,
                outcome: 'interrupted',
                providerRequestState: 'response_received',
                ...(completion.providerRequestId ? { providerRequestId: completion.providerRequestId } : {}),
                error: message,
            });
            this.host.append(writer, {
                id: crypto.randomUUID(),
                type: 'step.finished',
                timestamp: this.host.now(),
                runId,
                stepId: prepared.stepId,
                outcome: 'interrupted',
                error: message,
            });
            this.host.append(writer, {
                id: crypto.randomUUID(),
                type: 'run.suspended',
                timestamp: this.host.now(),
                runId,
                reason: `${message}; resume explicitly to request a fresh response`,
            });
            return false;
        }
        this.host.append(writer, {
            id: crypto.randomUUID(),
            type: 'generation.finished',
            timestamp: this.host.now(),
            runId,
            stepId: prepared.stepId,
            generationId: prepared.generationId,
            outcome: 'completed',
            providerRequestState: 'response_received',
            ...(completion.providerRequestId ? { providerRequestId: completion.providerRequestId } : {}),
            finishReason: completion.finishReason,
            ...(completion.usage === undefined ? {} : { usage: completion.usage }),
        });
        const ref = requireRef(writer.snapshot(), run.ref);
        this.host.append(writer, {
            id: crypto.randomUUID(),
            type: 'conversation.message',
            timestamp: this.host.now(),
            ref: run.ref,
            parentId: ref.leafEntryId,
            role: 'assistant',
            content: completion.message.content,
            ...(completion.message.toolCalls ? { toolCalls: completion.message.toolCalls } : {}),
            runId,
            stepId: prepared.stepId,
        });
        return true;
    }

    private finishGenerationFailure(
        writer: AgentSessionWriter,
        runId: string,
        prepared: PreparedGeneration,
        error: unknown,
        signal: AbortSignal,
    ): void {
        const snapshot = writer.snapshot();
        const generation = snapshot.generations.find(item => item.id === prepared.generationId);
        if (!generation || generation.status !== 'running') return;
        const run = requireRun(snapshot, runId);
        const message = errorMessage(error);
        const cancelled = run.status === 'cancelling' || signal.aborted;
        const stopping = this.host.isStopping();
        this.host.append(writer, {
            id: crypto.randomUUID(),
            type: 'generation.finished',
            timestamp: this.host.now(),
            runId,
            stepId: prepared.stepId,
            generationId: prepared.generationId,
            outcome: cancelled ? (stopping ? 'interrupted' : 'cancelled') : (isTimeoutMessage(message) ? 'timed_out' : 'failed'),
            providerRequestState: 'sent_or_unknown',
            error: message,
        });
        this.host.append(writer, {
            id: crypto.randomUUID(),
            type: 'step.finished',
            timestamp: this.host.now(),
            runId,
            stepId: prepared.stepId,
            outcome: cancelled ? (stopping ? 'interrupted' : 'cancelled') : 'failed',
            error: message,
        });
        if (run.status === 'cancelling') {
            this.host.append(writer, {
                id: crypto.randomUUID(),
                type: 'run.finished',
                timestamp: this.host.now(),
                runId,
                outcome: 'cancelled',
                error: 'Cancelled by user',
            });
        } else {
            this.host.append(writer, {
                id: crypto.randomUUID(),
                type: 'run.suspended',
                timestamp: this.host.now(),
                runId,
                reason: stopping
                    ? 'Agent host stopped while the model request was active'
                    : `Model generation failed without a safe automatic retry: ${message}`,
            });
        }
    }

    private async continueStep(sessionId: string, runId: string, stepId: string, signal: AbortSignal): Promise<boolean> {
        while (!signal.aborted && !this.host.isStopping()) {
            const snapshot = await this.host.perform(sessionId, writer => writer.snapshot());
            const run = requireRun(snapshot, runId);
            if (run.status === 'cancelling') {
                await this.host.perform(sessionId, writer => {
                    this.journal.finalizeCancellation(writer, runId, 'Cancelled by user');
                });
                return false;
            }
            if (run.status !== 'running') return false;
            const step = snapshot.steps.find(item => item.id === stepId);
            if (!step || step.status !== 'running') return true;
            const assistant = [...snapshot.conversation].reverse().find(entry => entry.kind === 'message'
                && entry.role === 'assistant'
                && entry.stepId === stepId) as AgentConversationMessageEntry | undefined;
            const calls = assistant?.toolCalls ?? [];
            if (calls.length === 0) {
                const completed = await this.host.perform(sessionId, writer => {
                    this.host.append(writer, {
                        id: crypto.randomUUID(),
                        type: 'step.finished',
                        timestamp: this.host.now(),
                        runId,
                        stepId,
                        outcome: 'completed',
                    });
                    const hasSteering = writer.snapshot().pendingMessages.some(item => item.runId === runId && item.kind === 'steer');
                    if (hasSteering) return { keepRunning: true, nextRunId: null };
                    return {
                        keepRunning: false,
                        nextRunId: this.host.finishRunAndStartFollowUp(
                            writer,
                            runId,
                            'completed',
                            assistant?.content ?? '',
                            undefined,
                        ),
                    };
                });
                if (completed.nextRunId) this.host.enqueue(sessionId, completed.nextRunId);
                return completed.keepRunning;
            }

            const descriptors = this.allowedDescriptors(snapshot, run);
            const mapped = mapLlmTools(descriptors);
            let yielded = false;
            for (const call of calls) {
                let current = await this.host.perform(sessionId, writer => writer.snapshot());
                let invocation = current.invocations.find(item => item.runId === runId && item.callId === call.id);
                if (invocation) {
                    if (invocation.status === 'waiting_approval') return false;
                    if (invocation.status === 'pending') {
                        const outcome = await this.toolExecutor.execute(sessionId, invocation.id, signal);
                        if (outcome === 'waiting') return false;
                        continue;
                    }
                    if (invocation.status === 'claimed') {
                        await this.host.perform(sessionId, writer => this.toolExecutor.interruptClaimedInvocation(
                            writer,
                            invocation!,
                            'Execution ownership was lost before the tool result was recorded',
                        ));
                        return false;
                    }
                    if (TERMINAL_TOOLS.has(invocation.status)) {
                        await this.host.perform(
                            sessionId,
                            writer => this.journal.ensureToolResultMessage(writer, invocation!.id),
                        );
                        continue;
                    }
                }

                const toolId = mapped.nameToId.get(call.name);
                if (!toolId) {
                    await this.host.perform(sessionId, writer => this.journal.appendToolProtocolError(
                        writer,
                        runId,
                        stepId,
                        call.id,
                        `Unknown tool requested by model: ${call.name}`,
                    ));
                    continue;
                }
                const descriptor = descriptors.find(tool => tool.id === toolId)!;
                if (run.mode === 'plan' && !isPlanSafeTool(descriptor)) {
                    await this.host.perform(sessionId, writer => this.journal.appendToolProtocolError(
                        writer,
                        runId,
                        stepId,
                        call.id,
                        `Tool is unavailable in plan mode: ${descriptor.id}`,
                    ));
                    continue;
                }
                let input: unknown;
                try {
                    input = parseToolArguments(call.arguments);
                } catch (error) {
                    await this.host.perform(sessionId, writer => this.journal.appendToolProtocolError(
                        writer,
                        runId,
                        stepId,
                        call.id,
                        errorMessage(error),
                    ));
                    continue;
                }
                const invocationId = crypto.randomUUID();
                const requiresApproval = descriptor.approvalPolicy === 'always'
                    || (run.mode === 'ask' && descriptor.approvalPolicy === 'on-mutation');
                await this.host.perform(sessionId, writer => {
                    this.host.append(writer, {
                        id: crypto.randomUUID(),
                        type: 'tool.requested',
                        timestamp: this.host.now(),
                        runId,
                        stepId,
                        invocationId,
                        callId: call.id,
                        toolId: descriptor.id,
                        execution: descriptor.execution,
                        arguments: input,
                    });
                    if (requiresApproval) {
                        const approvalId = crypto.randomUUID();
                        const timestamp = this.host.now();
                        this.host.append(writer, {
                            id: crypto.randomUUID(),
                            type: 'approval.requested',
                            timestamp,
                            approvalId,
                            runId,
                            invocationId,
                            title: descriptor.title,
                            summary: this.approvalSummary(descriptor, input),
                            arguments: input,
                            riskLevel: descriptor.riskLevel,
                            expiresAt: new Date(Date.parse(timestamp) + this.approvalTimeoutMs).toISOString(),
                        });
                    }
                });
                current = await this.host.perform(sessionId, writer => writer.snapshot());
                invocation = current.invocations.find(item => item.id === invocationId)!;
                if (requiresApproval) {
                    const approval = current.approvals.find(item => item.invocationId === invocationId)!;
                    this.host.scheduleApprovalExpiry(sessionId, approval);
                    yielded = true;
                    break;
                }
                const outcome = await this.toolExecutor.execute(sessionId, invocationId, signal);
                if (outcome === 'waiting') {
                    yielded = true;
                    break;
                }
            }
            if (yielded) return false;
            const after = await this.host.perform(sessionId, writer => writer.snapshot());
            const afterRun = requireRun(after, runId);
            if (afterRun.status === 'cancelling' || signal.aborted || this.host.isStopping()) {
                await this.host.perform(sessionId, writer => {
                    const currentRun = requireRun(writer.snapshot(), runId);
                    if (currentRun.status === 'cancelling') {
                        this.journal.finalizeCancellation(writer, runId, 'Cancelled by user');
                    } else if (currentRun.status === 'running') {
                        this.recovery.interruptActiveRun(
                            writer,
                            runId,
                            'Agent host stopped while a tool step was active',
                        );
                    }
                });
                return false;
            }
            if (afterRun.status !== 'running') return false;
            const unfinished = after.invocations.some(item => item.stepId === stepId && !TERMINAL_TOOLS.has(item.status));
            if (unfinished) return false;
            await this.host.perform(sessionId, writer => {
                const active = activeStep(writer.snapshot(), runId);
                if (active?.id === stepId) {
                    this.host.append(writer, {
                        id: crypto.randomUUID(),
                        type: 'step.finished',
                        timestamp: this.host.now(),
                        runId,
                        stepId,
                        outcome: 'completed',
                    });
                }
            });
            return true;
        }
        await this.host.perform(sessionId, writer => {
            this.recovery.interruptActiveRun(writer, runId, 'Agent host stopped while a tool step was active');
        });
        return false;
    }

    private consumeSteeringMessages(writer: AgentSessionWriter, runId: string): void {
        let snapshot = writer.snapshot();
        const run = requireRun(snapshot, runId);
        const messages = snapshot.pendingMessages
            .filter(item => item.ref === run.ref && item.runId === runId && item.kind === 'steer')
            .sort((left, right) => left.createdAt.localeCompare(right.createdAt) || left.id.localeCompare(right.id));
        for (const message of messages) {
            snapshot = writer.snapshot();
            const ref = requireRef(snapshot, run.ref);
            this.host.append(writer, {
                id: crypto.randomUUID(),
                type: 'conversation.message',
                timestamp: this.host.now(),
                ref: run.ref,
                parentId: ref.leafEntryId,
                role: 'user',
                content: message.content,
                runId,
                consumedQueueId: message.id,
            });
        }
    }

    private approvalSummary(descriptor: AgentToolDescriptor, input: unknown): string {
        if (descriptor.execution === 'host') return this.hostTools.approvalSummary(descriptor.id, input);
        const preview = JSON.stringify(input);
        return `${descriptor.title}; effects are outside workspace rollback: ${preview.slice(0, 500)}`;
    }

    private allowedDescriptors(snapshot: AgentSessionSnapshot, run: AgentSessionRunState): AgentToolDescriptor[] {
        const allowed = new Set(run.allowedTools);
        return this.tools.list(snapshot.session.callerUserHandle, snapshot.session.callerExtensionId)
            .filter(tool => allowed.has(tool.id) && (run.mode !== 'plan' || isPlanSafeTool(tool)));
    }

}

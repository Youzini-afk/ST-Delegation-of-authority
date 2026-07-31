import crypto from 'node:crypto';
import type {
    AgentLlmMessage,
    AgentToolDescriptor,
} from '@stdo/shared-types';
import { AgentHostToolService } from './agent-host-tools.js';
import { AgentProfileStoreService } from './agent-profile-store-service.js';
import type {
    AgentCompletionRequester,
    AgentLlmCompletionResponse,
    AgentLlmToolDefinition,
} from './agent-llm-client.js';
import {
    estimateCompactedTokens,
    estimateRequestTokens,
    nextCompactionRequestChunk,
    prepareAgentCompaction,
    type AgentCompactionPlan,
    type AgentCompactionRequestChunk,
} from './agent-session-compaction.js';
import type {
    AgentConversationMessageEntry,
    AgentSessionApprovalState,
    AgentSessionRunState,
    AgentSessionSnapshot,
} from './agent-session-model.js';
import { AgentSessionJournalService } from './agent-session-journal-service.js';
import { AgentSessionRecoveryService } from './agent-session-recovery-service.js';
import type { AgentSessionWriter } from './agent-session-store-service.js';
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

function isContextOverflowError(error: unknown): boolean {
    return /context(?: length| window)|maximum context|prompt (?:is )?too long|too many (?:input )?tokens|tokens?.*(?:exceed|overflow)/i
        .test(errorMessage(error));
}

export interface AgentSessionRunExecutorOptions {
    requestCompletion: AgentCompletionRequester;
    approvalTimeoutMs: number | null;
}

interface PreparedGeneration {
    profileId: string;
    messages: AgentLlmMessage[];
    tools: AgentLlmToolDefinition[];
    stepId: string;
    generationId: string;
}

interface PreparedCompaction {
    plan: AgentCompactionPlan;
    stepId: string;
    tools: AgentLlmToolDefinition[];
    systemMessage: AgentLlmMessage;
}

/**
 * Executes one durable Run. Scheduling, writer ownership, timers and public
 * commands stay in the runtime coordinator; this class owns the model/tool
 * loop and its intent-before-effect protocol.
 */
export class AgentSessionRunExecutor {
    private readonly requestCompletion: AgentCompletionRequester;
    private readonly approvalTimeoutMs: number | null;

    constructor(
        private readonly profileStore: AgentProfileStoreService,
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
        let forceCompaction = false;
        let lastOverflowEstimate: number | null = null;
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
            const compaction = await this.host.perform(
                sessionId,
                writer => this.prepareCompaction(writer, runId, forceCompaction),
            );
            if (compaction) {
                if (!await this.executeCompaction(sessionId, runId, compaction, signal)) return;
                forceCompaction = false;
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
                if (!signal.aborted && isContextOverflowError(error)) {
                    const overflowEstimate = estimateRequestTokens(prepared.messages, prepared.tools);
                    await this.host.perform(sessionId, writer => {
                        this.finishContextOverflowGeneration(writer, runId, prepared, error);
                    });
                    if (lastOverflowEstimate !== null && overflowEstimate >= lastOverflowEstimate) {
                        await this.host.perform(sessionId, writer => {
                            const run = requireRun(writer.snapshot(), runId);
                            if (run.status === 'running') {
                                this.host.append(writer, {
                                    id: crypto.randomUUID(),
                                    type: 'run.suspended',
                                    timestamp: this.host.now(),
                                    runId,
                                    reason: 'Provider still rejected the context after compaction and the request did not become smaller',
                                });
                            }
                        });
                        return;
                    }
                    lastOverflowEstimate = overflowEstimate;
                    forceCompaction = true;
                    continue;
                }
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

    private prepareCompaction(writer: AgentSessionWriter, runId: string, force: boolean): PreparedCompaction | null {
        this.consumeSteeringMessages(writer, runId);
        const snapshot = writer.snapshot();
        const run = requireRun(snapshot, runId);
        if (run.status !== 'running') return null;
        const catalog = this.tools.list(snapshot.session.callerUserHandle, snapshot.session.callerExtensionId);
        const availableIds = new Set(catalog.map(tool => tool.id));
        if (run.allowedTools.some(id => !availableIds.has(id))) return null;
        const descriptors = catalog.filter(tool => run.allowedTools.includes(tool.id)
            && (run.mode !== 'plan' || isPlanSafeTool(tool)));
        const mapped = mapLlmTools(descriptors);
        const messages = conversationMessages(snapshot, run);
        const plan = prepareAgentCompaction(
            snapshot,
            run,
            messages,
            mapped.definitions,
            this.profileStore.getProfileForRequest(run.profileId),
            force,
        );
        if (!plan) return null;
        const stepId = crypto.randomUUID();
        this.host.append(writer, {
            id: crypto.randomUUID(),
            type: 'step.started',
            timestamp: this.host.now(),
            runId,
            stepId,
            index: run.stepCount + 1,
            kind: 'compaction',
        });
        return {
            plan,
            stepId,
            tools: mapped.definitions,
            systemMessage: messages[0]!,
        };
    }

    private async executeCompaction(
        sessionId: string,
        runId: string,
        prepared: PreparedCompaction,
        signal: AbortSignal,
    ): Promise<boolean> {
        const profile = this.profileStore.getProfileForRequest(prepared.plan.profileId);
        let offset = 0;
        let summary = prepared.plan.previousSummary;
        let attempt = 0;
        let maxSourceChars: number | undefined;
        let summaryOutputTokens = prepared.plan.summaryOutputTokens;

        while (offset < prepared.plan.sourceText.length) {
            let chunk: AgentCompactionRequestChunk;
            try {
                chunk = nextCompactionRequestChunk(prepared.plan, offset, summary, {
                    ...(maxSourceChars === undefined ? {} : { maxSourceChars }),
                    summaryOutputTokens,
                });
            } catch (error) {
                await this.host.perform(sessionId, writer => {
                    this.finishCompactionStepFailure(writer, runId, prepared.stepId, error, signal);
                });
                return false;
            }
            const generationId = crypto.randomUUID();
            attempt += 1;
            const started = await this.host.perform(sessionId, writer => {
                const snapshot = writer.snapshot();
                const run = requireRun(snapshot, runId);
                const step = activeStep(snapshot, runId);
                const ref = requireRef(snapshot, prepared.plan.ref);
                if (run.status !== 'running' || step?.id !== prepared.stepId) return false;
                if (ref.leafEntryId !== prepared.plan.sourceLeafEntryId) {
                    this.host.append(writer, {
                        id: crypto.randomUUID(),
                        type: 'step.finished',
                        timestamp: this.host.now(),
                        runId,
                        stepId: prepared.stepId,
                        outcome: 'interrupted',
                        error: 'Conversation changed while context compaction was being prepared',
                    });
                    return false;
                }
                this.host.append(writer, {
                    id: crypto.randomUUID(),
                    type: 'generation.started',
                    timestamp: this.host.now(),
                    runId,
                    stepId: prepared.stepId,
                    generationId,
                    attempt,
                });
                return true;
            });
            if (!started) return true;

            let completion: AgentLlmCompletionResponse;
            try {
                completion = await this.requestCompletion(profile, {
                    messages: chunk.messages,
                    tools: [],
                    signal,
                    maxOutputTokens: summaryOutputTokens,
                });
                if (!completion.message.content?.trim() || completion.message.toolCalls?.length) {
                    throw new Error('Context summarization returned no usable summary');
                }
            } catch (error) {
                if (!signal.aborted && isContextOverflowError(error)) {
                    await this.host.perform(sessionId, writer => {
                        this.finishCompactionAttemptFailure(
                            writer,
                            runId,
                            prepared.stepId,
                            generationId,
                            error,
                            signal,
                        );
                    });
                    if (chunk.consumedChars > 1) {
                        // Provider tokenization is authoritative. Converge by
                        // monotonically shrinking this source slice instead of
                        // relying on a fixed retry count or tokenizer guess.
                        maxSourceChars = Math.max(1, Math.floor(chunk.consumedChars / 2));
                        continue;
                    }
                    if (summaryOutputTokens > 1) {
                        // If even one source character overflows, progressively
                        // release reserved output space and retry from the same
                        // durable offset. This also converges to a one-token floor.
                        summaryOutputTokens = Math.max(1, Math.floor(summaryOutputTokens / 2));
                        maxSourceChars = 1;
                        continue;
                    }
                    await this.host.perform(sessionId, writer => {
                        this.finishCompactionStepFailure(writer, runId, prepared.stepId, error, signal);
                    });
                    return false;
                }
                await this.host.perform(sessionId, writer => {
                    this.finishCompactionFailure(writer, runId, prepared.stepId, generationId, error, signal);
                });
                return false;
            }

            const accepted = await this.host.perform(sessionId, writer => {
                const snapshot = writer.snapshot();
                const run = requireRun(snapshot, runId);
                const generation = snapshot.generations.find(item => item.id === generationId);
                if (!generation || generation.status !== 'running') return false;
                if (run.status === 'cancelling') {
                    this.host.append(writer, {
                        id: crypto.randomUUID(),
                        type: 'generation.finished',
                        timestamp: this.host.now(),
                        runId,
                        stepId: prepared.stepId,
                        generationId,
                        outcome: 'cancelled',
                        providerRequestState: 'response_received',
                        ...(completion.providerRequestId ? { providerRequestId: completion.providerRequestId } : {}),
                        error: 'Context summary arrived after cancellation was requested',
                    });
                    this.journal.finalizeCancellation(writer, runId, 'Cancelled by user');
                    return false;
                }
                if (run.status !== 'running') return false;
                if (this.host.isStopping()) {
                    const message = 'Context summary arrived after the Agent host began stopping';
                    this.host.append(writer, {
                        id: crypto.randomUUID(),
                        type: 'generation.finished',
                        timestamp: this.host.now(),
                        runId,
                        stepId: prepared.stepId,
                        generationId,
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
                        reason: `${message}; resume explicitly to generate a fresh checkpoint`,
                    });
                    return false;
                }
                this.host.append(writer, {
                    id: crypto.randomUUID(),
                    type: 'generation.finished',
                    timestamp: this.host.now(),
                    runId,
                    stepId: prepared.stepId,
                    generationId,
                    outcome: 'completed',
                    providerRequestState: 'response_received',
                    ...(completion.providerRequestId ? { providerRequestId: completion.providerRequestId } : {}),
                    finishReason: completion.finishReason,
                    ...(completion.usage === undefined ? {} : { usage: completion.usage }),
                });
                return true;
            });
            if (!accepted) return false;
            summary = completion.message.content!.trim();
            offset += chunk.consumedChars;
            maxSourceChars = undefined;
        }

        if (!summary) throw new Error('Agent context compaction produced no summary');
        return await this.host.perform(sessionId, writer => {
            const snapshot = writer.snapshot();
            const run = requireRun(snapshot, runId);
            const step = activeStep(snapshot, runId);
            const ref = requireRef(snapshot, prepared.plan.ref);
            if (run.status !== 'running' || step?.id !== prepared.stepId) return false;
            if (ref.leafEntryId !== prepared.plan.sourceLeafEntryId) {
                this.host.append(writer, {
                    id: crypto.randomUUID(),
                    type: 'step.finished',
                    timestamp: this.host.now(),
                    runId,
                    stepId: prepared.stepId,
                    outcome: 'interrupted',
                    error: 'Conversation changed before the context summary could be committed',
                });
                return true;
            }
            const tokensAfter = estimateCompactedTokens(
                prepared.plan,
                summary,
                prepared.tools,
                prepared.systemMessage,
            );
            this.host.append(writer, {
                id: crypto.randomUUID(),
                type: 'conversation.compacted',
                timestamp: this.host.now(),
                ref: prepared.plan.ref,
                parentId: prepared.plan.sourceLeafEntryId,
                summary,
                sourceLeafEntryId: prepared.plan.sourceLeafEntryId,
                sourceLastSequence: prepared.plan.sourceLastSequence,
                firstKeptEntryId: prepared.plan.firstKeptEntryId,
                retainedEntryIds: prepared.plan.retainedEntryIds,
                tokensBefore: prepared.plan.tokensBefore,
                tokensAfter,
                contextWindowTokens: prepared.plan.contextWindowTokens,
                runId,
            });
            this.host.append(writer, {
                id: crypto.randomUUID(),
                type: 'step.finished',
                timestamp: this.host.now(),
                runId,
                stepId: prepared.stepId,
                outcome: 'completed',
                finishReason: 'context_compacted',
            });
            const inputBudget = prepared.plan.contextWindowTokens - prepared.plan.maxOutputTokens;
            if (tokensAfter > inputBudget && tokensAfter >= prepared.plan.tokensBefore) {
                this.host.append(writer, {
                    id: crypto.randomUUID(),
                    type: 'run.suspended',
                    timestamp: this.host.now(),
                    runId,
                    reason: 'Context compaction could not reduce the request enough to fit the configured model window',
                });
                return false;
            }
            return true;
        });
    }

    private finishCompactionFailure(
        writer: AgentSessionWriter,
        runId: string,
        stepId: string,
        generationId: string,
        error: unknown,
        signal: AbortSignal,
    ): void {
        this.finishCompactionAttemptFailure(writer, runId, stepId, generationId, error, signal);
        this.finishCompactionStepFailure(writer, runId, stepId, error, signal);
    }

    private finishCompactionAttemptFailure(
        writer: AgentSessionWriter,
        runId: string,
        stepId: string,
        generationId: string,
        error: unknown,
        signal: AbortSignal,
    ): void {
        const snapshot = writer.snapshot();
        const generation = snapshot.generations.find(item => item.id === generationId);
        if (!generation || generation.status !== 'running') return;
        const run = requireRun(snapshot, runId);
        const message = errorMessage(error);
        const cancelled = run.status === 'cancelling' || signal.aborted;
        this.host.append(writer, {
            id: crypto.randomUUID(),
            type: 'generation.finished',
            timestamp: this.host.now(),
            runId,
            stepId,
            generationId,
            outcome: cancelled ? 'cancelled' : (isTimeoutMessage(message) ? 'timed_out' : 'failed'),
            providerRequestState: 'sent_or_unknown',
            error: message,
        });
    }

    private finishCompactionStepFailure(
        writer: AgentSessionWriter,
        runId: string,
        stepId: string,
        error: unknown,
        signal: AbortSignal,
    ): void {
        const snapshot = writer.snapshot();
        const run = requireRun(snapshot, runId);
        const step = snapshot.steps.find(item => item.id === stepId);
        if (!step || step.status !== 'running') return;
        const message = errorMessage(error);
        const cancelled = run.status === 'cancelling' || signal.aborted;
        this.host.append(writer, {
            id: crypto.randomUUID(),
            type: 'step.finished',
            timestamp: this.host.now(),
            runId,
            stepId,
            outcome: cancelled ? 'cancelled' : 'failed',
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
                reason: `Context summarization failed without altering conversation history: ${message}`,
            });
        }
    }

    private finishContextOverflowGeneration(
        writer: AgentSessionWriter,
        runId: string,
        prepared: PreparedGeneration,
        error: unknown,
    ): void {
        const snapshot = writer.snapshot();
        const generation = snapshot.generations.find(item => item.id === prepared.generationId);
        if (!generation || generation.status !== 'running') return;
        const message = errorMessage(error);
        this.host.append(writer, {
            id: crypto.randomUUID(),
            type: 'generation.finished',
            timestamp: this.host.now(),
            runId,
            stepId: prepared.stepId,
            generationId: prepared.generationId,
            outcome: 'failed',
            providerRequestState: 'sent_or_unknown',
            error: message,
        });
        this.host.append(writer, {
            id: crypto.randomUUID(),
            type: 'step.finished',
            timestamp: this.host.now(),
            runId,
            stepId: prepared.stepId,
            outcome: 'failed',
            finishReason: 'context_overflow',
            error: message,
        });
    }

    private prepareGeneration(writer: AgentSessionWriter, runId: string): PreparedGeneration | null {
        this.consumeSteeringMessages(writer, runId);
        let snapshot = writer.snapshot();
        const run = requireRun(snapshot, runId);
        if (run.status !== 'running') return null;
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
            kind: 'generation',
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
                            ...(this.approvalTimeoutMs === null
                                ? {}
                                : { expiresAt: new Date(Date.parse(timestamp) + this.approvalTimeoutMs).toISOString() }),
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

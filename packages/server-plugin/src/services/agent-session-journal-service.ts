import crypto from 'node:crypto';
import type {
    AgentSessionApprovalState,
    AgentSessionJournalEntry,
    AgentSessionJournalRecord,
    AgentSessionToolInvocationState,
} from './agent-session-model.js';
import type { AgentSessionWriter } from './agent-session-store-service.js';
import {
    activeGeneration,
    activeInvocation,
    activeStep,
    isObject,
    requireRef,
    requireRun,
    TERMINAL_RUNS,
    TERMINAL_TOOLS,
} from './agent-session-runtime-support.js';

export interface AgentSessionJournalHost {
    now(): string;
    append(writer: AgentSessionWriter, entry: AgentSessionJournalEntry): AgentSessionJournalRecord;
}

/**
 * Owns reusable journal protocol transitions. It never opens a writer and
 * never schedules work: callers must enter the per-session actor first.
 */
export class AgentSessionJournalService {
    constructor(private readonly host: AgentSessionJournalHost) {}

    appendToolStarted(writer: AgentSessionWriter, invocation: AgentSessionToolInvocationState): void {
        const idempotencyKey = isObject(invocation.arguments) && typeof invocation.arguments.idempotencyKey === 'string'
            ? invocation.arguments.idempotencyKey
            : undefined;
        this.host.append(writer, {
            id: crypto.randomUUID(),
            type: 'tool.started',
            timestamp: this.host.now(),
            invocationId: invocation.id,
            ...(idempotencyKey ? { idempotencyKey } : {}),
        });
    }

    appendToolResultMessage(writer: AgentSessionWriter, invocation: AgentSessionToolInvocationState): void {
        const snapshot = writer.snapshot();
        if (snapshot.conversation.some(entry => entry.kind === 'message'
            && entry.role === 'tool'
            && entry.stepId === invocation.stepId
            && entry.toolCallId === invocation.callId)) return;
        const run = requireRun(snapshot, invocation.runId);
        const ref = requireRef(snapshot, run.ref);
        const content = invocation.status === 'completed'
            ? JSON.stringify({ ok: true, result: invocation.result ?? null })
            : JSON.stringify({ ok: false, error: invocation.error ?? `Tool ${invocation.status}` });
        this.host.append(writer, {
            id: crypto.randomUUID(),
            type: 'conversation.message',
            timestamp: this.host.now(),
            ref: run.ref,
            parentId: ref.leafEntryId,
            role: 'tool',
            content,
            toolCallId: invocation.callId,
            runId: run.id,
            stepId: invocation.stepId,
        });
    }

    ensureToolResultMessage(writer: AgentSessionWriter, invocationId: string): void {
        const invocation = writer.snapshot().invocations.find(item => item.id === invocationId);
        if (invocation && TERMINAL_TOOLS.has(invocation.status)) this.appendToolResultMessage(writer, invocation);
    }

    recordUnknownToolOutcome(
        writer: AgentSessionWriter,
        invocation: AgentSessionToolInvocationState,
        message: string,
    ): void {
        const current = writer.snapshot().invocations.find(item => item.id === invocation.id);
        if (!current || TERMINAL_TOOLS.has(current.status)) return;
        if (current.status !== 'claimed') {
            throw new Error(`Cannot record an unknown outcome before tool execution starts: ${current.id}`);
        }
        this.host.append(writer, {
            id: crypto.randomUUID(),
            type: 'tool.finished',
            timestamp: this.host.now(),
            invocationId: current.id,
            outcome: 'outcome_unknown',
            error: message,
        });
        this.appendToolResultMessage(
            writer,
            writer.snapshot().invocations.find(item => item.id === current.id)!,
        );
        const step = activeStep(writer.snapshot(), current.runId);
        if (step) {
            this.host.append(writer, {
                id: crypto.randomUUID(),
                type: 'step.finished',
                timestamp: this.host.now(),
                runId: current.runId,
                stepId: step.id,
                outcome: 'interrupted',
                error: message,
            });
        }
    }

    appendToolProtocolError(
        writer: AgentSessionWriter,
        runId: string,
        stepId: string,
        callId: string,
        message: string,
    ): void {
        const snapshot = writer.snapshot();
        const run = requireRun(snapshot, runId);
        const ref = requireRef(snapshot, run.ref);
        this.host.append(writer, {
            id: crypto.randomUUID(),
            type: 'conversation.message',
            timestamp: this.host.now(),
            ref: run.ref,
            parentId: ref.leafEntryId,
            role: 'tool',
            content: JSON.stringify({ ok: false, error: message }),
            toolCallId: callId,
            runId,
            stepId,
        });
    }

    resolveApproval(
        writer: AgentSessionWriter,
        approval: AgentSessionApprovalState,
        decision: 'approved' | 'denied' | 'expired' | 'cancelled',
        resolvedByUserHandle?: string,
    ): void {
        this.host.append(writer, {
            id: crypto.randomUUID(),
            type: 'approval.resolved',
            timestamp: this.host.now(),
            approvalId: approval.id,
            decision,
            ...(resolvedByUserHandle ? { resolvedByUserHandle } : {}),
        });
        if (decision === 'approved') return;
        const invocation = writer.snapshot().invocations.find(item => item.id === approval.invocationId)!;
        this.host.append(writer, {
            id: crypto.randomUUID(),
            type: 'tool.finished',
            timestamp: this.host.now(),
            invocationId: invocation.id,
            outcome: decision === 'expired' ? 'timed_out' : 'cancelled',
            error: decision === 'denied'
                ? 'Tool execution was denied by the user'
                : decision === 'expired' ? 'Tool approval expired before the user responded' : 'Tool approval was cancelled',
        });
        this.appendToolResultMessage(writer, writer.snapshot().invocations.find(item => item.id === invocation.id)!);
    }

    finalizeCancellation(writer: AgentSessionWriter, runId: string, message: string): void {
        let snapshot = writer.snapshot();
        const run = requireRun(snapshot, runId);
        if (TERMINAL_RUNS.has(run.status)) return;
        const step = activeStep(snapshot, runId);
        if (step) {
            const generation = activeGeneration(snapshot, step.id);
            if (generation) {
                this.host.append(writer, {
                    id: crypto.randomUUID(),
                    type: 'generation.finished',
                    timestamp: this.host.now(),
                    runId,
                    stepId: step.id,
                    generationId: generation.id,
                    outcome: 'cancelled',
                    providerRequestState: 'sent_or_unknown',
                    error: message,
                });
            }
            snapshot = writer.snapshot();
            const invocation = activeInvocation(snapshot, step.id);
            if (invocation) {
                const approval = snapshot.approvals.find(item => item.invocationId === invocation.id && item.status === 'pending');
                if (approval) this.resolveApproval(writer, approval, 'cancelled');
                const current = writer.snapshot().invocations.find(item => item.id === invocation.id)!;
                if (!TERMINAL_TOOLS.has(current.status)) {
                    this.host.append(writer, {
                        id: crypto.randomUUID(),
                        type: 'tool.finished',
                        timestamp: this.host.now(),
                        invocationId: current.id,
                        outcome: current.status === 'claimed' ? 'outcome_unknown' : 'cancelled',
                        error: current.status === 'claimed'
                            ? `${message}; the tool may still have produced side effects`
                            : message,
                    });
                    this.appendToolResultMessage(writer, writer.snapshot().invocations.find(item => item.id === current.id)!);
                }
            }
            snapshot = writer.snapshot();
            if (activeStep(snapshot, runId)) {
                this.host.append(writer, {
                    id: crypto.randomUUID(),
                    type: 'step.finished',
                    timestamp: this.host.now(),
                    runId,
                    stepId: step.id,
                    outcome: 'cancelled',
                    error: message,
                });
            }
        }
        this.host.append(writer, {
            id: crypto.randomUUID(),
            type: 'run.finished',
            timestamp: this.host.now(),
            runId,
            outcome: 'cancelled',
            error: message,
        });
    }
}

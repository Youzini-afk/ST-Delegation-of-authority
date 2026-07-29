import crypto from 'node:crypto';
import type {
    AgentSessionApprovalState,
    AgentSessionToolInvocationState,
} from './agent-session-model.js';
import type { AgentSessionWriter } from './agent-session-store-service.js';
import { AgentSessionJournalService, type AgentSessionJournalHost } from './agent-session-journal-service.js';
import {
    activeGeneration,
    activeInvocation,
    activeStep,
    requireRun,
    TERMINAL_RUNS,
} from './agent-session-runtime-support.js';
import { WorkspaceHistoryService } from './workspace-history-service.js';

export interface AgentSessionRecoveryHost extends AgentSessionJournalHost {
    perform<T>(
        sessionId: string,
        operation: (writer: AgentSessionWriter) => T | Promise<T>,
    ): Promise<T>;
    scheduleApprovalExpiry(sessionId: string, approval: AgentSessionApprovalState): void;
    scheduleBrowserExpiry(sessionId: string, invocation: AgentSessionToolInvocationState): void;
}

/**
 * Reconciles durable Session state after ownership loss. It records uncertain
 * effects and suspends work, but never queues or replays a model/tool call.
 */
export class AgentSessionRecoveryService {
    constructor(
        private readonly history: WorkspaceHistoryService,
        private readonly journal: AgentSessionJournalService,
        private readonly host: AgentSessionRecoveryHost,
    ) {}

    async recoverSession(sessionId: string): Promise<number> {
        const recovered = await this.host.perform(sessionId, writer => {
            let count = 0;
            for (const ref of writer.snapshot().refs) {
                if (!ref.activeRunId) continue;
                const run = requireRun(writer.snapshot(), ref.activeRunId);
                if (TERMINAL_RUNS.has(run.status) || run.status === 'suspended') continue;
                count += 1;
                if (run.status === 'waiting_approval') continue;
                this.recoverRun(writer, run.id);
            }
            return count;
        });
        const snapshot = await this.host.perform(sessionId, writer => writer.snapshot());
        for (const approval of snapshot.approvals.filter(item => item.status === 'pending')) {
            this.host.scheduleApprovalExpiry(sessionId, approval);
        }
        for (const invocation of snapshot.invocations.filter(item => item.execution === 'browser'
            && (item.status === 'pending' || item.status === 'claimed')
            && item.deadlineAt)) {
            this.host.scheduleBrowserExpiry(sessionId, invocation);
        }
        return recovered;
    }

    recoverRun(
        writer: AgentSessionWriter,
        runId: string,
        interruptionReason = 'Agent host restarted; review the last durable step and resume explicitly',
    ): void {
        let snapshot = writer.snapshot();
        let run = requireRun(snapshot, runId);
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
                    outcome: 'interrupted',
                    providerRequestState: 'sent_or_unknown',
                    error: `${interruptionReason}; the model request outcome is unknown`,
                });
            }
            snapshot = writer.snapshot();
            const invocation = activeInvocation(snapshot, step.id);
            if (invocation) {
                if (invocation.status === 'waiting_approval') return;
                this.reconcileWorkspaceCheckpoints(writer, invocation);
                if (invocation.status === 'claimed') {
                    this.journal.recordUnknownToolOutcome(
                        writer,
                        invocation,
                        `${interruptionReason}; tool execution started and its side effects are unknown`,
                    );
                } else {
                    this.host.append(writer, {
                        id: crypto.randomUUID(),
                        type: 'tool.finished',
                        timestamp: this.host.now(),
                        invocationId: invocation.id,
                        outcome: 'cancelled',
                        error: `${interruptionReason}; the tool did not start`,
                    });
                    this.journal.appendToolResultMessage(
                        writer,
                        writer.snapshot().invocations.find(item => item.id === invocation.id)!,
                    );
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
                    outcome: 'interrupted',
                    error: `${interruptionReason}; the step did not complete`,
                });
            }
        }
        snapshot = writer.snapshot();
        run = requireRun(snapshot, runId);
        if (run.status === 'cancelling') {
            this.host.append(writer, {
                id: crypto.randomUUID(),
                type: 'run.finished',
                timestamp: this.host.now(),
                runId,
                outcome: 'cancelled',
                error: `${interruptionReason}; cancellation completed during recovery`,
            });
        } else {
            this.host.append(writer, {
                id: crypto.randomUUID(),
                type: 'run.suspended',
                timestamp: this.host.now(),
                runId,
                reason: interruptionReason,
            });
        }
    }

    reconcileWorkspaceCheckpoints(writer: AgentSessionWriter, invocation: AgentSessionToolInvocationState): void {
        const snapshot = writer.snapshot();
        const commits = this.history.findCommitsForToolCall(
            snapshot.session.workspaceId,
            invocation.runId,
            invocation.callId,
        );
        for (const phase of ['before', 'after', 'failure'] as const) {
            const commit = commits.find(item => item.metadata?.mutationPhase === phase);
            const known = phase === 'before'
                ? invocation.beforeCommitId
                : phase === 'after' ? invocation.afterCommitId : invocation.failureCommitId;
            if (commit && !known) {
                this.host.append(writer, {
                    id: crypto.randomUUID(),
                    type: 'workspace.checkpointed',
                    timestamp: this.host.now(),
                    invocationId: invocation.id,
                    phase,
                    commitId: commit.id,
                });
            }
        }
    }

    interruptActiveRun(writer: AgentSessionWriter, runId: string, message: string): void {
        const run = requireRun(writer.snapshot(), runId);
        if (TERMINAL_RUNS.has(run.status) || run.status === 'suspended' || run.status === 'waiting_approval') return;
        this.recoverRun(writer, runId, message);
        const updated = requireRun(writer.snapshot(), runId);
        if (updated.status === 'suspended') return;
        if (updated.status === 'running') {
            this.host.append(writer, {
                id: crypto.randomUUID(),
                type: 'run.suspended',
                timestamp: this.host.now(),
                runId,
                reason: message,
            });
        }
    }
}

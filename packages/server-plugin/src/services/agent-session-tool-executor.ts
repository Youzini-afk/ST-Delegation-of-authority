import crypto from 'node:crypto';
import type { AgentToolDescriptor, ModuleTransactionRequest } from '@stdo/shared-types';
import type { SessionRecord, UserContext } from '../types.js';
import { AgentHostToolService } from './agent-host-tools.js';
import type {
    AgentSessionJournalEntry,
    AgentSessionJournalRecord,
    AgentSessionSnapshot,
    AgentSessionToolInvocationState,
} from './agent-session-model.js';
import { AgentSessionJournalService } from './agent-session-journal-service.js';
import { AgentSessionRecoveryService } from './agent-session-recovery-service.js';
import type { AgentSessionWriter } from './agent-session-store-service.js';
import { AgentToolRegistryService } from './agent-tool-registry-service.js';
import type { ModuleHostService } from './module-host-service.js';
import {
    boundedToolValue,
    errorMessage,
    requireRun,
    TERMINAL_TOOLS,
} from './agent-session-runtime-support.js';
import { WorkspaceHistoryService } from './workspace-history-service.js';

export interface AgentSessionExecutionContext {
    user: UserContext;
    session: SessionRecord;
}

export interface AgentSessionToolExecutorHost {
    perform<T>(
        sessionId: string,
        operation: (writer: AgentSessionWriter) => T | Promise<T>,
    ): Promise<T>;
    append(writer: AgentSessionWriter, entry: AgentSessionJournalEntry): AgentSessionJournalRecord;
    now(): string;
    isStopping(): boolean;
    context(sessionId: string): AgentSessionExecutionContext | undefined;
    scheduleBrowserExpiry(sessionId: string, invocation: AgentSessionToolInvocationState): void;
}

export interface AgentSessionToolExecutorOptions {
    moduleHost?: ModuleHostService;
    browserToolTimeoutMs: number;
}

/**
 * Owns the external-effect boundary for host, module and browser tools.
 * A durable tool intent must exist before this service may start an effect.
 */
export class AgentSessionToolExecutor {
    private readonly moduleHost: ModuleHostService | undefined;
    private readonly browserToolTimeoutMs: number;

    constructor(
        private readonly history: WorkspaceHistoryService,
        private readonly hostTools: AgentHostToolService,
        private readonly tools: AgentToolRegistryService,
        private readonly journal: AgentSessionJournalService,
        private readonly recovery: AgentSessionRecoveryService,
        private readonly host: AgentSessionToolExecutorHost,
        options: AgentSessionToolExecutorOptions,
    ) {
        this.moduleHost = options.moduleHost;
        this.browserToolTimeoutMs = options.browserToolTimeoutMs;
    }

    async execute(
        sessionId: string,
        invocationId: string,
        signal: AbortSignal,
    ): Promise<'completed' | 'waiting'> {
        let snapshot = await this.host.perform(sessionId, writer => writer.snapshot());
        let invocation = snapshot.invocations.find(item => item.id === invocationId);
        if (!invocation || invocation.status !== 'pending') return 'completed';
        const descriptor = this.descriptor(snapshot, invocation.toolId);
        if (descriptor.execution === 'browser') {
            const timestamp = this.host.now();
            const deadlineAt = new Date(Date.parse(timestamp) + this.browserToolTimeoutMs).toISOString();
            const waiting = await this.host.perform(sessionId, writer => {
                const currentSnapshot = writer.snapshot();
                const current = currentSnapshot.invocations.find(item => item.id === invocationId);
                if (!current || current.status !== 'pending') return null;
                const run = requireRun(currentSnapshot, current.runId);
                if (run.status === 'cancelling') {
                    this.host.append(writer, {
                        id: crypto.randomUUID(),
                        type: 'tool.finished',
                        timestamp,
                        invocationId,
                        outcome: 'cancelled',
                        error: 'Cancelled before browser tool dispatch',
                    });
                    this.journal.appendToolResultMessage(
                        writer,
                        writer.snapshot().invocations.find(item => item.id === invocationId)!,
                    );
                    return null;
                }
                if (run.status !== 'running' || signal.aborted || this.host.isStopping()) {
                    throw new Error('Agent run stopped before browser tool dispatch');
                }
                this.host.append(writer, {
                    id: crypto.randomUUID(),
                    type: 'tool.waiting',
                    timestamp,
                    invocationId,
                    reason: 'browser',
                    deadlineAt,
                });
                return writer.snapshot().invocations.find(item => item.id === invocationId)!;
            });
            if (!waiting) return 'completed';
            this.host.scheduleBrowserExpiry(sessionId, waiting);
            return 'waiting';
        }

        try {
            const workspace = this.history.getWorkspace(snapshot.session.workspaceId);
            let result: unknown;
            if (descriptor.mutatesWorkspace) {
                if (descriptor.execution !== 'host') {
                    throw new Error(`Only host tools may declare workspace mutations: ${descriptor.id}`);
                }
                const paths = this.hostTools.checkpointPaths(descriptor.id, invocation.arguments);
                const mutation = await this.history.runMutation(workspace.id, {
                    beforeMessage: `Before ${descriptor.title}`,
                    afterMessage: `After ${descriptor.title}`,
                    failureMessage: `Partial changes from failed ${descriptor.title}`,
                    paths,
                    runId: invocation.runId,
                    toolCallId: invocation.callId,
                    metadata: {
                        agentToolId: descriptor.id,
                        agentSessionId: sessionId,
                        agentInvocationId: invocation.id,
                    },
                }, { kind: 'agent', id: invocation.runId }, () => this.hostTools.execute(descriptor.id, invocation!.arguments, {
                    workspace,
                    runId: invocation!.runId,
                    signal,
                }), {
                    beforeCheckpoint: async checkpoint => {
                        await this.host.perform(sessionId, writer => {
                            const currentSnapshot = writer.snapshot();
                            const current = currentSnapshot.invocations.find(item => item.id === invocationId);
                            const run = current && requireRun(currentSnapshot, current.runId);
                            if (!current
                                || current.status !== 'pending'
                                || run?.status !== 'running'
                                || signal.aborted
                                || this.host.isStopping()) {
                                throw new Error('Agent run stopped before the workspace mutation started');
                            }
                            this.host.append(writer, {
                                id: crypto.randomUUID(),
                                type: 'workspace.checkpointed',
                                timestamp: this.host.now(),
                                invocationId,
                                phase: 'before',
                                commitId: checkpoint.commit.id,
                            });
                            this.journal.appendToolStarted(writer, current);
                        });
                    },
                    afterCheckpoint: async checkpoint => {
                        await this.host.perform(sessionId, writer => this.host.append(writer, {
                            id: crypto.randomUUID(),
                            type: 'workspace.checkpointed',
                            timestamp: this.host.now(),
                            invocationId,
                            phase: 'after',
                            commitId: checkpoint.commit.id,
                        }));
                    },
                    failureCheckpoint: async checkpoint => {
                        await this.host.perform(sessionId, writer => this.host.append(writer, {
                            id: crypto.randomUUID(),
                            type: 'workspace.checkpointed',
                            timestamp: this.host.now(),
                            invocationId,
                            phase: 'failure',
                            commitId: checkpoint.commit.id,
                        }));
                    },
                });
                result = mutation.value;
            } else {
                const started = await this.host.perform(sessionId, writer => {
                    const currentSnapshot = writer.snapshot();
                    const current = currentSnapshot.invocations.find(item => item.id === invocationId);
                    if (!current || current.status !== 'pending') throw new Error('Agent tool is no longer pending');
                    const run = requireRun(currentSnapshot, current.runId);
                    if (run.status === 'cancelling') {
                        this.host.append(writer, {
                            id: crypto.randomUUID(),
                            type: 'tool.finished',
                            timestamp: this.host.now(),
                            invocationId,
                            outcome: 'cancelled',
                            error: 'Cancelled before tool execution started',
                        });
                        this.journal.appendToolResultMessage(
                            writer,
                            writer.snapshot().invocations.find(item => item.id === invocationId)!,
                        );
                        return false;
                    }
                    if (run.status !== 'running') throw new Error('Agent run is no longer active');
                    if (signal.aborted || this.host.isStopping()) {
                        throw new Error('Agent host stopped before tool execution started');
                    }
                    this.journal.appendToolStarted(writer, current);
                    return true;
                });
                if (!started) return 'completed';
                snapshot = await this.host.perform(sessionId, writer => writer.snapshot());
                invocation = snapshot.invocations.find(item => item.id === invocationId)!;
                if (descriptor.execution === 'host') {
                    result = await this.hostTools.execute(descriptor.id, invocation.arguments, {
                        workspace,
                        runId: invocation.runId,
                        signal,
                    });
                } else if (descriptor.execution === 'module' && descriptor.source.kind === 'module') {
                    const context = this.host.context(sessionId);
                    if (!context || !this.moduleHost) {
                        throw new Error(`Agent module execution context is unavailable: ${descriptor.id}`);
                    }
                    result = await this.moduleHost.execute(
                        context.user,
                        context.session,
                        descriptor.source.moduleId,
                        descriptor.source.transactionName,
                        invocation.arguments as ModuleTransactionRequest,
                        signal,
                    );
                } else {
                    throw new Error(`Unsupported Agent tool execution: ${descriptor.id}`);
                }
            }
            await this.host.perform(sessionId, writer => {
                const current = writer.snapshot().invocations.find(item => item.id === invocationId);
                if (!current || current.status !== 'claimed') return;
                this.host.append(writer, {
                    id: crypto.randomUUID(),
                    type: 'tool.finished',
                    timestamp: this.host.now(),
                    invocationId,
                    outcome: 'completed',
                    result: boundedToolValue(result),
                });
                this.journal.appendToolResultMessage(
                    writer,
                    writer.snapshot().invocations.find(item => item.id === invocationId)!,
                );
            });
        } catch (error) {
            await this.host.perform(sessionId, writer => {
                let current = writer.snapshot().invocations.find(item => item.id === invocationId);
                if (!current || TERMINAL_TOOLS.has(current.status)) return;
                if (descriptor.mutatesWorkspace) {
                    this.recovery.reconcileWorkspaceCheckpoints(writer, current);
                    current = writer.snapshot().invocations.find(item => item.id === invocationId)!;
                }
                const run = requireRun(writer.snapshot(), current.runId);
                const endedBeforeStart = current.status === 'pending'
                    && (run.status === 'cancelling' || signal.aborted || this.host.isStopping());
                const uncertain = current.status === 'claimed'
                    && (signal.aborted || this.host.isStopping() || descriptor.execution === 'module');
                if (uncertain) {
                    this.journal.recordUnknownToolOutcome(
                        writer,
                        current,
                        `${errorMessage(error)}; tool execution started and its side effects are unknown`,
                    );
                    const updatedRun = requireRun(writer.snapshot(), run.id);
                    if (updatedRun.status === 'cancelling') {
                        this.host.append(writer, {
                            id: crypto.randomUUID(),
                            type: 'run.finished',
                            timestamp: this.host.now(),
                            runId: run.id,
                            outcome: 'cancelled',
                            error: 'Cancelled while a tool outcome was unknown',
                        });
                    } else {
                        this.host.append(writer, {
                            id: crypto.randomUUID(),
                            type: 'run.suspended',
                            timestamp: this.host.now(),
                            runId: run.id,
                            reason: 'Tool execution ended with an unknown outcome; inspect changes before resuming',
                        });
                    }
                    return;
                }
                this.host.append(writer, {
                    id: crypto.randomUUID(),
                    type: 'tool.finished',
                    timestamp: this.host.now(),
                    invocationId,
                    outcome: endedBeforeStart ? 'cancelled' : 'failed',
                    error: endedBeforeStart
                        ? run.status === 'cancelling'
                            ? 'Cancelled before tool execution started'
                            : 'Agent host stopped before tool execution started'
                        : errorMessage(error),
                });
                this.journal.appendToolResultMessage(
                    writer,
                    writer.snapshot().invocations.find(item => item.id === invocationId)!,
                );
            });
        }
        return 'completed';
    }

    interruptClaimedInvocation(
        writer: AgentSessionWriter,
        invocation: AgentSessionToolInvocationState,
        message: string,
    ): void {
        this.recovery.reconcileWorkspaceCheckpoints(writer, invocation);
        this.journal.recordUnknownToolOutcome(writer, invocation, message);
        this.host.append(writer, {
            id: crypto.randomUUID(),
            type: 'run.suspended',
            timestamp: this.host.now(),
            runId: invocation.runId,
            reason: message,
        });
    }

    private descriptor(snapshot: AgentSessionSnapshot, toolId: string): AgentToolDescriptor {
        const descriptor = this.tools.list(snapshot.session.callerUserHandle, snapshot.session.callerExtensionId)
            .find(tool => tool.id === toolId);
        if (!descriptor) throw new Error(`Agent tool is unavailable: ${toolId}`);
        return descriptor;
    }
}

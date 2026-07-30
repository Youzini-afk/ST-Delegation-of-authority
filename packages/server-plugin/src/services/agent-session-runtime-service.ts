import crypto from 'node:crypto';
import type {
    AgentBrowserToolResultRequest,
    AgentBrowserToolClaimRequest,
    AgentBrowserToolRegistrationRequest,
    AgentBrowserToolRegistrationResponse,
    AgentLlmProfileTestRequest,
    AgentLlmProfileTestResponse,
    AgentSessionCreateRequest,
    AgentSessionSendRequest,
    AgentSessionUpdateRequest,
    AgentToolDescriptor,
} from '@stdo/shared-types';
import type { SessionRecord, UserContext } from '../types.js';
import { AgentHostToolService } from './agent-host-tools.js';
import { AgentProfileStoreService } from './agent-profile-store-service.js';
import {
    AgentLlmClient,
    type AgentCompletionRequester,
} from './agent-llm-client.js';
import {
    AGENT_SESSION_MAIN_REF,
    type AgentSessionApprovalState,
    type AgentSessionJournalEntry,
    type AgentSessionJournalRecord,
    type AgentSessionSnapshot,
    type AgentSessionToolInvocationState,
} from './agent-session-model.js';
import { AgentSessionJournalService } from './agent-session-journal-service.js';
import { AgentSessionRecoveryService } from './agent-session-recovery-service.js';
import { AgentSessionRunExecutor } from './agent-session-run-executor.js';
import { AgentSessionStoreService, type AgentSessionWriter } from './agent-session-store-service.js';
import { AgentSessionToolExecutor } from './agent-session-tool-executor.js';
import { AgentToolRegistryService } from './agent-tool-registry-service.js';
import type { ModuleHostService } from './module-host-service.js';
import {
    assertRunCapacity,
    boundedToolValue,
    delay,
    errorMessage,
    formatInitialMessage,
    MAX_MESSAGE_CHARS,
    normalizeAllowedTools,
    normalizeMode,
    requiredText,
    requireRef,
    requireRun,
    selectOne,
    TERMINAL_RUNS,
    titleFromMessage,
} from './agent-session-runtime-support.js';
import { WorkspaceHistoryService } from './workspace-history-service.js';

const DEFAULT_MAX_STEPS = 24;
const HARD_MAX_STEPS = 64;
const DEFAULT_APPROVAL_TIMEOUT_MS = 10 * 60_000;
const DEFAULT_BROWSER_TOOL_TIMEOUT_MS = 2 * 60_000;
const MAX_CONCURRENT_RUNS = 16;
const FAILED_RUN_CONTINUATION_MESSAGE = '继续完成上一轮未完成的任务。先检查当前工作区和已经完成的操作，再从安全边界继续，不要重复已有副作用。';

export interface AgentSessionCallerContext {
    user: UserContext;
    session: SessionRecord;
}

export interface AgentSessionSendResult {
    snapshot: AgentSessionSnapshot;
    runId: string | null;
    queuedMessageId: string | null;
}

export interface AgentSessionStartResult {
    sessions: number;
    recoveredRuns: number;
    problems: Array<{ sessionId: string; error: string }>;
}

export interface AgentSessionBrowserClaimResult {
    sessionId: string;
    invocation: AgentSessionToolInvocationState;
}

export interface AgentSessionRuntimeOptions {
    requestCompletion?: AgentCompletionRequester;
    moduleHost?: ModuleHostService;
    maxConcurrentRuns?: number;
    approvalTimeoutMs?: number;
    browserToolTimeoutMs?: number;
    shutdownTimeoutMs?: number;
    now?: () => string;
}

type SessionEventListener = (record: AgentSessionJournalRecord) => void;

interface ScheduledRun {
    sessionId: string;
    runId: string;
    userHandle: string;
}

class SessionActor {
    private tail = Promise.resolve();

    constructor(readonly writer: AgentSessionWriter) {}

    perform<T>(operation: (writer: AgentSessionWriter) => T | Promise<T>): Promise<T> {
        const result = this.tail.then(() => operation(this.writer));
        this.tail = result.then(() => undefined, () => undefined);
        return result;
    }

    async close(): Promise<void> {
        await this.tail;
        this.writer.close();
    }
}

export class AgentSessionRuntimeService {
    readonly tools: AgentToolRegistryService;

    private readonly journal: AgentSessionJournalService;
    private readonly recovery: AgentSessionRecoveryService;
    private readonly executor: AgentSessionRunExecutor;
    private readonly maxConcurrentRuns: number;
    private readonly maxConcurrentRunsPerUser: number;
    private readonly approvalTimeoutMs: number;
    private readonly browserToolTimeoutMs: number;
    private readonly shutdownTimeoutMs: number;
    private readonly requestCompletion: AgentCompletionRequester;
    private readonly now: () => string;
    private readonly actors = new Map<string, SessionActor>();
    private readonly contexts = new Map<string, AgentSessionCallerContext>();
    private readonly runLocations = new Map<string, string>();
    private readonly queue: ScheduledRun[] = [];
    private readonly queuedRunIds = new Set<string>();
    private readonly wakeAfterTask = new Set<string>();
    private readonly tasks = new Map<string, Promise<void>>();
    private readonly controllers = new Map<string, AbortController>();
    private readonly approvalTimers = new Map<string, NodeJS.Timeout>();
    private readonly browserTimers = new Map<string, NodeJS.Timeout>();
    private readonly listeners = new Map<string, Set<SessionEventListener>>();
    private startPromise: Promise<AgentSessionStartResult> | null = null;
    private started = false;
    private stopping = false;
    private stopped = false;

    constructor(
        private readonly sessionStore: AgentSessionStoreService,
        private readonly profileStore: AgentProfileStoreService,
        private readonly history: WorkspaceHistoryService,
        hostTools: AgentHostToolService,
        options: AgentSessionRuntimeOptions = {},
    ) {
        const client = new AgentLlmClient();
        this.requestCompletion = options.requestCompletion ?? client.complete.bind(client);
        this.maxConcurrentRuns = options.maxConcurrentRuns ?? 2;
        this.approvalTimeoutMs = options.approvalTimeoutMs ?? DEFAULT_APPROVAL_TIMEOUT_MS;
        this.browserToolTimeoutMs = options.browserToolTimeoutMs ?? DEFAULT_BROWSER_TOOL_TIMEOUT_MS;
        this.shutdownTimeoutMs = options.shutdownTimeoutMs ?? 5_000;
        this.now = options.now ?? (() => new Date().toISOString());
        this.tools = new AgentToolRegistryService(hostTools, options.moduleHost);
        if (!Number.isSafeInteger(this.maxConcurrentRuns)
            || this.maxConcurrentRuns < 1
            || this.maxConcurrentRuns > MAX_CONCURRENT_RUNS) {
            throw new Error(`maxConcurrentRuns must be an integer between 1 and ${MAX_CONCURRENT_RUNS}`);
        }
        this.maxConcurrentRunsPerUser = Math.max(1, this.maxConcurrentRuns - 1);
        if (!Number.isSafeInteger(this.approvalTimeoutMs)
            || this.approvalTimeoutMs < 1
            || this.approvalTimeoutMs > 24 * 60 * 60_000) {
            throw new Error('approvalTimeoutMs must be an integer between 1 ms and 24 hours');
        }
        if (!Number.isSafeInteger(this.browserToolTimeoutMs)
            || this.browserToolTimeoutMs < 1_000
            || this.browserToolTimeoutMs > 10 * 60_000) {
            throw new Error('browserToolTimeoutMs must be an integer between 1000 and 600000 ms');
        }
        if (!Number.isSafeInteger(this.shutdownTimeoutMs)
            || this.shutdownTimeoutMs < 1
            || this.shutdownTimeoutMs > 60_000) {
            throw new Error('shutdownTimeoutMs must be an integer between 1 and 60000 ms');
        }
        const journalHost = {
            now: () => this.now(),
            append: (writer: AgentSessionWriter, entry: AgentSessionJournalEntry) => this.append(writer, entry),
        };
        this.journal = new AgentSessionJournalService(journalHost);
        this.recovery = new AgentSessionRecoveryService(history, this.journal, {
            ...journalHost,
            perform: <T>(sessionId: string, operation: (writer: AgentSessionWriter) => T | Promise<T>) => (
                this.actor(sessionId).perform(operation)
            ),
            scheduleApprovalExpiry: (sessionId, approval) => this.scheduleApprovalExpiry(sessionId, approval),
            scheduleBrowserExpiry: (sessionId, invocation) => this.scheduleBrowserExpiry(sessionId, invocation),
        });
        const executionHost = {
            ...journalHost,
            perform: <T>(sessionId: string, operation: (writer: AgentSessionWriter) => T | Promise<T>) => (
                this.actor(sessionId).perform(operation)
            ),
            isStopping: () => this.stopping,
            context: (sessionId: string) => this.contexts.get(sessionId),
            scheduleBrowserExpiry: (sessionId: string, invocation: AgentSessionToolInvocationState) => (
                this.scheduleBrowserExpiry(sessionId, invocation)
            ),
        };
        const toolExecutor = new AgentSessionToolExecutor(
            history,
            hostTools,
            this.tools,
            this.journal,
            this.recovery,
            executionHost,
            {
                ...(options.moduleHost ? { moduleHost: options.moduleHost } : {}),
                browserToolTimeoutMs: this.browserToolTimeoutMs,
            },
        );
        this.executor = new AgentSessionRunExecutor(
            profileStore,
            hostTools,
            this.tools,
            toolExecutor,
            this.journal,
            this.recovery,
            {
                ...executionHost,
                enqueue: (sessionId, runId) => this.enqueue(sessionId, runId),
                scheduleApprovalExpiry: (sessionId, approval) => this.scheduleApprovalExpiry(sessionId, approval),
                finishRunAndStartFollowUp: (writer, runId, outcome, finalText, error) => (
                    this.finishRunAndStartFollowUp(writer, runId, outcome, finalText, error)
                ),
            },
            {
                requestCompletion: this.requestCompletion,
                approvalTimeoutMs: this.approvalTimeoutMs,
            },
        );
    }

    async testLlmProfile(request: AgentLlmProfileTestRequest): Promise<AgentLlmProfileTestResponse> {
        if (!request || typeof request !== 'object' || !request.profile || typeof request.profile !== 'object') {
            throw new Error('Agent LLM profile test profile is required');
        }
        const profile = this.profileStore.prepareProfileForTest(request.profile);
        const startedAt = Date.now();
        try {
            await this.requestCompletion({
                ...profile,
                maxOutputTokens: Math.min(profile.maxOutputTokens ?? 32, 32),
                timeoutMs: Math.min(profile.timeoutMs, 30_000),
            }, {
                messages: [{ role: 'user', content: 'Reply with OK to confirm this connection.' }],
                tools: [],
                signal: new AbortController().signal,
            });
            return {
                ok: true,
                latencyMs: Math.max(0, Date.now() - startedAt),
            };
        } catch (error) {
            return {
                ok: false,
                latencyMs: Math.max(0, Date.now() - startedAt),
                ...classifyLlmConnectionFailure(error),
            };
        }
    }

    start(): Promise<AgentSessionStartResult> {
        if (this.stopped) return Promise.reject(new Error('Agent session runtime cannot restart after it has stopped'));
        if (this.started) return Promise.resolve({ sessions: 0, recoveredRuns: 0, problems: [] });
        if (this.startPromise) return this.startPromise;
        this.stopping = false;
        this.startPromise = (async () => {
            await new Promise<void>(resolve => setImmediate(resolve));
            try {
                if (this.stopping) return { sessions: 0, recoveredRuns: 0, problems: [] };
                const listed = this.sessionStore.start();
                const problems = [...listed.problems];
                this.started = true;
                let recoveredRuns = 0;
                for (const snapshot of listed.sessions) {
                    for (const run of snapshot.runs) this.runLocations.set(run.id, snapshot.session.id);
                    if (snapshot.refs.some(ref => ref.activeRunId !== null)) {
                        try {
                            recoveredRuns += await this.recovery.recoverSession(snapshot.session.id);
                        } catch (error) {
                            problems.push({ sessionId: snapshot.session.id, error: errorMessage(error) });
                        }
                    }
                }
                return { sessions: listed.sessions.length, recoveredRuns, problems };
            } finally {
                this.startPromise = null;
            }
        })();
        return this.startPromise;
    }

    async stop(): Promise<void> {
        this.stopping = true;
        this.stopped = true;
        await this.startPromise?.catch(() => ({ sessions: 0, recoveredRuns: 0, problems: [] }));
        for (const scheduled of this.queue.splice(0)) {
            this.queuedRunIds.delete(scheduled.runId);
            await this.suspendQueuedRun(scheduled.sessionId, scheduled.runId, 'Agent host stopped before the run started');
        }
        this.wakeAfterTask.clear();
        for (const controller of this.controllers.values()) {
            controller.abort(new Error('Agent host stopped'));
        }
        const settled = Promise.allSettled([...this.tasks.values()]);
        const completed = await Promise.race([settled.then(() => true), delay(this.shutdownTimeoutMs).then(() => false)]);
        if (!completed) {
            console.warn(`[authority] ${this.tasks.size} Agent session run(s) did not stop within ${this.shutdownTimeoutMs} ms`);
        }
        for (const timer of this.approvalTimers.values()) clearTimeout(timer);
        for (const timer of this.browserTimers.values()) clearTimeout(timer);
        this.approvalTimers.clear();
        this.browserTimers.clear();
        const closeActors = async () => {
            await Promise.allSettled([...this.actors.values()].map(actor => actor.close()));
            this.actors.clear();
            this.contexts.clear();
            this.runLocations.clear();
            this.listeners.clear();
        };
        if (completed) {
            await closeActors();
        } else {
            void settled.then(closeActors, closeActors);
        }
        this.started = false;
    }

    async createSession(
        request: AgentSessionCreateRequest,
        callerExtensionId = 'authority',
        callerContext?: AgentSessionCallerContext,
    ): Promise<AgentSessionSnapshot> {
        this.assertRunning();
        const caller = requiredText(callerExtensionId, 'Agent caller extension id', 128);
        if (callerContext && callerContext.session.extension.id !== caller) {
            throw new Error('Agent caller context does not match the caller extension');
        }
        const callerUserHandle = requiredText(callerContext?.user.handle ?? 'authority', 'Agent caller user handle', 200);
        const workspace = selectOne(request.workspaceId, this.history.listWorkspaces(), item => item.id, 'workspace');
        if (callerContext) {
            this.history.assertWorkspaceAccess(workspace.id, callerUserHandle, callerContext.user.isAdmin);
        }
        const profile = selectOne(request.profileId, this.profileStore.listProfiles(), item => item.id, 'LLM profile');
        const mode = normalizeMode(request.mode);
        const availableTools = this.tools.list(callerUserHandle, caller);
        const allowedTools = normalizeAllowedTools(request.allowedTools, availableTools);
        const maxSteps = request.maxSteps ?? DEFAULT_MAX_STEPS;
        if (!Number.isSafeInteger(maxSteps) || maxSteps < 1 || maxSteps > HARD_MAX_STEPS) {
            throw new Error(`Agent maxSteps must be an integer between 1 and ${HARD_MAX_STEPS}`);
        }
        const firstMessage = request.message === undefined
            ? undefined
            : formatInitialMessage(request.message, request.instructions, request.context);
        if (firstMessage === undefined && (request.instructions !== undefined || request.context !== undefined)) {
            throw new Error('Agent instructions and context require an initial message');
        }
        const title = request.title === undefined
            ? titleFromMessage(firstMessage ?? `Agent session for ${workspace.displayName}`)
            : requiredText(request.title, 'Agent session title', 500);
        const snapshot = this.sessionStore.createSession({
            callerUserHandle,
            callerExtensionId: caller,
            workspaceId: workspace.id,
            title,
            profileId: profile.id,
            mode,
            allowedTools,
            maxSteps,
        });
        if (callerContext) this.contexts.set(snapshot.session.id, callerContext);
        if (firstMessage === undefined) return snapshot;
        return (await this.sendMessage(
            snapshot.session.id,
            { content: firstMessage },
            callerContext ? caller : undefined,
            callerContext,
        )).snapshot;
    }

    async updateSession(
        sessionId: string,
        request: AgentSessionUpdateRequest,
        callerExtensionId?: string,
        callerContext?: AgentSessionCallerContext,
    ): Promise<AgentSessionSnapshot> {
        this.assertRunning();
        if (callerContext && callerExtensionId && callerContext.session.extension.id !== callerExtensionId) {
            throw new Error('Agent caller context does not match the caller extension');
        }
        const actor = this.actor(sessionId);
        const snapshot = await actor.perform(writer => {
            const current = writer.snapshot();
            this.assertOwner(current, callerExtensionId, callerContext?.user.handle);
            const update: Extract<AgentSessionJournalEntry, { type: 'session.updated' }> = {
                id: crypto.randomUUID(),
                type: 'session.updated',
                timestamp: this.now(),
            };
            if (request.title !== undefined) {
                update.title = requiredText(request.title, 'Agent session title', 500);
            }
            if (request.profileId !== undefined) {
                update.profileId = selectOne(
                    request.profileId,
                    this.profileStore.listProfiles(),
                    item => item.id,
                    'LLM profile',
                ).id;
            }
            if (request.mode !== undefined) update.mode = normalizeMode(request.mode);
            if (request.allowedTools !== undefined) {
                update.allowedTools = normalizeAllowedTools(
                    request.allowedTools,
                    this.tools.list(current.session.callerUserHandle, current.session.callerExtensionId),
                );
            }
            if (request.maxSteps !== undefined) {
                if (!Number.isSafeInteger(request.maxSteps)
                    || request.maxSteps < 1
                    || request.maxSteps > HARD_MAX_STEPS) {
                    throw new Error(`Agent maxSteps must be an integer between 1 and ${HARD_MAX_STEPS}`);
                }
                update.maxSteps = request.maxSteps;
            }
            if (request.archived !== undefined) {
                if (typeof request.archived !== 'boolean') throw new Error('Agent session archived must be boolean');
                update.archived = request.archived;
            }
            if (Object.keys(update).length === 3) throw new Error('Agent session update is empty');
            this.append(writer, update);
            return writer.snapshot();
        });
        if (callerContext) this.contexts.set(sessionId, callerContext);
        return snapshot;
    }

    listSessions(callerExtensionId?: string, callerUserHandle?: string): AgentSessionSnapshot[] {
        const sessions = this.sessionStore.listSessions().sessions;
        if (callerExtensionId === undefined && callerUserHandle === undefined) return sessions;
        if (!callerExtensionId || !callerUserHandle) {
            throw new Error('Agent session owner requires both user and extension identity');
        }
        return sessions.filter(snapshot => snapshot.session.callerExtensionId === callerExtensionId
            && snapshot.session.callerUserHandle === callerUserHandle);
    }

    async getSession(sessionId: string): Promise<AgentSessionSnapshot> {
        const actor = this.actors.get(sessionId);
        return actor
            ? await actor.perform(writer => writer.snapshot())
            : this.sessionStore.readSession(sessionId).snapshot;
    }

    async sendMessage(
        sessionId: string,
        request: AgentSessionSendRequest,
        callerExtensionId?: string,
        callerContext?: AgentSessionCallerContext,
    ): Promise<AgentSessionSendResult> {
        this.assertRunning();
        const content = requiredText(request.content, 'Agent message', MAX_MESSAGE_CHARS);
        const actor = this.actor(sessionId);
        const result = await actor.perform(writer => {
            const before = writer.snapshot();
            this.assertOwner(before, callerExtensionId, callerContext?.user.handle);
            const refName = request.ref ?? AGENT_SESSION_MAIN_REF;
            const ref = before.refs.find(item => item.name === refName);
            if (!ref) throw new Error(`Agent session ref not found: ${refName}`);
            if (ref.activeRunId) {
                const run = requireRun(before, ref.activeRunId);
                const delivery = request.delivery === undefined || request.delivery === 'auto'
                    ? (run.status === 'running' ? 'steer' : 'follow_up')
                    : request.delivery;
                const queueId = crypto.randomUUID();
                this.append(writer, {
                    id: crypto.randomUUID(),
                    type: 'queue.added',
                    timestamp: this.now(),
                    queueId,
                    ref: refName,
                    kind: delivery,
                    content,
                    runId: run.id,
                });
                return { snapshot: writer.snapshot(), runId: run.id, queuedMessageId: queueId, acceptedRunId: null };
            }
            const acceptedRunId = this.appendUserAndAcceptRun(writer, refName, content);
            return {
                snapshot: writer.snapshot(),
                runId: acceptedRunId,
                queuedMessageId: null,
                acceptedRunId,
            };
        });
        if (callerContext) this.contexts.set(sessionId, callerContext);
        if (result.acceptedRunId) this.enqueue(sessionId, result.acceptedRunId);
        return { snapshot: result.snapshot, runId: result.runId, queuedMessageId: result.queuedMessageId };
    }

    async continueFailedRun(
        sessionId: string,
        failedRunId: string,
        callerExtensionId?: string,
        callerContext?: AgentSessionCallerContext,
    ): Promise<AgentSessionSendResult> {
        this.assertRunning();
        const actor = this.actor(sessionId);
        const result = await actor.perform(writer => {
            const before = writer.snapshot();
            this.assertOwner(before, callerExtensionId, callerContext?.user.handle);
            const existing = before.runs.find(run => run.continuedFromRunId === failedRunId);
            if (existing) {
                return { snapshot: before, runId: existing.id, queuedMessageId: null, acceptedRunId: null };
            }
            const failed = requireRun(before, failedRunId);
            if (failed.status !== 'failed') {
                throw new Error(`Agent run is not failed: ${failed.status}`);
            }
            const latest = before.runs.filter(run => run.ref === failed.ref).at(-1);
            if (latest?.id !== failed.id) {
                throw new Error('Agent failed run is no longer the latest run on its ref');
            }
            const ref = requireRef(before, failed.ref);
            if (ref.activeRunId) {
                throw new Error(`Agent session ref already has an active run: ${failed.ref}`);
            }
            const acceptedRunId = this.appendUserAndAcceptRun(
                writer,
                failed.ref,
                FAILED_RUN_CONTINUATION_MESSAGE,
                failed.id,
            );
            return {
                snapshot: writer.snapshot(),
                runId: acceptedRunId,
                queuedMessageId: null,
                acceptedRunId,
            };
        });
        if (callerContext) this.contexts.set(sessionId, callerContext);
        if (result.acceptedRunId) this.enqueue(sessionId, result.acceptedRunId);
        return { snapshot: result.snapshot, runId: result.runId, queuedMessageId: result.queuedMessageId };
    }

    attachContext(sessionId: string, callerExtensionId: string, context: AgentSessionCallerContext): void {
        this.assertRunning();
        const snapshot = this.sessionStore.readSession(sessionId).snapshot;
        this.assertOwner(snapshot, callerExtensionId, context.user.handle);
        if (context.session.extension.id !== callerExtensionId) {
            throw new Error('Agent caller context does not match the caller extension');
        }
        this.contexts.set(sessionId, context);
    }

    async resumeRun(
        sessionId: string,
        runId: string,
        callerExtensionId?: string,
        callerContext?: AgentSessionCallerContext,
    ): Promise<AgentSessionSnapshot> {
        this.assertRunning();
        const actor = this.actor(sessionId);
        const snapshot = await actor.perform(writer => {
            const current = writer.snapshot();
            this.assertOwner(current, callerExtensionId, callerContext?.user.handle);
            const run = requireRun(current, runId);
            if (run.status !== 'suspended') throw new Error(`Agent run is not suspended: ${run.status}`);
            this.append(writer, {
                id: crypto.randomUUID(),
                type: 'run.resumed',
                timestamp: this.now(),
                runId,
            });
            return writer.snapshot();
        });
        if (callerContext) this.contexts.set(sessionId, callerContext);
        this.enqueue(sessionId, runId);
        return snapshot;
    }

    async cancelRun(sessionId: string, runId: string): Promise<AgentSessionSnapshot> {
        this.assertRunning();
        const actor = this.actor(sessionId);
        const shouldFinalize = await actor.perform(writer => {
            const snapshot = writer.snapshot();
            const run = requireRun(snapshot, runId);
            if (TERMINAL_RUNS.has(run.status)) return false;
            if (run.status !== 'cancelling') {
                this.append(writer, {
                    id: crypto.randomUUID(),
                    type: 'run.cancel_requested',
                    timestamp: this.now(),
                    runId,
                });
            }
            return !this.tasks.has(runId);
        });
        const queueIndex = this.queue.findIndex(item => item.runId === runId);
        if (queueIndex !== -1) {
            this.queue.splice(queueIndex, 1);
            this.queuedRunIds.delete(runId);
        }
        this.controllers.get(runId)?.abort(new Error('Agent run cancelled'));
        if (shouldFinalize || queueIndex !== -1) {
            await actor.perform(writer => this.journal.finalizeCancellation(writer, runId, 'Cancelled by user'));
        }
        return await actor.perform(writer => writer.snapshot());
    }

    async resolveApproval(
        sessionId: string,
        approvalId: string,
        decision: 'approve' | 'deny',
        resolvedByUserHandle?: string,
    ): Promise<AgentSessionSnapshot> {
        this.assertRunning();
        const actor = this.actor(sessionId);
        const runId = await actor.perform(writer => {
            const snapshot = writer.snapshot();
            const approval = snapshot.approvals.find(item => item.id === approvalId);
            if (!approval || approval.status !== 'pending') {
                throw new Error(`Agent approval is no longer pending: ${approvalId}`);
            }
            this.journal.resolveApproval(
                writer,
                approval,
                decision === 'approve' ? 'approved' : 'denied',
                resolvedByUserHandle,
            );
            return approval.runId;
        });
        this.clearApprovalTimer(approvalId);
        this.enqueue(sessionId, runId);
        return await actor.perform(writer => writer.snapshot());
    }

    registerBrowserTools(
        userHandle: string,
        extensionId: string,
        request: AgentBrowserToolRegistrationRequest,
    ): AgentBrowserToolRegistrationResponse {
        this.assertRunning();
        return this.tools.registerBrowserTools(userHandle, extensionId, request);
    }

    async claimBrowserTool(
        userHandle: string,
        extensionId: string,
        request: AgentBrowserToolClaimRequest,
    ): Promise<AgentSessionBrowserClaimResult | null> {
        this.assertRunning();
        const browserInstanceId = requiredText(request.browserInstanceId, 'Browser instance id', 128);
        const claimId = requiredText(request.claimId, 'Browser tool claim id', 128);
        const allowedIds = new Set(this.tools.browserDescriptors(userHandle, extensionId, browserInstanceId).map(tool => tool.id));
        const requestedCallId = request.callId === undefined
            ? undefined
            : requiredText(request.callId, 'Browser tool call id', 256);
        for (const snapshot of this.listSessions(extensionId, userHandle)) {
            const alreadyClaimed = snapshot.invocations.find(invocation => invocation.execution === 'browser'
                && invocation.status === 'claimed'
                && invocation.claimId === claimId
                && allowedIds.has(invocation.toolId)
                && (requestedCallId === undefined || invocation.callId === requestedCallId));
            if (alreadyClaimed) {
                return { sessionId: snapshot.session.id, invocation: alreadyClaimed };
            }
            const candidate = snapshot.invocations.find(invocation => invocation.execution === 'browser'
                && invocation.status === 'pending'
                && allowedIds.has(invocation.toolId)
                && (requestedCallId === undefined || invocation.callId === requestedCallId));
            if (!candidate) continue;
            const actor = this.actor(snapshot.session.id);
            const claimed = await actor.perform(writer => {
                const current = writer.snapshot();
                const invocation = current.invocations.find(item => item.id === candidate.id);
                if (!invocation || invocation.status !== 'pending') return null;
                this.append(writer, {
                    id: crypto.randomUUID(),
                    type: 'tool.started',
                    timestamp: this.now(),
                    invocationId: invocation.id,
                    claimId,
                });
                return writer.snapshot().invocations.find(item => item.id === invocation.id)!;
            });
            if (claimed) return { sessionId: snapshot.session.id, invocation: claimed };
        }
        if (requestedCallId) throw new Error(`Browser tool invocation is unavailable: ${requestedCallId}`);
        return null;
    }

    async submitBrowserToolResult(
        userHandle: string,
        extensionId: string,
        request: AgentBrowserToolResultRequest,
    ): Promise<AgentSessionToolInvocationState> {
        this.assertRunning();
        if (request.status !== 'completed' && request.status !== 'failed' && request.status !== 'cancelled') {
            throw new Error('Browser tool result status must be completed, failed, or cancelled');
        }
        const sessionId = this.runLocations.get(requiredText(request.runId, 'Agent run id', 128));
        if (!sessionId) throw new Error(`Agent run not found: ${request.runId}`);
        const actor = this.actor(sessionId);
        const result = await actor.perform(writer => {
            const snapshot = writer.snapshot();
            this.assertOwner(snapshot, extensionId, userHandle);
            const invocation = snapshot.invocations.find(item => item.runId === request.runId && item.callId === request.callId);
            if (!invocation || invocation.execution !== 'browser' || invocation.status !== 'claimed') {
                throw new Error(`Browser tool invocation is unavailable: ${request.callId}`);
            }
            if (invocation.claimId !== request.claimId) {
                throw new Error(`Browser tool invocation is not claimed by this browser: ${request.callId}`);
            }
            const descriptor = this.descriptor(snapshot, invocation.toolId);
            if (descriptor.source.kind !== 'browser'
                || descriptor.source.browserInstanceId !== request.browserInstanceId
                || descriptor.source.userHandle !== userHandle
                || descriptor.source.extensionId !== extensionId) {
                throw new Error(`Browser tool invocation owner mismatch: ${request.callId}`);
            }
            const timestamp = this.now();
            if (request.status === 'completed') {
                this.append(writer, {
                    id: crypto.randomUUID(),
                    type: 'tool.finished',
                    timestamp,
                    invocationId: invocation.id,
                    outcome: 'completed',
                    result: boundedToolValue(request.result),
                });
            } else {
                this.append(writer, {
                    id: crypto.randomUUID(),
                    type: 'tool.finished',
                    timestamp,
                    invocationId: invocation.id,
                    outcome: request.status,
                    error: requiredText(request.error ?? `Browser tool ${request.status}`, 'Browser tool error', 10_000),
                });
            }
            const updated = writer.snapshot().invocations.find(item => item.id === invocation.id)!;
            this.journal.appendToolResultMessage(writer, updated);
            return updated;
        });
        this.clearBrowserTimer(result.id);
        this.enqueue(sessionId, result.runId);
        return result;
    }

    subscribe(sessionId: string, listener: SessionEventListener): () => void {
        this.assertRunning();
        return this.addListener(sessionId, listener);
    }

    async openSubscription(
        sessionId: string,
        listener: SessionEventListener,
        callerExtensionId?: string,
        callerContext?: AgentSessionCallerContext,
    ): Promise<{ snapshot: AgentSessionSnapshot; close: () => void }> {
        this.assertRunning();
        if (callerContext && callerExtensionId && callerContext.session.extension.id !== callerExtensionId) {
            throw new Error('Agent caller context does not match the caller extension');
        }
        const actor = this.actor(sessionId);
        const opened = await actor.perform(writer => {
            const snapshot = writer.snapshot();
            this.assertOwner(snapshot, callerExtensionId, callerContext?.user.handle);
            return {
                snapshot,
                close: this.addListener(sessionId, listener),
            };
        });
        if (callerContext) this.contexts.set(sessionId, callerContext);
        return opened;
    }

    private enqueue(sessionId: string, runId: string): void {
        if (this.stopping || this.queuedRunIds.has(runId)) return;
        if (this.tasks.has(runId)) {
            this.wakeAfterTask.add(runId);
            return;
        }
        const snapshot = this.actors.get(sessionId)?.writer.snapshot() ?? this.sessionStore.readSession(sessionId).snapshot;
        const run = requireRun(snapshot, runId);
        if (run.status !== 'queued' && run.status !== 'running') return;
        this.queue.push({ sessionId, runId, userHandle: snapshot.session.callerUserHandle });
        this.queuedRunIds.add(runId);
        this.drainQueue();
    }

    private drainQueue(): void {
        if (this.stopping) return;
        while (this.tasks.size < this.maxConcurrentRuns && this.queue.length > 0) {
            const index = this.nextRunnableQueueIndex();
            if (index === -1) return;
            const scheduled = this.queue.splice(index, 1)[0]!;
            this.queuedRunIds.delete(scheduled.runId);
            const task = this.executeRun(scheduled.sessionId, scheduled.runId)
                .catch(error => this.handleRunFailure(scheduled.sessionId, scheduled.runId, error))
                .finally(() => {
                    this.tasks.delete(scheduled.runId);
                    this.controllers.delete(scheduled.runId);
                    const shouldWake = this.wakeAfterTask.delete(scheduled.runId);
                    if (shouldWake && !this.stopping) {
                        this.enqueue(scheduled.sessionId, scheduled.runId);
                    }
                    this.drainQueue();
                });
            this.tasks.set(scheduled.runId, task);
        }
    }

    private nextRunnableQueueIndex(): number {
        const activeByUser = new Map<string, number>();
        for (const runId of this.tasks.keys()) {
            const sessionId = this.runLocations.get(runId);
            if (!sessionId) continue;
            const snapshot = this.actors.get(sessionId)?.writer.snapshot() ?? this.sessionStore.readSession(sessionId).snapshot;
            const user = snapshot.session.callerUserHandle;
            activeByUser.set(user, (activeByUser.get(user) ?? 0) + 1);
        }
        return this.queue.findIndex(item => (activeByUser.get(item.userHandle) ?? 0) < this.maxConcurrentRunsPerUser);
    }

    private async executeRun(sessionId: string, runId: string): Promise<void> {
        const controller = new AbortController();
        this.controllers.set(runId, controller);
        await this.executor.execute(sessionId, runId, controller.signal);
    }

    private async handleRunFailure(sessionId: string, runId: string, error: unknown): Promise<void> {
        const message = errorMessage(error);
        console.warn(`[authority] Agent session run ${runId} failed unexpectedly: ${message}`);
        try {
            await this.actor(sessionId).perform(writer => {
                const run = requireRun(writer.snapshot(), runId);
                if (TERMINAL_RUNS.has(run.status) || run.status === 'suspended' || run.status === 'waiting_approval') return;
                if (run.status === 'cancelling') {
                    this.journal.finalizeCancellation(writer, runId, 'Cancelled while the Agent run was unwinding');
                    return;
                }
                this.recovery.interruptActiveRun(
                    writer,
                    runId,
                    `Agent execution failed unexpectedly and was suspended: ${message}`,
                );
            });
        } catch (recoveryError) {
            console.warn(
                `[authority] Unable to persist failure state for Agent session run ${runId}: ${errorMessage(recoveryError)}`,
            );
        }
    }

    private scheduleApprovalExpiry(sessionId: string, approval: AgentSessionApprovalState): void {
        if (approval.status !== 'pending' || !approval.expiresAt) return;
        this.clearApprovalTimer(approval.id);
        const delayMs = Math.max(0, Date.parse(approval.expiresAt) - Date.now());
        const timer = setTimeout(() => {
            void this.expireApproval(sessionId, approval.id).catch(error => {
                console.warn(`[authority] Unable to expire Agent session approval ${approval.id}: ${errorMessage(error)}`);
            });
        }, Math.min(delayMs, 0x7fffffff));
        timer.unref();
        this.approvalTimers.set(approval.id, timer);
    }

    private async expireApproval(sessionId: string, approvalId: string): Promise<void> {
        const actor = this.actor(sessionId);
        const runId = await actor.perform(writer => {
            const approval = writer.snapshot().approvals.find(item => item.id === approvalId);
            if (!approval || approval.status !== 'pending') return null;
            this.journal.resolveApproval(writer, approval, 'expired');
            return approval.runId;
        });
        this.clearApprovalTimer(approvalId);
        if (runId) this.enqueue(sessionId, runId);
    }

    private clearApprovalTimer(approvalId: string): void {
        const timer = this.approvalTimers.get(approvalId);
        if (timer) clearTimeout(timer);
        this.approvalTimers.delete(approvalId);
    }

    private scheduleBrowserExpiry(sessionId: string, invocation: AgentSessionToolInvocationState): void {
        if (!invocation.deadlineAt || (invocation.status !== 'pending' && invocation.status !== 'claimed')) return;
        this.clearBrowserTimer(invocation.id);
        const delayMs = Math.max(0, Date.parse(invocation.deadlineAt) - Date.now());
        const timer = setTimeout(() => {
            void this.expireBrowserTool(sessionId, invocation.id).catch(error => {
                console.warn(`[authority] Unable to expire Agent browser tool ${invocation.id}: ${errorMessage(error)}`);
            });
        }, Math.min(delayMs, 0x7fffffff));
        timer.unref();
        this.browserTimers.set(invocation.id, timer);
    }

    private async expireBrowserTool(sessionId: string, invocationId: string): Promise<void> {
        const actor = this.actor(sessionId);
        const result = await actor.perform(writer => {
            const snapshot = writer.snapshot();
            const invocation = snapshot.invocations.find(item => item.id === invocationId);
            if (!invocation || (invocation.status !== 'pending' && invocation.status !== 'claimed')) return null;
            const claimed = invocation.status === 'claimed';
            const message = claimed
                ? 'Browser tool timed out after it was claimed; its side effects are unknown'
                : 'Browser tool timed out before it was claimed';
            if (claimed) {
                this.journal.recordUnknownToolOutcome(writer, invocation, message);
                this.append(writer, {
                    id: crypto.randomUUID(),
                    type: 'run.suspended',
                    timestamp: this.now(),
                    runId: invocation.runId,
                    reason: message,
                });
                return { runId: invocation.runId, resume: false };
            }
            this.append(writer, {
                id: crypto.randomUUID(),
                type: 'tool.finished',
                timestamp: this.now(),
                invocationId,
                outcome: 'timed_out',
                error: message,
            });
            this.journal.appendToolResultMessage(
                writer,
                writer.snapshot().invocations.find(item => item.id === invocationId)!,
            );
            return { runId: invocation.runId, resume: true };
        });
        this.clearBrowserTimer(invocationId);
        if (result?.resume) this.enqueue(sessionId, result.runId);
    }

    private clearBrowserTimer(invocationId: string): void {
        const timer = this.browserTimers.get(invocationId);
        if (timer) clearTimeout(timer);
        this.browserTimers.delete(invocationId);
    }

    private finishRunAndStartFollowUp(
        writer: AgentSessionWriter,
        runId: string,
        outcome: 'completed' | 'failed' | 'cancelled',
        finalText?: string,
        error?: string,
    ): string | null {
        const run = requireRun(writer.snapshot(), runId);
        this.append(writer, {
            id: crypto.randomUUID(),
            type: 'run.finished',
            timestamp: this.now(),
            runId,
            outcome,
            ...(finalText === undefined ? {} : { finalText }),
            ...(error === undefined ? {} : { error }),
        });
        const snapshot = writer.snapshot();
        const next = snapshot.pendingMessages
            .filter(item => item.ref === run.ref && (item.kind === 'follow_up' || item.kind === 'next_run'))
            .sort((left, right) => left.createdAt.localeCompare(right.createdAt) || left.id.localeCompare(right.id))[0];
        if (!next) return null;
        const ref = requireRef(snapshot, run.ref);
        const messageId = crypto.randomUUID();
        this.append(writer, {
            id: messageId,
            type: 'conversation.message',
            timestamp: this.now(),
            ref: run.ref,
            parentId: ref.leafEntryId,
            role: 'user',
            content: next.content,
            consumedQueueId: next.id,
        });
        const nextRunId = this.acceptRun(writer, run.ref, messageId);
        this.runLocations.set(nextRunId, snapshot.session.id);
        return nextRunId;
    }

    private appendUserAndAcceptRun(
        writer: AgentSessionWriter,
        refName: string,
        content: string,
        continuedFromRunId?: string,
    ): string {
        const ref = requireRef(writer.snapshot(), refName);
        const messageId = crypto.randomUUID();
        this.append(writer, {
            id: messageId,
            type: 'conversation.message',
            timestamp: this.now(),
            ref: refName,
            parentId: ref.leafEntryId,
            role: 'user',
            content,
        });
        const runId = this.acceptRun(writer, refName, messageId, continuedFromRunId);
        this.runLocations.set(runId, writer.snapshot().session.id);
        return runId;
    }

    private acceptRun(
        writer: AgentSessionWriter,
        refName: string,
        triggerMessageId: string,
        continuedFromRunId?: string,
    ): string {
        const snapshot = writer.snapshot();
        assertRunCapacity(snapshot, this.listSessions());
        const runId = crypto.randomUUID();
        this.append(writer, {
            id: crypto.randomUUID(),
            type: 'run.accepted',
            timestamp: this.now(),
            runId,
            ref: refName,
            triggerMessageId,
            ...(continuedFromRunId === undefined ? {} : { continuedFromRunId }),
            profileId: snapshot.session.profileId,
            mode: snapshot.session.mode,
            allowedTools: snapshot.session.allowedTools,
            maxSteps: snapshot.session.maxSteps,
        });
        return runId;
    }

    private async suspendQueuedRun(sessionId: string, runId: string, reason: string): Promise<void> {
        const actor = this.actor(sessionId);
        await actor.perform(writer => {
            const run = requireRun(writer.snapshot(), runId);
            if (run.status === 'queued') {
                this.append(writer, { id: crypto.randomUUID(), type: 'run.suspended', timestamp: this.now(), runId, reason });
            }
        });
    }

    private descriptor(snapshot: AgentSessionSnapshot, toolId: string): AgentToolDescriptor {
        const descriptor = this.tools.list(snapshot.session.callerUserHandle, snapshot.session.callerExtensionId)
            .find(tool => tool.id === toolId);
        if (!descriptor) throw new Error(`Agent tool is unavailable: ${toolId}`);
        return descriptor;
    }

    private actor(sessionId: string): SessionActor {
        const existing = this.actors.get(sessionId);
        if (existing) return existing;
        const actor = new SessionActor(this.sessionStore.openWriter(sessionId));
        this.actors.set(sessionId, actor);
        return actor;
    }

    private append(writer: AgentSessionWriter, entry: AgentSessionJournalEntry): AgentSessionJournalRecord {
        const record = writer.append(entry);
        for (const listener of this.listeners.get(writer.sessionId) ?? []) {
            try {
                listener(record);
            } catch (error) {
                console.warn(`[authority] Agent session listener failed: ${errorMessage(error)}`);
            }
        }
        return record;
    }

    private addListener(sessionId: string, listener: SessionEventListener): () => void {
        const listeners = this.listeners.get(sessionId) ?? new Set<SessionEventListener>();
        listeners.add(listener);
        this.listeners.set(sessionId, listeners);
        return () => {
            listeners.delete(listener);
            if (listeners.size === 0) this.listeners.delete(sessionId);
        };
    }

    private assertOwner(snapshot: AgentSessionSnapshot, extensionId?: string, userHandle?: string): void {
        if (extensionId === undefined && userHandle === undefined) return;
        if (!extensionId || !userHandle
            || snapshot.session.callerExtensionId !== extensionId
            || snapshot.session.callerUserHandle !== userHandle) {
            throw new Error(`Agent session not found: ${snapshot.session.id}`);
        }
    }

    private assertRunning(): void {
        if (!this.started || this.stopping) throw new Error('Agent session runtime is not running');
    }
}

function classifyLlmConnectionFailure(
    error: unknown,
): Omit<Extract<AgentLlmProfileTestResponse, { ok: false }>, 'ok' | 'latencyMs'> {
    const message = errorMessage(error);
    if (/timed out|timeout/i.test(message)) {
        return { failure: 'timeout' };
    }
    const upstreamStatus = /^LLM request failed \((\d{3})\):/.exec(message);
    if (upstreamStatus) {
        return { failure: 'rejected', statusCode: Number(upstreamStatus[1]) };
    }
    if (/invalid JSON|did not include an assistant message|assistant message was empty|response exceeded|assistant content exceeded|invalid tool call/i.test(message)) {
        return { failure: 'invalid_response' };
    }
    return { failure: 'unreachable' };
}

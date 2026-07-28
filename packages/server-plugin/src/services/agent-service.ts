import crypto from 'node:crypto';
import type {
    AgentApprovalRecord,
    AgentApprovalResolveRequest,
    AgentBrowserToolClaimRequest,
    AgentBrowserToolClaimResponse,
    AgentBrowserToolRegistrationRequest,
    AgentBrowserToolRegistrationResponse,
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
    AgentToolResultRequest,
    ModuleTransactionManifest,
    ModuleTransactionRequest,
} from '@stdo/shared-types';
import type { SessionRecord, UserContext } from '../types.js';
import { AuthorityServiceError } from '../utils.js';
import { AgentHostToolService } from './agent-host-tools.js';
import {
    AgentLlmClient,
    type AgentCompletionRequester,
    type AgentLlmToolDefinition,
} from './agent-llm-client.js';
import { AgentStoreService } from './agent-store-service.js';
import type { ModuleHostService } from './module-host-service.js';
import { WorkspaceHistoryService } from './workspace-history-service.js';

const DEFAULT_MAX_STEPS = 24;
const HARD_MAX_STEPS = 64;
const MAX_CONTEXT_CHARS = 64 * 1024;
const MAX_TOOL_ARGUMENT_CHARS = 128 * 1024;
const MAX_TOOL_RESULT_CHARS = 256 * 1024;
const DEFAULT_BROWSER_TOOL_TIMEOUT_MS = 2 * 60_000;
const DEFAULT_BROWSER_LEASE_MS = 60_000;
const MIN_BROWSER_LEASE_MS = 5_000;
const MAX_BROWSER_LEASE_MS = 5 * 60_000;
const MAX_BROWSER_TOOLS = 64;
const MAX_BROWSER_INSTANCES_PER_CALLER = 16;
const MAX_BROWSER_TOOLS_PER_CALLER = 128;
const MAX_BROWSER_REGISTRATION_BYTES = 256 * 1024;
const MAX_TOOL_CALL_ID_CHARS = 256;
const MAX_ACTIVE_RUNS = 100;
const MAX_ACTIVE_RUNS_PER_USER = 32;
const MAX_ACTIVE_RUNS_PER_CALLER = 16;
const MAX_RUN_STARTS_PER_USER_PER_MINUTE = 30;
const RUN_START_WINDOW_MS = 60_000;
const BROWSER_TOOL_ID_PATTERN = /^[a-zA-Z][a-zA-Z0-9._-]{0,63}$/;
const TERMINAL_RUNS = new Set(['completed', 'failed', 'cancelled', 'interrupted']);

type ApprovalDecision = 'approved' | 'denied' | 'expired' | 'cancelled';
type BrowserToolDecision = 'completed' | 'failed' | 'cancelled' | 'timed_out';

export interface AgentRunCallerContext {
    user: UserContext;
    session: SessionRecord;
}

interface BrowserToolRegistration {
    userHandle: string;
    extensionId: string;
    browserInstanceId: string;
    registrationId: string;
    leaseExpiresAt: string;
    tools: AgentToolDescriptor[];
}

interface BrowserToolWaiter {
    runId: string;
    callId: string;
    descriptor: AgentToolDescriptor;
    resolve: (decision: BrowserToolDecision) => void;
}

export interface AgentServiceOptions {
    requestCompletion?: AgentCompletionRequester;
    moduleHost?: ModuleHostService;
    maxConcurrentRuns?: number;
    approvalTimeoutMs?: number;
    browserToolTimeoutMs?: number;
    shutdownTimeoutMs?: number;
}

export class AgentService {
    private readonly requestCompletion: AgentCompletionRequester;
    private readonly maxConcurrentRuns: number;
    private readonly maxConcurrentRunsPerUser: number;
    private readonly approvalTimeoutMs: number;
    private readonly browserToolTimeoutMs: number;
    private readonly shutdownTimeoutMs: number;
    private readonly moduleHost: ModuleHostService | undefined;
    private readonly queue: string[] = [];
    private readonly tasks = new Map<string, Promise<void>>();
    private readonly controllers = new Map<string, AbortController>();
    private readonly approvalWaiters = new Map<string, (decision: ApprovalDecision) => void>();
    private readonly browserWaiters = new Map<string, BrowserToolWaiter>();
    private readonly browserRegistrations = new Map<string, BrowserToolRegistration>();
    private readonly runContexts = new Map<string, AgentRunCallerContext>();
    private readonly runStartsByUser = new Map<string, number[]>();
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
        this.moduleHost = options.moduleHost;
        this.maxConcurrentRuns = options.maxConcurrentRuns ?? 2;
        this.approvalTimeoutMs = options.approvalTimeoutMs ?? 10 * 60_000;
        this.browserToolTimeoutMs = options.browserToolTimeoutMs ?? DEFAULT_BROWSER_TOOL_TIMEOUT_MS;
        this.shutdownTimeoutMs = options.shutdownTimeoutMs ?? 5_000;
        if (!Number.isSafeInteger(this.maxConcurrentRuns) || this.maxConcurrentRuns < 1 || this.maxConcurrentRuns > 16) {
            throw new Error('maxConcurrentRuns must be an integer between 1 and 16');
        }
        this.maxConcurrentRunsPerUser = Math.max(1, this.maxConcurrentRuns - 1);
        if (!Number.isSafeInteger(this.approvalTimeoutMs) || this.approvalTimeoutMs < 1 || this.approvalTimeoutMs > 24 * 60 * 60_000) {
            throw new Error('approvalTimeoutMs must be an integer between 1 ms and 24 hours');
        }
        if (!Number.isSafeInteger(this.browserToolTimeoutMs) || this.browserToolTimeoutMs < 1_000 || this.browserToolTimeoutMs > 10 * 60_000) {
            throw new Error('browserToolTimeoutMs must be an integer between 1000 and 600000 ms');
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
            this.runContexts.delete(runId);
        }
        for (const [runId, controller] of this.controllers) {
            this.interruptRun(runId, 'Agent host stopped while the run was active');
            controller.abort(new Error('Agent host stopped'));
        }
        for (const resolve of this.approvalWaiters.values()) {
            resolve('cancelled');
        }
        for (const waiter of this.browserWaiters.values()) {
            waiter.resolve('cancelled');
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

    listTools(callerExtensionId = 'authority', callerUserHandle = 'authority'): AgentToolDescriptor[] {
        const tools = [
            ...this.hostTools.list(),
            ...moduleToolDescriptors(this.moduleHost),
            ...this.browserTools(callerUserHandle, callerExtensionId),
        ];
        const ids = new Set<string>();
        for (const tool of tools) {
            if (ids.has(tool.id)) {
                throw new Error(`Agent tool id collision: ${tool.id}`);
            }
            ids.add(tool.id);
        }
        return structuredClone(tools);
    }

    listRuns(callerExtensionId?: string, callerUserHandle?: string): AgentRunRecord[] {
        const runs = this.store.listRuns();
        if (callerExtensionId === undefined && callerUserHandle === undefined) {
            return runs;
        }
        if (!callerExtensionId || !callerUserHandle) {
            throw new Error('Agent run owner requires both user and extension identity');
        }
        return runs.filter(run => run.callerExtensionId === callerExtensionId && run.callerUserHandle === callerUserHandle);
    }

    getRun(runId: string): AgentRunDetail {
        return this.store.getRun(runId);
    }

    createRun(
        request: AgentRunCreateRequest,
        callerExtensionId = 'authority',
        callerContext?: AgentRunCallerContext,
    ): AgentRunRecord {
        if (!this.started || this.stopping) {
            throw new Error('Agent service is not running');
        }
        const goal = requiredText(request.goal, 'Agent goal', 20_000);
        const caller = requiredText(callerExtensionId, 'Agent caller extension id', 128);
        if (callerContext && callerContext.session.extension.id !== caller) {
            throw new Error('Agent caller context does not match the caller extension');
        }
        const callerUserHandle = requiredText(callerContext?.user.handle ?? 'authority', 'Agent caller user handle', 200);
        const activeRuns = this.store.listRuns().filter(run => !TERMINAL_RUNS.has(run.status));
        assertRunCapacity(activeRuns, callerUserHandle, caller);
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
        if (callerContext) {
            this.history.assertWorkspaceAccess(workspace.id, callerUserHandle, callerContext.user.isAdmin);
        }
        const profile = selectOne(
            request.profileId,
            this.store.listProfiles(),
            item => item.id,
            'LLM profile',
        );
        const availableTools = this.listTools(caller, callerUserHandle);
        const allowedTools = normalizeAllowedTools(request.allowedTools, availableTools);
        const timestamp = this.store.nowIso();
        const id = crypto.randomUUID();
        const run: AgentRunRecord = {
            id,
            callerUserHandle,
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
                { role: 'system', content: systemPrompt(workspace.id, mode) },
                { role: 'user', content: userPrompt(goal, instructions, contextText) },
            ],
            events: [{ sequence: 1, runId: id, type: 'run.created', timestamp, payload: { mode, allowedTools } }],
            invocations: [],
            approvals: [],
            ...(request.context === undefined ? {} : { context: structuredClone(request.context) }),
            ...(instructions ? { instructions } : {}),
        };
        this.recordRunStart(callerUserHandle);
        this.store.createRun(detail);
        if (callerContext) {
            this.runContexts.set(id, callerContext);
        }
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
            this.runContexts.delete(runId);
        }
        this.controllers.get(runId)?.abort(new Error('Agent run cancelled'));
        for (const [key, resolve] of this.approvalWaiters) {
            if (key.startsWith(`${runId}:`)) {
                resolve('cancelled');
            }
        }
        for (const [key, waiter] of this.browserWaiters) {
            if (key.startsWith(`${runId}:`)) {
                waiter.resolve('cancelled');
            }
        }
        return detail.run;
    }

    registerBrowserTools(
        userHandle: string,
        extensionId: string,
        request: AgentBrowserToolRegistrationRequest,
    ): AgentBrowserToolRegistrationResponse {
        const user = requiredText(userHandle, 'Browser tool user handle', 200);
        const owner = requiredText(extensionId, 'Browser tool extension id', 128);
        const browserInstanceId = requiredText(request.browserInstanceId, 'Browser instance id', 128);
        const leaseDurationMs = request.leaseDurationMs ?? DEFAULT_BROWSER_LEASE_MS;
        if (!Number.isSafeInteger(leaseDurationMs) || leaseDurationMs < MIN_BROWSER_LEASE_MS || leaseDurationMs > MAX_BROWSER_LEASE_MS) {
            throw new Error(`Browser tool leaseDurationMs must be between ${MIN_BROWSER_LEASE_MS} and ${MAX_BROWSER_LEASE_MS}`);
        }
        if (!Array.isArray(request.tools) || request.tools.length === 0 || request.tools.length > MAX_BROWSER_TOOLS) {
            throw new Error(`Browser tool registration must contain between 1 and ${MAX_BROWSER_TOOLS} tools`);
        }
        let serializedTools: string;
        try {
            serializedTools = JSON.stringify(request.tools);
        } catch {
            throw new Error('Browser tool registration must be JSON serializable');
        }
        if (Buffer.byteLength(serializedTools, 'utf8') > MAX_BROWSER_REGISTRATION_BYTES) {
            throw new Error(`Browser tool registration exceeds ${MAX_BROWSER_REGISTRATION_BYTES} bytes`);
        }
        this.pruneBrowserRegistrations();
        const registrationKey = browserRegistrationKey(user, owner, browserInstanceId);
        const callerRegistrations = [...this.browserRegistrations.entries()]
            .filter(([, registration]) => registration.userHandle === user && registration.extensionId === owner);
        if (!this.browserRegistrations.has(registrationKey) && callerRegistrations.length >= MAX_BROWSER_INSTANCES_PER_CALLER) {
            throw new Error(`Browser tool registration limit reached for ${owner}`);
        }
        const existingTools = callerRegistrations
            .filter(([key]) => key !== registrationKey)
            .reduce((total, [, registration]) => total + registration.tools.length, 0);
        if (existingTools + request.tools.length > MAX_BROWSER_TOOLS_PER_CALLER) {
            throw new Error(`Browser tool limit reached for ${owner}`);
        }
        const localIds = new Set<string>();
        const normalizedTools = request.tools.map(input => {
            const normalized = normalizeBrowserTool(input);
            const localId = normalized.id;
            if (localIds.has(localId)) {
                throw new Error(`Duplicate browser tool id: ${localId}`);
            }
            localIds.add(localId);
            return normalized;
        });
        const registrationId = hashValue(JSON.stringify(normalizedTools));
        const prefix = `browser_${shortHash(`${user}\0${owner}\0${browserInstanceId}\0${registrationId}`)}_`;
        const tools = normalizedTools.map(normalized => {
            const localId = normalized.id;
            return {
                ...normalized,
                id: `${prefix}${localId}`,
                execution: 'browser' as const,
                source: {
                    kind: 'browser' as const,
                    userHandle: user,
                    extensionId: owner,
                    browserInstanceId,
                    registrationId,
                },
            };
        });
        const leaseExpiresAt = new Date(Date.now() + leaseDurationMs).toISOString();
        this.browserRegistrations.set(registrationKey, {
            userHandle: user,
            extensionId: owner,
            browserInstanceId,
            registrationId,
            leaseExpiresAt,
            tools,
        });
        return { browserInstanceId, registrationId, leaseExpiresAt, tools: structuredClone(tools) };
    }

    claimBrowserTool(
        userHandle: string,
        extensionId: string,
        request: AgentBrowserToolClaimRequest,
    ): AgentBrowserToolClaimResponse {
        const user = requiredText(userHandle, 'Browser tool user handle', 200);
        const owner = requiredText(extensionId, 'Browser tool extension id', 128);
        const browserInstanceId = requiredText(request.browserInstanceId, 'Browser instance id', 128);
        const claimId = requiredText(request.claimId, 'Browser tool claim id', 128);
        const registration = this.activeBrowserRegistration(user, owner, browserInstanceId);
        const requestedCallId = request.callId === undefined
            ? undefined
            : requiredText(request.callId, 'Browser tool call id', MAX_TOOL_CALL_ID_CHARS);
        const toolIds = new Set(registration.tools.map(tool => tool.id));
        for (const waiter of this.browserWaiters.values()) {
            if (requestedCallId && waiter.callId !== requestedCallId) continue;
            if (waiter.descriptor.source.kind !== 'browser'
                || waiter.descriptor.source.userHandle !== user
                || waiter.descriptor.source.extensionId !== owner
                || waiter.descriptor.source.browserInstanceId !== browserInstanceId
                || !toolIds.has(waiter.descriptor.id)) continue;
            const detail = this.store.getRun(waiter.runId);
            const invocation = findInvocation(detail, waiter.callId);
            if (invocation.status === 'claimed'
                && invocation.browserInstanceId === browserInstanceId
                && invocation.claimId === claimId) {
                return { invocation: structuredClone(invocation) };
            }
            if (invocation.status !== 'pending') continue;
            const timestamp = this.store.nowIso();
            let claimed!: AgentToolInvocation;
            this.store.updateRun(waiter.runId, run => {
                const stored = findInvocation(run, waiter.callId);
                if (stored.status !== 'pending') {
                    throw new Error(`Browser tool invocation is no longer pending: ${waiter.callId}`);
                }
                stored.status = 'claimed';
                stored.browserInstanceId = browserInstanceId;
                stored.claimId = claimId;
                stored.updatedAt = timestamp;
                appendEvent(run, 'tool.started', timestamp, { callId: waiter.callId, toolId: stored.toolId, browserInstanceId });
                claimed = structuredClone(stored);
            });
            return { invocation: claimed };
        }
        if (requestedCallId) {
            throw new Error(`Browser tool invocation is unavailable: ${requestedCallId}`);
        }
        return { invocation: null };
    }

    submitBrowserToolResult(userHandle: string, extensionId: string, request: AgentToolResultRequest): AgentToolInvocation {
        const user = requiredText(userHandle, 'Browser tool user handle', 200);
        const owner = requiredText(extensionId, 'Browser tool extension id', 128);
        const runId = requiredText(request.runId, 'Agent run id', 128);
        const callId = requiredText(request.callId, 'Browser tool call id', MAX_TOOL_CALL_ID_CHARS);
        const claimId = requiredText(request.claimId, 'Browser tool claim id', 128);
        const browserInstanceId = requiredText(request.browserInstanceId, 'Browser instance id', 128);
        if (request.status !== 'completed' && request.status !== 'failed' && request.status !== 'cancelled') {
            throw new Error('Browser tool result status must be completed, failed, or cancelled');
        }
        const waiter = this.browserWaiters.get(browserWaiterKey(runId, callId));
        if (!waiter || waiter.descriptor.source.kind !== 'browser'
            || waiter.descriptor.source.userHandle !== user
            || waiter.descriptor.source.extensionId !== owner
            || waiter.descriptor.source.browserInstanceId !== browserInstanceId) {
            throw new Error(`Browser tool invocation is unavailable: ${callId}`);
        }
        const timestamp = this.store.nowIso();
        const bounded = request.status === 'completed' ? boundedToolValue(request.result) : undefined;
        const message = request.status === 'completed'
            ? undefined
            : requiredText(request.error ?? `Browser tool ${request.status}`, 'Browser tool error', 10_000);
        let result!: AgentToolInvocation;
        this.store.updateRun(runId, detail => {
            const invocation = findInvocation(detail, callId);
            if (invocation.status !== 'claimed'
                || invocation.browserInstanceId !== browserInstanceId
                || invocation.claimId !== claimId) {
                throw new Error(`Browser tool invocation is not claimed by this browser: ${callId}`);
            }
            invocation.status = request.status === 'completed' ? 'completed' : request.status;
            invocation.updatedAt = timestamp;
            if (request.status === 'completed') {
                invocation.result = structuredClone(bounded);
                detail.messages.push({ role: 'tool', toolCallId: callId, content: JSON.stringify({ ok: true, result: bounded }) });
                appendEvent(detail, 'tool.completed', timestamp, { callId, toolId: invocation.toolId, result: bounded });
            } else {
                invocation.error = message!;
                detail.messages.push({ role: 'tool', toolCallId: callId, content: JSON.stringify({ ok: false, error: message! }) });
                appendEvent(detail, 'tool.failed', timestamp, { callId, toolId: invocation.toolId, error: message! });
            }
            detail.run.status = 'running';
            result = structuredClone(invocation);
        });
        waiter.resolve(request.status);
        return result;
    }

    resolveApproval(
        runId: string,
        approvalId: string,
        request: AgentApprovalResolveRequest,
        resolvedByUserHandle?: string,
    ): AgentApprovalRecord {
        if (request.decision !== 'approve' && request.decision !== 'deny') {
            throw new Error('Approval decision must be approve or deny');
        }
        const waiter = this.approvalWaiters.get(`${runId}:${approvalId}`);
        if (!waiter) {
            throw new Error(`Agent approval waiter is unavailable: ${approvalId}`);
        }
        const timestamp = this.store.nowIso();
        const resolver = resolvedByUserHandle === undefined
            ? undefined
            : requiredText(resolvedByUserHandle, 'Approval resolver user handle', 200);
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
            if (resolver) {
                approval.resolvedByUserHandle = resolver;
            }
            detail.run.status = 'running';
            delete detail.run.pendingApprovalId;
            appendEvent(detail, 'tool.approval_resolved', timestamp, {
                approvalId,
                callId: approval.callId,
                decision: request.decision,
                ...(resolver ? { resolvedByUserHandle: resolver } : {}),
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
            const queueIndex = this.nextRunnableQueueIndex();
            if (queueIndex === -1) {
                return;
            }
            const runId = this.queue.splice(queueIndex, 1)[0]!;
            const task = this.executeRun(runId)
                .catch(error => console.warn(`[authority] Agent run ${runId} failed: ${error instanceof Error ? error.message : String(error)}`))
                .finally(() => {
                    this.tasks.delete(runId);
                    this.controllers.delete(runId);
                    this.runContexts.delete(runId);
                    this.drainQueue();
                });
            this.tasks.set(runId, task);
        }
    }

    private nextRunnableQueueIndex(): number {
        const activeByUser = new Map<string, number>();
        for (const runId of this.tasks.keys()) {
            const userHandle = this.store.getRun(runId).run.callerUserHandle;
            activeByUser.set(userHandle, (activeByUser.get(userHandle) ?? 0) + 1);
        }
        return this.queue.findIndex(runId => {
            const userHandle = this.store.getRun(runId).run.callerUserHandle;
            return (activeByUser.get(userHandle) ?? 0) < this.maxConcurrentRunsPerUser;
        });
    }

    private recordRunStart(userHandle: string): void {
        const now = Date.now();
        const recent = (this.runStartsByUser.get(userHandle) ?? []).filter(
            timestamp => now - timestamp < RUN_START_WINDOW_MS,
        );
        if (recent.length >= MAX_RUN_STARTS_PER_USER_PER_MINUTE) {
            throw new AuthorityServiceError('Agent run rate limit reached', 429, 'limit_exceeded', 'limit', {
                userHandle,
                startsInWindow: recent.length,
                windowMs: RUN_START_WINDOW_MS,
            });
        }
        recent.push(now);
        this.runStartsByUser.set(userHandle, recent);
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
                        contentChars: completion.message.content?.length ?? 0,
                        toolCallCount: completion.message.toolCalls?.length ?? 0,
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
        if (current.run.mode === 'plan' && !isPlanSafeTool(descriptor)) {
            this.appendToolProtocolError(runId, callId, `Tool is unavailable in plan mode: ${descriptor.id}`);
            return;
        }
        const timestamp = this.store.nowIso();
        const invocation: AgentToolInvocation = {
            callId,
            runId,
            toolId: descriptor.id,
            execution: descriptor.execution,
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
            || (current.run.mode === 'ask' && descriptor.approvalPolicy === 'on-mutation');
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
        if (descriptor.execution === 'browser') {
            try {
                await this.waitForBrowserTool(runId, invocation, descriptor);
                this.assertRunActive(runId, signal);
            } catch (error) {
                if (signal.aborted || TERMINAL_RUNS.has(this.store.getRun(runId).run.status)) {
                    throw error;
                }
                const status = findInvocation(this.store.getRun(runId), callId).status;
                if (status === 'pending' || status === 'claimed') {
                    this.failTool(runId, callId, errorMessage(error), 'failed');
                }
            }
            return;
        }

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
                if (descriptor.execution !== 'host') {
                    throw new Error(`Only host tools may declare workspace mutations: ${descriptor.id}`);
                }
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
            } else if (descriptor.execution === 'host') {
                result = await this.hostTools.execute(descriptor.id, input, { workspace, runId, signal });
            } else if (descriptor.execution === 'module' && descriptor.source.kind === 'module') {
                const context = this.runContexts.get(runId);
                if (!context || !this.moduleHost) {
                    throw new Error(`Agent module execution context is unavailable: ${descriptor.id}`);
                }
                result = await this.moduleHost.execute(
                    context.user,
                    context.session,
                    descriptor.source.moduleId,
                    descriptor.source.transactionName,
                    input as ModuleTransactionRequest,
                    signal,
                );
            } else {
                throw new Error(`Unsupported Agent tool execution: ${descriptor.id}`);
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
            if (descriptor.execution === 'module' && isModuleTimeout(error)) {
                this.interruptUnknownToolOutcome(
                    runId,
                    callId,
                    'Module transaction timed out after execution started; its side effects are unknown',
                );
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
            summary: this.approvalSummary(descriptor, input),
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

    private async waitForBrowserTool(
        runId: string,
        invocation: AgentToolInvocation,
        descriptor: AgentToolDescriptor,
    ): Promise<void> {
        if (descriptor.source.kind !== 'browser') {
            throw new Error(`Browser tool source is invalid: ${descriptor.id}`);
        }
        const browserInstanceId = descriptor.source.browserInstanceId;
        const registration = this.activeBrowserRegistration(
            descriptor.source.userHandle,
            descriptor.source.extensionId,
            browserInstanceId,
        );
        if (registration.registrationId !== descriptor.source.registrationId
            || !registration.tools.some(tool => tool.id === descriptor.id)) {
            throw new Error(`Browser tool registration changed before execution: ${descriptor.id}`);
        }
        const key = browserWaiterKey(runId, invocation.callId);
        let resolveDecision!: (decision: BrowserToolDecision) => void;
        const decision = new Promise<BrowserToolDecision>(resolve => { resolveDecision = resolve; });
        const timestamp = this.store.nowIso();
        const deadlineAt = new Date(Date.parse(timestamp) + this.browserToolTimeoutMs).toISOString();
        this.store.updateRun(runId, detail => {
            const stored = findInvocation(detail, invocation.callId);
            stored.status = 'pending';
            stored.browserInstanceId = browserInstanceId;
            stored.deadlineAt = deadlineAt;
            stored.updatedAt = timestamp;
            detail.run.status = 'waiting_browser_tool';
            appendEvent(detail, 'tool.waiting_browser', timestamp, {
                callId: invocation.callId,
                toolId: descriptor.id,
                browserInstanceId: stored.browserInstanceId,
                deadlineAt,
            });
        });
        this.browserWaiters.set(key, { runId, callId: invocation.callId, descriptor, resolve: resolveDecision });
        const timer = setTimeout(() => {
            const expiredAt = this.store.nowIso();
            try {
                this.store.updateRun(runId, detail => {
                    const stored = findInvocation(detail, invocation.callId);
                    if (stored.status !== 'pending' && stored.status !== 'claimed') {
                        return;
                    }
                    const claimed = stored.status === 'claimed';
                    const message = claimed
                        ? 'Browser tool timed out after it was claimed; its side effects are unknown'
                        : 'Browser tool timed out before it was claimed';
                    if (claimed) {
                        stored.status = 'outcome_unknown';
                        stored.updatedAt = expiredAt;
                        stored.error = message;
                        detail.run.status = 'interrupted';
                        detail.run.updatedAt = expiredAt;
                        detail.run.finishedAt = expiredAt;
                        detail.run.error = message;
                        detail.messages.push({ role: 'tool', toolCallId: invocation.callId, content: JSON.stringify({ ok: false, error: message }) });
                        appendEvent(detail, 'tool.failed', expiredAt, { callId: invocation.callId, toolId: descriptor.id, error: message, outcomeUnknown: true });
                        appendEvent(detail, 'run.interrupted', expiredAt, { reason: message, callId: invocation.callId });
                    } else {
                        stored.status = 'timed_out';
                        stored.updatedAt = expiredAt;
                        stored.error = message;
                        detail.run.status = 'running';
                        detail.messages.push({ role: 'tool', toolCallId: invocation.callId, content: JSON.stringify({ ok: false, error: message }) });
                        appendEvent(detail, 'tool.failed', expiredAt, { callId: invocation.callId, toolId: descriptor.id, error: message });
                    }
                });
                resolveDecision('timed_out');
            } catch (error) {
                console.warn(`[authority] Unable to expire browser tool ${invocation.callId}: ${errorMessage(error)}`);
                resolveDecision('cancelled');
            }
        }, this.browserToolTimeoutMs);
        timer.unref();
        try {
            const outcome = await decision;
            if (outcome === 'cancelled' && TERMINAL_RUNS.has(this.store.getRun(runId).run.status)) {
                throw new Error('Agent run ended before the browser tool completed');
            }
        } finally {
            clearTimeout(timer);
            this.browserWaiters.delete(key);
        }
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

    private interruptUnknownToolOutcome(runId: string, callId: string, message: string): void {
        const timestamp = this.store.nowIso();
        this.store.updateRun(runId, detail => {
            const invocation = findInvocation(detail, callId);
            invocation.status = 'outcome_unknown';
            invocation.updatedAt = timestamp;
            invocation.error = message;
            detail.run.status = 'interrupted';
            detail.run.updatedAt = timestamp;
            detail.run.finishedAt = timestamp;
            detail.run.error = message;
            detail.messages.push({ role: 'tool', toolCallId: callId, content: JSON.stringify({ ok: false, error: message }) });
            appendEvent(detail, 'tool.failed', timestamp, { callId, toolId: invocation.toolId, error: message, outcomeUnknown: true });
            appendEvent(detail, 'run.interrupted', timestamp, { reason: message, callId });
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
        return this.listTools(run.callerExtensionId, run.callerUserHandle).filter(tool => allowed.has(tool.id) && (
            run.mode !== 'plan' || isPlanSafeTool(tool)
        ));
    }

    private approvalSummary(descriptor: AgentToolDescriptor, input: unknown): string {
        if (descriptor.execution === 'host') {
            return this.hostTools.approvalSummary(descriptor.id, input);
        }
        const preview = JSON.stringify(input);
        return `${descriptor.title}; effects are outside workspace rollback: ${preview.slice(0, 500)}`;
    }

    private browserTools(userHandle: string, extensionId: string): AgentToolDescriptor[] {
        this.pruneBrowserRegistrations();
        return [...this.browserRegistrations.values()]
            .filter(registration => registration.userHandle === userHandle && registration.extensionId === extensionId)
            .flatMap(registration => registration.tools);
    }

    private activeBrowserRegistration(userHandle: string, extensionId: string, browserInstanceId: string): BrowserToolRegistration {
        this.pruneBrowserRegistrations();
        const registration = this.browserRegistrations.get(browserRegistrationKey(userHandle, extensionId, browserInstanceId));
        if (!registration) {
            throw new Error(`Browser tool registration is unavailable: ${browserInstanceId}`);
        }
        return registration;
    }

    private pruneBrowserRegistrations(): void {
        const now = Date.now();
        for (const [key, registration] of this.browserRegistrations) {
            if (Date.parse(registration.leaseExpiresAt) <= now) {
                this.browserRegistrations.delete(key);
            }
        }
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

function moduleToolDescriptors(moduleHost?: ModuleHostService): AgentToolDescriptor[] {
    if (!moduleHost) {
        return [];
    }
    return moduleHost.listManifests().modules.flatMap(module => Object.entries(module.transactions).map(([name, transaction]) => ({
        id: `module:${module.id}:${name}`,
        title: `${module.displayName}: ${transaction.title}`,
        description: `${transaction.description || transaction.title} This Authority module transaction may have effects outside workspace rollback.`,
        inputSchema: moduleTransactionSchema(transaction),
        ...(transaction.outputSchema ? { outputSchema: structuredClone(transaction.outputSchema) } : {}),
        execution: 'module' as const,
        riskLevel: transaction.riskLevel,
        approvalPolicy: transaction.riskLevel === 'high'
            ? 'always' as const
            : transaction.riskLevel === 'medium' ? 'on-mutation' as const : 'never' as const,
        mutatesWorkspace: false,
        source: { kind: 'module' as const, moduleId: module.id, transactionName: name },
    })));
}

function isPlanSafeTool(tool: AgentToolDescriptor): boolean {
    return tool.execution === 'host' && !tool.mutatesWorkspace && tool.approvalPolicy === 'never';
}

function moduleTransactionSchema(transaction: ModuleTransactionManifest): Record<string, unknown> {
    return {
        type: 'object',
        properties: {
            input: transaction.inputSchema ?? { type: 'object' },
            idempotencyKey: { type: 'string' },
            options: {
                type: 'object',
                properties: { timeoutMs: { type: 'integer', minimum: 1, maximum: 600_000 } },
                additionalProperties: false,
            },
        },
        ...(transaction.idempotency === 'required' ? { required: ['idempotencyKey'] } : {}),
        additionalProperties: false,
    };
}

function normalizeBrowserTool(
    input: AgentBrowserToolRegistrationRequest['tools'][number],
): Omit<AgentToolDescriptor, 'execution' | 'source'> {
    if (!input || typeof input !== 'object') {
        throw new Error('Browser tool descriptor must be an object');
    }
    const id = requiredText(input.id, 'Browser tool id', 64);
    if (!BROWSER_TOOL_ID_PATTERN.test(id)) {
        throw new Error(`Browser tool id is invalid: ${id}`);
    }
    const title = requiredText(input.title, 'Browser tool title', 200);
    const description = requiredText(input.description, 'Browser tool description', 2_000);
    if (!isSchema(input.inputSchema) || (input.outputSchema !== undefined && !isSchema(input.outputSchema))) {
        throw new Error(`Browser tool schema is invalid: ${id}`);
    }
    if (input.riskLevel !== 'low' && input.riskLevel !== 'medium' && input.riskLevel !== 'high') {
        throw new Error(`Browser tool risk level is invalid: ${id}`);
    }
    if (input.approvalPolicy !== 'never' && input.approvalPolicy !== 'on-mutation' && input.approvalPolicy !== 'always') {
        throw new Error(`Browser tool approval policy is invalid: ${id}`);
    }
    if (input.mutatesWorkspace !== false) {
        throw new Error(`Browser tools cannot declare workspace mutations: ${id}`);
    }
    const riskLevel = input.riskLevel === 'high' ? 'high' as const : 'medium' as const;
    const approvalPolicy = riskLevel === 'high' || input.approvalPolicy === 'always'
        ? 'always' as const
        : 'on-mutation' as const;
    return {
        id,
        title,
        description,
        inputSchema: structuredClone(input.inputSchema),
        ...(input.outputSchema ? { outputSchema: structuredClone(input.outputSchema) } : {}),
        riskLevel,
        approvalPolicy,
        mutatesWorkspace: false,
    };
}

function isSchema(value: unknown): value is Record<string, unknown> {
    return Boolean(value && typeof value === 'object' && !Array.isArray(value));
}

function browserRegistrationKey(userHandle: string, extensionId: string, browserInstanceId: string): string {
    return `${userHandle}\0${extensionId}\0${browserInstanceId}`;
}

function browserWaiterKey(runId: string, callId: string): string {
    return `${runId}:${callId}`;
}

function shortHash(value: string): string {
    return hashValue(value).slice(0, 24);
}

function hashValue(value: string): string {
    return crypto.createHash('sha256').update(value).digest('hex');
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
        if (invocation.status === 'pending' || invocation.status === 'waiting_approval') {
            invocation.status = 'cancelled';
            invocation.updatedAt = timestamp;
            invocation.error = message;
        } else if (invocation.status === 'claimed') {
            invocation.status = 'outcome_unknown';
            invocation.updatedAt = timestamp;
            invocation.error = `${message}; the claimed tool may still have produced side effects`;
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

function assertRunCapacity(activeRuns: AgentRunRecord[], userHandle: string, extensionId: string): void {
    const userRuns = activeRuns.filter(run => run.callerUserHandle === userHandle);
    const callerRuns = userRuns.filter(run => run.callerExtensionId === extensionId);
    if (activeRuns.length >= MAX_ACTIVE_RUNS
        || userRuns.length >= MAX_ACTIVE_RUNS_PER_USER
        || callerRuns.length >= MAX_ACTIVE_RUNS_PER_CALLER) {
        throw new AuthorityServiceError('Agent run queue limit reached', 429, 'limit_exceeded', 'limit', {
            activeRuns: activeRuns.length,
            userActiveRuns: userRuns.length,
            callerActiveRuns: callerRuns.length,
        });
    }
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

function systemPrompt(workspaceId: string, mode: AgentExecutionMode): string {
    return [
        'You are Authority Agent, an IDE-grade operator for a registered SillyTavern workspace.',
        `Registered workspace: ${workspaceId}. All tool paths are relative to its private root.`,
        `Execution mode: ${mode}.`,
        'Inspect relevant files before changing them. Use registered tools for every action and rely on their returned results.',
        'Keep writes narrow. Shell commands checkpoint the workspace except .git and node_modules, and always require approval because those paths and effects outside the workspace cannot be rolled back.',
        mode === 'plan'
            ? 'Plan mode is read-only: only Authority host inspection tools are available; browser and module tools are excluded because their external side effects cannot be verified or rolled back.'
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

function isModuleTimeout(error: unknown): boolean {
    if (!(error instanceof AuthorityServiceError) || !error.details || typeof error.details !== 'object') {
        return false;
    }
    return (error.details as Record<string, unknown>).code === 'transaction_timeout';
}

function abortError(signal: AbortSignal): Error {
    return signal.reason instanceof Error ? signal.reason : Object.assign(new Error('Agent run cancelled'), { name: 'AbortError' });
}

function delay(milliseconds: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, milliseconds));
}

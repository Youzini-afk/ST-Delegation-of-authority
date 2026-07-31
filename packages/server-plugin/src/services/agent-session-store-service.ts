import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { AgentExecutionMode, AgentToolExecution } from '@stdo/shared-types';
import { atomicWriteFile, ensureDir, fsyncDirectory } from '../utils.js';
import {
    applyAgentSessionRecord,
    createAgentSessionProjection,
    snapshotAgentSession,
    type AgentSessionCreatedEntry,
    type AgentSessionJournalEntry,
    type AgentSessionJournalRecord,
    type AgentSessionProjection,
    type AgentSessionSnapshot,
} from './agent-session-model.js';

const JOURNAL_FORMAT = 'authority-agent-session-journal/v1' as const;
const LOCK_FORMAT = 'authority-agent-session-writer-lock/v1' as const;
const SAFE_FILE_ID = /^[a-zA-Z0-9._-]+$/;
const HASH_PATTERN = /^[a-f0-9]{64}$/;
const DEFAULT_TARGET_SEGMENT_BYTES = 32 * 1024 * 1024;
const DEFAULT_STALE_LOCK_MS = 5 * 60_000;

export interface AgentSessionCreateInput {
    id?: string;
    callerUserHandle: string;
    callerExtensionId: string;
    workspaceId: string;
    title: string;
    profileId: string;
    mode: AgentExecutionMode;
    allowedTools: string[];
}

export interface AgentSessionStoreOptions {
    now?: () => string;
    hostname?: string;
    pid?: number;
    isProcessAlive?: (pid: number) => boolean;
    targetSegmentBytes?: number;
    staleLockMs?: number;
}

export interface AgentSessionJournalTail {
    tornTailBytes: number;
    missingFinalNewline: boolean;
}

export interface AgentSessionReadResult {
    snapshot: AgentSessionSnapshot;
    records: AgentSessionJournalRecord[];
    tail: AgentSessionJournalTail;
}

export interface AgentSessionListProblem {
    sessionId: string;
    error: string;
}

export interface AgentSessionListResult {
    sessions: AgentSessionSnapshot[];
    problems: AgentSessionListProblem[];
}

interface WriterLockRecord {
    format: typeof LOCK_FORMAT;
    token: string;
    pid: number;
    hostname: string;
    createdAt: string;
}

interface LoadedJournal {
    projection: AgentSessionProjection;
    records: AgentSessionJournalRecord[];
    recordsByEntryId: Map<string, AgentSessionJournalRecord>;
    tail: AgentSessionJournalTail;
    validBytes: number;
    activeJournalPath: string;
    activeSegmentIndex: number;
    activeSegmentBytes: number;
}

export class AgentSessionStoreService {
    private readonly now: () => string;
    private readonly hostname: string;
    private readonly pid: number;
    private readonly isProcessAlive: (pid: number) => boolean;
    private readonly targetSegmentBytes: number;
    private readonly staleLockMs: number;

    constructor(
        public readonly stateDir: string,
        options: AgentSessionStoreOptions = {},
    ) {
        this.stateDir = path.resolve(stateDir);
        this.now = options.now ?? (() => new Date().toISOString());
        this.hostname = options.hostname ?? os.hostname();
        this.pid = options.pid ?? process.pid;
        this.isProcessAlive = options.isProcessAlive ?? processIsAlive;
        this.targetSegmentBytes = positiveInteger(options.targetSegmentBytes ?? DEFAULT_TARGET_SEGMENT_BYTES, 'Agent session journal segment target');
        this.staleLockMs = nonNegativeInteger(options.staleLockMs ?? DEFAULT_STALE_LOCK_MS, 'Agent session stale lock duration');
    }

    start(): AgentSessionListResult {
        protectDirectory(this.stateDir);
        protectDirectory(this.sessionsDir());
        return this.listSessions();
    }

    createSession(input: AgentSessionCreateInput): AgentSessionSnapshot {
        protectDirectory(this.sessionsDir());
        const sessionId = input.id ?? crypto.randomUUID();
        assertFileId(sessionId, 'Agent session id');
        const timestamp = this.now();
        const entry: AgentSessionCreatedEntry = {
            id: sessionId,
            type: 'session.created',
            timestamp,
            callerUserHandle: requiredText(input.callerUserHandle, 'Agent session caller user', 200),
            callerExtensionId: requiredText(input.callerExtensionId, 'Agent session caller extension', 200),
            workspaceId: requiredText(input.workspaceId, 'Agent session workspace', 200),
            title: requiredText(input.title, 'Agent session title', 500),
            profileId: requiredText(input.profileId, 'Agent session profile', 200),
            mode: executionMode(input.mode),
            allowedTools: textArray(input.allowedTools, 'Agent session allowed tools'),
        };
        validateJournalEntry(entry);
        const record = createRecord(sessionId, 1, null, entry);
        const serialized = `${JSON.stringify(record)}\n`;

        const sessionDir = this.sessionDir(sessionId);
        try {
            fs.mkdirSync(sessionDir);
        } catch (error) {
            if (isNodeError(error, 'EEXIST')) throw new Error(`Agent session already exists: ${sessionId}`);
            throw error;
        }
        protectDirectory(sessionDir);
        try {
            atomicWriteFile(this.journalPath(sessionId), serialized);
            protectFile(this.journalPath(sessionId));
            fsyncDirectory(this.sessionsDir());
            return this.readSession(sessionId).snapshot;
        } catch (error) {
            fs.rmSync(sessionDir, { recursive: true, force: true });
            throw error;
        }
    }

    readSession(sessionId: string): AgentSessionReadResult {
        const loaded = this.loadJournal(sessionId);
        return {
            snapshot: snapshotAgentSession(loaded.projection),
            records: structuredClone(loaded.records),
            tail: { ...loaded.tail },
        };
    }

    listSessions(): AgentSessionListResult {
        protectDirectory(this.sessionsDir());
        const sessions: AgentSessionSnapshot[] = [];
        const problems: AgentSessionListProblem[] = [];
        for (const entry of fs.readdirSync(this.sessionsDir(), { withFileTypes: true })) {
            if (!entry.isDirectory() || !SAFE_FILE_ID.test(entry.name)) continue;
            try {
                sessions.push(this.readSession(entry.name).snapshot);
            } catch (error) {
                problems.push({ sessionId: entry.name, error: errorMessage(error) });
            }
        }
        sessions.sort((left, right) => right.session.updatedAt.localeCompare(left.session.updatedAt)
            || right.session.id.localeCompare(left.session.id));
        problems.sort((left, right) => left.sessionId.localeCompare(right.sessionId));
        return { sessions, problems };
    }

    openWriter(sessionId: string): AgentSessionWriter {
        assertFileId(sessionId, 'Agent session id');
        const lock = this.acquireWriterLock(sessionId);
        try {
            const loaded = this.loadJournal(sessionId);
            if (loaded.tail.tornTailBytes > 0) {
                truncateAndSync(loaded.activeJournalPath, loaded.validBytes);
                loaded.activeSegmentBytes = loaded.validBytes;
                loaded.tail.tornTailBytes = 0;
            }
            if (loaded.tail.missingFinalNewline) {
                appendAndSync(loaded.activeJournalPath, '\n');
                loaded.activeSegmentBytes += 1;
                loaded.tail.missingFinalNewline = false;
            }
            return new AgentSessionWriter(
                sessionId,
                this.sessionDir(sessionId),
                this.writerLockPath(sessionId),
                lock,
                loaded,
                this.targetSegmentBytes,
            );
        } catch (error) {
            releaseWriterLock(this.writerLockPath(sessionId), lock.token);
            throw error;
        }
    }

    private loadJournal(sessionId: string): LoadedJournal {
        assertFileId(sessionId, 'Agent session id');
        const journalPaths = this.journalPaths(sessionId);
        const projection = createAgentSessionProjection();
        const records: AgentSessionJournalRecord[] = [];
        const recordsByEntryId = new Map<string, AgentSessionJournalRecord>();
        let validBytes = 0;
        let tornTailBytes = 0;
        let missingFinalNewline = false;
        let activeSegmentBytes = 0;

        for (let segmentIndex = 0; segmentIndex < journalPaths.length; segmentIndex += 1) {
            const journalPath = journalPaths[segmentIndex]!;
            const finalSegment = segmentIndex === journalPaths.length - 1;
            const buffer = fs.readFileSync(journalPath);
            let cursor = 0;
            validBytes = 0;
            while (cursor < buffer.length) {
                const newline = buffer.indexOf(0x0a, cursor);
                const isTail = newline === -1;
                const end = isTail ? buffer.length : newline;
                const line = buffer.subarray(cursor, end);
                if (line.length === 0) {
                    if (isTail && finalSegment) break;
                    throw new Error(`Agent session journal contains an empty record in ${path.basename(journalPath)} at byte ${cursor}: ${sessionId}`);
                }
                let parsed: unknown;
                try {
                    parsed = JSON.parse(line.toString('utf8')) as unknown;
                } catch (error) {
                    if (!isTail || !finalSegment) throw error;
                    tornTailBytes = buffer.length - cursor;
                    break;
                }
                const record = parseJournalRecord(parsed, sessionId);
                const canonicalEntry = canonicalJson(record.entry);
                applyAgentSessionRecord(projection, record, canonicalEntry);
                records.push(record);
                recordsByEntryId.set(record.entry.id, record);
                validBytes = isTail ? end : end + 1;
                if (isTail) {
                    if (!finalSegment) {
                        throw new Error(`Agent session journal segment is missing its final newline: ${path.basename(journalPath)}`);
                    }
                    missingFinalNewline = true;
                }
                cursor = end + 1;
            }
            if (finalSegment) activeSegmentBytes = buffer.length;
        }
        if (records.length === 0) throw new Error(`Agent session journal has no valid records: ${sessionId}`);
        return {
            projection,
            records,
            recordsByEntryId,
            tail: { tornTailBytes, missingFinalNewline },
            validBytes,
            activeJournalPath: journalPaths.at(-1)!,
            activeSegmentIndex: journalPaths.length - 1,
            activeSegmentBytes,
        };
    }

    private journalPaths(sessionId: string): string[] {
        const sessionDir = this.sessionDir(sessionId);
        const base = this.journalPath(sessionId);
        if (!fs.existsSync(base)) throw new Error(`Agent session journal is missing: ${sessionId}`);
        const segments = fs.readdirSync(sessionDir)
            .flatMap(name => {
                const match = /^journal\.(\d{6})\.jsonl$/.exec(name);
                return match ? [{ index: Number(match[1]), path: path.join(sessionDir, name) }] : [];
            })
            .sort((left, right) => left.index - right.index);
        for (let index = 0; index < segments.length; index += 1) {
            if (segments[index]!.index !== index + 1) {
                throw new Error(`Agent session journal segments are not contiguous: ${sessionId}`);
            }
        }
        return [base, ...segments.map(segment => segment.path)];
    }

    private acquireWriterLock(sessionId: string): WriterLockRecord {
        const lockPath = this.writerLockPath(sessionId);
        const record: WriterLockRecord = {
            format: LOCK_FORMAT,
            token: crypto.randomUUID(),
            pid: this.pid,
            hostname: this.hostname,
            createdAt: this.now(),
        };
        for (let attempt = 0; attempt < 2; attempt += 1) {
            let descriptor: number | null = null;
            try {
                descriptor = fs.openSync(lockPath, 'wx');
                fs.writeFileSync(descriptor, `${JSON.stringify(record)}\n`);
                fs.fsyncSync(descriptor);
                fs.closeSync(descriptor);
                descriptor = null;
                protectFile(lockPath);
                return record;
            } catch (error) {
                if (descriptor !== null) fs.closeSync(descriptor);
                if (!isNodeError(error, 'EEXIST')) throw error;
                if (attempt > 0 || !this.claimStaleLock(lockPath)) {
                    throw new Error(`Agent session already has an active writer: ${sessionId}`);
                }
            }
        }
        throw new Error(`Unable to acquire Agent session writer lock: ${sessionId}`);
    }

    private claimStaleLock(lockPath: string): boolean {
        let stale = false;
        try {
            const value = JSON.parse(fs.readFileSync(lockPath, 'utf8')) as Partial<WriterLockRecord>;
            if (value.format === LOCK_FORMAT && typeof value.hostname === 'string' && value.hostname) {
                if (value.hostname !== this.hostname) return false;
                if (typeof value.pid !== 'number' || !Number.isSafeInteger(value.pid)) return false;
                stale = !this.isProcessAlive(value.pid);
            } else {
                stale = Date.now() - fs.statSync(lockPath).mtimeMs >= this.staleLockMs;
            }
        } catch {
            try {
                stale = Date.now() - fs.statSync(lockPath).mtimeMs >= this.staleLockMs;
            } catch {
                return true;
            }
        }
        if (!stale) return false;
        const claimedPath = `${lockPath}.${crypto.randomUUID()}.stale`;
        try {
            fs.renameSync(lockPath, claimedPath);
            fs.rmSync(claimedPath, { force: true });
            return true;
        } catch (error) {
            if (isNodeError(error, 'ENOENT')) return true;
            return false;
        }
    }

    private sessionsDir(): string {
        return path.join(this.stateDir, 'sessions');
    }

    private sessionDir(sessionId: string): string {
        assertFileId(sessionId, 'Agent session id');
        return path.join(this.sessionsDir(), sessionId);
    }

    private journalPath(sessionId: string): string {
        return path.join(this.sessionDir(sessionId), 'journal.jsonl');
    }

    private writerLockPath(sessionId: string): string {
        return path.join(this.sessionDir(sessionId), 'writer.lock');
    }
}

export class AgentSessionWriter {
    private projection: AgentSessionProjection;
    private readonly records: AgentSessionJournalRecord[];
    private readonly recordsByEntryId: Map<string, AgentSessionJournalRecord>;
    private activeJournalPath: string;
    private activeSegmentIndex: number;
    private activeSegmentBytes: number;
    private closed = false;
    private faulted = false;

    constructor(
        public readonly sessionId: string,
        private readonly sessionDir: string,
        private readonly lockPath: string,
        private readonly lock: WriterLockRecord,
        loaded: LoadedJournal,
        private readonly targetSegmentBytes: number,
    ) {
        this.projection = loaded.projection;
        this.records = loaded.records;
        this.recordsByEntryId = loaded.recordsByEntryId;
        this.activeJournalPath = loaded.activeJournalPath;
        this.activeSegmentIndex = loaded.activeSegmentIndex;
        this.activeSegmentBytes = loaded.activeSegmentBytes;
    }

    append(entry: AgentSessionJournalEntry): AgentSessionJournalRecord {
        this.assertWritable();
        validateJournalEntry(entry);
        const canonicalEntry = canonicalJson(entry);
        const existingBody = this.projection.entryBodies.get(entry.id);
        if (existingBody !== undefined) {
            if (existingBody !== canonicalEntry) throw new Error(`Agent session entry id was reused with different content: ${entry.id}`);
            return structuredClone(this.recordsByEntryId.get(entry.id)!);
        }

        const record = createRecord(
            this.sessionId,
            this.projection.lastSequence + 1,
            this.projection.lastHash || null,
            entry,
        );
        const serialized = `${JSON.stringify(record)}\n`;
        const entryBytes = Buffer.byteLength(serialized, 'utf8');

        const nextProjection = structuredClone(this.projection);
        applyAgentSessionRecord(nextProjection, record, canonicalEntry);
        try {
            if (this.activeSegmentBytes > 0 && this.activeSegmentBytes + entryBytes > this.targetSegmentBytes) {
                const nextIndex = this.activeSegmentIndex + 1;
                const nextPath = path.join(this.sessionDir, `journal.${String(nextIndex).padStart(6, '0')}.jsonl`);
                createAndSync(nextPath, serialized);
                protectFile(nextPath);
                this.activeJournalPath = nextPath;
                this.activeSegmentIndex = nextIndex;
                this.activeSegmentBytes = entryBytes;
            } else {
                appendAndSync(this.activeJournalPath, serialized);
                this.activeSegmentBytes += entryBytes;
            }
        } catch (error) {
            this.faulted = true;
            throw error;
        }
        this.projection = nextProjection;
        this.records.push(record);
        this.recordsByEntryId.set(entry.id, record);
        return structuredClone(record);
    }

    snapshot(): AgentSessionSnapshot {
        return snapshotAgentSession(this.projection);
    }

    close(): void {
        if (this.closed) return;
        this.closed = true;
        releaseWriterLock(this.lockPath, this.lock.token);
    }

    private assertWritable(): void {
        if (this.closed) throw new Error(`Agent session writer is closed: ${this.sessionId}`);
        if (this.faulted) throw new Error(`Agent session writer is faulted: ${this.sessionId}`);
        const current = readWriterLock(this.lockPath);
        if (!current || current.token !== this.lock.token) {
            this.faulted = true;
            throw new Error(`Agent session writer lock was lost: ${this.sessionId}`);
        }
    }
}

function createRecord(
    sessionId: string,
    sequence: number,
    previousHash: string | null,
    entry: AgentSessionJournalEntry,
): AgentSessionJournalRecord {
    const unsigned = {
        format: JOURNAL_FORMAT,
        sessionId,
        sequence,
        previousHash,
        entry: structuredClone(entry),
    };
    return {
        ...unsigned,
        hash: crypto.createHash('sha256').update(canonicalJson(unsigned)).digest('hex'),
    };
}

function parseJournalRecord(value: unknown, expectedSessionId: string): AgentSessionJournalRecord {
    if (!isObject(value)
        || value.format !== JOURNAL_FORMAT
        || value.sessionId !== expectedSessionId
        || !Number.isSafeInteger(value.sequence)
        || (value.sequence as number) < 1
        || (value.previousHash !== null && (typeof value.previousHash !== 'string' || !HASH_PATTERN.test(value.previousHash)))
        || typeof value.hash !== 'string'
        || !HASH_PATTERN.test(value.hash)) {
        throw new Error(`Invalid Agent session journal record for ${expectedSessionId}`);
    }
    validateJournalEntry(value.entry);
    const unsigned = {
        format: value.format,
        sessionId: value.sessionId,
        sequence: value.sequence,
        previousHash: value.previousHash,
        entry: value.entry,
    };
    const expectedHash = crypto.createHash('sha256').update(canonicalJson(unsigned)).digest('hex');
    if (value.hash !== expectedHash) {
        throw new Error(`Agent session journal hash mismatch at sequence ${String(value.sequence)}`);
    }
    return value as unknown as AgentSessionJournalRecord;
}

function validateJournalEntry(value: unknown): asserts value is AgentSessionJournalEntry {
    assertJsonValue(value, 'Agent session entry');
    if (!isObject(value)) throw new Error('Agent session entry must be an object');
    const type = requiredText(value.type, 'Agent session entry type', 100);
    requiredIdentifier(value.id, 'Agent session entry id');
    isoTimestamp(value.timestamp, 'Agent session entry timestamp');

    switch (type) {
        case 'session.created':
            requiredText(value.callerUserHandle, 'Agent session caller user', 200);
            requiredText(value.callerExtensionId, 'Agent session caller extension', 200);
            requiredText(value.workspaceId, 'Agent session workspace', 200);
            requiredText(value.title, 'Agent session title', 500);
            requiredText(value.profileId, 'Agent session profile', 200);
            executionMode(value.mode);
            textArray(value.allowedTools, 'Agent session allowed tools');
            return;
        case 'session.updated':
            optionalText(value.title, 'Agent session title', 500);
            optionalText(value.profileId, 'Agent session profile', 200);
            if (value.mode !== undefined) executionMode(value.mode);
            if (value.allowedTools !== undefined) textArray(value.allowedTools, 'Agent session allowed tools');
            if (value.archived !== undefined && typeof value.archived !== 'boolean') throw new Error('Agent session archived must be boolean');
            return;
        case 'ref.created':
            requiredIdentifier(value.ref, 'Agent session ref');
            nullableIdentifier(value.fromEntryId, 'Agent session ref anchor');
            return;
        case 'ref.moved':
            requiredIdentifier(value.ref, 'Agent session ref');
            nullableIdentifier(value.targetEntryId, 'Agent session ref target');
            return;
        case 'conversation.message':
            conversationBase(value);
            enumValue(value.role, ['system', 'user', 'assistant', 'tool'], 'Agent conversation role');
            nullableText(value.content, 'Agent conversation content');
            optionalIdentifier(value.toolCallId, 'Agent tool call id');
            optionalIdentifier(value.runId, 'Agent run id');
            optionalIdentifier(value.stepId, 'Agent step id');
            optionalIdentifier(value.consumedQueueId, 'Agent queue id');
            if (value.toolCalls !== undefined) validateToolCalls(value.toolCalls);
            return;
        case 'conversation.compacted':
            conversationBase(value);
            requiredText(value.summary, 'Agent compaction summary');
            if (value.sourceLeafEntryId === undefined) {
                // Legacy v1 checkpoints predate source snapshot metadata.
                if (value.sourceLastSequence !== undefined || value.contextWindowTokens !== undefined) {
                    throw new Error('Agent compaction source metadata must be complete');
                }
            } else {
                requiredIdentifier(value.sourceLeafEntryId, 'Agent compaction source leaf');
                nonNegativeInteger(value.sourceLastSequence, 'Agent compaction source sequence');
                positiveInteger(value.contextWindowTokens, 'Agent compaction context window');
            }
            nullableIdentifier(value.firstKeptEntryId, 'Agent compaction boundary');
            identifierArray(value.retainedEntryIds, 'Agent compaction retained entries');
            if (value.tokensBefore !== undefined) nonNegativeInteger(value.tokensBefore, 'Agent compaction tokens');
            if (value.tokensAfter !== undefined) nonNegativeInteger(value.tokensAfter, 'Agent compacted tokens');
            optionalIdentifier(value.runId, 'Agent run id');
            return;
        case 'conversation.branch_summary':
            conversationBase(value);
            requiredIdentifier(value.fromEntryId, 'Agent branch source');
            requiredText(value.summary, 'Agent branch summary');
            optionalIdentifier(value.runId, 'Agent run id');
            return;
        case 'queue.added':
            requiredIdentifier(value.queueId, 'Agent queue id');
            requiredIdentifier(value.ref, 'Agent session ref');
            enumValue(value.kind, ['steer', 'follow_up', 'next_run'], 'Agent queue kind');
            requiredText(value.content, 'Agent queued message');
            optionalIdentifier(value.runId, 'Agent run id');
            return;
        case 'queue.removed':
            requiredIdentifier(value.queueId, 'Agent queue id');
            enumValue(value.reason, ['cancelled', 'superseded', 'run_finished'], 'Agent queue removal reason');
            return;
        case 'run.accepted':
            requiredIdentifier(value.runId, 'Agent run id');
            requiredIdentifier(value.ref, 'Agent session ref');
            requiredIdentifier(value.triggerMessageId, 'Agent run trigger');
            requiredText(value.profileId, 'Agent run profile', 200);
            executionMode(value.mode);
            textArray(value.allowedTools, 'Agent run allowed tools');
            return;
        case 'run.started':
        case 'run.resumed':
        case 'run.cancel_requested':
            requiredIdentifier(value.runId, 'Agent run id');
            return;
        case 'run.suspended':
            requiredIdentifier(value.runId, 'Agent run id');
            requiredText(value.reason, 'Agent run suspension reason');
            return;
        case 'run.finished':
            requiredIdentifier(value.runId, 'Agent run id');
            enumValue(value.outcome, ['completed', 'failed', 'cancelled'], 'Agent run outcome');
            optionalText(value.finalText, 'Agent final text');
            optionalText(value.error, 'Agent run error');
            return;
        case 'step.started':
            requiredIdentifier(value.runId, 'Agent run id');
            requiredIdentifier(value.stepId, 'Agent step id');
            positiveInteger(value.index, 'Agent step index');
            if (value.kind !== undefined) enumValue(value.kind, ['generation', 'compaction'], 'Agent step kind');
            return;
        case 'step.finished':
            requiredIdentifier(value.runId, 'Agent run id');
            requiredIdentifier(value.stepId, 'Agent step id');
            enumValue(value.outcome, ['completed', 'failed', 'cancelled', 'interrupted'], 'Agent step outcome');
            optionalNullableText(value.finishReason, 'Agent step finish reason', 1_000);
            optionalText(value.error, 'Agent step error');
            return;
        case 'generation.started':
            requiredIdentifier(value.runId, 'Agent run id');
            requiredIdentifier(value.stepId, 'Agent step id');
            requiredIdentifier(value.generationId, 'Agent generation id');
            positiveInteger(value.attempt, 'Agent generation attempt');
            return;
        case 'generation.finished':
            requiredIdentifier(value.runId, 'Agent run id');
            requiredIdentifier(value.stepId, 'Agent step id');
            requiredIdentifier(value.generationId, 'Agent generation id');
            enumValue(value.outcome, ['completed', 'failed', 'cancelled', 'interrupted', 'timed_out'], 'Agent generation outcome');
            enumValue(
                value.providerRequestState,
                ['not_sent', 'sent_or_unknown', 'response_received'],
                'Agent provider request state',
            );
            optionalIdentifier(value.providerRequestId, 'Agent provider request id');
            optionalNullableText(value.finishReason, 'Agent generation finish reason', 1_000);
            optionalText(value.error, 'Agent generation error');
            return;
        case 'tool.requested':
            requiredIdentifier(value.runId, 'Agent run id');
            requiredIdentifier(value.stepId, 'Agent step id');
            requiredIdentifier(value.invocationId, 'Agent invocation id');
            requiredIdentifier(value.callId, 'Agent tool call id');
            requiredIdentifier(value.toolId, 'Agent tool id');
            enumValue(value.execution, ['host', 'module', 'browser'], 'Agent tool execution');
            optionalTimestamp(value.deadlineAt, 'Agent tool deadline');
            return;
        case 'approval.requested':
            requiredIdentifier(value.approvalId, 'Agent approval id');
            requiredIdentifier(value.runId, 'Agent run id');
            requiredIdentifier(value.invocationId, 'Agent invocation id');
            requiredText(value.title, 'Agent approval title', 1_000);
            requiredText(value.summary, 'Agent approval summary', 20_000);
            enumValue(value.riskLevel, ['low', 'medium', 'high'], 'Agent approval risk');
            optionalTimestamp(value.expiresAt, 'Agent approval expiry');
            return;
        case 'approval.resolved':
            requiredIdentifier(value.approvalId, 'Agent approval id');
            enumValue(value.decision, ['approved', 'denied', 'expired', 'cancelled'], 'Agent approval decision');
            optionalText(value.resolvedByUserHandle, 'Agent approval resolver', 200);
            return;
        case 'tool.waiting':
            requiredIdentifier(value.invocationId, 'Agent invocation id');
            enumValue(value.reason, ['browser'], 'Agent tool wait reason');
            optionalTimestamp(value.deadlineAt, 'Agent tool wait deadline');
            return;
        case 'tool.started':
            requiredIdentifier(value.invocationId, 'Agent invocation id');
            optionalIdentifier(value.claimId, 'Agent claim id');
            optionalIdentifier(value.idempotencyKey, 'Agent idempotency key');
            return;
        case 'tool.finished':
            requiredIdentifier(value.invocationId, 'Agent invocation id');
            enumValue(value.outcome, ['completed', 'failed', 'cancelled', 'outcome_unknown', 'timed_out'], 'Agent tool outcome');
            optionalText(value.error, 'Agent tool error');
            return;
        case 'workspace.checkpointed':
            requiredIdentifier(value.invocationId, 'Agent invocation id');
            enumValue(value.phase, ['before', 'after', 'failure'], 'Agent workspace checkpoint phase');
            requiredIdentifier(value.commitId, 'Agent workspace commit id');
            return;
        default:
            throw new Error(`Unsupported Agent session entry type: ${type}`);
    }
}

function conversationBase(value: Record<string, unknown>): void {
    requiredIdentifier(value.ref, 'Agent session ref');
    nullableIdentifier(value.parentId, 'Agent conversation parent');
}

function validateToolCalls(value: unknown): void {
    if (!Array.isArray(value)) throw new Error('Agent tool calls must be an array');
    for (const call of value) {
        if (!isObject(call)) throw new Error('Agent tool call must be an object');
        requiredIdentifier(call.id, 'Agent tool call id');
        requiredIdentifier(call.name, 'Agent tool call name');
        requiredText(call.arguments, 'Agent tool call arguments', undefined, true);
    }
}

function readWriterLock(lockPath: string): WriterLockRecord | null {
    try {
        const value = JSON.parse(fs.readFileSync(lockPath, 'utf8')) as unknown;
        if (!isObject(value)
            || value.format !== LOCK_FORMAT
            || typeof value.token !== 'string'
            || typeof value.pid !== 'number'
            || typeof value.hostname !== 'string'
            || typeof value.createdAt !== 'string') return null;
        return value as unknown as WriterLockRecord;
    } catch {
        return null;
    }
}

function releaseWriterLock(lockPath: string, token: string): void {
    const current = readWriterLock(lockPath);
    if (!current) {
        if (!fs.existsSync(lockPath)) return;
        throw new Error(`Unable to verify Agent session writer lock: ${lockPath}`);
    }
    if (current.token !== token) throw new Error(`Agent session writer lock token changed: ${lockPath}`);
    fs.unlinkSync(lockPath);
}

function appendAndSync(filePath: string, content: string): void {
    let descriptor: number | null = null;
    try {
        descriptor = fs.openSync(filePath, 'a');
        fs.writeFileSync(descriptor, content);
        fs.fsyncSync(descriptor);
    } finally {
        if (descriptor !== null) fs.closeSync(descriptor);
    }
}

function createAndSync(filePath: string, content: string): void {
    let descriptor: number | null = null;
    try {
        descriptor = fs.openSync(filePath, 'wx');
        fs.writeFileSync(descriptor, content);
        fs.fsyncSync(descriptor);
    } finally {
        if (descriptor !== null) fs.closeSync(descriptor);
    }
    fsyncDirectory(path.dirname(filePath));
}

function truncateAndSync(filePath: string, length: number): void {
    let descriptor: number | null = null;
    try {
        descriptor = fs.openSync(filePath, 'r+');
        fs.ftruncateSync(descriptor, length);
        fs.fsyncSync(descriptor);
    } finally {
        if (descriptor !== null) fs.closeSync(descriptor);
    }
}

function canonicalJson(value: unknown): string {
    if (value === null || typeof value === 'string' || typeof value === 'boolean') return JSON.stringify(value);
    if (typeof value === 'number') {
        if (!Number.isFinite(value)) throw new Error('Agent session journal contains a non-finite number');
        return JSON.stringify(value);
    }
    if (Array.isArray(value)) return `[${value.map(item => canonicalJson(item)).join(',')}]`;
    if (isObject(value)) {
        return `{${Object.keys(value)
            .filter(key => value[key] !== undefined)
            .sort()
            .map(key => `${JSON.stringify(key)}:${canonicalJson(value[key])}`)
            .join(',')}}`;
    }
    throw new Error(`Agent session journal contains unsupported data: ${typeof value}`);
}

function assertJsonValue(value: unknown, label: string, ancestors = new Set<object>()): void {
    if (value === null || typeof value === 'string' || typeof value === 'boolean') return;
    if (typeof value === 'number') {
        if (!Number.isFinite(value)) throw new Error(`${label} contains a non-finite number`);
        return;
    }
    if (typeof value !== 'object') throw new Error(`${label} contains a non-JSON value: ${typeof value}`);
    if (ancestors.has(value)) throw new Error(`${label} contains a cycle`);
    const prototype = Object.getPrototypeOf(value);
    if (!Array.isArray(value) && prototype !== Object.prototype && prototype !== null) {
        throw new Error(`${label} contains a non-plain object`);
    }
    ancestors.add(value);
    if (Array.isArray(value)) {
        for (const item of value) assertJsonValue(item, label, ancestors);
    } else {
        for (const item of Object.values(value as Record<string, unknown>)) assertJsonValue(item, label, ancestors);
    }
    ancestors.delete(value);
}

function requiredText(value: unknown, label: string, maxLength?: number, allowEmpty = false): string {
    if (typeof value !== 'string' || (!allowEmpty && !value.trim())) throw new Error(`${label} is required`);
    if (maxLength !== undefined && value.length > maxLength) throw new Error(`${label} exceeds ${maxLength} characters`);
    return value;
}

function optionalText(value: unknown, label: string, maxLength?: number): string | undefined {
    if (value === undefined) return undefined;
    return requiredText(value, label, maxLength);
}

function nullableText(value: unknown, label: string, maxLength?: number): string | null {
    if (value === null) return null;
    return requiredText(value, label, maxLength, true);
}

function optionalNullableText(value: unknown, label: string, maxLength: number): string | null | undefined {
    if (value === undefined || value === null) return value;
    return requiredText(value, label, maxLength, true);
}

function requiredIdentifier(value: unknown, label: string): string {
    return requiredText(value, label, 500);
}

function optionalIdentifier(value: unknown, label: string): string | undefined {
    if (value === undefined) return undefined;
    return requiredIdentifier(value, label);
}

function nullableIdentifier(value: unknown, label: string): string | null {
    if (value === null) return null;
    return requiredIdentifier(value, label);
}

function isoTimestamp(value: unknown, label: string): string {
    const timestamp = requiredText(value, label, 100);
    if (!Number.isFinite(Date.parse(timestamp))) throw new Error(`${label} must be an ISO timestamp`);
    return timestamp;
}

function optionalTimestamp(value: unknown, label: string): string | undefined {
    if (value === undefined) return undefined;
    return isoTimestamp(value, label);
}

function executionMode(value: unknown): AgentExecutionMode {
    return enumValue(value, ['plan', 'ask', 'auto'], 'Agent execution mode');
}

function enumValue<const T extends string>(value: unknown, values: readonly T[], label: string): T {
    if (typeof value !== 'string' || !values.includes(value as T)) throw new Error(`${label} is invalid`);
    return value as T;
}

function textArray(value: unknown, label: string, maxItems?: number): string[] {
    if (!Array.isArray(value) || (maxItems !== undefined && value.length > maxItems)) throw new Error(`${label} must be an array`);
    return value.map(item => requiredText(item, label, 500));
}

function identifierArray(value: unknown, label: string, maxItems?: number): string[] {
    if (!Array.isArray(value) || (maxItems !== undefined && value.length > maxItems)) throw new Error(`${label} must be an array`);
    return value.map(item => requiredIdentifier(item, label));
}

function positiveInteger(value: unknown, label: string): number {
    return boundedInteger(value, label, 1, Number.MAX_SAFE_INTEGER);
}

function nonNegativeInteger(value: unknown, label: string): number {
    return boundedInteger(value, label, 0, Number.MAX_SAFE_INTEGER);
}

function boundedInteger(value: unknown, label: string, minimum: number, maximum: number): number {
    if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < minimum || value > maximum) {
        throw new Error(`${label} must be an integer between ${minimum} and ${maximum}`);
    }
    return value;
}

function assertFileId(value: string, label: string): void {
    if (!value || value.length > 128 || !SAFE_FILE_ID.test(value) || value === '.' || value === '..') {
        throw new Error(`${label} contains invalid characters`);
    }
}

function protectDirectory(dirPath: string): void {
    ensureDir(dirPath);
    if (process.platform !== 'win32') fs.chmodSync(dirPath, 0o700);
}

function protectFile(filePath: string): void {
    if (process.platform !== 'win32') fs.chmodSync(filePath, 0o600);
}

function processIsAlive(pid: number): boolean {
    try {
        process.kill(pid, 0);
        return true;
    } catch (error) {
        return isNodeError(error, 'EPERM');
    }
}

function isObject(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isNodeError(error: unknown, code: string): error is NodeJS.ErrnoException {
    return error instanceof Error && (error as NodeJS.ErrnoException).code === code;
}

function errorMessage(error: unknown): string {
    return error instanceof Error ? error.message : String(error);
}

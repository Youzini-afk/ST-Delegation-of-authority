import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { AgentSessionJournalEntry } from './agent-session-model.js';
import { AgentSessionStoreService } from './agent-session-store-service.js';

const tempDirs: string[] = [];

afterEach(() => {
    vi.restoreAllMocks();
    for (const dir of tempDirs.splice(0)) {
        fs.rmSync(dir, { recursive: true, force: true });
    }
});

describe('AgentSessionStoreService', () => {
    it('reconstructs one continuous conversation separately from its execution history', () => {
        const store = createStore();
        const session = createSession(store);
        const writer = store.openWriter(session.session.id);

        append(writer, message('message-user', null, 'user', 'Inspect the extension.'));
        append(writer, {
            id: 'entry-run-accepted',
            type: 'run.accepted',
            timestamp: tick(),
            runId: 'run-1',
            ref: 'main',
            triggerMessageId: 'message-user',
            profileId: 'profile',
            mode: 'ask',
            allowedTools: ['host_read_file', 'host_write_file'],
        });
        append(writer, runEvent('entry-run-started', 'run.started'));
        append(writer, stepStarted('entry-step-1', 'step-1', 1));
        append(writer, generationStarted('entry-generation-1', 'generation-1', 'step-1', 1));
        append(writer, {
            id: 'entry-generation-1-finished',
            type: 'generation.finished',
            timestamp: tick(),
            runId: 'run-1',
            stepId: 'step-1',
            generationId: 'generation-1',
            outcome: 'completed',
            providerRequestState: 'response_received',
            finishReason: 'tool_calls',
            usage: { prompt_tokens: 10, completion_tokens: 4 },
        });
        append(writer, {
            ...message('message-assistant-tool', 'message-user', 'assistant', null),
            runId: 'run-1',
            stepId: 'step-1',
            toolCalls: [{ id: 'call-1', name: 'host_write_file', arguments: '{"path":"a.txt"}' }],
        });
        append(writer, {
            id: 'entry-tool-requested',
            type: 'tool.requested',
            timestamp: tick(),
            runId: 'run-1',
            stepId: 'step-1',
            invocationId: 'invocation-1',
            callId: 'call-1',
            toolId: 'host_write_file',
            execution: 'host',
            arguments: { path: 'a.txt', content: 'hello' },
        });
        append(writer, {
            id: 'entry-approval-requested',
            type: 'approval.requested',
            timestamp: tick(),
            approvalId: 'approval-1',
            runId: 'run-1',
            invocationId: 'invocation-1',
            title: 'Write a file',
            summary: 'Write a.txt',
            arguments: { path: 'a.txt' },
            riskLevel: 'medium',
        });
        expect(writer.snapshot().runs[0]).toMatchObject({ id: 'run-1', status: 'waiting_approval' });

        append(writer, {
            id: 'entry-approval-resolved',
            type: 'approval.resolved',
            timestamp: tick(),
            approvalId: 'approval-1',
            decision: 'approved',
            resolvedByUserHandle: 'admin',
        });
        append(writer, checkpoint('entry-before-checkpoint', 'before', 'commit-before'));
        append(writer, {
            id: 'entry-tool-started',
            type: 'tool.started',
            timestamp: tick(),
            invocationId: 'invocation-1',
            idempotencyKey: 'invocation-1',
        });
        append(writer, {
            id: 'entry-tool-finished',
            type: 'tool.finished',
            timestamp: tick(),
            invocationId: 'invocation-1',
            outcome: 'completed',
            result: { written: true },
        });
        append(writer, checkpoint('entry-after-checkpoint', 'after', 'commit-after'));
        append(writer, {
            ...message('message-tool-result', 'message-assistant-tool', 'tool', '{"ok":true}'),
            runId: 'run-1',
            stepId: 'step-1',
            toolCallId: 'call-1',
        });
        append(writer, stepFinished('entry-step-1-finished', 'step-1', 'completed'));

        append(writer, stepStarted('entry-step-2', 'step-2', 2));
        append(writer, generationStarted('entry-generation-2', 'generation-2', 'step-2', 1));
        append(writer, {
            id: 'entry-generation-2-finished',
            type: 'generation.finished',
            timestamp: tick(),
            runId: 'run-1',
            stepId: 'step-2',
            generationId: 'generation-2',
            outcome: 'completed',
            providerRequestState: 'response_received',
            finishReason: 'stop',
        });
        append(writer, {
            ...message('message-assistant-final', 'message-tool-result', 'assistant', 'The extension is repaired.'),
            runId: 'run-1',
            stepId: 'step-2',
        });
        append(writer, stepFinished('entry-step-2-finished', 'step-2', 'completed'));
        append(writer, {
            id: 'entry-run-finished',
            type: 'run.finished',
            timestamp: tick(),
            runId: 'run-1',
            outcome: 'completed',
            finalText: 'The extension is repaired.',
        });

        const live = writer.snapshot();
        expect(live.session.title).toBe('Repair extension');
        expect(live.activePaths.main).toEqual([
            'message-user',
            'message-assistant-tool',
            'message-tool-result',
            'message-assistant-final',
        ]);
        expect(live.runs).toMatchObject([{ id: 'run-1', status: 'completed', stepCount: 2 }]);
        expect(live.generations).toHaveLength(2);
        expect(live.invocations).toMatchObject([{
            id: 'invocation-1',
            status: 'completed',
            beforeCommitId: 'commit-before',
            afterCommitId: 'commit-after',
        }]);
        expect(live.approvals).toMatchObject([{ id: 'approval-1', status: 'approved' }]);
        writer.close();

        const reopened = new AgentSessionStoreService(store.stateDir).readSession(session.session.id);
        expect(reopened.snapshot).toEqual(live);
        expect(reopened.tail).toEqual({ tornTailBytes: 0, missingFinalNewline: false });
    });

    it('keeps every complete prefix readable and repairs a torn final record before appending', () => {
        const store = createStore();
        const session = createSession(store);
        const writer = store.openWriter(session.session.id);
        append(writer, message('message-1', null, 'user', 'Hello'));
        writer.close();

        const journal = journalPath(store, session.session.id);
        fs.appendFileSync(journal, '{"format":"authority-agent-session-journal/v1"');
        const prefix = store.readSession(session.session.id);
        expect(prefix.snapshot.conversation.map(entry => entry.id)).toEqual(['message-1']);
        expect(prefix.tail.tornTailBytes).toBeGreaterThan(0);

        const recovered = store.openWriter(session.session.id);
        append(recovered, {
            id: 'entry-title',
            type: 'session.updated',
            timestamp: tick(),
            title: 'Recovered session',
        });
        recovered.close();

        expect(store.readSession(session.session.id)).toMatchObject({
            snapshot: { session: { title: 'Recovered session' }, lastSequence: 3 },
            tail: { tornTailBytes: 0, missingFinalNewline: false },
        });
        expect(fs.readFileSync(journal, 'utf8')).not.toContain('{"format":"authority-agent-session-journal/v1"{"');
    });

    it('accepts a complete final record without a newline and seals it when a writer opens', () => {
        const store = createStore();
        const session = createSession(store);
        const writer = store.openWriter(session.session.id);
        append(writer, message('message-1', null, 'user', 'Hello'));
        writer.close();
        const journal = journalPath(store, session.session.id);
        fs.truncateSync(journal, fs.statSync(journal).size - 1);

        expect(store.readSession(session.session.id).tail).toEqual({
            tornTailBytes: 0,
            missingFinalNewline: true,
        });
        const recovered = store.openWriter(session.session.id);
        append(recovered, {
            id: 'entry-title',
            type: 'session.updated',
            timestamp: tick(),
            title: 'Still valid',
        });
        recovered.close();
        expect(fs.readFileSync(journal, 'utf8').endsWith('\n')).toBe(true);
        expect(store.readSession(session.session.id).snapshot.lastSequence).toBe(3);
    });

    it('detects tampering instead of silently skipping a complete corrupted record', () => {
        const store = createStore();
        const session = createSession(store);
        const writer = store.openWriter(session.session.id);
        append(writer, message('message-1', null, 'user', 'Original'));
        writer.close();
        const journal = journalPath(store, session.session.id);
        const tampered = fs.readFileSync(journal, 'utf8').replace('Original', 'Tampered');
        fs.writeFileSync(journal, tampered);

        expect(() => store.readSession(session.session.id)).toThrow(/hash mismatch/);
        expect(store.listSessions()).toMatchObject({
            sessions: [],
            problems: [{ sessionId: session.session.id, error: expect.stringContaining('hash mismatch') }],
        });
    });

    it('does not classify a complete tampered final record without a newline as a torn tail', () => {
        const store = createStore();
        const session = createSession(store);
        const writer = store.openWriter(session.session.id);
        append(writer, message('message-1', null, 'user', 'Original'));
        writer.close();
        const journal = journalPath(store, session.session.id);
        const tampered = fs.readFileSync(journal, 'utf8').trimEnd().replace('Original', 'Tampered');
        fs.writeFileSync(journal, tampered);

        expect(() => store.readSession(session.session.id)).toThrow(/hash mismatch/);
        expect(() => store.openWriter(session.session.id)).toThrow(/hash mismatch/);
        expect(fs.readFileSync(journal, 'utf8')).toBe(tampered);
    });

    it('rejects non-JSON payloads before they can diverge between live and replayed state', () => {
        const store = createStore();
        const session = createSession(store);
        const writer = store.openWriter(session.session.id);
        const base = {
            id: 'entry-tool-invalid',
            type: 'tool.requested' as const,
            timestamp: tick(),
            runId: 'run-1',
            stepId: 'step-1',
            invocationId: 'invocation-1',
            callId: 'call-1',
            toolId: 'host_read_file',
            execution: 'host' as const,
        };

        expect(() => writer.append({ ...base, arguments: new Date() })).toThrow(/non-plain object/);
        expect(() => writer.append({ ...base, arguments: new Map([['path', 'a.txt']]) })).toThrow(/non-plain object/);
        expect(writer.snapshot().lastSequence).toBe(1);
        writer.close();
    });

    it('makes stable entry ids idempotent and rejects conflicting reuse', () => {
        const store = createStore();
        const session = createSession(store);
        const writer = store.openWriter(session.session.id);
        const entry = message('message-1', null, 'user', 'Same message');

        const first = writer.append(entry);
        const replay = writer.append(structuredClone(entry));
        expect(replay).toEqual(first);
        expect(writer.snapshot().lastSequence).toBe(2);
        expect(() => writer.append({ ...entry, content: 'Different message' })).toThrow(/reused with different content/);
        writer.close();
    });

    it('keeps one writer per session and reclaims only a provably dead local owner', () => {
        const store = createStore({ hostname: 'test-host', pid: 101, isProcessAlive: pid => pid === 101 });
        const session = createSession(store);
        const first = store.openWriter(session.session.id);
        expect(() => store.openWriter(session.session.id)).toThrow(/active writer/);
        first.close();

        const lock = lockPath(store, session.session.id);
        fs.writeFileSync(lock, `${JSON.stringify({
            format: 'authority-agent-session-writer-lock/v1',
            token: 'dead-owner',
            pid: 999,
            hostname: 'test-host',
            createdAt: '2020-01-01T00:00:00.000Z',
        })}\n`);
        const recoveringStore = new AgentSessionStoreService(store.stateDir, {
            hostname: 'test-host',
            pid: 202,
            isProcessAlive: () => false,
        });
        const recovered = recoveringStore.openWriter(session.session.id);
        append(recovered, message('message-after-crash', null, 'user', 'Recovered'));
        recovered.close();
        expect(recoveringStore.readSession(session.session.id).snapshot.conversation).toHaveLength(1);
    });

    it('never steals a writer lock owned by another host', () => {
        const store = createStore({ hostname: 'local-host', staleLockMs: 0 });
        const session = createSession(store);
        fs.writeFileSync(lockPath(store, session.session.id), `${JSON.stringify({
            format: 'authority-agent-session-writer-lock/v1',
            token: 'remote-owner',
            pid: 999,
            hostname: 'remote-host',
            createdAt: '2020-01-01T00:00:00.000Z',
        })}\n`);

        expect(() => store.openWriter(session.session.id)).toThrow(/active writer/);
    });

    it('preserves branch topology with movable refs instead of copying prior runs', () => {
        const store = createStore();
        const session = createSession(store);
        const writer = store.openWriter(session.session.id);
        append(writer, message('message-user', null, 'user', 'Choose a solution'));
        append(writer, message('message-answer-a', 'message-user', 'assistant', 'Solution A'));
        append(writer, {
            id: 'entry-ref-created',
            type: 'ref.created',
            timestamp: tick(),
            ref: 'alternative',
            fromEntryId: 'message-user',
        });
        append(writer, {
            ...message('message-answer-b', 'message-user', 'assistant', 'Solution B'),
            ref: 'alternative',
        });

        expect(writer.snapshot().activePaths).toEqual({
            main: ['message-user', 'message-answer-a'],
            alternative: ['message-user', 'message-answer-b'],
        });
        writer.close();
    });

    it('persists compaction as an append-only checkpoint and rejects a non-suffix retention set', () => {
        const store = createStore();
        const session = createSession(store);
        const writer = store.openWriter(session.session.id);
        append(writer, message('message-one', null, 'user', 'Old context'));
        append(writer, message('message-two', 'message-one', 'user', 'Recent context'));
        const sourceLastSequence = writer.snapshot().lastSequence;
        append(writer, {
            id: 'compaction-one',
            type: 'conversation.compacted',
            timestamp: tick(),
            ref: 'main',
            parentId: 'message-two',
            summary: 'Old context was summarized.',
            sourceLeafEntryId: 'message-two',
            sourceLastSequence,
            firstKeptEntryId: 'message-two',
            retainedEntryIds: ['message-two'],
            tokensBefore: 900,
            tokensAfter: 220,
            contextWindowTokens: 1_024,
        });
        expect(writer.snapshot().conversation.at(-1)).toMatchObject({
            id: 'compaction-one',
            kind: 'compaction',
            retainedEntryIds: ['message-two'],
            tokensBefore: 900,
            tokensAfter: 220,
        });
        writer.close();
        expect(store.readSession(session.session.id).snapshot.conversation.at(-1)).toMatchObject({ id: 'compaction-one' });

        const invalidStore = createStore();
        const invalidSession = createSession(invalidStore);
        const invalidWriter = invalidStore.openWriter(invalidSession.session.id);
        append(invalidWriter, message('invalid-one', null, 'user', 'Old'));
        append(invalidWriter, message('invalid-two', 'invalid-one', 'user', 'Recent'));
        expect(() => append(invalidWriter, {
            id: 'invalid-compaction',
            type: 'conversation.compacted',
            timestamp: tick(),
            ref: 'main',
            parentId: 'invalid-two',
            summary: 'Invalid checkpoint',
            sourceLeafEntryId: 'invalid-two',
            sourceLastSequence: invalidWriter.snapshot().lastSequence,
            firstKeptEntryId: 'invalid-one',
            retainedEntryIds: ['invalid-one'],
            contextWindowTokens: 1_024,
        })).toThrow(/active path suffix/);
        invalidWriter.close();
    });

    it('replays compacted records written by the original v1 journal schema', () => {
        const store = createStore();
        const session = createSession(store);
        const writer = store.openWriter(session.session.id);
        append(writer, message('legacy-message-one', null, 'user', 'Old context'));
        append(writer, message('legacy-message-two', 'legacy-message-one', 'assistant', 'Recent context'));
        append(writer, {
            id: 'legacy-compaction',
            type: 'conversation.compacted',
            timestamp: tick(),
            ref: 'main',
            parentId: 'legacy-message-two',
            summary: 'Legacy checkpoint',
            firstKeptEntryId: 'legacy-message-two',
            retainedEntryIds: ['legacy-message-two'],
            tokensBefore: 900,
        });
        writer.close();

        expect(store.readSession(session.session.id).snapshot.conversation.at(-1)).toMatchObject({
            id: 'legacy-compaction',
            kind: 'compaction',
            summary: 'Legacy checkpoint',
            retainedEntryIds: ['legacy-message-two'],
        });
    });

    it('rejects conversation metadata that points to a missing or different run', () => {
        const store = createStore();
        const session = createSession(store);
        const writer = store.openWriter(session.session.id);
        append(writer, message('message-main-user', null, 'user', 'Main'));
        append(writer, {
            id: 'entry-main-run',
            type: 'run.accepted',
            timestamp: tick(),
            runId: 'run-main',
            ref: 'main',
            triggerMessageId: 'message-main-user',
            profileId: 'profile',
            mode: 'ask',
            allowedTools: [],
        });
        append(writer, { id: 'entry-main-start', type: 'run.started', timestamp: tick(), runId: 'run-main' });
        append(writer, { id: 'entry-main-step', type: 'step.started', timestamp: tick(), runId: 'run-main', stepId: 'step-main', index: 1 });

        expect(() => append(writer, {
            id: 'entry-bad-summary',
            type: 'conversation.branch_summary',
            timestamp: tick(),
            ref: 'main',
            parentId: 'message-main-user',
            fromEntryId: 'message-main-user',
            summary: 'Invalid attribution',
            runId: 'run-missing',
        })).toThrow(/run not found/);

        append(writer, {
            id: 'entry-alt-ref',
            type: 'ref.created',
            timestamp: tick(),
            ref: 'alternative',
            fromEntryId: null,
        });
        append(writer, { ...message('message-alt-user', null, 'user', 'Alternative'), ref: 'alternative' });
        append(writer, {
            id: 'entry-alt-run',
            type: 'run.accepted',
            timestamp: tick(),
            runId: 'run-alt',
            ref: 'alternative',
            triggerMessageId: 'message-alt-user',
            profileId: 'profile',
            mode: 'ask',
            allowedTools: [],
        });
        append(writer, { id: 'entry-alt-start', type: 'run.started', timestamp: tick(), runId: 'run-alt' });
        append(writer, { id: 'entry-alt-step', type: 'step.started', timestamp: tick(), runId: 'run-alt', stepId: 'step-alt', index: 1 });

        expect(() => append(writer, {
            ...message('message-cross-run', 'message-main-user', 'assistant', 'Wrong step'),
            runId: 'run-main',
            stepId: 'step-alt',
        })).toThrow(/step belongs to another run/);
        writer.close();
    });

    it('rotates journal segments without imposing a total session size limit', () => {
        const store = createStore({ targetSegmentBytes: 600 });
        const session = createSession(store);
        const writer = store.openWriter(session.session.id);
        let parentId: string | null = null;
        for (let index = 0; index < 12; index += 1) {
            const id = `segment-message-${index}`;
            append(writer, message(id, parentId, 'user', `message ${index} ${'x'.repeat(400)}`));
            parentId = id;
        }
        const snapshot = writer.snapshot();
        writer.close();

        const files = fs.readdirSync(path.dirname(journalPath(store, session.session.id)))
            .filter(name => /^journal(?:\.\d{6})?\.jsonl$/.test(name));
        expect(files.length).toBeGreaterThan(2);
        expect(store.readSession(session.session.id).snapshot).toEqual(snapshot);
    });

    it('validates the next prefix before writing it', () => {
        const store = createStore();
        const session = createSession(store);
        const writer = store.openWriter(session.session.id);
        append(writer, message('message-1', null, 'user', 'First'));
        const bytesBefore = fs.statSync(journalPath(store, session.session.id)).size;

        expect(() => append(writer, message('message-invalid', null, 'assistant', 'Wrong parent')))
            .toThrow(/parent is not the active leaf/);
        expect(fs.statSync(journalPath(store, session.session.id)).size).toBe(bytesBefore);
        expect(writer.snapshot().lastSequence).toBe(2);
        writer.close();
    });

    it('faults a writer after an ambiguous durable write and recovers by replaying the longer prefix', () => {
        const store = createStore();
        const session = createSession(store);
        const writer = store.openWriter(session.session.id);
        const entry: AgentSessionJournalEntry = {
            id: 'entry-title',
            type: 'session.updated',
            timestamp: tick(),
            title: 'Written before fsync failed',
        };
        vi.spyOn(fs, 'fsyncSync').mockImplementationOnce(() => {
            throw new Error('simulated fsync failure');
        });

        expect(() => writer.append(entry)).toThrow(/simulated fsync failure/);
        expect(() => writer.append({ ...entry, id: 'entry-later' })).toThrow(/writer is faulted/);
        writer.close();
        vi.restoreAllMocks();

        const recovered = store.openWriter(session.session.id);
        expect(recovered.snapshot().session.title).toBe('Written before fsync failed');
        expect(recovered.append(entry).sequence).toBe(2);
        recovered.close();
    });
});

let clock = 0;

function tick(): string {
    clock += 1;
    return `2026-01-01T00:00:${String(clock).padStart(2, '0')}.000Z`;
}

function createStore(options: ConstructorParameters<typeof AgentSessionStoreService>[1] = {}): AgentSessionStoreService {
    clock = 0;
    const stateDir = fs.mkdtempSync(path.join(os.tmpdir(), 'authority-agent-sessions-'));
    tempDirs.push(stateDir);
    return new AgentSessionStoreService(stateDir, { now: tick, ...options });
}

function createSession(store: AgentSessionStoreService) {
    return store.createSession({
        id: 'session-1',
        callerUserHandle: 'alice',
        callerExtensionId: 'test-extension',
        workspaceId: 'workspace',
        title: 'Repair extension',
        profileId: 'profile',
        mode: 'ask',
        allowedTools: ['host_read_file', 'host_write_file'],
    });
}

function append(writer: ReturnType<AgentSessionStoreService['openWriter']>, entry: AgentSessionJournalEntry) {
    return writer.append(entry);
}

function message(
    id: string,
    parentId: string | null,
    role: 'user' | 'assistant' | 'tool',
    content: string | null,
): Extract<AgentSessionJournalEntry, { type: 'conversation.message' }> {
    return {
        id,
        type: 'conversation.message',
        timestamp: tick(),
        ref: 'main',
        parentId,
        role,
        content,
    };
}

function runEvent(
    id: string,
    type: 'run.started' | 'run.resumed' | 'run.cancel_requested',
): Extract<AgentSessionJournalEntry, { type: typeof type }> {
    return { id, type, timestamp: tick(), runId: 'run-1' };
}

function stepStarted(id: string, stepId: string, index: number): Extract<AgentSessionJournalEntry, { type: 'step.started' }> {
    return { id, type: 'step.started', timestamp: tick(), runId: 'run-1', stepId, index };
}

function stepFinished(
    id: string,
    stepId: string,
    outcome: 'completed' | 'failed' | 'cancelled' | 'interrupted',
): Extract<AgentSessionJournalEntry, { type: 'step.finished' }> {
    return { id, type: 'step.finished', timestamp: tick(), runId: 'run-1', stepId, outcome };
}

function generationStarted(
    id: string,
    generationId: string,
    stepId: string,
    attempt: number,
): Extract<AgentSessionJournalEntry, { type: 'generation.started' }> {
    return { id, type: 'generation.started', timestamp: tick(), runId: 'run-1', stepId, generationId, attempt };
}

function checkpoint(
    id: string,
    phase: 'before' | 'after' | 'failure',
    commitId: string,
): Extract<AgentSessionJournalEntry, { type: 'workspace.checkpointed' }> {
    return { id, type: 'workspace.checkpointed', timestamp: tick(), invocationId: 'invocation-1', phase, commitId };
}

function journalPath(store: AgentSessionStoreService, sessionId: string): string {
    return path.join(store.stateDir, 'sessions', sessionId, 'journal.jsonl');
}

function lockPath(store: AgentSessionStoreService, sessionId: string): string {
    return path.join(store.stateDir, 'sessions', sessionId, 'writer.lock');
}

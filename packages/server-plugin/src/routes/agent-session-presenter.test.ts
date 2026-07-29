import { describe, expect, it } from 'vitest';
import type { AgentSessionSnapshot } from '../services/agent-session-model.js';
import {
    pageAgentSessions,
    presentAgentSession,
    summarizeAgentSession,
} from './agent-session-presenter.js';

describe('Agent session transport presenter', () => {
    it('paginates a stable newest-first session order without skipping timestamp ties', () => {
        const snapshots = [
            snapshot('session-a', '2026-07-29T12:00:00.000Z'),
            snapshot('session-c', '2026-07-29T12:00:00.000Z'),
            snapshot('session-b', '2026-07-29T12:00:00.000Z'),
        ];

        const first = pageAgentSessions(snapshots, { page: { limit: 2 } });
        const second = pageAgentSessions(snapshots, {
            page: { cursor: first.page.nextCursor!, limit: 2 },
        });

        expect(first.sessions.map(session => session.id)).toEqual(['session-c', 'session-b']);
        expect(first.page).toMatchObject({ hasMore: true, totalCount: 3, limit: 2 });
        expect(second.sessions.map(session => session.id)).toEqual(['session-a']);
        expect(second.page).toMatchObject({ hasMore: false, totalCount: 3, nextCursor: null });
    });

    it('binds cursors to archive scope and rejects malformed page limits', () => {
        const live = snapshot('session-live', '2026-07-29T12:00:00.000Z');
        const older = snapshot('session-older', '2026-07-28T12:00:00.000Z');
        const cursor = pageAgentSessions([live, older], { page: { limit: 1 } }).page.nextCursor!;

        expect(() => pageAgentSessions([live, older], { archived: true, page: { cursor, limit: 1 } }))
            .toThrow('cursor does not match');
        expect(() => pageAgentSessions([live], { page: { limit: 0 } }))
            .toThrow('page limit must be an integer');
        expect(() => pageAgentSessions([live], { page: { cursor: 'not-a-cursor' } }))
            .toThrow('Invalid Agent session cursor');
        expect(() => pageAgentSessions([live], { archived: 'false' } as never))
            .toThrow('archived filter must be boolean');
    });

    it('summarizes only the active ref path and does not navigate by historical runs', () => {
        const value = snapshot('session-1', '2026-07-29T12:00:00.000Z');
        value.conversation.push({
            id: 'branch-message',
            sequence: 6,
            ref: 'branch',
            parentId: 'message-1',
            timestamp: value.session.updatedAt,
            kind: 'message',
            role: 'assistant',
            content: 'This branch must not become the preview',
        });
        value.runs.push({ ...value.runs[0]!, id: 'historical-run', status: 'completed' });

        expect(summarizeAgentSession(value)).toMatchObject({
            id: 'session-1',
            status: 'running',
            activeRunId: 'run-1',
            messageCount: 1,
            lastMessagePreview: 'Active message',
        });
    });

    it('removes journal and browser ownership secrets at the public boundary', () => {
        const value = snapshot('session-1', '2026-07-29T12:00:00.000Z');

        const presented = presentAgentSession(value) as unknown as Record<string, any>;

        expect(presented.lastHash).toBeUndefined();
        expect(presented.invocations[0].claimId).toBeUndefined();
        expect(presented.invocations[0].idempotencyKey).toBeUndefined();
        expect(presented.invocations[0]).toMatchObject({ id: 'invocation-1', status: 'claimed' });
    });
});

function snapshot(id: string, updatedAt: string): AgentSessionSnapshot {
    return {
        session: {
            id,
            callerUserHandle: 'alice',
            callerExtensionId: 'third-party/ext-a',
            workspaceId: 'workspace-a',
            title: `Session ${id}`,
            profileId: 'profile-1',
            mode: 'ask',
            allowedTools: ['browser.inspect'],
            maxSteps: 24,
            createdAt: '2026-07-20T12:00:00.000Z',
            updatedAt,
        },
        lastSequence: 5,
        lastHash: 'journal-hash-secret',
        refs: [{
            name: 'main',
            leafEntryId: 'message-1',
            activeRunId: 'run-1',
            createdAt: updatedAt,
            updatedAt,
        }],
        conversation: [{
            id: 'message-1',
            sequence: 1,
            ref: 'main',
            parentId: null,
            timestamp: updatedAt,
            runId: 'run-1',
            kind: 'message',
            role: 'user',
            content: 'Active message',
        }],
        activePaths: { main: ['message-1'] },
        runs: [{
            id: 'run-1',
            ref: 'main',
            triggerMessageId: 'message-1',
            status: 'running',
            profileId: 'profile-1',
            mode: 'ask',
            allowedTools: ['browser.inspect'],
            maxSteps: 24,
            stepCount: 1,
            createdAt: updatedAt,
            updatedAt,
            resumeCount: 0,
        }],
        steps: [{
            id: 'step-1',
            runId: 'run-1',
            index: 0,
            status: 'running',
            createdAt: updatedAt,
            updatedAt,
        }],
        generations: [],
        invocations: [{
            id: 'invocation-1',
            runId: 'run-1',
            stepId: 'step-1',
            callId: 'call-1',
            toolId: 'browser.inspect',
            execution: 'browser',
            arguments: {},
            status: 'claimed',
            createdAt: updatedAt,
            updatedAt,
            claimId: 'claim-secret',
            idempotencyKey: 'idempotency-secret',
        }],
        approvals: [],
        pendingMessages: [],
    };
}

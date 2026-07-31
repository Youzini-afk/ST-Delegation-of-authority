import type {
    AuthorityHostCommitEvent,
    AuthorityHostTransactionContext,
    SqlExecRequest,
    SqlQueryRequest,
    SqlTransactionRequest,
} from '@stdo/shared-types';
import { describe, expect, it, vi } from 'vitest';
import type { UserContext } from '../types.js';
import { LockService } from './lock-service.js';
import type { CoreService } from './core-service.js';
import { HostEventLedgerService } from './host-event-ledger-service.js';

const user: UserContext = {
    handle: 'tester',
    isAdmin: false,
    rootDir: 'C:/authority-test-user',
};

describe('HostEventLedgerService', () => {
    it('records, replays, and enriches one immutable host event', async () => {
        const fixture = createFixture();
        const first = await fixture.service.recordCommit(user, commit(0), 'extension:a');
        expect(first.replayed).toBe(false);
        expect(first.event.continuity).toBe('contiguous');
        expect(first.conversation.revision).toBe(1);

        const replay = await fixture.service.recordCommit(user, {
            ...commit(0),
            sourceEventIds: ['host-event:one'],
            changes: [{ kind: 'message-inserted', messageUid: 'message:one', index: 0 }],
        }, 'extension:b');
        expect(replay.replayed).toBe(true);
        expect(replay.event.continuity).toBe('replay');
        expect(replay.event.sourceEventIds).toEqual(['host-event:one']);
        expect(replay.event.changes?.[0]?.messageUid).toBe('message:one');

        await expect(fixture.service.recordCommit(user, {
            ...commit(0),
            operation: 'chat.messages.delete',
        }, 'extension:a')).rejects.toMatchObject({
            status: 409,
            details: expect.objectContaining({ code: 'host_event_conflict' }),
        });
    });

    it('accepts recovered gaps and late historical receipts without moving the head backwards', async () => {
        const fixture = createFixture();
        const recovered = await fixture.service.recordCommit(user, commit(6), 'extension:a');
        expect(recovered.event.continuity).toBe('gap');
        expect(recovered.conversation.revision).toBe(7);

        const late = await fixture.service.recordCommit(user, commit(4), 'extension:a');
        expect(late.event.continuity).toBe('late');
        expect(late.conversation.revision).toBe(7);

        const next = await fixture.service.recordCommit(user, commit(7), 'extension:a');
        expect(next.event.continuity).toBe('contiguous');
        expect(next.conversation.revision).toBe(8);
        expect(next.conversation.gapCount).toBe(1);
    });

    it('reconciles the latest commit before fencing a module event context', async () => {
        const fixture = createFixture();
        const context: AuthorityHostTransactionContext = {
            schemaVersion: 1,
            phase: 'event',
            conversationId: 'conversation:one',
            branchId: 'branch:one',
            hostRevision: 1,
            baseHostRevision: 1,
            commitEventId: 'event:1',
            commitTransactionId: 'transaction:1',
            commitCommittedAt: '2026-08-01T00:00:01.000Z',
            commitOperation: 'chat.save',
            sourceEventId: 'host-event:active',
            operation: 'host.event.message_received',
            capturedAt: '2026-08-01T00:00:02.000Z',
        };

        const bound = await fixture.service.bindModuleContext(user, context, 'extension:a');
        expect(bound).toEqual(context);
        expect((await fixture.service.getConversation(user, context.conversationId))?.revision).toBe(1);

        await expect(fixture.service.bindModuleContext(user, {
            ...context,
            commitEventId: undefined,
            commitTransactionId: undefined,
            commitCommittedAt: undefined,
            commitOperation: undefined,
            hostRevision: 0,
            baseHostRevision: 0,
        }, 'extension:a')).rejects.toMatchObject({
            status: 409,
            details: expect.objectContaining({ code: 'host_context_stale', currentRevision: 1 }),
        });
    });

    it('rejects two branch identities under one conversation id', async () => {
        const fixture = createFixture();
        await fixture.service.recordCommit(user, commit(0), 'extension:a');
        await expect(fixture.service.recordCommit(user, {
            ...commit(1),
            branchId: 'branch:other',
        }, 'extension:a')).rejects.toMatchObject({
            status: 409,
            details: expect.objectContaining({ code: 'host_event_conflict' }),
        });
    });
});

function commit(baseRevision: number): AuthorityHostCommitEvent {
    const revision = baseRevision + 1;
    return {
        schemaVersion: 1,
        eventId: `event:${revision}`,
        transactionId: `transaction:${revision}`,
        conversationId: 'conversation:one',
        branchId: 'branch:one',
        baseRevision,
        revision,
        operation: 'chat.save',
        committedAt: `2026-08-01T00:00:${String(revision).padStart(2, '0')}.000Z`,
    };
}

function createFixture() {
    const events = new Map<string, Record<string, any>>();
    const conversations = new Map<string, Record<string, any>>();
    const core = {
        migrateSql: vi.fn(async () => ({ tableName: '_authority_host_migrations', applied: [], skipped: [], latestId: null })),
        querySql: vi.fn(async (_dbPath: string, request: SqlQueryRequest) => {
            const statement = request.statement;
            let rows: Record<string, any>[] = [];
            if (statement.includes('FROM authority_host_events WHERE event_id')) {
                const row = events.get(String(request.params?.[0]));
                rows = row ? [structuredClone(row)] : [];
            } else if (statement.includes('WHERE transaction_id =')) {
                const row = [...events.values()].find(row => row.transaction_id === request.params?.[0]);
                rows = row ? [structuredClone(row)] : [];
            } else if (statement.includes('WHERE conversation_id = ? AND revision = ?')) {
                const row = [...events.values()].find(row => row.conversation_id === request.params?.[0] && row.revision === request.params?.[1]);
                rows = row ? [structuredClone(row)] : [];
            } else if (statement.includes('FROM authority_host_conversations WHERE conversation_id')) {
                const row = conversations.get(String(request.params?.[0]));
                rows = row ? [structuredClone(row)] : [];
            } else if (statement.includes('FROM authority_host_events') && statement.includes('revision >')) {
                const conversationId = String(request.params?.[0]);
                const afterRevision = Number(request.params?.[1]);
                const limit = Number(request.params?.[2]);
                rows = [...events.values()]
                    .filter(row => row.conversation_id === conversationId && row.revision > afterRevision)
                    .sort((left, right) => left.revision - right.revision)
                    .slice(0, limit)
                    .map(row => structuredClone(row));
            }
            return { kind: 'query' as const, columns: [], rows, rowCount: rows.length };
        }),
        execSql: vi.fn(async (_dbPath: string, request: SqlExecRequest) => {
            if (request.statement.startsWith('UPDATE authority_host_events')) {
                const row = events.get(String(request.params?.[1]));
                if (row) row.payload_json = request.params?.[0];
            }
            return { kind: 'exec' as const, rowsAffected: 1, lastInsertRowid: null };
        }),
        transactionSql: vi.fn(async (_dbPath: string, request: SqlTransactionRequest) => {
            for (const item of request.statements) {
                if (item.statement.includes('INSERT INTO authority_host_events')) {
                    const values = item.params ?? [];
                    events.set(String(values[0]), {
                        event_id: values[0],
                        transaction_id: values[1],
                        conversation_id: values[2],
                        branch_id: values[3],
                        base_revision: values[4],
                        revision: values[5],
                        operation: values[6],
                        payload_json: values[7],
                        fingerprint: values[8],
                        caller_extension_id: values[9],
                        continuity: values[10],
                        committed_at: values[11],
                        recorded_at: values[12],
                    });
                }
                if (item.statement.includes('INSERT INTO authority_host_conversations')) {
                    const values = item.params ?? [];
                    conversations.set(String(values[0]), {
                        conversation_id: values[0],
                        branch_id: values[1],
                        revision: values[2],
                        last_event_id: values[3],
                        last_transaction_id: values[4],
                        gap_count: values[5],
                        updated_at: values[6],
                    });
                }
            }
            return { committed: true, results: [] };
        }),
    } as unknown as CoreService;
    return {
        service: new HostEventLedgerService(core, new LockService()),
        events,
        conversations,
    };
}

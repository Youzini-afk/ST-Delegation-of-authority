import crypto from 'node:crypto';
import type {
    AuthorityHostChange,
    AuthorityHostCommitEvent,
    AuthorityHostCommitResponse,
    AuthorityHostConversationState,
    AuthorityHostEventListRequest,
    AuthorityHostEventListResponse,
    AuthorityHostEventRecord,
    AuthorityHostTransactionContext,
    SqlValue,
} from '@stdo/shared-types';
import { AUTHORITY_SDK_EXTENSION_ID } from '../constants.js';
import { resolvePrivateSqlDatabasePath } from '../store/authority-paths.js';
import type { UserContext } from '../types.js';
import { AuthorityServiceError, nowIso } from '../utils.js';
import type { CoreService } from './core-service.js';
import type { LockService } from './lock-service.js';

const HOST_LEDGER_DATABASE = 'host-events';
const HOST_LEDGER_MIGRATIONS = '_authority_host_migrations';
const HOST_EVENTS_TABLE = 'authority_host_events';
const HOST_CONVERSATIONS_TABLE = 'authority_host_conversations';
const IDENTIFIER_MAX_LENGTH = 512;
const OPERATION_MAX_LENGTH = 256;
const LIST_DEFAULT_LIMIT = 200;
const LIST_MAX_LIMIT = 2_000;

interface HostEventRow {
    event_id: SqlValue;
    transaction_id: SqlValue;
    conversation_id: SqlValue;
    branch_id: SqlValue;
    base_revision: SqlValue;
    revision: SqlValue;
    operation: SqlValue;
    payload_json: SqlValue;
    fingerprint: SqlValue;
    caller_extension_id: SqlValue;
    continuity: SqlValue;
    committed_at: SqlValue;
    recorded_at: SqlValue;
}

interface HostConversationRow {
    conversation_id: SqlValue;
    branch_id: SqlValue;
    revision: SqlValue;
    last_event_id: SqlValue;
    last_transaction_id: SqlValue;
    gap_count: SqlValue;
    updated_at: SqlValue;
}

/**
 * Per-user append-only ledger of authoritative SillyTavern chat commits.
 * Domain extensions only receive normalized host context; they never own
 * this database or the host revision state machine.
 */
export class HostEventLedgerService {
    private readonly schemaPromises = new Map<string, Promise<void>>();

    constructor(
        private readonly core: CoreService,
        private readonly locks: LockService,
    ) {}

    async recordCommit(
        user: UserContext,
        input: unknown,
        callerExtensionId: string,
    ): Promise<AuthorityHostCommitResponse> {
        const event = normalizeHostCommitEvent(input);
        const caller = normalizeIdentifier(callerExtensionId, 'callerExtensionId');
        const dbPath = this.databasePath(user);
        await this.ensureSchema(dbPath);

        return await this.locks.withLock(
            `host-event-ledger:${user.handle}:${event.conversationId}`,
            { timeoutMs: 30_000 },
            async () => {
                const fingerprint = fingerprintEvent(event);
                const existing = await this.getEventRow(dbPath, event.eventId);
                if (existing) {
                    if (String(existing.fingerprint) !== fingerprint) {
                        throw hostConflict('Host event id was reused with a different payload.', {
                            eventId: event.eventId,
                            conversationId: event.conversationId,
                        });
                    }
                    const existingEvent = normalizeHostCommitEvent(eventFromRow(existing));
                    const mergedEvent = mergeCommitEvents(existingEvent, event);
                    if (JSON.stringify(sortJson(mergedEvent)) !== JSON.stringify(sortJson(existingEvent))) {
                        await this.core.execSql(dbPath, {
                            statement: `UPDATE ${HOST_EVENTS_TABLE} SET payload_json = ? WHERE event_id = ?`,
                            params: [JSON.stringify(mergedEvent), event.eventId],
                        });
                    }
                    const conversation = await this.getConversationByPath(dbPath, event.conversationId);
                    if (!conversation) {
                        throw new AuthorityServiceError(
                            'Host event exists without its conversation head.',
                            500,
                            'core_request_failed',
                            'core',
                            { code: 'host_ledger_inconsistent', eventId: event.eventId },
                        );
                    }
                    return {
                        ok: true,
                        replayed: true,
                        event: {
                            ...mergedEvent,
                            callerExtensionId: String(existing.caller_extension_id),
                            continuity: 'replay',
                            recordedAt: String(existing.recorded_at),
                        },
                        conversation,
                    };
                }

                const transactionEvent = await this.getEventRowByTransaction(dbPath, event.transactionId);
                if (transactionEvent && String(transactionEvent.event_id) !== event.eventId) {
                    throw hostConflict('Host transaction id was reused by a different event.', {
                        transactionId: event.transactionId,
                        expectedEventId: String(transactionEvent.event_id),
                        actualEventId: event.eventId,
                    });
                }
                const revisionEvent = await this.getEventRowByRevision(dbPath, event.conversationId, event.revision);
                if (revisionEvent && String(revisionEvent.event_id) !== event.eventId) {
                    throw hostConflict('A different event is already recorded for this conversation revision.', {
                        conversationId: event.conversationId,
                        revision: event.revision,
                        expectedEventId: String(revisionEvent.event_id),
                        actualEventId: event.eventId,
                    });
                }

                const current = await this.getConversationByPath(dbPath, event.conversationId);
                const continuity = classifyContinuity(current, event);
                const recordedAt = nowIso();
                const record: AuthorityHostEventRecord = {
                    ...event,
                    callerExtensionId: caller,
                    continuity,
                    recordedAt,
                };
                const advancesHead = !current || event.revision > current.revision;
                const nextGapCount = (current?.gapCount ?? 0) + (continuity === 'gap' ? 1 : 0);

                const statements = [{
                    mode: 'exec' as const,
                    statement: `INSERT INTO ${HOST_EVENTS_TABLE} (
                        event_id, transaction_id, conversation_id, branch_id,
                        base_revision, revision, operation, payload_json, fingerprint,
                        caller_extension_id, continuity, committed_at, recorded_at
                    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
                    params: [
                        event.eventId,
                        event.transactionId,
                        event.conversationId,
                        event.branchId,
                        event.baseRevision,
                        event.revision,
                        event.operation,
                        JSON.stringify(event),
                        fingerprint,
                        caller,
                        continuity,
                        event.committedAt,
                        recordedAt,
                    ],
                }];

                if (advancesHead) {
                    statements.push({
                        mode: 'exec' as const,
                        statement: `INSERT INTO ${HOST_CONVERSATIONS_TABLE} (
                            conversation_id, branch_id, revision, last_event_id,
                            last_transaction_id, gap_count, updated_at
                        ) VALUES (?, ?, ?, ?, ?, ?, ?)
                        ON CONFLICT(conversation_id) DO UPDATE SET
                            branch_id = excluded.branch_id,
                            revision = excluded.revision,
                            last_event_id = excluded.last_event_id,
                            last_transaction_id = excluded.last_transaction_id,
                            gap_count = excluded.gap_count,
                            updated_at = excluded.updated_at`,
                        params: [
                            event.conversationId,
                            event.branchId,
                            event.revision,
                            event.eventId,
                            event.transactionId,
                            nextGapCount,
                            recordedAt,
                        ],
                    });
                }

                await this.core.transactionSql(dbPath, { statements });
                const conversation = advancesHead
                    ? {
                        conversationId: event.conversationId,
                        branchId: event.branchId,
                        revision: event.revision,
                        lastEventId: event.eventId,
                        lastTransactionId: event.transactionId,
                        gapCount: nextGapCount,
                        updatedAt: recordedAt,
                    }
                    : current!;
                return { ok: true, replayed: false, event: record, conversation };
            },
        );
    }

    async bindModuleContext(user: UserContext, input: unknown, callerExtensionId: string): Promise<AuthorityHostTransactionContext> {
        const context = normalizeHostTransactionContext(input);

        if (context.commitEventId && context.hostRevision > 0) {
            await this.recordCommit(user, commitFromContext(context), callerExtensionId);
        }

        const current = await this.getConversation(user, context.conversationId);
        if (!current) {
            return context;
        }
        if (current.branchId !== context.branchId || current.revision !== context.hostRevision) {
            throw staleContext(context, current);
        }
        return context;
    }

    async getConversation(user: UserContext, conversationId: string): Promise<AuthorityHostConversationState | null> {
        const id = normalizeIdentifier(conversationId, 'conversationId');
        const dbPath = this.databasePath(user);
        await this.ensureSchema(dbPath);
        return await this.getConversationByPath(dbPath, id);
    }

    async getEvent(user: UserContext, eventId: string): Promise<AuthorityHostEventRecord | null> {
        const id = normalizeIdentifier(eventId, 'eventId');
        const dbPath = this.databasePath(user);
        await this.ensureSchema(dbPath);
        const row = await this.getEventRow(dbPath, id);
        return row ? eventFromRow(row) : null;
    }

    async listEvents(user: UserContext, input: AuthorityHostEventListRequest): Promise<AuthorityHostEventListResponse> {
        const conversationId = normalizeIdentifier(input?.conversationId, 'conversationId');
        const afterRevision = normalizeOptionalRevision(input?.afterRevision, 'afterRevision') ?? -1;
        const requestedLimit = input?.limit ?? LIST_DEFAULT_LIMIT;
        if (!Number.isSafeInteger(requestedLimit) || requestedLimit < 1 || requestedLimit > LIST_MAX_LIMIT) {
            throw validationError(`Host event list limit must be between 1 and ${LIST_MAX_LIMIT}.`);
        }
        const dbPath = this.databasePath(user);
        await this.ensureSchema(dbPath);
        const result = await this.core.querySql(dbPath, {
            statement: `SELECT * FROM ${HOST_EVENTS_TABLE}
                WHERE conversation_id = ? AND revision > ?
                ORDER BY revision ASC, recorded_at ASC
                LIMIT ?`,
            params: [conversationId, afterRevision, requestedLimit],
        });
        return {
            events: result.rows.map(row => eventFromRow(row as unknown as HostEventRow)),
            conversation: await this.getConversationByPath(dbPath, conversationId),
        };
    }

    private databasePath(user: UserContext): string {
        return resolvePrivateSqlDatabasePath(user, AUTHORITY_SDK_EXTENSION_ID, HOST_LEDGER_DATABASE);
    }

    private async ensureSchema(dbPath: string): Promise<void> {
        let pending = this.schemaPromises.get(dbPath);
        if (!pending) {
            pending = this.core.migrateSql(dbPath, {
                tableName: HOST_LEDGER_MIGRATIONS,
                migrations: [
                    {
                        id: '001_host_events',
                        statement: `CREATE TABLE IF NOT EXISTS ${HOST_EVENTS_TABLE} (
                            event_id TEXT PRIMARY KEY,
                            transaction_id TEXT NOT NULL UNIQUE,
                            conversation_id TEXT NOT NULL,
                            branch_id TEXT NOT NULL,
                            base_revision INTEGER NOT NULL,
                            revision INTEGER NOT NULL,
                            operation TEXT NOT NULL,
                            payload_json TEXT NOT NULL,
                            fingerprint TEXT NOT NULL,
                            caller_extension_id TEXT NOT NULL,
                            continuity TEXT NOT NULL,
                            committed_at TEXT NOT NULL,
                            recorded_at TEXT NOT NULL,
                            UNIQUE (conversation_id, revision)
                        )`,
                    },
                    {
                        id: '002_host_conversations',
                        statement: `CREATE TABLE IF NOT EXISTS ${HOST_CONVERSATIONS_TABLE} (
                            conversation_id TEXT PRIMARY KEY,
                            branch_id TEXT NOT NULL,
                            revision INTEGER NOT NULL,
                            last_event_id TEXT NOT NULL,
                            last_transaction_id TEXT NOT NULL,
                            gap_count INTEGER NOT NULL DEFAULT 0,
                            updated_at TEXT NOT NULL
                        )`,
                    },
                    {
                        id: '003_host_event_order',
                        statement: `CREATE INDEX IF NOT EXISTS authority_host_events_by_conversation
                            ON ${HOST_EVENTS_TABLE} (conversation_id, revision, recorded_at)`,
                    },
                ],
            }).then(() => undefined).catch(error => {
                this.schemaPromises.delete(dbPath);
                throw error;
            });
            this.schemaPromises.set(dbPath, pending);
        }
        await pending;
    }

    private async getEventRow(dbPath: string, eventId: string): Promise<HostEventRow | null> {
        const result = await this.core.querySql(dbPath, {
            statement: `SELECT * FROM ${HOST_EVENTS_TABLE} WHERE event_id = ? ORDER BY event_id LIMIT 1`,
            params: [eventId],
        });
        return (result.rows[0] as HostEventRow | undefined) ?? null;
    }

    private async getEventRowByTransaction(dbPath: string, transactionId: string): Promise<HostEventRow | null> {
        const result = await this.core.querySql(dbPath, {
            statement: `SELECT * FROM ${HOST_EVENTS_TABLE} WHERE transaction_id = ? ORDER BY transaction_id LIMIT 1`,
            params: [transactionId],
        });
        return (result.rows[0] as unknown as HostEventRow | undefined) ?? null;
    }

    private async getEventRowByRevision(dbPath: string, conversationId: string, revision: number): Promise<HostEventRow | null> {
        const result = await this.core.querySql(dbPath, {
            statement: `SELECT * FROM ${HOST_EVENTS_TABLE}
                WHERE conversation_id = ? AND revision = ?
                ORDER BY conversation_id, revision LIMIT 1`,
            params: [conversationId, revision],
        });
        return (result.rows[0] as unknown as HostEventRow | undefined) ?? null;
    }

    private async getConversationByPath(dbPath: string, conversationId: string): Promise<AuthorityHostConversationState | null> {
        const result = await this.core.querySql(dbPath, {
            statement: `SELECT * FROM ${HOST_CONVERSATIONS_TABLE} WHERE conversation_id = ? ORDER BY conversation_id LIMIT 1`,
            params: [conversationId],
        });
        const row = result.rows[0] as HostConversationRow | undefined;
        return row ? conversationFromRow(row) : null;
    }
}

export function normalizeHostTransactionContext(input: unknown): AuthorityHostTransactionContext {
    const value = objectRecord(input, 'host context');
    if (value.schemaVersion !== 1) throw validationError('Host context schemaVersion must be 1.');
    if (value.phase !== 'snapshot' && value.phase !== 'event' && value.phase !== 'committed') {
        throw validationError('Host context phase is invalid.');
    }
    const hostRevision = normalizeRevision(value.hostRevision, 'hostRevision');
    const baseHostRevision = normalizeRevision(value.baseHostRevision, 'baseHostRevision');
    if (baseHostRevision > hostRevision) {
        throw validationError('baseHostRevision cannot exceed hostRevision.');
    }
    if (value.phase === 'committed' && hostRevision !== baseHostRevision + 1) {
        throw validationError('Committed host context must advance exactly one revision.');
    }
    return {
        schemaVersion: 1,
        phase: value.phase,
        conversationId: normalizeIdentifier(value.conversationId, 'conversationId'),
        branchId: normalizeIdentifier(value.branchId, 'branchId'),
        hostRevision,
        baseHostRevision,
        ...optionalIdentifier(value, 'commitEventId'),
        ...optionalIdentifier(value, 'commitTransactionId'),
        ...optionalTimestamp(value, 'commitCommittedAt'),
        ...optionalNamedOperation(value, 'commitOperation'),
        ...optionalIdentifier(value, 'sourceEventId'),
        ...optionalIdentifierArray(value, 'sourceEventIds'),
        ...optionalIdentifier(value, 'rootEventId'),
        ...optionalIdentifier(value, 'correlationId'),
        ...optionalNullableIdentifier(value, 'causationId'),
        ...optionalOperation(value.operation),
        ...optionalIdentifierArray(value, 'originExtensionIds'),
        ...optionalNullableIdentifier(value, 'messageUid'),
        ...optionalNullableIdentifier(value, 'swipeUid'),
        capturedAt: normalizeTimestamp(value.capturedAt, 'capturedAt'),
    } as AuthorityHostTransactionContext;
}

export function normalizeHostCommitEvent(input: unknown): AuthorityHostCommitEvent {
    const value = objectRecord(input, 'host commit event');
    if (value.schemaVersion !== 1) throw validationError('Host commit schemaVersion must be 1.');
    const baseRevision = normalizeRevision(value.baseRevision, 'baseRevision');
    const revision = normalizeRevision(value.revision, 'revision');
    if (revision !== baseRevision + 1) {
        throw validationError('Host commit revision must advance exactly one revision.');
    }
    return {
        schemaVersion: 1,
        eventId: normalizeIdentifier(value.eventId, 'eventId'),
        transactionId: normalizeIdentifier(value.transactionId, 'transactionId'),
        conversationId: normalizeIdentifier(value.conversationId, 'conversationId'),
        branchId: normalizeIdentifier(value.branchId, 'branchId'),
        baseRevision,
        revision,
        operation: normalizeOperation(value.operation),
        ...optionalIdentifierArray(value, 'rootEventIds'),
        ...optionalIdentifier(value, 'correlationId'),
        ...optionalNullableIdentifier(value, 'causationId'),
        ...optionalIdentifierArray(value, 'originExtensionIds'),
        ...optionalIdentifierArray(value, 'sourceEventIds'),
        ...(value.changes === undefined ? {} : { changes: normalizeChanges(value.changes) }),
        committedAt: normalizeTimestamp(value.committedAt, 'committedAt'),
    };
}

function classifyContinuity(current: AuthorityHostConversationState | null, event: AuthorityHostCommitEvent) {
    if (!current) return event.baseRevision === 0 ? 'contiguous' as const : 'gap' as const;
    if (current.branchId !== event.branchId) {
        throw hostConflict('Host conversation branch changed without a new conversation identity.', {
            conversationId: event.conversationId,
            expectedBranchId: current.branchId,
            actualBranchId: event.branchId,
        });
    }
    if (event.revision === current.revision && event.eventId !== current.lastEventId) {
        throw hostConflict('Two different host events claim the same conversation revision.', {
            conversationId: event.conversationId,
            revision: event.revision,
            expectedEventId: current.lastEventId,
            actualEventId: event.eventId,
        });
    }
    if (event.revision <= current.revision) return 'late' as const;
    return event.baseRevision === current.revision && event.revision === current.revision + 1
        ? 'contiguous' as const
        : 'gap' as const;
}

function commitFromContext(context: AuthorityHostTransactionContext): AuthorityHostCommitEvent {
    const baseRevision = context.phase === 'committed'
        ? context.baseHostRevision
        : Math.max(0, context.hostRevision - 1);
    return {
        schemaVersion: 1,
        eventId: context.commitEventId!,
        transactionId: context.commitTransactionId ?? `reconciled:${context.commitEventId}`,
        conversationId: context.conversationId,
        branchId: context.branchId,
        baseRevision,
        revision: context.hostRevision,
        operation: context.commitOperation ?? (context.phase === 'committed' ? context.operation : undefined) ?? 'chat.save',
        ...(context.rootEventId ? { rootEventIds: [context.rootEventId] } : {}),
        ...(context.correlationId ? { correlationId: context.correlationId } : {}),
        ...(context.causationId !== undefined ? { causationId: context.causationId } : {}),
        ...(context.originExtensionIds ? { originExtensionIds: context.originExtensionIds } : {}),
        ...(context.sourceEventIds ? { sourceEventIds: context.sourceEventIds } : {}),
        committedAt: context.commitCommittedAt ?? context.capturedAt,
    };
}

function staleContext(context: AuthorityHostTransactionContext, current: AuthorityHostConversationState | null): AuthorityServiceError {
    return new AuthorityServiceError(
        'Module transaction host context is stale or belongs to another branch.',
        409,
        'workspace_conflict',
        'concurrency',
        {
            code: 'host_context_stale',
            conversationId: context.conversationId,
            branchId: context.branchId,
            hostRevision: context.hostRevision,
            currentBranchId: current?.branchId ?? null,
            currentRevision: current?.revision ?? null,
        },
    );
}

function conversationFromRow(row: HostConversationRow): AuthorityHostConversationState {
    return {
        conversationId: String(row.conversation_id),
        branchId: String(row.branch_id),
        revision: Number(row.revision),
        lastEventId: String(row.last_event_id),
        lastTransactionId: String(row.last_transaction_id),
        gapCount: Number(row.gap_count),
        updatedAt: String(row.updated_at),
    };
}

function eventFromRow(row: HostEventRow): AuthorityHostEventRecord {
    const event = normalizeHostCommitEvent(JSON.parse(String(row.payload_json)));
    return {
        ...event,
        callerExtensionId: String(row.caller_extension_id),
        continuity: String(row.continuity) as AuthorityHostEventRecord['continuity'],
        recordedAt: String(row.recorded_at),
    };
}

function fingerprintEvent(event: AuthorityHostCommitEvent): string {
    return crypto.createHash('sha256').update(JSON.stringify(sortJson({
        schemaVersion: event.schemaVersion,
        eventId: event.eventId,
        transactionId: event.transactionId,
        conversationId: event.conversationId,
        branchId: event.branchId,
        baseRevision: event.baseRevision,
        revision: event.revision,
        operation: event.operation,
        committedAt: event.committedAt,
    }))).digest('hex');
}

function mergeCommitEvents(existing: AuthorityHostCommitEvent, incoming: AuthorityHostCommitEvent): AuthorityHostCommitEvent {
    return {
        ...existing,
        ...incoming,
        ...mergeArrayField('rootEventIds', existing.rootEventIds, incoming.rootEventIds),
        ...mergeArrayField('originExtensionIds', existing.originExtensionIds, incoming.originExtensionIds),
        ...mergeArrayField('sourceEventIds', existing.sourceEventIds, incoming.sourceEventIds),
        ...(incoming.changes?.length
            ? { changes: incoming.changes }
            : existing.changes?.length
                ? { changes: existing.changes }
                : {}),
    };
}

function mergeArrayField<Key extends 'rootEventIds' | 'originExtensionIds' | 'sourceEventIds'>(
    key: Key,
    existing: string[] | undefined,
    incoming: string[] | undefined,
): Partial<Pick<AuthorityHostCommitEvent, Key>> {
    const merged = [...new Set([...(existing ?? []), ...(incoming ?? [])])];
    return merged.length > 0 ? { [key]: merged } as Pick<AuthorityHostCommitEvent, Key> : {};
}

function sortJson(value: unknown): unknown {
    if (Array.isArray(value)) return value.map(sortJson);
    if (!value || typeof value !== 'object') return value;
    return Object.fromEntries(Object.keys(value as Record<string, unknown>)
        .sort()
        .map(key => [key, sortJson((value as Record<string, unknown>)[key])]));
}

function normalizeChanges(value: unknown): AuthorityHostChange[] {
    if (!Array.isArray(value)) throw validationError('Host commit changes must be an array.');
    return value.map((item, index) => {
        const change = objectRecord(item, `changes[${index}]`);
        return {
            kind: normalizeOperation(change.kind),
            ...optionalNullableIdentifier(change, 'messageUid'),
            ...optionalNullableIdentifier(change, 'swipeUid'),
            ...optionalIndex(change, 'index'),
            ...optionalIndex(change, 'previousIndex'),
        };
    });
}

function optionalIndex(value: Record<string, unknown>, key: string): Record<string, number> {
    if (value[key] === undefined) return {};
    const index = Number(value[key]);
    if (!Number.isSafeInteger(index) || index < 0) throw validationError(`${key} must be a non-negative safe integer.`);
    return { [key]: index };
}

function normalizeRevision(value: unknown, label: string): number {
    const revision = Number(value);
    if (!Number.isSafeInteger(revision) || revision < 0) throw validationError(`${label} must be a non-negative safe integer.`);
    return revision;
}

function normalizeOptionalRevision(value: unknown, label: string): number | undefined {
    return value === undefined ? undefined : normalizeRevision(value, label);
}

function normalizeIdentifier(value: unknown, label: string): string {
    const normalized = typeof value === 'string' ? value.trim() : '';
    if (!normalized || normalized.length > IDENTIFIER_MAX_LENGTH) {
        throw validationError(`${label} must be a non-empty string up to ${IDENTIFIER_MAX_LENGTH} characters.`);
    }
    return normalized;
}

function optionalIdentifier(value: Record<string, unknown>, key: string): Record<string, string> {
    return value[key] === undefined ? {} : { [key]: normalizeIdentifier(value[key], key) };
}

function optionalNullableIdentifier(value: Record<string, unknown>, key: string): Record<string, string | null> {
    if (value[key] === undefined) return {};
    return { [key]: value[key] === null ? null : normalizeIdentifier(value[key], key) };
}

function optionalIdentifierArray(value: Record<string, unknown>, key: string): Record<string, string[]> {
    if (value[key] === undefined) return {};
    if (!Array.isArray(value[key])) throw validationError(`${key} must be an array.`);
    return { [key]: [...new Set(value[key].map((item, index) => normalizeIdentifier(item, `${key}[${index}]`)))] };
}

function normalizeOperation(value: unknown): string {
    const operation = typeof value === 'string' ? value.trim() : '';
    if (!operation || operation.length > OPERATION_MAX_LENGTH) {
        throw validationError(`operation must be a non-empty string up to ${OPERATION_MAX_LENGTH} characters.`);
    }
    return operation;
}

function optionalOperation(value: unknown): { operation?: string } {
    return value === undefined ? {} : { operation: normalizeOperation(value) };
}

function optionalNamedOperation(value: Record<string, unknown>, key: string): Record<string, string> {
    return value[key] === undefined ? {} : { [key]: normalizeOperation(value[key]) };
}

function optionalTimestamp(value: Record<string, unknown>, key: string): Record<string, string> {
    return value[key] === undefined ? {} : { [key]: normalizeTimestamp(value[key], key) };
}

function normalizeTimestamp(value: unknown, label: string): string {
    const timestamp = normalizeIdentifier(value, label);
    if (!Number.isFinite(Date.parse(timestamp))) throw validationError(`${label} must be an ISO timestamp.`);
    return timestamp;
}

function objectRecord(value: unknown, label: string): Record<string, unknown> {
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw validationError(`${label} must be an object.`);
    return value as Record<string, unknown>;
}

function validationError(message: string): AuthorityServiceError {
    return new AuthorityServiceError(message, 400, 'validation_error', 'validation', { code: 'host_validation_error' });
}

function hostConflict(message: string, details: Record<string, unknown>): AuthorityServiceError {
    return new AuthorityServiceError(message, 409, 'workspace_conflict', 'concurrency', {
        code: 'host_event_conflict',
        ...details,
    });
}

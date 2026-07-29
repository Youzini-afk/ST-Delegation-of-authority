import type {
    AgentSessionEvent,
    AgentSessionListRequest,
    AgentSessionListResponse,
    AgentSessionSnapshot as PublicAgentSessionSnapshot,
    AgentSessionSummary,
    AgentSessionToolInvocation,
} from '@stdo/shared-types';
import type {
    AgentConversationMessageEntry,
    AgentSessionJournalRecord,
    AgentSessionSnapshot,
    AgentSessionToolInvocationState,
} from '../services/agent-session-model.js';

const DEFAULT_PAGE_LIMIT = 50;
const MAX_PAGE_LIMIT = 200;
const MAIN_REF = 'main';

interface SessionCursor {
    version: 1;
    updatedAt: string;
    id: string;
    archived: boolean;
}

/**
 * Converts the internal projection to the stable transport shape. Journal
 * hashes, browser claim secrets and idempotency keys never cross this edge.
 */
export function presentAgentSession(snapshot: AgentSessionSnapshot): PublicAgentSessionSnapshot {
    return {
        session: structuredClone(snapshot.session),
        lastSequence: snapshot.lastSequence,
        refs: structuredClone(snapshot.refs),
        conversation: structuredClone(snapshot.conversation),
        activePaths: structuredClone(snapshot.activePaths),
        runs: structuredClone(snapshot.runs),
        steps: structuredClone(snapshot.steps),
        generations: structuredClone(snapshot.generations),
        invocations: snapshot.invocations.map(presentAgentSessionInvocation),
        approvals: structuredClone(snapshot.approvals),
        pendingMessages: structuredClone(snapshot.pendingMessages),
    };
}

export function presentAgentSessionInvocation(
    invocation: AgentSessionToolInvocationState,
): AgentSessionToolInvocation {
    const {
        claimId: _claimId,
        idempotencyKey: _idempotencyKey,
        ...publicInvocation
    } = invocation;
    return structuredClone(publicInvocation);
}

export function summarizeAgentSession(snapshot: AgentSessionSnapshot): AgentSessionSummary {
    const mainRef = snapshot.refs.find(ref => ref.name === MAIN_REF) ?? snapshot.refs[0];
    const activeRun = mainRef?.activeRunId
        ? snapshot.runs.find(run => run.id === mainRef.activeRunId) ?? null
        : null;
    const activeIds = new Set(snapshot.activePaths[mainRef?.name ?? MAIN_REF] ?? []);
    const activeMessages = snapshot.conversation.filter(
        (entry): entry is AgentConversationMessageEntry => entry.kind === 'message' && activeIds.has(entry.id),
    );
    const lastMessage = [...activeMessages]
        .reverse()
        .find(entry => typeof entry.content === 'string' && entry.content.trim()) ?? null;

    return {
        ...structuredClone(snapshot.session),
        status: activeRun?.status ?? 'idle',
        activeRunId: activeRun?.id ?? null,
        activeRunStatus: activeRun?.status ?? null,
        messageCount: activeMessages.length,
        pendingApprovalCount: snapshot.approvals.filter(approval => approval.status === 'pending').length,
        pendingMessageCount: snapshot.pendingMessages.length,
        lastMessagePreview: lastMessage ? preview(lastMessage.content ?? '', 180) : null,
        lastSequence: snapshot.lastSequence,
    };
}

export function pageAgentSessions(
    snapshots: AgentSessionSnapshot[],
    request: AgentSessionListRequest = {},
): AgentSessionListResponse {
    const rawRequest: unknown = request;
    if (!isObject(rawRequest)) throw new Error('Agent session list request must be an object');
    const archivedValue = rawRequest.archived;
    if (archivedValue !== undefined && typeof archivedValue !== 'boolean') {
        throw new Error('Agent session archived filter must be boolean');
    }
    const pageValue = rawRequest.page;
    if (pageValue !== undefined && !isObject(pageValue)) {
        throw new Error('Agent session page must be an object');
    }
    const page = pageValue as Record<string, unknown> | undefined;
    const cursorValue = page?.cursor;
    if (cursorValue !== undefined && (typeof cursorValue !== 'string' || !cursorValue)) {
        throw new Error('Invalid Agent session cursor');
    }
    const limitValue = page?.limit ?? DEFAULT_PAGE_LIMIT;
    if (typeof limitValue !== 'number'
        || !Number.isSafeInteger(limitValue)
        || limitValue < 1
        || limitValue > MAX_PAGE_LIMIT) {
        throw new Error(`Agent session page limit must be an integer between 1 and ${MAX_PAGE_LIMIT}`);
    }
    const limit = limitValue;
    const archived = archivedValue ?? false;
    const cursor = typeof cursorValue === 'string' ? decodeCursor(cursorValue) : null;
    if (cursor && cursor.archived !== archived) {
        throw new Error('Agent session cursor does not match the requested archive scope');
    }

    const summaries = snapshots
        .filter(snapshot => Boolean(snapshot.session.archivedAt) === archived)
        .map(summarizeAgentSession)
        .sort(compareNewestFirst);
    const afterCursor = cursor
        ? summaries.filter(summary => compareToCursor(summary, cursor) > 0)
        : summaries;
    const sessions = afterCursor.slice(0, limit);
    const hasMore = afterCursor.length > sessions.length;

    return {
        sessions,
        page: {
            nextCursor: hasMore && sessions.length > 0
                ? encodeCursor(sessions.at(-1)!, archived)
                : null,
            limit,
            hasMore,
            totalCount: summaries.length,
        },
    };
}

export function presentAgentSessionEvent(
    sessionId: string,
    record: AgentSessionJournalRecord,
): AgentSessionEvent {
    return {
        sessionId,
        sequence: record.sequence,
        type: record.entry.type,
        timestamp: record.entry.timestamp,
    };
}

function compareNewestFirst(left: AgentSessionSummary, right: AgentSessionSummary): number {
    if (left.updatedAt !== right.updatedAt) return left.updatedAt > right.updatedAt ? -1 : 1;
    if (left.id !== right.id) return left.id > right.id ? -1 : 1;
    return 0;
}

function compareToCursor(summary: AgentSessionSummary, cursor: SessionCursor): number {
    if (summary.updatedAt !== cursor.updatedAt) return summary.updatedAt < cursor.updatedAt ? 1 : -1;
    if (summary.id !== cursor.id) return summary.id < cursor.id ? 1 : -1;
    return 0;
}

function encodeCursor(summary: AgentSessionSummary, archived: boolean): string {
    const cursor: SessionCursor = {
        version: 1,
        updatedAt: summary.updatedAt,
        id: summary.id,
        archived,
    };
    return Buffer.from(JSON.stringify(cursor), 'utf8').toString('base64url');
}

function decodeCursor(value: string): SessionCursor {
    try {
        const parsed = JSON.parse(Buffer.from(value, 'base64url').toString('utf8')) as Partial<SessionCursor>;
        if (parsed.version !== 1
            || typeof parsed.updatedAt !== 'string'
            || !parsed.updatedAt
            || typeof parsed.id !== 'string'
            || !parsed.id
            || typeof parsed.archived !== 'boolean') {
            throw new Error();
        }
        return parsed as SessionCursor;
    } catch {
        throw new Error('Invalid Agent session cursor');
    }
}

function preview(value: string, maxLength: number): string {
    const normalized = value.replace(/\s+/g, ' ').trim();
    return normalized.length <= maxLength ? normalized : `${normalized.slice(0, maxLength - 1)}…`;
}

function isObject(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
}

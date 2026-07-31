/** Versioned SillyTavern host transaction contracts shared by the bridge, SDK and server. */

export type AuthorityHostContextPhase = 'snapshot' | 'event' | 'committed';

export interface AuthorityHostChange {
    kind: string;
    messageUid?: string | null;
    swipeUid?: string | null;
    index?: number;
    previousIndex?: number;
}

/**
 * Compact host context attached to a module transaction.
 *
 * `hostRevision` is always the latest durable ST revision observed by the
 * caller. During an in-flight host event it equals `baseHostRevision`; after
 * a committed save it is the newly committed revision.
 */
export interface AuthorityHostTransactionContext {
    schemaVersion: 1;
    phase: AuthorityHostContextPhase;
    conversationId: string;
    branchId: string;
    hostRevision: number;
    baseHostRevision: number;
    commitEventId?: string;
    commitTransactionId?: string;
    commitCommittedAt?: string;
    commitOperation?: string;
    sourceEventId?: string;
    sourceEventIds?: string[];
    rootEventId?: string;
    correlationId?: string;
    causationId?: string | null;
    operation?: string;
    originExtensionIds?: string[];
    messageUid?: string | null;
    swipeUid?: string | null;
    capturedAt: string;
}

/** Durable receipt emitted after SillyTavern has written a chat revision. */
export interface AuthorityHostCommitEvent {
    schemaVersion: 1;
    eventId: string;
    transactionId: string;
    conversationId: string;
    branchId: string;
    baseRevision: number;
    revision: number;
    operation: string;
    rootEventIds?: string[];
    correlationId?: string;
    causationId?: string | null;
    originExtensionIds?: string[];
    sourceEventIds?: string[];
    changes?: AuthorityHostChange[];
    committedAt: string;
}

export type AuthorityHostEventContinuity = 'contiguous' | 'gap' | 'late' | 'replay';

export interface AuthorityHostEventRecord extends AuthorityHostCommitEvent {
    callerExtensionId: string;
    continuity: AuthorityHostEventContinuity;
    recordedAt: string;
}

export interface AuthorityHostConversationState {
    conversationId: string;
    branchId: string;
    revision: number;
    lastEventId: string;
    lastTransactionId: string;
    gapCount: number;
    updatedAt: string;
}

export interface AuthorityHostCommitResponse {
    ok: true;
    replayed: boolean;
    event: AuthorityHostEventRecord;
    conversation: AuthorityHostConversationState;
}

export interface AuthorityHostEventGetResponse {
    event: AuthorityHostEventRecord | null;
}

export interface AuthorityHostConversationGetResponse {
    conversation: AuthorityHostConversationState | null;
}

export interface AuthorityHostEventListRequest {
    conversationId: string;
    afterRevision?: number;
    limit?: number;
}

export interface AuthorityHostEventListResponse {
    events: AuthorityHostEventRecord[];
    conversation: AuthorityHostConversationState | null;
}

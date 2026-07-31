import type { AuthorityHostChange, AuthorityHostCommitEvent } from '@stdo/shared-types';
import {
    AUTHORITY_EXTENSION_DISPLAY_NAME,
    AUTHORITY_EXTENSION_ID,
    AUTHORITY_EXTENSION_VERSION,
} from './api.js';
import type { AuthorityClient } from './client.js';
import { AuthoritySDK } from './sdk.js';

const pending = new Map<string, AuthorityHostCommitEvent>();
let started = false;
let clientPromise: Promise<AuthorityClient> | null = null;
let drainPromise: Promise<void> | null = null;
let retryTimer: ReturnType<typeof setTimeout> | null = null;
let retryAttempt = 0;

/** Starts the silent browser-to-server host ledger handoff. */
export function bootstrapHostEventRecorder(): void {
    if (started || typeof globalThis.addEventListener !== 'function') return;
    started = true;
    globalThis.addEventListener('authority:chat-committed', receiveCommitEvent as EventListener);
    globalThis.addEventListener('authority:chat-loaded', receiveCommitEvent as EventListener);
    setTimeout(() => {
        const bridge = (globalThis as typeof globalThis & {
            STAuthorityHostBridge?: { getLatestCommit?: () => unknown };
        }).STAuthorityHostBridge;
        enqueue(bridge?.getLatestCommit?.());
    }, 0);
}

function receiveCommitEvent(event: Event): void {
    enqueue((event as CustomEvent<unknown>).detail);
}

function enqueue(value: unknown): void {
    const event = normalizeCommit(value);
    if (!event) return;
    pending.set(event.eventId, event);
    void drain();
}

async function drain(): Promise<void> {
    if (drainPromise) return await drainPromise;
    drainPromise = (async () => {
        try {
            const client = await getClient();
            while (pending.size > 0) {
                const event = pending.values().next().value as AuthorityHostCommitEvent | undefined;
                if (!event) break;
                await client.host.recordCommit(event);
                pending.delete(event.eventId);
                retryAttempt = 0;
            }
        } catch (error) {
            scheduleRetry();
            console.debug('Authority Host Event recorder will retry in the background.', error);
        } finally {
            drainPromise = null;
        }
    })();
    return await drainPromise;
}

function scheduleRetry(): void {
    if (retryTimer !== null || pending.size === 0) return;
    const delay = Math.min(30_000, 500 * (2 ** Math.min(retryAttempt, 6)));
    retryAttempt += 1;
    retryTimer = setTimeout(() => {
        retryTimer = null;
        void drain();
    }, delay);
}

function getClient(): Promise<AuthorityClient> {
    clientPromise ??= AuthoritySDK.init({
        extensionId: AUTHORITY_EXTENSION_ID,
        displayName: AUTHORITY_EXTENSION_DISPLAY_NAME,
        version: AUTHORITY_EXTENSION_VERSION,
        installType: 'system',
        declaredPermissions: {},
        uiLabel: 'Authority Host Bridge',
    }).catch(error => {
        clientPromise = null;
        throw error;
    });
    return clientPromise;
}

function normalizeCommit(value: unknown): AuthorityHostCommitEvent | null {
    if (!isRecord(value) || value.schemaVersion !== 1) return null;
    const eventId = text(value.eventId);
    const transactionId = text(value.transactionId);
    const conversationId = text(value.conversationId);
    const branchId = text(value.branchId);
    const operation = text(value.operation) || 'chat.save';
    const committedAt = text(value.committedAt);
    const baseRevision = integer(value.baseRevision);
    const revision = integer(value.revision);
    if (!eventId || !transactionId || !conversationId || !branchId || !committedAt) return null;
    if (baseRevision === null || revision !== baseRevision + 1) return null;

    const sourceEventIds = stringArray(value.sourceEventIds);
    if (sourceEventIds.length === 0 && Array.isArray(value.sourceEvents)) {
        for (const item of value.sourceEvents) {
            const id = isRecord(item) ? text(item.eventId) : '';
            if (id) sourceEventIds.push(id);
        }
    }
    return {
        schemaVersion: 1,
        eventId,
        transactionId,
        conversationId,
        branchId,
        baseRevision,
        revision,
        operation,
        ...arrayField('rootEventIds', stringArray(value.rootEventIds)),
        ...(text(value.correlationId) ? { correlationId: text(value.correlationId) } : {}),
        ...(value.causationId === null ? { causationId: null } : text(value.causationId) ? { causationId: text(value.causationId) } : {}),
        ...arrayField('originExtensionIds', stringArray(value.originExtensionIds)),
        ...arrayField('sourceEventIds', [...new Set(sourceEventIds)]),
        ...(Array.isArray(value.changes) ? { changes: value.changes.map(normalizeChange).filter(Boolean) as AuthorityHostChange[] } : {}),
        committedAt,
    };
}

function normalizeChange(value: unknown): AuthorityHostChange | null {
    if (!isRecord(value)) return null;
    const kind = text(value.kind);
    if (!kind) return null;
    return {
        kind,
        ...(value.messageUid === null ? { messageUid: null } : text(value.messageUid) ? { messageUid: text(value.messageUid) } : {}),
        ...(value.swipeUid === null ? { swipeUid: null } : text(value.swipeUid) ? { swipeUid: text(value.swipeUid) } : {}),
        ...(integer(value.index) !== null ? { index: integer(value.index)! } : {}),
        ...(integer(value.previousIndex) !== null ? { previousIndex: integer(value.previousIndex)! } : {}),
    };
}

function arrayField<Key extends string>(key: Key, values: string[]): Record<Key, string[]> | Record<string, never> {
    return values.length > 0 ? { [key]: values } as Record<Key, string[]> : {};
}

function stringArray(value: unknown): string[] {
    return Array.isArray(value) ? value.map(text).filter(Boolean) : [];
}

function integer(value: unknown): number | null {
    const number = Number(value);
    return Number.isSafeInteger(number) && number >= 0 ? number : null;
}

function text(value: unknown): string {
    return typeof value === 'string' ? value.trim() : '';
}

function isRecord(value: unknown): value is Record<string, unknown> {
    return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

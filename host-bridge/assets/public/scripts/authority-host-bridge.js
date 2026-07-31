const BRIDGE_SCHEMA_VERSION = 1;
const HOST_STATE_KEY = 'authority';
const MESSAGE_STATE_KEY = 'authority';
const MUTATING_EVENTS = new Set([
    'message_sent',
    'message_received',
    'message_edited',
    'message_deleted',
    'message_updated',
    'message_swiped',
    'message_swipe_deleted',
    'message_file_embedded',
    'message_reasoning_edited',
    'message_reasoning_deleted',
    'media_attachment_deleted',
    'file_attachment_deleted',
    'chat_created',
    'chat_deleted',
    'chat_renamed',
    'group_chat_created',
    'group_chat_deleted',
]);

const listenerOwners = new WeakMap();
const ownerStack = [];
const eventStack = [];
const pendingMutationEvents = new Map();
const committedSnapshots = new Map();
let activeExtensionLoad = null;

function randomId(prefix) {
    const value = globalThis.crypto?.randomUUID?.()
        ?? `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
    return `${prefix}:${value}`;
}

function nowIso() {
    return new Date().toISOString();
}

function currentOwner() {
    return ownerStack.at(-1) ?? activeExtensionLoad?.extensionId ?? 'sillytavern-core';
}

function readHostContext() {
    try {
        return globalThis.SillyTavern?.getContext?.() ?? null;
    } catch {
        return null;
    }
}

function normalizeHostState(metadata) {
    const current = metadata?.[HOST_STATE_KEY];
    const state = current && typeof current === 'object' && !Array.isArray(current)
        ? current
        : {};
    if (metadata && state !== current) {
        metadata[HOST_STATE_KEY] = state;
    }
    state.schemaVersion = BRIDGE_SCHEMA_VERSION;
    state.conversationId ||= randomId('conversation');
    state.branchId ||= randomId('branch');
    state.revision = normalizeRevision(state.revision);
    return state;
}

function normalizeRevision(value) {
    const revision = Number(value);
    return Number.isSafeInteger(revision) && revision >= 0 ? revision : 0;
}

function ensureSwipeIdentity(swipeInfo) {
    if (!swipeInfo || typeof swipeInfo !== 'object' || Array.isArray(swipeInfo)) {
        return null;
    }
    const state = swipeInfo[MESSAGE_STATE_KEY] && typeof swipeInfo[MESSAGE_STATE_KEY] === 'object'
        ? swipeInfo[MESSAGE_STATE_KEY]
        : (swipeInfo[MESSAGE_STATE_KEY] = {});
    state.swipeId ||= randomId('swipe');
    return state.swipeId;
}

function ensureMessageIdentity(message) {
    if (!message || typeof message !== 'object' || Array.isArray(message)) {
        return null;
    }
    const state = message[MESSAGE_STATE_KEY] && typeof message[MESSAGE_STATE_KEY] === 'object'
        ? message[MESSAGE_STATE_KEY]
        : (message[MESSAGE_STATE_KEY] = {});
    state.messageId ||= randomId('message');
    if (Array.isArray(message.swipe_info)) {
        for (const swipeInfo of message.swipe_info) {
            ensureSwipeIdentity(swipeInfo);
        }
    }
    return state.messageId;
}

export function ensureAuthorityChatState(metadata, messages) {
    const host = normalizeHostState(metadata ?? {});
    if (Array.isArray(messages)) {
        for (const message of messages) {
            ensureMessageIdentity(message);
        }
    }
    return host;
}

function snapshotMessages(metadata, messages) {
    const host = ensureAuthorityChatState(metadata, messages);
    const records = Array.isArray(messages)
        ? messages.map((message, index) => ({
            index,
            messageId: message?.[MESSAGE_STATE_KEY]?.messageId ?? null,
            swipeId: Array.isArray(message?.swipe_info)
                ? message.swipe_info[normalizeRevision(message.swipe_id)]?.[MESSAGE_STATE_KEY]?.swipeId ?? null
                : null,
            digest: stableDigest(message),
        }))
        : [];
    return {
        conversationId: host.conversationId,
        branchId: host.branchId,
        revision: normalizeRevision(host.revision),
        records,
    };
}

function stableDigest(value) {
    try {
        return JSON.stringify(sortJson(value));
    } catch {
        return String(value);
    }
}

function sortJson(value) {
    if (Array.isArray(value)) {
        return value.map(sortJson);
    }
    if (!value || typeof value !== 'object') {
        return value;
    }
    return Object.fromEntries(Object.keys(value).sort().map(key => [key, sortJson(value[key])]));
}

function diffSnapshots(previous, current) {
    if (!previous || previous.conversationId !== current.conversationId) {
        return current.records.map(record => ({
            kind: 'message-present',
            messageId: record.messageId,
            swipeId: record.swipeId,
            index: record.index,
        }));
    }
    const oldById = new Map(previous.records.map(record => [record.messageId, record]));
    const newById = new Map(current.records.map(record => [record.messageId, record]));
    const changes = [];
    for (const record of current.records) {
        const old = oldById.get(record.messageId);
        if (!old) {
            changes.push({ kind: 'message-inserted', messageId: record.messageId, swipeId: record.swipeId, index: record.index });
        } else if (old.digest !== record.digest || old.index !== record.index) {
            changes.push({ kind: 'message-updated', messageId: record.messageId, swipeId: record.swipeId, index: record.index });
        }
    }
    for (const record of previous.records) {
        if (!newById.has(record.messageId)) {
            changes.push({ kind: 'message-deleted', messageId: record.messageId, swipeId: record.swipeId, previousIndex: record.index });
        }
    }
    return changes;
}

export function beginAuthorityExtensionLoad(extensionId) {
    const token = { id: randomId('extension-load'), extensionId: String(extensionId || 'unknown-extension') };
    activeExtensionLoad = token;
    return token;
}

export function endAuthorityExtensionLoad(token) {
    if (activeExtensionLoad?.id === token?.id) {
        activeExtensionLoad = null;
    }
}

export async function withAuthorityExtensionOwner(extensionId, callback) {
    ownerStack.push(String(extensionId || 'unknown-extension'));
    try {
        return await callback();
    } finally {
        ownerStack.pop();
    }
}

export function registerAuthorityListener(_emitter, _event, listener) {
    if (!_emitter || typeof listener !== 'function') return;
    let byEvent = listenerOwners.get(_emitter);
    if (!byEvent) {
        byEvent = new Map();
        listenerOwners.set(_emitter, byEvent);
    }
    let owners = byEvent.get(_event);
    if (!owners) {
        owners = new WeakMap();
        byEvent.set(_event, owners);
    }
    if (!owners.has(listener)) owners.set(listener, currentOwner());
}

export function unregisterAuthorityListener(_emitter, _event, listener) {
    if (!_emitter || typeof listener !== 'function' || _emitter.events?.[_event]?.includes(listener)) return;
    listenerOwners.get(_emitter)?.get(_event)?.delete(listener);
}

export function beginAuthorityEvent(eventName, args = []) {
    const parent = eventStack.at(-1) ?? null;
    const eventId = randomId('host-event');
    const hostContext = readHostContext();
    const metadata = hostContext?.chatMetadata ?? hostContext?.chat_metadata;
    const messages = hostContext?.chat;
    const hostState = metadata && Array.isArray(messages)
        ? ensureAuthorityChatState(metadata, messages)
        : null;
    const context = {
        schemaVersion: BRIDGE_SCHEMA_VERSION,
        eventId,
        rootEventId: parent?.rootEventId ?? eventId,
        parentEventId: parent?.eventId ?? null,
        eventName: String(eventName),
        originExtensionId: currentOwner(),
        conversationId: hostState?.conversationId ?? parent?.conversationId ?? null,
        branchId: hostState?.branchId ?? parent?.branchId ?? null,
        baseRevision: hostState?.revision ?? parent?.baseRevision ?? null,
        occurredAt: nowIso(),
        argsSummary: summarizeEventArgs(args),
    };
    eventStack.push(context);
    return context;
}

export async function withAuthorityListener(_emitter, _event, listener, callback) {
    const owner = listenerOwners.get(_emitter)?.get(_event)?.get(listener);
    ownerStack.push(owner ?? currentOwner());
    try {
        return await callback();
    } finally {
        ownerStack.pop();
    }
}

export function endAuthorityEvent(context) {
    const current = eventStack.at(-1);
    if (current?.eventId === context?.eventId) {
        eventStack.pop();
    } else {
        const index = eventStack.findIndex(item => item.eventId === context?.eventId);
        if (index >= 0) {
            eventStack.splice(index, 1);
        }
    }

    if (MUTATING_EVENTS.has(context?.eventName)) {
        const key = context.conversationId ?? 'unscoped';
        const events = pendingMutationEvents.get(key) ?? [];
        events.push(context);
        if (events.length > 200) {
            events.splice(0, events.length - 200);
        }
        pendingMutationEvents.set(key, events);
    }

    if (context?.eventName === 'chatLoaded') {
        const hostContext = readHostContext();
        const metadata = hostContext?.chatMetadata ?? hostContext?.chat_metadata;
        const messages = hostContext?.chat;
        if (metadata && Array.isArray(messages)) {
            const snapshot = snapshotMessages(metadata, messages);
            committedSnapshots.set(snapshot.conversationId, snapshot);
        }
    }
}

function summarizeEventArgs(args) {
    return Array.from(args ?? []).slice(0, 4).map(value => {
        if (value === null || value === undefined || typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
            return value;
        }
        if (Array.isArray(value)) {
            return { type: 'array', length: value.length };
        }
        if (typeof value === 'object') {
            return Object.fromEntries(Object.entries(value).slice(0, 12).map(([key, item]) => [
                key,
                item === null || ['string', 'number', 'boolean'].includes(typeof item) ? item : typeof item,
            ]));
        }
        return typeof value;
    });
}

export function getAuthorityEventContext() {
    const context = eventStack.at(-1);
    return context ? structuredClone(context) : null;
}

export function prepareAuthorityChatCommit({ metadata, messages, chatKey = null, groupId = null } = {}) {
    const current = snapshotMessages(metadata ?? {}, messages ?? []);
    const previous = committedSnapshots.get(current.conversationId) ?? null;
    const changes = diffSnapshots(previous, current);
    const sourceEvents = [...(pendingMutationEvents.get(current.conversationId) ?? [])];
    const eventId = randomId('chat-commit');
    const rootEventIds = [...new Set(sourceEvents.map(event => event.rootEventId).filter(Boolean))];
    const originExtensionIds = [...new Set(sourceEvents.map(event => event.originExtensionId).filter(Boolean))];
    const transaction = {
        schemaVersion: BRIDGE_SCHEMA_VERSION,
        eventId,
        transactionId: randomId('host-transaction'),
        rootEventIds: rootEventIds.length > 0 ? rootEventIds : [eventId],
        correlationId: rootEventIds[0] ?? eventId,
        causationId: sourceEvents.at(-1)?.eventId ?? null,
        originExtensionIds: originExtensionIds.length > 0 ? originExtensionIds : [currentOwner()],
        conversationId: current.conversationId,
        branchId: current.branchId,
        baseRevision: current.revision,
        operation: inferOperation(changes),
        sourceEvents,
        changes,
        chatKey,
        groupId,
        preparedAt: nowIso(),
    };
    return {
        expectedRevision: current.revision,
        transaction,
        snapshot: current,
    };
}

function inferOperation(changes) {
    const kinds = new Set(changes.map(change => change.kind));
    if (kinds.has('message-deleted')) return 'chat.messages.delete';
    if (kinds.has('message-inserted')) return 'chat.messages.insert';
    if (kinds.has('message-updated')) return 'chat.messages.update';
    return changes.length > 0 ? 'chat.mutate' : 'chat.save';
}

export async function completeAuthorityChatCommit(commit, receipt, { metadata, messages, eventSource } = {}) {
    const host = normalizeHostState(metadata ?? {});
    const preparedConversationId = commit?.transaction?.conversationId ?? host.conversationId;
    const authoritative = receipt?.host ?? receipt ?? {};
    if (authoritative.conversationId) host.conversationId = authoritative.conversationId;
    if (authoritative.branchId) host.branchId = authoritative.branchId;
    host.revision = normalizeRevision(authoritative.revision ?? (commit?.expectedRevision + 1));
    host.lastEventId = authoritative.eventId ?? commit?.transaction?.eventId ?? null;
    host.lastTransactionId = authoritative.transactionId ?? commit?.transaction?.transactionId ?? null;
    host.committedAt = authoritative.committedAt ?? nowIso();

    const snapshot = snapshotMessages(metadata ?? {}, messages ?? []);
    snapshot.revision = host.revision;
    committedSnapshots.set(host.conversationId, snapshot);
    if (preparedConversationId !== host.conversationId) {
        committedSnapshots.delete(preparedConversationId);
    }
    acknowledgeMutationEvents(preparedConversationId, commit?.transaction?.sourceEvents);

    const detail = {
        schemaVersion: BRIDGE_SCHEMA_VERSION,
        ...commit?.transaction,
        ...authoritative,
        conversationId: host.conversationId,
        branchId: host.branchId,
        revision: host.revision,
        baseRevision: normalizeRevision(authoritative.baseRevision ?? commit?.expectedRevision),
    };
    globalThis.dispatchEvent?.(new CustomEvent('authority:chat-committed', { detail }));
    if (eventSource?.emit) {
        await eventSource.emit('authority_chat_committed', detail);
    }
    return detail;
}

function acknowledgeMutationEvents(conversationId, committedEvents) {
    const events = pendingMutationEvents.get(conversationId);
    if (!events?.length) return;
    const committedIds = new Set((committedEvents ?? []).map(event => event?.eventId).filter(Boolean));
    if (committedIds.size === 0) return;
    const remaining = events.filter(event => !committedIds.has(event.eventId));
    if (remaining.length > 0) pendingMutationEvents.set(conversationId, remaining);
    else pendingMutationEvents.delete(conversationId);
}

export async function failAuthorityChatCommit(commit, error, { eventSource } = {}) {
    const detail = {
        schemaVersion: BRIDGE_SCHEMA_VERSION,
        ...commit?.transaction,
        baseRevision: normalizeRevision(commit?.expectedRevision),
        error: error instanceof Error ? error.message : String(error),
        failedAt: nowIso(),
    };
    globalThis.dispatchEvent?.(new CustomEvent('authority:chat-commit-failed', { detail }));
    if (eventSource?.emit) {
        await eventSource.emit('authority_chat_commit_failed', detail);
    }
    return detail;
}

globalThis.STAuthorityHostBridge = Object.freeze({
    schemaVersion: BRIDGE_SCHEMA_VERSION,
    ensureChatState: ensureAuthorityChatState,
    getEventContext: getAuthorityEventContext,
    prepareChatCommit: prepareAuthorityChatCommit,
});

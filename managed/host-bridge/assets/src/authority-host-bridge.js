import crypto from 'node:crypto';
import fs from 'node:fs';

const BRIDGE_SCHEMA_VERSION = 1;
const HOST_STATE_KEY = 'authority';
const MESSAGE_STATE_KEY = 'authority';

export class AuthorityRevisionMismatchError extends Error {
    constructor(expectedRevision, currentRevision, conversationId) {
        super(`Chat revision mismatch: expected ${expectedRevision}, current ${currentRevision}.`);
        this.name = 'AuthorityRevisionMismatchError';
        this.expectedRevision = expectedRevision;
        this.currentRevision = currentRevision;
        this.conversationId = conversationId ?? null;
    }
}

function randomId(prefix) {
    return `${prefix}:${crypto.randomUUID()}`;
}

function normalizeRevision(value) {
    const revision = Number(value);
    return Number.isSafeInteger(revision) && revision >= 0 ? revision : 0;
}

function readExistingHeader(filePath) {
    if (!fs.existsSync(filePath)) {
        return null;
    }
    const descriptor = fs.openSync(filePath, 'r');
    try {
        const chunks = [];
        const buffer = Buffer.alloc(64 * 1024);
        let offset = 0;
        while (true) {
            const bytesRead = fs.readSync(descriptor, buffer, 0, buffer.length, offset);
            if (bytesRead === 0) break;
            const chunk = Buffer.from(buffer.subarray(0, bytesRead));
            const newline = chunk.indexOf(0x0A);
            chunks.push(newline >= 0 ? chunk.subarray(0, newline) : chunk);
            if (newline >= 0) break;
            offset += bytesRead;
        }
        const firstLine = Buffer.concat(chunks).toString('utf8').trim();
        if (!firstLine) return null;
        const parsed = JSON.parse(firstLine);
        return parsed && typeof parsed === 'object' ? parsed : null;
    } catch {
        return null;
    } finally {
        fs.closeSync(descriptor);
    }
}

function ensureMessageIdentities(chatData) {
    for (const message of chatData.slice(1)) {
        if (!message || typeof message !== 'object' || Array.isArray(message)) continue;
        const messageState = message[MESSAGE_STATE_KEY] && typeof message[MESSAGE_STATE_KEY] === 'object'
            ? message[MESSAGE_STATE_KEY]
            : (message[MESSAGE_STATE_KEY] = {});
        messageState.messageId ||= randomId('message');
        if (!Array.isArray(message.swipe_info)) continue;
        for (const swipeInfo of message.swipe_info) {
            if (!swipeInfo || typeof swipeInfo !== 'object' || Array.isArray(swipeInfo)) continue;
            const swipeState = swipeInfo[MESSAGE_STATE_KEY] && typeof swipeInfo[MESSAGE_STATE_KEY] === 'object'
                ? swipeInfo[MESSAGE_STATE_KEY]
                : (swipeInfo[MESSAGE_STATE_KEY] = {});
            swipeState.swipeId ||= randomId('swipe');
        }
    }
}

export function prepareAuthorityChatSave(chatData, filePath, options = {}) {
    if (!Array.isArray(chatData) || !chatData[0] || typeof chatData[0] !== 'object') {
        throw new TypeError('Authority Host Bridge requires a chat header at index 0.');
    }
    chatData[0].chat_metadata ??= {};
    const incomingMetadata = chatData[0].chat_metadata;
    const incomingHost = incomingMetadata[HOST_STATE_KEY] && typeof incomingMetadata[HOST_STATE_KEY] === 'object'
        ? incomingMetadata[HOST_STATE_KEY]
        : {};
    const existingHeader = readExistingHeader(filePath);
    const existingHost = existingHeader?.chat_metadata?.[HOST_STATE_KEY] && typeof existingHeader.chat_metadata[HOST_STATE_KEY] === 'object'
        ? existingHeader.chat_metadata[HOST_STATE_KEY]
        : null;
    const fileExists = Boolean(existingHeader);
    const currentRevision = normalizeRevision(existingHost?.revision);
    const hasExpectedRevision = options.expectedRevision !== undefined && options.expectedRevision !== null && options.expectedRevision !== '';
    const expectedRevision = hasExpectedRevision ? parseExpectedRevision(options.expectedRevision) : currentRevision;

    if (!options.force && hasExpectedRevision && expectedRevision !== currentRevision) {
        throw new AuthorityRevisionMismatchError(expectedRevision, currentRevision, existingHost?.conversationId);
    }

    const transaction = options.transaction && typeof options.transaction === 'object' && !Array.isArray(options.transaction)
        ? options.transaction
        : {};
    const conversationId = existingHost?.conversationId || randomId('conversation');
    const branchId = existingHost?.branchId || randomId('branch');
    const eventId = String(transaction.eventId || randomId('chat-commit'));
    const transactionId = String(transaction.transactionId || randomId('host-transaction'));
    const committedAt = new Date().toISOString();
    const revision = currentRevision + 1;
    const hostState = {
        schemaVersion: BRIDGE_SCHEMA_VERSION,
        conversationId,
        branchId,
        revision,
        lastEventId: eventId,
        lastTransactionId: transactionId,
        committedAt,
        ...(fileExists || !incomingHost.conversationId ? {} : {
            parentConversationId: incomingHost.conversationId,
            parentBranchId: incomingHost.branchId ?? null,
            parentRevision: normalizeRevision(incomingHost.revision),
        }),
        lastCommit: {
            eventId,
            transactionId,
            operation: String(transaction.operation || 'chat.save'),
            originExtensionIds: Array.isArray(transaction.originExtensionIds)
                ? transaction.originExtensionIds.map(String).slice(0, 32)
                : ['legacy-unmanaged'],
            sourceEventIds: Array.isArray(transaction.sourceEvents)
                ? transaction.sourceEvents.map(item => String(item?.eventId || '')).filter(Boolean).slice(0, 128)
                : [],
        },
    };
    incomingMetadata[HOST_STATE_KEY] = hostState;
    ensureMessageIdentities(chatData);

    return {
        ok: true,
        host: {
            schemaVersion: BRIDGE_SCHEMA_VERSION,
            eventId,
            transactionId,
            conversationId,
            branchId,
            baseRevision: currentRevision,
            revision,
            committedAt,
            operation: hostState.lastCommit.operation,
            originExtensionIds: hostState.lastCommit.originExtensionIds,
            sourceEventIds: hostState.lastCommit.sourceEventIds,
        },
    };
}

function parseExpectedRevision(value) {
    const revision = Number(value);
    if (!Number.isSafeInteger(revision) || revision < 0) {
        throw new TypeError('Expected chat revision must be a non-negative safe integer.');
    }
    return revision;
}

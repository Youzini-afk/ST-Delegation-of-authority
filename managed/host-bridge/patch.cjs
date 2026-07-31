'use strict';

const BRIDGE_MARKER = 'authority-host-bridge:v1';

function replaceOnce(source, before, after, label) {
    const first = source.indexOf(before);
    if (first < 0) {
        throw new Error(`Host Bridge patch anchor missing: ${label}`);
    }
    if (source.indexOf(before, first + before.length) >= 0) {
        throw new Error(`Host Bridge patch anchor is ambiguous: ${label}`);
    }
    return source.slice(0, first) + after + source.slice(first + before.length);
}

function replaceAllExact(source, before, after, label, expectedCount) {
    const parts = source.split(before);
    const count = parts.length - 1;
    if (count !== expectedCount) {
        throw new Error(`Host Bridge patch anchor count mismatch for ${label}: expected ${expectedCount}, found ${count}`);
    }
    return parts.join(after);
}

function patchEventEmitter(source) {
    if (source.includes(BRIDGE_MARKER)) return source;
    source = replaceOnce(source,
        '/* Polyfill indexOf. */',
        `import {\n    beginAuthorityEvent,\n    endAuthorityEvent,\n    registerAuthorityListener,\n    unregisterAuthorityListener,\n    withAuthorityListener,\n} from '../scripts/authority-host-bridge.js';\n\n// ${BRIDGE_MARKER}\n/* Polyfill indexOf. */`,
        'eventemitter import');
    source = replaceOnce(source,
        '    this.events[event].push(listener);\n\n    if (this.autoFireAfterEmit.has(event)',
        '    this.events[event].push(listener);\n    registerAuthorityListener(this, event, listener);\n\n    if (this.autoFireAfterEmit.has(event)',
        'eventemitter on owner');
    source = replaceOnce(source,
        '    events.push(listener);\n\n    if (this.autoFireAfterEmit.has(event)',
        '    events.push(listener);\n    registerAuthorityListener(this, event, listener);\n\n    if (this.autoFireAfterEmit.has(event)',
        'eventemitter makeLast owner');
    source = replaceOnce(source,
        '    events.unshift(listener);\n\n    if (this.autoFireAfterEmit.has(event)',
        '    events.unshift(listener);\n    registerAuthorityListener(this, event, listener);\n\n    if (this.autoFireAfterEmit.has(event)',
        'eventemitter makeFirst owner');
    source = replaceOnce(source,
        '            this.events[event].splice(idx, 1);\n',
        '            this.events[event].splice(idx, 1);\n            unregisterAuthorityListener(this, event, listener);\n',
        'eventemitter remove owner');
    source = replaceOnce(source,
        "EventEmitter.prototype.emit = async function (event) {\n    let args = [].slice.call(arguments, 1);",
        "EventEmitter.prototype.emit = async function (event) {\n    let args = [].slice.call(arguments, 1);\n    const authorityEvent = beginAuthorityEvent(event, args);",
        'eventemitter begin event');
    source = replaceOnce(source,
        '                await listeners[i].apply(this, args);',
        '                await withAuthorityListener(this, event, listeners[i], () => listeners[i].apply(this, args));',
        'eventemitter async listener');
    source = replaceOnce(source,
        '    if (this.autoFireAfterEmit.has(event)) {\n        this.autoFireLastArgs.set(event, args);\n    }\n};\n\nEventEmitter.prototype.emitAndWait',
        '    if (this.autoFireAfterEmit.has(event)) {\n        this.autoFireLastArgs.set(event, args);\n    }\n    endAuthorityEvent(authorityEvent);\n};\n\nEventEmitter.prototype.emitAndWait',
        'eventemitter end event');
    return source;
}

function patchExtensions(source) {
    if (source.includes(BRIDGE_MARKER)) return source;
    source = replaceOnce(source,
        "import { SimpleMutex } from './util/SimpleMutex.js';",
        `import { SimpleMutex } from './util/SimpleMutex.js';\nimport {\n    beginAuthorityExtensionLoad,\n    endAuthorityExtensionLoad,\n    withAuthorityExtensionOwner,\n} from './authority-host-bridge.js';\n\n// ${BRIDGE_MARKER}`,
        'extensions import');
    source = replaceOnce(source,
        '        const hookCallResult = module[hookFunctionName]();',
        '        const hookCallResult = withAuthorityExtensionOwner(name, () => module[hookFunctionName]());',
        'extension hook owner');
    source = replaceOnce(source,
        "        if ($(`script[id=\"${id}\"]`).length === 0) {\n            const script = document.createElement('script');",
        "        if ($(`script[id=\"${id}\"]`).length === 0) {\n            const authorityLoad = beginAuthorityExtensionLoad(name);\n            const script = document.createElement('script');",
        'extension load begin');
    source = replaceOnce(source,
        '            script.onerror = function (err) {\n                reject(err);\n            };',
        '            script.onerror = function (err) {\n                endAuthorityExtensionLoad(authorityLoad);\n                reject(err);\n            };',
        'extension load error');
    source = replaceOnce(source,
        '                if (!ready) {\n                    ready = true;\n                    resolve();\n                }',
        '                if (!ready) {\n                    ready = true;\n                    endAuthorityExtensionLoad(authorityLoad);\n                    resolve();\n                }',
        'extension load end');
    source = replaceOnce(source,
        '            document.body.appendChild(script);\n        }\n    });\n}',
        '            document.body.appendChild(script);\n        } else {\n            resolve();\n        }\n    });\n}',
        'extension already loaded');
    return source;
}

function patchEvents(source) {
    if (source.includes(BRIDGE_MARKER)) return source;
    return replaceOnce(source,
        "export const event_types = {",
        `// ${BRIDGE_MARKER}\nexport const event_types = {\n    AUTHORITY_CHAT_COMMITTED: 'authority_chat_committed',\n    AUTHORITY_CHAT_COMMIT_FAILED: 'authority_chat_commit_failed',`,
        'events authority types');
}

function patchScript(source) {
    if (source.includes(BRIDGE_MARKER)) return source;
    source = `import {\n    completeAuthorityChatCommit,\n    failAuthorityChatCommit,\n    prepareAuthorityChatCommit,\n} from './scripts/authority-host-bridge.js';\n\n// ${BRIDGE_MARKER}\n${source}`;
    source = replaceOnce(source,
        "    /** @type {ChatHeader} */\n    const chatHeader = {",
        "    const authorityCommit = prepareAuthorityChatCommit({\n        metadata,\n        messages: trimmedChat,\n        chatKey: fileName,\n    });\n\n    /** @type {ChatHeader} */\n    const chatHeader = {",
        'saveChat prepare');
    source = replaceOnce(source,
        '                force: force,\n            }),',
        '                force: force,\n                expected_revision: authorityCommit.expectedRevision,\n                authority_transaction: authorityCommit.transaction,\n            }),',
        'saveChat request envelope');
    source = replaceOnce(source,
        '        if (result.ok) {\n            return;\n        }',
        "        if (result.ok) {\n            const receipt = await result.json();\n            return await completeAuthorityChatCommit(authorityCommit, receipt, {\n                metadata: chat_metadata,\n                messages: trimmedChat,\n                eventSource,\n            });\n        }",
        'saveChat commit receipt');
    source = replaceOnce(source,
        "        const isIntegrityError = errorData?.error === 'integrity' && !force;\n        if (!isIntegrityError) {",
        "        const isIntegrityError = errorData?.error === 'integrity' && !force;\n        const isRevisionError = errorData?.error === 'revision' && !force;\n        if (!isIntegrityError && !isRevisionError) {",
        'saveChat revision conflict');
    source = replaceOnce(source,
        '    } catch (error) {\n        console.error(error);\n        toastr.error(t`Check the server connection and reload the page to prevent data loss.`, t`Chat could not be saved`);\n    }\n}',
        '    } catch (error) {\n        await failAuthorityChatCommit(authorityCommit, error, { eventSource });\n        console.error(error);\n        toastr.error(t`Check the server connection and reload the page to prevent data loss.`, t`Chat could not be saved`);\n    }\n}',
        'saveChat failure receipt');
    return source;
}

function patchGroupChats(source) {
    if (source.includes(BRIDGE_MARKER)) return source;
    source = `import {\n    completeAuthorityChatCommit,\n    failAuthorityChatCommit,\n    prepareAuthorityChatCommit,\n} from './authority-host-bridge.js';\n\n// ${BRIDGE_MARKER}\n${source}`;
    source = replaceOnce(source,
        "    group.date_last_chat = Date.now();\n    /** @type {ChatHeader} */\n    const chatHeader = {",
        "    group.date_last_chat = Date.now();\n    const authorityCommit = prepareAuthorityChatCommit({\n        metadata: chat_metadata,\n        messages: chat,\n        chatKey: chatId,\n        groupId,\n    });\n    /** @type {ChatHeader} */\n    const chatHeader = {",
        'group save prepare');
    source = replaceOnce(source,
        '        body: JSON.stringify({ id: chatId, chat: [chatHeader, ...chat], force: force }),',
        '        body: JSON.stringify({\n            id: chatId,\n            chat: [chatHeader, ...chat],\n            force: force,\n            expected_revision: authorityCommit.expectedRevision,\n            authority_transaction: authorityCommit.transaction,\n        }),',
        'group save request envelope');
    source = replaceOnce(source,
        "    const response = await fetch('/api/chats/group/save', saveGroupChatRequest);\n\n    if (!response.ok) {",
        "    const response = await fetch('/api/chats/group/save', saveGroupChatRequest);\n\n    if (response.ok) {\n        const receipt = await response.json();\n        await completeAuthorityChatCommit(authorityCommit, receipt, {\n            metadata: chat_metadata,\n            messages: chat,\n            eventSource,\n        });\n    }\n\n    if (!response.ok) {",
        'group save commit receipt');
    source = replaceOnce(source,
        "        const isIntegrityError = errorData?.error === 'integrity' && !force;\n        if (!isIntegrityError) {",
        "        const isIntegrityError = errorData?.error === 'integrity' && !force;\n        const isRevisionError = errorData?.error === 'revision' && !force;\n        if (!isIntegrityError && !isRevisionError) {",
        'group revision conflict');
    source = replaceOnce(source,
        '            console.error(\'Group chat could not be saved\', response);\n            return;',
        "            console.error('Group chat could not be saved', response);\n            await failAuthorityChatCommit(authorityCommit, new Error(`Group chat save failed: ${response.status}`), { eventSource });\n            return;",
        'group save failure receipt');
    return source;
}

function patchChatsEndpoint(source) {
    if (source.includes(BRIDGE_MARKER)) return source;
    source = replaceOnce(source,
        "import validateAvatarUrlMiddleware from '../middleware/validateFileName.js';",
        `import validateAvatarUrlMiddleware from '../middleware/validateFileName.js';\nimport { AuthorityRevisionMismatchError, prepareAuthorityChatSave } from '../authority-host-bridge.js';\n\n// ${BRIDGE_MARKER}`,
        'chat endpoint import');
    source = replaceOnce(source,
        'export async function trySaveChat(chatData, filePath, skipIntegrityCheck = false, handle, cardName, backupDirectory) {\n    const jsonlData = chatData?.map(m => JSON.stringify(m)).join(\'\\n\');',
        'export async function trySaveChat(chatData, filePath, skipIntegrityCheck = false, handle, cardName, backupDirectory, authorityOptions = {}) {',
        'trySaveChat authority signature');
    source = replaceOnce(source,
        '    tryWriteFileSync(filePath, jsonlData);\n    getBackupFunction(handle)(backupDirectory, cardName, jsonlData);\n}',
        "    const authorityReceipt = prepareAuthorityChatSave(chatData, filePath, {\n        ...authorityOptions,\n        force: skipIntegrityCheck,\n    });\n    const jsonlData = chatData?.map(m => JSON.stringify(m)).join('\\n');\n    tryWriteFileSync(filePath, jsonlData);\n    getBackupFunction(handle)(backupDirectory, cardName, jsonlData);\n    return authorityReceipt;\n}",
        'trySaveChat authority receipt');
    source = replaceOnce(source,
        '            await trySaveChat(chatData, chatFilePath, request.body.force, handle, cardName, request.user.directories.backups);\n            return response.send({ ok: true });',
        '            const receipt = await trySaveChat(chatData, chatFilePath, request.body.force, handle, cardName, request.user.directories.backups, {\n                expectedRevision: request.body.expected_revision,\n                transaction: request.body.authority_transaction,\n            });\n            return response.send(receipt);',
        'single chat save receipt');
    source = replaceAllExact(source,
        '        if (error instanceof IntegrityMismatchError) {',
        "        if (error instanceof AuthorityRevisionMismatchError) {\n            return response.status(409).send({\n                error: 'revision',\n                expectedRevision: error.expectedRevision,\n                currentRevision: error.currentRevision,\n                conversationId: error.conversationId,\n            });\n        }\n        if (error instanceof IntegrityMismatchError) {",
        'chat revision errors',
        2);
    source = replaceOnce(source,
        '            await trySaveChat(chatData, chatFilePath, request.body.force, handle, String(id), request.user.directories.backups);\n            return response.send({ ok: true });',
        '            const receipt = await trySaveChat(chatData, chatFilePath, request.body.force, handle, String(id), request.user.directories.backups, {\n                expectedRevision: request.body.expected_revision,\n                transaction: request.body.authority_transaction,\n            });\n            return response.send(receipt);',
        'group chat save receipt');
    return source;
}

const transforms = {
    'public/lib/eventemitter.js': patchEventEmitter,
    'public/scripts/extensions.js': patchExtensions,
    'public/scripts/events.js': patchEvents,
    'public/script.js': patchScript,
    'public/scripts/group-chats.js': patchGroupChats,
    'src/endpoints/chats.js': patchChatsEndpoint,
};

module.exports = {
    bridgeMarker: BRIDGE_MARKER,
    targetFiles: Object.keys(transforms),
    apply(relativePath, source) {
        const transform = transforms[relativePath];
        if (!transform) {
            throw new Error(`Unsupported Host Bridge target: ${relativePath}`);
        }
        const usesCrlf = source.includes('\r\n');
        const normalized = source.replace(/\r\n/g, '\n');
        const transformed = transform(normalized);
        return usesCrlf ? transformed.replace(/\n/g, '\r\n') : transformed;
    },
};

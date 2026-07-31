import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { afterEach, describe, expect, it } from 'vitest';

const temporaryRoots: string[] = [];

afterEach(() => {
    for (const root of temporaryRoots.splice(0)) {
        fs.rmSync(root, { recursive: true, force: true });
    }
    delete (globalThis as any).SillyTavern;
    delete (globalThis as any).STAuthorityHostBridge;
});

async function loadRuntime() {
    const runtimePath = path.resolve(
        process.cwd(),
        'host-bridge',
        'assets',
        'src',
        'authority-host-bridge.js',
    );
    return await import(`${pathToFileURL(runtimePath).href}?test=${Date.now()}-${Math.random()}`);
}

async function loadBrowserRuntime() {
    const runtimePath = path.resolve(
        process.cwd(),
        'host-bridge',
        'assets',
        'public',
        'scripts',
        'authority-host-bridge.js',
    );
    return await import(`${pathToFileURL(runtimePath).href}?test=${Date.now()}-${Math.random()}`);
}

function writeChat(filePath: string, chat: unknown[]): void {
    fs.writeFileSync(filePath, chat.map(item => JSON.stringify(item)).join('\n'), 'utf8');
}

describe('Authority Host Bridge runtimes', () => {
    it('assigns durable identities and advances the authoritative revision', async () => {
        const runtime = await loadRuntime();
        const root = fs.mkdtempSync(path.join(os.tmpdir(), 'authority-host-runtime-'));
        temporaryRoots.push(root);
        const chatPath = path.join(root, 'chat.jsonl');
        const firstChat: any[] = [
            { chat_metadata: { authority: { conversationId: 'client-provisional', branchId: 'client-branch' } } },
            { is_user: true, mes: 'hello' },
            { is_user: false, mes: 'world', swipe_id: 0, swipe_info: [{}] },
        ];

        const first = await runtime.prepareAuthorityChatSave(firstChat, chatPath, {
            expectedRevision: 0,
            transaction: { eventId: 'event:first', transactionId: 'transaction:first' },
        });
        writeChat(chatPath, firstChat);

        expect(first.host.revision).toBe(1);
        expect(first.host.baseRevision).toBe(0);
        expect(first.host.conversationId).not.toBe('client-provisional');
        expect(firstChat[1].authority.messageUid).toMatch(/^message:/);
        expect(firstChat[2].swipe_info[0].authority.swipeUid).toMatch(/^swipe:/);

        const second = await runtime.prepareAuthorityChatSave(firstChat, chatPath, {
            expectedRevision: 1,
            transaction: { eventId: 'event:second', transactionId: 'transaction:second' },
        });

        expect(second.host.revision).toBe(2);
        expect(second.host.conversationId).toBe(first.host.conversationId);
        expect(second.host.branchId).toBe(first.host.branchId);
    });

    it('adopts a provisional identity only for an existing legacy file and reports branch parentage', async () => {
        const runtime = await loadRuntime();
        const root = fs.mkdtempSync(path.join(os.tmpdir(), 'authority-host-runtime-'));
        temporaryRoots.push(root);
        const legacyPath = path.join(root, 'legacy.jsonl');
        writeChat(legacyPath, [
            { chat_metadata: {} },
            { is_user: true, mes: 'legacy' },
        ]);
        const legacyIncoming: any[] = [
            {
                chat_metadata: {
                    authority: {
                        conversationId: 'conversation:adopted',
                        branchId: 'branch:adopted',
                        revision: 0,
                    },
                },
            },
            { is_user: true, mes: 'legacy' },
        ];

        const adopted = runtime.prepareAuthorityChatSave(legacyIncoming, legacyPath, {
            expectedRevision: 0,
        });
        expect(adopted.host).toMatchObject({
            conversationId: 'conversation:adopted',
            branchId: 'branch:adopted',
            baseRevision: 0,
            revision: 1,
        });

        const branchPath = path.join(root, 'branch.jsonl');
        const branchIncoming = structuredClone(legacyIncoming);
        const branched = runtime.prepareAuthorityChatSave(branchIncoming, branchPath, {
            expectedRevision: 0,
        });
        expect(branched.host.conversationId).not.toBe('conversation:adopted');
        expect(branched.host.branchId).not.toBe('branch:adopted');
        expect(branched.host).toMatchObject({
            parentConversationId: 'conversation:adopted',
            parentBranchId: 'branch:adopted',
            parentRevision: 1,
        });
    });

    it('rejects a stale expected revision without mutating the incoming chat', async () => {
        const runtime = await loadRuntime();
        const root = fs.mkdtempSync(path.join(os.tmpdir(), 'authority-host-runtime-'));
        temporaryRoots.push(root);
        const chatPath = path.join(root, 'chat.jsonl');
        const persisted = [
            { chat_metadata: { authority: { conversationId: 'conversation:one', branchId: 'branch:one', revision: 4 } } },
            { is_user: true, mes: 'persisted', authority: { messageUid: 'message:one' } },
        ];
        writeChat(chatPath, persisted);
        const incoming = structuredClone(persisted);

        expect(() => runtime.prepareAuthorityChatSave(incoming, chatPath, {
            expectedRevision: 3,
            transaction: { eventId: 'event:stale' },
        })).toThrowError(runtime.AuthorityRevisionMismatchError);
        try {
            runtime.prepareAuthorityChatSave(incoming, chatPath, { expectedRevision: 3 });
        } catch (error) {
            expect(error).toMatchObject({
                name: 'AuthorityRevisionMismatchError',
                expectedRevision: 3,
                currentRevision: 4,
                conversationId: 'conversation:one',
            });
        }

        expect(incoming).toEqual(persisted);
    });

    it('reads an unbounded JSONL header instead of treating large metadata as a new chat', async () => {
        const runtime = await loadRuntime();
        const root = fs.mkdtempSync(path.join(os.tmpdir(), 'authority-host-runtime-'));
        temporaryRoots.push(root);
        const chatPath = path.join(root, 'chat.jsonl');
        const largeValue = 'x'.repeat(192 * 1024);
        const persisted = [
            {
                chat_metadata: {
                    largeValue,
                    authority: { conversationId: 'conversation:large', branchId: 'branch:large', revision: 7 },
                },
            },
            { is_user: true, mes: 'persisted' },
        ];
        writeChat(chatPath, persisted);
        const incoming = structuredClone(persisted);

        const receipt = runtime.prepareAuthorityChatSave(incoming, chatPath, { expectedRevision: 7 });

        expect(receipt.host.baseRevision).toBe(7);
        expect(receipt.host.revision).toBe(8);
        expect(receipt.host.conversationId).toBe('conversation:large');
    });

    it('keeps failed mutation events for retry and isolates them by conversation', async () => {
        const runtime = await loadBrowserRuntime();
        const chats = {
            a: { chatMetadata: {}, chat: [{ is_user: true, mes: 'a' }] },
            b: { chatMetadata: {}, chat: [{ is_user: true, mes: 'b' }] },
        };
        let active = chats.a;
        (globalThis as any).SillyTavern = { getContext: () => active };

        const eventA = runtime.beginAuthorityEvent('message_edited', [0]);
        const activeContext = runtime.captureAuthorityHostContext();
        expect(activeContext).toMatchObject({
            phase: 'event',
            sourceEventId: eventA.eventId,
            conversationId: eventA.conversationId,
            branchId: eventA.branchId,
            hostRevision: 0,
            baseHostRevision: 0,
        });
        expect(activeContext.messageUid).toMatch(/^message:/);
        runtime.endAuthorityEvent(eventA);
        const firstA = runtime.prepareAuthorityChatCommit({
            metadata: chats.a.chatMetadata,
            messages: chats.a.chat,
        });
        expect(firstA.transaction.sourceEvents).toHaveLength(1);

        await runtime.failAuthorityChatCommit(firstA, new Error('offline'));
        const retryA = runtime.prepareAuthorityChatCommit({
            metadata: chats.a.chatMetadata,
            messages: chats.a.chat,
        });
        expect(retryA.transaction.sourceEvents.map((event: any) => event.eventId)).toEqual([eventA.eventId]);

        active = chats.b;
        const eventB = runtime.beginAuthorityEvent('message_sent', [0]);
        runtime.endAuthorityEvent(eventB);
        const isolatedA = runtime.prepareAuthorityChatCommit({
            metadata: chats.a.chatMetadata,
            messages: chats.a.chat,
        });
        const firstB = runtime.prepareAuthorityChatCommit({
            metadata: chats.b.chatMetadata,
            messages: chats.b.chat,
        });
        expect(isolatedA.transaction.sourceEvents.map((event: any) => event.eventId)).toEqual([eventA.eventId]);
        expect(firstB.transaction.sourceEvents.map((event: any) => event.eventId)).toEqual([eventB.eventId]);

        active = chats.a;
        await runtime.completeAuthorityChatCommit(isolatedA, {
            host: {
                conversationId: isolatedA.transaction.conversationId,
                branchId: isolatedA.transaction.branchId,
                revision: 1,
            },
        }, { metadata: chats.a.chatMetadata, messages: chats.a.chat });
        const snapshotContext = runtime.captureAuthorityHostContext();
        expect(snapshotContext).toMatchObject({
            phase: 'snapshot',
            hostRevision: 1,
            baseHostRevision: 0,
            commitEventId: isolatedA.transaction.eventId,
            commitTransactionId: isolatedA.transaction.transactionId,
        });
        const afterCommitA = runtime.prepareAuthorityChatCommit({
            metadata: chats.a.chatMetadata,
            messages: chats.a.chat,
        });
        expect(afterCommitA.transaction.sourceEvents).toHaveLength(0);
    });

    it('detaches shallow-copied branch metadata from the open parent chat', async () => {
        const runtime = await loadBrowserRuntime();
        const parentAuthority = {
            conversationId: 'conversation:parent',
            branchId: 'branch:parent',
            revision: 4,
            lastEventId: 'event:parent',
        };
        const parentMetadata: any = { authority: parentAuthority };
        const branchMetadata: any = { ...parentMetadata };
        const messages: any[] = [{ is_user: true, mes: 'branch prefix' }];

        const commit = runtime.prepareAuthorityChatCommit({
            metadata: branchMetadata,
            messages,
            chatKey: 'branch-file',
        });
        expect(branchMetadata.authority).not.toBe(parentAuthority);

        await runtime.completeAuthorityChatCommit(commit, {
            host: {
                conversationId: 'conversation:child',
                branchId: 'branch:child',
                revision: 1,
                parentConversationId: 'conversation:parent',
                parentBranchId: 'branch:parent',
                parentRevision: 4,
            },
        }, { metadata: branchMetadata, messages });

        expect(parentMetadata.authority).toEqual(parentAuthority);
        expect(branchMetadata.authority).toMatchObject({
            conversationId: 'conversation:child',
            branchId: 'branch:child',
            parentConversationId: 'conversation:parent',
            parentBranchId: 'branch:parent',
            parentRevision: 4,
        });
    });
});

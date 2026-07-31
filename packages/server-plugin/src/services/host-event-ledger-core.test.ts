import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import type { UserContext } from '../types.js';
import { CoreService } from './core-service.js';
import { HostEventLedgerService } from './host-event-ledger-service.js';
import { LockService } from './lock-service.js';

const shouldRun = process.env.CI === 'true' || process.env.AUTHORITY_REAL_CORE_TESTS === '1';
const temporaryRoots: string[] = [];
const runningCores: CoreService[] = [];

afterAll(async () => {
    for (const core of runningCores.splice(0)) await core.stop();
    for (const root of temporaryRoots.splice(0)) fs.rmSync(root, { recursive: true, force: true });
});

describe('Host Event ledger with managed authority-core', () => {
    it.runIf(shouldRun)('persists its migration, event and conversation head in real SQLite', async () => {
        const root = fs.mkdtempSync(path.join(os.tmpdir(), 'authority-host-ledger-core-'));
        temporaryRoots.push(root);
        const core = new CoreService({
            runtimeDir: path.resolve(process.cwd(), 'runtime'),
            cwd: root,
            logger: { info() {}, warn() {}, error() {} },
        });
        runningCores.push(core);
        expect((await core.start()).state).toBe('running');
        const service = new HostEventLedgerService(core, new LockService());
        const user: UserContext = { handle: 'core-test', isAdmin: false, rootDir: path.join(root, 'user') };
        fs.mkdirSync(user.rootDir, { recursive: true });
        const commit = {
            schemaVersion: 1 as const,
            eventId: 'event:real-core',
            transactionId: 'transaction:real-core',
            conversationId: 'conversation:real-core',
            branchId: 'branch:real-core',
            baseRevision: 0,
            revision: 1,
            operation: 'chat.save',
            sourceEventIds: ['host-event:real-core'],
            changes: [{ kind: 'message-inserted', messageUid: 'message:real-core', index: 0 }],
            committedAt: '2026-08-01T00:00:00.000Z',
        };

        const recorded = await service.recordCommit(user, commit, 'third-party/st-authority-sdk');
        const replayed = await service.recordCommit(user, commit, 'third-party/st-authority-sdk');
        const listed = await service.listEvents(user, { conversationId: commit.conversationId });

        expect(recorded.replayed).toBe(false);
        expect(replayed.replayed).toBe(true);
        expect(listed.events).toHaveLength(1);
        expect(listed.events[0]?.changes?.[0]?.messageUid).toBe('message:real-core');
        expect(listed.conversation).toMatchObject({ revision: 1, lastEventId: commit.eventId });
    }, 30_000);
});

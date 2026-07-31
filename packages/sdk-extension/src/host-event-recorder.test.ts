import { afterEach, describe, expect, it, vi } from 'vitest';

const initMock = vi.hoisted(() => vi.fn());

vi.mock('./sdk.js', () => ({ AuthoritySDK: { init: initMock } }));
vi.mock('./api.js', () => ({
    AUTHORITY_EXTENSION_DISPLAY_NAME: 'Authority',
    AUTHORITY_EXTENSION_ID: 'third-party/st-authority-sdk',
    AUTHORITY_EXTENSION_VERSION: '1.0.0',
}));

afterEach(() => {
    vi.restoreAllMocks();
    delete (globalThis as any).STAuthorityHostBridge;
    delete (globalThis as any).addEventListener;
    delete (globalThis as any).removeEventListener;
    delete (globalThis as any).dispatchEvent;
});

describe('Host Event recorder', () => {
    it('silently reconciles the latest persisted commit and strips raw event arguments', async () => {
        const target = new EventTarget();
        (globalThis as any).addEventListener = target.addEventListener.bind(target);
        (globalThis as any).removeEventListener = target.removeEventListener.bind(target);
        (globalThis as any).dispatchEvent = target.dispatchEvent.bind(target);
        const recordCommit = vi.fn().mockResolvedValue({ ok: true, replayed: false });
        initMock.mockResolvedValue({ host: { recordCommit } });
        (globalThis as any).STAuthorityHostBridge = {
            getLatestCommit: () => ({
                ...commit(),
                sourceEvents: [{ eventId: 'host-event:one', argsSummary: ['private message text'] }],
            }),
        };

        const { bootstrapHostEventRecorder } = await import('./host-event-recorder.js');
        bootstrapHostEventRecorder();

        await vi.waitFor(() => expect(recordCommit).toHaveBeenCalledTimes(1));
        expect(recordCommit).toHaveBeenCalledWith({
            ...commit(),
            sourceEventIds: ['host-event:one'],
        });
        expect(initMock).toHaveBeenCalledWith(expect.objectContaining({
            extensionId: 'third-party/st-authority-sdk',
            installType: 'system',
            declaredPermissions: {},
        }));
    });
});

function commit() {
    return {
        schemaVersion: 1,
        eventId: 'event:one',
        transactionId: 'transaction:one',
        conversationId: 'conversation:one',
        branchId: 'branch:one',
        baseRevision: 0,
        revision: 1,
        operation: 'chat.save',
        committedAt: '2026-08-01T00:00:00.000Z',
    };
}

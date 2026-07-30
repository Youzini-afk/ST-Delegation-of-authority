import { describe, expect, it, vi } from 'vitest';
import type { WorkspaceFileDiffResponse } from '@stdo/shared-types';
import type { AuthorityRuntime } from '../runtime.js';
import type { AuthorityRequest, AuthorityResponse, SessionRecord } from '../types.js';
import { registerAgentHistoryRoutes } from './agent-history-routes.js';

type Handler = (req: AuthorityRequest, res: AuthorityResponse) => void | Promise<void>;

describe('Agent workspace admin routes', () => {
    it('requires an Authority session in addition to the ST administrator identity', async () => {
        const fixture = setup();
        fixture.runtime.sessions.assertSession = vi.fn().mockRejectedValue(new Error('Invalid authority session')) as never;

        await expect(fixture.get.get('/admin/agent/workspaces')!(request(true), response()))
            .rejects.toThrow('Invalid authority session');
        expect(fixture.runtime.workspaceHistory.listWorkspaces).not.toHaveBeenCalled();
    });

    it('rejects a non-admin after authenticating the Authority caller', async () => {
        const fixture = setup(false);

        await expect(fixture.get.get('/admin/agent/workspaces')!(request(false), response()))
            .rejects.toThrow('Forbidden');
        expect(fixture.runtime.sessions.assertSession).toHaveBeenCalledTimes(1);
    });

    it('audits workspace mutations under the authenticated extension identity', async () => {
        const fixture = setup(true, 'third-party/workspace-admin');
        const res = response();

        await fixture.post.get('/admin/agent/workspaces')!(request(true, {
            id: 'workspace-a',
            rootPath: 'C:\\workspace',
        }), res);

        expect(fixture.runtime.workspaceHistory.registerWorkspace).toHaveBeenCalledWith(expect.objectContaining({
            id: 'workspace-a',
            allowedUserHandles: ['alice'],
        }));
        expect(fixture.runtime.audit.logUsage).toHaveBeenCalledWith(
            expect.objectContaining({ handle: 'alice' }),
            'third-party/workspace-admin',
            'Agent workspace registered',
            { workspaceId: 'workspace-a' },
        );
    });

    it('uses Express-decoded workspace ids without decoding literal percent sequences twice', async () => {
        const fixture = setup();
        const req = request(true);
        req.params = { workspaceId: 'workspace%2Fname' };

        await fixture.get.get('/admin/agent/workspaces/:workspaceId')!(req, response());

        expect(fixture.runtime.workspaceHistory.getWorkspace).toHaveBeenCalledWith('workspace%2Fname');
    });

    it('returns the real record for the built-in SillyTavern scope', async () => {
        const fixture = setup();
        const res = response();

        await fixture.get.get('/admin/agent/workspaces/default')!(request(true), res);

        expect(fixture.runtime.install.getSillyTavernRoot).toHaveBeenCalledTimes(1);
        expect(fixture.runtime.workspaceHistory.registerWorkspace).toHaveBeenCalledWith({
            id: 'sillytavern',
            displayName: 'SillyTavern',
            rootPath: 'C:\\SillyTavern',
        });
        expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ id: 'workspace-a' }));
    });

    it('loads one exact file diff and preserves the working-tree target', async () => {
        const fixture = setup();
        const result: WorkspaceFileDiffResponse = {
            workspaceId: 'workspace-a',
            path: ' src/file name.ts ',
            status: 'modified',
            fromCommitId: null,
            toCommitId: null,
            toWorkingTree: true,
            kind: 'text',
            hunks: [],
            truncated: false,
        };
        vi.mocked(fixture.runtime.workspaceHistory.diffFile).mockResolvedValue(result);
        const req = request(true);
        req.params = { workspaceId: 'workspace-a' };
        req.query = { path: ' src/file name.ts ', from: 'empty', to: 'working' };
        const res = response();

        await fixture.get.get('/admin/agent/workspaces/:workspaceId/diff/file')!(req, res);

        expect(fixture.runtime.workspaceHistory.diffFile).toHaveBeenCalledWith(
            'workspace-a',
            null,
            'working',
            ' src/file name.ts ',
        );
        expect(res.json).toHaveBeenCalledWith(result);
    });
});

function setup(isAdmin = true, extensionId = 'third-party/ext-a') {
    const get = new Map<string, Handler>();
    const post = new Map<string, Handler>();
    const session = {
        token: 'session-token',
        userHandle: 'alice',
        isAdmin,
        extension: { id: extensionId, displayName: 'Ext A', version: '1.0.0', installType: 'local' },
    } as SessionRecord;
    const workspace = {
        id: 'workspace-a',
        displayName: 'Workspace A',
        rootPath: 'C:\\workspace',
        allowedUserHandles: ['alice'],
        defaultRef: 'main',
        headCommitId: null,
        createdAt: '2026-01-01T00:00:00.000Z',
        updatedAt: '2026-01-01T00:00:00.000Z',
    };
    const runtime = {
        sessions: { assertSession: vi.fn().mockResolvedValue(session) },
        install: { getSillyTavernRoot: vi.fn(() => 'C:\\SillyTavern') },
        workspaceHistory: {
            listWorkspaces: vi.fn(() => [workspace]),
            registerWorkspace: vi.fn().mockResolvedValue(workspace),
            getWorkspace: vi.fn(() => workspace),
            status: vi.fn(),
            listCommits: vi.fn(() => []),
            diff: vi.fn(),
            diffFile: vi.fn(),
            checkpoint: vi.fn(),
            rollback: vi.fn(),
            resumeRollback: vi.fn(),
        },
        audit: { logUsage: vi.fn().mockResolvedValue(undefined) },
    } as unknown as AuthorityRuntime;
    const fail = vi.fn((_runtime, _req, _res, _extensionId, error: unknown) => {
        throw error;
    });
    registerAgentHistoryRoutes({
        get: (path, handler) => get.set(path, handler),
        post: (path, handler) => post.set(path, handler),
    }, runtime, fail);
    return { runtime, get, post };
}

function request(isAdmin: boolean, body?: unknown): AuthorityRequest {
    return {
        headers: { 'x-authority-session-token': 'session-token' },
        ...(body === undefined ? {} : { body }),
        user: {
            profile: { handle: 'alice', admin: isAdmin },
            directories: { root: 'C:\\users\\alice' },
        },
    };
}

function response(): AuthorityResponse {
    const res = {} as AuthorityResponse;
    Object.assign(res, {
        status: vi.fn(() => res),
        json: vi.fn(),
        send: vi.fn(),
        setHeader: vi.fn(),
        write: vi.fn(),
        end: vi.fn(),
        on: vi.fn(),
    });
    return res;
}

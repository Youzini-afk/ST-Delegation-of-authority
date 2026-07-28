import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { WorkspaceRefRecord } from '@stdo/shared-types';
import { WorkspaceHistoryService } from './workspace-history-service.js';

const tempDirs: string[] = [];

afterEach(() => {
    vi.restoreAllMocks();
    for (const dir of tempDirs.splice(0)) {
        fs.rmSync(dir, { recursive: true, force: true });
    }
});

describe('WorkspaceHistoryService', () => {
    it('tracks only requested paths and builds deduplicated history', async () => {
        const fixture = await createFixture();
        write(fixture.root, 'tracked.txt', 'one');
        write(fixture.root, 'untracked.txt', 'outside history');

        const first = await fixture.service.checkpoint('test', {
            message: 'initial',
            paths: ['tracked.txt'],
        }, { kind: 'user', id: 'tester' });
        expect(first.changedPaths).toBe(1);
        expect(first.storedBytes).toBeGreaterThan(0);

        write(fixture.root, 'tracked.txt', 'two');
        const second = await fixture.service.checkpoint('test', {
            message: 'update',
            paths: ['tracked.txt'],
        }, { kind: 'agent', id: 'run-1' });
        expect(fixture.service.diff('test', first.commit.id, second.commit.id).entries).toMatchObject([
            { path: 'tracked.txt', status: 'modified' },
        ]);
        expect(fixture.service.listCommits('test').map(commit => commit.id)).toEqual([
            second.commit.id,
            first.commit.id,
        ]);

        write(fixture.root, 'untracked.txt', 'changed but still outside history');
        expect(await fixture.service.status('test')).toMatchObject({ dirty: false, changes: [] });

        fs.rmSync(path.join(fixture.root, 'tracked.txt'));
        const third = await fixture.service.checkpoint('test', {
            message: 'delete',
            paths: ['tracked.txt'],
        }, { kind: 'agent' });
        expect(fixture.service.diff('test', second.commit.id, third.commit.id).entries).toMatchObject([
            { path: 'tracked.txt', status: 'deleted' },
        ]);
    });

    it('refuses dirty rollback unless forced and preserves the displaced state', async () => {
        const fixture = await createFixture();
        write(fixture.root, 'config/settings.json', '{"version":1}');
        const first = await fixture.service.checkpoint('test', {
            message: 'version one',
            paths: ['config'],
        }, { kind: 'user' });

        write(fixture.root, 'config/settings.json', '{"version":2}');
        await fixture.service.checkpoint('test', {
            message: 'version two',
            paths: ['config'],
        }, { kind: 'agent' });
        write(fixture.root, 'config/settings.json', '{"version":3,"dirty":true}');

        await expect(fixture.service.rollback('test', {
            targetCommitId: first.commit.id,
        }, { kind: 'user' })).rejects.toMatchObject({ name: 'WorkspaceConflictError', status: 409 });
        await expect(fixture.service.rollback('test', {
            targetCommitId: first.commit.id,
            force: 'false' as unknown as boolean,
        }, { kind: 'user' })).rejects.toMatchObject({ status: 400, code: 'validation_error' });

        const rollback = await fixture.service.rollback('test', {
            targetCommitId: first.commit.id,
            force: true,
        }, { kind: 'user' });
        expect(read(fixture.root, 'config/settings.json')).toBe('{"version":1}');
        expect((await fixture.service.status('test')).dirty).toBe(false);

        const safetyCommitId = rollback.rollbackCommit.parents[0];
        expect(safetyCommitId).toBeTruthy();
        await fixture.service.rollback('test', {
            targetCommitId: safetyCommitId!,
        }, { kind: 'user' });
        expect(read(fixture.root, 'config/settings.json')).toBe('{"version":3,"dirty":true}');
    });

    it('restores nested creations, edits, and deletions without touching excluded trees', async () => {
        const fixture = await createFixture();
        write(fixture.root, 'plugins/demo/a.txt', 'a1');
        write(fixture.root, 'plugins/demo/remove.txt', 'restore me');
        const first = await fixture.service.checkpoint('test', {
            message: 'plugin baseline',
            paths: ['plugins/demo'],
        }, { kind: 'user' });

        write(fixture.root, 'plugins/demo/a.txt', 'a2');
        write(fixture.root, 'plugins/demo/new/deep.txt', 'remove me');
        fs.rmSync(path.join(fixture.root, 'plugins/demo/remove.txt'));
        await fixture.service.checkpoint('test', {
            message: 'plugin mutation',
            paths: ['plugins/demo'],
        }, { kind: 'agent' });

        await fixture.service.rollback('test', { targetCommitId: first.commit.id }, { kind: 'user' });
        expect(read(fixture.root, 'plugins/demo/a.txt')).toBe('a1');
        expect(read(fixture.root, 'plugins/demo/remove.txt')).toBe('restore me');
        expect(fs.existsSync(path.join(fixture.root, 'plugins/demo/new'))).toBe(false);

        write(fixture.root, '.git/config', 'do not snapshot');
        await expect(fixture.service.checkpoint('test', {
            message: 'forbidden internals',
            paths: ['.git'],
        }, { kind: 'user' })).rejects.toThrow(/excludes path/);
    });

    it('serializes concurrent checkpoints into one linear ref', async () => {
        const fixture = await createFixture();
        write(fixture.root, 'state.txt', 'same state');
        await Promise.all([
            fixture.service.checkpoint('test', { message: 'first', paths: ['state.txt'] }, { kind: 'agent' }),
            fixture.service.checkpoint('test', { message: 'second', paths: ['state.txt'] }, { kind: 'agent' }),
        ]);
        const commits = fixture.service.listCommits('test');
        expect(commits).toHaveLength(2);
        expect(commits[0]?.parents).toEqual([commits[1]?.id]);
    });

    it('finishes a durable ref journal after interruption', async () => {
        const fixture = await createFixture();
        write(fixture.root, 'state.txt', 'one');
        const first = await fixture.service.checkpoint('test', {
            message: 'one',
            paths: ['state.txt'],
        }, { kind: 'agent' });
        write(fixture.root, 'state.txt', 'two');
        const second = await fixture.service.checkpoint('test', {
            message: 'two',
            paths: ['state.txt'],
        }, { kind: 'agent' });

        const refPath = path.join(fixture.store, 'refs', 'test', 'main.json');
        const currentRef = JSON.parse(fs.readFileSync(refPath, 'utf8')) as WorkspaceRefRecord;
        const interruptedRef: WorkspaceRefRecord = {
            ...currentRef,
            head: first.commit.id,
            generation: currentRef.generation - 1,
        };
        fs.writeFileSync(refPath, JSON.stringify(interruptedRef), 'utf8');
        fs.writeFileSync(path.join(fixture.store, 'journals', 'test.json'), JSON.stringify({
            format: 'authority-workspace-ref-journal/v1',
            workspaceId: 'test',
            expectedGeneration: interruptedRef.generation,
            next: currentRef,
            createdAt: new Date().toISOString(),
        }), 'utf8');

        expect((await fixture.service.status('test')).workspace.headCommitId).toBe(second.commit.id);
        expect(fs.existsSync(path.join(fixture.store, 'journals', 'test.json'))).toBe(false);
    });

    it('restores a sparse path without deleting untracked siblings', async () => {
        const fixture = await createFixture();
        write(fixture.root, 'd/keep.txt', 'keep');
        write(fixture.root, 'd/node_modules/cache.txt', 'also keep');
        const missing = await fixture.service.checkpoint('test', {
            message: 'a is absent',
            paths: ['d/a.txt'],
        }, { kind: 'user' });

        write(fixture.root, 'd/a.txt', 'remove');
        await fixture.service.checkpoint('test', {
            message: 'a exists',
            paths: ['d/a.txt'],
        }, { kind: 'agent' });

        await fixture.service.rollback('test', { targetCommitId: missing.commit.id }, { kind: 'user' });
        expect(fs.existsSync(path.join(fixture.root, 'd/a.txt'))).toBe(false);
        expect(read(fixture.root, 'd/keep.txt')).toBe('keep');
        expect(read(fixture.root, 'd/node_modules/cache.txt')).toBe('also keep');
    });

    it('uses the target commit scope instead of deleting paths tracked only by the current head', async () => {
        const fixture = await createFixture();
        write(fixture.root, 'd/a.txt', 'a1');
        write(fixture.root, 'd/b.txt', 'b1');
        const narrow = await fixture.service.checkpoint('test', {
            message: 'only a',
            paths: ['d/a.txt'],
        }, { kind: 'user' });
        write(fixture.root, 'd/a.txt', 'a2');
        write(fixture.root, 'd/b.txt', 'b2');
        await fixture.service.checkpoint('test', {
            message: 'whole directory',
            paths: ['d'],
        }, { kind: 'agent' });

        await fixture.service.rollback('test', { targetCommitId: narrow.commit.id }, { kind: 'user' });
        expect(read(fixture.root, 'd/a.txt')).toBe('a1');
        expect(read(fixture.root, 'd/b.txt')).toBe('b2');
    });

    it('requires force before a wider target overwrites paths untracked by the current head', async () => {
        const fixture = await createFixture();
        write(fixture.root, 'd/a.txt', 'a1');
        write(fixture.root, 'd/b.txt', 'b1');
        const narrow = await fixture.service.checkpoint('test', {
            message: 'narrow',
            paths: ['d/a.txt'],
        }, { kind: 'user' });
        write(fixture.root, 'd/b.txt', 'b2');
        const wide = await fixture.service.checkpoint('test', {
            message: 'wide',
            paths: ['d'],
        }, { kind: 'agent' });
        await fixture.service.rollback('test', { targetCommitId: narrow.commit.id }, { kind: 'user' });
        write(fixture.root, 'd/b.txt', 'external');

        await expect(fixture.service.rollback('test', {
            targetCommitId: wide.commit.id,
        }, { kind: 'user' })).rejects.toMatchObject({ name: 'WorkspaceConflictError', status: 409 });
        await fixture.service.rollback('test', {
            targetCommitId: wide.commit.id,
            force: true,
        }, { kind: 'user' });
        expect(read(fixture.root, 'd/b.txt')).toBe('b2');
    });

    it('captures and restores a blocking ancestor instead of following it', async () => {
        const fixture = await createFixture();
        write(fixture.root, 'd/a.txt', 'one');
        const first = await fixture.service.checkpoint('test', {
            message: 'one',
            paths: ['d/a.txt'],
        }, { kind: 'user' });
        write(fixture.root, 'd/a.txt', 'two');
        await fixture.service.checkpoint('test', {
            message: 'two',
            paths: ['d/a.txt'],
        }, { kind: 'agent' });
        fs.rmSync(path.join(fixture.root, 'd'), { recursive: true });
        write(fixture.root, 'd', 'blocking file');

        const rollback = await fixture.service.rollback('test', {
            targetCommitId: first.commit.id,
            force: true,
        }, { kind: 'user' });
        expect(read(fixture.root, 'd/a.txt')).toBe('one');

        await fixture.service.rollback('test', {
            targetCommitId: rollback.rollbackCommit.parents[0]!,
            force: true,
        }, { kind: 'user' });
        expect(read(fixture.root, 'd')).toBe('blocking file');
    });

    it('returns the same completed rollback for the same operation id', async () => {
        const fixture = await createFixture();
        write(fixture.root, 'state.txt', 'one');
        const first = await fixture.service.checkpoint('test', {
            message: 'one',
            paths: ['state.txt'],
        }, { kind: 'user' });
        write(fixture.root, 'state.txt', 'two');
        await fixture.service.checkpoint('test', {
            message: 'two',
            paths: ['state.txt'],
        }, { kind: 'agent' });

        const request = { targetCommitId: first.commit.id, operationId: 'stable-operation' };
        const firstResponse = await fixture.service.rollback('test', request, { kind: 'user' });
        const commitCount = fixture.service.listCommits('test').length;
        const retryResponse = await fixture.service.rollback('test', request, { kind: 'user' });

        expect(retryResponse.operationId).toBe('stable-operation');
        expect(retryResponse.rollbackCommit.id).toBe(firstResponse.rollbackCommit.id);
        expect(fixture.service.listCommits('test')).toHaveLength(commitCount);
    });

    it('resumes from a pre-ref journal and preserves writes made before recovery', async () => {
        const fixture = await createFixture();
        write(fixture.root, 'state.txt', 'one');
        const first = await fixture.service.checkpoint('test', {
            message: 'one',
            paths: ['state.txt'],
        }, { kind: 'user' });
        write(fixture.root, 'state.txt', 'two');
        await fixture.service.checkpoint('test', {
            message: 'two',
            paths: ['state.txt'],
        }, { kind: 'agent' });

        const refPath = path.resolve(fixture.store, 'refs', 'test', 'main.json');
        const renameSync = fs.renameSync.bind(fs);
        let interrupted = false;
        vi.spyOn(fs, 'renameSync').mockImplementation((from, to) => {
            if (!interrupted && path.resolve(String(to)) === refPath) {
                interrupted = true;
                throw Object.assign(new Error('simulated interruption'), { code: 'EIO' });
            }
            renameSync(from, to);
        });
        await expect(fixture.service.rollback('test', {
            targetCommitId: first.commit.id,
            operationId: 'recover-operation',
        }, { kind: 'user' })).rejects.toThrow('simulated interruption');
        vi.restoreAllMocks();

        write(fixture.root, 'state.txt', 'external write');
        const resumed = await fixture.service.resumeRollback('test');
        expect(read(fixture.root, 'state.txt')).toBe('one');
        expect(resumed.operationId).toBe('recover-operation');

        await fixture.service.rollback('test', {
            targetCommitId: resumed.rollbackCommit.parents[0]!,
            operationId: 'restore-recovery-safety',
        }, { kind: 'rescue' });
        expect(read(fixture.root, 'state.txt')).toBe('external write');
    });

    it('does not steal old locks whose owner cannot be proven dead', async () => {
        const fixture = await createFixture();
        write(fixture.root, 'state.txt', 'one');
        const lockPath = path.join(fixture.store, 'locks', 'workspace-test.lock');
        fs.writeFileSync(lockPath, JSON.stringify({
            token: 'someone-else',
            pid: process.pid,
            hostname: os.hostname(),
            createdAt: 0,
        }));
        const contender = new WorkspaceHistoryService(fixture.store, { lockTimeoutMs: 10, staleLockMs: 1 });

        await expect(contender.checkpoint('test', {
            message: 'must wait',
            paths: ['state.txt'],
        }, { kind: 'agent' })).rejects.toThrow(/Timed out waiting/);
        expect(JSON.parse(fs.readFileSync(lockPath, 'utf8'))).toMatchObject({ token: 'someone-else' });
        fs.rmSync(lockPath);

        fs.writeFileSync(lockPath, JSON.stringify({
            token: 'remote-owner',
            pid: 1,
            hostname: 'another-host',
            createdAt: 0,
        }));
        await expect(contender.checkpoint('test', {
            message: 'must also wait for remote owner',
            paths: ['state.txt'],
        }, { kind: 'agent' })).rejects.toThrow(/Timed out waiting/);
        expect(JSON.parse(fs.readFileSync(lockPath, 'utf8'))).toMatchObject({ token: 'remote-owner' });
        fs.rmSync(lockPath);
    });

    it('rejects an empty requested path instead of snapshotting the whole workspace', async () => {
        const fixture = await createFixture();
        write(fixture.root, 'secret.txt', 'not requested');
        await expect(fixture.service.checkpoint('test', {
            message: 'bad path',
            paths: [''],
        }, { kind: 'user' })).rejects.toThrow(/must not be empty/);
        expect(fixture.service.listCommits('test')).toHaveLength(0);
    });
});

async function createFixture(): Promise<{ root: string; store: string; service: WorkspaceHistoryService }> {
    const base = fs.mkdtempSync(path.join(os.tmpdir(), 'authority-history-'));
    tempDirs.push(base);
    const root = path.join(base, 'workspace');
    const store = path.join(base, 'history');
    fs.mkdirSync(root, { recursive: true });
    const service = new WorkspaceHistoryService(store);
    await service.registerWorkspace({ id: 'test', displayName: 'Test workspace', rootPath: root });
    return { root, store, service };
}

function write(root: string, relativePath: string, content: string): void {
    const filePath = path.join(root, relativePath);
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    fs.writeFileSync(filePath, content, 'utf8');
}

function read(root: string, relativePath: string): string {
    return fs.readFileSync(path.join(root, relativePath), 'utf8');
}

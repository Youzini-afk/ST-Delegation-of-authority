import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { AgentHostToolService } from './agent-host-tools.js';
import { WorkspaceHistoryService } from './workspace-history-service.js';

const tempDirs: string[] = [];

afterEach(() => {
    delete process.env.DOA_AGENT_TEST_SECRET;
    for (const dir of tempDirs.splice(0)) {
        fs.rmSync(dir, { recursive: true, force: true });
    }
});

describe('AgentHostToolService', () => {
    it('provides bounded text tools and rejects symlink escapes', async () => {
        const fixture = await createFixture();
        const context = { workspace: fixture.workspace, runId: 'run-1', signal: new AbortController().signal };
        await fixture.tools.execute('host_write_file', { path: 'src/a.txt', content: 'alpha\nbeta\nalpha' }, context);
        expect(await fixture.tools.execute('host_search_text', { path: 'src', query: 'ALPHA' }, context)).toMatchObject({
            results: [{ path: 'src/a.txt', line: 1 }, { path: 'src/a.txt', line: 3 }],
        });
        expect(await fixture.tools.execute('host_replace_text', {
            path: 'src/a.txt',
            find: 'alpha',
            replace: 'gamma',
            all: true,
            expectedMatches: 2,
        }, context)).toMatchObject({ replacements: 2 });
        expect(await fixture.tools.execute('host_read_file', { path: 'src/a.txt', startLine: 2 }, context)).toMatchObject({
            content: 'beta\ngamma',
        });

        const outside = path.join(fixture.base, 'outside.txt');
        fs.writeFileSync(outside, 'secret');
        const link = path.join(fixture.root, 'escape.txt');
        try {
            fs.symlinkSync(outside, link, 'file');
        } catch (error) {
            if ((error as NodeJS.ErrnoException).code === 'EPERM') {
                return;
            }
            throw error;
        }
        await expect(fixture.tools.execute('host_read_file', { path: 'escape.txt' }, context)).rejects.toThrow(/symbolic link/);
    });

    it('runs shell commands with a minimal environment', async () => {
        const fixture = await createFixture();
        expect(fixture.tools.get('host_shell')).toMatchObject({ approvalPolicy: 'always' });
        expect(fixture.tools.checkpointPaths('host_shell', { command: 'anything', checkpointPaths: ['fake.txt'] })).toEqual(['.']);
        expect(fixture.tools.approvalSummary('host_shell', { command: 'anything' })).toContain('.git or node_modules cannot be rolled back');
        process.env.DOA_AGENT_TEST_SECRET = 'must-not-leak';
        const script = "process.stdout.write((process.env.DOA_AGENT_RUN_ID || '') + '|' + String(process.env.DOA_AGENT_TEST_SECRET))";
        const command = `"${process.execPath}" -e "${script}"`;
        const result = await fixture.tools.execute('host_shell', { command }, {
            workspace: fixture.workspace,
            runId: 'run-42',
            signal: new AbortController().signal,
        }) as any;
        expect(result).toMatchObject({ exitCode: 0, stdout: 'run-42|undefined', timedOut: false });
    });

    it('rejects directory junctions and symlinks that leave the workspace', async () => {
        const fixture = await createFixture();
        const outside = path.join(fixture.base, 'outside');
        fs.mkdirSync(outside);
        const link = path.join(fixture.root, 'linked');
        try {
            fs.symlinkSync(outside, link, process.platform === 'win32' ? 'junction' : 'dir');
        } catch (error) {
            if ((error as NodeJS.ErrnoException).code === 'EPERM') {
                return;
            }
            throw error;
        }
        const context = { workspace: fixture.workspace, runId: 'run-1', signal: new AbortController().signal };
        await expect(fixture.tools.execute('host_write_file', { path: 'linked/escape.txt', content: 'no' }, context)).rejects.toThrow(/non-directory|escapes/);
        await expect(fixture.tools.execute('host_list_files', { path: 'linked' }, context)).rejects.toThrow(/symbolic link|escapes/);
        expect(fs.existsSync(path.join(outside, 'escape.txt'))).toBe(false);
    });
});

async function createFixture() {
    const base = fs.mkdtempSync(path.join(os.tmpdir(), 'authority-agent-tools-'));
    tempDirs.push(base);
    const root = path.join(base, 'workspace');
    const store = path.join(base, 'history');
    fs.mkdirSync(root);
    const history = new WorkspaceHistoryService(store);
    const workspace = await history.registerWorkspace({ id: 'test', rootPath: root });
    return { base, root, history, workspace, tools: new AgentHostToolService(history) };
}

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
    it('provides complete text tools and rejects symlink escapes', async () => {
        const fixture = await createFixture();
        const context = toolContext(fixture.workspace);
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
            sessionId: 'session-1',
            runId: 'run-42',
            invocationId: 'invocation-1',
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
        const context = toolContext(fixture.workspace);
        await expect(fixture.tools.execute('host_write_file', { path: 'linked/escape.txt', content: 'no' }, context)).rejects.toThrow(/non-directory|escapes/);
        await expect(fixture.tools.execute('host_list_files', { path: 'linked' }, context)).rejects.toThrow(/symbolic link|escapes/);
        expect(fs.existsSync(path.join(outside, 'escape.txt'))).toBe(false);
    });

    it('persists complete shell output and lets the Agent page through it', async () => {
        const fixture = await createFixture();
        const context = toolContext(fixture.workspace);
        const command = `"${process.execPath}" -e "process.stdout.write('x'.repeat(300000))"`;
        const result = await fixture.tools.execute('host_shell', { command }, context) as any;

        expect(result.stdoutTruncated).toBe(true);
        expect(result.stdoutArtifact).toMatchObject({ bytes: 300000, encoding: 'utf8' });
        const page = await fixture.tools.execute('host_read_artifact', {
            artifactId: result.stdoutArtifact.artifactId,
            startByte: 275000,
            length: 1000,
        }, context) as any;
        expect(page).toMatchObject({ startByte: 275000, endByte: 276000, totalBytes: 300000 });
        expect(page.content).toBe('x'.repeat(1000));
        expect(Buffer.from(page.dataBase64, 'base64').toString('utf8')).toBe('x'.repeat(1000));

        const defaultPage = await fixture.tools.execute('host_read_artifact', {
            artifactId: result.stdoutArtifact.artifactId,
        }, context) as any;
        expect(defaultPage).toMatchObject({
            startByte: 0,
            endByte: 256 * 1024,
            nextByte: 256 * 1024,
            integrityVerified: false,
        });

        const verifiedPage = await fixture.tools.execute('host_read_artifact', {
            artifactId: result.stdoutArtifact.artifactId,
            startByte: 299000,
            length: 1000,
            verify: true,
        }, context) as any;
        expect(verifiedPage).toMatchObject({ endByte: 300000, nextByte: null, integrityVerified: true });

        const artifactPath = path.join(
            fixture.history.storeDir,
            'agent-tool-artifacts',
            context.sessionId,
            `${result.stdoutArtifact.artifactId}.txt`,
        );
        const descriptor = fs.openSync(artifactPath, 'r+');
        try {
            fs.writeSync(descriptor, Buffer.from('y'), 0, 1, 0);
        } finally {
            fs.closeSync(descriptor);
        }
        await expect(fixture.tools.execute('host_read_artifact', {
            artifactId: result.stdoutArtifact.artifactId,
            verify: true,
        }, context)).rejects.toThrow(/SHA-256 verification/);
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

function toolContext(workspace: Awaited<ReturnType<WorkspaceHistoryService['registerWorkspace']>>) {
    return {
        workspace,
        sessionId: 'session-1',
        runId: 'run-1',
        invocationId: 'invocation-1',
        signal: new AbortController().signal,
    };
}

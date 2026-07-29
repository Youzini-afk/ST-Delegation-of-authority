import { describe, expect, it } from 'vitest';
import type { AgentRunDetail } from '@stdo/shared-types';
import { isActiveAgentRun, renderAgentRunDetail, renderAgentWorkbench } from './agent-workbench.js';
import type { AgentWorkbenchState } from './types.js';

describe('Agent workbench rendering', () => {
    it('renders pending approvals as explicit escaped actions', () => {
        const detail = runDetail();

        const html = renderAgentRunDetail(detail);

        expect(html).toContain('&lt;unsafe&gt;');
        expect(html).not.toContain('<unsafe>');
        expect(html).toContain('data-decision="approve"');
        expect(html).toContain('data-decision="deny"');
        expect(html).toContain('data-action="agent-cancel-run"');
    });

    it('treats waiting states as active and terminal states as inactive', () => {
        expect(isActiveAgentRun('waiting_approval')).toBe(true);
        expect(isActiveAgentRun('waiting_browser_tool')).toBe(true);
        expect(isActiveAgentRun('completed')).toBe(false);
        expect(isActiveAgentRun('interrupted')).toBe(false);
    });

    it('redacts common secrets from Agent transcripts and tool payloads', () => {
        const detail = runDetail();
        detail.run.goal = 'Use sk-1234567890secret';
        detail.messages[0]!.content = 'Authorization: Bearer hidden-token';
        detail.approvals[0]!.arguments = { apiKey: 'approval-secret' };
        detail.invocations.push({
            callId: 'call-2',
            runId: 'run-1',
            toolId: 'host_read_file',
            execution: 'host',
            arguments: { path: 'safe.txt' },
            result: { access_token: 'result-secret' },
            status: 'completed',
            createdAt: '2026-01-01T00:00:01.000Z',
            updatedAt: '2026-01-01T00:00:02.000Z',
            deadlineAt: '2026-01-01T00:05:00.000Z',
        });

        const html = renderAgentRunDetail(detail);

        expect(html).toContain('[REDACTED]');
        expect(html).not.toContain('1234567890secret');
        expect(html).not.toContain('hidden-token');
        expect(html).not.toContain('approval-secret');
        expect(html).not.toContain('result-secret');
    });

    it('renders the three-pane IDE without dropping any action or form contract', () => {
        const html = renderAgentWorkbench(workbenchState());
        const actions = Array.from(html.matchAll(/data-action="([^"]+)"/g), match => match[1]).sort();
        const roles = Array.from(html.matchAll(/data-role="([^"]+)"/g), match => match[1]).sort();

        expect(html).toContain('class="authority-agent-rail"');
        expect(html).toContain('class="authority-agent-main"');
        expect(html).toContain('class="authority-agent-inspector"');
        expect(Array.from(new Set(actions))).toEqual([
            'agent-cancel-run',
            'agent-create-run',
            'agent-delete-profile',
            'agent-edit-profile',
            'agent-load-more-runs',
            'agent-new-profile',
            'agent-prune-runs',
            'agent-refresh',
            'agent-register-workspace',
            'agent-resolve-approval',
            'agent-save-profile',
            'agent-select-run',
            'agent-workspace-checkpoint',
            'agent-workspace-refresh',
            'agent-workspace-resume',
            'agent-workspace-rollback',
        ]);
        expect(Array.from(new Set(roles))).toEqual([
            'agent-checkpoint-message',
            'agent-profile-api-key',
            'agent-profile-base-url',
            'agent-profile-id',
            'agent-profile-max-tokens',
            'agent-profile-model',
            'agent-profile-name',
            'agent-profile-temperature',
            'agent-profile-timeout',
            'agent-run-detail',
            'agent-run-goal',
            'agent-run-instructions',
            'agent-run-max-steps',
            'agent-run-mode',
            'agent-run-profile',
            'agent-run-status',
            'agent-run-workspace',
            'agent-workspace-id',
            'agent-workspace-name',
            'agent-workspace-root',
            'agent-workspace-select',
            'agent-workspace-users',
        ]);
    });

    it('disables every interactive Agent control while a refresh or action is in progress', () => {
        const state = workbenchState();
        state.busy = true;
        const html = renderAgentWorkbench(state);
        const controls = Array.from(html.matchAll(/<(?:button|textarea|select|input)\b[^>]*>/g), match => match[0])
            .filter(control => !control.includes('type="hidden"'));

        expect(controls.length).toBeGreaterThan(0);
        for (const control of controls) {
            expect(control).toContain('disabled');
        }
    });
});

function workbenchState(): AgentWorkbenchState {
    const detail = runDetail();
    return {
        loaded: true,
        loading: false,
        busy: false,
        error: null,
        profiles: [{
            id: 'profile',
            displayName: 'Primary',
            model: 'model',
            baseUrl: 'https://example.test/v1',
            apiKeyConfigured: true,
            apiKeyMasked: '****',
            apiKeyFingerprint: 'fingerprint',
            temperature: 0.2,
            maxOutputTokens: 8192,
            timeoutMs: 120000,
        }],
        tools: [{
            id: 'host_write_file',
            title: 'Write file',
            description: 'Writes a file in the workspace.',
            execution: 'host',
            riskLevel: 'medium',
            approvalPolicy: 'ask',
        }],
        workspaces: [{
            id: 'workspace',
            displayName: 'Workspace',
            rootPath: 'D:\\workspace',
            allowedUserHandles: ['admin'],
            headCommitId: 'head-commit-id',
        }],
        runs: {
            runs: [detail.run],
            page: { totalCount: 1, hasMore: true },
        },
        selectedProfileId: 'profile',
        selectedWorkspaceId: 'workspace',
        selectedRun: detail,
        workspaceStatus: {
            dirty: true,
            pendingRollback: { commitId: 'old-commit-id' },
            changes: [{ path: 'src/index.ts', status: 'modified' }],
        },
        workspaceCommits: [
            { id: 'head-commit-id', message: 'Current', createdAt: '2026-01-02T00:00:00.000Z' },
            { id: 'old-commit-id', message: 'Previous', createdAt: '2026-01-01T00:00:00.000Z' },
        ],
        workspaceDiff: { entries: [{ path: 'src/index.ts', status: 'modified' }] },
        runStatus: '',
    } as unknown as AgentWorkbenchState;
}

function runDetail(): AgentRunDetail {
    return {
        run: {
            id: 'run-1',
            callerUserHandle: 'admin',
            callerExtensionId: 'third-party/st-authority-sdk',
            workspaceId: 'workspace',
            profileId: 'profile',
            goal: '<unsafe>',
            mode: 'ask',
            status: 'waiting_approval',
            allowedTools: ['host_write_file'],
            stepCount: 1,
            maxSteps: 4,
            createdAt: '2026-01-01T00:00:00.000Z',
            updatedAt: '2026-01-01T00:00:01.000Z',
        },
        messages: [{ role: 'assistant', content: 'Need approval' }],
        events: [],
        invocations: [],
        approvals: [{
            id: 'approval-1',
            runId: 'run-1',
            callId: 'call-1',
            toolId: 'host_write_file',
            title: 'Write file',
            summary: 'Write a file',
            arguments: { path: '<unsafe>' },
            riskLevel: 'medium',
            status: 'pending',
            createdAt: '2026-01-01T00:00:01.000Z',
            updatedAt: '2026-01-01T00:00:01.000Z',
        }],
    };
}

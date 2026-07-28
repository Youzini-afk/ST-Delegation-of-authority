import { describe, expect, it } from 'vitest';
import type { AgentRunDetail } from '@stdo/shared-types';
import { isActiveAgentRun, renderAgentRunDetail } from './agent-workbench.js';

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
});

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

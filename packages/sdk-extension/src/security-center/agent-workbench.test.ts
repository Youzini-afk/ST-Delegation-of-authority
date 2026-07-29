import { describe, expect, it } from 'vitest';
import type { AgentSessionSnapshot } from '@stdo/shared-types';
import {
    isActiveAgentSession,
    renderAgentWorkbench,
} from './agent-workbench.js';
import type { AgentWorkbenchState } from './types.js';

describe('Agent session workbench rendering', () => {
    it('keeps approvals in the activity inspector and escapes their content', () => {
        const state = workbenchState();
        state.selectedSession!.approvals[0]!.arguments = { path: '<unsafe>' };

        const html = renderAgentWorkbench(state);

        expect(html).toContain('&lt;unsafe&gt;');
        expect(html).not.toContain('<unsafe>');
        expect(html).toContain('data-decision="approve"');
        expect(html).toContain('data-decision="deny"');
        expect(html).toContain('data-action="agent-cancel-run"');
    });

    it('derives activity from the selected ref run instead of treating runs as navigation', () => {
        const running = sessionSnapshot('waiting_tool');
        const completed = sessionSnapshot('completed');
        const suspended = sessionSnapshot('suspended');

        expect(isActiveAgentSession(running)).toBe(true);
        expect(isActiveAgentSession(completed)).toBe(false);
        expect(isActiveAgentSession(suspended)).toBe(false);
        expect(isActiveAgentSession(null)).toBe(false);
    });

    it('redacts common secrets from conversation, approval, and tool diagnostics', () => {
        const state = workbenchState();
        const snapshot = state.selectedSession!;
        snapshot.conversation[1] = {
            ...snapshot.conversation[1]!,
            kind: 'message',
            role: 'assistant',
            content: 'Authorization: Bearer hidden-token and sk-1234567890secret',
        };
        snapshot.approvals[0]!.arguments = { apiKey: 'approval-secret' };
        snapshot.invocations[0]!.result = { access_token: 'result-secret' };

        const html = renderAgentWorkbench(state);

        expect(html).toContain('[REDACTED]');
        expect(html).not.toContain('hidden-token');
        expect(html).not.toContain('1234567890secret');
        expect(html).not.toContain('approval-secret');
        expect(html).not.toContain('result-secret');
    });

    it('renders a persistent three-pane conversation workspace, not a one-shot task launcher', () => {
        const html = renderAgentWorkbench(workbenchState());

        expect(html).toContain('class="authority-agent-rail"');
        expect(html).toContain('class="authority-agent-main"');
        expect(html).toContain('class="authority-agent-inspector"');
        expect(html).toContain('data-action="agent-new-session"');
        expect(html).toContain('data-action="agent-select-session"');
        expect(html).toContain('data-role="agent-message"');
        expect(html).toContain('data-action="agent-send-message"');
        expect(html).toContain('data-action="agent-inspector-tab"');
        expect(html).not.toContain('data-action="agent-create-run"');
        expect(html).not.toContain('data-action="agent-select-run"');
        expect(html).not.toContain('新建任务');
    });

    it('separates activity, workspace recovery, and session settings contracts', () => {
        const state = workbenchState();
        const activity = renderAgentWorkbench(state);

        state.inspectorTab = 'workspace';
        const workspace = renderAgentWorkbench(state);

        state.inspectorTab = 'settings';
        const settings = renderAgentWorkbench(state);

        expect(activity).toContain('data-action="agent-resolve-approval"');
        expect(workspace).toContain('data-action="agent-workspace-checkpoint"');
        expect(workspace).toContain('data-action="agent-workspace-rollback"');
        expect(settings).toContain('data-action="agent-update-session"');
        expect(settings).toContain('data-action="agent-save-profile"');
        expect(settings).toContain('data-role="agent-session-title"');
    });

    it('uses the first message to create a durable session', () => {
        const state = workbenchState();
        state.creatingSession = true;
        state.selectedSession = null;

        const html = renderAgentWorkbench(state);

        expect(html).toContain('data-role="agent-new-message"');
        expect(html).toContain('data-role="agent-new-workspace"');
        expect(html).toContain('data-role="agent-new-profile"');
        expect(html).toContain('data-action="agent-create-session"');
        expect(html).not.toContain('data-role="agent-run-goal"');
    });

    it('disables every interactive Agent control while a mutation is in progress', () => {
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
    const snapshot = sessionSnapshot('waiting_approval');
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
        sessions: {
            sessions: [{
                ...snapshot.session,
                status: 'waiting_approval',
                activeRunId: 'run-1',
                activeRunStatus: 'waiting_approval',
                messageCount: 2,
                pendingApprovalCount: 1,
                pendingMessageCount: 0,
                lastMessagePreview: 'Need approval',
                lastSequence: 5,
            }],
            page: { nextCursor: 'older', limit: 50, hasMore: true, totalCount: 2 },
        },
        selectedProfileId: 'profile',
        selectedWorkspaceId: 'workspace',
        selectedSession: snapshot,
        creatingSession: false,
        inspectorTab: 'activity',
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
    };
}

function sessionSnapshot(status: AgentSessionSnapshot['runs'][number]['status']): AgentSessionSnapshot {
    const timestamp = '2026-01-01T00:00:00.000Z';
    return {
        session: {
            id: 'session-1',
            callerUserHandle: 'admin',
            callerExtensionId: 'third-party/st-authority-sdk',
            workspaceId: 'workspace',
            title: 'Durable conversation',
            profileId: 'profile',
            mode: 'ask',
            allowedTools: ['host_write_file'],
            maxSteps: 4,
            createdAt: timestamp,
            updatedAt: timestamp,
        },
        lastSequence: 5,
        refs: [{
            name: 'main',
            leafEntryId: 'assistant-1',
            activeRunId: status === 'completed' ? null : 'run-1',
            createdAt: timestamp,
            updatedAt: timestamp,
        }],
        conversation: [{
            id: 'user-1',
            sequence: 1,
            ref: 'main',
            parentId: null,
            timestamp,
            runId: 'run-1',
            kind: 'message',
            role: 'user',
            content: 'Change the plugin safely',
        }, {
            id: 'assistant-1',
            sequence: 2,
            ref: 'main',
            parentId: 'user-1',
            timestamp,
            runId: 'run-1',
            kind: 'message',
            role: 'assistant',
            content: 'Need approval',
        }],
        activePaths: { main: ['user-1', 'assistant-1'] },
        runs: [{
            id: 'run-1',
            ref: 'main',
            triggerMessageId: 'user-1',
            status,
            profileId: 'profile',
            mode: 'ask',
            allowedTools: ['host_write_file'],
            maxSteps: 4,
            stepCount: 1,
            createdAt: timestamp,
            updatedAt: timestamp,
            resumeCount: 0,
        }],
        steps: [{
            id: 'step-1',
            runId: 'run-1',
            index: 0,
            status: 'running',
            createdAt: timestamp,
            updatedAt: timestamp,
        }],
        generations: [],
        invocations: [{
            id: 'invocation-1',
            runId: 'run-1',
            stepId: 'step-1',
            callId: 'call-1',
            toolId: 'host_write_file',
            execution: 'host',
            arguments: { path: 'src/index.ts' },
            status: 'waiting_approval',
            createdAt: timestamp,
            updatedAt: timestamp,
        }],
        approvals: [{
            id: 'approval-1',
            runId: 'run-1',
            invocationId: 'invocation-1',
            title: 'Write file',
            summary: 'Write a file',
            arguments: { path: 'src/index.ts' },
            riskLevel: 'medium',
            status: 'pending',
            createdAt: timestamp,
            updatedAt: timestamp,
        }],
        pendingMessages: [],
    };
}

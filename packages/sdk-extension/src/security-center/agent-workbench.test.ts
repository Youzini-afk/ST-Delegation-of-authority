import { describe, expect, it } from 'vitest';
import type { AgentSessionSnapshot } from '@stdo/shared-types';
import {
    getAgentStatusAnnouncement,
    isActiveAgentSession,
    renderAgentWorkbench,
} from './agent-workbench.js';
import { renderAgentSettings } from './agent-settings.js';
import type { AgentWorkbenchState } from './types.js';
import { workspaceFileDiffKey } from './workspace-diff-view.js';

describe('Agent session workbench rendering', () => {
    it('keeps approvals in the task context and escapes their content', () => {
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

    it('offers the correct direct recovery action for suspended and terminally failed runs', () => {
        const suspended = workbenchState();
        suspended.selectedSession = sessionSnapshot('suspended');
        suspended.selectedSession.runs[0]!.suspensionReason = 'Network outcome unknown';
        const suspendedHtml = renderAgentWorkbench(suspended);
        expect(suspendedHtml).toContain('data-action="agent-resume-run"');
        expect(suspendedHtml).toContain('确认后继续');
        expect(suspendedHtml).not.toContain('data-action="agent-continue-failed-run"');

        const failed = workbenchState();
        failed.selectedSession = sessionSnapshot('failed');
        failed.selectedSession.runs[0]!.error = 'provider failed; Authorization: Bearer hidden-token';
        const failedHtml = renderAgentWorkbench(failed);
        expect(failedHtml).toContain('data-action="agent-continue-failed-run"');
        expect(failedHtml).toContain('从当前状态继续');
        expect(failedHtml).toContain('[REDACTED]');
        expect(failedHtml).not.toContain('hidden-token');
        expect(failedHtml).not.toContain('data-action="agent-resume-run"');
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

    it('renders a persistent Session workspace, not a one-shot task launcher', () => {
        const html = renderAgentWorkbench(workbenchState());

        expect(html).toContain('class="authority-agent-rail"');
        expect(html).toContain('class="authority-agent-main"');
        expect(html).toContain('class="authority-agent-inspector"');
        expect(html).toContain('data-action="agent-new-session"');
        expect(html).toContain('data-action="agent-select-session"');
        expect(html).toContain('data-role="agent-message"');
        expect(html).toContain('data-action="agent-send-message"');
        expect(html).toContain('data-action="agent-inspector-tab"');
        expect(html).toContain('data-role="agent-session-filter"');
        expect(html).not.toContain('data-action="agent-create-run"');
        expect(html).not.toContain('data-action="agent-select-run"');
        expect(html).not.toContain('新建任务');
    });

    it('provides focused mobile surfaces and keeps pending approval in the conversation', () => {
        const html = renderAgentWorkbench(workbenchState());

        expect(html).toContain('data-mobile-surface="agent-sessions"');
        expect(html).toContain('data-mobile-surface="agent-inspector"');
        expect(html).toContain('class="authority-mobile-scrim"');
        expect(html).toContain('authority-agent-mobile-inspector-header');
        expect(html).toContain('authority-agent-mobile-approvals authority-mobile-only');
        expect(html.indexOf('authority-agent-mobile-approvals')).toBeGreaterThan(html.indexOf('data-role="agent-timeline"'));
        expect(html).toContain('允许这次操作');
        expect(html).toContain('拒绝并说明');
    });

    it('separates task activity from recoverable changes without exposing workspace setup', () => {
        const state = workbenchState();
        const activity = renderAgentWorkbench(state);

        state.inspectorTab = 'workspace';
        const changes = renderAgentWorkbench(state);

        expect(activity).toContain('data-action="agent-resolve-approval"');
        expect(changes).toContain('data-action="agent-workspace-checkpoint"');
        expect(changes).toContain('data-action="agent-workspace-rollback"');
        expect(changes).toContain('data-action="agent-file-diff"');
        expect(changes).toContain('data-diff-scope="working"');
        expect(changes).toContain('data-diff-scope="history"');
        expect(changes).not.toContain('data-role="agent-workspace-select"');
        expect(changes).not.toContain('data-action="agent-register-workspace"');
        expect(activity).not.toContain('工具目录');
        expect(activity).not.toContain('data-action="agent-save-profile"');
    });

    it('implements the Inspector as a complete roving tab interface', () => {
        const state = workbenchState();
        const activity = renderAgentWorkbench(state);

        state.inspectorTab = 'workspace';
        const workspace = renderAgentWorkbench(state);

        expect(activity).toContain('id="authority-agent-inspector-tab-activity"');
        expect(activity).toContain('aria-controls="authority-agent-inspector-panel-activity"');
        expect(activity).toContain('id="authority-agent-inspector-panel-activity" role="tabpanel"');
        expect(activity).toContain('aria-labelledby="authority-agent-inspector-tab-activity"');
        expect(activity).toContain('data-inspector-tab="activity" aria-selected="true" aria-controls="authority-agent-inspector-panel-activity" tabindex="0"');
        expect(activity).toContain('data-inspector-tab="workspace" aria-selected="false" aria-controls="authority-agent-inspector-panel-workspace" tabindex="-1"');
        expect(activity).toContain('id="authority-agent-inspector-panel-workspace" role="tabpanel" aria-labelledby="authority-agent-inspector-tab-workspace" tabindex="0" hidden');
        expect(workspace).toContain('id="authority-agent-inspector-panel-activity" role="tabpanel" aria-labelledby="authority-agent-inspector-tab-activity" tabindex="0" hidden');
        expect(workspace).not.toContain('id="authority-agent-inspector-panel-workspace" role="tabpanel" aria-labelledby="authority-agent-inspector-tab-workspace" tabindex="0" hidden');
    });

    it('announces run state, approvals, queues, and redacted errors concisely', () => {
        const state = workbenchState();
        state.selectedSession!.pendingMessages.push({
            id: 'pending-1',
            ref: 'main',
            kind: 'follow_up',
            content: 'Continue',
            createdAt: '2026-01-01T00:00:00.000Z',
        });

        expect(getAgentStatusAnnouncement(state)).toContain('等待审批');
        expect(getAgentStatusAnnouncement(state)).toContain('等待 1 项审批');
        expect(getAgentStatusAnnouncement(state)).toContain('1 条消息排队');

        state.error = 'Authorization: Bearer hidden-token';
        const announcement = getAgentStatusAnnouncement(state);
        expect(announcement).toContain('[REDACTED]');
        expect(announcement).not.toContain('hidden-token');
        expect(renderAgentWorkbench(state)).toContain('role="alert"');
    });

    it('uses the first message to create a durable session', () => {
        const state = workbenchState();
        state.creatingSession = true;
        state.selectedSession = null;

        const html = renderAgentWorkbench(state);

        expect(html).toContain('data-role="agent-new-message"');
        expect(html).toContain('data-role="agent-new-mode"');
        expect(html).not.toContain('max-steps');
        expect(html).toContain('data-action="agent-create-session"');
        expect(html).toContain('data-action="agent-use-prompt"');
        expect(html).toContain('作用域：整个 SillyTavern');
        expect(html).not.toContain('data-role="agent-new-workspace"');
        expect(html).not.toContain('data-role="agent-new-profile"');
        expect(html).not.toContain('class="authority-agent-inspector"');
        expect(html).not.toContain('data-role="agent-run-goal"');
    });

    it('moves model connection management into global settings', () => {
        const state = workbenchState();
        const agent = renderAgentWorkbench(state);
        const settings = renderAgentSettings(state);

        expect(agent).not.toContain('data-role="agent-profile-api-key"');
        expect(agent).not.toContain('data-action="agent-save-profile"');
        expect(settings).toContain('data-role="agent-profile-api-key"');
        expect(settings).toContain('data-role="agent-profile-context-window"');
        expect(settings).toContain('上下文窗口 tokens');
        expect(settings).toContain('data-action="agent-save-profile"');
        expect(settings).toContain('data-action="agent-test-profile"');
        expect(settings).toContain('data-action="agent-new-profile"');
        expect(settings).toContain('data-action="agent-delete-profile"');
        expect(settings).toContain('class="authority-settings-mobile-back authority-mobile-only"');
        expect(settings).toContain('data-action="mobile-close-surface"');
        expect(settings).not.toContain('工具目录');
        expect(settings).not.toContain('注册工作区');
    });

    it('marks legacy model profiles that still need context settings', () => {
        const state = workbenchState();
        state.profiles[0]!.contextWindowTokens = null;
        state.profiles[0]!.maxOutputTokens = null;

        const settings = renderAgentSettings(state);

        expect(settings).toContain('旧版模型配置');
        expect(settings).toContain('data-role="agent-profile-context-window" type="number" min="1" value=""');
        expect(settings).toContain('data-role="agent-profile-max-tokens" type="number" min="1" value=""');
    });

    it('renders inline model-test feedback and an expanded line-level code diff', () => {
        const state = workbenchState();
        state.profileTest = { status: 'success', message: '连接成功 · 18 ms' };
        state.inspectorTab = 'workspace';
        state.fileDiffs.set(
            workspaceFileDiffKey('workspace', 'head-commit-id', 'working', 'src/index.ts'),
            {
                loading: false,
                expanded: true,
                error: null,
                response: {
                    workspaceId: 'workspace',
                    path: 'src/index.ts',
                    status: 'modified',
                    fromCommitId: 'head-commit-id',
                    toCommitId: null,
                    toWorkingTree: true,
                    beforeKind: 'blob',
                    afterKind: 'blob',
                    kind: 'text',
                    hunks: [{ lines: [
                        { kind: 'deleted', beforeLine: 4, afterLine: null, text: 'const unsafe = "<old>";' },
                        { kind: 'added', beforeLine: null, afterLine: 4, text: 'const safe = true;' },
                    ] }],
                    truncated: false,
                },
            },
        );

        const settings = renderAgentSettings(state);
        const workbench = renderAgentWorkbench(state);
        expect(settings).toContain('data-role="agent-profile-test-result"');
        expect(settings).toContain('连接成功 · 18 ms');
        expect(workbench).toContain('authority-file-diff__line--deleted');
        expect(workbench).toContain('authority-file-diff__line--added');
        expect(workbench).toContain('&lt;old&gt;');
        expect(workbench).not.toContain('"<old>"');

        const loaded = state.fileDiffs.get(
            workspaceFileDiffKey('workspace', 'head-commit-id', 'working', 'src/index.ts'),
        )!;
        loaded.response = {
            ...loaded.response!,
            hunks: [],
            textMetadata: {
                before: { lineEnding: 'crlf', endsWithNewline: true },
                after: { lineEnding: 'lf', endsWithNewline: false },
            },
        };
        const metadataOnly = renderAgentWorkbench(state);
        expect(metadataOnly).toContain('换行格式 CRLF → LF');
        expect(metadataOnly).toContain('文件末尾换行 有 → 无');
    });

    it('disables mutating Agent controls while leaving mobile navigation available', () => {
        const state = workbenchState();
        state.busy = true;
        const html = `${renderAgentWorkbench(state)}${renderAgentSettings(state)}`;
        const controls = Array.from(html.matchAll(/<(?:button|textarea|select|input)\b[^>]*>/g), match => match[0])
            .filter(control => !control.includes('type="hidden"') && !control.includes('data-action="mobile-'));

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
            contextWindowTokens: 128000,
            maxOutputTokens: 8192,
            timeoutMs: 120000,
        }],
        workspaces: [{
            id: 'workspace',
            displayName: 'Workspace',
            rootPath: 'D:\\workspace',
            allowedUserHandles: ['admin'],
            defaultRef: 'main',
            headCommitId: 'head-commit-id',
            createdAt: '2026-01-01T00:00:00.000Z',
            updatedAt: '2026-01-02T00:00:00.000Z',
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
        profileTest: null,
        defaultWorkspaceId: 'workspace',
        selectedWorkspaceId: 'workspace',
        selectedSession: snapshot,
        creatingSession: false,
        inspectorTab: 'activity',
        workspaceStatus: {
            workspace: {
                id: 'workspace',
                displayName: 'Workspace',
                rootPath: 'D:\\workspace',
                allowedUserHandles: ['admin'],
                defaultRef: 'main',
                headCommitId: 'head-commit-id',
                createdAt: '2026-01-01T00:00:00.000Z',
                updatedAt: '2026-01-02T00:00:00.000Z',
            },
            dirty: true,
            pendingRollback: {
                operationId: 'rollback-1',
                targetCommitId: 'old-commit-id',
                rollbackCommitId: 'head-commit-id',
                startedAt: '2026-01-02T00:00:00.000Z',
            },
            changes: [{ path: 'src/index.ts', status: 'modified' }],
        },
        workspaceCommits: [
            { id: 'head-commit-id', message: 'Current', createdAt: '2026-01-02T00:00:00.000Z' },
            { id: 'old-commit-id', message: 'Previous', createdAt: '2026-01-01T00:00:00.000Z' },
        ],
        workspaceDiff: {
            workspaceId: 'workspace',
            fromCommitId: 'old-commit-id',
            toCommitId: 'head-commit-id',
            entries: [{ path: 'src/index.ts', status: 'modified' }],
        },
        fileDiffs: new Map(),
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
            createdAt: timestamp,
            updatedAt: timestamp,
        },
        lastSequence: 5,
        refs: [{
            name: 'main',
            leafEntryId: 'assistant-1',
            activeRunId: status === 'completed' || status === 'failed' ? null : 'run-1',
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
            stepCount: 1,
            createdAt: timestamp,
            updatedAt: timestamp,
            resumeCount: 0,
        }],
        steps: [{
            id: 'step-1',
            runId: 'run-1',
            index: 0,
            kind: 'generation',
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

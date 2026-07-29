import { describe, expect, it } from 'vitest';
import { renderSystemWorkbench } from './system-workbench.js';
import type { SecurityCenterState, SystemView } from './types.js';

describe('System and recovery workbench rendering', () => {
    it('provides a stable five-view maintenance workspace', () => {
        const html = renderSystemWorkbench(systemState('runtime'));

        expect(html).toContain('class="authority-system-shell"');
        expect(html).toContain('class="authority-system-nav"');
        expect(html).toContain('运行状态');
        expect(html).toContain('版本与恢复');
        expect(html).toContain('数据迁移');
        expect(html).toContain('诊断');
        expect(html).toContain('远程备份');
        expect(html.match(/data-action="system-select-view"/g)).toHaveLength(5);
        expect(html).toContain('data-action="admin-update"');
        expect(html).toContain('data-action="export-diagnostic-archive"');
        expect(html).toContain('<strong title="未获取">未获取</strong>');
        expect(html).toContain('<code title="未获取">未获取</code>');
    });

    it('keeps checkpoint, rollback, transaction resume, and offline rescue together', () => {
        const state = systemState('recovery');
        state.system.recoveryLoaded = true;
        state.system.workspace = {
            id: 'sillytavern',
            displayName: 'SillyTavern',
            rootPath: 'D:\\SillyTavern',
            allowedUserHandles: ['admin'],
            headCommitId: 'head',
        };
        state.system.workspaceStatus = {
            workspace: state.system.workspace,
            dirty: true,
            pendingRollback: { operationId: 'rollback-1' },
            changes: [{ path: 'config.yaml', status: 'modified' }],
        };
        state.system.workspaceCommits = [
            {
                id: 'head',
                message: 'Current state',
                createdAt: '2026-07-30T00:00:00.000Z',
                actor: { kind: 'user', id: 'admin' },
                parents: ['previous'],
            },
            {
                id: 'previous',
                message: 'Previous state',
                createdAt: '2026-07-29T00:00:00.000Z',
                actor: { kind: 'agent', id: 'session' },
                parents: [],
            },
        ];
        state.system.selectedCommitId = 'previous';
        state.system.workspaceDiff = { entries: [{ path: 'config.yaml', status: 'modified' }] };

        const html = renderSystemWorkbench(state);

        expect(html).toContain('data-action="system-recovery-refresh"');
        expect(html).toContain('data-action="system-recovery-checkpoint"');
        expect(html).toContain('data-action="system-select-checkpoint"');
        expect(html).toContain('data-action="system-recovery-rollback"');
        expect(html).toContain('data-action="system-recovery-resume"');
        expect(html).toContain('恢复前自动创建安全检查点');
        expect(html).toContain('node runtime/agent.cjs rescue status --workspace sillytavern');
    });

    it('preserves import, export, native migration, diagnostics, and backup controls', () => {
        const migration = renderSystemWorkbench(systemState('migration'));
        const diagnostics = renderSystemWorkbench(systemState('diagnostics'));
        const backup = renderSystemWorkbench(systemState('backup'));

        expect(migration).toContain('data-action="export-portable-package"');
        expect(migration).toContain('data-action="import-portable-package"');
        expect(migration).toContain('data-action="preview-native-migration"');
        expect(migration).toContain('data-role="native-migration-file"');
        expect(diagnostics).toContain('data-action="export-diagnostic-bundle"');
        expect(diagnostics).toContain('data-action="export-diagnostic-archive"');
        expect(backup).toContain('data-action="save-st-manager-control"');
        expect(backup).toContain('data-action="save-st-manager-bridge-config"');
        expect(backup).toContain('高级远程桥接');
    });

    it('does not expose Agent tools, model configuration, or workspace registration here', () => {
        const html = (['runtime', 'recovery', 'migration', 'diagnostics', 'backup'] as const)
            .map(view => renderSystemWorkbench(systemState(view)))
            .join('');

        expect(html).not.toContain('工具目录');
        expect(html).not.toContain('data-action="agent-save-profile"');
        expect(html).not.toContain('data-action="agent-register-workspace"');
    });
});

function systemState(selectedView: SystemView): SecurityCenterState {
    return {
        loading: false,
        error: null,
        isAdmin: true,
        probe: null,
        session: null,
        usageSummary: null,
        extensions: [],
        details: new Map(),
        selectedExtensionId: null,
        selectedTab: 'updates',
        extensionFilter: '',
        policies: null,
        agent: {} as SecurityCenterState['agent'],
        system: {
            selectedView,
            recoveryLoaded: false,
            recoveryLoading: false,
            recoveryBusy: false,
            recoveryError: null,
            workspace: null,
            workspaceStatus: null,
            workspaceCommits: [],
            selectedCommitId: null,
            workspaceDiff: null,
        },
        policyEditorExtensionId: null,
        packageOperations: [],
        packageActionInProgress: false,
        nativeMigrationOperations: [],
        nativeMigrationActionInProgress: false,
        stManagerBridgeConfig: null,
        stManagerBridgeGeneratedKey: null,
        stManagerBridgeActionInProgress: false,
        stManagerControlConfig: null,
        stManagerControlBackups: [],
        stManagerControlActionInProgress: false,
        updateResult: null,
        updateInProgress: false,
    };
}

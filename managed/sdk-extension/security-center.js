import { authorityRequest } from './api.js';
import { escapeHtml } from './dom.js';
import { renderAlertStack } from './security-center/components.js';
import { SECURITY_CENTER_CONFIG } from './security-center/constants.js';
import { getAgentStatusAnnouncement, getActiveAgentSessionRun, isActiveAgentSession, renderAgentWorkbench, } from './security-center/agent-workbench.js';
import { renderAgentSettings } from './security-center/agent-settings.js';
import { renderAuditWorkspace, renderDataAssets, renderExtensionDirectory, renderExtensionDossier, renderGovernanceOverview, renderPolicyOverrideRow, renderPolicyWorkbench, } from './security-center/governance-workbench.js';
import { showImpactConfirmation } from './security-center/impact-confirmation.js';
import { getMobileBackSurface, isMobileSurface } from './security-center/mobile-presentation.js';
import { formatBytes, getCoreStateLabel, getRiskLevel, getSystemMessageLabel, } from './security-center/formatters.js';
import { buildStManagerBridgePayload, normalizeStManagerBridgeConfig, ST_MANAGER_RESOURCE_OPTIONS, } from './security-center/st-manager-bridge.js';
import { buildStManagerControlPayload, normalizeStManagerControlConfig, } from './security-center/st-manager-control.js';
import { bootstrapSecurityCenter as bootstrapSecurityCenterHost, openSecurityCenter as openSecurityCenterHost, } from './security-center/host.js';
import { renderSystemWorkbench } from './security-center/system-workbench.js';
import { workspaceFileDiffKey, } from './security-center/workspace-diff-view.js';
const TOAST_TITLE = '权限中心';
const PRIMARY_TAB_NAMES = ['overview', 'detail', 'databases', 'activity', 'agent', 'policies', 'updates', 'settings'];
const SYSTEM_VIEW_NAMES = ['runtime', 'recovery', 'migration', 'diagnostics', 'backup'];
const AGENT_FOCUS_DATA_KEYS = ['inspectorTab', 'sessionId', 'runId', 'approvalId', 'decision', 'commitId', 'profileId', 'diffScope', 'path'];
const MOBILE_FOCUS_DATA_KEYS = ['mobileSurface', 'extensionId', 'sessionId', 'profileId', 'commitId', 'tab', 'area'];
const MOBILE_BREAKPOINT_QUERY = '(max-width: 700px)';
function isValidCenterTab(value) {
    return typeof value === 'string' && PRIMARY_TAB_NAMES.includes(value);
}
function getCenterArea(tab) {
    if (tab === 'agent')
        return 'agent';
    if (tab === 'updates')
        return 'system';
    if (tab === 'settings')
        return 'settings';
    return 'governance';
}
function isSystemView(value) {
    return typeof value === 'string' && SYSTEM_VIEW_NAMES.includes(value);
}
function isWorkspaceDiffScope(value) {
    return value === 'working' || value === 'history';
}
function agentProfileTestFailureLabel(failure, statusCode) {
    if (failure === 'timeout')
        return '连接超时，请检查地址、网络或超时设置。';
    if (failure === 'rejected')
        return `服务端拒绝了测试请求${statusCode ? `（HTTP ${statusCode}）` : ''}。`;
    if (failure === 'invalid_response')
        return '服务端已响应，但返回内容不符合 OpenAI-compatible 格式。';
    return '无法连接到模型服务，请检查地址和网络。';
}
export function bootstrapSecurityCenter() {
    return bootstrapSecurityCenterHost(createSecurityCenterView);
}
export async function openSecurityCenter(options = {}) {
    await openSecurityCenterHost(createSecurityCenterView, options);
}
function createSecurityCenterView(root, focusExtensionId) {
    return new SecurityCenterView(root, focusExtensionId);
}
class SecurityCenterView {
    root;
    focusExtensionId;
    state;
    agentClientPromise = null;
    agentPollTimer = null;
    agentSessionSubscription = null;
    agentSessionSubscriptionGeneration = 0;
    agentSessionRefreshTimer = null;
    agentRefreshGeneration = 0;
    mobileMediaQuery;
    renderedMobileSurface = 'none';
    mobileFocusOrigin = null;
    initialTabPending;
    constructor(root, focusExtensionId) {
        this.root = root;
        this.focusExtensionId = focusExtensionId;
        this.initialTabPending = !focusExtensionId;
        this.mobileMediaQuery = window.matchMedia(MOBILE_BREAKPOINT_QUERY);
        this.state = {
            loading: true,
            error: null,
            isAdmin: false,
            probe: null,
            session: null,
            usageSummary: null,
            extensions: [],
            details: new Map(),
            selectedExtensionId: focusExtensionId ?? null,
            selectedTab: 'detail',
            extensionFilter: '',
            policies: null,
            agent: {
                loaded: false,
                loading: false,
                busy: false,
                error: null,
                profileTest: null,
                profiles: [],
                workspaces: [],
                sessions: {
                    sessions: [],
                    page: { nextCursor: null, limit: 50, hasMore: false, totalCount: 0 },
                },
                selectedProfileId: null,
                defaultWorkspaceId: null,
                selectedWorkspaceId: null,
                selectedSession: null,
                creatingSession: true,
                inspectorTab: 'activity',
                workspaceStatus: null,
                workspaceCommits: [],
                workspaceDiff: null,
                fileDiffs: new Map(),
            },
            system: {
                selectedView: 'runtime',
                recoveryLoaded: false,
                recoveryLoading: false,
                recoveryBusy: false,
                recoveryError: null,
                workspace: null,
                workspaceStatus: null,
                workspaceCommits: [],
                selectedCommitId: null,
                workspaceDiff: null,
                fileDiffs: new Map(),
            },
            mobile: {
                surface: 'none',
            },
            policyEditorExtensionId: focusExtensionId ?? null,
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
    async initialize() {
        this.bindEvents();
        await this.refresh();
    }
    bindEvents() {
        this.mobileMediaQuery.addEventListener('change', () => this.renderMobilePresentation());
        this.root.addEventListener('click', event => {
            const target = event.target instanceof Element ? event.target : null;
            if (!target) {
                return;
            }
            const mobileAction = target.closest('[data-action^="mobile-"]');
            if (mobileAction && this.handleMobileAction(mobileAction)) {
                return;
            }
            const primaryTab = target.closest('.authority-tab[data-tab]');
            if (primaryTab) {
                const tab = primaryTab.dataset.tab;
                if (isValidCenterTab(tab)) {
                    this.switchTab(tab);
                }
                return;
            }
            const actionTab = target.closest('[data-tab]:not(.authority-tab)');
            if (actionTab) {
                const tab = actionTab.dataset.tab;
                if (isValidCenterTab(tab)) {
                    if (actionTab.closest('[data-role="mobile-governance-tabs"]')) {
                        this.setMobileSurface('governance-detail');
                    }
                    this.switchTab(tab);
                }
                return;
            }
            const refreshButton = target.closest('[data-action="refresh"]');
            if (refreshButton) {
                void this.refresh();
                return;
            }
            const systemViewButton = target.closest('[data-action="system-select-view"]');
            if (systemViewButton && isSystemView(systemViewButton.dataset.systemView)) {
                this.selectSystemView(systemViewButton.dataset.systemView);
                return;
            }
            const systemRecoveryRefresh = target.closest('[data-action="system-recovery-refresh"]');
            if (systemRecoveryRefresh) {
                void this.refreshSystemRecovery();
                return;
            }
            const systemRecoveryCheckpoint = target.closest('[data-action="system-recovery-checkpoint"]');
            if (systemRecoveryCheckpoint) {
                void this.checkpointSystemWorkspace();
                return;
            }
            const systemCheckpoint = target.closest('[data-action="system-select-checkpoint"]');
            if (systemCheckpoint?.dataset.commitId) {
                void this.selectSystemCheckpoint(systemCheckpoint.dataset.commitId);
                return;
            }
            const systemRecoveryRollback = target.closest('[data-action="system-recovery-rollback"]');
            if (systemRecoveryRollback?.dataset.commitId) {
                void this.rollbackSystemWorkspace(systemRecoveryRollback.dataset.commitId);
                return;
            }
            const systemRecoveryResume = target.closest('[data-action="system-recovery-resume"]');
            if (systemRecoveryResume) {
                void this.resumeSystemWorkspaceRollback();
                return;
            }
            const systemFileDiff = target.closest('[data-action="system-file-diff"]');
            if (systemFileDiff?.dataset.path && isWorkspaceDiffScope(systemFileDiff.dataset.diffScope)) {
                void this.toggleSystemFileDiff(systemFileDiff.dataset.path, systemFileDiff.dataset.diffScope);
                return;
            }
            const agentAction = target.closest('[data-action^="agent-"]');
            if (agentAction) {
                this.handleAgentAction(agentAction);
                return;
            }
            const extensionButton = target.closest('.authority-extension-item[data-extension-id]');
            if (extensionButton) {
                const extensionId = extensionButton.dataset.extensionId;
                if (extensionId) {
                    void this.selectExtension(extensionId, 'detail', extensionButton);
                }
                return;
            }
            const resetAllButton = target.closest('[data-action="reset-all-grants"]');
            if (resetAllButton?.dataset.extensionId) {
                void this.resetGrants(resetAllButton.dataset.extensionId);
                return;
            }
            const resetGrantButton = target.closest('[data-action="reset-grant"]');
            if (resetGrantButton?.dataset.extensionId && resetGrantButton.dataset.grantKey) {
                void this.resetGrants(resetGrantButton.dataset.extensionId, [resetGrantButton.dataset.grantKey]);
                return;
            }
            const addOverrideButton = target.closest('[data-action="add-policy-row"]');
            if (addOverrideButton) {
                this.addPolicyOverrideRow();
                return;
            }
            const removeOverrideButton = target.closest('[data-action="remove-policy-row"]');
            if (removeOverrideButton) {
                removeOverrideButton.closest('.authority-policy-row')?.remove();
                return;
            }
            const savePoliciesButton = target.closest('[data-action="save-policies"]');
            if (savePoliciesButton) {
                void this.savePolicies();
                return;
            }
            const adminUpdateButton = target.closest('[data-action="admin-update"]');
            if (adminUpdateButton) {
                const action = adminUpdateButton.dataset.updateAction;
                if (action) {
                    void this.runAdminUpdate(action);
                }
                return;
            }
            const saveStManagerBridgeButton = target.closest('[data-action="save-st-manager-bridge-config"]');
            if (saveStManagerBridgeButton) {
                void this.updateStManagerBridgeConfig();
                return;
            }
            const rotateStManagerBridgeKeyButton = target.closest('[data-action="rotate-st-manager-bridge-key"]');
            if (rotateStManagerBridgeKeyButton) {
                void this.updateStManagerBridgeConfig({ rotateKey: true, forceEnabled: true });
                return;
            }
            const disableStManagerBridgeButton = target.closest('[data-action="disable-st-manager-bridge"]');
            if (disableStManagerBridgeButton) {
                void this.updateStManagerBridgeConfig({ forceEnabled: false });
                return;
            }
            const copyStManagerBridgeKeyButton = target.closest('[data-action="copy-st-manager-bridge-key"]');
            if (copyStManagerBridgeKeyButton) {
                void this.copyStManagerBridgeKey();
                return;
            }
            const toggleSecretButton = target.closest('[data-action="toggle-secret-visibility"]');
            if (toggleSecretButton) {
                this.toggleSecretVisibility(toggleSecretButton);
                return;
            }
            const saveStManagerControlButton = target.closest('[data-action="save-st-manager-control"]');
            if (saveStManagerControlButton) {
                void this.updateStManagerControlConfig();
                return;
            }
            const probeStManagerControlButton = target.closest('[data-action="probe-st-manager-control"]');
            if (probeStManagerControlButton) {
                void this.probeStManagerControl();
                return;
            }
            const startStManagerBackupButton = target.closest('[data-action="start-st-manager-backup"]');
            if (startStManagerBackupButton) {
                void this.startStManagerBackup();
                return;
            }
            const pairStManagerControlButton = target.closest('[data-action="pair-st-manager-control"]');
            if (pairStManagerControlButton) {
                void this.pairStManagerControl();
                return;
            }
            const refreshStManagerBackupsButton = target.closest('[data-action="refresh-st-manager-backups"]');
            if (refreshStManagerBackupsButton) {
                void this.refreshStManagerBackups();
                return;
            }
            const previewStManagerRestoreButton = target.closest('[data-action="preview-st-manager-restore"]');
            if (previewStManagerRestoreButton) {
                void this.previewStManagerRestore();
                return;
            }
            const restoreStManagerBackupButton = target.closest('[data-action="restore-st-manager-backup"]');
            if (restoreStManagerBackupButton) {
                void this.restoreStManagerBackup();
                return;
            }
            const exportDiagnosticBundleButton = target.closest('[data-action="export-diagnostic-bundle"]');
            if (exportDiagnosticBundleButton) {
                void this.exportDiagnosticBundle();
                return;
            }
            const exportDiagnosticArchiveButton = target.closest('[data-action="export-diagnostic-archive"]');
            if (exportDiagnosticArchiveButton) {
                void this.exportDiagnosticArchive();
                return;
            }
            const exportPackageButton = target.closest('[data-action="export-portable-package"]');
            if (exportPackageButton) {
                void this.exportPortablePackage();
                return;
            }
            const importPackageButton = target.closest('[data-action="import-portable-package"]');
            if (importPackageButton) {
                void this.importPortablePackage();
                return;
            }
            const previewNativeMigrationButton = target.closest('[data-action="preview-native-migration"]');
            if (previewNativeMigrationButton?.dataset.target) {
                void this.previewNativeMigration(previewNativeMigrationButton.dataset.target);
                return;
            }
            const applyNativeMigrationButton = target.closest('[data-action="apply-native-migration"]');
            if (applyNativeMigrationButton?.dataset.operationId) {
                void this.applyNativeMigration(applyNativeMigrationButton.dataset.operationId);
                return;
            }
            const rollbackNativeMigrationButton = target.closest('[data-action="rollback-native-migration"]');
            if (rollbackNativeMigrationButton?.dataset.operationId) {
                void this.rollbackNativeMigration(rollbackNativeMigrationButton.dataset.operationId);
                return;
            }
            const resumePackageButton = target.closest('[data-action="resume-package-operation"]');
            if (resumePackageButton?.dataset.operationId) {
                void this.resumePackageOperation(resumePackageButton.dataset.operationId);
                return;
            }
            const downloadPackageButton = target.closest('[data-action="download-package-operation"]');
            if (downloadPackageButton?.dataset.operationId) {
                void this.downloadPackageOperation(downloadPackageButton.dataset.operationId);
                return;
            }
        });
        this.root.addEventListener('keydown', event => {
            const target = event.target;
            if (event.key === 'Escape' && this.mobileMediaQuery.matches && this.state.mobile.surface !== 'none') {
                event.preventDefault();
                this.setMobileSurface(getMobileBackSurface(this.state.mobile.surface));
                return;
            }
            if (!(target instanceof HTMLElement) || target.getAttribute('role') !== 'tab') {
                return;
            }
            const tablist = target.closest('[role="tablist"]');
            if (!tablist) {
                return;
            }
            const tabs = Array.from(tablist.querySelectorAll('[role="tab"]:not([hidden])'));
            const index = tabs.indexOf(target);
            if (index === -1) {
                return;
            }
            let nextIndex = -1;
            switch (event.key) {
                case 'ArrowLeft':
                    nextIndex = index > 0 ? index - 1 : tabs.length - 1;
                    break;
                case 'ArrowRight':
                    nextIndex = index < tabs.length - 1 ? index + 1 : 0;
                    break;
                case 'Home':
                    nextIndex = 0;
                    break;
                case 'End':
                    nextIndex = tabs.length - 1;
                    break;
                default:
                    return;
            }
            event.preventDefault();
            const nextTab = tabs[nextIndex];
            if (nextTab) {
                nextTab.focus();
                const inspectorTab = nextTab.dataset.inspectorTab;
                if (inspectorTab === 'activity' || inspectorTab === 'workspace') {
                    this.selectAgentInspectorTab(inspectorTab);
                    return;
                }
                const mobileSurface = nextTab.dataset.mobileSurface;
                if (isMobileSurface(mobileSurface) && mobileSurface !== 'none') {
                    this.handleMobileAction(nextTab);
                    return;
                }
                const tab = nextTab.dataset.tab;
                if (tab) {
                    if (nextTab.closest('[data-role="mobile-governance-tabs"]')) {
                        this.setMobileSurface('governance-detail');
                    }
                    this.switchTab(tab);
                }
            }
        });
        this.root.addEventListener('input', event => {
            const target = event.target;
            if (!(target instanceof HTMLInputElement)) {
                return;
            }
            if (target.matches('[data-role="extension-search"]')) {
                this.state.extensionFilter = target.value.trim().toLowerCase();
                this.renderExtensionList();
                return;
            }
            if (target.matches('[data-role="agent-session-filter"]')) {
                const query = target.value.trim().toLowerCase();
                for (const item of this.root.querySelectorAll('[data-action="agent-select-session"]')) {
                    item.hidden = Boolean(query) && !item.textContent?.toLowerCase().includes(query);
                }
            }
        });
        this.root.addEventListener('change', event => {
            const target = event.target;
            if (!(target instanceof HTMLSelectElement)) {
                return;
            }
            if (target.matches('[data-policy-editor-extension]')) {
                this.state.policyEditorExtensionId = target.value || null;
                void this.renderPoliciesSection();
                return;
            }
        });
        this.root.addEventListener('input', event => {
            const target = event.target;
            if (!(target instanceof HTMLInputElement)
                || !target.dataset.role?.startsWith('agent-profile-')
                || target.type === 'hidden') {
                return;
            }
            if (this.state.agent.profileTest) {
                this.state.agent.profileTest = null;
                this.root.querySelector('[data-role="agent-profile-test-result"]')?.remove();
            }
        });
    }
    async refresh() {
        this.state.loading = true;
        this.state.error = null;
        void this.render();
        try {
            const probe = await authorityRequest('/probe', { method: 'POST' });
            const session = await authorityRequest('/session/init', {
                method: 'POST',
                body: SECURITY_CENTER_CONFIG,
            });
            const extensions = await authorityRequest('/extensions');
            const detailEntries = await Promise.all(extensions.map(async (extension) => {
                const detail = await authorityRequest(`/extensions/${encodeURIComponent(extension.id)}`);
                return [extension.id, detail];
            }));
            this.state.probe = probe;
            this.state.session = session;
            this.state.isAdmin = session.user.isAdmin;
            if (this.initialTabPending) {
                this.state.selectedTab = this.state.isAdmin ? 'agent' : 'detail';
                this.initialTabPending = false;
            }
            this.state.extensions = extensions;
            this.state.details = new Map(detailEntries);
            this.state.selectedExtensionId = this.resolveSelectedExtensionId();
            this.state.policyEditorExtensionId = this.resolvePolicyEditorExtensionId();
            if (this.state.isAdmin) {
                const [policies, usageSummary, packageOperations, nativeMigrationOperations, stManagerBridgeConfig, stManagerControlConfig] = await Promise.all([
                    authorityRequest('/admin/policies'),
                    authorityRequest('/admin/usage-summary'),
                    authorityRequest('/admin/import-export/operations'),
                    authorityRequest('/admin/native-migration/operations'),
                    authorityRequest('/st-manager/bridge/admin/config'),
                    authorityRequest('/st-manager/control/config'),
                ]);
                this.state.policies = policies;
                this.state.usageSummary = usageSummary;
                this.state.packageOperations = packageOperations.operations;
                this.state.nativeMigrationOperations = nativeMigrationOperations.operations;
                this.applyStManagerBridgeConfig(stManagerBridgeConfig);
                this.state.stManagerControlConfig = normalizeStManagerControlConfig(stManagerControlConfig);
            }
            else {
                this.state.policies = null;
                this.state.usageSummary = null;
                this.state.packageOperations = [];
                this.state.nativeMigrationOperations = [];
                this.state.stManagerBridgeConfig = null;
                this.state.stManagerBridgeGeneratedKey = null;
                this.state.stManagerControlConfig = null;
                this.state.stManagerControlBackups = [];
            }
            if (!this.state.isAdmin && (this.state.selectedTab === 'agent' || this.state.selectedTab === 'policies' || this.state.selectedTab === 'updates' || this.state.selectedTab === 'settings')) {
                this.state.selectedTab = 'detail';
            }
            if (this.state.isAdmin && this.state.selectedTab === 'agent') {
                await this.refreshAgentWorkbench();
            }
            if (this.state.isAdmin && this.state.selectedTab === 'updates' && this.state.system.selectedView === 'recovery') {
                await this.refreshSystemRecovery();
            }
        }
        catch (error) {
            this.state.error = error instanceof Error ? error.message : String(error);
        }
        finally {
            this.state.loading = false;
            void this.render();
        }
    }
    handleAgentAction(element) {
        switch (element.dataset.action) {
            case 'agent-refresh':
                void this.refreshAgentWorkbench();
                return;
            case 'agent-new-session':
                this.beginAgentSession();
                return;
            case 'agent-use-prompt':
                this.applyAgentPrompt(element.dataset.prompt ?? '');
                return;
            case 'agent-create-session':
                void this.createAgentSession();
                return;
            case 'agent-select-session':
                if (element.dataset.sessionId)
                    void this.selectAgentSession(element.dataset.sessionId);
                return;
            case 'agent-send-message':
                if (element.dataset.sessionId)
                    void this.sendAgentMessage(element.dataset.sessionId);
                return;
            case 'agent-update-session':
                if (element.dataset.sessionId)
                    void this.updateAgentSession(element.dataset.sessionId);
                return;
            case 'agent-cancel-run':
                if (element.dataset.sessionId && element.dataset.runId) {
                    void this.cancelAgentRun(element.dataset.sessionId, element.dataset.runId);
                }
                return;
            case 'agent-resume-run':
                if (element.dataset.sessionId && element.dataset.runId) {
                    void this.resumeAgentRun(element.dataset.sessionId, element.dataset.runId);
                }
                return;
            case 'agent-continue-failed-run':
                if (element.dataset.sessionId && element.dataset.runId) {
                    void this.continueFailedAgentRun(element.dataset.sessionId, element.dataset.runId);
                }
                return;
            case 'agent-resolve-approval':
                if (element.dataset.sessionId && element.dataset.approvalId) {
                    void this.resolveAgentApproval(element.dataset.sessionId, element.dataset.approvalId, element.dataset.decision === 'approve' ? 'approve' : 'deny');
                }
                return;
            case 'agent-load-more-sessions':
                void this.loadMoreAgentSessions();
                return;
            case 'agent-inspector-tab':
                if (element.dataset.inspectorTab === 'activity'
                    || element.dataset.inspectorTab === 'workspace') {
                    this.selectAgentInspectorTab(element.dataset.inspectorTab);
                }
                return;
            case 'agent-edit-profile': {
                const mobileFocusOrigin = this.mobileMediaQuery.matches ? this.captureMobileFocus(element) : undefined;
                this.state.agent.selectedProfileId = element.dataset.profileId ?? null;
                this.state.agent.profileTest = null;
                this.renderSettingsSection();
                if (!this.mobileMediaQuery.matches)
                    this.playSurfaceEntrance('.authority-model-editor');
                this.setMobileSurface('settings-editor', true, undefined, mobileFocusOrigin);
                return;
            }
            case 'agent-new-profile': {
                const mobileFocusOrigin = this.mobileMediaQuery.matches ? this.captureMobileFocus(element) : undefined;
                this.state.agent.selectedProfileId = null;
                this.state.agent.profileTest = null;
                this.renderSettingsSection();
                if (!this.mobileMediaQuery.matches)
                    this.playSurfaceEntrance('.authority-model-editor');
                this.setMobileSurface('settings-editor', true, undefined, mobileFocusOrigin);
                return;
            }
            case 'agent-save-profile':
                void this.saveAgentProfile();
                return;
            case 'agent-test-profile':
                void this.testAgentProfile();
                return;
            case 'agent-delete-profile':
                if (element.dataset.profileId)
                    void this.deleteAgentProfile(element.dataset.profileId);
                return;
            case 'agent-workspace-refresh':
                void this.refreshSelectedAgentWorkspace();
                return;
            case 'agent-workspace-checkpoint':
                void this.checkpointAgentWorkspace();
                return;
            case 'agent-workspace-rollback':
                if (element.dataset.commitId)
                    void this.rollbackAgentWorkspace(element.dataset.commitId);
                return;
            case 'agent-workspace-resume':
                void this.resumeAgentWorkspaceRollback();
                return;
            case 'agent-file-diff':
                if (element.dataset.path && isWorkspaceDiffScope(element.dataset.diffScope)) {
                    void this.toggleAgentFileDiff(element.dataset.path, element.dataset.diffScope);
                }
                return;
        }
    }
    selectAgentInspectorTab(tab) {
        if (this.state.agent.inspectorTab === tab)
            return;
        this.state.agent.inspectorTab = tab;
        this.renderAgentSurfaces();
        this.playSurfaceEntrance('.authority-agent-inspector__body > [role="tabpanel"]:not([hidden])');
    }
    async getAgentClient() {
        this.agentClientPromise ??= import('./sdk.js')
            .then(async ({ AuthoritySDK }) => await AuthoritySDK.init(SECURITY_CENTER_CONFIG))
            .catch(error => {
            this.agentClientPromise = null;
            throw error;
        });
        return await this.agentClientPromise;
    }
    async refreshAgentWorkbench(options = {}) {
        if (!this.state.isAdmin) {
            return;
        }
        const generation = ++this.agentRefreshGeneration;
        const profileIdBeforeRefresh = this.state.agent.selectedProfileId;
        if (!options.append)
            this.state.agent.fileDiffs.clear();
        this.state.agent.loading = true;
        this.state.agent.error = null;
        this.renderAgentSurfaces();
        try {
            const client = await this.getAgentClient();
            const sessionRequest = {
                page: { ...(options.cursor ? { cursor: options.cursor } : {}), limit: 50 },
            };
            const [profiles, defaultWorkspace, sessions] = await Promise.all([
                client.agent.admin.profiles.list(),
                client.agent.admin.workspaces.default(),
                client.agent.sessions.listPage(sessionRequest),
            ]);
            const workspaces = await client.agent.admin.workspaces.list();
            if (generation !== this.agentRefreshGeneration)
                return;
            const selectedProfileId = profiles.some(profile => profile.id === this.state.agent.selectedProfileId)
                ? this.state.agent.selectedProfileId
                : profiles[0]?.id ?? null;
            const selectedSessionId = this.state.agent.selectedSession?.session.id;
            const selectedSession = selectedSessionId
                ? await client.agent.sessions.get(selectedSessionId).catch(() => null)
                : null;
            if (generation !== this.agentRefreshGeneration)
                return;
            const sessionWorkspaceId = selectedSession?.session.workspaceId ?? null;
            const selectedWorkspaceId = workspaces.some(workspace => workspace.id === sessionWorkspaceId)
                ? sessionWorkspaceId
                : defaultWorkspace.id;
            const workspaceResult = await (selectedWorkspaceId
                ? this.fetchAgentWorkspace(client, selectedWorkspaceId)
                    .then(value => ({ value, error: null }))
                    .catch(error => ({ value: null, error }))
                : Promise.resolve({ value: null, error: null }));
            if (generation !== this.agentRefreshGeneration)
                return;
            this.state.agent.profiles = profiles;
            this.state.agent.workspaces = workspaces;
            this.state.agent.sessions = options.append
                ? { sessions: mergeAgentSessions(this.state.agent.sessions.sessions, sessions.sessions), page: sessions.page }
                : sessions;
            this.state.agent.selectedProfileId = selectedProfileId;
            if (selectedProfileId !== profileIdBeforeRefresh)
                this.state.agent.profileTest = null;
            this.state.agent.defaultWorkspaceId = defaultWorkspace.id;
            this.state.agent.selectedWorkspaceId = selectedWorkspaceId;
            this.state.agent.workspaceStatus = workspaceResult.value?.status ?? null;
            this.state.agent.workspaceCommits = workspaceResult.value?.commits ?? [];
            this.state.agent.workspaceDiff = workspaceResult.value?.diff ?? null;
            this.state.agent.selectedSession = selectedSession;
            if (selectedSession)
                this.state.agent.creatingSession = false;
            this.state.agent.error = workspaceResult.error
                ? `工作区状态读取失败：${workspaceResult.error instanceof Error ? workspaceResult.error.message : String(workspaceResult.error)}`
                : null;
            this.state.agent.loaded = true;
        }
        catch (error) {
            if (generation === this.agentRefreshGeneration) {
                this.state.agent.error = error instanceof Error ? error.message : String(error);
            }
        }
        finally {
            if (generation !== this.agentRefreshGeneration)
                return;
            this.state.agent.loading = false;
            this.renderAgentSurfaces();
            void this.subscribeSelectedAgentSession();
            this.scheduleAgentPoll();
        }
    }
    async fetchAgentWorkspace(client, workspaceId) {
        const [status, history] = await Promise.all([
            client.agent.admin.workspaces.status(workspaceId),
            client.agent.admin.workspaces.commits(workspaceId, 100),
        ]);
        const diff = history.commits.length > 1
            ? await client.agent.admin.workspaces.diff(workspaceId, {
                from: history.commits[1].id,
                to: history.commits[0].id,
            })
            : null;
        return { status, commits: history.commits, diff };
    }
    selectSystemView(view) {
        this.setMobileSurface('none');
        this.state.system.selectedView = view;
        this.renderUpdatesSection();
        this.playSurfaceEntrance('.authority-system-stage > :first-child');
        const activeButton = this.root.querySelector(`[data-action="system-select-view"][data-system-view="${view}"]`);
        activeButton?.focus({ preventScroll: true });
        activeButton?.scrollIntoView({ block: 'nearest', inline: 'nearest' });
        if (view === 'recovery' && !this.state.system.recoveryLoaded && !this.state.system.recoveryLoading) {
            void this.refreshSystemRecovery();
        }
    }
    async refreshSystemRecovery() {
        if (!this.state.isAdmin || this.state.system.recoveryLoading || this.state.system.recoveryBusy)
            return;
        this.state.system.fileDiffs.clear();
        this.state.system.recoveryLoading = true;
        this.state.system.recoveryError = null;
        void this.renderUpdatesSection();
        try {
            const client = await this.getAgentClient();
            const workspace = await client.agent.admin.workspaces.default();
            const [status, history] = await Promise.all([
                client.agent.admin.workspaces.status(workspace.id),
                client.agent.admin.workspaces.commits(workspace.id, 200),
            ]);
            const selectedCommit = history.commits.find(commit => commit.id === this.state.system.selectedCommitId)
                ?? history.commits.find(commit => commit.id === status.workspace.headCommitId)
                ?? history.commits[0]
                ?? null;
            const diff = selectedCommit
                ? await client.agent.admin.workspaces.diff(workspace.id, {
                    from: selectedCommit.parents[0] ?? null,
                    to: selectedCommit.id,
                })
                : null;
            this.state.system.workspace = status.workspace;
            this.state.system.workspaceStatus = status;
            this.state.system.workspaceCommits = history.commits;
            this.state.system.selectedCommitId = selectedCommit?.id ?? null;
            this.state.system.workspaceDiff = diff;
            this.state.system.recoveryLoaded = true;
        }
        catch (error) {
            this.state.system.recoveryError = error instanceof Error ? error.message : String(error);
        }
        finally {
            this.state.system.recoveryLoading = false;
            void this.renderUpdatesSection();
        }
    }
    async selectSystemCheckpoint(commitId) {
        const workspace = this.state.system.workspace;
        const commit = this.state.system.workspaceCommits.find(item => item.id === commitId);
        if (!workspace || !commit || this.state.system.recoveryLoading || this.state.system.recoveryBusy)
            return;
        const mobileFocusOrigin = this.mobileMediaQuery.matches ? this.captureMobileFocus() : undefined;
        this.state.system.selectedCommitId = commitId;
        this.state.system.workspaceDiff = null;
        this.state.system.fileDiffs.clear();
        this.state.system.recoveryLoading = true;
        void this.renderUpdatesSection();
        this.setMobileSurface('system-detail', true, undefined, mobileFocusOrigin);
        try {
            this.state.system.workspaceDiff = await (await this.getAgentClient()).agent.admin.workspaces.diff(workspace.id, {
                from: commit.parents[0] ?? null,
                to: commit.id,
            });
            this.state.system.recoveryError = null;
        }
        catch (error) {
            this.state.system.recoveryError = error instanceof Error ? error.message : String(error);
            toastr.error(getSystemMessageLabel(this.state.system.recoveryError), TOAST_TITLE);
        }
        finally {
            this.state.system.recoveryLoading = false;
            void this.renderUpdatesSection();
        }
    }
    async checkpointSystemWorkspace() {
        const workspace = this.state.system.workspace;
        if (!workspace || this.state.system.recoveryBusy)
            return;
        const message = this.root.querySelector('[data-role="system-checkpoint-message"]')?.value.trim()
            || 'Manual checkpoint from Authority recovery';
        this.state.system.recoveryBusy = true;
        void this.renderUpdatesSection();
        try {
            const result = await (await this.getAgentClient()).agent.admin.workspaces.checkpoint(workspace.id, { message });
            toastr.success(`检查点已建立，记录 ${result.changedPaths} 个路径`, TOAST_TITLE);
            this.state.system.selectedCommitId = result.commit.id;
        }
        catch (error) {
            this.reportSystemRecoveryError(error);
        }
        finally {
            this.state.system.recoveryBusy = false;
        }
        await this.refreshSystemRecovery();
    }
    async rollbackSystemWorkspace(commitId) {
        const workspace = this.state.system.workspace;
        const commit = this.state.system.workspaceCommits.find(item => item.id === commitId);
        if (!workspace || !commit || this.state.system.recoveryBusy)
            return;
        const hasUnrecordedChanges = Boolean(this.state.system.workspaceStatus?.dirty);
        if (!await showImpactConfirmation({
            title: '恢复 SillyTavern 检查点',
            description: '将 Authority 跟踪的文件恢复到选定检查点。',
            confirmLabel: '建立保护并恢复',
            target: `${workspace.displayName} @ ${commit.id.slice(0, 12)}`,
            effects: [
                '恢复前会自动建立安全检查点，当前状态可以再次找回。',
                hasUnrecordedChanges ? '当前未记录变更会先进入安全检查点，再执行强制恢复。' : '当前工作树干净，不需要覆盖未记录变更。',
                '未跟踪文件以及 .git、node_modules 和 Authority 历史库保持不变。',
                '中断时会留下事务记录，可从本页或离线救援入口继续。',
            ],
            tone: 'danger',
        }))
            return;
        this.state.system.recoveryBusy = true;
        void this.renderUpdatesSection();
        try {
            const result = await (await this.getAgentClient()).agent.admin.workspaces.rollback(workspace.id, {
                targetCommitId: commitId,
                operationId: globalThis.crypto.randomUUID(),
                force: hasUnrecordedChanges,
                message: `Restore ${commit.id.slice(0, 12)} from Authority recovery`,
            });
            toastr.success(`恢复完成，处理 ${result.changedPaths} 个路径`, TOAST_TITLE);
            if (result.warnings.length)
                toastr.warning(result.warnings.join('；'), TOAST_TITLE);
            this.state.system.selectedCommitId = null;
        }
        catch (error) {
            this.reportSystemRecoveryError(error);
        }
        finally {
            this.state.system.recoveryBusy = false;
        }
        await this.refreshSystemRecovery();
    }
    async resumeSystemWorkspaceRollback() {
        const workspace = this.state.system.workspace;
        if (!workspace || this.state.system.recoveryBusy || !await showImpactConfirmation({
            title: '继续未完成的恢复',
            description: '继续执行 Authority 已持久化的恢复事务。',
            confirmLabel: '继续恢复',
            target: workspace.displayName,
            effects: ['只继续已经记录的恢复操作。', '若文件再次发生冲突，事务会保留并可再次继续。'],
            tone: 'warning',
        }))
            return;
        this.state.system.recoveryBusy = true;
        void this.renderUpdatesSection();
        try {
            const result = await (await this.getAgentClient()).agent.admin.workspaces.resumeRollback(workspace.id);
            toastr.success(`恢复事务已完成，处理 ${result.changedPaths} 个路径`, TOAST_TITLE);
            if (result.warnings.length)
                toastr.warning(result.warnings.join('；'), TOAST_TITLE);
            this.state.system.selectedCommitId = null;
        }
        catch (error) {
            this.reportSystemRecoveryError(error);
        }
        finally {
            this.state.system.recoveryBusy = false;
        }
        await this.refreshSystemRecovery();
    }
    reportSystemRecoveryError(error) {
        const message = error instanceof Error ? error.message : String(error);
        this.state.system.recoveryError = message;
        toastr.error(getSystemMessageLabel(message), TOAST_TITLE);
    }
    async refreshSelectedAgentWorkspace() {
        if (!this.state.isAdmin || this.state.agent.busy) {
            return;
        }
        this.state.agent.busy = true;
        this.state.agent.fileDiffs.clear();
        this.renderAgentSurfaces();
        try {
            const workspaceId = this.state.agent.selectedWorkspaceId;
            const snapshot = workspaceId
                ? await this.fetchAgentWorkspace(await this.getAgentClient(), workspaceId)
                : null;
            this.state.agent.workspaceStatus = snapshot?.status ?? null;
            this.state.agent.workspaceCommits = snapshot?.commits ?? [];
            this.state.agent.workspaceDiff = snapshot?.diff ?? null;
            this.state.agent.error = null;
        }
        catch (error) {
            this.reportAgentError(error);
        }
        finally {
            this.state.agent.busy = false;
            this.renderAgentSurfaces();
        }
    }
    async toggleAgentFileDiff(path, scope) {
        const workspaceId = this.state.agent.selectedWorkspaceId;
        const status = this.state.agent.workspaceStatus;
        const history = this.state.agent.workspaceDiff;
        if (!workspaceId)
            return;
        const from = scope === 'working' ? status?.workspace.headCommitId : history?.fromCommitId;
        const to = scope === 'working' ? 'working' : history?.toCommitId;
        if (from === undefined || to === undefined)
            return;
        await this.toggleWorkspaceFileDiff(this.state.agent.fileDiffs, workspaceId, from, to, path, () => this.renderAgentSurfaces());
    }
    async toggleSystemFileDiff(path, scope) {
        const workspaceId = this.state.system.workspace?.id;
        const status = this.state.system.workspaceStatus;
        const history = this.state.system.workspaceDiff;
        if (!workspaceId)
            return;
        const from = scope === 'working' ? status?.workspace.headCommitId : history?.fromCommitId;
        const to = scope === 'working' ? 'working' : history?.toCommitId;
        if (from === undefined || to === undefined)
            return;
        await this.toggleWorkspaceFileDiff(this.state.system.fileDiffs, workspaceId, from, to, path, () => this.renderUpdatesSection());
    }
    async toggleWorkspaceFileDiff(states, workspaceId, from, to, path, render) {
        const key = workspaceFileDiffKey(workspaceId, from, to, path);
        const current = states.get(key);
        if (current?.loading)
            return;
        if (current?.response) {
            states.set(key, { ...current, expanded: !current.expanded });
            render();
            return;
        }
        const pending = {
            loading: true,
            expanded: true,
            error: null,
            response: null,
        };
        states.set(key, pending);
        render();
        try {
            const response = await (await this.getAgentClient()).agent.admin.workspaces.fileDiff(workspaceId, {
                path,
                from,
                to,
            });
            if (states.get(key) !== pending)
                return;
            states.set(key, { loading: false, expanded: true, error: null, response });
        }
        catch (error) {
            if (states.get(key) !== pending)
                return;
            states.set(key, {
                loading: false,
                expanded: true,
                error: getSystemMessageLabel(error instanceof Error ? error.message : String(error)),
                response: null,
            });
        }
        render();
    }
    scheduleAgentPoll() {
        if (this.agentPollTimer !== null) {
            window.clearTimeout(this.agentPollTimer);
            this.agentPollTimer = null;
        }
        const selected = this.state.agent.selectedSession;
        if (!selected || !isActiveAgentSession(selected) || this.state.selectedTab !== 'agent' || !this.root.isConnected) {
            return;
        }
        this.agentPollTimer = window.setTimeout(() => void this.pollSelectedAgentSession(), 5_000);
    }
    async pollSelectedAgentSession() {
        this.agentPollTimer = null;
        const selected = this.state.agent.selectedSession;
        if (!selected || !this.root.isConnected || this.state.agent.busy) {
            this.scheduleAgentPoll();
            return;
        }
        const sessionId = selected.session.id;
        try {
            const snapshot = await (await this.getAgentClient()).agent.sessions.get(sessionId);
            if (this.state.agent.selectedSession?.session.id !== sessionId)
                return;
            this.applySelectedAgentSession(snapshot);
            this.renderSelectedAgentSession();
        }
        catch {
        }
        finally {
            this.scheduleAgentPoll();
        }
    }
    renderSelectedAgentSession() {
        this.renderAgentSurfaces();
    }
    async subscribeSelectedAgentSession() {
        this.closeAgentSessionSubscription();
        const generation = this.agentSessionSubscriptionGeneration;
        const selected = this.state.agent.selectedSession;
        if (!selected || this.state.agent.creatingSession || this.state.selectedTab !== 'agent' || !this.root.isConnected)
            return;
        const sessionId = selected.session.id;
        try {
            const subscription = await (await this.getAgentClient()).agent.sessions.subscribe(sessionId, {
                onSnapshot: snapshot => {
                    if (generation !== this.agentSessionSubscriptionGeneration
                        || this.state.agent.selectedSession?.session.id !== sessionId)
                        return;
                    this.applySelectedAgentSession(snapshot);
                    this.renderSelectedAgentSession();
                },
                onEvent: () => {
                    if (generation === this.agentSessionSubscriptionGeneration) {
                        this.scheduleAgentSessionRefresh(sessionId);
                    }
                },
                onError: () => {
                    if (generation === this.agentSessionSubscriptionGeneration)
                        this.scheduleAgentPoll();
                },
            });
            if (generation !== this.agentSessionSubscriptionGeneration
                || this.state.agent.selectedSession?.session.id !== sessionId
                || this.state.selectedTab !== 'agent'
                || !this.root.isConnected) {
                subscription.close();
                return;
            }
            this.agentSessionSubscription = subscription;
        }
        catch {
            if (generation === this.agentSessionSubscriptionGeneration)
                this.scheduleAgentPoll();
        }
    }
    scheduleAgentSessionRefresh(sessionId) {
        if (this.agentSessionRefreshTimer !== null)
            window.clearTimeout(this.agentSessionRefreshTimer);
        this.agentSessionRefreshTimer = window.setTimeout(async () => {
            this.agentSessionRefreshTimer = null;
            if (this.state.agent.selectedSession?.session.id !== sessionId)
                return;
            try {
                const snapshot = await (await this.getAgentClient()).agent.sessions.get(sessionId);
                if (this.state.agent.selectedSession?.session.id !== sessionId)
                    return;
                this.applySelectedAgentSession(snapshot);
                this.renderSelectedAgentSession();
            }
            catch {
                this.scheduleAgentPoll();
            }
        }, 120);
    }
    closeAgentSessionSubscription() {
        this.agentSessionSubscriptionGeneration += 1;
        this.agentSessionSubscription?.close();
        this.agentSessionSubscription = null;
        if (this.agentSessionRefreshTimer !== null) {
            window.clearTimeout(this.agentSessionRefreshTimer);
            this.agentSessionRefreshTimer = null;
        }
    }
    applySelectedAgentSession(snapshot) {
        this.state.agent.selectedSession = snapshot;
        this.state.agent.selectedWorkspaceId = snapshot.session.workspaceId;
        this.state.agent.sessions.sessions = mergeAgentSessions(this.state.agent.sessions.sessions, [summarizeAgentSession(snapshot)]);
    }
    resolveDefaultAgentWorkspaceId() {
        return this.state.agent.defaultWorkspaceId
            ?? this.state.agent.selectedWorkspaceId
            ?? this.state.agent.workspaces[0]?.id
            ?? null;
    }
    async performAgentMutation(action, refresh = true) {
        if (!this.state.isAdmin || this.state.agent.busy) {
            return;
        }
        this.state.agent.busy = true;
        this.state.agent.error = null;
        this.renderAgentSurfaces();
        try {
            const message = await action(await this.getAgentClient());
            if (refresh) {
                await this.refreshAgentWorkbench();
            }
            if (message) {
                toastr.success(message, TOAST_TITLE);
            }
        }
        catch (error) {
            this.reportAgentError(error);
        }
        finally {
            this.state.agent.busy = false;
            this.renderAgentSurfaces();
            this.scheduleAgentPoll();
        }
    }
    beginAgentSession() {
        this.closeAgentSessionSubscription();
        this.setMobileSurface('none');
        this.state.agent.creatingSession = true;
        this.state.agent.selectedSession = null;
        this.state.agent.inspectorTab = 'activity';
        this.renderAgentSurfaces();
        this.playSurfaceEntrance('.authority-agent-main > :first-child');
    }
    applyAgentPrompt(prompt) {
        const field = this.root.querySelector('[data-role="agent-new-message"]');
        if (!field)
            return;
        field.value = prompt;
        field.focus();
    }
    async createAgentSession() {
        const message = this.agentFieldValue('agent-new-message');
        const workspaceId = this.resolveDefaultAgentWorkspaceId();
        const profileId = this.state.agent.profiles.some(profile => profile.id === this.state.agent.selectedProfileId)
            ? this.state.agent.selectedProfileId
            : this.state.agent.profiles[0]?.id ?? null;
        if (!message || !workspaceId || !profileId) {
            this.reportAgentError(new Error(!message
                ? '请先描述你想让 Agent 完成的事情。'
                : !profileId
                    ? '请先在设置中配置模型连接。'
                    : 'SillyTavern 默认作用域尚未初始化，请刷新后重试。'));
            this.renderAgentSurfaces();
            return;
        }
        const mode = this.agentFieldValue('agent-new-mode');
        const maxSteps = Number(this.agentFieldValue('agent-new-max-steps'));
        const request = {
            message,
            workspaceId,
            profileId,
            mode,
            maxSteps,
        };
        await this.performAgentMutation(async (client) => {
            const snapshot = await client.agent.sessions.create(request);
            this.state.agent.selectedSession = snapshot;
            this.state.agent.creatingSession = false;
            this.state.agent.inspectorTab = 'activity';
            this.state.agent.selectedWorkspaceId = snapshot.session.workspaceId;
            this.clearAgentFields('agent-new-message');
            return 'Agent 会话已开始';
        });
    }
    async selectAgentSession(sessionId) {
        if (this.state.agent.busy)
            return;
        this.closeAgentSessionSubscription();
        this.setMobileSurface('none');
        this.state.agent.fileDiffs.clear();
        this.state.agent.busy = true;
        this.renderAgentSurfaces();
        try {
            const snapshot = await (await this.getAgentClient()).agent.sessions.get(sessionId);
            this.state.agent.selectedSession = snapshot;
            this.state.agent.creatingSession = false;
            this.state.agent.selectedWorkspaceId = snapshot.session.workspaceId;
            this.state.agent.error = null;
            const workspace = await this.fetchAgentWorkspace(await this.getAgentClient(), snapshot.session.workspaceId);
            this.state.agent.workspaceStatus = workspace.status;
            this.state.agent.workspaceCommits = workspace.commits;
            this.state.agent.workspaceDiff = workspace.diff;
        }
        catch (error) {
            this.reportAgentError(error);
        }
        finally {
            this.state.agent.busy = false;
            this.renderAgentSurfaces();
            this.playSurfaceEntrance('.authority-agent-main > :first-child');
            void this.subscribeSelectedAgentSession();
            this.scheduleAgentPoll();
        }
    }
    async sendAgentMessage(sessionId) {
        const content = this.agentFieldValue('agent-message');
        const delivery = this.agentFieldValue('agent-message-delivery');
        await this.performAgentMutation(async (client) => {
            const result = await client.agent.sessions.send(sessionId, { content, delivery });
            this.applySelectedAgentSession(result.snapshot);
            this.clearAgentFields('agent-message');
        }, false);
    }
    async updateAgentSession(sessionId) {
        const request = {
            title: this.agentFieldValue('agent-session-title'),
            profileId: this.agentFieldValue('agent-session-profile'),
            mode: this.agentFieldValue('agent-session-mode'),
            maxSteps: Number(this.agentFieldValue('agent-session-max-steps')),
        };
        await this.performAgentMutation(async (client) => {
            this.applySelectedAgentSession(await client.agent.sessions.update(sessionId, request));
            return '会话设置已保存';
        }, false);
    }
    async cancelAgentRun(sessionId, runId) {
        const snapshot = this.state.agent.selectedSession?.session.id === sessionId
            ? this.state.agent.selectedSession
            : null;
        if (!await showImpactConfirmation({
            title: '取消 Agent 运行',
            description: '运行会停止继续规划和调用工具，但会话仍可继续。',
            confirmLabel: '取消运行',
            target: snapshot?.session.title ?? runId,
            effects: ['已经完成的工具副作用不会自动撤销。', '需要恢复文件时，可以在右侧“变更”中回退到检查点。'],
            tone: 'warning',
        }))
            return;
        await this.performAgentMutation(async (client) => {
            this.applySelectedAgentSession(await client.agent.sessions.cancelRun(sessionId, runId));
            return '当前运行已取消';
        }, false);
    }
    async resumeAgentRun(sessionId, runId) {
        await this.performAgentMutation(async (client) => {
            this.applySelectedAgentSession(await client.agent.sessions.resumeRun(sessionId, runId));
            return 'Agent 运行已恢复';
        }, false);
    }
    async continueFailedAgentRun(sessionId, runId) {
        const snapshot = this.state.agent.selectedSession;
        const run = snapshot?.session.id === sessionId
            ? snapshot.runs.find(item => item.id === runId)
            : null;
        if (run?.status !== 'failed') {
            this.reportAgentError(new Error('这次运行已经不处于失败状态，请刷新后重试。'));
            this.renderAgentSurfaces();
            return;
        }
        await this.performAgentMutation(async (client) => {
            const result = await client.agent.sessions.continueFailedRun(sessionId, runId);
            this.applySelectedAgentSession(result.snapshot);
            return '已安排从当前状态开始新的运行';
        }, false);
    }
    async resolveAgentApproval(sessionId, approvalId, decision) {
        await this.performAgentMutation(async (client) => {
            this.applySelectedAgentSession(await client.agent.admin.sessions.resolveApproval(sessionId, approvalId, { decision }));
            return decision === 'approve' ? '已批准工具调用' : '已拒绝工具调用';
        }, false);
    }
    async loadMoreAgentSessions() {
        const cursor = this.state.agent.sessions.page.nextCursor;
        if (!cursor || this.state.agent.loading)
            return;
        await this.refreshAgentWorkbench({ cursor, append: true });
    }
    buildAgentProfileInput() {
        const id = this.agentFieldValue('agent-profile-id');
        const apiKey = this.agentFieldValue('agent-profile-api-key');
        return {
            ...(id ? { id } : {}),
            displayName: this.agentFieldValue('agent-profile-name'),
            provider: 'openai-compatible',
            baseUrl: this.agentFieldValue('agent-profile-base-url'),
            model: this.agentFieldValue('agent-profile-model'),
            ...(apiKey ? { apiKey } : {}),
            temperature: Number(this.agentFieldValue('agent-profile-temperature')),
            maxOutputTokens: Number(this.agentFieldValue('agent-profile-max-tokens')),
            timeoutMs: Number(this.agentFieldValue('agent-profile-timeout')),
        };
    }
    async saveAgentProfile() {
        const input = this.buildAgentProfileInput();
        await this.performAgentMutation(async (client) => {
            const profile = await client.agent.admin.profiles.upsert(input);
            this.state.agent.selectedProfileId = profile.id;
            this.clearAgentFields('agent-profile-api-key');
            return 'LLM 配置已保存';
        });
    }
    async deleteAgentProfile(profileId) {
        const profile = this.state.agent.profiles.find(item => item.id === profileId);
        if (!await showImpactConfirmation({
            title: '删除 LLM 配置',
            description: '这会移除服务端保存的模型地址、参数和密钥。',
            confirmLabel: '删除配置',
            target: profile ? `${profile.displayName} · ${profile.model}` : profileId,
            effects: ['正在使用这项配置的 Agent 运行会阻止删除。', '删除后需要重新填写 API Key 才能恢复。'],
            tone: 'danger',
        })) {
            return;
        }
        await this.performAgentMutation(async (client) => {
            await client.agent.admin.profiles.delete(profileId);
            this.state.agent.profileTest = null;
            if (this.state.agent.selectedProfileId === profileId) {
                this.state.agent.selectedProfileId = null;
            }
            this.setMobileSurface('none');
            return 'LLM 配置已删除';
        });
    }
    async checkpointAgentWorkspace() {
        const workspaceId = this.state.agent.selectedWorkspaceId;
        if (!workspaceId)
            return;
        const message = this.agentFieldValue('agent-checkpoint-message') || 'Manual checkpoint from Agent Studio';
        await this.performAgentMutation(async (client) => {
            const result = await client.agent.admin.workspaces.checkpoint(workspaceId, { message });
            return `检查点已建立，记录 ${result.changedPaths} 个路径`;
        });
    }
    async rollbackAgentWorkspace(commitId) {
        const workspaceId = this.state.agent.selectedWorkspaceId;
        const workspace = this.state.agent.workspaces.find(item => item.id === workspaceId);
        if (!workspaceId || !await showImpactConfirmation({
            title: '回退工作区',
            description: '将工作区内容恢复到选定检查点。',
            confirmLabel: '开始回退',
            target: `${workspace?.displayName ?? workspaceId} @ ${commitId.slice(0, 12)}`,
            effects: ['当前文件会按检查点内容变更。', '如果存在未提交修改，操作会停在冲突状态，不会静默覆盖。', '中断后可以从右侧检查器继续。'],
            tone: 'danger',
        })) {
            return;
        }
        await this.performAgentMutation(async (client) => {
            const result = await client.agent.admin.workspaces.rollback(workspaceId, {
                targetCommitId: commitId,
                operationId: globalThis.crypto.randomUUID(),
            });
            return `工作区已回退，恢复 ${result.changedPaths} 个路径`;
        });
    }
    async resumeAgentWorkspaceRollback() {
        const workspaceId = this.state.agent.selectedWorkspaceId;
        if (!workspaceId || !await showImpactConfirmation({
            title: '继续工作区回退',
            description: '恢复上次未完成的回退事务。',
            confirmLabel: '继续回退',
            target: workspaceId,
            effects: ['只会继续已经记录的回退操作。', '若当前文件再次发生冲突，事务仍会停止并保留恢复入口。'],
            tone: 'warning',
        })) {
            return;
        }
        await this.performAgentMutation(async (client) => {
            const result = await client.agent.admin.workspaces.resumeRollback(workspaceId);
            return `中断的回退已完成，恢复 ${result.changedPaths} 个路径`;
        });
    }
    agentFieldValue(role) {
        return this.root.querySelector(`[data-role="${role}"]`)?.value.trim() ?? '';
    }
    clearAgentFields(...roles) {
        for (const role of roles) {
            const field = this.root.querySelector(`[data-role="${role}"]`);
            if (field)
                field.value = '';
        }
    }
    reportAgentError(error) {
        const message = error instanceof Error ? error.message : String(error);
        this.state.agent.error = message;
        toastr.error(getSystemMessageLabel(message), TOAST_TITLE);
    }
    async updateStManagerBridgeConfig(options = {}) {
        if (!this.state.isAdmin || this.state.stManagerBridgeActionInProgress) {
            return;
        }
        const payload = buildStManagerBridgePayload({
            enabled: options.forceEnabled ?? this.getStManagerBridgeEnabled(),
            maxFileSizeMiB: this.getStManagerBridgeMaxFileSizeMiB(),
            resourceTypes: this.getStManagerBridgeResourceTypes(),
            ...(options.rotateKey ? { rotateKey: true } : {}),
        });
        this.state.stManagerBridgeActionInProgress = true;
        void this.renderUpdatesSection();
        try {
            const response = await authorityRequest('/st-manager/bridge/admin/config', {
                method: 'POST',
                body: payload,
            });
            this.applyStManagerBridgeConfig(response);
            toastr.success(options.rotateKey ? 'Bridge Key 已生成' : '桥接配置已保存', TOAST_TITLE);
        }
        catch (error) {
            toastr.error(getSystemMessageLabel(error instanceof Error ? error.message : String(error)), TOAST_TITLE);
        }
        finally {
            this.state.stManagerBridgeActionInProgress = false;
            void this.renderUpdatesSection();
        }
    }
    applyStManagerBridgeConfig(value) {
        const config = normalizeStManagerBridgeConfig(value);
        if (!config) {
            this.state.stManagerBridgeConfig = null;
            this.state.stManagerBridgeGeneratedKey = null;
            return;
        }
        const { bridge_key: bridgeKey, ...publicConfig } = config;
        this.state.stManagerBridgeConfig = publicConfig;
        if (bridgeKey) {
            this.state.stManagerBridgeGeneratedKey = bridgeKey;
        }
    }
    getStManagerBridgeEnabled() {
        const input = this.root.querySelector('[data-role="st-manager-bridge-enabled"]');
        return input?.checked ?? Boolean(this.state.stManagerBridgeConfig?.enabled);
    }
    getStManagerBridgeMaxFileSizeMiB() {
        const input = this.root.querySelector('[data-role="st-manager-bridge-max-file-size"]');
        const value = Number(input?.value ?? 0);
        if (Number.isFinite(value) && value < 0) {
            return -1;
        }
        if (Number.isFinite(value) && value > 0) {
            return value;
        }
        const configuredMaxFileSize = this.state.stManagerBridgeConfig?.max_file_size ?? 100 * 1024 * 1024;
        if (configuredMaxFileSize < 0) {
            return -1;
        }
        return Math.max(1, Math.ceil(configuredMaxFileSize / (1024 * 1024)));
    }
    getStManagerBridgeResourceTypes() {
        const checked = Array.from(this.root.querySelectorAll('[data-role="st-manager-bridge-resource"]:checked'))
            .map(input => input.value);
        return checked.length ? checked : this.state.stManagerBridgeConfig?.resource_types ?? [];
    }
    getStManagerControlResourceTypes() {
        const checked = Array.from(this.root.querySelectorAll('[data-role="st-manager-control-resource"]:checked'))
            .map(input => input.value);
        return checked.length ? checked : ST_MANAGER_RESOURCE_OPTIONS.map(option => option.type);
    }
    async copyStManagerBridgeKey() {
        const input = this.root.querySelector('[data-role="st-manager-bridge-key"]');
        const key = input?.value || this.state.stManagerBridgeGeneratedKey;
        if (!key) {
            toastr.warning('当前没有可复制的 Bridge Key', TOAST_TITLE);
            return;
        }
        try {
            if (navigator.clipboard?.writeText) {
                await navigator.clipboard.writeText(key);
            }
            else {
                copyTextWithFallback(key);
            }
            toastr.success('Bridge Key 已复制', TOAST_TITLE);
        }
        catch (error) {
            toastr.error(getSystemMessageLabel(error instanceof Error ? error.message : String(error)), TOAST_TITLE);
        }
    }
    async updateStManagerControlConfig() {
        if (!this.state.isAdmin || this.state.stManagerControlActionInProgress) {
            return;
        }
        const payload = buildStManagerControlPayload({
            enabled: true,
            managerUrl: this.root.querySelector('[data-role="st-manager-control-url"]')?.value ?? '',
            controlKey: this.root.querySelector('[data-role="st-manager-control-key"]')?.value ?? '',
        });
        this.state.stManagerControlActionInProgress = true;
        void this.renderUpdatesSection();
        try {
            const response = await authorityRequest('/st-manager/control/config', {
                method: 'POST',
                body: payload,
            });
            this.state.stManagerControlConfig = normalizeStManagerControlConfig(response);
            toastr.success('ST-Manager 控制配置已保存', TOAST_TITLE);
        }
        catch (error) {
            toastr.error(getSystemMessageLabel(error instanceof Error ? error.message : String(error)), TOAST_TITLE);
        }
        finally {
            this.state.stManagerControlActionInProgress = false;
            void this.renderUpdatesSection();
        }
    }
    async probeStManagerControl() {
        await this.runStManagerControlAction(async () => {
            await authorityRequest('/st-manager/control/probe', { method: 'POST' });
            toastr.success('ST-Manager 连接可用', TOAST_TITLE);
        });
    }
    async startStManagerBackup() {
        await this.runStManagerControlAction(async () => {
            await authorityRequest('/st-manager/control/backup/start', {
                method: 'POST',
                body: {
                    resource_types: this.getStManagerControlResourceTypes(),
                    description: 'manual backup from Authority',
                    ingest: true,
                },
            });
            toastr.success('已触发 ST-Manager 备份', TOAST_TITLE);
            await this.refreshStManagerBackups(false);
        });
    }
    async pairStManagerControl() {
        const bridgeKey = this.state.stManagerBridgeGeneratedKey;
        if (!bridgeKey) {
            toastr.warning('请先在 Authority 里生成或轮换 Bridge Key，再同步给 ST-Manager。', TOAST_TITLE);
            return;
        }
        await this.runStManagerControlAction(async () => {
            await authorityRequest('/st-manager/control/pair', {
                method: 'POST',
                body: {
                    st_url: window.location.origin,
                    remote_connection_mode: 'authority_bridge',
                    remote_bridge_key: bridgeKey,
                    enabled_resource_types: this.getStManagerBridgeResourceTypes(),
                },
            });
            toastr.success('已同步 Bridge 配置到 ST-Manager', TOAST_TITLE);
        });
    }
    async refreshStManagerBackups(showToast = true) {
        await this.runStManagerControlAction(async () => {
            const response = await authorityRequest('/st-manager/control/backups');
            this.state.stManagerControlBackups = Array.isArray(response.backups) ? response.backups : [];
            if (showToast) {
                toastr.success('备份列表已刷新', TOAST_TITLE);
            }
        });
    }
    async previewStManagerRestore() {
        const backupId = this.getSelectedStManagerBackupId();
        if (!backupId) {
            toastr.warning('请先选择一个备份', TOAST_TITLE);
            return;
        }
        await this.runStManagerControlAction(async () => {
            const preview = await authorityRequest('/st-manager/control/restore-preview', {
                method: 'POST',
                body: {
                    backup_id: backupId,
                    resource_types: this.getStManagerControlResourceTypes(),
                },
            });
            toastr.success(`恢复预览完成：${JSON.stringify(preview).slice(0, 80)}`, TOAST_TITLE);
        });
    }
    async restoreStManagerBackup() {
        const backupId = this.getSelectedStManagerBackupId();
        if (!backupId) {
            toastr.warning('请先选择一个备份', TOAST_TITLE);
            return;
        }
        const overwrite = Boolean(this.root.querySelector('[data-role="st-manager-control-overwrite"]')?.checked);
        if (!await showImpactConfirmation({
            title: '从 ST-Manager 恢复',
            description: overwrite ? '恢复时允许覆盖酒馆中已有的同路径资源。' : '恢复时跳过酒馆中已有的同路径资源。',
            confirmLabel: overwrite ? '允许覆盖并恢复' : '跳过已有并恢复',
            target: backupId,
            effects: [
                `资源范围：${this.getStManagerControlResourceTypes().join(', ') || '未选择'}`,
                overwrite ? '同路径资源可能被备份版本替换。' : '现有同路径资源会保持不变。',
                '建议先使用“恢复预览”核对影响范围。',
            ],
            tone: overwrite ? 'danger' : 'warning',
        })) {
            return;
        }
        await this.runStManagerControlAction(async () => {
            await authorityRequest('/st-manager/control/restore', {
                method: 'POST',
                body: {
                    backup_id: backupId,
                    overwrite,
                    resource_types: this.getStManagerControlResourceTypes(),
                },
            });
            toastr.success('已触发 ST-Manager 恢复', TOAST_TITLE);
        });
    }
    async runStManagerControlAction(action) {
        if (!this.state.isAdmin || this.state.stManagerControlActionInProgress) {
            return;
        }
        this.state.stManagerControlActionInProgress = true;
        void this.renderUpdatesSection();
        try {
            await action();
        }
        catch (error) {
            toastr.error(getSystemMessageLabel(error instanceof Error ? error.message : String(error)), TOAST_TITLE);
        }
        finally {
            this.state.stManagerControlActionInProgress = false;
            void this.renderUpdatesSection();
        }
    }
    getSelectedStManagerBackupId() {
        return this.root.querySelector('[data-role="st-manager-control-backup"]:checked')?.value ?? '';
    }
    toggleSecretVisibility(button) {
        const targetRole = button.dataset.targetRole;
        if (!targetRole) {
            return;
        }
        const input = Array.from(this.root.querySelectorAll('input[data-role]'))
            .find(item => item.dataset.role === targetRole);
        if (!input) {
            return;
        }
        const shouldReveal = input.type === 'password';
        input.type = shouldReveal ? 'text' : 'password';
        button.textContent = shouldReveal ? '🙈' : '👁';
        button.setAttribute('aria-pressed', shouldReveal ? 'true' : 'false');
    }
    async runAdminUpdate(action) {
        if (!this.state.isAdmin || this.state.updateInProgress) {
            return;
        }
        if (!await showImpactConfirmation(action === 'git-pull' ? {
            title: '拉取并更新 Authority',
            description: '对插件仓库执行 fast-forward 更新，随后重新部署前端并尝试重启后台服务。',
            confirmLabel: '开始更新',
            target: this.state.probe?.pluginVersion ?? '当前安装',
            effects: ['不会合并有分叉的本地提交。', '新的 Node 服务端代码通常要重启 SillyTavern 才会完全生效。', '更新结果与 Git 输出会保留在本页。'],
            tone: 'warning',
        } : {
            title: '重新部署前端界面',
            description: '用插件内置版本替换当前部署的 Authority 前端。',
            confirmLabel: '重新部署',
            target: this.state.probe?.sdkDeployedVersion ?? '当前前端',
            effects: ['不会联网，也不会修改服务端代码。', '当前打开的界面需要刷新后才能使用新文件。'],
            tone: 'warning',
        })) {
            return;
        }
        this.state.updateInProgress = true;
        void this.renderUpdatesSection();
        try {
            const result = await authorityRequest('/admin/update', {
                method: 'POST',
                body: { action },
            });
            this.state.updateResult = result;
            toastr.success(result.message, TOAST_TITLE);
            await this.refresh();
            this.state.updateResult = result;
            this.state.selectedTab = 'updates';
            void this.render();
        }
        catch (error) {
            toastr.error(getSystemMessageLabel(error instanceof Error ? error.message : String(error)), TOAST_TITLE);
        }
        finally {
            this.state.updateInProgress = false;
            void this.renderUpdatesSection();
        }
    }
    async exportDiagnosticBundle() {
        if (!this.state.isAdmin) {
            return;
        }
        try {
            const bundle = await authorityRequest('/admin/diagnostic-bundle');
            const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
            downloadJsonFile(`authority-diagnostic-bundle-${timestamp}.json`, bundle);
            toastr.success('诊断包已导出', TOAST_TITLE);
        }
        catch (error) {
            toastr.error(getSystemMessageLabel(error instanceof Error ? error.message : String(error)), TOAST_TITLE);
        }
    }
    async exportDiagnosticArchive() {
        if (!this.state.isAdmin || this.state.packageActionInProgress) {
            return;
        }
        this.state.packageActionInProgress = true;
        void this.renderUpdatesSection();
        try {
            const response = await authorityRequest('/admin/diagnostic-bundle/archive', { method: 'POST' });
            await this.downloadArtifact(response);
            toastr.success('诊断归档已导出', TOAST_TITLE);
        }
        catch (error) {
            toastr.error(getSystemMessageLabel(error instanceof Error ? error.message : String(error)), TOAST_TITLE);
        }
        finally {
            this.state.packageActionInProgress = false;
            void this.renderUpdatesSection();
        }
    }
    async exportPortablePackage() {
        if (!this.state.isAdmin || this.state.packageActionInProgress) {
            return;
        }
        this.state.packageActionInProgress = true;
        void this.renderUpdatesSection();
        try {
            const operation = await authorityRequest('/admin/import-export/export', {
                method: 'POST',
                body: {},
            });
            toastr.success(`导出任务已开始：${operation.id}`, TOAST_TITLE);
            await this.refresh();
            this.state.selectedTab = 'updates';
            void this.render();
        }
        catch (error) {
            toastr.error(getSystemMessageLabel(error instanceof Error ? error.message : String(error)), TOAST_TITLE);
        }
        finally {
            this.state.packageActionInProgress = false;
            void this.renderUpdatesSection();
        }
    }
    async importPortablePackage() {
        if (!this.state.isAdmin || this.state.packageActionInProgress) {
            return;
        }
        const fileInput = this.root.querySelector('[data-role="import-package-file"]');
        const modeSelect = this.root.querySelector('[data-role="import-package-mode"]');
        const file = fileInput?.files?.[0] ?? null;
        if (!file) {
            toastr.warning('请先选择要导入的数据包文件', TOAST_TITLE);
            return;
        }
        const mode = (modeSelect?.value === 'merge' ? 'merge' : 'replace');
        if (!await showImpactConfirmation({
            title: '导入 Authority 数据包',
            description: mode === 'replace' ? '覆盖导入会先清空现有 Authority 数据，再导入包内内容。' : '合并导入会保留现有数据并补充包内内容。',
            confirmLabel: mode === 'replace' ? '覆盖并导入' : '合并导入',
            target: `${file.name} · ${formatBytes(file.size)}`,
            effects: mode === 'replace'
                ? ['授权、规则、文件和数据库会以数据包为准。', '导入会作为后台任务执行，并在本页保留进度。']
                : ['同名数据按服务端合并规则处理。', '导入会作为后台任务执行，并在本页保留进度。'],
            tone: mode === 'replace' ? 'danger' : 'warning',
        })) {
            return;
        }
        this.state.packageActionInProgress = true;
        void this.renderUpdatesSection();
        try {
            const transfer = await authorityRequest('/admin/import-export/import-transfer/init', {
                method: 'POST',
                body: { sizeBytes: file.size },
            });
            await this.uploadFileToTransfer(file, transfer);
            const operation = await authorityRequest('/admin/import-export/import', {
                method: 'POST',
                body: {
                    transferId: transfer.transferId,
                    mode,
                    fileName: file.name,
                },
            });
            if (fileInput) {
                fileInput.value = '';
            }
            toastr.success(`导入任务已开始：${operation.id}`, TOAST_TITLE);
            await this.refresh();
            this.state.selectedTab = 'updates';
            void this.render();
        }
        catch (error) {
            toastr.error(getSystemMessageLabel(error instanceof Error ? error.message : String(error)), TOAST_TITLE);
        }
        finally {
            this.state.packageActionInProgress = false;
            void this.renderUpdatesSection();
        }
    }
    async previewNativeMigration(target) {
        if (!this.state.isAdmin || this.state.nativeMigrationActionInProgress) {
            return;
        }
        const fileInput = this.root.querySelector(`[data-role="native-migration-file"][data-target="${target}"]`);
        const file = fileInput?.files?.[0] ?? null;
        if (!file) {
            toastr.warning('请先选择要迁移导入的 ZIP 压缩包', TOAST_TITLE);
            return;
        }
        this.state.nativeMigrationActionInProgress = true;
        void this.renderUpdatesSection();
        try {
            const transfer = await authorityRequest('/admin/native-migration/upload/init', {
                method: 'POST',
                body: { sizeBytes: file.size },
            });
            await this.uploadFileToTransfer(file, transfer);
            const operation = await authorityRequest('/admin/native-migration/preview', {
                method: 'POST',
                body: {
                    transferId: transfer.transferId,
                    target,
                    fileName: file.name,
                },
            });
            if (fileInput) {
                fileInput.value = '';
            }
            toastr.success(`迁移预览已生成：${operation.id}`, TOAST_TITLE);
            await this.refresh();
            this.state.selectedTab = 'updates';
            void this.render();
        }
        catch (error) {
            toastr.error(getSystemMessageLabel(error instanceof Error ? error.message : String(error)), TOAST_TITLE);
        }
        finally {
            this.state.nativeMigrationActionInProgress = false;
            void this.renderUpdatesSection();
        }
    }
    async applyNativeMigration(operationId) {
        if (!this.state.isAdmin || this.state.nativeMigrationActionInProgress) {
            return;
        }
        const modeSelect = Array.from(this.root.querySelectorAll('[data-role="native-migration-mode"]'))
            .find(select => select.dataset.operationId === operationId) ?? null;
        const mode = (modeSelect?.value === 'overwrite' ? 'overwrite' : 'skip');
        const operation = this.state.nativeMigrationOperations.find(item => item.id === operationId);
        if (!await showImpactConfirmation({
            title: '应用原生 SillyTavern 迁移',
            description: mode === 'overwrite' ? '写入压缩包内容，并覆盖目标目录中的同名文件。' : '只写入目标目录中尚不存在的文件。',
            confirmLabel: mode === 'overwrite' ? '创建备份并覆盖' : '跳过已有并导入',
            target: operation?.sourceFileName ?? operationId,
            effects: mode === 'overwrite'
                ? ['Authority 会先创建回滚备份。', '不会运行 npm install、重启或自动启用脚本。']
                : ['目标目录中已有文件不会改变。', '不会运行 npm install、重启或自动启用脚本。'],
            tone: mode === 'overwrite' ? 'danger' : 'warning',
        })) {
            return;
        }
        this.state.nativeMigrationActionInProgress = true;
        void this.renderUpdatesSection();
        try {
            const appliedOperation = await authorityRequest(`/admin/native-migration/operations/${encodeURIComponent(operationId)}/apply`, {
                method: 'POST',
                body: { mode },
            });
            toastr.success(`迁移已应用：${appliedOperation.id}`, TOAST_TITLE);
            await this.refresh();
        }
        catch (error) {
            toastr.error(getSystemMessageLabel(error instanceof Error ? error.message : String(error)), TOAST_TITLE);
        }
        finally {
            this.state.nativeMigrationActionInProgress = false;
            void this.renderUpdatesSection();
        }
    }
    async rollbackNativeMigration(operationId) {
        if (!this.state.isAdmin || this.state.nativeMigrationActionInProgress) {
            return;
        }
        if (!await showImpactConfirmation({
            title: '回滚原生迁移',
            description: '撤销这次迁移仍可安全恢复的写入。',
            confirmLabel: '回滚迁移',
            target: operationId,
            effects: ['只撤销本次迁移写入且此后未被用户修改的文件。', '已被用户继续修改的文件不会静默覆盖。'],
            tone: 'danger',
        })) {
            return;
        }
        this.state.nativeMigrationActionInProgress = true;
        void this.renderUpdatesSection();
        try {
            const operation = await authorityRequest(`/admin/native-migration/operations/${encodeURIComponent(operationId)}/rollback`, {
                method: 'POST',
            });
            toastr.success(`迁移已回滚：${operation.id}`, TOAST_TITLE);
            await this.refresh();
        }
        catch (error) {
            toastr.error(getSystemMessageLabel(error instanceof Error ? error.message : String(error)), TOAST_TITLE);
        }
        finally {
            this.state.nativeMigrationActionInProgress = false;
            void this.renderUpdatesSection();
        }
    }
    async resumePackageOperation(operationId) {
        if (!this.state.isAdmin || this.state.packageActionInProgress) {
            return;
        }
        this.state.packageActionInProgress = true;
        void this.renderUpdatesSection();
        try {
            const operation = await authorityRequest(`/admin/import-export/operations/${encodeURIComponent(operationId)}/resume`, {
                method: 'POST',
            });
            toastr.success(`任务已恢复：${operation.id}`, TOAST_TITLE);
            await this.refresh();
            void this.render();
        }
        catch (error) {
            toastr.error(getSystemMessageLabel(error instanceof Error ? error.message : String(error)), TOAST_TITLE);
        }
        finally {
            this.state.packageActionInProgress = false;
            void this.renderUpdatesSection();
        }
    }
    async downloadPackageOperation(operationId) {
        if (!this.state.isAdmin || this.state.packageActionInProgress) {
            return;
        }
        this.state.packageActionInProgress = true;
        void this.renderUpdatesSection();
        try {
            const response = await authorityRequest(`/admin/import-export/operations/${encodeURIComponent(operationId)}/open-download`, {
                method: 'POST',
            });
            await this.downloadArtifact(response);
            toastr.success('导出包已下载', TOAST_TITLE);
        }
        catch (error) {
            toastr.error(getSystemMessageLabel(error instanceof Error ? error.message : String(error)), TOAST_TITLE);
        }
        finally {
            this.state.packageActionInProgress = false;
            void this.renderUpdatesSection();
        }
    }
    async selectExtension(extensionId, tab, mobileOrigin) {
        const mobileFocusOrigin = this.mobileMediaQuery.matches ? this.captureMobileFocus(mobileOrigin) : undefined;
        this.state.selectedExtensionId = extensionId;
        this.state.selectedTab = tab;
        if (!this.state.details.has(extensionId)) {
            const detail = await authorityRequest(`/extensions/${encodeURIComponent(extensionId)}`);
            this.state.details.set(extensionId, detail);
        }
        void this.render();
        if (!this.mobileMediaQuery.matches)
            this.playSurfaceEntrance('.authority-governance-detail > :first-child');
        this.setMobileSurface('governance-detail', true, undefined, mobileFocusOrigin);
    }
    async resetGrants(extensionId, keys) {
        if (!keys && !await showImpactConfirmation({
            title: '重置扩展的全部授权',
            description: '移除这个扩展已经持久化的允许、拒绝与封锁记录。',
            confirmLabel: '重置全部授权',
            target: extensionId,
            effects: ['扩展下次请求相关能力时会重新进入授权流程。', '管理员全局策略不会被删除。'],
            tone: 'danger',
        })) {
            return;
        }
        try {
            await authorityRequest(`/extensions/${encodeURIComponent(extensionId)}/grants/reset`, {
                method: 'POST',
                body: { keys },
            });
            toastr.success('授权已重置', TOAST_TITLE);
            await this.refresh();
        }
        catch (error) {
            toastr.error(getSystemMessageLabel(error instanceof Error ? error.message : String(error)), TOAST_TITLE);
        }
    }
    async savePolicies() {
        if (!this.state.isAdmin || !this.state.policies) {
            return;
        }
        try {
            const nextExtensions = { ...this.state.policies.extensions };
            const extensionId = this.state.policyEditorExtensionId;
            if (extensionId) {
                const entries = this.collectOverridePolicies();
                if (Object.keys(entries).length > 0) {
                    nextExtensions[extensionId] = entries;
                }
                else {
                    delete nextExtensions[extensionId];
                }
            }
            this.state.policies = await authorityRequest('/admin/policies', {
                method: 'POST',
                body: {
                    defaults: this.collectDefaultPolicies(),
                    extensions: nextExtensions,
                },
            });
            toastr.success('管理员策略已保存', TOAST_TITLE);
            await this.refresh();
        }
        catch (error) {
            toastr.error(getSystemMessageLabel(error instanceof Error ? error.message : String(error)), TOAST_TITLE);
        }
    }
    collectDefaultPolicies() {
        const result = {};
        for (const select of this.root.querySelectorAll('[data-policy-default]')) {
            const resource = select.dataset.policyDefault;
            result[resource] = select.value;
        }
        return result;
    }
    collectOverridePolicies() {
        const result = {};
        for (const row of this.root.querySelectorAll('.authority-policy-row')) {
            const resourceSelect = row.querySelector('[data-policy-field="resource"]');
            const targetInput = row.querySelector('[data-policy-field="target"]');
            const statusSelect = row.querySelector('[data-policy-field="status"]');
            if (!resourceSelect || !targetInput || !statusSelect) {
                continue;
            }
            const resource = resourceSelect.value;
            const target = (targetInput.value || '*').trim() || '*';
            const key = `${resource}:${target}`;
            result[key] = {
                key,
                resource,
                target,
                status: statusSelect.value,
                riskLevel: getRiskLevel(resource),
                updatedAt: new Date().toISOString(),
                source: 'admin',
            };
        }
        return result;
    }
    addPolicyOverrideRow(entry) {
        const container = this.root.querySelector('[data-role="policy-rows"]');
        if (!container) {
            return;
        }
        const wrapper = document.createElement('div');
        wrapper.className = 'authority-policy-row';
        wrapper.innerHTML = this.buildPolicyRowMarkup(entry);
        container.appendChild(wrapper);
    }
    handleMobileAction(element) {
        switch (element.dataset.action) {
            case 'mobile-open-surface': {
                const surface = element.dataset.mobileSurface;
                if (!isMobileSurface(surface) || surface === 'none') {
                    return false;
                }
                if (surface === 'governance-inspector') {
                    this.state.selectedTab = 'detail';
                    this.renderTabs();
                    this.toggleSections();
                }
                this.setMobileSurface(surface, true, element);
                return true;
            }
            case 'mobile-close-surface':
                this.setMobileSurface(getMobileBackSurface(this.state.mobile.surface));
                return true;
            case 'mobile-navigate': {
                const tab = element.dataset.tab;
                if (!isValidCenterTab(tab)) {
                    return false;
                }
                this.setMobileSurface('none', false);
                if (tab === 'updates') {
                    this.state.system.selectedView = 'recovery';
                }
                this.switchTab(tab);
                if (tab === 'updates') {
                    this.renderUpdatesSection();
                    if (!this.state.system.recoveryLoaded && !this.state.system.recoveryLoading) {
                        void this.refreshSystemRecovery();
                    }
                }
                this.renderMobilePresentation();
                return true;
            }
            default:
                return false;
        }
    }
    setMobileSurface(surface, restoreOrigin = true, origin, preparedOrigin) {
        if (this.state.mobile.surface === surface) {
            if (surface === 'none' && !restoreOrigin)
                this.mobileFocusOrigin = null;
            return;
        }
        if (this.state.mobile.surface === 'none' && surface !== 'none' && this.mobileMediaQuery.matches) {
            this.mobileFocusOrigin = preparedOrigin === undefined ? this.captureMobileFocus(origin) : preparedOrigin;
        }
        if (surface === 'none' && !restoreOrigin)
            this.mobileFocusOrigin = null;
        this.state.mobile.surface = surface;
        this.renderMobilePresentation();
    }
    switchTab(tab) {
        if (!PRIMARY_TAB_NAMES.includes(tab)) {
            return;
        }
        if ((tab === 'agent' || tab === 'policies' || tab === 'updates' || tab === 'settings') && !this.state.isAdmin) {
            return;
        }
        if (this.state.selectedTab === tab) {
            this.renderMobilePresentation();
            return;
        }
        if (getCenterArea(this.state.selectedTab) !== getCenterArea(tab)) {
            this.setMobileSurface('none', false);
        }
        this.state.selectedTab = tab;
        this.renderTabs();
        this.toggleSections();
        this.renderMobilePresentation();
        if ((tab === 'agent' || tab === 'settings') && !this.state.agent.loaded) {
            void this.refreshAgentWorkbench();
        }
        if (tab === 'agent' && this.state.agent.loaded) {
            void this.subscribeSelectedAgentSession();
            this.scheduleAgentPoll();
        }
        else {
            this.closeAgentSessionSubscription();
            if (this.agentPollTimer !== null) {
                window.clearTimeout(this.agentPollTimer);
                this.agentPollTimer = null;
            }
        }
        if (tab === 'updates' && this.state.system.selectedView === 'recovery' && !this.state.system.recoveryLoaded) {
            void this.refreshSystemRecovery();
        }
    }
    render() {
        this.renderHeader();
        this.renderTabs();
        this.renderExtensionList();
        this.renderOverviewSection();
        this.renderDetailSection();
        this.renderDatabasesSection();
        this.renderActivitySection();
        this.renderAgentSection();
        this.renderPoliciesSection();
        this.renderUpdatesSection();
        this.renderSettingsSection();
        this.toggleSections();
        this.renderMobilePresentation();
    }
    renderHeader() {
        const status = this.root.querySelector('[data-role="status"]');
        const badges = this.root.querySelector('[data-role="health-badges"]');
        if (!status) {
            return;
        }
        if (badges) {
            const probe = this.state.probe;
            badges.innerHTML = `
                <span class="authority-header-health"><i class="authority-status-dot authority-status-dot--${escapeHtml(probe?.core.state ?? 'starting')}"></i>服务 ${escapeHtml(getCoreStateLabel(probe?.core.state))}</span>
                <span class="authority-header-health">${escapeHtml(this.state.isAdmin ? '管理员' : '普通用户')}</span>
            `;
        }
        if (this.state.loading) {
            status.innerHTML = renderAlertStack([
                { tone: 'info', title: '状态同步中', message: '正在读取 Authority 状态与扩展记录。' },
            ]);
            return;
        }
        if (this.state.error) {
            status.innerHTML = renderAlertStack([
                { tone: 'error', title: '同步失败', message: getSystemMessageLabel(this.state.error) },
            ]);
            return;
        }
        const alerts = [];
        if (this.state.probe?.installMessage) {
            alerts.push({ tone: 'info', title: '组件状态', message: getSystemMessageLabel(this.state.probe.installMessage) });
        }
        if (this.state.probe?.coreMessage) {
            alerts.push({ tone: 'warning', title: '后台服务提醒', message: getSystemMessageLabel(this.state.probe.coreMessage) });
        }
        if (this.state.probe?.core.lastError) {
            alerts.push({ tone: 'error', title: '后台服务错误', message: getSystemMessageLabel(this.state.probe.core.lastError) });
        }
        if (this.state.probe?.core.health?.lastError) {
            alerts.push({ tone: 'warning', title: '后台服务最近错误', message: getSystemMessageLabel(this.state.probe.core.health.lastError) });
        }
        status.innerHTML = renderAlertStack(alerts);
    }
    renderTabs() {
        const tablist = this.root.querySelector('[role="tablist"]');
        const activeArea = getCenterArea(this.state.selectedTab);
        this.root.dataset.admin = this.state.isAdmin ? 'true' : 'false';
        for (const areaTab of this.root.querySelectorAll('[data-area]')) {
            const area = areaTab.dataset.area;
            if (!area)
                continue;
            const isActive = area === activeArea;
            const requiresAdmin = area === 'agent' || area === 'system' || area === 'settings';
            areaTab.hidden = requiresAdmin && !this.state.isAdmin;
            areaTab.classList.toggle('authority-area-tab--active', isActive);
            if (isActive) {
                areaTab.setAttribute('aria-current', 'page');
            }
            else {
                areaTab.removeAttribute('aria-current');
            }
        }
        for (const adminOnly of this.root.querySelectorAll('[data-admin-only]')) {
            adminOnly.hidden = !this.state.isAdmin;
        }
        const governanceTabs = this.root.querySelector('[data-role="governance-tabs"]');
        if (governanceTabs) {
            governanceTabs.hidden = activeArea !== 'governance';
        }
        if (tablist) {
            for (const tab of tablist.querySelectorAll('[role="tab"]')) {
                const tabName = tab.dataset.tab;
                if (!tabName || !PRIMARY_TAB_NAMES.includes(tabName))
                    continue;
                const isActive = tabName === this.state.selectedTab;
                tab.classList.toggle('authority-tab--active', isActive);
                tab.hidden = tabName === 'policies' && !this.state.isAdmin;
                tab.setAttribute('aria-selected', isActive ? 'true' : 'false');
                tab.setAttribute('tabindex', isActive ? '0' : '-1');
            }
        }
    }
    renderSettingsSection() {
        const container = this.root.querySelector('[data-role="settings-view"]');
        if (!container) {
            return;
        }
        if (!this.state.isAdmin) {
            container.innerHTML = `
                <div class="authority-empty">
                    <strong>需要管理员权限</strong>
                    <span>全局连接与模型配置仅对管理员开放。</span>
                </div>
            `;
            return;
        }
        const draft = this.captureAgentFormDraft(container);
        container.innerHTML = renderAgentSettings(this.state.agent);
        this.restoreAgentFormDraft(container, draft);
        this.renderMobilePresentation();
    }
    renderExtensionList() {
        const container = this.root.querySelector('[data-role="extension-list"]');
        const count = this.root.querySelector('[data-role="extension-count"]');
        if (!container) {
            return;
        }
        const directory = renderExtensionDirectory(this.state);
        container.innerHTML = directory.html;
        if (count)
            count.textContent = String(directory.count);
    }
    renderOverviewSection() {
        const container = this.root.querySelector('[data-role="overview-view"]');
        if (container)
            container.innerHTML = renderGovernanceOverview(this.state);
    }
    renderDetailSection() {
        const container = this.root.querySelector('[data-role="detail-view"]');
        if (container)
            container.innerHTML = renderExtensionDossier(this.state);
    }
    renderDatabasesSection() {
        const container = this.root.querySelector('[data-role="databases-view"]');
        if (container)
            container.innerHTML = renderDataAssets(this.state);
    }
    renderActivitySection() {
        const container = this.root.querySelector('[data-role="activity-view"]');
        if (container)
            container.innerHTML = renderAuditWorkspace(this.state);
    }
    renderAgentSection() {
        const container = this.root.querySelector('[data-role="agent-view"]');
        if (!container) {
            return;
        }
        const liveStatus = this.root.querySelector('[data-role="agent-live-status"]');
        const announcement = this.state.isAdmin
            ? getAgentStatusAnnouncement(this.state.agent)
            : '只有管理员可以使用 Agent 工作台';
        if (liveStatus && liveStatus.textContent !== announcement)
            liveStatus.textContent = announcement;
        const draft = this.captureAgentFormDraft(container);
        const focus = this.captureAgentFocus(container);
        container.innerHTML = this.state.isAdmin
            ? renderAgentWorkbench(this.state.agent)
            : '<div class="authority-empty">只有管理员可以使用 Agent 工作台。</div>';
        this.restoreAgentFormDraft(container, draft);
        this.restoreAgentFocus(container, focus);
        this.renderMobilePresentation();
    }
    renderAgentSurfaces() {
        this.renderAgentSection();
        this.renderSettingsSection();
    }
    captureAgentFormDraft(container) {
        const values = new Map();
        for (const field of container.querySelectorAll('[data-role^="agent-"]')) {
            if (field.dataset.role)
                values.set(field.dataset.role, field.value);
        }
        return { profileId: values.get('agent-profile-id') ?? '', values };
    }
    captureAgentFocus(container) {
        const active = document.activeElement;
        if (!(active instanceof HTMLElement) || !container.contains(active))
            return null;
        const data = {};
        for (const key of AGENT_FOCUS_DATA_KEYS) {
            const value = active.dataset[key];
            if (value)
                data[key] = value;
        }
        const selection = active instanceof HTMLInputElement || active instanceof HTMLTextAreaElement;
        return {
            action: active.dataset.action ?? null,
            role: active.dataset.role ?? null,
            data,
            selectionStart: selection ? active.selectionStart : null,
            selectionEnd: selection ? active.selectionEnd : null,
        };
    }
    restoreAgentFocus(container, snapshot) {
        if (!snapshot)
            return;
        const candidates = container.querySelectorAll('[data-action], [data-role]');
        const target = Array.from(candidates).find(element => {
            if (snapshot.action && element.dataset.action !== snapshot.action)
                return false;
            if (snapshot.role && element.dataset.role !== snapshot.role)
                return false;
            if (!snapshot.action && !snapshot.role)
                return false;
            return Object.entries(snapshot.data).every(([key, value]) => element.dataset[key] === value);
        });
        if (!target || (target instanceof HTMLButtonElement && target.disabled))
            return;
        target.focus({ preventScroll: true });
        if ((target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement)
            && snapshot.selectionStart !== null && snapshot.selectionEnd !== null) {
            target.setSelectionRange(snapshot.selectionStart, snapshot.selectionEnd);
        }
    }
    restoreAgentFormDraft(container, draft) {
        const selectedProfileId = this.state.agent.selectedProfileId ?? '';
        for (const field of container.querySelectorAll('[data-role^="agent-"]')) {
            const role = field.dataset.role;
            const value = role ? draft.values.get(role) : undefined;
            if (value === undefined || (role.startsWith('agent-profile-') && draft.profileId !== selectedProfileId))
                continue;
            if (field instanceof HTMLSelectElement && !Array.from(field.options).some(option => option.value === value))
                continue;
            field.value = value;
        }
    }
    renderPoliciesSection() {
        const container = this.root.querySelector('[data-role="policies-view"]');
        if (container)
            container.innerHTML = renderPolicyWorkbench(this.state);
    }
    renderUpdatesSection() {
        const container = this.root.querySelector('[data-role="updates-view"]');
        if (!container) {
            return;
        }
        container.innerHTML = this.state.isAdmin
            ? renderSystemWorkbench(this.state)
            : '<div class="authority-empty">只有管理员可以使用这里的维护、备份和迁移功能。</div>';
        this.renderMobilePresentation();
    }
    getRequiredSessionToken() {
        const sessionToken = this.state.session?.sessionToken;
        if (!sessionToken) {
            throw new Error('Security Center session is not initialized');
        }
        return sessionToken;
    }
    async downloadArtifact(response) {
        const sessionToken = this.getRequiredSessionToken();
        const chunks = [];
        let offset = 0;
        try {
            while (true) {
                const chunk = await authorityRequest(`/transfers/${encodeURIComponent(response.transfer.transferId)}/read`, {
                    method: 'POST',
                    body: {
                        offset,
                        limit: response.transfer.chunkSize,
                    },
                    sessionToken,
                });
                const bytes = base64ToBytes(chunk.content);
                const copy = new Uint8Array(bytes.byteLength);
                copy.set(bytes);
                chunks.push(copy.buffer);
                offset += bytes.byteLength;
                if (chunk.eof) {
                    break;
                }
            }
            downloadBlobFile(response.artifact.fileName, new Blob(chunks, { type: response.artifact.mediaType }));
        }
        finally {
            await authorityRequest(`/transfers/${encodeURIComponent(response.transfer.transferId)}/discard`, {
                method: 'POST',
                sessionToken,
            }).catch(() => undefined);
        }
    }
    async uploadFileToTransfer(file, transfer) {
        const sessionToken = this.getRequiredSessionToken();
        let offset = 0;
        while (offset < file.size) {
            const chunk = new Uint8Array(await file.slice(offset, offset + transfer.chunkSize).arrayBuffer());
            await authorityRequest(`/transfers/${encodeURIComponent(transfer.transferId)}/append`, {
                method: 'POST',
                body: {
                    offset,
                    content: bytesToBase64(chunk),
                },
                sessionToken,
            });
            offset += chunk.byteLength;
        }
    }
    buildPolicyRowMarkup(entry) {
        return renderPolicyOverrideRow(entry);
    }
    toggleSections() {
        const activeArea = getCenterArea(this.state.selectedTab);
        for (const panel of this.root.querySelectorAll('[data-area-panel]')) {
            const isActive = panel.dataset.areaPanel === activeArea;
            panel.hidden = !isActive;
            panel.setAttribute('aria-hidden', isActive ? 'false' : 'true');
        }
        for (const section of this.root.querySelectorAll('[data-section]')) {
            const name = section.dataset.section;
            if (!name || !PRIMARY_TAB_NAMES.includes(name)) {
                continue;
            }
            const isActive = name === this.state.selectedTab;
            section.hidden = !isActive;
            section.setAttribute('aria-hidden', isActive ? 'false' : 'true');
            section.setAttribute('tabindex', isActive ? '0' : '-1');
        }
    }
    playSurfaceEntrance(selector) {
        if (window.matchMedia('(prefers-reduced-motion: reduce)').matches)
            return;
        const element = this.root.querySelector(selector);
        if (!element)
            return;
        element.classList.remove('authority-motion-enter');
        window.requestAnimationFrame(() => {
            if (!element.isConnected)
                return;
            element.classList.add('authority-motion-enter');
            const cleanup = (event) => {
                if (event.target !== element || event.animationName !== 'authority-view-enter')
                    return;
                element.classList.remove('authority-motion-enter');
                element.removeEventListener('animationend', cleanup);
            };
            element.addEventListener('animationend', cleanup);
        });
    }
    async testAgentProfile() {
        if (!this.state.isAdmin || this.state.agent.busy)
            return;
        this.state.agent.busy = true;
        this.state.agent.profileTest = null;
        this.renderAgentSurfaces();
        try {
            const input = this.buildAgentProfileInput();
            const result = await (await this.getAgentClient()).agent.admin.profiles.test({ profile: input });
            const message = result.ok
                ? `连接成功 · ${result.latencyMs} ms`
                : agentProfileTestFailureLabel(result.failure, result.statusCode);
            this.state.agent.profileTest = { status: result.ok ? 'success' : 'error', message };
            if (result.ok)
                toastr.success(message, TOAST_TITLE);
            else
                toastr.error(message, TOAST_TITLE);
        }
        catch (error) {
            const message = getSystemMessageLabel(error instanceof Error ? error.message : String(error));
            this.state.agent.profileTest = { status: 'error', message };
            toastr.error(message, TOAST_TITLE);
        }
        finally {
            this.state.agent.busy = false;
            this.renderAgentSurfaces();
            this.scheduleAgentPoll();
        }
    }
    renderMobilePresentation() {
        const activeArea = getCenterArea(this.state.selectedTab);
        this.root.dataset.mobileArea = activeArea;
        this.root.dataset.mobileSurface = this.state.mobile.surface;
        for (const trigger of this.root.querySelectorAll('[data-action="mobile-open-surface"]')) {
            trigger.setAttribute('aria-expanded', trigger.dataset.mobileSurface === this.state.mobile.surface ? 'true' : 'false');
        }
        for (const tab of this.root.querySelectorAll('[data-role="mobile-governance-tabs"] [data-tab]')) {
            const isActive = tab.dataset.tab === this.state.selectedTab
                && this.state.mobile.surface !== 'governance-inspector';
            tab.classList.toggle('authority-mobile-governance-tab--active', isActive);
            tab.setAttribute('aria-selected', isActive ? 'true' : 'false');
            tab.setAttribute('tabindex', isActive ? '0' : '-1');
        }
        for (const tab of this.root.querySelectorAll('[data-role="mobile-governance-tabs"] [data-mobile-surface]')) {
            const isActive = tab.dataset.mobileSurface === this.state.mobile.surface;
            tab.classList.toggle('authority-mobile-governance-tab--active', isActive);
            tab.setAttribute('aria-selected', isActive ? 'true' : 'false');
            tab.setAttribute('tabindex', isActive ? '0' : '-1');
        }
        const title = this.root.querySelector('[data-role="mobile-governance-title"]');
        if (title) {
            const extension = this.state.extensions.find(item => item.id === this.state.selectedExtensionId);
            title.textContent = extension ? extension.displayName : '扩展治理';
        }
        const visibleSurface = this.mobileMediaQuery.matches ? this.state.mobile.surface : 'none';
        const previousSurface = this.renderedMobileSurface;
        this.renderedMobileSurface = visibleSurface;
        const isMobile = this.mobileMediaQuery.matches;
        const agentMain = this.root.querySelector('.authority-agent-main');
        const shouldInert = visibleSurface === 'agent-sessions' || visibleSurface === 'agent-inspector';
        agentMain?.toggleAttribute('inert', shouldInert);
        const setInert = (selector, inert) => {
            for (const element of this.root.querySelectorAll(selector)) {
                element.toggleAttribute('inert', inert);
            }
        };
        setInert('.authority-agent-rail', isMobile && visibleSurface !== 'agent-sessions');
        setInert('.authority-agent-inspector', isMobile && visibleSurface !== 'agent-inspector');
        setInert('.authority-extension-nav', isMobile && visibleSurface !== 'none');
        setInert('.authority-governance-stage', isMobile
            && visibleSurface !== 'governance-detail'
            && visibleSurface !== 'governance-inspector');
        setInert('.authority-extension-dossier__main', isMobile && visibleSurface === 'governance-inspector');
        setInert('.authority-extension-inspector', isMobile && visibleSurface !== 'governance-inspector');
        setInert('.authority-recovery-history', isMobile && visibleSurface === 'system-detail');
        setInert('.authority-recovery-detail', isMobile && visibleSurface !== 'system-detail');
        setInert('.authority-settings-content__header, .authority-model-profile-list', isMobile && visibleSurface === 'settings-editor');
        setInert('.authority-model-editor', isMobile && visibleSurface !== 'settings-editor');
        if (isMobile) {
            this.syncMobileFocus(previousSurface, visibleSurface);
        }
    }
    captureMobileFocus(origin) {
        const active = origin ?? (document.activeElement instanceof HTMLElement ? document.activeElement : null);
        if (!active || !this.root.contains(active))
            return null;
        const data = {};
        for (const key of MOBILE_FOCUS_DATA_KEYS) {
            const value = active.dataset[key];
            if (value)
                data[key] = value;
        }
        return {
            element: active,
            action: active.dataset.action ?? null,
            role: active.dataset.role ?? null,
            data,
        };
    }
    syncMobileFocus(previousSurface, surface) {
        if (previousSurface !== surface && surface === 'none') {
            this.restoreMobileFocus();
            return;
        }
        if (surface === 'none')
            return;
        const panelSelectors = {
            'agent-sessions': '.authority-agent-rail',
            'agent-inspector': '.authority-agent-inspector',
            'governance-detail': '.authority-governance-stage',
            'governance-inspector': '.authority-governance-stage',
            'system-detail': '.authority-system-recovery',
            'settings-editor': '.authority-model-editor',
        };
        const focusSelectors = {
            'agent-sessions': '.authority-agent-rail [data-action="mobile-close-surface"]',
            'agent-inspector': '.authority-agent-inspector [data-action="mobile-close-surface"]',
            'governance-detail': '.authority-mobile-stage-bar [data-action="mobile-close-surface"]',
            'governance-inspector': '[data-role="mobile-governance-tabs"] [data-mobile-surface="governance-inspector"]',
            'system-detail': '.authority-mobile-recovery-header [data-action="mobile-close-surface"]',
            'settings-editor': '.authority-settings-mobile-back[data-action="mobile-close-surface"]',
        };
        const panelSelector = panelSelectors[surface];
        const focusSelector = focusSelectors[surface];
        const panel = panelSelector ? this.root.querySelector(panelSelector) : null;
        const target = focusSelector ? this.root.querySelector(focusSelector) : null;
        if (!target)
            return;
        const active = document.activeElement instanceof HTMLElement ? document.activeElement : null;
        const mobileNav = this.root.querySelector('.authority-mobile-nav');
        const transition = previousSurface !== surface;
        if (!transition && active) {
            if (panel?.contains(active) || mobileNav?.contains(active))
                return;
            if (active !== document.body && !this.root.contains(active))
                return;
        }
        target.focus({ preventScroll: true });
    }
    restoreMobileFocus() {
        const snapshot = this.mobileFocusOrigin;
        this.mobileFocusOrigin = null;
        if (!snapshot)
            return;
        const candidates = snapshot.element.isConnected
            ? [snapshot.element]
            : Array.from(this.root.querySelectorAll('[data-action], [data-role], [data-mobile-surface], [data-extension-id], [data-session-id], [data-profile-id], [data-commit-id], [data-tab], [data-area]'));
        const target = candidates.find(element => {
            if (snapshot.action && element.dataset.action !== snapshot.action)
                return false;
            if (snapshot.role && element.dataset.role !== snapshot.role)
                return false;
            if (!snapshot.action && !snapshot.role && Object.keys(snapshot.data).length === 0)
                return false;
            return Object.entries(snapshot.data).every(([key, value]) => element.dataset[key] === value);
        });
        if (!target || target.closest('[hidden], [inert]'))
            return;
        const style = window.getComputedStyle(target);
        if (style.display === 'none' || style.visibility === 'hidden')
            return;
        target.focus({ preventScroll: true });
    }
    resolveSelectedExtensionId() {
        if (this.state.selectedExtensionId && this.state.extensions.some(item => item.id === this.state.selectedExtensionId)) {
            return this.state.selectedExtensionId;
        }
        return this.state.extensions[0]?.id ?? null;
    }
    resolvePolicyEditorExtensionId() {
        if (this.state.policyEditorExtensionId && this.state.extensions.some(item => item.id === this.state.policyEditorExtensionId)) {
            return this.state.policyEditorExtensionId;
        }
        if (this.focusExtensionId && this.state.extensions.some(item => item.id === this.focusExtensionId)) {
            return this.focusExtensionId;
        }
        return this.state.extensions[0]?.id ?? null;
    }
    getSelectedDetail() {
        if (!this.state.selectedExtensionId) {
            return null;
        }
        return this.state.details.get(this.state.selectedExtensionId) ?? null;
    }
}
function mergeAgentSessions(existing, incoming) {
    const sessions = new Map(existing.map(session => [session.id, session]));
    for (const session of incoming) {
        sessions.set(session.id, session);
    }
    return [...sessions.values()].sort((left, right) => {
        const timestamp = right.updatedAt.localeCompare(left.updatedAt);
        return timestamp || right.id.localeCompare(left.id);
    });
}
function summarizeAgentSession(snapshot) {
    const ref = snapshot.refs.find(item => item.name === 'main') ?? snapshot.refs[0];
    const run = getActiveAgentSessionRun(snapshot);
    const path = new Set(snapshot.activePaths[ref?.name ?? 'main'] ?? []);
    const messages = snapshot.conversation.filter((entry) => entry.kind === 'message' && path.has(entry.id));
    const lastMessage = [...messages].reverse().find(entry => entry.content?.trim());
    return {
        ...snapshot.session,
        status: run?.status ?? 'idle',
        activeRunId: run?.id ?? null,
        activeRunStatus: run?.status ?? null,
        messageCount: messages.length,
        pendingApprovalCount: snapshot.approvals.filter(approval => approval.status === 'pending').length,
        pendingMessageCount: snapshot.pendingMessages.length,
        lastMessagePreview: lastMessage?.content?.replace(/\s+/g, ' ').trim().slice(0, 180) ?? null,
        lastSequence: snapshot.lastSequence,
    };
}
function base64ToBytes(content) {
    const binary = atob(content);
    const bytes = new Uint8Array(binary.length);
    for (let index = 0; index < binary.length; index += 1) {
        bytes[index] = binary.charCodeAt(index);
    }
    return bytes;
}
function bytesToBase64(bytes) {
    let binary = '';
    for (let index = 0; index < bytes.length; index += 1) {
        binary += String.fromCharCode(bytes[index] ?? 0);
    }
    return btoa(binary);
}
function downloadBlobFile(fileName, blob) {
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = fileName;
    anchor.click();
    URL.revokeObjectURL(url);
}
function downloadJsonFile(fileName, value) {
    const blob = new Blob([JSON.stringify(value, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = fileName;
    anchor.click();
    URL.revokeObjectURL(url);
}
function copyTextWithFallback(value) {
    const textarea = document.createElement('textarea');
    textarea.value = value;
    textarea.setAttribute('readonly', 'true');
    textarea.style.position = 'fixed';
    textarea.style.opacity = '0';
    document.body.appendChild(textarea);
    textarea.select();
    document.execCommand('copy');
    textarea.remove();
}
//# sourceMappingURL=security-center.js.map
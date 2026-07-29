import { authorityRequest } from './api.js';
import { clearChildren, escapeHtml, formatDate } from './dom.js';
import { renderActivityLogRows, renderAlertStack, renderCapabilityMatrix, renderDatabaseAssetSections, renderDatabaseGroupTable, renderGrantSettingsRows, renderJobTable, renderPolicyRows, renderStorageSummary, renderStringList, } from './security-center/components.js';
import { RESOURCE_OPTIONS, SECURITY_CENTER_CONFIG, STATUS_OPTIONS, } from './security-center/constants.js';
import { getActiveAgentSessionRun, isActiveAgentSession, renderAgentSessionMain, renderAgentWorkbench, } from './security-center/agent-workbench.js';
import { showImpactConfirmation } from './security-center/impact-confirmation.js';
import { formatBytes, getCoreStateLabel, getDeclaredPermissionLabels, getExtensionRiskLevel, getInstallStatusLabel, getInstallTypeLabel, getResourceLabel, getRiskLabel, getRiskLevel, getStatusLabel, getSystemMessageLabel, sortByTimestampDesc, } from './security-center/formatters.js';
import { buildStManagerBridgePayload, normalizeStManagerBridgeConfig, renderStManagerBridgeSection, ST_MANAGER_RESOURCE_OPTIONS, } from './security-center/st-manager-bridge.js';
import { buildStManagerControlPayload, normalizeStManagerControlConfig, renderStManagerControlSection, } from './security-center/st-manager-control.js';
import { bootstrapSecurityCenter as bootstrapSecurityCenterHost, openSecurityCenter as openSecurityCenterHost, } from './security-center/host.js';
import { buildOverviewModel, getDatabaseGroupSummaries } from './security-center/view-models.js';
const TOAST_TITLE = '权限中心';
const MISSING_TEXT = '未获取';
const PRIMARY_TAB_NAMES = ['overview', 'detail', 'databases', 'activity', 'agent', 'policies', 'updates'];
function isValidCenterTab(value) {
    return typeof value === 'string' && PRIMARY_TAB_NAMES.includes(value);
}
function getCenterArea(tab) {
    if (tab === 'agent')
        return 'agent';
    if (tab === 'updates')
        return 'system';
    return 'governance';
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
    initialTabPending;
    constructor(root, focusExtensionId) {
        this.root = root;
        this.focusExtensionId = focusExtensionId;
        this.initialTabPending = !focusExtensionId;
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
                profiles: [],
                tools: [],
                workspaces: [],
                sessions: {
                    sessions: [],
                    page: { nextCursor: null, limit: 50, hasMore: false, totalCount: 0 },
                },
                selectedProfileId: null,
                selectedWorkspaceId: null,
                selectedSession: null,
                creatingSession: true,
                inspectorTab: 'activity',
                workspaceStatus: null,
                workspaceCommits: [],
                workspaceDiff: null,
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
        this.root.addEventListener('click', event => {
            const target = event.target instanceof Element ? event.target : null;
            if (!target) {
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
                    this.switchTab(tab);
                }
                return;
            }
            const refreshButton = target.closest('[data-action="refresh"]');
            if (refreshButton) {
                void this.refresh();
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
                    void this.selectExtension(extensionId, 'detail');
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
                const tab = nextTab.dataset.tab;
                if (tab) {
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
            if (target.matches('[data-role="agent-workspace-select"], [data-role="agent-new-workspace"]')) {
                this.state.agent.selectedWorkspaceId = target.value || null;
                void this.refreshSelectedAgentWorkspace();
                return;
            }
            if (target.matches('[data-role="agent-new-profile"]')) {
                this.state.agent.selectedProfileId = target.value || null;
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
            if (!this.state.isAdmin && (this.state.selectedTab === 'agent' || this.state.selectedTab === 'policies' || this.state.selectedTab === 'updates')) {
                this.state.selectedTab = 'detail';
            }
            if (this.state.isAdmin && this.state.selectedTab === 'agent') {
                await this.refreshAgentWorkbench();
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
                    || element.dataset.inspectorTab === 'workspace'
                    || element.dataset.inspectorTab === 'settings') {
                    this.state.agent.inspectorTab = element.dataset.inspectorTab;
                    void this.renderAgentSection();
                }
                return;
            case 'agent-edit-profile':
                this.state.agent.selectedProfileId = element.dataset.profileId ?? null;
                void this.renderAgentSection();
                return;
            case 'agent-new-profile':
                this.state.agent.selectedProfileId = null;
                void this.renderAgentSection();
                return;
            case 'agent-save-profile':
                void this.saveAgentProfile();
                return;
            case 'agent-delete-profile':
                if (element.dataset.profileId)
                    void this.deleteAgentProfile(element.dataset.profileId);
                return;
            case 'agent-register-workspace':
                void this.registerAgentWorkspace();
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
        }
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
        this.state.agent.loading = true;
        this.state.agent.error = null;
        void this.renderAgentSection();
        try {
            const client = await this.getAgentClient();
            const sessionRequest = {
                page: { ...(options.cursor ? { cursor: options.cursor } : {}), limit: 50 },
            };
            const [profiles, tools, workspaces, sessions] = await Promise.all([
                client.agent.admin.profiles.list(),
                client.agent.listTools(),
                client.agent.admin.workspaces.list(),
                client.agent.sessions.listPage(sessionRequest),
            ]);
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
                : workspaces.some(workspace => workspace.id === this.state.agent.selectedWorkspaceId)
                    ? this.state.agent.selectedWorkspaceId
                    : workspaces[0]?.id ?? null;
            const workspaceResult = await (selectedWorkspaceId
                ? this.fetchAgentWorkspace(client, selectedWorkspaceId)
                    .then(value => ({ value, error: null }))
                    .catch(error => ({ value: null, error }))
                : Promise.resolve({ value: null, error: null }));
            if (generation !== this.agentRefreshGeneration)
                return;
            this.state.agent.profiles = profiles;
            this.state.agent.tools = tools;
            this.state.agent.workspaces = workspaces;
            this.state.agent.sessions = options.append
                ? { sessions: mergeAgentSessions(this.state.agent.sessions.sessions, sessions.sessions), page: sessions.page }
                : sessions;
            this.state.agent.selectedProfileId = selectedProfileId;
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
            void this.renderAgentSection();
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
    async refreshSelectedAgentWorkspace() {
        if (!this.state.isAdmin || this.state.agent.busy) {
            return;
        }
        this.state.agent.busy = true;
        void this.renderAgentSection();
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
            void this.renderAgentSection();
        }
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
        const container = this.root.querySelector('[data-role="agent-session-main"]');
        if (container) {
            const draft = this.captureAgentFormDraft(container);
            container.innerHTML = renderAgentSessionMain(this.state.agent, this.state.agent.busy ? 'disabled' : '');
            this.restoreAgentFormDraft(container, draft);
        }
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
    async performAgentMutation(action, refresh = true) {
        if (!this.state.isAdmin || this.state.agent.busy) {
            return;
        }
        this.state.agent.busy = true;
        this.state.agent.error = null;
        void this.renderAgentSection();
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
            void this.renderAgentSection();
            this.scheduleAgentPoll();
        }
    }
    beginAgentSession() {
        this.closeAgentSessionSubscription();
        this.state.agent.creatingSession = true;
        this.state.agent.selectedSession = null;
        this.state.agent.inspectorTab = 'settings';
        void this.renderAgentSection();
    }
    async createAgentSession() {
        const message = this.agentFieldValue('agent-new-message');
        const workspaceId = this.agentFieldValue('agent-new-workspace');
        const profileId = this.agentFieldValue('agent-new-profile');
        const mode = this.agentFieldValue('agent-new-mode');
        const maxSteps = Number(this.agentFieldValue('agent-new-max-steps'));
        const request = {
            message,
            workspaceId,
            ...(profileId ? { profileId } : {}),
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
        this.state.agent.busy = true;
        void this.renderAgentSection();
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
            void this.renderAgentSection();
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
    async saveAgentProfile() {
        const id = this.agentFieldValue('agent-profile-id');
        const apiKey = this.agentFieldValue('agent-profile-api-key');
        const input = {
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
            if (this.state.agent.selectedProfileId === profileId) {
                this.state.agent.selectedProfileId = null;
            }
            return 'LLM 配置已删除';
        });
    }
    async registerAgentWorkspace() {
        const users = this.agentFieldValue('agent-workspace-users')
            .split(',')
            .map(value => value.trim())
            .filter(Boolean);
        const id = this.agentFieldValue('agent-workspace-id');
        const displayName = this.agentFieldValue('agent-workspace-name');
        const request = {
            ...(id ? { id } : {}),
            ...(displayName ? { displayName } : {}),
            rootPath: this.agentFieldValue('agent-workspace-root'),
            ...(users.length > 0 ? { allowedUserHandles: users } : {}),
        };
        await this.performAgentMutation(async (client) => {
            const workspace = await client.agent.admin.workspaces.register(request);
            this.state.agent.selectedWorkspaceId = workspace.id;
            this.clearAgentFields('agent-workspace-name', 'agent-workspace-root', 'agent-workspace-id', 'agent-workspace-users');
            return 'Agent 工作区已注册';
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
    async selectExtension(extensionId, tab) {
        this.state.selectedExtensionId = extensionId;
        this.state.selectedTab = tab;
        if (!this.state.details.has(extensionId)) {
            const detail = await authorityRequest(`/extensions/${encodeURIComponent(extensionId)}`);
            this.state.details.set(extensionId, detail);
        }
        void this.render();
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
    switchTab(tab) {
        if (!PRIMARY_TAB_NAMES.includes(tab)) {
            return;
        }
        if ((tab === 'agent' || tab === 'policies' || tab === 'updates') && !this.state.isAdmin) {
            return;
        }
        if (this.state.selectedTab === tab) {
            return;
        }
        this.state.selectedTab = tab;
        this.renderTabs();
        this.toggleSections();
        if (tab === 'agent') {
            if (!this.state.agent.loaded) {
                void this.refreshAgentWorkbench();
            }
            else {
                void this.subscribeSelectedAgentSession();
                this.scheduleAgentPoll();
            }
        }
        else {
            this.closeAgentSessionSubscription();
            if (this.agentPollTimer !== null) {
                window.clearTimeout(this.agentPollTimer);
                this.agentPollTimer = null;
            }
        }
    }
    async render() {
        this.renderHeader();
        this.renderTabs();
        this.renderExtensionList();
        await this.renderOverviewSection();
        await this.renderDetailSection();
        await this.renderDatabasesSection();
        await this.renderActivitySection();
        await this.renderAgentSection();
        await this.renderPoliciesSection();
        await this.renderUpdatesSection();
        this.toggleSections();
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
        for (const areaTab of this.root.querySelectorAll('[data-area]')) {
            const area = areaTab.dataset.area;
            if (!area)
                continue;
            const isActive = area === activeArea;
            const requiresAdmin = area === 'agent' || area === 'system';
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
    renderExtensionList() {
        const container = this.root.querySelector('[data-role="extension-list"]');
        const count = this.root.querySelector('[data-role="extension-count"]');
        if (!container) {
            return;
        }
        clearChildren(container);
        const filter = this.state.extensionFilter;
        const extensions = filter
            ? this.state.extensions.filter(extension => `${extension.displayName} ${extension.id}`.toLowerCase().includes(filter))
            : this.state.extensions;
        if (count) {
            count.textContent = String(extensions.length);
        }
        if (extensions.length === 0) {
            container.innerHTML = '<div class="authority-empty">还没有扩展接入权限中心。</div>';
            return;
        }
        for (const extension of extensions) {
            const detail = this.state.details.get(extension.id);
            const declared = getDeclaredPermissionLabels(extension.declaredPermissions);
            const risk = getExtensionRiskLevel(extension);
            const errorCount = (detail?.activity.errors.length ?? 0) + (detail?.activity.warnings.length ?? 0);
            const item = document.createElement('button');
            item.type = 'button';
            item.className = 'authority-extension-item';
            item.dataset.extensionId = extension.id;
            item.innerHTML = `
                <span class="authority-extension-item__top">
                    <span class="authority-extension-item__title">${escapeHtml(extension.displayName)}</span>
                    <span class="authority-pill authority-pill--${risk}">${escapeHtml(getRiskLabel(risk))}</span>
                </span>
                <span class="authority-extension-item__meta">${escapeHtml(extension.id)}</span>
                <span class="authority-extension-item__stats">
                    <span class="authority-pill authority-pill--runtime">${escapeHtml(getInstallTypeLabel(extension.installType))}</span>
                    <span class="authority-pill authority-pill--prompt">v${escapeHtml(extension.version)}</span>
                    <span class="authority-pill authority-pill--granted">允许 ${extension.grantedCount}</span>
                    <span class="authority-pill authority-pill--denied">拒绝 ${extension.deniedCount}</span>
                    <span class="authority-pill authority-pill--prompt">声明 ${declared.length}</span>
                    ${errorCount > 0 ? `<span class="authority-pill authority-pill--error">异常 ${errorCount}</span>` : ''}
                </span>
                <span class="authority-permission-map" aria-hidden="true">
                    ${['SQL', 'Trivium', '私有文件', 'HTTP'].map(label => `<span>${label}</span>`).join('')}
                </span>
            `;
            item.classList.toggle('authority-extension-item--active', extension.id === this.state.selectedExtensionId);
            container.appendChild(item);
        }
    }
    async renderOverviewSection() {
        const container = this.root.querySelector('[data-role="overview-view"]');
        if (!container) {
            return;
        }
        const overview = buildOverviewModel(this.state);
        const grants = [...this.state.details.values()].flatMap(detail => detail.grants);
        const grantedCount = grants.filter(grant => grant.status === 'granted').length;
        const deniedCount = grants.filter(grant => grant.status === 'denied' || grant.status === 'blocked').length;
        const databaseCount = overview.databaseGroups.reduce((sum, item) => sum + item.databaseCount, 0);
        const attention = [
            ...overview.recentPermissionDenials,
            ...overview.recentWarnings,
            ...overview.recentErrors,
        ].sort(sortByTimestampDesc).slice(0, 12);
        container.innerHTML = `
            <div class="authority-page-stack authority-governance-overview">
                <header class="authority-page-header">
                    <div>
                        <h2>治理概览</h2>
                        <p>这里仅保留跨扩展信号；权限、数据和活动都跟随具体扩展查看。</p>
                    </div>
                    <div class="authority-page-actions">
                        <button type="button" class="authority-action-button authority-action-button--primary" data-tab="detail">打开扩展目录</button>
                        <button type="button" class="authority-action-button" data-tab="activity">查看审计</button>
                    </div>
                </header>

                <div class="authority-governance-glance" aria-label="治理摘要">
                    <span><strong>${this.state.extensions.length}</strong><small>接入扩展</small></span>
                    <span><strong>${grantedCount}</strong><small>允许授权</small></span>
                    <span class="${deniedCount > 0 ? 'authority-governance-glance--warning' : ''}"><strong>${deniedCount}</strong><small>拒绝 / 封锁</small></span>
                    <span><strong>${overview.totalPolicyCount}</strong><small>策略规则</small></span>
                    <span><strong>${databaseCount}</strong><small>数据库</small></span>
                </div>

                <div class="authority-governance-overview-grid">
                    <section class="authority-section-block">
                        <div class="authority-section-heading">
                            <div><h3>需要关注</h3><div class="authority-muted">${attention.length} 条近期信号</div></div>
                        </div>
                        ${renderActivityLogRows(attention, '当前没有需要处理的权限拒绝、告警或错误。')}
                    </section>
                    <section class="authority-section-block">
                        <div class="authority-section-heading">
                            <div><h3>进行中的后台任务</h3><div class="authority-muted">${overview.activeJobs.length} 个排队或运行中的任务</div></div>
                        </div>
                        ${renderJobTable(overview.activeJobs.slice(0, 5), '当前没有排队或运行中的任务。')}
                    </section>
                </div>

                <details class="authority-collapsible-section">
                    <summary><strong>Authority 可治理的能力</strong><span class="authority-muted">按需展开</span></summary>
                    <div class="authority-collapsible-section__body">${renderCapabilityMatrix(RESOURCE_OPTIONS)}</div>
                </details>
            </div>
        `;
    }
    async renderDetailSection() {
        const container = this.root.querySelector('[data-role="detail-view"]');
        if (!container) {
            return;
        }
        const detail = this.getSelectedDetail();
        if (!detail) {
            container.innerHTML = '<div class="authority-empty">先从左侧选一个扩展，再看它的权限、数据和运行情况。</div>';
            return;
        }
        const granted = detail.grants.filter(item => item.status === 'granted');
        const denied = detail.grants.filter(item => item.status === 'denied' || item.status === 'blocked');
        const permissions = [...detail.activity.permissions].sort(sortByTimestampDesc).slice(0, 10);
        const usage = [...detail.activity.usage].sort(sortByTimestampDesc).slice(0, 10);
        const warnings = [...detail.activity.warnings].sort(sortByTimestampDesc).slice(0, 10);
        const errors = [...detail.activity.errors].sort(sortByTimestampDesc).slice(0, 10);
        const jobs = [...detail.jobs].sort((left, right) => right.updatedAt.localeCompare(left.updatedAt)).slice(0, 10);
        const databases = [...detail.databases].sort((left, right) => (right.updatedAt ?? '').localeCompare(left.updatedAt ?? ''));
        const triviumDatabases = [...detail.triviumDatabases].sort((left, right) => (right.updatedAt ?? '').localeCompare(left.updatedAt ?? ''));
        const storage = detail.storage;
        const risk = getExtensionRiskLevel(detail.extension);
        const databaseCount = detail.databases.length + detail.triviumDatabases.length;
        container.innerHTML = `
            <div class="authority-page-stack authority-page-stack--detail">
                <div class="authority-page-header authority-page-header--detail">
                    <div class="authority-dossier-title">
                        <h2>${escapeHtml(detail.extension.displayName)}</h2>
                        <code class="authority-muted">${escapeHtml(detail.extension.id)}</code>
                    </div>
                    <div class="authority-dossier-actions">
                        <span class="authority-pill authority-pill--${risk}">${escapeHtml(getRiskLabel(risk))}</span>
                        <span class="authority-pill authority-pill--medium">${escapeHtml(getInstallTypeLabel(detail.extension.installType))}</span>
                        <span class="authority-pill authority-pill--prompt">v${escapeHtml(detail.extension.version)}</span>
                    </div>
                </div>

                <div class="authority-extension-facts" aria-label="扩展摘要">
                    <span><small>最近活跃</small><strong>${escapeHtml(formatDate(detail.extension.lastSeenAt))}</strong></span>
                    <span><small>能力</small><strong>${getDeclaredPermissionLabels(detail.extension.declaredPermissions).length}</strong></span>
                    <span><small>授权</small><strong>${granted.length} 允许 · ${denied.length} 拒绝</strong></span>
                    <span><small>数据</small><strong>${databaseCount} 个数据库</strong></span>
                    <span><small>任务</small><strong>${detail.jobs.length}</strong></span>
                </div>

                <section class="authority-governance-primary">
                    <div class="authority-section-heading">
                        <div>
                            <h3>权限与能力</h3>
                            <div class="authority-muted">声明范围、当前决定与扩展策略</div>
                        </div>
                        <button type="button" class="authority-action-button authority-action-button--danger" data-action="reset-all-grants" data-extension-id="${escapeHtml(detail.extension.id)}">重置全部授权</button>
                    </div>
                    <div class="authority-governance-permission-layout">
                        <div>
                            <h4>声明能力</h4>
                            ${renderStringList(getDeclaredPermissionLabels(detail.extension.declaredPermissions), '该扩展还没有声明任何权限。')}
                        </div>
                        <div>
                            <h4>当前决定</h4>
                            ${renderGrantSettingsRows(detail.extension.id, [...granted, ...denied], '当前没有持久化授权或拒绝记录。')}
                            ${renderPolicyRows(detail.policies, '当前没有针对该扩展的策略覆盖。')}
                        </div>
                    </div>
                </section>

                <details class="authority-collapsible-section">
                    <summary><strong>数据与存储</strong><span class="authority-muted">${databaseCount} 个数据库</span></summary>
                    <div class="authority-collapsible-section__body authority-stack">
                        ${renderStorageSummary(storage)}
                        ${renderDatabaseAssetSections(databases, triviumDatabases, '该扩展还没有私有数据库。')}
                    </div>
                </details>

                <details class="authority-collapsible-section">
                    <summary><strong>最近活动</strong><span class="authority-muted">权限 ${permissions.length} · 调用 ${usage.length}</span></summary>
                    <div class="authority-collapsible-section__body authority-detail-grid">
                        <div class="authority-log-panel">
                            <div class="authority-section-heading"><div><h3>权限活动</h3></div></div>
                            ${renderActivityLogRows(permissions, '暂无权限活动。')}
                        </div>
                        <div class="authority-log-panel">
                            <div class="authority-section-heading"><div><h3>能力调用</h3></div></div>
                            ${renderActivityLogRows(usage, '暂无能力调用记录。')}
                        </div>
                    </div>
                </details>

                <details class="authority-collapsible-section">
                    <summary><strong>任务与异常</strong><span class="authority-muted">任务 ${jobs.length} · 异常 ${warnings.length + errors.length}</span></summary>
                    <div class="authority-collapsible-section__body authority-detail-grid">
                        <div>
                            <div class="authority-section-heading"><div><h3>后台任务</h3></div></div>
                            ${renderJobTable(jobs, '暂无后台任务。')}
                        </div>
                        <div>
                            <div class="authority-section-heading"><div><h3>告警与错误</h3></div></div>
                            ${renderActivityLogRows([...warnings, ...errors].sort(sortByTimestampDesc), '暂无告警或错误记录。')}
                        </div>
                    </div>
                </details>
            </div>
        `;
    }
    async renderDatabasesSection() {
        const container = this.root.querySelector('[data-role="databases-view"]');
        if (!container) {
            return;
        }
        const databaseGroups = getDatabaseGroupSummaries(this.state.extensions, this.state.details);
        const totalDatabaseCount = databaseGroups.reduce((sum, item) => sum + item.databaseCount, 0);
        const totalDatabaseSize = databaseGroups.reduce((sum, item) => sum + item.totalSizeBytes, 0);
        container.innerHTML = `
            <div class="authority-page-stack">
                <div class="authority-page-header">
                    <div>
                        <div class="authority-eyebrow">Data Assets</div>
                        <h2>各扩展的数据存储</h2>
                        <p>按扩展查看 SQL 数据库与 Trivium 记忆库归档。</p>
                    </div>
                    <div class="authority-list-card__actions">
                        <span class="authority-pill authority-pill--prompt">${totalDatabaseCount} 个数据库</span>
                        <span class="authority-pill authority-pill--prompt">${escapeHtml(formatBytes(totalDatabaseSize))}</span>
                    </div>
                </div>
                ${renderDatabaseGroupTable(databaseGroups, '当前没有发现任何扩展私有数据库。')}
            </div>
        `;
    }
    async renderActivitySection() {
        const container = this.root.querySelector('[data-role="activity-view"]');
        if (!container) {
            return;
        }
        const items = [...this.state.details.values()]
            .flatMap(detail => [...detail.activity.permissions, ...detail.activity.usage, ...detail.activity.errors, ...detail.activity.warnings])
            .sort(sortByTimestampDesc)
            .slice(0, 80);
        const warnings = [...this.state.details.values()]
            .flatMap(detail => detail.activity.warnings)
            .sort(sortByTimestampDesc)
            .slice(0, 40);
        const errors = [...this.state.details.values()]
            .flatMap(detail => detail.activity.errors)
            .sort(sortByTimestampDesc)
            .slice(0, 40);
        container.innerHTML = `
            <div class="authority-page-stack">
                <div class="authority-page-header">
                    <div>
                        <div class="authority-eyebrow">Audit Log</div>
                        <h2>活动记录</h2>
                        <p>权限请求、功能调用与异常的全局审计日志。</p>
                    </div>
                </div>
                <div class="authority-log-layout">
                    <section class="authority-log-panel">
                        <div class="authority-section-heading">
                            <div>
                                <h3>最近活动</h3>
                                <div class="authority-muted">按时间倒序显示最近发生的事情</div>
                            </div>
                        </div>
                        ${renderActivityLogRows(items, '暂无活动记录。')}
                    </section>
                    <section class="authority-log-panel">
                        <div class="authority-section-heading">
                            <div>
                                <h3>运行告警</h3>
                                <div class="authority-muted">例如任务变慢、排队过多或反复重试</div>
                            </div>
                        </div>
                        ${renderActivityLogRows(warnings, '暂无告警记录。')}
                    </section>
                    <section class="authority-log-panel">
                        <div class="authority-section-heading">
                            <div>
                                <h3>错误记录</h3>
                                <div class="authority-muted">这里只显示错误类型的记录</div>
                            </div>
                        </div>
                        ${renderActivityLogRows(errors, '暂无错误记录。')}
                    </section>
                </div>
            </div>
        `;
    }
    async renderAgentSection() {
        const container = this.root.querySelector('[data-role="agent-view"]');
        if (!container) {
            return;
        }
        const draft = this.captureAgentFormDraft(container);
        container.innerHTML = this.state.isAdmin
            ? renderAgentWorkbench(this.state.agent)
            : '<div class="authority-empty">只有管理员可以使用 Agent 工作台。</div>';
        this.restoreAgentFormDraft(container, draft);
    }
    captureAgentFormDraft(container) {
        const values = new Map();
        for (const field of container.querySelectorAll('[data-role^="agent-"]')) {
            if (field.dataset.role)
                values.set(field.dataset.role, field.value);
        }
        return { profileId: values.get('agent-profile-id') ?? '', values };
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
    async renderPoliciesSection() {
        const container = this.root.querySelector('[data-role="policies-view"]');
        if (!container) {
            return;
        }
        if (!this.state.isAdmin) {
            container.innerHTML = '<div class="authority-empty">只有管理员可查看和修改全局策略。</div>';
            return;
        }
        const policies = this.state.policies;
        if (!policies) {
            container.innerHTML = '<div class="authority-empty">策略尚未加载。</div>';
            return;
        }
        const extensionId = this.state.policyEditorExtensionId ?? this.state.selectedExtensionId ?? this.state.extensions[0]?.id ?? '';
        const overrides = extensionId ? Object.values(policies.extensions[extensionId] ?? {}) : [];
        container.innerHTML = `
            <div class="authority-page-stack">
                <div class="authority-page-header">
                    <div>
                        <div class="authority-eyebrow">Compliance Rules</div>
                        <h2>管理员统一规则</h2>
                        <p>全局策略会覆盖扩展请求与用户授权决策，请谨慎修改。</p>
                    </div>
                    <div class="authority-page-actions">
                        <button type="button" class="authority-action-button" data-action="add-policy-row">新增单独规则</button>
                        <button type="button" class="authority-action-button authority-action-button--primary" data-action="save-policies">保存策略</button>
                    </div>
                </div>
                <section class="authority-card authority-card--flat">
                    <div class="authority-card__header">
                        <div>
                            <h3>默认处理规则</h3>
                            <div class="authority-muted">先给每类功能设一个默认处理方式</div>
                        </div>
                        <span class="authority-pill authority-pill--admin">默认规则 ${RESOURCE_OPTIONS.length}</span>
                    </div>
                    <div class="authority-table-wrap">
                        <table class="authority-data-table authority-policy-matrix">
                            <thead>
                                <tr>
                                    <th>能力</th>
                                    <th>内部名称</th>
                                    <th>风险</th>
                                    <th>默认处理</th>
                                </tr>
                            </thead>
                            <tbody>
                                ${RESOURCE_OPTIONS.map(resource => `
                                    <tr>
                                        <td><strong>${escapeHtml(getResourceLabel(resource))}</strong></td>
                                        <td>${escapeHtml(resource)}</td>
                                        <td><span class="authority-pill authority-pill--${getRiskLevel(resource)}">${escapeHtml(getRiskLabel(getRiskLevel(resource)))}</span></td>
                                        <td>
                                            <select data-policy-default="${escapeHtml(resource)}">
                                                ${STATUS_OPTIONS.map(status => `<option value="${status}" ${policies.defaults[resource] === status ? 'selected' : ''}>${escapeHtml(getStatusLabel(status))}</option>`).join('')}
                                            </select>
                                        </td>
                                    </tr>
                                `).join('')}
                            </tbody>
                        </table>
                    </div>
                </section>
                <section class="authority-card authority-card--flat">
                    <div class="authority-card__header">
                        <div>
                            <h3>按扩展单独设置</h3>
                            <div class="authority-muted">可以按扩展、按目标单独覆盖上面的默认规则</div>
                        </div>
                        <label class="authority-policy-field authority-policy-field--inline">
                            <span>选择扩展</span>
                            <select data-policy-editor-extension>
                                ${this.state.extensions.map(extension => `<option value="${escapeHtml(extension.id)}" ${extension.id === extensionId ? 'selected' : ''}>${escapeHtml(extension.displayName)}</option>`).join('')}
                            </select>
                        </label>
                    </div>
                    <div class="authority-policy-rows" data-role="policy-rows">
                        ${overrides.map(entry => this.buildPolicyRowMarkup(entry)).join('')}
                    </div>
                    <div class="authority-policy-footer">
                        <div class="authority-chip-row">
                            <span class="authority-pill authority-pill--granted">默认允许</span>
                            <span class="authority-pill authority-pill--prompt">需要询问</span>
                            <span class="authority-pill authority-pill--blocked">管理员封锁</span>
                        </div>
                        <div class="authority-muted">最后更新：${escapeHtml(formatDate(policies.updatedAt))}</div>
                    </div>
                </section>
            </div>
        `;
    }
    async renderUpdatesSection() {
        const container = this.root.querySelector('[data-role="updates-view"]');
        if (!container) {
            return;
        }
        if (!this.state.isAdmin) {
            container.innerHTML = '<div class="authority-empty">只有管理员可以使用这里的维护、备份和迁移功能。</div>';
            return;
        }
        const probe = this.state.probe;
        const core = probe?.core;
        const result = this.state.updateResult;
        const usageSummary = this.state.usageSummary;
        const packageOperations = [...this.state.packageOperations].sort((left, right) => right.updatedAt.localeCompare(left.updatedAt));
        const nativeMigrationOperations = [...this.state.nativeMigrationOperations].sort((left, right) => right.updatedAt.localeCompare(left.updatedAt));
        const installPath = result?.git?.pluginRoot ?? '未获取';
        const pullButtonLabel = this.state.updateInProgress ? '处理中…' : '拉取最新代码';
        const redeployButtonLabel = this.state.updateInProgress ? '处理中…' : '重新部署前端界面';
        const packageButtonLabel = this.state.packageActionInProgress ? '处理中…' : '导出数据包';
        const diagnosticArchiveLabel = this.state.packageActionInProgress ? '处理中…' : '导出诊断压缩包';
        const importButtonLabel = this.state.packageActionInProgress ? '处理中…' : '导入数据包';
        const nativeMigrationButtonLabel = this.state.nativeMigrationActionInProgress ? '处理中…' : '上传并预览';
        const systemAttentionCount = Number(Boolean(core?.health?.lastError))
            + Number(Boolean(probe && ['conflict', 'error', 'missing'].includes(probe.installStatus)));
        const updateResultMarkup = result ? `
            <section class="authority-system-result" aria-label="最近一次更新结果">
                <div class="authority-section-heading">
                    <div>
                        <h3>最近一次更新</h3>
                        <div class="authority-muted">${escapeHtml(result.message)}</div>
                    </div>
                    <div class="authority-page-actions authority-page-actions--inline">
                        <span class="authority-pill authority-pill--${result.requiresRestart ? 'warning' : 'granted'}">${escapeHtml(result.requiresRestart ? '需要重启 ST' : '无需重启 ST')}</span>
                        <span class="authority-pill authority-pill--runtime">${escapeHtml(result.action === 'git-pull' ? '代码更新' : '前端部署')}</span>
                    </div>
                </div>
                <div class="authority-system-result__facts">
                    <span><strong>${escapeHtml(result.before.pluginVersion)}</strong> → <strong>${escapeHtml(result.after.pluginVersion)}</strong><small>插件版本</small></span>
                    <span><strong>${escapeHtml(result.before.sdkDeployedVersion ?? '未部署')}</strong> → <strong>${escapeHtml(result.after.sdkDeployedVersion ?? '未部署')}</strong><small>前端版本</small></span>
                    <span><strong>${escapeHtml(getCoreStateLabel(result.core.state))}</strong><small>${escapeHtml(result.coreRestartMessage ?? '后台服务正常')}</small></span>
                </div>
                ${result.git ? `
                    <details class="authority-system-subsection">
                        <summary><span>Git 输出</span><span>${escapeHtml(result.git.branch ?? '未获取')} · ${escapeHtml(result.git.previousRevision ?? '未知')} → ${escapeHtml(result.git.currentRevision ?? '未知')}</span></summary>
                        <div class="authority-system-subsection__body">
                            ${result.git.stdout ? `<pre class="authority-code-block">${escapeHtml(result.git.stdout)}</pre>` : ''}
                            ${result.git.stderr ? `<pre class="authority-code-block">${escapeHtml(result.git.stderr)}</pre>` : ''}
                        </div>
                    </details>
                ` : ''}
            </section>
        ` : '';
        const packageOperationsMarkup = packageOperations.length > 0 ? `
            <div class="authority-table-wrap">
                <table class="authority-data-table authority-policy-matrix">
                    <thead><tr><th>任务</th><th>状态</th><th>进度</th><th>结果</th><th>更新时间</th><th>动作</th></tr></thead>
                    <tbody>
                        ${packageOperations.map(operation => `
                            <tr>
                                <td>
                                    <strong>${escapeHtml(operation.kind === 'export' ? '导出' : '导入')}</strong>
                                    <div class="authority-muted">${escapeHtml(operation.id)}</div>
                                    ${operation.sourceFileName ? `<div class="authority-muted">来源文件：${escapeHtml(operation.sourceFileName)}</div>` : ''}
                                </td>
                                <td><span class="authority-pill authority-pill--${escapeHtml(this.getPackageOperationPill(operation.status))}">${escapeHtml(this.getPackageOperationStatusLabel(operation.status))}</span></td>
                                <td>${escapeHtml(String(operation.progress))}%</td>
                                <td>
                                    <div>${escapeHtml(operation.summary ?? '未开始')}</div>
                                    ${operation.error ? `<div class="authority-muted">${escapeHtml(operation.error)}</div>` : ''}
                                    ${operation.artifact ? `<div class="authority-muted">${escapeHtml(operation.artifact.fileName)} · ${escapeHtml(formatBytes(operation.artifact.sizeBytes))}</div>` : ''}
                                    ${operation.importSummary ? `<div class="authority-muted">扩展 ${escapeHtml(String(operation.importSummary.extensionCount))} 个 · 存储文件 ${escapeHtml(String(operation.importSummary.blobCount))} 个 · 私有文件 ${escapeHtml(String(operation.importSummary.fileCount))} 个</div>` : ''}
                                </td>
                                <td>${escapeHtml(formatDate(operation.updatedAt))}</td>
                                <td>
                                    <div class="authority-page-actions authority-page-actions--inline">
                                        ${operation.artifact ? `<button type="button" class="authority-action-button" data-action="download-package-operation" data-operation-id="${escapeHtml(operation.id)}" ${this.state.packageActionInProgress ? 'disabled' : ''}>下载</button>` : ''}
                                        ${operation.status === 'failed' ? `<button type="button" class="authority-action-button" data-action="resume-package-operation" data-operation-id="${escapeHtml(operation.id)}" ${this.state.packageActionInProgress ? 'disabled' : ''}>恢复</button>` : ''}
                                    </div>
                                </td>
                            </tr>
                        `).join('')}
                    </tbody>
                </table>
            </div>
        ` : '<div class="authority-empty">暂时还没有导入或导出任务。</div>';
        const usageMarkup = usageSummary ? `
            <div class="authority-system-usage-summary">
                <span><strong>${escapeHtml(String(usageSummary.totals.extensionCount))}</strong><small>扩展</small></span>
                <span><strong>${escapeHtml(String(usageSummary.totals.blobCount))} · ${escapeHtml(formatBytes(usageSummary.totals.blobBytes))}</strong><small>存储文件</small></span>
                <span><strong>${escapeHtml(String(usageSummary.totals.databaseCount))} · ${escapeHtml(formatBytes(usageSummary.totals.databaseBytes))}</strong><small>SQL / Trivium</small></span>
                <span><strong>${escapeHtml(String(usageSummary.totals.files.fileCount))} · ${escapeHtml(formatBytes(usageSummary.totals.files.totalSizeBytes))}</strong><small>私有文件</small></span>
                <span><strong>${escapeHtml(String(usageSummary.totals.kvEntries))}</strong><small>键值条目</small></span>
            </div>
            <details class="authority-system-subsection">
                <summary><span>按扩展查看占用</span><span>${escapeHtml(formatDate(usageSummary.generatedAt))}</span></summary>
                <div class="authority-system-subsection__body">
                    <div class="authority-table-wrap">
                        <table class="authority-data-table authority-policy-matrix">
                            <thead><tr><th>扩展</th><th>键值</th><th>存储文件</th><th>SQL / Trivium</th><th>私有文件</th><th>授权</th></tr></thead>
                            <tbody>
                                ${usageSummary.extensions.map(entry => `
                                    <tr>
                                        <td><strong>${escapeHtml(entry.extension.displayName || entry.extension.id)}</strong><div class="authority-muted">${escapeHtml(entry.extension.id)}</div></td>
                                        <td>${escapeHtml(String(entry.storage.kvEntries))}</td>
                                        <td>${escapeHtml(String(entry.storage.blobCount))} · ${escapeHtml(formatBytes(entry.storage.blobBytes))}</td>
                                        <td>${escapeHtml(String(entry.storage.databaseCount))} · ${escapeHtml(formatBytes(entry.storage.databaseBytes))}</td>
                                        <td>${escapeHtml(String(entry.storage.files.fileCount))} · ${escapeHtml(formatBytes(entry.storage.files.totalSizeBytes))}</td>
                                        <td>${escapeHtml(String(entry.grantedCount))} / ${escapeHtml(String(entry.deniedCount))}</td>
                                    </tr>
                                `).join('')}
                            </tbody>
                        </table>
                    </div>
                </div>
            </details>
        ` : '<div class="authority-empty">暂时还没拿到数据占用概览。</div>';
        const nativeMigrationMarkup = `
            <div class="authority-system-section__intro">
                <div>
                    <h3>从旧 SillyTavern 导入原生目录</h3>
                    <p>上传 data 或 third-party 插件 ZIP，生成影响预览后再决定跳过或覆盖。最大 12 GB。</p>
                </div>
                <span class="authority-pill authority-pill--warning">管理员高风险操作</span>
            </div>
            <div class="authority-migration-grid">
                <div class="authority-upload-tile">
                    <strong>导入旧酒馆 data 目录</strong>
                    <div class="authority-muted">支持压缩包内为 <code>data/default-user/...</code> 或直接 <code>default-user/...</code>。</div>
                    <div class="authority-page-actions">
                        <input type="file" data-role="native-migration-file" data-target="data" accept=".zip,application/zip" ${this.state.nativeMigrationActionInProgress ? 'disabled' : ''} />
                        <button type="button" class="authority-action-button authority-action-button--primary" data-action="preview-native-migration" data-target="data" ${this.state.nativeMigrationActionInProgress ? 'disabled' : ''}>${nativeMigrationButtonLabel}</button>
                    </div>
                </div>
                <div class="authority-upload-tile">
                    <strong>导入旧酒馆第三方插件目录</strong>
                    <div class="authority-muted">支持 public/scripts/extensions/third-party、extensions/third-party、third-party 或直接插件文件夹。</div>
                    <div class="authority-page-actions">
                        <input type="file" data-role="native-migration-file" data-target="third-party" accept=".zip,application/zip" ${this.state.nativeMigrationActionInProgress ? 'disabled' : ''} />
                        <button type="button" class="authority-action-button authority-action-button--primary" data-action="preview-native-migration" data-target="third-party" ${this.state.nativeMigrationActionInProgress ? 'disabled' : ''}>${nativeMigrationButtonLabel}</button>
                    </div>
                </div>
            </div>
            <div class="authority-guardrail-band">
                <span>不删除缺失文件</span><span>不运行 npm install</span><span>不重启</span><span>不自动启用脚本</span>
            </div>
            ${nativeMigrationOperations.length > 0 ? `
                <div class="authority-table-wrap">
                    <table class="authority-data-table authority-policy-matrix">
                        <thead><tr><th>迁移任务</th><th>状态</th><th>预览统计</th><th>执行结果</th><th>更新时间</th><th>动作</th></tr></thead>
                        <tbody>${nativeMigrationOperations.map(operation => this.renderNativeMigrationOperationRow(operation)).join('')}</tbody>
                    </table>
                </div>
            ` : '<div class="authority-empty">暂时还没有原生迁移任务。上传 ZIP 后会先生成预览。</div>'}
        `;
        container.innerHTML = `
            <div class="authority-page-stack authority-system-workspace">
                <header class="authority-page-header authority-page-header--updates">
                    <div>
                        <div class="authority-eyebrow">System & recovery</div>
                        <h2>系统与恢复</h2>
                        <p>日常运行状态、更新、备份恢复与高风险迁移分层管理。</p>
                    </div>
                    <div class="authority-page-actions">
                        <button type="button" class="authority-action-button" data-action="export-diagnostic-archive" ${this.state.packageActionInProgress ? 'disabled' : ''}>${diagnosticArchiveLabel}</button>
                        <button type="button" class="authority-action-button" data-action="export-diagnostic-bundle">导出诊断 JSON</button>
                    </div>
                </header>

                <div class="authority-system-health-grid" aria-label="系统状态摘要">
                    <div><small>Authority 服务</small><strong>${escapeHtml(getCoreStateLabel(core?.state))}</strong><span>Core ${escapeHtml(core?.version ?? probe?.coreBundledVersion ?? MISSING_TEXT)}</span></div>
                    <div><small>部署状态</small><strong>${escapeHtml(probe ? getInstallStatusLabel(probe.installStatus) : MISSING_TEXT)}</strong><span>SDK ${escapeHtml(probe?.sdkDeployedVersion ?? MISSING_TEXT)}</span></div>
                    <div><small>需要处理</small><strong>${systemAttentionCount}</strong><span>${systemAttentionCount > 0 ? '展开下方项目查看' : '当前没有阻塞项'}</span></div>
                </div>

                <details class="authority-system-section" open>
                    <summary>
                        <span><strong>版本与部署</strong><small>更新插件、部署前端与检查 Core</small></span>
                        <span class="authority-pill authority-pill--${escapeHtml(probe?.installStatus ?? 'prompt')}">${escapeHtml(probe ? getInstallStatusLabel(probe.installStatus) : '未获取')}</span>
                    </summary>
                    <div class="authority-system-section__body authority-stack">
                        <div class="authority-system-operation-list">
                            <div class="authority-system-operation-row">
                                <div><strong>插件更新</strong><span>当前 ${escapeHtml(probe?.pluginVersion ?? MISSING_TEXT)} · 仅允许快进更新</span></div>
                                <button type="button" class="authority-action-button authority-action-button--primary" data-action="admin-update" data-update-action="git-pull" ${this.state.updateInProgress ? 'disabled' : ''}>${pullButtonLabel}</button>
                            </div>
                            <div class="authority-system-operation-row">
                                <div><strong>SDK 部署</strong><span>内置 ${escapeHtml(probe?.sdkBundledVersion ?? MISSING_TEXT)} · 当前 ${escapeHtml(probe?.sdkDeployedVersion ?? MISSING_TEXT)}</span></div>
                                <button type="button" class="authority-action-button" data-action="admin-update" data-update-action="redeploy-sdk" ${this.state.updateInProgress ? 'disabled' : ''}>${redeployButtonLabel}</button>
                            </div>
                            <div class="authority-system-operation-row">
                                <div><strong>后台服务</strong><span>${escapeHtml(getCoreStateLabel(core?.state))} · ${escapeHtml(probe?.coreArtifactPlatform ?? MISSING_TEXT)} · 校验 ${escapeHtml(probe?.coreVerified ? '通过' : '未通过')}</span></div>
                                <span class="authority-pill authority-pill--${escapeHtml(core?.state ?? 'starting')}">${escapeHtml(core?.version ?? MISSING_TEXT)}</span>
                            </div>
                        </div>
                        <details class="authority-system-subsection">
                            <summary><span>后台服务详细诊断</span><span>${escapeHtml(core?.port ? `127.0.0.1:${core.port}` : '端口未分配')}</span></summary>
                            <div class="authority-system-subsection__body">
                                <div class="authority-system-facts authority-system-facts--runtime">
                                    <div><span>构建编号</span><strong>${escapeHtml(core?.health?.buildHash ?? probe?.coreBinarySha256 ?? MISSING_TEXT)}</strong></div>
                                    <div><span>数据目录</span><strong>${escapeHtml(probe?.storageRoot ?? MISSING_TEXT)}</strong></div>
                                    <div><span>插件目录</span><strong>${escapeHtml(installPath)}</strong></div>
                                    <div><span>处理请求</span><strong>${escapeHtml(core?.health ? String(core.health.requestCount) : MISSING_TEXT)}</strong></div>
                                    <div><span>累计错误</span><strong>${escapeHtml(core?.health ? String(core.health.errorCount) : MISSING_TEXT)}</strong></div>
                                    <div><span>当前并发</span><strong>${escapeHtml(core?.health ? `${core.health.currentConcurrency} / ${core.health.maxConcurrency}` : MISSING_TEXT)}</strong></div>
                                    <div><span>请求排队</span><strong>${escapeHtml(core?.health ? String(core.health.queuedRequestCount) : MISSING_TEXT)}</strong></div>
                                    <div><span>任务排队</span><strong>${escapeHtml(core?.health ? String(core.health.queuedJobCount) : MISSING_TEXT)}</strong></div>
                                    <div><span>工作线程</span><strong>${escapeHtml(core?.health ? String(core.health.workerCount) : MISSING_TEXT)}</strong></div>
                                    <div><span>任务类型</span><strong>${escapeHtml(core?.health ? `${core.health.jobRegistrySummary.registered} · ${core.health.jobRegistrySummary.jobTypes.join(', ')}` : MISSING_TEXT)}</strong></div>
                                    <div><span>最近操作</span><strong>${escapeHtml(result ? formatDate(result.updatedAt) : '未执行')}</strong></div>
                                </div>
                            </div>
                        </details>
                        ${updateResultMarkup}
                        <details class="authority-system-subsection">
                            <summary><span>更新说明</span><span>什么时候需要重启</span></summary>
                            <div class="authority-system-subsection__body authority-stack">
                                <div class="authority-inline-note"><strong>拉取最新代码</strong><div>仅适用于 Git 安装；执行 git pull --ff-only，再部署前端并尝试重启后台服务。</div></div>
                                <div class="authority-inline-note"><strong>重新部署前端</strong><div>只替换 third-party/st-authority-sdk，不联网、不修改服务端代码。</div></div>
                                <div class="authority-inline-note"><strong>重启提示</strong><div>若更新包含新的 Node 服务端代码，需要重启 SillyTavern 才会完全生效。</div></div>
                            </div>
                        </details>
                    </div>
                </details>

                <details class="authority-system-section" open>
                    <summary>
                        <span><strong>ST-Manager 备份与恢复</strong><small>酒馆主动备份、恢复预览与恢复</small></span>
                        <span class="authority-pill authority-pill--${this.state.stManagerControlConfig?.enabled ? 'granted' : 'warning'}">${this.state.stManagerControlConfig?.enabled ? '已配置' : '未配置'}</span>
                    </summary>
                    <div class="authority-system-section__body">
                        ${renderStManagerControlSection(this.state.stManagerControlConfig, this.state.stManagerControlBackups, this.state.stManagerControlActionInProgress)}
                    </div>
                </details>

                <details class="authority-system-section">
                    <summary>
                        <span><strong>Authority 数据包</strong><small>授权、规则、私有文件与数据库</small></span>
                        <span class="authority-pill authority-pill--runtime">${packageOperations.length} 个任务</span>
                    </summary>
                    <div class="authority-system-section__body authority-stack">
                        <div class="authority-system-section__intro">
                            <div>
                                <h3>备份与迁移 Authority 数据</h3>
                                <p>导出完整数据包，或以覆盖/合并方式导入；后台任务进度会保留在下方。</p>
                            </div>
                            <button type="button" class="authority-action-button authority-action-button--primary" data-action="export-portable-package" ${this.state.packageActionInProgress ? 'disabled' : ''}>${packageButtonLabel}</button>
                        </div>
                        ${usageMarkup}
                        <div class="authority-system-import">
                            <label>
                                <span>导入方式</span>
                                <select data-role="import-package-mode" ${this.state.packageActionInProgress ? 'disabled' : ''}>
                                    <option value="replace">覆盖导入 · 清空现有数据后导入</option>
                                    <option value="merge">合并导入 · 保留现有数据并补充</option>
                                </select>
                            </label>
                            <input type="file" data-role="import-package-file" accept=".zip,.authoritypkg.zip,.json,.gz,.authoritypkg,.authoritypkg.json.gz,application/zip,application/json,application/gzip" ${this.state.packageActionInProgress ? 'disabled' : ''} />
                            <button type="button" class="authority-action-button" data-action="import-portable-package" ${this.state.packageActionInProgress ? 'disabled' : ''}>${importButtonLabel}</button>
                        </div>
                        ${packageOperationsMarkup}
                    </div>
                </details>

                <details class="authority-system-section authority-system-section--danger">
                    <summary>
                        <span><strong>原生 SillyTavern 迁移</strong><small>从旧 data 或 third-party ZIP 导入</small></span>
                        <span class="authority-pill authority-pill--warning">${nativeMigrationOperations.length} 个任务</span>
                    </summary>
                    <div class="authority-system-section__body authority-stack">${nativeMigrationMarkup}</div>
                </details>

                <details class="authority-system-section">
                    <summary>
                        <span><strong>高级远程桥接</strong><small>让 ST-Manager 回连酒馆的公网通道</small></span>
                        <span class="authority-pill authority-pill--${this.state.stManagerBridgeConfig?.enabled ? 'granted' : 'warning'}">${this.state.stManagerBridgeConfig?.enabled ? '已启用' : '未启用'}</span>
                    </summary>
                    <div class="authority-system-section__body">
                        <div class="authority-inline-note">通常只需要上面的 ST-Manager 控制配置。仅当 ST-Manager 必须主动回连酒馆时才启用桥接。</div>
                        ${renderStManagerBridgeSection(this.state.stManagerBridgeConfig, this.state.stManagerBridgeGeneratedKey, this.state.stManagerBridgeActionInProgress)}
                    </div>
                </details>
            </div>
        `;
    }
    getPackageOperationPill(status) {
        switch (status) {
            case 'completed':
                return 'granted';
            case 'failed':
                return 'warning';
            case 'running':
                return 'runtime';
            default:
                return 'prompt';
        }
    }
    renderNativeMigrationOperationRow(operation) {
        const rejectedCount = operation.entries?.filter(entry => entry.action === 'reject').length ?? 0;
        const createCount = operation.entries?.filter(entry => entry.action === 'create').length ?? 0;
        const overwriteCount = operation.entries?.filter(entry => entry.action === 'overwrite').length ?? 0;
        const canApply = operation.status === 'previewed' && rejectedCount === 0;
        const canRollback = operation.status === 'applied' || operation.status === 'needs_rollback';
        return `
            <tr>
                <td>
                    <strong>${escapeHtml(operation.target === 'data' ? 'Data 目录' : '第三方插件')}</strong>
                    <div class="authority-muted">${escapeHtml(operation.id)}</div>
                    <div class="authority-muted">${escapeHtml(operation.sourceFileName)} · ${escapeHtml(formatBytes(operation.sourceSizeBytes))}</div>
                </td>
                <td><span class="authority-pill authority-pill--${escapeHtml(this.getNativeMigrationOperationPill(operation.status))}">${escapeHtml(this.getNativeMigrationOperationStatusLabel(operation.status))}</span></td>
                <td>
                    <div>${escapeHtml(String(operation.entryCount))} 个文件 · ${escapeHtml(formatBytes(operation.totalSizeBytes))}</div>
                    <div class="authority-muted">新增 ${escapeHtml(String(createCount))} · 覆盖候选 ${escapeHtml(String(overwriteCount))} · 拒绝 ${escapeHtml(String(rejectedCount))}</div>
                    ${operation.warnings.length > 0 ? `<div class="authority-muted">${escapeHtml(operation.warnings.join('；'))}</div>` : ''}
                </td>
                <td>
                    <div>已创建 ${escapeHtml(String(operation.createdCount))} · 已覆盖 ${escapeHtml(String(operation.overwrittenCount))} · 已跳过 ${escapeHtml(String(operation.skippedCount))}</div>
                    ${operation.error ? `<div class="authority-muted">${escapeHtml(operation.error)}</div>` : ''}
                </td>
                <td>${escapeHtml(formatDate(operation.updatedAt))}</td>
                <td>
                    <div class="authority-page-actions authority-page-actions--inline">
                        ${canApply ? `
                            <select data-role="native-migration-mode" data-operation-id="${escapeHtml(operation.id)}" ${this.state.nativeMigrationActionInProgress ? 'disabled' : ''}>
                                <option value="skip">跳过已有文件</option>
                                <option value="overwrite">覆盖已有文件并保留回滚备份</option>
                            </select>
                            <button type="button" class="authority-action-button authority-action-button--primary" data-action="apply-native-migration" data-operation-id="${escapeHtml(operation.id)}" ${this.state.nativeMigrationActionInProgress ? 'disabled' : ''}>应用</button>
                        ` : ''}
                        ${canRollback ? `<button type="button" class="authority-action-button" data-action="rollback-native-migration" data-operation-id="${escapeHtml(operation.id)}" ${this.state.nativeMigrationActionInProgress ? 'disabled' : ''}>回滚</button>` : ''}
                        ${rejectedCount > 0 ? '<span class="authority-muted">存在被拒绝文件，不能应用。</span>' : ''}
                    </div>
                </td>
            </tr>
        `;
    }
    getNativeMigrationOperationPill(status) {
        switch (status) {
            case 'applied':
            case 'rolled_back':
                return 'granted';
            case 'failed':
            case 'needs_rollback':
                return 'warning';
            case 'applying':
            case 'rolling_back':
                return 'runtime';
            default:
                return 'prompt';
        }
    }
    getNativeMigrationOperationStatusLabel(status) {
        switch (status) {
            case 'previewed':
                return '已预览';
            case 'applying':
                return '导入中';
            case 'applied':
                return '已导入';
            case 'rolling_back':
                return '回滚中';
            case 'rolled_back':
                return '已回滚';
            case 'needs_rollback':
                return '需要回滚';
            case 'failed':
                return '失败';
            default:
                return '未知';
        }
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
        return `
            <div class="authority-policy-row">
                <select data-policy-field="resource">
                    ${RESOURCE_OPTIONS.map(resource => `<option value="${resource}" ${entry?.resource === resource ? 'selected' : ''}>${escapeHtml(getResourceLabel(resource))}</option>`).join('')}
                </select>
                <input data-policy-field="target" type="text" value="${escapeHtml(entry?.target ?? '*')}" placeholder="目标，例如网站域名或频道名" />
                <select data-policy-field="status">
                    ${STATUS_OPTIONS.map(status => `<option value="${status}" ${entry?.status === status ? 'selected' : ''}>${escapeHtml(getStatusLabel(status))}</option>`).join('')}
                </select>
                <button type="button" class="menu_button" data-action="remove-policy-row">移除</button>
            </div>
        `;
    }
    getPackageOperationStatusLabel(status) {
        switch (status) {
            case 'completed':
                return '已完成';
            case 'failed':
                return '失败';
            case 'running':
                return '处理中';
            default:
                return '排队中';
        }
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
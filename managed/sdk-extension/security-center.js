import { authorityRequest } from './api.js';
import { clearChildren, escapeHtml, formatDate } from './dom.js';
import { renderActivityLogRows, renderAlertStack, renderCapabilityMatrix, renderDatabaseAssetSections, renderDatabaseGroupTable, renderGrantSettingsRows, renderJobTable, renderMetricTile, renderPolicyRows, renderStorageSummary, renderStringList, } from './security-center/components.js';
import { RESOURCE_OPTIONS, SECURITY_CENTER_CONFIG, STATUS_OPTIONS, } from './security-center/constants.js';
import { formatBytes, getCoreStateLabel, getDeclaredPermissionLabels, getExtensionRiskLevel, getInstallStatusLabel, getInstallTypeLabel, getResourceLabel, getRiskLabel, getRiskLevel, getStatusLabel, getSystemMessageLabel, sortByTimestampDesc, } from './security-center/formatters.js';
import { buildStManagerBridgePayload, normalizeStManagerBridgeConfig, renderStManagerBridgeSection, ST_MANAGER_RESOURCE_OPTIONS, } from './security-center/st-manager-bridge.js';
import { buildStManagerControlPayload, normalizeStManagerControlConfig, renderStManagerControlSection, } from './security-center/st-manager-control.js';
import { bootstrapSecurityCenter as bootstrapSecurityCenterHost, openSecurityCenter as openSecurityCenterHost, } from './security-center/host.js';
import { buildOverviewModel, getDatabaseGroupSummaries } from './security-center/view-models.js';
const TOAST_TITLE = '权限中心';
const MISSING_TEXT = '未获取';
const OVERVIEW_SECTION_STATE_STORAGE_KEY = 'authority.security-center.overview-section-state';
const DEFAULT_OVERVIEW_SECTION_STATE = {
    governance: true,
    capabilityMatrix: true,
    recentActivity: true,
};
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
    constructor(root, focusExtensionId) {
        this.root = root;
        this.focusExtensionId = focusExtensionId;
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
            selectedTab: focusExtensionId ? 'detail' : 'overview',
            overviewSectionState: { ...DEFAULT_OVERVIEW_SECTION_STATE },
            extensionFilter: '',
            policies: null,
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
            const target = event.target instanceof HTMLElement ? event.target : null;
            if (!target) {
                return;
            }
            const overviewSummary = target.closest('summary.authority-section-heading--summary');
            if (overviewSummary) {
                const section = overviewSummary.closest('[data-overview-section]');
                const key = section?.dataset.overviewSection;
                if (section && key) {
                    window.setTimeout(() => this.setOverviewSectionOpen(key, section.open), 0);
                }
                return;
            }
            const tabButton = target.closest('[data-tab]');
            if (tabButton) {
                const tab = tabButton.dataset.tab;
                if ((tab !== 'policies' && tab !== 'updates') || this.state.isAdmin) {
                    this.state.selectedTab = tab;
                    void this.render();
                }
                return;
            }
            const refreshButton = target.closest('[data-action="refresh"]');
            if (refreshButton) {
                void this.refresh();
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
            this.state.overviewSectionState = this.loadOverviewSectionState(session.user.handle);
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
            if (!this.state.isAdmin && (this.state.selectedTab === 'policies' || this.state.selectedTab === 'updates')) {
                this.state.selectedTab = 'overview';
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
        const confirmed = confirm(overwrite ? '将允许覆盖酒馆已有同路径资源，确定恢复？' : '将跳过酒馆已有同路径资源，确定恢复？');
        if (!confirmed) {
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
        this.state.packageActionInProgress = true;
        void this.renderUpdatesSection();
        try {
            const transfer = await authorityRequest('/admin/import-export/import-transfer/init', {
                method: 'POST',
                body: { sizeBytes: file.size },
            });
            await this.uploadFileToTransfer(file, transfer);
            const mode = (modeSelect?.value === 'merge' ? 'merge' : 'replace');
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
        const confirmation = mode === 'overwrite'
            ? globalThis.confirm?.('将覆盖目标目录中同名文件。Authority 会先创建回滚备份，但不会执行插件安装脚本。确定继续？')
            : globalThis.confirm?.('将把压缩包中不存在于目标目录的文件导入到原生 SillyTavern 目录。确定继续？');
        if (!confirmation) {
            return;
        }
        this.state.nativeMigrationActionInProgress = true;
        void this.renderUpdatesSection();
        try {
            const operation = await authorityRequest(`/admin/native-migration/operations/${encodeURIComponent(operationId)}/apply`, {
                method: 'POST',
                body: { mode },
            });
            toastr.success(`迁移已应用：${operation.id}`, TOAST_TITLE);
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
        if (!globalThis.confirm?.('回滚只会撤销本次迁移写入且仍未被用户修改的文件。确定回滚？')) {
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
    async render() {
        this.renderHeader();
        this.renderTabs();
        this.renderExtensionList();
        await this.renderOverviewSection();
        await this.renderDetailSection();
        await this.renderDatabasesSection();
        await this.renderActivitySection();
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
                <span class="authority-pill authority-pill--${escapeHtml(probe?.installStatus ?? 'prompt')}">接入状态 ${escapeHtml(probe ? getInstallStatusLabel(probe.installStatus) : '同步中')}</span>
                <span class="authority-pill authority-pill--${escapeHtml(probe?.core.state ?? 'starting')}">后台服务 ${escapeHtml(getCoreStateLabel(probe?.core.state))}</span>
                <span class="authority-pill authority-pill--medium">${escapeHtml(probe?.coreArtifactPlatform ?? '平台未识别')}</span>
                <span class="authority-pill authority-pill--admin">${escapeHtml(this.state.isAdmin ? '管理员' : '普通用户')}</span>
            `;
        }
        if (this.state.loading) {
            status.innerHTML = renderAlertStack([
                { tone: 'info', title: '归档同步中', message: '正在同步权限中心状态、扩展记录与策略数据。' },
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
        for (const tab of this.root.querySelectorAll('[data-tab]')) {
            const tabName = tab.dataset.tab;
            tab.classList.toggle('authority-tab--active', tabName === this.state.selectedTab);
            tab.hidden = (tabName === 'policies' || tabName === 'updates') && !this.state.isAdmin;
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
        const core = this.state.probe?.core;
        const grants = [...this.state.details.values()].flatMap(detail => detail.grants);
        const grantedCount = grants.filter(grant => grant.status === 'granted').length;
        const deniedCount = grants.filter(grant => grant.status === 'denied' || grant.status === 'blocked').length;
        const databaseCount = overview.databaseGroups.reduce((sum, item) => sum + item.databaseCount, 0);
        container.innerHTML = `
            <div class="authority-overview-layout">
                <div class="authority-overview-main">
                    <section class="authority-page-hero authority-page-hero--overview">
                        <div>
                            <div class="authority-eyebrow">Security Overview</div>
                            <h2>安全中心总览</h2>
                            <p>系统状态、扩展风险、策略覆盖与最近审计的统一入口。</p>
                        </div>
                        <div class="authority-hero-actions">
                            <button type="button" class="authority-action-button authority-action-button--primary" data-tab="detail">扩展治理</button>
                            ${this.state.isAdmin ? '<button type="button" class="authority-action-button" data-tab="updates">迁移维护</button>' : ''}
                        </div>
                    </section>
                    <section class="authority-diagnostics-panel">
                        <div class="authority-section-heading">
                            <div>
                                <h3>核心诊断与完整性</h3>
                                <div class="authority-muted">后台服务、前端界面接入和本机环境检查</div>
                            </div>
                        </div>
                        <div class="authority-diagnostics-grid">
                            <div class="authority-diagnostic-primary">
                                <div class="authority-muted">后台服务</div>
                                <strong>${escapeHtml(getCoreStateLabel(core?.state))}</strong>
                                <span class="authority-pill authority-pill--${escapeHtml(core?.state ?? 'starting')}">${escapeHtml(core?.port ? `127.0.0.1:${core.port}` : '端口未分配')}</span>
                            </div>
                            <div>
                                <span>接入状态</span>
                                <strong>${escapeHtml(this.state.probe ? getInstallStatusLabel(this.state.probe.installStatus) : MISSING_TEXT)}</strong>
                            </div>
                            <div>
                                <span>后台服务校验</span>
                                <strong>${escapeHtml(this.state.probe?.coreVerified ? '已通过' : '未通过')}</strong>
                            </div>
                            <div>
                                <span>当前平台</span>
                                <strong>${escapeHtml(this.state.probe?.coreArtifactPlatform ?? MISSING_TEXT)}</strong>
                            </div>
                            <div>
                                <span>插件版本</span>
                                <strong>${escapeHtml(this.state.probe?.pluginVersion ?? MISSING_TEXT)}</strong>
                            </div>
                            <div>
                                <span>后台服务版本</span>
                                <strong>${escapeHtml(core?.version ?? MISSING_TEXT)}</strong>
                            </div>
                            <div>
                                <span>构建编号</span>
                                <strong>${escapeHtml(core?.health?.buildHash ?? this.state.probe?.coreBinarySha256 ?? MISSING_TEXT)}</strong>
                            </div>
                            <div>
                                <span>数据目录</span>
                                <strong>${escapeHtml(this.state.probe?.storageRoot ?? MISSING_TEXT)}</strong>
                            </div>
                            <div>
                                <span>处理请求</span>
                                <strong>${escapeHtml(core?.health ? String(core.health.requestCount) : MISSING_TEXT)}</strong>
                            </div>
                            <div>
                                <span>累计错误</span>
                                <strong>${escapeHtml(core?.health ? String(core.health.errorCount) : MISSING_TEXT)}</strong>
                            </div>
                            <div>
                                <span>当前并发</span>
                                <strong>${escapeHtml(core?.health ? `${core.health.currentConcurrency} / ${core.health.maxConcurrency}` : MISSING_TEXT)}</strong>
                            </div>
                            <div>
                                <span>请求排队</span>
                                <strong>${escapeHtml(core?.health ? String(core.health.queuedRequestCount) : MISSING_TEXT)}</strong>
                            </div>
                            <div>
                                <span>任务排队</span>
                                <strong>${escapeHtml(core?.health ? String(core.health.queuedJobCount) : MISSING_TEXT)}</strong>
                            </div>
                            <div>
                                <span>工作线程</span>
                                <strong>${escapeHtml(core?.health ? String(core.health.workerCount) : MISSING_TEXT)}</strong>
                            </div>
                            <div>
                                <span>可用任务类型</span>
                                <strong>${escapeHtml(core?.health ? `${core.health.jobRegistrySummary.registered} / ${core.health.jobRegistrySummary.jobTypes.join(', ')}` : MISSING_TEXT)}</strong>
                            </div>
                        </div>
                    </section>
                    ${this.renderOverviewCollapsibleSection('governance', 'authority-section-block', '权限治理', '授权、拒绝、策略覆盖与后台任务', `<div class="authority-governance-grid">
                            ${renderMetricTile('已接入扩展', String(this.state.extensions.length), '注册到权限中心', 'primary')}
                            ${renderMetricTile('已允许授权', String(grantedCount), '持久授权记录', 'success')}
                            ${renderMetricTile('拒绝 / 封锁', String(deniedCount), '用户拒绝或管理员封锁', deniedCount > 0 ? 'warning' : 'neutral')}
                            ${renderMetricTile('策略覆盖', String(overview.totalPolicyCount), '默认与扩展覆盖', 'neutral')}
                            ${renderMetricTile('活跃任务', String(overview.activeJobs.length), '排队中 / 执行中', overview.activeJobs.length > 0 ? 'runtime' : 'neutral')}
                            ${renderMetricTile('失败任务', String(overview.failedJobs.length), '失败 / 取消的后台任务', overview.failedJobs.length > 0 ? 'warning' : 'neutral')}
                            ${renderMetricTile('权限拒绝', String(overview.recentPermissionDenials.length), '最近被拒绝的权限请求', overview.recentPermissionDenials.length > 0 ? 'warning' : 'neutral')}
                            ${renderMetricTile('最近告警', String(overview.recentWarnings.length), '队列压力 / 慢任务 / 重试线索', overview.recentWarnings.length > 0 ? 'warning' : 'neutral')}
                            ${renderMetricTile('最近错误', String(overview.recentErrors.length), '需要排查的异常', overview.recentErrors.length > 0 ? 'error' : 'neutral')}
                        </div>`)}
                    ${this.renderOverviewCollapsibleSection('capabilityMatrix', 'authority-section-block', '可管理的功能', '当前可由权限中心管理的系统功能清单', renderCapabilityMatrix(RESOURCE_OPTIONS))}
                    ${this.renderOverviewCollapsibleSection('recentActivity', 'authority-log-panel', '近期活动', '权限请求、能力调用与异常记录', renderActivityLogRows(overview.recentActivity, '暂无活动记录。'))}
                </div>
                <aside class="authority-inspector authority-inspector--overview">
                    <section class="authority-card">
                        <div class="authority-section-heading">
                            <div>
                                <h3>资源与存储</h3>
                                <div class="authority-muted">当前会话已归档的数据资产与占用</div>
                            </div>
                        </div>
                        <div class="authority-resource-stack">
                            <div class="authority-resource-row">
                                <span>键值数据</span>
                                <strong>${this.state.extensions.reduce((sum, item) => sum + item.storage.kvEntries, 0)}</strong>
                            </div>
                            <div class="authority-resource-row">
                                <span>存储文件</span>
                                <strong>${escapeHtml(formatBytes(overview.totalBlobBytes))}</strong>
                            </div>
                            <div class="authority-resource-row">
                                <span>数据库</span>
                                <strong>${databaseCount} 个 · ${escapeHtml(formatBytes(overview.totalDatabaseSize))}</strong>
                            </div>
                            <div class="authority-resource-row">
                                <span>私有文件</span>
                                <strong>${escapeHtml(formatBytes(overview.totalPrivateFileBytes))}</strong>
                            </div>
                        </div>
                    </section>
                    <section class="authority-card">
                        <div class="authority-section-heading">
                            <div>
                                <h3>后台任务概况</h3>
                                <div class="authority-muted">任务队列状态与执行中作业</div>
                            </div>
                        </div>
                        ${renderJobTable(overview.activeJobs.slice(0, 5), '当前没有排队或运行中的任务。')}
                    </section>
                    <section class="authority-card">
                        <div class="authority-section-heading">
                            <div>
                                <h3>最近权限拒绝</h3>
                                <div class="authority-muted">被拒绝或封锁的权限请求记录</div>
                            </div>
                        </div>
                        ${renderActivityLogRows(overview.recentPermissionDenials.slice(0, 5), '暂无权限拒绝记录。')}
                    </section>
                    <section class="authority-card">
                        <div class="authority-section-heading">
                            <div>
                                <h3>最近失败任务</h3>
                                <div class="authority-muted">失败或取消的后台任务记录</div>
                            </div>
                        </div>
                        ${renderJobTable(overview.failedJobs.slice(0, 5), '暂无失败任务。')}
                    </section>
                    <section class="authority-card">
                        <div class="authority-section-heading">
                            <div>
                                <h3>最近告警</h3>
                                <div class="authority-muted">队列压力、慢任务与重试线索</div>
                            </div>
                        </div>
                        ${renderActivityLogRows(overview.recentWarnings.slice(0, 5), '暂无运行告警记录。')}
                    </section>
                    <section class="authority-card">
                        <div class="authority-section-heading">
                            <div>
                                <h3>最近错误</h3>
                                <div class="authority-muted">需要优先排查的异常记录</div>
                            </div>
                        </div>
                        ${renderActivityLogRows(overview.recentErrors.slice(0, 5), '暂无错误记录。')}
                    </section>
                </aside>
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
                        <div class="authority-eyebrow">扩展详情</div>
                        <h2>${escapeHtml(detail.extension.displayName)}</h2>
                        <div class="authority-muted">${escapeHtml(detail.extension.id)}</div>
                    </div>
                    <div class="authority-dossier-actions">
                        <span class="authority-pill authority-pill--${risk}">${escapeHtml(getRiskLabel(risk))}</span>
                        <span class="authority-pill authority-pill--medium">${escapeHtml(getInstallTypeLabel(detail.extension.installType))}</span>
                        <span class="authority-pill authority-pill--prompt">v${escapeHtml(detail.extension.version)}</span>
                        <button type="button" class="authority-back-button" data-tab="overview">返回总览</button>
                    </div>
                </div>
                <div class="authority-detail-metrics">
                    ${renderMetricTile('授权记录', String(detail.grants.length), `${granted.length} 允许 · ${denied.length} 拒绝/封锁`, detail.grants.length > 0 ? 'primary' : 'neutral')}
                    ${renderMetricTile('策略覆盖', String(detail.policies.length), '管理员覆盖规则', detail.policies.length > 0 ? 'warning' : 'neutral')}
                    ${renderMetricTile('数据库', String(databaseCount), `SQL ${detail.databases.length} · Trivium ${detail.triviumDatabases.length}`, databaseCount > 0 ? 'runtime' : 'neutral')}
                    ${renderMetricTile('后台任务', String(detail.jobs.length), `${errors.length} 条近期错误`, errors.length > 0 ? 'error' : 'neutral')}
                </div>
                <section class="authority-section-block">
                    <div class="authority-section-heading">
                        <div>
                            <h3>基本情况</h3>
                            <div class="authority-muted">接入时间、最近活跃、声明权限与数据占用</div>
                        </div>
                        <button type="button" class="authority-action-button authority-action-button--primary" data-action="reset-all-grants" data-extension-id="${escapeHtml(detail.extension.id)}">重置全部授权</button>
                    </div>
                    <div class="authority-kv-grid">
                        <div><strong>首次见到</strong><div>${escapeHtml(formatDate(detail.extension.firstSeenAt))}</div></div>
                        <div><strong>最近活跃</strong><div>${escapeHtml(formatDate(detail.extension.lastSeenAt))}</div></div>
                        <div><strong>声明权限</strong><div>${getDeclaredPermissionLabels(detail.extension.declaredPermissions).length}</div></div>
                        <div><strong>后台任务</strong><div>${detail.jobs.length}</div></div>
                    </div>
                    ${renderStorageSummary(storage)}
                </section>
                <section class="authority-section-block">
                    <div class="authority-section-heading">
                        <div>
                            <h3>权限情况</h3>
                            <div class="authority-muted">已声明权限、持久化授权记录与策略覆盖</div>
                        </div>
                    </div>
                    ${renderStringList(getDeclaredPermissionLabels(detail.extension.declaredPermissions), '该扩展还没有声明任何权限。')}
                    ${renderGrantSettingsRows(detail.extension.id, [...granted, ...denied], '当前没有持久化授权或拒绝记录。')}
                    ${renderPolicyRows(detail.policies, '当前没有针对该扩展的策略覆盖。')}
                </section>
                <section class="authority-section-block">
                    <div class="authority-section-heading">
                        <div>
                            <h3>数据占用</h3>
                            <div class="authority-muted">SQL 数据库与 Trivium 记忆库归档</div>
                        </div>
                    </div>
                    ${renderDatabaseAssetSections(databases, triviumDatabases, '该扩展还没有私有数据库。')}
                </section>
                <section class="authority-detail-grid">
                    <div class="authority-log-panel">
                        <div class="authority-section-heading">
                            <div>
                                <h3>最近权限活动</h3>
                                <div class="authority-muted">权限请求与授权决策轨迹</div>
                            </div>
                        </div>
                        ${renderActivityLogRows(permissions, '暂无权限活动。')}
                    </div>
                    <div class="authority-log-panel">
                        <div class="authority-section-heading">
                            <div>
                                <h3>最近能力调用</h3>
                                <div class="authority-muted">实际功能调用与资源访问记录</div>
                            </div>
                        </div>
                        ${renderActivityLogRows(usage, '暂无能力调用记录。')}
                    </div>
                </section>
                <section class="authority-detail-grid">
                    <div class="authority-card">
                        <div class="authority-section-heading">
                            <div>
                                <h3>最近后台任务</h3>
                                <div class="authority-muted">已调度后台作业记录</div>
                            </div>
                        </div>
                        ${renderJobTable(jobs, '暂无后台任务。')}
                    </div>
                    <div class="authority-log-panel">
                        <div class="authority-section-heading">
                            <div>
                                <h3>最近告警</h3>
                                <div class="authority-muted">排队压力、执行延迟与自动重试</div>
                            </div>
                        </div>
                        ${renderActivityLogRows(warnings, '暂无运行告警记录。')}
                    </div>
                    <div class="authority-log-panel">
                        <div class="authority-section-heading">
                            <div>
                                <h3>最近错误</h3>
                                <div class="authority-muted">需要优先排查的异常记录</div>
                            </div>
                        </div>
                        ${renderActivityLogRows(errors, '暂无内部错误记录。')}
                    </div>
                </section>
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
                        <div class="authority-eyebrow">数据资产</div>
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
                        <div class="authority-eyebrow">操作记录</div>
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
                        <div class="authority-eyebrow">管理员策略</div>
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
        container.innerHTML = `
            <div class="authority-page-stack authority-maintenance-workspace">
                <div class="authority-page-header authority-page-header--updates">
                    <div>
                        <div class="authority-eyebrow">维护工具</div>
                        <h2>更新、备份与迁移</h2>
                        <p>拉取最新代码、重新部署前端界面、导出或导入数据包，以及下载诊断信息。</p>
                    </div>
                    <div class="authority-page-actions authority-page-actions--updates">
                        <button type="button" class="authority-action-button authority-action-button--primary authority-action-button--wide" data-action="admin-update" data-update-action="git-pull" ${this.state.updateInProgress ? 'disabled' : ''}>${pullButtonLabel}</button>
                        <button type="button" class="authority-action-button authority-action-button--wide" data-action="admin-update" data-update-action="redeploy-sdk" ${this.state.updateInProgress ? 'disabled' : ''}>${redeployButtonLabel}</button>
                        <button type="button" class="authority-action-button authority-action-button--wide" data-action="export-portable-package" ${this.state.packageActionInProgress ? 'disabled' : ''}>${packageButtonLabel}</button>
                        <button type="button" class="authority-action-button authority-action-button--wide" data-action="export-diagnostic-archive" ${this.state.packageActionInProgress ? 'disabled' : ''}>${diagnosticArchiveLabel}</button>
                        <button type="button" class="authority-action-button authority-action-button--wide" data-action="export-diagnostic-bundle">导出诊断 JSON</button>
                    </div>
                </div>
                <section class="authority-ops-ribbon">
                    <div class="authority-ops-card authority-ops-card--featured">
                        <span class="authority-muted">作业队列</span>
                        <strong>${nativeMigrationOperations.length + packageOperations.length}</strong>
                        <div>迁移 / 数据包任务</div>
                    </div>
                    <div class="authority-ops-card">
                        <span class="authority-muted">ST-Manager</span>
                        <strong>${this.state.stManagerBridgeConfig?.enabled ? '已配对' : '未启用'}</strong>
                        <div>远程备份与桥接</div>
                    </div>
                    <div class="authority-ops-card">
                        <span class="authority-muted">SDK</span>
                        <strong>${escapeHtml(probe?.sdkDeployedVersion ?? MISSING_TEXT)}</strong>
                        <div>当前启用前端</div>
                    </div>
                    <div class="authority-ops-card">
                        <span class="authority-muted">最近操作</span>
                        <strong>${escapeHtml(result ? formatDate(result.updatedAt) : '未执行')}</strong>
                        <div>更新 / 迁移 / 诊断</div>
                    </div>
                </section>
                <section class="authority-card authority-card--flat authority-install-state-card">
                    <div class="authority-card__header">
                        <div>
                            <h3>当前安装状态</h3>
                            <div class="authority-muted">插件、前端界面与后台服务的安装与版本信息</div>
                        </div>
                        <span class="authority-pill authority-pill--${escapeHtml(probe?.installStatus ?? 'prompt')}">${escapeHtml(probe ? getInstallStatusLabel(probe.installStatus) : '未获取')}</span>
                    </div>
                    <div class="authority-kv-grid">
                        <div><strong>服务端插件版本</strong><div>${escapeHtml(probe?.pluginVersion ?? MISSING_TEXT)}</div></div>
                        <div><strong>插件内置前端版本</strong><div>${escapeHtml(probe?.sdkBundledVersion ?? MISSING_TEXT)}</div></div>
                        <div><strong>当前启用的前端版本</strong><div>${escapeHtml(probe?.sdkDeployedVersion ?? MISSING_TEXT)}</div></div>
                        <div><strong>后台服务版本</strong><div>${escapeHtml(probe?.core.version ?? probe?.coreBundledVersion ?? MISSING_TEXT)}</div></div>
                        <div><strong>插件目录</strong><div>${escapeHtml(installPath)}</div></div>
                        <div><strong>最近操作</strong><div>${escapeHtml(result ? formatDate(result.updatedAt) : '未执行')}</div></div>
                    </div>
                </section>
                <section class="authority-card authority-card--flat authority-native-migration-studio">
                    <div class="authority-card__header">
                        <div>
                            <h3>原生酒馆迁移导入</h3>
                            <div class="authority-muted">从旧 SillyTavern 前端上传 data 或 third-party 插件 ZIP，预览后解压到新酒馆对应目录。最大 12 GB。</div>
                        </div>
                        <span class="authority-pill authority-pill--warning">管理员高风险操作</span>
                    </div>
                    <div class="authority-migration-grid">
                        <div class="authority-upload-tile">
                            <strong>导入旧酒馆 data 目录</strong>
                            <div class="authority-muted">支持压缩包内为 <code>data/default-user/...</code> 或直接 <code>default-user/...</code>。默认不会删除目标目录中压缩包缺失的文件。</div>
                            <div class="authority-page-actions">
                                <input type="file" data-role="native-migration-file" data-target="data" accept=".zip,application/zip" ${this.state.nativeMigrationActionInProgress ? 'disabled' : ''} />
                                <button type="button" class="authority-action-button authority-action-button--primary" data-action="preview-native-migration" data-target="data" ${this.state.nativeMigrationActionInProgress ? 'disabled' : ''}>${nativeMigrationButtonLabel}</button>
                            </div>
                        </div>
                        <div class="authority-upload-tile">
                            <strong>导入旧酒馆第三方插件目录</strong>
                            <div class="authority-muted">支持压缩包内为 <code>public/scripts/extensions/third-party/...</code>、<code>extensions/third-party/...</code>、<code>third-party/...</code> 或直接插件文件夹。不会运行 npm install、重启或启用脚本。</div>
                            <div class="authority-page-actions">
                                <input type="file" data-role="native-migration-file" data-target="third-party" accept=".zip,application/zip" ${this.state.nativeMigrationActionInProgress ? 'disabled' : ''} />
                                <button type="button" class="authority-action-button authority-action-button--primary" data-action="preview-native-migration" data-target="third-party" ${this.state.nativeMigrationActionInProgress ? 'disabled' : ''}>${nativeMigrationButtonLabel}</button>
                            </div>
                        </div>
                    </div>
                    <div class="authority-stack">
                        <div class="authority-guardrail-band">
                            <span>不删除缺失文件</span>
                            <span>不运行 npm install</span>
                            <span>不重启</span>
                            <span>不自动启用脚本</span>
                        </div>
                        <div class="authority-inline-note">
                            这是原生 SillyTavern 文件迁移，不是 Authority portable package，也不是 ST-Manager 远程备份。先预览，再选择跳过已有文件或覆盖已有文件；覆盖模式会创建回滚备份。
                        </div>
                        ${nativeMigrationOperations.length > 0 ? `
                            <div class="authority-table-wrap">
                                <table class="authority-data-table authority-policy-matrix">
                                    <thead>
                                        <tr>
                                            <th>迁移任务</th>
                                            <th>状态</th>
                                            <th>预览统计</th>
                                            <th>执行结果</th>
                                            <th>更新时间</th>
                                            <th>动作</th>
                                        </tr>
                                    </thead>
                                    <tbody>
                                        ${nativeMigrationOperations.map(operation => this.renderNativeMigrationOperationRow(operation)).join('')}
                                    </tbody>
                                </table>
                            </div>
                        ` : '<div class="authority-empty">暂时还没有原生迁移任务。上传 ZIP 后会先生成预览。</div>'}
                    </div>
                </section>
                <div class="authority-maintenance-secondary">
                ${renderStManagerBridgeSection(this.state.stManagerBridgeConfig, this.state.stManagerBridgeGeneratedKey, this.state.stManagerBridgeActionInProgress)}
                ${renderStManagerControlSection(this.state.stManagerControlConfig, this.state.stManagerControlBackups, this.state.stManagerControlActionInProgress)}
                <section class="authority-card authority-card--flat">
                    <div class="authority-card__header">
                        <div>
                            <h3>数据占用概览</h3>
                            <div class="authority-muted">按扩展查看数据占用，用于备份、迁移或清理决策。</div>
                        </div>
                    </div>
                    ${usageSummary ? `
                        <div class="authority-kv-grid">
                            <div><strong>扩展数</strong><div>${escapeHtml(String(usageSummary.totals.extensionCount))}</div></div>
                            <div><strong>存储文件</strong><div>${escapeHtml(String(usageSummary.totals.blobCount))} · ${escapeHtml(formatBytes(usageSummary.totals.blobBytes))}</div></div>
                            <div><strong>SQL / Trivium</strong><div>${escapeHtml(String(usageSummary.totals.databaseCount))} · ${escapeHtml(formatBytes(usageSummary.totals.databaseBytes))}</div></div>
                            <div><strong>私有文件</strong><div>${escapeHtml(String(usageSummary.totals.files.fileCount))} · ${escapeHtml(formatBytes(usageSummary.totals.files.totalSizeBytes))}</div></div>
                            <div><strong>键值数据</strong><div>${escapeHtml(String(usageSummary.totals.kvEntries))}</div></div>
                            <div><strong>生成时间</strong><div>${escapeHtml(formatDate(usageSummary.generatedAt))}</div></div>
                        </div>
                        <div class="authority-table-wrap">
                            <table class="authority-data-table authority-policy-matrix">
                                <thead>
                                    <tr>
                                        <th>扩展</th>
                                        <th>键值</th>
                                        <th>存储文件</th>
                                        <th>SQL / Trivium</th>
                                        <th>私有文件</th>
                                        <th>授权</th>
                                    </tr>
                                </thead>
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
                    ` : '<div class="authority-empty">暂时还没拿到数据占用概览。</div>'}
                </section>
                <section class="authority-card authority-card--flat">
                    <div class="authority-card__header">
                        <div>
                            <h3>数据包导入导出</h3>
                            <div class="authority-muted">将授权、规则、文件和数据库打包备份，并记录后台处理进度。</div>
                        </div>
                    </div>
                    <div class="authority-stack">
                        <div class="authority-list-card authority-list-card--column">
                            <strong>导入方式</strong>
                            <div class="authority-page-actions">
                                <select data-role="import-package-mode" ${this.state.packageActionInProgress ? 'disabled' : ''}>
                                    <option value="replace">覆盖导入 · 先清空现有数据，再导入包里的内容</option>
                                    <option value="merge">合并导入 · 保留现有数据，再补充包里的内容</option>
                                </select>
                                <input type="file" data-role="import-package-file" accept=".zip,.authoritypkg.zip,.json,.gz,.authoritypkg,.authoritypkg.json.gz,application/zip,application/json,application/gzip" ${this.state.packageActionInProgress ? 'disabled' : ''} />
                                <button type="button" class="authority-action-button authority-action-button--primary" data-action="import-portable-package" ${this.state.packageActionInProgress ? 'disabled' : ''}>${importButtonLabel}</button>
                            </div>
                            <div class="authority-muted">导出完成后可以在下方列表下载；如果失败，也可以重新执行。</div>
                        </div>
                        ${packageOperations.length > 0 ? `
                            <div class="authority-table-wrap">
                                <table class="authority-data-table authority-policy-matrix">
                                    <thead>
                                        <tr>
                                            <th>任务</th>
                                            <th>状态</th>
                                            <th>进度</th>
                                            <th>结果</th>
                                            <th>更新时间</th>
                                            <th>动作</th>
                                        </tr>
                                    </thead>
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
                        ` : '<div class="authority-empty">暂时还没有导入或导出任务。</div>'}
                    </div>
                </section>
                <section class="authority-card authority-card--flat">
                    <div class="authority-card__header">
                        <div>
                            <h3>这些按钮分别做什么</h3>
                            <div class="authority-muted">维护功能说明与操作指引</div>
                        </div>
                    </div>
                    <div class="authority-stack">
                        <div class="authority-list-card authority-list-card--column">
                            <strong>拉取最新代码</strong>
                            <div class="authority-muted">适用于用 Git 安装的 \`plugins/authority\`。会执行 \`git pull --ff-only\`，再重新部署插件自带的前端界面，并尝试重启后台服务。</div>
                        </div>
                        <div class="authority-list-card authority-list-card--column">
                            <strong>重新部署前端界面</strong>
                            <div class="authority-muted">只刷新 \`third-party/st-authority-sdk\` 到插件自带的最新版本，不会联网，也不会改服务端代码。</div>
                        </div>
                        <div class="authority-list-card authority-list-card--column">
                            <strong>重启提示</strong>
                            <div class="authority-muted">如果 \`git pull\` 拉到了新的 Node 服务端代码，通常还需要重启 SillyTavern，才能完全切换到新代码。</div>
                        </div>
                    </div>
                </section>
                </div>
                ${result ? `
                    <section class="authority-card authority-card--flat">
                        <div class="authority-card__header">
                            <div>
                                <h3>最近一次更新记录</h3>
                                <div class="authority-muted">${escapeHtml(result.message)}</div>
                            </div>
                            <div class="authority-page-actions">
                                <span class="authority-pill authority-pill--${result.requiresRestart ? 'warning' : 'granted'}">${escapeHtml(result.requiresRestart ? '需要重启 ST' : '无需重启 ST')}</span>
                                <span class="authority-pill authority-pill--runtime">${escapeHtml(result.action === 'git-pull' ? '已拉取最新代码' : '已重新部署前端界面')}</span>
                            </div>
                        </div>
                        <div class="authority-kv-grid">
                            <div><strong>更新前插件版本</strong><div>${escapeHtml(result.before.pluginVersion)}</div></div>
                            <div><strong>更新后插件版本</strong><div>${escapeHtml(result.after.pluginVersion)}</div></div>
                            <div><strong>更新前 SDK</strong><div>${escapeHtml(result.before.sdkDeployedVersion ?? '未部署')}</div></div>
                            <div><strong>更新后 SDK</strong><div>${escapeHtml(result.after.sdkDeployedVersion ?? '未部署')}</div></div>
                            <div><strong>后台服务状态</strong><div>${escapeHtml(getCoreStateLabel(result.core.state))}</div></div>
                            <div><strong>后台服务说明</strong><div>${escapeHtml(result.coreRestartMessage ?? '后台服务已正常运行')}</div></div>
                        </div>
                        ${result.git ? `
                            <div class="authority-stack">
                                <div class="authority-list-card authority-list-card--column">
                                    <strong>Git 分支 / 提交号</strong>
                                    <div class="authority-muted">${escapeHtml(result.git.branch ?? '未获取')} · ${escapeHtml(result.git.previousRevision ?? '未知')} → ${escapeHtml(result.git.currentRevision ?? '未知')}</div>
                                </div>
                                ${result.git.stdout ? `<pre class="authority-code-block">${escapeHtml(result.git.stdout)}</pre>` : ''}
                                ${result.git.stderr ? `<pre class="authority-code-block">${escapeHtml(result.git.stderr)}</pre>` : ''}
                            </div>
                        ` : ''}
                    </section>
                ` : ''}
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
    renderOverviewCollapsibleSection(key, className, title, description, content) {
        const isOpen = this.state.overviewSectionState[key];
        return `
            <details class="${className} authority-collapsible-section" data-overview-section="${key}" ${isOpen ? 'open' : ''}>
                <summary class="authority-section-heading authority-section-heading--summary">
                    <div>
                        <h3>${escapeHtml(title)}</h3>
                        <div class="authority-muted">${escapeHtml(description)}</div>
                    </div>
                </summary>
                <div class="authority-collapsible-section__body">
                    ${content}
                </div>
            </details>
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
        for (const section of this.root.querySelectorAll('[data-section]')) {
            const name = section.dataset.section;
            section.hidden = name !== this.state.selectedTab;
        }
    }
    loadOverviewSectionState(userHandle) {
        if (!userHandle) {
            return { ...DEFAULT_OVERVIEW_SECTION_STATE };
        }
        try {
            const raw = globalThis.localStorage?.getItem(this.getOverviewSectionStateStorageKey(userHandle));
            if (!raw) {
                return { ...DEFAULT_OVERVIEW_SECTION_STATE };
            }
            const parsed = JSON.parse(raw);
            return {
                governance: parsed.governance ?? DEFAULT_OVERVIEW_SECTION_STATE.governance,
                capabilityMatrix: parsed.capabilityMatrix ?? DEFAULT_OVERVIEW_SECTION_STATE.capabilityMatrix,
                recentActivity: parsed.recentActivity ?? DEFAULT_OVERVIEW_SECTION_STATE.recentActivity,
            };
        }
        catch {
            return { ...DEFAULT_OVERVIEW_SECTION_STATE };
        }
    }
    setOverviewSectionOpen(key, isOpen) {
        if (this.state.overviewSectionState[key] === isOpen) {
            return;
        }
        this.state.overviewSectionState = {
            ...this.state.overviewSectionState,
            [key]: isOpen,
        };
        this.persistOverviewSectionState();
    }
    persistOverviewSectionState() {
        const userHandle = this.state.session?.user.handle;
        if (!userHandle) {
            return;
        }
        try {
            globalThis.localStorage?.setItem(this.getOverviewSectionStateStorageKey(userHandle), JSON.stringify(this.state.overviewSectionState));
        }
        catch {
        }
    }
    getOverviewSectionStateStorageKey(userHandle) {
        return `${OVERVIEW_SECTION_STATE_STORAGE_KEY}:${userHandle}`;
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
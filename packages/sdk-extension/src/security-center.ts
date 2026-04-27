import type {
    AuthorityJobRegistryEntry,
    AuthorityPolicyEntry,
    PermissionResource,
    PermissionStatus,
    SessionInitResponse,
} from '@stdo/shared-types';
import { authorityRequest } from './api.js';
import { clearChildren, escapeHtml, formatDate } from './dom.js';
import {
    renderActivityLogRows,
    renderAlertStack,
    renderCapabilityMatrix,
    renderDatabaseAssetSections,
    renderDatabaseGroupTable,
    renderGrantSettingsRows,
    renderJobTable,
    renderMetricTile,
    renderPolicyRows,
    renderStorageSummary,
    renderStringList,
    type AlertItem,
} from './security-center/components.js';
import {
    RESOURCE_OPTIONS,
    SECURITY_CENTER_CONFIG,
    STATUS_OPTIONS,
} from './security-center/constants.js';
import {
    formatBytes,
    getCoreStateLabel,
    getDeclaredPermissionLabels,
    getExtensionRiskLevel,
    getInstallStatusLabel,
    getInstallTypeLabel,
    getResourceLabel,
    getRiskLabel,
    getRiskLevel,
    getStatusLabel,
    getSystemMessageLabel,
    sortByTimestampDesc,
} from './security-center/formatters.js';
import type {
    CenterTab,
    AdminUpdateAction,
    AdminUpdateResponse,
    ExtensionDetailResponse,
    OverviewSectionKey,
    OverviewSectionState,
    ExtensionSummary,
    PoliciesResponse,
    ProbeResponse,
    SecurityCenterOpenOptions,
    SecurityCenterState,
} from './security-center/types.js';
import {
    bootstrapSecurityCenter as bootstrapSecurityCenterHost,
    openSecurityCenter as openSecurityCenterHost,
} from './security-center/host.js';
import { buildOverviewModel, getDatabaseGroupSummaries } from './security-center/view-models.js';

const TOAST_TITLE = '权限中心';
const MISSING_TEXT = '未获取';
const OVERVIEW_SECTION_STATE_STORAGE_KEY = 'authority.security-center.overview-section-state';
const DEFAULT_OVERVIEW_SECTION_STATE: OverviewSectionState = {
    governance: true,
    capabilityMatrix: true,
    recentActivity: true,
};

export function bootstrapSecurityCenter(): Promise<void> {
    return bootstrapSecurityCenterHost(createSecurityCenterView);
}

export async function openSecurityCenter(options: SecurityCenterOpenOptions = {}): Promise<void> {
    await openSecurityCenterHost(createSecurityCenterView, options);
}

function createSecurityCenterView(root: HTMLElement, focusExtensionId?: string): SecurityCenterView {
    return new SecurityCenterView(root, focusExtensionId);
}

class SecurityCenterView {
    private readonly state: SecurityCenterState;

    constructor(
        private readonly root: HTMLElement,
        private readonly focusExtensionId?: string,
    ) {
        this.state = {
            loading: true,
            error: null,
            isAdmin: false,
            probe: null,
            session: null,
            extensions: [],
            details: new Map(),
            selectedExtensionId: focusExtensionId ?? null,
            selectedTab: focusExtensionId ? 'detail' : 'overview',
            overviewSectionState: { ...DEFAULT_OVERVIEW_SECTION_STATE },
            extensionFilter: '',
            policies: null,
            policyEditorExtensionId: focusExtensionId ?? null,
            updateResult: null,
            updateInProgress: false,
        };
    }

    async initialize(): Promise<void> {
        this.bindEvents();
        await this.refresh();
    }

    private bindEvents(): void {
        this.root.addEventListener('click', event => {
            const target = event.target instanceof HTMLElement ? event.target : null;
            if (!target) {
                return;
            }

            const overviewSummary = target.closest<HTMLElement>('summary.authority-section-heading--summary');
            if (overviewSummary) {
                const section = overviewSummary.closest<HTMLDetailsElement>('[data-overview-section]');
                const key = section?.dataset.overviewSection as OverviewSectionKey | undefined;
                if (section && key) {
                    window.setTimeout(() => this.setOverviewSectionOpen(key, section.open), 0);
                }
                return;
            }

            const tabButton = target.closest<HTMLElement>('[data-tab]');
            if (tabButton) {
                const tab = tabButton.dataset.tab as CenterTab;
                if ((tab !== 'policies' && tab !== 'updates') || this.state.isAdmin) {
                    this.state.selectedTab = tab;
                    void this.render();
                }
                return;
            }

            const refreshButton = target.closest<HTMLElement>('[data-action="refresh"]');
            if (refreshButton) {
                void this.refresh();
                return;
            }

            const extensionButton = target.closest<HTMLElement>('.authority-extension-item[data-extension-id]');
            if (extensionButton) {
                const extensionId = extensionButton.dataset.extensionId;
                if (extensionId) {
                    void this.selectExtension(extensionId, 'detail');
                }
                return;
            }

            const resetAllButton = target.closest<HTMLElement>('[data-action="reset-all-grants"]');
            if (resetAllButton?.dataset.extensionId) {
                void this.resetGrants(resetAllButton.dataset.extensionId);
                return;
            }

            const resetGrantButton = target.closest<HTMLElement>('[data-action="reset-grant"]');
            if (resetGrantButton?.dataset.extensionId && resetGrantButton.dataset.grantKey) {
                void this.resetGrants(resetGrantButton.dataset.extensionId, [resetGrantButton.dataset.grantKey]);
                return;
            }

            const addOverrideButton = target.closest<HTMLElement>('[data-action="add-policy-row"]');
            if (addOverrideButton) {
                this.addPolicyOverrideRow();
                return;
            }

            const removeOverrideButton = target.closest<HTMLElement>('[data-action="remove-policy-row"]');
            if (removeOverrideButton) {
                removeOverrideButton.closest<HTMLElement>('.authority-policy-row')?.remove();
                return;
            }

            const savePoliciesButton = target.closest<HTMLElement>('[data-action="save-policies"]');
            if (savePoliciesButton) {
                void this.savePolicies();
                return;
            }

            const adminUpdateButton = target.closest<HTMLElement>('[data-action="admin-update"]');
            if (adminUpdateButton) {
                const action = adminUpdateButton.dataset.updateAction as AdminUpdateAction | undefined;
                if (action) {
                    void this.runAdminUpdate(action);
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
            }
        });
    }

    private async refresh(): Promise<void> {
        this.state.loading = true;
        this.state.error = null;
        void this.render();

        try {
            const probe = await authorityRequest<ProbeResponse>('/probe', { method: 'POST' });
            const session = await authorityRequest<SessionInitResponse>('/session/init', {
                method: 'POST',
                body: SECURITY_CENTER_CONFIG,
            });
            const extensions = await authorityRequest<ExtensionSummary[]>('/extensions');
            const detailEntries = await Promise.all(extensions.map(async extension => {
                const detail = await authorityRequest<ExtensionDetailResponse>(`/extensions/${encodeURIComponent(extension.id)}`);
                return [extension.id, detail] as const;
            }));

            this.state.probe = probe;
            this.state.session = session;
            this.state.isAdmin = session.user.isAdmin;
            this.state.overviewSectionState = this.loadOverviewSectionState(session.user.handle);
            this.state.extensions = extensions;
            this.state.details = new Map(detailEntries);
            this.state.selectedExtensionId = this.resolveSelectedExtensionId();
            this.state.policyEditorExtensionId = this.resolvePolicyEditorExtensionId();
            this.state.policies = this.state.isAdmin
                ? await authorityRequest<PoliciesResponse>('/admin/policies')
                : null;

            if (!this.state.isAdmin && (this.state.selectedTab === 'policies' || this.state.selectedTab === 'updates')) {
                this.state.selectedTab = 'overview';
            }
        } catch (error) {
            this.state.error = error instanceof Error ? error.message : String(error);
        } finally {
            this.state.loading = false;
            void this.render();
        }
    }

    private async runAdminUpdate(action: AdminUpdateAction): Promise<void> {
        if (!this.state.isAdmin || this.state.updateInProgress) {
            return;
        }

        this.state.updateInProgress = true;
        void this.renderUpdatesSection();

        try {
            const result = await authorityRequest<AdminUpdateResponse>('/admin/update', {
                method: 'POST',
                body: { action },
            });
            this.state.updateResult = result;
            toastr.success(result.message, TOAST_TITLE);
            await this.refresh();
            this.state.updateResult = result;
            this.state.selectedTab = 'updates';
            void this.render();
        } catch (error) {
            toastr.error(getSystemMessageLabel(error instanceof Error ? error.message : String(error)), TOAST_TITLE);
        } finally {
            this.state.updateInProgress = false;
            void this.renderUpdatesSection();
        }
    }

    private async selectExtension(extensionId: string, tab: CenterTab): Promise<void> {
        this.state.selectedExtensionId = extensionId;
        this.state.selectedTab = tab;
        if (!this.state.details.has(extensionId)) {
            const detail = await authorityRequest<ExtensionDetailResponse>(`/extensions/${encodeURIComponent(extensionId)}`);
            this.state.details.set(extensionId, detail);
        }
        void this.render();
    }

    private async resetGrants(extensionId: string, keys?: string[]): Promise<void> {
        try {
            await authorityRequest<void>(`/extensions/${encodeURIComponent(extensionId)}/grants/reset`, {
                method: 'POST',
                body: { keys },
            });
            toastr.success('授权已重置', TOAST_TITLE);
            await this.refresh();
        } catch (error) {
            toastr.error(getSystemMessageLabel(error instanceof Error ? error.message : String(error)), TOAST_TITLE);
        }
    }

    private async savePolicies(): Promise<void> {
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
                } else {
                    delete nextExtensions[extensionId];
                }
            }

            this.state.policies = await authorityRequest<PoliciesResponse>('/admin/policies', {
                method: 'POST',
                body: {
                    defaults: this.collectDefaultPolicies(),
                    extensions: nextExtensions,
                },
            });
            toastr.success('管理员策略已保存', TOAST_TITLE);
            await this.refresh();
        } catch (error) {
            toastr.error(getSystemMessageLabel(error instanceof Error ? error.message : String(error)), TOAST_TITLE);
        }
    }

    private collectDefaultPolicies(): Record<PermissionResource, PermissionStatus> {
        const result = {} as Record<PermissionResource, PermissionStatus>;
        for (const select of this.root.querySelectorAll<HTMLSelectElement>('[data-policy-default]')) {
            const resource = select.dataset.policyDefault as PermissionResource;
            result[resource] = select.value as PermissionStatus;
        }
        return result;
    }

    private collectOverridePolicies(): Record<string, AuthorityPolicyEntry> {
        const result: Record<string, AuthorityPolicyEntry> = {};
        for (const row of this.root.querySelectorAll<HTMLElement>('.authority-policy-row')) {
            const resourceSelect = row.querySelector<HTMLSelectElement>('[data-policy-field="resource"]');
            const targetInput = row.querySelector<HTMLInputElement>('[data-policy-field="target"]');
            const statusSelect = row.querySelector<HTMLSelectElement>('[data-policy-field="status"]');
            if (!resourceSelect || !targetInput || !statusSelect) {
                continue;
            }

            const resource = resourceSelect.value as PermissionResource;
            const target = (targetInput.value || '*').trim() || '*';
            const key = `${resource}:${target}`;
            result[key] = {
                key,
                resource,
                target,
                status: statusSelect.value as PermissionStatus,
                riskLevel: getRiskLevel(resource),
                updatedAt: new Date().toISOString(),
                source: 'admin',
            };
        }
        return result;
    }

    private addPolicyOverrideRow(entry?: AuthorityPolicyEntry): void {
        const container = this.root.querySelector<HTMLElement>('[data-role="policy-rows"]');
        if (!container) {
            return;
        }

        const wrapper = document.createElement('div');
        wrapper.className = 'authority-policy-row';
        wrapper.innerHTML = this.buildPolicyRowMarkup(entry);
        container.appendChild(wrapper);
    }

    private async render(): Promise<void> {
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

    private renderHeader(): void {
        const status = this.root.querySelector<HTMLElement>('[data-role="status"]');
        const badges = this.root.querySelector<HTMLElement>('[data-role="health-badges"]');
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
                { tone: 'info', title: '同步中', message: '正在同步权限中心状态、扩展记录与策略数据。' },
            ]);
            return;
        }

        if (this.state.error) {
            status.innerHTML = renderAlertStack([
                { tone: 'error', title: '同步失败', message: getSystemMessageLabel(this.state.error) },
            ]);
            return;
        }

        const alerts: AlertItem[] = [];
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

    private renderTabs(): void {
        for (const tab of this.root.querySelectorAll<HTMLElement>('[data-tab]')) {
            const tabName = tab.dataset.tab as CenterTab;
            tab.classList.toggle('authority-tab--active', tabName === this.state.selectedTab);
            tab.hidden = (tabName === 'policies' || tabName === 'updates') && !this.state.isAdmin;
        }
    }

    private renderExtensionList(): void {
        const container = this.root.querySelector<HTMLElement>('[data-role="extension-list"]');
        const count = this.root.querySelector<HTMLElement>('[data-role="extension-count"]');
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
                    <span class="authority-pill authority-pill--granted">允许 ${extension.grantedCount}</span>
                    <span class="authority-pill authority-pill--denied">拒绝 ${extension.deniedCount}</span>
                    <span class="authority-pill authority-pill--prompt">声明 ${declared.length}</span>
                    ${errorCount > 0 ? `<span class="authority-pill authority-pill--error">异常 ${errorCount}</span>` : ''}
                </span>
            `;
            item.classList.toggle('authority-extension-item--active', extension.id === this.state.selectedExtensionId);
            container.appendChild(item);
        }
    }

    private async renderOverviewSection(): Promise<void> {
        const container = this.root.querySelector<HTMLElement>('[data-role="overview-view"]');
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
                    <section class="authority-diagnostics-panel">
                        <div class="authority-section-heading">
                            <div>
                                <h3>核心诊断与完整性</h3>
                                <div class="authority-muted">后台服务、SDK 接入与本地平台校验</div>
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
                                <span>构建标识</span>
                                <strong>${escapeHtml(core?.health?.buildHash ?? this.state.probe?.coreBinarySha256 ?? MISSING_TEXT)}</strong>
                            </div>
                            <div>
                                <span>数据根目录</span>
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
                                <span>Worker 数量</span>
                                <strong>${escapeHtml(core?.health ? String(core.health.workerCount) : MISSING_TEXT)}</strong>
                            </div>
                            <div>
                                <span>Job Registry</span>
                                <strong>${escapeHtml(core?.health ? `${core.health.jobRegistrySummary.registered} / ${core.health.jobRegistrySummary.jobTypes.join(', ')}` : MISSING_TEXT)}</strong>
                            </div>
                        </div>
                        ${this.renderJobRegistryDetails()}
                    </section>
                    ${this.renderEffectiveLimitsCard()}
                    ${this.renderOverviewCollapsibleSection(
            'governance',
            'authority-section-block',
            '权限治理',
            '授权、拒绝、策略覆盖与后台任务',
            `<div class="authority-governance-grid">
                            ${renderMetricTile('已接入扩展', String(this.state.extensions.length), '注册到权限中心', 'primary')}
                            ${renderMetricTile('已允许授权', String(grantedCount), '持久授权记录', 'success')}
                            ${renderMetricTile('拒绝 / 封锁', String(deniedCount), '用户拒绝或管理员封锁', deniedCount > 0 ? 'warning' : 'neutral')}
                            ${renderMetricTile('策略覆盖', String(overview.totalPolicyCount), '默认与扩展覆盖', 'neutral')}
                            ${renderMetricTile('活跃任务', String(overview.activeJobs.length), '排队中 / 执行中', overview.activeJobs.length > 0 ? 'runtime' : 'neutral')}
                            ${renderMetricTile('失败任务', String(overview.failedJobs.length), '失败 / 取消的后台任务', overview.failedJobs.length > 0 ? 'warning' : 'neutral')}
                            ${renderMetricTile('权限拒绝', String(overview.recentPermissionDenials.length), '最近被拒绝的权限请求', overview.recentPermissionDenials.length > 0 ? 'warning' : 'neutral')}
                            ${renderMetricTile('最近告警', String(overview.recentWarnings.length), '队列压力 / 慢任务 / 重试线索', overview.recentWarnings.length > 0 ? 'warning' : 'neutral')}
                            ${renderMetricTile('最近错误', String(overview.recentErrors.length), '需要排查的异常', overview.recentErrors.length > 0 ? 'error' : 'neutral')}
                        </div>`,
        )}
                    ${this.renderOverviewCollapsibleSection(
            'capabilityMatrix',
            'authority-section-block',
            '能力矩阵',
            '当前可由权限中心管理的系统能力',
            renderCapabilityMatrix(RESOURCE_OPTIONS),
        )}
                    ${this.renderOverviewCollapsibleSection(
            'recentActivity',
            'authority-log-panel',
            '近期活动日志',
            '权限请求、能力调用与异常记录',
            renderActivityLogRows(overview.recentActivity, '暂无活动记录。'),
        )}
                </div>
                <aside class="authority-inspector">
                    <section class="authority-card">
                        <div class="authority-section-heading">
                            <div>
                                <h3>资源与存储</h3>
                                <div class="authority-muted">当前用户数据资产</div>
                            </div>
                        </div>
                        <div class="authority-resource-stack">
                            <div class="authority-resource-row">
                                <span>键值数据</span>
                                <strong>${this.state.extensions.reduce((sum, item) => sum + item.storage.kvEntries, 0)}</strong>
                            </div>
                            <div class="authority-resource-row">
                                <span>文件体积</span>
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
                                <h3>后台任务摘要</h3>
                                <div class="authority-muted">排队中与执行中的任务</div>
                            </div>
                        </div>
                        ${renderJobTable(overview.activeJobs.slice(0, 5), '当前没有排队或运行中的任务。')}
                    </section>
                    <section class="authority-card">
                        <div class="authority-section-heading">
                            <div>
                                <h3>最近权限拒绝</h3>
                                <div class="authority-muted">被拒绝或封锁的权限请求</div>
                            </div>
                        </div>
                        ${renderActivityLogRows(overview.recentPermissionDenials.slice(0, 5), '暂无权限拒绝记录。')}
                    </section>
                    <section class="authority-card">
                        <div class="authority-section-heading">
                            <div>
                                <h3>最近失败任务</h3>
                                <div class="authority-muted">失败或取消的后台任务</div>
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
                                <div class="authority-muted">需要优先排查的异常</div>
                            </div>
                        </div>
                        ${renderActivityLogRows(overview.recentErrors.slice(0, 5), '暂无错误记录。')}
                    </section>
                </aside>
            </div>
        `;
    }

    private async renderDetailSection(): Promise<void> {
        const container = this.root.querySelector<HTMLElement>('[data-role="detail-view"]');
        if (!container) {
            return;
        }

        const detail = this.getSelectedDetail();
        if (!detail) {
            container.innerHTML = '<div class="authority-empty">从左侧选择一个扩展以查看详细授权、任务和错误信息。</div>';
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
                            <h3>运行档案</h3>
                            <div class="authority-muted">扩展接入时间、最近活跃与数据使用</div>
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
                            <h3>权限管控</h3>
                            <div class="authority-muted">当前授权、拒绝记录与声明能力</div>
                        </div>
                    </div>
                    ${renderStringList(getDeclaredPermissionLabels(detail.extension.declaredPermissions), '该扩展还没有声明任何权限。')}
                    ${renderGrantSettingsRows(detail.extension.id, [...granted, ...denied], '当前没有持久化授权或拒绝记录。')}
                    ${renderPolicyRows(detail.policies, '当前没有针对该扩展的策略覆盖。')}
                </section>
                <section class="authority-section-block">
                    <div class="authority-section-heading">
                        <div>
                            <h3>数据资产</h3>
                            <div class="authority-muted">该扩展创建的 SQL 数据库与 Trivium 记忆库</div>
                        </div>
                    </div>
                    ${renderDatabaseAssetSections(databases, triviumDatabases, '该扩展还没有私有数据库。')}
                </section>
                <section class="authority-detail-grid">
                    <div class="authority-log-panel">
                        <div class="authority-section-heading">
                            <div>
                                <h3>最近权限活动</h3>
                                <div class="authority-muted">权限请求与决策轨迹</div>
                            </div>
                        </div>
                        ${renderActivityLogRows(permissions, '暂无权限活动。')}
                    </div>
                    <div class="authority-log-panel">
                        <div class="authority-section-heading">
                            <div>
                                <h3>最近能力调用</h3>
                                <div class="authority-muted">扩展调用系统能力的记录</div>
                            </div>
                        </div>
                        ${renderActivityLogRows(usage, '暂无能力调用记录。')}
                    </div>
                </section>
                <section class="authority-detail-grid">
                    <div class="authority-card">
                        <div class="authority-section-heading">
                            <div>
                                <h3>最近任务</h3>
                                <div class="authority-muted">后台任务队列状态</div>
                            </div>
                        </div>
                        ${renderJobTable(jobs, '暂无后台任务。')}
                    </div>
                    <div class="authority-log-panel">
                        <div class="authority-section-heading">
                            <div>
                                <h3>最近告警</h3>
                                <div class="authority-muted">队列压力、慢任务与重试记录</div>
                            </div>
                        </div>
                        ${renderActivityLogRows(warnings, '暂无运行告警记录。')}
                    </div>
                    <div class="authority-log-panel">
                        <div class="authority-section-heading">
                            <div>
                                <h3>最近错误</h3>
                                <div class="authority-muted">需要排查的内部异常</div>
                            </div>
                        </div>
                        ${renderActivityLogRows(errors, '暂无内部错误记录。')}
                    </div>
                </section>
            </div>
        `;
    }

    private async renderDatabasesSection(): Promise<void> {
        const container = this.root.querySelector<HTMLElement>('[data-role="databases-view"]');
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
                        <h2>扩展私有数据库</h2>
                        <p>按扩展汇总当前用户的 SQL 私有数据库与 Trivium 私有记忆库。</p>
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

    private async renderActivitySection(): Promise<void> {
        const container = this.root.querySelector<HTMLElement>('[data-role="activity-view"]');
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
                        <div class="authority-eyebrow">审计日志</div>
                        <h2>活动日志</h2>
                        <p>权限请求、能力调用与错误排障记录。</p>
                    </div>
                </div>
                <div class="authority-log-layout">
                    <section class="authority-log-panel">
                        <div class="authority-section-heading">
                            <div>
                                <h3>最近活动</h3>
                                <div class="authority-muted">按时间倒序显示权限中心记录</div>
                            </div>
                        </div>
                        ${renderActivityLogRows(items, '暂无活动记录。')}
                    </section>
                    <section class="authority-log-panel">
                        <div class="authority-section-heading">
                            <div>
                                <h3>运行告警</h3>
                                <div class="authority-muted">慢任务、队列压力与重试线索</div>
                            </div>
                        </div>
                        ${renderActivityLogRows(warnings, '暂无告警记录。')}
                    </section>
                    <section class="authority-log-panel">
                        <div class="authority-section-heading">
                            <div>
                                <h3>错误排障</h3>
                                <div class="authority-muted">仅显示错误类型记录</div>
                            </div>
                        </div>
                        ${renderActivityLogRows(errors, '暂无错误记录。')}
                    </section>
                </div>
            </div>
        `;
    }

    private async renderPoliciesSection(): Promise<void> {
        const container = this.root.querySelector<HTMLElement>('[data-role="policies-view"]');
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
                        <h2>全局访问控制策略</h2>
                        <p>管理员策略会覆盖扩展请求与用户授权，请谨慎设置高风险能力。</p>
                    </div>
                    <div class="authority-page-actions">
                        <button type="button" class="authority-action-button" data-action="add-policy-row">新增覆盖规则</button>
                        <button type="button" class="authority-action-button authority-action-button--primary" data-action="save-policies">保存策略</button>
                    </div>
                </div>
                <section class="authority-card authority-card--flat">
                    <div class="authority-card__header">
                        <div>
                            <h3>全局默认权限矩阵</h3>
                            <div class="authority-muted">为每类能力设置默认处理方式</div>
                        </div>
                        <span class="authority-pill authority-pill--admin">默认规则 ${RESOURCE_OPTIONS.length}</span>
                    </div>
                    <div class="authority-table-wrap">
                        <table class="authority-data-table authority-policy-matrix">
                            <thead>
                                <tr>
                                    <th>能力</th>
                                    <th>标识</th>
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
                            <h3>扩展单独规则</h3>
                            <div class="authority-muted">按扩展和目标覆盖全局默认设置</div>
                        </div>
                        <label class="authority-policy-field authority-policy-field--inline">
                            <span>编辑扩展</span>
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
                            <span class="authority-pill authority-pill--prompt">默认询问</span>
                            <span class="authority-pill authority-pill--granted">允许并记住</span>
                            <span class="authority-pill authority-pill--blocked">管理员封锁</span>
                        </div>
                        <div class="authority-muted">最后更新：${escapeHtml(formatDate(policies.updatedAt))}</div>
                    </div>
                </section>
            </div>
        `;
    }

    private async renderUpdatesSection(): Promise<void> {
        const container = this.root.querySelector<HTMLElement>('[data-role="updates-view"]');
        if (!container) {
            return;
        }

        if (!this.state.isAdmin) {
            container.innerHTML = '<div class="authority-empty">只有管理员可执行插件与前端 SDK 更新。</div>';
            return;
        }

        const probe = this.state.probe;
        const result = this.state.updateResult;
        const installPath = result?.git?.pluginRoot ?? '未获取';
        const pullButtonLabel = this.state.updateInProgress ? '更新中…' : '更新服务端插件';
        const redeployButtonLabel = this.state.updateInProgress ? '处理中…' : '重新部署前端插件';

        container.innerHTML = `
            <div class="authority-page-stack">
                <div class="authority-page-header authority-page-header--updates">
                    <div>
                        <div class="authority-eyebrow">更新管理</div>
                        <h2>服务端插件与前端插件更新</h2>
                        <p>手动拉取 Authority 服务端插件最新提交，或重新部署它携带的前端 SDK 扩展。</p>
                    </div>
                    <div class="authority-page-actions authority-page-actions--updates">
                        <button type="button" class="authority-action-button authority-action-button--primary authority-action-button--wide" data-action="admin-update" data-update-action="git-pull" ${this.state.updateInProgress ? 'disabled' : ''}>${pullButtonLabel}</button>
                        <button type="button" class="authority-action-button authority-action-button--wide" data-action="admin-update" data-update-action="redeploy-sdk" ${this.state.updateInProgress ? 'disabled' : ''}>${redeployButtonLabel}</button>
                    </div>
                </div>
                <section class="authority-card authority-card--flat">
                    <div class="authority-card__header">
                        <div>
                            <h3>当前安装状态</h3>
                            <div class="authority-muted">当前运行中的 Authority 插件与 bundled SDK 摘要</div>
                        </div>
                        <span class="authority-pill authority-pill--${escapeHtml(probe?.installStatus ?? 'prompt')}">${escapeHtml(probe ? getInstallStatusLabel(probe.installStatus) : '未获取')}</span>
                    </div>
                    <div class="authority-kv-grid">
                        <div><strong>服务端插件版本</strong><div>${escapeHtml(probe?.pluginVersion ?? MISSING_TEXT)}</div></div>
                        <div><strong>Bundled SDK 版本</strong><div>${escapeHtml(probe?.sdkBundledVersion ?? MISSING_TEXT)}</div></div>
                        <div><strong>已部署 SDK 版本</strong><div>${escapeHtml(probe?.sdkDeployedVersion ?? MISSING_TEXT)}</div></div>
                        <div><strong>Core 版本</strong><div>${escapeHtml(probe?.core.version ?? probe?.coreBundledVersion ?? MISSING_TEXT)}</div></div>
                        <div><strong>插件目录</strong><div>${escapeHtml(installPath)}</div></div>
                        <div><strong>最近操作</strong><div>${escapeHtml(result ? formatDate(result.updatedAt) : '未执行')}</div></div>
                    </div>
                </section>
                <section class="authority-card authority-card--flat">
                    <div class="authority-card__header">
                        <div>
                            <h3>操作说明</h3>
                            <div class="authority-muted">请根据你的部署方式选择对应动作</div>
                        </div>
                    </div>
                    <div class="authority-stack">
                        <div class="authority-list-card authority-list-card--column">
                            <strong>更新服务端插件</strong>
                            <div class="authority-muted">适用于以 Git 仓库形式安装的 \`plugins/authority\`。会执行 \`git pull --ff-only\`，然后重新部署 bundled SDK，并重启 Authority core。</div>
                        </div>
                        <div class="authority-list-card authority-list-card--column">
                            <strong>重新部署前端插件</strong>
                            <div class="authority-muted">只刷新 \`third-party/st-authority-sdk\` 到最新 bundled 版本，不访问远端，不改服务端插件代码。</div>
                        </div>
                        <div class="authority-list-card authority-list-card--column">
                            <strong>重启提示</strong>
                            <div class="authority-muted">如果 \`git pull\` 拉到了新的 Node 服务端代码，当前运行中的 server plugin 模块通常仍需重启 SillyTavern 才会完全切换到新代码。</div>
                        </div>
                    </div>
                </section>
                ${result ? `
                    <section class="authority-card authority-card--flat">
                        <div class="authority-card__header">
                            <div>
                                <h3>最近一次更新结果</h3>
                                <div class="authority-muted">${escapeHtml(result.message)}</div>
                            </div>
                            <div class="authority-page-actions">
                                <span class="authority-pill authority-pill--${result.requiresRestart ? 'warning' : 'granted'}">${escapeHtml(result.requiresRestart ? '需要重启 ST' : '无需重启 ST')}</span>
                                <span class="authority-pill authority-pill--runtime">${escapeHtml(result.action === 'git-pull' ? '服务端插件更新' : '前端插件重部署')}</span>
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
                                    <strong>Git 分支 / 提交</strong>
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

    private buildPolicyRowMarkup(entry?: AuthorityPolicyEntry): string {
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

    private renderEffectiveLimitsCard(): string {
        const probeLimits = this.state.probe?.limits;
        const sessionLimits = this.state.session?.limits;
        if (!probeLimits || !sessionLimits) {
            return '';
        }

        const operations: Array<{ key: keyof SessionInitResponse['limits']['effectiveInlineThresholdBytes']; label: string }> = [
            { key: 'storageBlobWrite', label: 'Blob 写入' },
            { key: 'storageBlobRead', label: 'Blob 读取' },
            { key: 'privateFileWrite', label: '私有文件写入' },
            { key: 'privateFileRead', label: '私有文件读取' },
            { key: 'httpFetchRequest', label: 'HTTP 请求体' },
            { key: 'httpFetchResponse', label: 'HTTP 响应体' },
        ];

        return `
            <section class="authority-card authority-card--flat">
                <div class="authority-section-heading">
                    <div>
                        <h3>Effective Limits</h3>
                        <div class="authority-muted">展示当前 session 生效值、probe 基线值以及 policy source。</div>
                    </div>
                </div>
                <div class="authority-chip-row">
                    <span class="authority-pill authority-pill--prompt">chunk ${escapeHtml(formatBytes(probeLimits.dataTransferChunkBytes))}</span>
                    <span class="authority-pill authority-pill--prompt">legacy inline ${escapeHtml(formatBytes(probeLimits.dataTransferInlineThresholdBytes))}</span>
                    <span class="authority-pill authority-pill--prompt">legacy transfer ${escapeHtml(formatBytes(probeLimits.maxDataTransferBytes))}</span>
                </div>
                <div class="authority-table-wrap">
                    <table class="authority-data-table authority-policy-matrix">
                        <thead>
                            <tr>
                                <th>操作</th>
                                <th>Session Inline</th>
                                <th>Session Transfer</th>
                                <th>Probe Inline</th>
                                <th>Probe Transfer</th>
                            </tr>
                        </thead>
                        <tbody>
                            ${operations.map(({ key, label }) => `
                                <tr>
                                    <td><strong>${escapeHtml(label)}</strong><div class="authority-muted">${escapeHtml(key)}</div></td>
                                    <td>${escapeHtml(this.formatEffectiveLimitValue(sessionLimits.effectiveInlineThresholdBytes[key]))}</td>
                                    <td>${escapeHtml(this.formatEffectiveLimitValue(sessionLimits.effectiveTransferMaxBytes[key]))}</td>
                                    <td>${escapeHtml(this.formatEffectiveLimitValue(probeLimits.effectiveInlineThresholdBytes[key]))}</td>
                                    <td>${escapeHtml(this.formatEffectiveLimitValue(probeLimits.effectiveTransferMaxBytes[key]))}</td>
                                </tr>
                            `).join('')}
                        </tbody>
                    </table>
                </div>
            </section>
        `;
    }

    private formatEffectiveLimitValue(limit: SessionInitResponse['limits']['effectiveInlineThresholdBytes'][keyof SessionInitResponse['limits']['effectiveInlineThresholdBytes']]): string {
        return `${formatBytes(limit.bytes)} · ${limit.source}`;
    }

    private renderOverviewCollapsibleSection(
        key: OverviewSectionKey,
        className: string,
        title: string,
        description: string,
        content: string,
    ): string {
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

    private renderJobRegistryDetails(): string {
        const registry = this.state.probe?.jobs.registry;
        if (!registry) {
            return '';
        }
        if (registry.entries.length === 0) {
            return '<div class="authority-muted">当前未提供 Job Registry 明细。</div>';
        }

        return `
            <div class="authority-stack">
                ${registry.entries.map(entry => this.renderJobRegistryEntry(entry)).join('')}
            </div>
        `;
    }

    private renderJobRegistryEntry(entry: AuthorityJobRegistryEntry): string {
        return `
            <div class="authority-list-card authority-list-card--column">
                <div class="authority-page-actions">
                    <strong>${escapeHtml(entry.type)}</strong>
                    <span class="authority-pill authority-pill--${entry.cancellable ? 'granted' : 'warning'}">${escapeHtml(entry.cancellable ? '可取消' : '不可取消')}</span>
                </div>
                <div class="authority-muted">${escapeHtml(entry.description)}</div>
                <div class="authority-kv-grid">
                    <div><strong>默认超时</strong><div>${escapeHtml(entry.defaultTimeoutMs == null ? '未设置' : `${entry.defaultTimeoutMs}ms`)}</div></div>
                    <div><strong>默认重试</strong><div>${escapeHtml(String(entry.defaultMaxAttempts))}</div></div>
                    <div><strong>Payload 字段</strong><div>${escapeHtml(entry.payloadFields.length === 0 ? '无' : String(entry.payloadFields.length))}</div></div>
                    <div><strong>Progress 字段</strong><div>${escapeHtml(entry.progressFields.length === 0 ? '无' : String(entry.progressFields.length))}</div></div>
                </div>
                <div class="authority-stack authority-stack--compact">
                    <div>
                        <strong>Payload</strong>
                        <div class="authority-muted">${escapeHtml(this.renderJobRegistryFieldSummary(entry.payloadFields))}</div>
                    </div>
                    <div>
                        <strong>Progress / Result</strong>
                        <div class="authority-muted">${escapeHtml(this.renderJobRegistryFieldSummary(entry.progressFields))}</div>
                    </div>
                </div>
            </div>
        `;
    }

    private renderJobRegistryFieldSummary(fields: AuthorityJobRegistryEntry['payloadFields']): string {
        if (fields.length === 0) {
            return '无字段';
        }
        return fields.map(field => `${field.name}${field.required ? '' : ' ?'}: ${field.type} — ${field.description}`).join('；');
    }

    private toggleSections(): void {
        for (const section of this.root.querySelectorAll<HTMLElement>('[data-section]')) {
            const name = section.dataset.section as CenterTab;
            section.hidden = name !== this.state.selectedTab;
        }
    }

    private loadOverviewSectionState(userHandle?: string): OverviewSectionState {
        if (!userHandle) {
            return { ...DEFAULT_OVERVIEW_SECTION_STATE };
        }

        try {
            const raw = globalThis.localStorage?.getItem(this.getOverviewSectionStateStorageKey(userHandle));
            if (!raw) {
                return { ...DEFAULT_OVERVIEW_SECTION_STATE };
            }

            const parsed = JSON.parse(raw) as Partial<OverviewSectionState>;
            return {
                governance: parsed.governance ?? DEFAULT_OVERVIEW_SECTION_STATE.governance,
                capabilityMatrix: parsed.capabilityMatrix ?? DEFAULT_OVERVIEW_SECTION_STATE.capabilityMatrix,
                recentActivity: parsed.recentActivity ?? DEFAULT_OVERVIEW_SECTION_STATE.recentActivity,
            };
        } catch {
            return { ...DEFAULT_OVERVIEW_SECTION_STATE };
        }
    }

    private setOverviewSectionOpen(key: OverviewSectionKey, isOpen: boolean): void {
        if (this.state.overviewSectionState[key] === isOpen) {
            return;
        }

        this.state.overviewSectionState = {
            ...this.state.overviewSectionState,
            [key]: isOpen,
        };
        this.persistOverviewSectionState();
    }

    private persistOverviewSectionState(): void {
        const userHandle = this.state.session?.user.handle;
        if (!userHandle) {
            return;
        }

        try {
            globalThis.localStorage?.setItem(
                this.getOverviewSectionStateStorageKey(userHandle),
                JSON.stringify(this.state.overviewSectionState),
            );
        } catch {
        }
    }

    private getOverviewSectionStateStorageKey(userHandle: string): string {
        return `${OVERVIEW_SECTION_STATE_STORAGE_KEY}:${userHandle}`;
    }

    private resolveSelectedExtensionId(): string | null {
        if (this.state.selectedExtensionId && this.state.extensions.some(item => item.id === this.state.selectedExtensionId)) {
            return this.state.selectedExtensionId;
        }
        return this.state.extensions[0]?.id ?? null;
    }

    private resolvePolicyEditorExtensionId(): string | null {
        if (this.state.policyEditorExtensionId && this.state.extensions.some(item => item.id === this.state.policyEditorExtensionId)) {
            return this.state.policyEditorExtensionId;
        }
        if (this.focusExtensionId && this.state.extensions.some(item => item.id === this.focusExtensionId)) {
            return this.focusExtensionId;
        }
        return this.state.extensions[0]?.id ?? null;
    }

    private getSelectedDetail(): ExtensionDetailResponse | null {
        if (!this.state.selectedExtensionId) {
            return null;
        }
        return this.state.details.get(this.state.selectedExtensionId) ?? null;
    }
}

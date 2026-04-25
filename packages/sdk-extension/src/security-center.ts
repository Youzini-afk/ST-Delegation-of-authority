import type {
    AuthorityPolicyEntry,
    PermissionResource,
    PermissionStatus,
    SessionInitResponse,
} from '@stdo/shared-types';
import { authorityRequest } from './api.js';
import { clearChildren, escapeHtml, formatDate } from './dom.js';
import {
    renderActivityList,
    renderCapabilityMatrix,
    renderDatabaseGroupList,
    renderDatabaseList,
    renderGrantList,
    renderJobList,
    renderKpiCard,
    renderPolicyList,
    renderStorageCard,
    renderStorageSummary,
    renderStringList,
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
    ExtensionDetailResponse,
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
            extensionFilter: '',
            policies: null,
            policyEditorExtensionId: focusExtensionId ?? null,
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

            const tabButton = target.closest<HTMLElement>('[data-tab]');
            if (tabButton) {
                const tab = tabButton.dataset.tab as CenterTab;
                if (tab !== 'policies' || this.state.isAdmin) {
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

            const extensionButton = target.closest<HTMLElement>('[data-extension-id]');
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
            this.state.extensions = extensions;
            this.state.details = new Map(detailEntries);
            this.state.selectedExtensionId = this.resolveSelectedExtensionId();
            this.state.policyEditorExtensionId = this.resolvePolicyEditorExtensionId();
            this.state.policies = this.state.isAdmin
                ? await authorityRequest<PoliciesResponse>('/admin/policies')
                : null;

            if (!this.state.isAdmin && this.state.selectedTab === 'policies') {
                this.state.selectedTab = 'overview';
            }
        } catch (error) {
            this.state.error = error instanceof Error ? error.message : String(error);
        } finally {
            this.state.loading = false;
            void this.render();
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
            status.innerHTML = '<div class="authority-inline-note">正在同步权限中心状态、扩展记录与策略数据...</div>';
            return;
        }

        if (this.state.error) {
            status.innerHTML = `<div class="authority-inline-note authority-inline-note--error">${escapeHtml(getSystemMessageLabel(this.state.error))}</div>`;
            return;
        }

        const user = this.state.session?.user;
        const databases = getDatabaseGroupSummaries(this.state.extensions, this.state.details);
        const databaseCount = databases.reduce((sum, item) => sum + item.databases.length, 0);
        const issueCount = [...this.state.details.values()].flatMap(detail => detail.activity.errors).length;
        const activeJobCount = [...this.state.details.values()]
            .flatMap(detail => detail.jobs)
            .filter(job => job.status === 'queued' || job.status === 'running').length;
        const core = this.state.probe?.core;
        status.innerHTML = `
            <div class="authority-summary-strip">
                ${renderKpiCard('当前用户', user?.handle ?? '未识别', user?.isAdmin ? '管理员模式' : '普通用户模式')}
                ${renderKpiCard('扩展数量', String(this.state.extensions.length), '已接入的扩展')}
                ${renderKpiCard('数据库数量', String(databaseCount), '当前用户的私有数据库')}
                ${renderKpiCard('活跃任务', String(activeJobCount), '排队中 / 执行中')}
                ${renderKpiCard('后台服务', getCoreStateLabel(core?.state), core?.port ? `127.0.0.1:${core.port}` : '端口未分配')}
                ${renderKpiCard('错误记录', String(issueCount), '最近聚合错误')}
            </div>
            ${this.state.probe ? `<div class="authority-inline-note">接入状态 ${escapeHtml(getInstallStatusLabel(this.state.probe.installStatus))} · 插件版本 ${escapeHtml(this.state.probe.pluginVersion || MISSING_TEXT)} · 后台服务 ${escapeHtml(this.state.probe.core.version ?? MISSING_TEXT)} · 支持平台 ${escapeHtml(this.state.probe.coreArtifactPlatforms?.join('、') || MISSING_TEXT)}</div>` : ''}
            ${this.state.probe?.installMessage ? `<div class="authority-inline-note">${escapeHtml(getSystemMessageLabel(this.state.probe.installMessage))}</div>` : ''}
            ${this.state.probe?.coreMessage ? `<div class="authority-inline-note authority-inline-note--warning">${escapeHtml(getSystemMessageLabel(this.state.probe.coreMessage))}</div>` : ''}
            ${this.state.probe?.core.lastError ? `<div class="authority-inline-note authority-inline-note--error">${escapeHtml(getSystemMessageLabel(this.state.probe.core.lastError))}</div>` : ''}
        `;
    }

    private renderTabs(): void {
        for (const tab of this.root.querySelectorAll<HTMLElement>('[data-tab]')) {
            const tabName = tab.dataset.tab as CenterTab;
            tab.classList.toggle('authority-tab--active', tabName === this.state.selectedTab);
            tab.hidden = tabName === 'policies' && !this.state.isAdmin;
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
            const errorCount = detail?.activity.errors.length ?? 0;
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
                    ${errorCount > 0 ? `<span class="authority-pill authority-pill--error">错误 ${errorCount}</span>` : ''}
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

        container.innerHTML = `
            <div class="authority-kpi-grid">
                ${renderKpiCard('扩展数量', String(this.state.extensions.length), '已注册扩展')}
                ${renderKpiCard('授权记录', String(overview.totalGrantCount), '允许与拒绝合计')}
                ${renderKpiCard('策略覆盖', String(overview.totalPolicyCount), '默认与扩展覆盖')}
                ${renderKpiCard('活跃任务', String(overview.activeJobs.length), '排队中 / 执行中')}
                ${renderKpiCard('数据库体积', formatBytes(overview.totalDatabaseSize), `${overview.totalDatabaseCount} 个数据库`)}
                ${renderKpiCard('最近错误', String(overview.recentErrors.length), '需要排查的异常')}
            </div>
            <div class="authority-dashboard-grid">
                <section class="authority-card authority-runtime-card">
                    <div class="authority-card__header">
                        <div class="authority-card__title">
                            <h3>运行状态</h3>
                            <div class="authority-muted">接入状态、后台服务与支持平台</div>
                        </div>
                        <span class="authority-pill authority-pill--${escapeHtml(core?.state ?? 'starting')}">${escapeHtml(getCoreStateLabel(core?.state))}</span>
                    </div>
                    <div class="authority-kv-grid">
                        <div><strong>插件版本</strong><div>${escapeHtml(this.state.probe?.pluginVersion ?? MISSING_TEXT)}</div></div>
                        <div><strong>接入状态</strong><div>${escapeHtml(this.state.probe ? getInstallStatusLabel(this.state.probe.installStatus) : MISSING_TEXT)}</div></div>
                        <div><strong>后台服务校验</strong><div>${escapeHtml(this.state.probe?.coreVerified ? '已通过' : '未通过')}</div></div>
                        <div><strong>当前平台</strong><div>${escapeHtml(this.state.probe?.coreArtifactPlatform ?? MISSING_TEXT)}</div></div>
                        <div><strong>支持平台</strong><div>${escapeHtml(this.state.probe?.coreArtifactPlatforms?.join('、') || MISSING_TEXT)}</div></div>
                        <div><strong>后台服务状态</strong><div>${escapeHtml(getCoreStateLabel(core?.state))}</div></div>
                        <div><strong>进程号</strong><div>${escapeHtml(core?.pid !== null && core?.pid !== undefined ? String(core.pid) : MISSING_TEXT)}</div></div>
                        <div><strong>监听端口</strong><div>${escapeHtml(core?.port !== null && core?.port !== undefined ? String(core.port) : MISSING_TEXT)}</div></div>
                        <div><strong>启动时间</strong><div>${escapeHtml(core?.startedAt ? formatDate(core.startedAt) : MISSING_TEXT)}</div></div>
                        <div><strong>处理请求数</strong><div>${escapeHtml(core?.health ? String(core.health.requestCount) : MISSING_TEXT)}</div></div>
                        <div><strong>累计错误数</strong><div>${escapeHtml(core?.health ? String(core.health.errorCount) : MISSING_TEXT)}</div></div>
                        <div><strong>运行中任务</strong><div>${escapeHtml(core?.health ? String(core.health.activeJobCount) : MISSING_TEXT)}</div></div>
                    </div>
                </section>
                <section class="authority-card">
                    <div class="authority-card__title">
                        <h3>能力矩阵</h3>
                        <div class="authority-muted">当前可由权限中心管理的系统能力</div>
                    </div>
                    ${renderCapabilityMatrix(RESOURCE_OPTIONS)}
                </section>
                <section class="authority-card">
                    <div class="authority-card__title">
                        <h3>存储汇总</h3>
                        <div class="authority-muted">键值数据、文件、数据库与私有文件汇总</div>
                    </div>
                    <div class="authority-storage-grid">
                        ${renderStorageCard('键值条目', String(this.state.extensions.reduce((sum, item) => sum + item.storage.kvEntries, 0)), '扩展保存的键值数据')}
                        ${renderStorageCard('文件体积', formatBytes(overview.totalBlobBytes), '扩展保存的文件')}
                        ${renderStorageCard('数据库体积', formatBytes(overview.totalDatabaseSize), `${overview.totalDatabaseCount} 个数据库`)}
                        ${renderStorageCard('私有文件体积', formatBytes(overview.totalPrivateFileBytes), '仅统计私有文件区')}
                    </div>
                </section>
                <section class="authority-card">
                    <div class="authority-card__title">
                        <h3>最近活动</h3>
                        <div class="authority-muted">权限请求、能力调用与错误</div>
                    </div>
                    ${renderActivityList(overview.recentActivity, '暂无活动记录。')}
                </section>
                <section class="authority-card">
                    <h3>私有数据库概览</h3>
                    ${renderDatabaseGroupList(overview.databaseGroups.slice(0, 6), '当前没有发现扩展私有数据库。')}
                </section>
                <section class="authority-card">
                    <h3>活跃任务</h3>
                    ${renderJobList(overview.activeJobs, '当前没有排队或运行中的任务。')}
                </section>
                <section class="authority-card">
                    <h3>失败任务</h3>
                    ${renderJobList(overview.failedJobs, '当前没有失败或取消的任务。')}
                </section>
                <section class="authority-card">
                    <h3>最近错误</h3>
                    ${renderActivityList(overview.recentErrors, '暂无错误记录。')}
                </section>
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
        const denied = detail.grants.filter(item => item.status === 'denied');
        const permissions = [...detail.activity.permissions].sort(sortByTimestampDesc).slice(0, 10);
        const usage = [...detail.activity.usage].sort(sortByTimestampDesc).slice(0, 10);
        const errors = [...detail.activity.errors].sort(sortByTimestampDesc).slice(0, 10);
        const jobs = [...detail.jobs].sort((left, right) => right.updatedAt.localeCompare(left.updatedAt)).slice(0, 10);
        const databases = [...detail.databases].sort((left, right) => right.updatedAt.localeCompare(left.updatedAt));
        const storage = detail.storage;
        const risk = getExtensionRiskLevel(detail.extension);

        container.innerHTML = `
            <div class="authority-card-grid">
                <section class="authority-card authority-card--wide authority-card--accent">
                    <div class="authority-hero">
                        <div>
                            <div class="authority-eyebrow">扩展详情</div>
                            <div class="authority-hero__title">${escapeHtml(detail.extension.displayName)}</div>
                            <div class="authority-muted">${escapeHtml(detail.extension.id)}</div>
                            <div class="authority-chip-row">
                                <span class="authority-pill authority-pill--${risk}">${escapeHtml(getRiskLabel(risk))}</span>
                                <span class="authority-pill authority-pill--medium">${escapeHtml(getInstallTypeLabel(detail.extension.installType))}</span>
                                <span class="authority-pill authority-pill--prompt">v${escapeHtml(detail.extension.version)}</span>
                            </div>
                        </div>
                        <button type="button" class="menu_button authority-primary-action" data-action="reset-all-grants" data-extension-id="${escapeHtml(detail.extension.id)}">重置全部授权</button>
                    </div>
                    <div class="authority-kv-grid">
                        <div><strong>首次见到</strong><div>${escapeHtml(formatDate(detail.extension.firstSeenAt))}</div></div>
                        <div><strong>最近活跃</strong><div>${escapeHtml(formatDate(detail.extension.lastSeenAt))}</div></div>
                        <div><strong>授权记录</strong><div>${detail.grants.length}</div></div>
                        <div><strong>策略覆盖</strong><div>${detail.policies.length}</div></div>
                        <div><strong>数据库</strong><div>${detail.databases.length}</div></div>
                        <div><strong>后台任务</strong><div>${detail.jobs.length}</div></div>
                    </div>
                </section>
                <section class="authority-card">
                    <div class="authority-card__title">
                        <h3>资源占用</h3>
                        <div class="authority-muted">键值数据、文件、数据库与私有文件区</div>
                    </div>
                    ${renderStorageSummary(storage)}
                </section>
                <section class="authority-card">
                    <div class="authority-card__title">
                        <h3>声明权限</h3>
                        <div class="authority-muted">扩展初始化时声明的能力范围</div>
                    </div>
                    ${renderStringList(getDeclaredPermissionLabels(detail.extension.declaredPermissions), '该扩展还没有声明任何权限。')}
                </section>
                <section class="authority-card">
                    <div class="authority-card__title">
                        <h3>当前授权</h3>
                        <div class="authority-muted">用户已允许的持久授权</div>
                    </div>
                    ${renderGrantList(detail.extension.id, granted, '当前没有已授予的持久化授权。')}
                </section>
                <section class="authority-card">
                    <div class="authority-card__title">
                        <h3>被拒绝权限</h3>
                        <div class="authority-muted">用户拒绝或管理员封锁的请求</div>
                    </div>
                    ${renderGrantList(detail.extension.id, denied, '当前没有持久化拒绝记录。')}
                </section>
                <section class="authority-card">
                    <div class="authority-card__title">
                        <h3>策略覆盖</h3>
                        <div class="authority-muted">管理员针对该扩展设置的覆盖规则</div>
                    </div>
                    ${renderPolicyList(detail.policies, '当前没有针对该扩展的策略覆盖。')}
                </section>
                <section class="authority-card">
                    <div class="authority-card__title">
                        <h3>私有数据库</h3>
                        <div class="authority-muted">该扩展创建的私有数据库</div>
                    </div>
                    ${renderDatabaseList(databases, '该扩展还没有私有数据库。')}
                </section>
                <section class="authority-card">
                    <div class="authority-card__title">
                        <h3>最近权限活动</h3>
                        <div class="authority-muted">权限请求与决策轨迹</div>
                    </div>
                    ${renderActivityList(permissions, '暂无权限活动。')}
                </section>
                <section class="authority-card">
                    <div class="authority-card__title">
                        <h3>最近能力调用</h3>
                        <div class="authority-muted">扩展调用系统能力的最近记录</div>
                    </div>
                    ${renderActivityList(usage, '暂无能力调用记录。')}
                </section>
                <section class="authority-card">
                    <div class="authority-card__title">
                        <h3>最近任务</h3>
                        <div class="authority-muted">后台任务队列状态</div>
                    </div>
                    ${renderJobList(jobs, '暂无后台任务。')}
                </section>
                <section class="authority-card">
                    <div class="authority-card__title">
                        <h3>最近错误</h3>
                        <div class="authority-muted">需要排查的内部异常</div>
                    </div>
                    ${renderActivityList(errors, '暂无内部错误记录。')}
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
        const totalDatabaseCount = databaseGroups.reduce((sum, item) => sum + item.databases.length, 0);
        const totalDatabaseSize = databaseGroups.reduce((sum, item) => sum + item.totalSizeBytes, 0);

        container.innerHTML = `
            <section class="authority-card">
                <div class="authority-card__header">
                    <div>
                        <h3>扩展私有数据库</h3>
                        <div class="authority-muted">按扩展汇总当前用户的私有数据库文件。</div>
                    </div>
                    <div class="authority-list-card__actions">
                        <span class="authority-pill authority-pill--prompt">${totalDatabaseCount} 个数据库</span>
                        <span class="authority-pill authority-pill--prompt">${escapeHtml(formatBytes(totalDatabaseSize))}</span>
                    </div>
                </div>
                ${renderDatabaseGroupList(databaseGroups, '当前没有发现任何扩展私有数据库。')}
            </section>
        `;
    }

    private async renderActivitySection(): Promise<void> {
        const container = this.root.querySelector<HTMLElement>('[data-role="activity-view"]');
        if (!container) {
            return;
        }

        const items = [...this.state.details.values()]
            .flatMap(detail => [...detail.activity.permissions, ...detail.activity.usage, ...detail.activity.errors])
            .sort(sortByTimestampDesc)
            .slice(0, 40);
        const errors = [...this.state.details.values()]
            .flatMap(detail => detail.activity.errors)
            .sort(sortByTimestampDesc)
            .slice(0, 20);

        container.innerHTML = `
            <div class="authority-card-grid">
                <section class="authority-card">
                    <h3>最近活动</h3>
                    ${renderActivityList(items, '暂无活动记录。')}
                </section>
                <section class="authority-card">
                    <h3>错误排障</h3>
                    ${renderActivityList(errors, '暂无错误记录。')}
                </section>
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
            <div class="authority-inline-note authority-inline-note--warning">管理员策略会覆盖扩展请求与用户授权。请谨慎将高风险能力设置为默认允许。</div>
            <div class="authority-policy-layout">
                <section class="authority-card">
                    <div class="authority-card__title">
                        <h3>全局默认权限</h3>
                        <div class="authority-muted">为每类能力设置默认处理方式</div>
                    </div>
                    <div class="authority-policy-defaults">
                        ${RESOURCE_OPTIONS.map(resource => `
                            <label class="authority-policy-default-row">
                                <span>
                                    <strong>${escapeHtml(getResourceLabel(resource))}</strong>
                                    <div class="authority-muted">${escapeHtml(resource)}</div>
                                </span>
                                <span class="authority-pill authority-pill--${getRiskLevel(resource)}">${escapeHtml(getRiskLabel(getRiskLevel(resource)))}</span>
                                <select data-policy-default="${escapeHtml(resource)}">
                                    ${STATUS_OPTIONS.map(status => `<option value="${status}" ${policies.defaults[resource] === status ? 'selected' : ''}>${escapeHtml(getStatusLabel(status))}</option>`).join('')}
                                </select>
                            </label>
                        `).join('')}
                    </div>
                </section>
                <section class="authority-card">
                    <div class="authority-card__header">
                        <div>
                            <h3>扩展单独规则</h3>
                            <div class="authority-muted">按扩展和目标覆盖全局默认设置</div>
                        </div>
                        <button type="button" class="menu_button" data-action="save-policies">保存策略</button>
                    </div>
                    <label class="authority-policy-field">
                        <span>编辑扩展</span>
                        <select data-policy-editor-extension>
                            ${this.state.extensions.map(extension => `<option value="${escapeHtml(extension.id)}" ${extension.id === extensionId ? 'selected' : ''}>${escapeHtml(extension.displayName)}</option>`).join('')}
                        </select>
                    </label>
                    <div class="authority-policy-rows" data-role="policy-rows">
                        ${overrides.map(entry => this.buildPolicyRowMarkup(entry)).join('')}
                    </div>
                    <div class="authority-policy-actions">
                        <button type="button" class="menu_button" data-action="add-policy-row">新增覆盖规则</button>
                        <div class="authority-muted">最后更新：${escapeHtml(formatDate(policies.updatedAt))}</div>
                    </div>
                    <div class="authority-card authority-card--warning">
                        <div class="authority-card__title">
                            <h3>生效预览</h3>
                            <div class="authority-muted">扩展单独规则优先于全局默认设置；封锁会直接拒绝请求。</div>
                        </div>
                        <div class="authority-chip-row">
                            <span class="authority-pill authority-pill--prompt">默认询问</span>
                            <span class="authority-pill authority-pill--granted">允许并记住</span>
                            <span class="authority-pill authority-pill--blocked">管理员封锁</span>
                        </div>
                    </div>
                </section>
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

    private toggleSections(): void {
        for (const section of this.root.querySelectorAll<HTMLElement>('[data-section]')) {
            const name = section.dataset.section as CenterTab;
            section.hidden = name !== this.state.selectedTab;
        }
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

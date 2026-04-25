import type {
    AuthorityGrant,
    AuthorityInitConfig,
    AuthorityPolicyEntry,
    ControlExtensionRecord,
    DeclaredPermissions,
    JobRecord,
    PrivateFileUsageSummary,
    PermissionResource,
    PermissionStatus,
    SessionInitResponse,
    SqlDatabaseRecord,
} from '@stdo/shared-types';
import { Popup, POPUP_TYPE } from '/scripts/popup.js';
import { renderExtensionTemplateAsync } from '/scripts/extensions.js';
import {
    AUTHORITY_EXTENSION_DISPLAY_NAME,
    AUTHORITY_EXTENSION_ID,
    AUTHORITY_EXTENSION_NAME,
    AUTHORITY_EXTENSION_VERSION,
    authorityRequest,
} from './api.js';
import { clearChildren, escapeHtml, formatDate, formatJson, htmlToElement, waitForElement } from './dom.js';

type CenterTab = 'overview' | 'detail' | 'databases' | 'activity' | 'policies';
const POPUP_TEXT_TYPE = POPUP_TYPE.TEXT ?? 0;

interface ActivityRecord {
    timestamp: string;
    kind: 'permission' | 'usage' | 'error';
    extensionId: string;
    message: string;
    details?: Record<string, unknown>;
}

interface ExtensionSummary extends ControlExtensionRecord {
    grantedCount: number;
    deniedCount: number;
    storage: ExtensionStorageSummary;
}

interface ExtensionStorageSummary {
    kvEntries: number;
    blobCount: number;
    blobBytes: number;
    databaseCount: number;
    databaseBytes: number;
    files: PrivateFileUsageSummary;
}

interface ProbeResponse {
    pluginVersion: string;
    sdkBundledVersion: string;
    sdkDeployedVersion: string | null;
    coreBundledVersion: string | null;
    coreArtifactPlatform: string | null;
    coreArtifactPlatforms: string[];
    coreArtifactHash: string | null;
    coreBinarySha256: string | null;
    coreVerified: boolean;
    coreMessage: string | null;
    installStatus: string;
    installMessage: string;
    core: {
        enabled: boolean;
        state: string;
        port: number | null;
        pid: number | null;
        version: string | null;
        startedAt: string | null;
        lastError: string | null;
        health: {
            name: string;
            apiVersion: string;
            version: string;
            pid: number;
            startedAt: string;
            uptimeMs: number;
            requestCount: number;
            errorCount: number;
            activeJobCount: number;
            limits: {
                maxRequestBytes: number;
                maxKvValueBytes: number;
                maxBlobBytes: number;
                maxHttpBodyBytes: number;
                maxHttpResponseBytes: number;
                maxEventPollLimit: number;
            };
        } | null;
    };
}

interface ExtensionDetailResponse {
    extension: ControlExtensionRecord;
    grants: AuthorityGrant[];
    policies: AuthorityPolicyEntry[];
    activity: {
        permissions: ActivityRecord[];
        usage: ActivityRecord[];
        errors: ActivityRecord[];
    };
    jobs: JobRecord[];
    databases: SqlDatabaseRecord[];
    storage: ExtensionStorageSummary;
}

interface DatabaseGroupSummary {
    extension: ExtensionSummary;
    databases: SqlDatabaseRecord[];
    totalSizeBytes: number;
    latestUpdatedAt: string | null;
}

interface PoliciesResponse {
    defaults: Record<PermissionResource, PermissionStatus>;
    extensions: Record<string, Record<string, AuthorityPolicyEntry>>;
    updatedAt: string;
}

interface SecurityCenterState {
    loading: boolean;
    error: string | null;
    isAdmin: boolean;
    probe: ProbeResponse | null;
    session: SessionInitResponse | null;
    extensions: ExtensionSummary[];
    details: Map<string, ExtensionDetailResponse>;
    selectedExtensionId: string | null;
    selectedTab: CenterTab;
    extensionFilter: string;
    policies: PoliciesResponse | null;
    policyEditorExtensionId: string | null;
}

const SECURITY_CENTER_CONFIG: AuthorityInitConfig = {
    extensionId: AUTHORITY_EXTENSION_ID,
    displayName: AUTHORITY_EXTENSION_DISPLAY_NAME,
    version: AUTHORITY_EXTENSION_VERSION,
    installType: 'local',
    declaredPermissions: {},
    uiLabel: 'Authority Security Center',
};

const RESOURCE_OPTIONS: PermissionResource[] = ['storage.kv', 'storage.blob', 'fs.private', 'sql.private', 'http.fetch', 'jobs.background', 'events.stream'];
const STATUS_OPTIONS: PermissionStatus[] = ['prompt', 'granted', 'denied', 'blocked'];

let bootPromise: Promise<void> | null = null;

export function bootstrapSecurityCenter(): Promise<void> {
    if (!bootPromise) {
        bootPromise = doBootstrapSecurityCenter();
    }
    return bootPromise;
}

export async function openSecurityCenter(options: { focusExtensionId?: string } = {}): Promise<void> {
    const html = await renderExtensionTemplateAsync(AUTHORITY_EXTENSION_NAME, 'security-center', {}, false, false);
    const root = htmlToElement(html);
    const view = new SecurityCenterView(root, options.focusExtensionId);

    const popup = new Popup(root, POPUP_TEXT_TYPE, '', {
        okButton: '关闭',
        wide: true,
        large: true,
        allowVerticalScrolling: true,
        onOpen: () => view.initialize(),
    });

    await popup.show();
}

async function doBootstrapSecurityCenter(): Promise<void> {
    try {
        const menu = await waitForElement('#extensionsMenu');
        if (menu.querySelector('#authority-security-center-button')) {
            return;
        }

        const html = await renderExtensionTemplateAsync(AUTHORITY_EXTENSION_NAME, 'menu-button', {}, false, false);
        const button = htmlToElement(html);
        button.addEventListener('click', () => void openSecurityCenter());
        menu.appendChild(button);
    } catch (error) {
        console.warn('Authority Security Center menu bootstrap failed:', error);
    }
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
            toastr.success('授权已重置', 'Authority');
            await this.refresh();
        } catch (error) {
            toastr.error(error instanceof Error ? error.message : String(error), 'Authority');
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
            toastr.success('管理员策略已保存', 'Authority');
            await this.refresh();
        } catch (error) {
            toastr.error(error instanceof Error ? error.message : String(error), 'Authority');
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
                <span class="authority-pill authority-pill--${escapeHtml(probe?.installStatus ?? 'prompt')}">SDK ${escapeHtml(probe ? getInstallStatusLabel(probe.installStatus) : '同步中')}</span>
                <span class="authority-pill authority-pill--${escapeHtml(probe?.core.state ?? 'starting')}">Core ${escapeHtml(getCoreStateLabel(probe?.core.state))}</span>
                <span class="authority-pill authority-pill--medium">${escapeHtml(probe?.coreArtifactPlatform ?? 'platform')}</span>
                <span class="authority-pill authority-pill--admin">${escapeHtml(this.state.isAdmin ? 'Admin Mode' : 'User Mode')}</span>
            `;
        }

        if (this.state.loading) {
            status.innerHTML = '<div class="authority-inline-note">正在同步 Authority 状态、扩展记录与策略数据...</div>';
            return;
        }

        if (this.state.error) {
            status.innerHTML = `<div class="authority-inline-note authority-inline-note--error">${escapeHtml(this.state.error)}</div>`;
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
                ${renderKpiCard('当前用户', user?.handle ?? 'unknown', user?.isAdmin ? '管理员模式' : '普通用户模式')}
                ${renderKpiCard('扩展数量', String(this.state.extensions.length), '已注册 Authority 扩展')}
                ${renderKpiCard('数据库数量', String(databaseCount), '当前用户私有 SQL')}
                ${renderKpiCard('活跃任务', String(activeJobCount), 'queued / running')}
                ${renderKpiCard('Core 状态', getCoreStateLabel(core?.state), core?.port ? `127.0.0.1:${core.port}` : '端口未分配')}
                ${renderKpiCard('错误记录', String(issueCount), '最近聚合错误')}
            </div>
            ${this.state.probe ? `<div class="authority-inline-note">SDK ${escapeHtml(getInstallStatusLabel(this.state.probe.installStatus))} · 插件 ${escapeHtml(this.state.probe.pluginVersion)} · Core ${escapeHtml(this.state.probe.core.version ?? 'unknown')} · 平台 ${escapeHtml(this.state.probe.coreArtifactPlatforms?.join(', ') || 'unknown')}</div>` : ''}
            ${this.state.probe?.installMessage ? `<div class="authority-inline-note">${escapeHtml(this.state.probe.installMessage)}</div>` : ''}
            ${this.state.probe?.coreMessage ? `<div class="authority-inline-note authority-inline-note--warning">${escapeHtml(this.state.probe.coreMessage)}</div>` : ''}
            ${this.state.probe?.core.lastError ? `<div class="authority-inline-note authority-inline-note--error">${escapeHtml(this.state.probe.core.lastError)}</div>` : ''}
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
            container.innerHTML = '<div class="authority-empty">还没有扩展通过 Authority 完成初始化。</div>';
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

        const databaseGroups = getDatabaseGroupSummaries(this.state.extensions, this.state.details);
        const totalDatabaseCount = databaseGroups.reduce((sum, item) => sum + item.databases.length, 0);
        const totalDatabaseSize = databaseGroups.reduce((sum, item) => sum + item.totalSizeBytes, 0);
        const allJobs = [...this.state.details.values()]
            .flatMap(detail => detail.jobs)
            .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt));
        const activeJobs = allJobs.filter(item => item.status === 'queued' || item.status === 'running').slice(0, 8);
        const failedJobs = allJobs.filter(item => item.status === 'failed' || item.status === 'cancelled').slice(0, 8);
        const recentErrors = [...this.state.details.values()]
            .flatMap(detail => detail.activity.errors)
            .sort(sortByTimestampDesc)
            .slice(0, 8);
        const totalGrantCount = [...this.state.details.values()].reduce((sum, detail) => sum + detail.grants.length, 0);
        const totalPolicyCount = [...this.state.details.values()].reduce((sum, detail) => sum + detail.policies.length, 0);
        const core = this.state.probe?.core;
        const totalBlobBytes = this.state.extensions.reduce((sum, item) => sum + item.storage.blobBytes, 0);
        const totalPrivateFileBytes = this.state.extensions.reduce((sum, item) => sum + item.storage.files.totalSizeBytes, 0);
        const recentActivity = [...this.state.details.values()]
            .flatMap(detail => [...detail.activity.permissions, ...detail.activity.usage, ...detail.activity.errors])
            .sort(sortByTimestampDesc)
            .slice(0, 8);

        container.innerHTML = `
            <div class="authority-kpi-grid">
                ${renderKpiCard('扩展数量', String(this.state.extensions.length), '已注册扩展')}
                ${renderKpiCard('授权记录', String(totalGrantCount), '允许与拒绝合计')}
                ${renderKpiCard('策略覆盖', String(totalPolicyCount), '默认与扩展覆盖')}
                ${renderKpiCard('活跃任务', String(activeJobs.length), 'queued / running')}
                ${renderKpiCard('数据库体积', formatBytes(totalDatabaseSize), `${totalDatabaseCount} 个数据库`)}
                ${renderKpiCard('最近错误', String(recentErrors.length), '需要排查的异常')}
            </div>
            <div class="authority-dashboard-grid">
                <section class="authority-card authority-runtime-card">
                    <div class="authority-card__header">
                        <div class="authority-card__title">
                            <h3>运行状态</h3>
                            <div class="authority-muted">插件安装、core 运行时与内置平台</div>
                        </div>
                        <span class="authority-pill authority-pill--${escapeHtml(core?.state ?? 'starting')}">${escapeHtml(getCoreStateLabel(core?.state))}</span>
                    </div>
                    <div class="authority-kv-grid">
                        <div><strong>插件版本</strong><div>${escapeHtml(this.state.probe?.pluginVersion ?? 'unknown')}</div></div>
                        <div><strong>SDK 部署</strong><div>${escapeHtml(this.state.probe ? getInstallStatusLabel(this.state.probe.installStatus) : 'unknown')}</div></div>
                        <div><strong>Core 分发</strong><div>${escapeHtml(this.state.probe?.coreVerified ? '已校验' : '未校验')}</div></div>
                        <div><strong>Core 目标平台</strong><div>${escapeHtml(this.state.probe?.coreArtifactPlatform ?? 'unknown')}</div></div>
                        <div><strong>Core 内置平台</strong><div>${escapeHtml(this.state.probe?.coreArtifactPlatforms?.join(', ') || 'unknown')}</div></div>
                        <div><strong>Core 运行态</strong><div>${escapeHtml(getCoreStateLabel(core?.state))}</div></div>
                        <div><strong>Core PID</strong><div>${escapeHtml(core?.pid ? String(core.pid) : 'n/a')}</div></div>
                        <div><strong>Core 端口</strong><div>${escapeHtml(core?.port ? String(core.port) : 'n/a')}</div></div>
                        <div><strong>Core 启动时间</strong><div>${escapeHtml(core?.startedAt ? formatDate(core.startedAt) : 'n/a')}</div></div>
                        <div><strong>Core 请求数</strong><div>${escapeHtml(core?.health ? String(core.health.requestCount) : 'n/a')}</div></div>
                        <div><strong>Core 错误数</strong><div>${escapeHtml(core?.health ? String(core.health.errorCount) : 'n/a')}</div></div>
                        <div><strong>Core 活跃任务</strong><div>${escapeHtml(core?.health ? String(core.health.activeJobCount) : 'n/a')}</div></div>
                    </div>
                </section>
                <section class="authority-card">
                    <div class="authority-card__title">
                        <h3>能力矩阵</h3>
                        <div class="authority-muted">当前 Authority 可治理的服务端能力</div>
                    </div>
                    ${renderCapabilityMatrix(RESOURCE_OPTIONS)}
                </section>
                <section class="authority-card">
                    <div class="authority-card__title">
                        <h3>存储汇总</h3>
                        <div class="authority-muted">KV、Blob、SQL 与私有文件夹聚合</div>
                    </div>
                    <div class="authority-storage-grid">
                        ${renderStorageCard('KV 条目', String(this.state.extensions.reduce((sum, item) => sum + item.storage.kvEntries, 0)), '扩展键值状态')}
                        ${renderStorageCard('Blob 体积', formatBytes(totalBlobBytes), '二进制对象存储')}
                        ${renderStorageCard('SQL 体积', formatBytes(totalDatabaseSize), `${totalDatabaseCount} 个数据库`)}
                        ${renderStorageCard('私有文件', formatBytes(totalPrivateFileBytes), 'fs.private 作用域')}
                    </div>
                </section>
                <section class="authority-card">
                    <div class="authority-card__title">
                        <h3>最近活动</h3>
                        <div class="authority-muted">权限请求、能力调用与错误</div>
                    </div>
                    ${renderActivityList(recentActivity, '暂无活动记录。')}
                </section>
                <section class="authority-card">
                    <h3>SQL 数据库概览</h3>
                    ${renderDatabaseGroupList(databaseGroups.slice(0, 6), '当前没有发现扩展 SQL 数据库。')}
                </section>
                <section class="authority-card">
                    <h3>活跃任务</h3>
                    ${renderJobList(activeJobs, '当前没有排队或运行中的任务。')}
                </section>
                <section class="authority-card">
                    <h3>失败任务</h3>
                    ${renderJobList(failedJobs, '当前没有失败或取消的任务。')}
                </section>
                <section class="authority-card">
                    <h3>最近错误</h3>
                    ${renderActivityList(recentErrors, '暂无错误记录。')}
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
                            <div class="authority-eyebrow">Extension Detail</div>
                            <div class="authority-hero__title">${escapeHtml(detail.extension.displayName)}</div>
                            <div class="authority-muted">${escapeHtml(detail.extension.id)}</div>
                            <div class="authority-chip-row">
                                <span class="authority-pill authority-pill--${risk}">${escapeHtml(getRiskLabel(risk))}</span>
                                <span class="authority-pill authority-pill--medium">${escapeHtml(detail.extension.installType)}</span>
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
                        <div class="authority-muted">KV、Blob、SQL 与 fs.private</div>
                    </div>
                    ${renderStorageSummary(storage)}
                </section>
                <section class="authority-card">
                    <div class="authority-card__title">
                        <h3>声明权限</h3>
                        <div class="authority-muted">扩展初始化时声明的能力范围</div>
                    </div>
                    ${renderStringList(getDeclaredPermissionLabels(detail.extension.declaredPermissions), '该扩展尚未声明任何 Authority 权限。')}
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
                        <h3>SQL 数据库</h3>
                        <div class="authority-muted">该扩展创建的私有数据库</div>
                    </div>
                    ${renderDatabaseList(databases, '该扩展还没有私有 SQL 数据库。')}
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
                        <div class="authority-muted">SDK 到服务端能力的使用记录</div>
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
                        <h3>扩展 SQL 数据库</h3>
                        <div class="authority-muted">按扩展汇总当前用户的 private SQL 数据库文件。</div>
                    </div>
                    <div class="authority-list-card__actions">
                        <span class="authority-pill authority-pill--prompt">${totalDatabaseCount} 个数据库</span>
                        <span class="authority-pill authority-pill--prompt">${escapeHtml(formatBytes(totalDatabaseSize))}</span>
                    </div>
                </div>
                ${renderDatabaseGroupList(databaseGroups, '当前没有发现任何扩展 SQL 数据库。')}
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
                        <h3>全局默认权限矩阵</h3>
                        <div class="authority-muted">设置每类 Authority 能力的默认决策</div>
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
                            <h3>扩展覆盖策略</h3>
                            <div class="authority-muted">按扩展和目标维度覆盖默认策略</div>
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
                            <div class="authority-muted">扩展覆盖优先于全局默认策略；blocked 会直接封锁请求。</div>
                        </div>
                        <div class="authority-chip-row">
                            <span class="authority-pill authority-pill--prompt">默认询问</span>
                            <span class="authority-pill authority-pill--granted">允许后持久化</span>
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
                <input data-policy-field="target" type="text" value="${escapeHtml(entry?.target ?? '*')}" placeholder="目标，如 hostname 或 channel" />
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

function renderKpiCard(label: string, value: string, meta: string): string {
    return `
        <div class="authority-kpi-card">
            <div class="authority-kpi-card__label">${escapeHtml(label)}</div>
            <div class="authority-kpi-card__value">${escapeHtml(value)}</div>
            <div class="authority-kpi-card__meta">${escapeHtml(meta)}</div>
        </div>
    `;
}

function renderStorageCard(label: string, value: string, meta: string): string {
    return `
        <div class="authority-storage-card">
            <div class="authority-storage-card__label">${escapeHtml(label)}</div>
            <div class="authority-storage-card__value">${escapeHtml(value)}</div>
            <div class="authority-storage-card__meta">${escapeHtml(meta)}</div>
        </div>
    `;
}

function renderCapabilityMatrix(resources: PermissionResource[]): string {
    return `
        <div class="authority-capability-grid">
            ${resources.map(resource => {
        const risk = getRiskLevel(resource);
        return `
                    <div class="authority-capability-chip">
                        <strong>${escapeHtml(resource)}</strong>
                        <div class="authority-chip-row">
                            <span class="authority-pill authority-pill--${risk}">${escapeHtml(getRiskLabel(risk))}</span>
                            <span class="authority-pill authority-pill--usage">${escapeHtml(getResourceLabel(resource))}</span>
                        </div>
                    </div>
                `;
    }).join('')}
        </div>
    `;
}

function renderStringList(items: string[], emptyText: string): string {
    if (items.length === 0) {
        return `<div class="authority-empty">${escapeHtml(emptyText)}</div>`;
    }
    return `<div class="authority-chip-row">${items.map(item => `<span class="authority-pill authority-pill--prompt">${escapeHtml(item)}</span>`).join('')}</div>`;
}

function renderGrantList(extensionId: string, grants: AuthorityGrant[], emptyText: string): string {
    if (grants.length === 0) {
        return `<div class="authority-empty">${escapeHtml(emptyText)}</div>`;
    }
    return `
        <div class="authority-stack">
            ${grants.map(grant => `
                <div class="authority-list-card">
                    <div>
                        <strong>${escapeHtml(getResourceLabel(grant.resource))}</strong>
                        <div class="authority-muted">${escapeHtml(grant.target)}</div>
                    </div>
                    <div class="authority-list-card__actions">
                        <span class="authority-pill authority-pill--${getRiskLevel(grant.resource)}">${escapeHtml(getRiskLabel(getRiskLevel(grant.resource)))}</span>
                        <span class="authority-pill authority-pill--${grant.status}">${escapeHtml(getStatusLabel(grant.status))}</span>
                        <button type="button" class="menu_button" data-action="reset-grant" data-extension-id="${escapeHtml(extensionId)}" data-grant-key="${escapeHtml(grant.key)}">重置</button>
                    </div>
                </div>
            `).join('')}
        </div>
    `;
}

function renderActivityList(items: ActivityRecord[], emptyText: string): string {
    if (items.length === 0) {
        return `<div class="authority-empty">${escapeHtml(emptyText)}</div>`;
    }
    return `
        <div class="authority-stack">
            ${items.map(item => `
                <div class="authority-list-card authority-list-card--column">
                    <div class="authority-list-card__meta">
                        <span class="authority-pill authority-pill--${item.kind}">${escapeHtml(getActivityKindLabel(item.kind))}</span>
                        <span>${escapeHtml(item.extensionId)}</span>
                        <span>${escapeHtml(formatDate(item.timestamp))}</span>
                    </div>
                    <div>${escapeHtml(item.message)}</div>
                    ${item.details ? `<pre class="authority-code-block">${escapeHtml(formatJson(item.details))}</pre>` : ''}
                </div>
            `).join('')}
        </div>
    `;
}

function renderJobList(items: JobRecord[], emptyText: string): string {
    if (items.length === 0) {
        return `<div class="authority-empty">${escapeHtml(emptyText)}</div>`;
    }
    return `
        <div class="authority-stack">
            ${items.map(item => `
                <div class="authority-list-card authority-list-card--column">
                    <div class="authority-list-card__meta">
                        <span class="authority-pill authority-pill--${item.status}">${escapeHtml(item.status)}</span>
                        <span>${escapeHtml(item.type)}</span>
                        <span>${escapeHtml(formatDate(item.updatedAt))}</span>
                    </div>
                    <div>${escapeHtml(item.summary ?? '无摘要')}</div>
                    ${item.error ? `<div class="authority-inline-note authority-inline-note--error">${escapeHtml(item.error)}</div>` : ''}
                </div>
            `).join('')}
        </div>
    `;
}

function renderPolicyList(items: AuthorityPolicyEntry[], emptyText: string): string {
    if (items.length === 0) {
        return `<div class="authority-empty">${escapeHtml(emptyText)}</div>`;
    }
    return `
        <div class="authority-stack">
            ${items.map(item => `
                <div class="authority-list-card">
                    <div>
                        <strong>${escapeHtml(getResourceLabel(item.resource))}</strong>
                        <div class="authority-muted">${escapeHtml(item.target)}</div>
                    </div>
                    <div class="authority-list-card__actions">
                        <span class="authority-pill authority-pill--${item.status}">${escapeHtml(getStatusLabel(item.status))}</span>
                        <span class="authority-muted">${escapeHtml(formatDate(item.updatedAt))}</span>
                    </div>
                </div>
            `).join('')}
        </div>
    `;
}

function renderDatabaseList(items: SqlDatabaseRecord[], emptyText: string): string {
    if (items.length === 0) {
        return `<div class="authority-empty">${escapeHtml(emptyText)}</div>`;
    }
    return `
        <div class="authority-stack">
            ${items.map(item => `
                <div class="authority-list-card">
                    <div>
                        <strong>${escapeHtml(item.name)}</strong>
                        <div class="authority-muted">${escapeHtml(item.fileName)}</div>
                    </div>
                    <div class="authority-list-card__actions">
                        <span class="authority-pill authority-pill--prompt">${escapeHtml(formatBytes(item.sizeBytes))}</span>
                        <span class="authority-muted">${escapeHtml(formatDate(item.updatedAt))}</span>
                    </div>
                </div>
            `).join('')}
        </div>
    `;
}

function renderDatabaseGroupList(items: DatabaseGroupSummary[], emptyText: string): string {
    if (items.length === 0) {
        return `<div class="authority-empty">${escapeHtml(emptyText)}</div>`;
    }
    return `
        <div class="authority-stack">
            ${items.map(item => `
                <div class="authority-list-card authority-list-card--column">
                    <div class="authority-card__header">
                        <div>
                            <strong>${escapeHtml(item.extension.displayName)}</strong>
                            <div class="authority-muted">${escapeHtml(item.extension.id)}</div>
                        </div>
                        <div class="authority-list-card__actions">
                            <span class="authority-pill authority-pill--prompt">${item.databases.length} 个库</span>
                            <span class="authority-pill authority-pill--prompt">${escapeHtml(formatBytes(item.totalSizeBytes))}</span>
                        </div>
                    </div>
                    ${renderDatabaseList(item.databases, '该扩展还没有私有 SQL 数据库。')}
                </div>
            `).join('')}
        </div>
    `;
}

function renderStorageSummary(storage: ExtensionStorageSummary): string {
    return `
        <div class="authority-storage-grid">
            ${renderStorageCard('KV 条目', String(storage.kvEntries), '键值状态')}
            ${renderStorageCard('Blob 文件', String(storage.blobCount), formatBytes(storage.blobBytes))}
            ${renderStorageCard('SQL 数据库', String(storage.databaseCount), formatBytes(storage.databaseBytes))}
            ${renderStorageCard('私有文件', String(storage.files.fileCount), `${storage.files.directoryCount} 个目录`)}
            ${renderStorageCard('文件体积', formatBytes(storage.files.totalSizeBytes), 'fs.private')}
            ${renderStorageCard('最近文件更新', storage.files.latestUpdatedAt ? formatDate(storage.files.latestUpdatedAt) : 'n/a', '最后写入时间')}
        </div>
    `;
}

function getDatabaseGroupSummaries(extensions: ExtensionSummary[], details: Map<string, ExtensionDetailResponse>): DatabaseGroupSummary[] {
    return extensions.map(extension => {
        const databases = [...(details.get(extension.id)?.databases ?? [])]
            .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt));
        return {
            extension,
            databases,
            totalSizeBytes: databases.reduce((sum, item) => sum + item.sizeBytes, 0),
            latestUpdatedAt: databases[0]?.updatedAt ?? null,
        };
    })
        .filter(item => item.databases.length > 0)
        .sort((left, right) => (right.latestUpdatedAt ?? '').localeCompare(left.latestUpdatedAt ?? ''));
}

function formatBytes(bytes: number): string {
    if (!Number.isFinite(bytes) || bytes <= 0) {
        return '0 B';
    }
    const units = ['B', 'KB', 'MB', 'GB', 'TB'];
    let value = bytes;
    let unitIndex = 0;
    while (value >= 1024 && unitIndex < units.length - 1) {
        value /= 1024;
        unitIndex += 1;
    }
    return `${value >= 10 || unitIndex === 0 ? value.toFixed(0) : value.toFixed(1)} ${units[unitIndex]}`;
}

function getCoreStateLabel(state?: string): string {
    switch (state) {
        case 'running': return '运行中';
        case 'starting': return '启动中';
        case 'stopping': return '停止中';
        case 'stopped': return '已停止';
        case 'disabled': return '已禁用';
        case 'error': return '错误';
        default: return '未知';
    }
}

function getInstallStatusLabel(status: string): string {
    switch (status) {
        case 'ready': return '就绪';
        case 'installed': return '已安装';
        case 'updated': return '已更新';
        case 'missing': return '缺失';
        case 'conflict': return '冲突';
        case 'error': return '错误';
        default: return status;
    }
}

function getDeclaredPermissionLabels(declaredPermissions: DeclaredPermissions): string[] {
    const labels: string[] = [];
    if (declaredPermissions.storage?.kv) labels.push('storage.kv');
    if (declaredPermissions.storage?.blob) labels.push('storage.blob');
    if (declaredPermissions.fs?.private) labels.push('fs.private');
    if (declaredPermissions.sql?.private) labels.push(Array.isArray(declaredPermissions.sql.private) ? `sql.private -> ${declaredPermissions.sql.private.join(', ')}` : 'sql.private');
    if (declaredPermissions.http?.allow?.length) labels.push(`http.fetch -> ${declaredPermissions.http.allow.join(', ')}`);
    if (declaredPermissions.jobs?.background) labels.push(Array.isArray(declaredPermissions.jobs.background) ? `jobs.background -> ${declaredPermissions.jobs.background.join(', ')}` : 'jobs.background');
    if (declaredPermissions.events?.channels) labels.push(Array.isArray(declaredPermissions.events.channels) ? `events.stream -> ${declaredPermissions.events.channels.join(', ')}` : 'events.stream');
    return labels;
}

function getResourceLabel(resource: PermissionResource): string {
    switch (resource) {
        case 'storage.kv': return 'KV 存储';
        case 'storage.blob': return 'Blob 存储';
        case 'fs.private': return '私有文件夹';
        case 'sql.private': return '私有 SQL 数据库';
        case 'http.fetch': return 'HTTP 访问';
        case 'jobs.background': return '后台任务';
        case 'events.stream': return '事件流';
        default: return resource;
    }
}

function getStatusLabel(status: PermissionStatus): string {
    switch (status) {
        case 'prompt': return '询问';
        case 'granted': return '允许';
        case 'denied': return '拒绝';
        case 'blocked': return '封锁';
        default: return status;
    }
}

function getActivityKindLabel(kind: ActivityRecord['kind']): string {
    switch (kind) {
        case 'permission': return '权限';
        case 'usage': return '调用';
        case 'error': return '错误';
        default: return kind;
    }
}

function getRiskLevel(resource: PermissionResource): 'low' | 'medium' | 'high' {
    switch (resource) {
        case 'storage.kv':
        case 'storage.blob':
        case 'events.stream':
            return 'low';
        case 'fs.private':
        case 'sql.private':
        case 'http.fetch':
        case 'jobs.background':
            return 'medium';
        default:
            return 'high';
    }
}

function getExtensionRiskLevel(extension: ExtensionSummary | ControlExtensionRecord): 'low' | 'medium' | 'high' {
    const declared = getDeclaredPermissionLabels(extension.declaredPermissions);
    if (declared.some(item => item.includes('sql.private') || item.includes('http.fetch') || item.includes('jobs.background') || item.includes('fs.private'))) {
        return 'medium';
    }
    return declared.length > 0 ? 'low' : 'low';
}

function getRiskLabel(risk: 'low' | 'medium' | 'high'): string {
    switch (risk) {
        case 'low': return '低风险';
        case 'medium': return '中风险';
        case 'high': return '高风险';
        default: return risk;
    }
}

function sortByTimestampDesc(left: ActivityRecord, right: ActivityRecord): number {
    return right.timestamp.localeCompare(left.timestamp);
}

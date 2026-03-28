import { Popup, POPUP_TYPE } from '/scripts/popup.js';
import { renderExtensionTemplateAsync } from '/scripts/extensions.js';
import { AUTHORITY_EXTENSION_DISPLAY_NAME, AUTHORITY_EXTENSION_ID, AUTHORITY_EXTENSION_NAME, AUTHORITY_EXTENSION_VERSION, authorityRequest, } from './api.js';
import { clearChildren, escapeHtml, formatDate, formatJson, htmlToElement, waitForElement } from './dom.js';
const POPUP_TEXT_TYPE = POPUP_TYPE.TEXT ?? 0;
const SECURITY_CENTER_CONFIG = {
    extensionId: AUTHORITY_EXTENSION_ID,
    displayName: AUTHORITY_EXTENSION_DISPLAY_NAME,
    version: AUTHORITY_EXTENSION_VERSION,
    installType: 'local',
    declaredPermissions: {},
    uiLabel: 'Authority Security Center',
};
const RESOURCE_OPTIONS = ['storage.kv', 'storage.blob', 'http.fetch', 'jobs.background', 'events.stream'];
const STATUS_OPTIONS = ['prompt', 'granted', 'denied', 'blocked'];
let bootPromise = null;
export function bootstrapSecurityCenter() {
    if (!bootPromise) {
        bootPromise = doBootstrapSecurityCenter();
    }
    return bootPromise;
}
export async function openSecurityCenter(options = {}) {
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
async function doBootstrapSecurityCenter() {
    try {
        const menu = await waitForElement('#extensionsMenu');
        if (menu.querySelector('#authority-security-center-button')) {
            return;
        }
        const html = await renderExtensionTemplateAsync(AUTHORITY_EXTENSION_NAME, 'menu-button', {}, false, false);
        const button = htmlToElement(html);
        button.addEventListener('click', () => void openSecurityCenter());
        menu.appendChild(button);
    }
    catch (error) {
        console.warn('Authority Security Center menu bootstrap failed:', error);
    }
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
            session: null,
            extensions: [],
            details: new Map(),
            selectedExtensionId: focusExtensionId ?? null,
            selectedTab: focusExtensionId ? 'detail' : 'extensions',
            policies: null,
            policyEditorExtensionId: focusExtensionId ?? null,
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
            const tabButton = target.closest('[data-tab]');
            if (tabButton) {
                const tab = tabButton.dataset.tab;
                if (tab !== 'policies' || this.state.isAdmin) {
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
            const extensionButton = target.closest('[data-extension-id]');
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
            await authorityRequest('/probe', { method: 'POST' });
            const session = await authorityRequest('/session/init', {
                method: 'POST',
                body: SECURITY_CENTER_CONFIG,
            });
            const extensions = await authorityRequest('/extensions');
            const detailEntries = await Promise.all(extensions.map(async (extension) => {
                const detail = await authorityRequest(`/extensions/${encodeURIComponent(extension.id)}`);
                return [extension.id, detail];
            }));
            this.state.session = session;
            this.state.isAdmin = session.user.isAdmin;
            this.state.extensions = extensions;
            this.state.details = new Map(detailEntries);
            this.state.selectedExtensionId = this.resolveSelectedExtensionId();
            this.state.policyEditorExtensionId = this.resolvePolicyEditorExtensionId();
            this.state.policies = this.state.isAdmin
                ? await authorityRequest('/admin/policies')
                : null;
            if (!this.state.isAdmin && this.state.selectedTab === 'policies') {
                this.state.selectedTab = 'extensions';
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
            toastr.success('授权已重置', 'Authority');
            await this.refresh();
        }
        catch (error) {
            toastr.error(error instanceof Error ? error.message : String(error), 'Authority');
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
            toastr.success('管理员策略已保存', 'Authority');
            await this.refresh();
        }
        catch (error) {
            toastr.error(error instanceof Error ? error.message : String(error), 'Authority');
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
        await this.renderDetailSection();
        await this.renderActivitySection();
        await this.renderPoliciesSection();
        this.toggleSections();
    }
    renderHeader() {
        const status = this.root.querySelector('[data-role="status"]');
        if (!status) {
            return;
        }
        if (this.state.loading) {
            status.innerHTML = '<div class="authority-inline-note">正在同步 Authority 状态...</div>';
            return;
        }
        if (this.state.error) {
            status.innerHTML = `<div class="authority-inline-note authority-inline-note--error">${escapeHtml(this.state.error)}</div>`;
            return;
        }
        const user = this.state.session?.user;
        status.innerHTML = `
            <div class="authority-summary-strip">
                <div><strong>当前用户</strong><div>${escapeHtml(user?.handle ?? 'unknown')}</div></div>
                <div><strong>工作模式</strong><div>${escapeHtml(user?.isAdmin ? '管理员模式' : '普通用户模式')}</div></div>
                <div><strong>扩展数量</strong><div>${this.state.extensions.length}</div></div>
            </div>
        `;
    }
    renderTabs() {
        for (const tab of this.root.querySelectorAll('[data-tab]')) {
            const tabName = tab.dataset.tab;
            tab.classList.toggle('authority-tab--active', tabName === this.state.selectedTab);
            tab.hidden = tabName === 'policies' && !this.state.isAdmin;
        }
    }
    renderExtensionList() {
        const container = this.root.querySelector('[data-role="extension-list"]');
        if (!container) {
            return;
        }
        clearChildren(container);
        if (this.state.extensions.length === 0) {
            container.innerHTML = '<div class="authority-empty">还没有扩展通过 Authority 完成初始化。</div>';
            return;
        }
        for (const extension of this.state.extensions) {
            const item = document.createElement('button');
            item.type = 'button';
            item.className = 'authority-extension-item';
            item.dataset.extensionId = extension.id;
            item.innerHTML = `
                <span class="authority-extension-item__title">${escapeHtml(extension.displayName)}</span>
                <span class="authority-extension-item__meta">${escapeHtml(extension.id)}</span>
                <span class="authority-extension-item__stats">已授权 ${extension.grantedCount} / 已拒绝 ${extension.deniedCount}</span>
            `;
            item.classList.toggle('authority-extension-item--active', extension.id === this.state.selectedExtensionId);
            container.appendChild(item);
        }
    }
    async renderDetailSection() {
        const container = this.root.querySelector('[data-role="detail-view"]');
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
        container.innerHTML = `
            <div class="authority-card-grid">
                <section class="authority-card">
                    <div class="authority-card__header">
                        <div>
                            <h3>${escapeHtml(detail.extension.displayName)}</h3>
                            <div class="authority-muted">${escapeHtml(detail.extension.id)}</div>
                        </div>
                        <button type="button" class="menu_button" data-action="reset-all-grants" data-extension-id="${escapeHtml(detail.extension.id)}">重置全部授权</button>
                    </div>
                    <div class="authority-kv-grid">
                        <div><strong>版本</strong><div>${escapeHtml(detail.extension.version)}</div></div>
                        <div><strong>安装类型</strong><div>${escapeHtml(detail.extension.installType)}</div></div>
                        <div><strong>首次见到</strong><div>${escapeHtml(formatDate(detail.extension.firstSeenAt))}</div></div>
                        <div><strong>最近活跃</strong><div>${escapeHtml(formatDate(detail.extension.lastSeenAt))}</div></div>
                    </div>
                </section>
                <section class="authority-card">
                    <h3>声明权限</h3>
                    ${renderStringList(getDeclaredPermissionLabels(detail.extension.declaredPermissions), '该扩展尚未声明任何 Authority 权限。')}
                </section>
                <section class="authority-card">
                    <h3>当前授权</h3>
                    ${renderGrantList(detail.extension.id, granted, '当前没有已授予的持久化授权。')}
                </section>
                <section class="authority-card">
                    <h3>被拒绝权限</h3>
                    ${renderGrantList(detail.extension.id, denied, '当前没有持久化拒绝记录。')}
                </section>
                <section class="authority-card">
                    <h3>最近权限活动</h3>
                    ${renderActivityList(permissions, '暂无权限活动。')}
                </section>
                <section class="authority-card">
                    <h3>最近能力调用</h3>
                    ${renderActivityList(usage, '暂无能力调用记录。')}
                </section>
                <section class="authority-card">
                    <h3>最近任务</h3>
                    ${renderJobList(jobs, '暂无后台任务。')}
                </section>
                <section class="authority-card">
                    <h3>最近错误</h3>
                    ${renderActivityList(errors, '暂无内部错误记录。')}
                </section>
            </div>
        `;
    }
    async renderActivitySection() {
        const container = this.root.querySelector('[data-role="activity-view"]');
        if (!container) {
            return;
        }
        const items = [...this.state.details.values()]
            .flatMap(detail => [...detail.activity.permissions, ...detail.activity.usage, ...detail.activity.errors])
            .sort(sortByTimestampDesc)
            .slice(0, 40);
        container.innerHTML = `
            <section class="authority-card">
                <h3>最近授权活动</h3>
                ${renderActivityList(items, '暂无活动记录。')}
            </section>
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
            <div class="authority-card-grid">
                <section class="authority-card">
                    <h3>全局默认策略</h3>
                    <div class="authority-policy-defaults">
                        ${RESOURCE_OPTIONS.map(resource => `
                            <label class="authority-policy-field">
                                <span>${escapeHtml(getResourceLabel(resource))}</span>
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
                </section>
            </div>
        `;
    }
    buildPolicyRowMarkup(entry) {
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
    toggleSections() {
        for (const section of this.root.querySelectorAll('[data-section]')) {
            const name = section.dataset.section;
            section.hidden = name !== this.state.selectedTab;
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
function renderStringList(items, emptyText) {
    if (items.length === 0) {
        return `<div class="authority-empty">${escapeHtml(emptyText)}</div>`;
    }
    return `<ul class="authority-list">${items.map(item => `<li>${escapeHtml(item)}</li>`).join('')}</ul>`;
}
function renderGrantList(extensionId, grants, emptyText) {
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
                        <span class="authority-pill authority-pill--${grant.status}">${escapeHtml(getStatusLabel(grant.status))}</span>
                        <button type="button" class="menu_button" data-action="reset-grant" data-extension-id="${escapeHtml(extensionId)}" data-grant-key="${escapeHtml(grant.key)}">重置</button>
                    </div>
                </div>
            `).join('')}
        </div>
    `;
}
function renderActivityList(items, emptyText) {
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
function renderJobList(items, emptyText) {
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
function getDeclaredPermissionLabels(declaredPermissions) {
    const labels = [];
    if (declaredPermissions.storage?.kv)
        labels.push('storage.kv');
    if (declaredPermissions.storage?.blob)
        labels.push('storage.blob');
    if (declaredPermissions.http?.allow?.length)
        labels.push(`http.fetch -> ${declaredPermissions.http.allow.join(', ')}`);
    if (declaredPermissions.jobs?.background)
        labels.push(Array.isArray(declaredPermissions.jobs.background) ? `jobs.background -> ${declaredPermissions.jobs.background.join(', ')}` : 'jobs.background');
    if (declaredPermissions.events?.channels)
        labels.push(Array.isArray(declaredPermissions.events.channels) ? `events.stream -> ${declaredPermissions.events.channels.join(', ')}` : 'events.stream');
    return labels;
}
function getResourceLabel(resource) {
    switch (resource) {
        case 'storage.kv': return 'KV 存储';
        case 'storage.blob': return 'Blob 存储';
        case 'http.fetch': return 'HTTP 访问';
        case 'jobs.background': return '后台任务';
        case 'events.stream': return '事件流';
        default: return resource;
    }
}
function getStatusLabel(status) {
    switch (status) {
        case 'prompt': return '询问';
        case 'granted': return '允许';
        case 'denied': return '拒绝';
        case 'blocked': return '封锁';
        default: return status;
    }
}
function getActivityKindLabel(kind) {
    switch (kind) {
        case 'permission': return '权限';
        case 'usage': return '调用';
        case 'error': return '错误';
        default: return kind;
    }
}
function getRiskLevel(resource) {
    switch (resource) {
        case 'storage.kv':
        case 'storage.blob':
        case 'events.stream':
            return 'low';
        case 'http.fetch':
        case 'jobs.background':
            return 'medium';
        default:
            return 'high';
    }
}
function sortByTimestampDesc(left, right) {
    return right.timestamp.localeCompare(left.timestamp);
}
//# sourceMappingURL=security-center.js.map
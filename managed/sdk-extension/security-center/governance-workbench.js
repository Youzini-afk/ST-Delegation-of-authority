import { escapeHtml, formatDate } from '../dom.js';
import { renderActivityLogRows, renderCapabilityMatrix, renderDatabaseAssetSections, renderDatabaseGroupTable, renderGrantSettingsRows, renderJobTable, renderPolicyRows, renderStorageSummary, } from './components.js';
import { RESOURCE_OPTIONS, STATUS_OPTIONS } from './options.js';
import { formatBytes, getDeclaredPermissionLabels, getExtensionRiskLevel, getInstallTypeLabel, getResourceLabel, getRiskLabel, getRiskLevel, getStatusLabel, sortByTimestampDesc, } from './formatters.js';
import { buildOverviewModel, getDatabaseGroupSummaries } from './view-models.js';
export function renderExtensionDirectory(state) {
    const filter = state.extensionFilter;
    const extensions = filter
        ? state.extensions.filter(extension => `${extension.displayName} ${extension.id}`.toLowerCase().includes(filter))
        : state.extensions;
    if (extensions.length === 0) {
        return {
            count: 0,
            html: '<div class="authority-extension-nav__empty">没有匹配的扩展。</div>',
        };
    }
    return {
        count: extensions.length,
        html: `
            <div class="authority-extension-group">
                <div class="authority-extension-group__label">已接入</div>
                ${extensions.map(extension => {
            const detail = state.details.get(extension.id);
            const risk = getExtensionRiskLevel(extension);
            const errorCount = (detail?.activity.errors.length ?? 0) + (detail?.activity.warnings.length ?? 0);
            const active = extension.id === state.selectedExtensionId;
            return `
                    <button type="button" class="authority-extension-item ${active ? 'authority-extension-item--active' : ''}"
                        data-extension-id="${escapeHtml(extension.id)}" ${active ? 'aria-current="page"' : ''}>
                        <span class="authority-extension-item__top">
                            <span class="authority-extension-item__title">${escapeHtml(extension.displayName)}</span>
                            <span class="authority-extension-item__signal authority-extension-item__signal--${errorCount > 0 ? 'attention' : risk}" aria-hidden="true"></span>
                        </span>
                        <span class="authority-extension-item__meta">
                            <code>${escapeHtml(extension.id)}</code>
                            <span aria-hidden="true">·</span>
                            <span class="authority-risk-label authority-risk-label--${risk}">${escapeHtml(getRiskLabel(risk))}</span>
                        </span>
                        <span class="authority-extension-item__stats">
                            <span>允许 ${extension.grantedCount}</span>
                            <span>拒绝 ${extension.deniedCount}</span>
                            ${errorCount > 0 ? `<span class="authority-extension-item__attention">异常 ${errorCount}</span>` : `<span>v${escapeHtml(extension.version)}</span>`}
                        </span>
                    </button>
                `;
        }).join('')}
            </div>
        `,
    };
}
export function renderGovernanceOverview(state) {
    const overview = buildOverviewModel(state);
    const grants = [...state.details.values()].flatMap(detail => detail.grants);
    const grantedCount = grants.filter(grant => grant.status === 'granted').length;
    const deniedCount = grants.filter(grant => grant.status === 'denied' || grant.status === 'blocked').length;
    const databaseCount = overview.databaseGroups.reduce((sum, item) => sum + item.databaseCount, 0);
    const attention = [
        ...overview.recentPermissionDenials,
        ...overview.recentWarnings,
        ...overview.recentErrors,
    ].sort(sortByTimestampDesc).slice(0, 12);
    return `
        <div class="authority-governance-page authority-governance-overview">
            <header class="authority-governance-page__header">
                <div>
                    <h2>治理概览</h2>
                    <p>跨扩展查看授权状态、后台任务与需要处理的异常。</p>
                </div>
                <div class="authority-page-actions">
                    <button type="button" class="authority-action-button" data-tab="activity">打开完整审计</button>
                </div>
            </header>

            <div class="authority-governance-glance" aria-label="治理摘要">
                <span><small>接入扩展</small><strong>${state.extensions.length}</strong></span>
                <span><small>允许授权</small><strong>${grantedCount}</strong></span>
                <span class="${deniedCount > 0 ? 'authority-governance-glance--warning' : ''}"><small>拒绝 / 封锁</small><strong>${deniedCount}</strong></span>
                <span><small>策略规则</small><strong>${overview.totalPolicyCount}</strong></span>
                <span><small>数据资产</small><strong>${databaseCount} 个库</strong></span>
            </div>

            <div class="authority-governance-overview-grid">
                <main class="authority-governance-overview__main">
                  <section class="authority-pane-section">
                    <div class="authority-section-heading">
                        <div><h3>需要关注</h3><div class="authority-muted">最近的权限拒绝、告警与错误</div></div>
                        <span class="authority-section-count">${attention.length}</span>
                    </div>
                    ${renderActivityLogRows(attention, '当前没有需要处理的权限拒绝、告警或错误。')}
                  </section>

                  <details class="authority-collapsible-section">
                    <summary><strong>Authority 可治理的能力</strong><span class="authority-muted">${RESOURCE_OPTIONS.length} 类资源</span></summary>
                    <div class="authority-collapsible-section__body">${renderCapabilityMatrix(RESOURCE_OPTIONS)}</div>
                  </details>
                </main>

                <aside class="authority-context-rail">
                  <div class="authority-context-rail__header"><strong>运行状态</strong></div>
                  <section class="authority-context-rail__section">
                    <div class="authority-section-heading">
                        <div><h3>后台任务</h3><div class="authority-muted">${overview.activeJobs.length} 个进行中</div></div>
                    </div>
                    ${renderJobTable(overview.activeJobs.slice(0, 5), '当前没有排队或运行中的任务。')}
                  </section>
                  <section class="authority-context-rail__section">
                    <div class="authority-section-heading"><div><h3>继续查看</h3></div></div>
                    <div class="authority-context-links">
                      <button type="button" data-tab="detail"><span>扩展目录</span><small>逐个检查权限与数据</small></button>
                      <button type="button" data-tab="databases"><span>数据资产</span><small>查看数据库与记忆库</small></button>
                      ${state.isAdmin ? '<button type="button" data-tab="policies"><span>全局策略</span><small>修改默认授权规则</small></button>' : ''}
                    </div>
                  </section>
                </aside>
            </div>
        </div>
    `;
}
export function renderExtensionDossier(state) {
    const detail = state.selectedExtensionId ? state.details.get(state.selectedExtensionId) : null;
    if (!detail) {
        return '<div class="authority-empty">先从左侧选一个扩展，再看它的权限、数据和运行情况。</div>';
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
    const recentActivity = [...permissions, ...usage, ...warnings, ...errors]
        .sort(sortByTimestampDesc)
        .slice(0, 8);
    return `
        <div class="authority-extension-dossier">
            <main class="authority-extension-dossier__main">
                <header class="authority-dossier-header">
                    <div class="authority-dossier-title">
                        <div class="authority-dossier-title__line">
                            <h2>${escapeHtml(detail.extension.displayName)}</h2>
                            <span class="authority-connection-state"><i aria-hidden="true"></i>已接入</span>
                        </div>
                        <div class="authority-dossier-identity">
                            <span>ID: <code>${escapeHtml(detail.extension.id)}</code></span>
                            <span aria-hidden="true">|</span>
                            <span>Version: <code>${escapeHtml(detail.extension.version)}</code></span>
                        </div>
                    </div>
                    <div class="authority-dossier-actions">
                        <span class="authority-risk-label authority-risk-label--${risk}">${escapeHtml(getRiskLabel(risk))}</span>
                        ${state.isAdmin ? '<button type="button" class="authority-action-button" data-tab="policies">管理规则</button>' : ''}
                    </div>
                </header>

                <div class="authority-extension-dossier__scroll">
                    <div class="authority-extension-facts" aria-label="扩展摘要">
                        <span><small>安装方式</small><strong>${escapeHtml(getInstallTypeLabel(detail.extension.installType))}</strong></span>
                        <span><small>首次接入</small><strong>${escapeHtml(formatDate(detail.extension.firstSeenAt))}</strong></span>
                        <span><small>最近活跃</small><strong>${escapeHtml(formatDate(detail.extension.lastSeenAt))}</strong></span>
                        <span><small>当前授权</small><strong>${granted.length} 允许 · ${denied.length} 拒绝</strong></span>
                    </div>

                    <section class="authority-dossier-section">
                        <div class="authority-section-heading">
                            <div><h3>声明的能力</h3><div class="authority-muted">扩展向 Authority 声明的访问边界</div></div>
                            <span class="authority-section-count">${getDeclaredPermissionLabels(detail.extension.declaredPermissions).length}</span>
                        </div>
                        ${renderDeclaredCapabilityRows(detail.extension.declaredPermissions)}
                    </section>

                    <section class="authority-dossier-section">
                        <div class="authority-section-heading">
                            <div><h3>数据占用</h3><div class="authority-muted">由 Authority 管理的扩展私有数据</div></div>
                            <button type="button" class="authority-text-button" data-tab="databases">查看全部数据</button>
                        </div>
                        ${renderCompactStorageSummary(storage)}
                    </section>

                    <details class="authority-collapsible-section">
                        <summary><strong>数据库明细</strong><span class="authority-muted">${databaseCount} 个数据库</span></summary>
                        <div class="authority-collapsible-section__body authority-stack">
                            ${renderStorageSummary(storage)}
                            ${renderDatabaseAssetSections(databases, triviumDatabases, '该扩展还没有私有数据库。')}
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
            </main>

            <aside class="authority-context-rail authority-extension-inspector">
                <div class="authority-context-rail__header">
                    <strong>权限控制</strong>
                    <span>${detail.grants.length + detail.policies.length} 条决定</span>
                </div>
                <div class="authority-context-rail__scroll">
                    <section class="authority-context-rail__section">
                        <div class="authority-decision-summary">
                            <span><small>允许</small><strong class="authority-status-text--granted">${granted.length}</strong></span>
                            <span><small>拒绝 / 封锁</small><strong class="authority-status-text--denied">${denied.length}</strong></span>
                            <span><small>策略覆盖</small><strong>${detail.policies.length}</strong></span>
                        </div>
                    </section>
                    <section class="authority-context-rail__section">
                        <div class="authority-section-heading"><div><h3>持久授权</h3><div class="authority-muted">用户或系统已经做出的决定</div></div></div>
                        ${renderGrantSettingsRows(detail.extension.id, [...granted, ...denied], '当前没有持久化授权或拒绝记录。')}
                        <button type="button" class="authority-text-button authority-text-button--danger" data-action="reset-all-grants" data-extension-id="${escapeHtml(detail.extension.id)}">重置全部授权</button>
                    </section>
                    <section class="authority-context-rail__section">
                        <div class="authority-section-heading"><div><h3>扩展策略</h3><div class="authority-muted">管理员规则会优先于用户授权</div></div></div>
                        ${renderPolicyRows(detail.policies, '当前没有针对该扩展的策略覆盖。')}
                    </section>
                    <section class="authority-context-rail__section">
                        <div class="authority-section-heading"><div><h3>近期活动</h3></div><button type="button" class="authority-text-button" data-tab="activity">完整审计</button></div>
                        ${renderActivityLogRows(recentActivity, '该扩展还没有活动记录。')}
                    </section>
                </div>
            </aside>
        </div>
    `;
}
export function renderDataAssets(state) {
    const databaseGroups = getDatabaseGroupSummaries(state.extensions, state.details);
    const totalDatabaseCount = databaseGroups.reduce((sum, item) => sum + item.databaseCount, 0);
    const totalDatabaseSize = databaseGroups.reduce((sum, item) => sum + item.totalSizeBytes, 0);
    return `
        <div class="authority-governance-page">
            <header class="authority-governance-page__header">
                <div>
                    <h2>数据资产</h2>
                    <p>由 Authority 隔离管理的 SQL 数据库、Trivium 记忆库与文件占用。</p>
                </div>
                <div class="authority-page-actions">
                    <span class="authority-inline-stat"><strong>${totalDatabaseCount}</strong> 个数据库</span>
                    <span class="authority-inline-stat"><strong>${escapeHtml(formatBytes(totalDatabaseSize))}</strong> 总占用</span>
                </div>
            </header>
            <div class="authority-data-workspace">
                <main class="authority-data-workspace__main">
                    ${renderDatabaseGroupTable(databaseGroups, '当前没有发现任何扩展私有数据库。')}
                </main>
                <aside class="authority-context-rail">
                    <div class="authority-context-rail__header"><strong>资产索引</strong><span>${databaseGroups.length} 个扩展</span></div>
                    <div class="authority-context-rail__scroll">
                        ${databaseGroups.length > 0 ? databaseGroups.map(item => `
                            <button type="button" class="authority-extension-item authority-asset-index-row" data-extension-id="${escapeHtml(item.extension.id)}">
                                <span><strong>${escapeHtml(item.extension.displayName)}</strong><code>${escapeHtml(item.extension.id)}</code></span>
                                <span><strong>${item.databaseCount}</strong><small>${escapeHtml(formatBytes(item.totalSizeBytes))}</small></span>
                            </button>
                        `).join('') : '<div class="authority-empty">暂无数据资产。</div>'}
                    </div>
                </aside>
            </div>
        </div>
    `;
}
export function renderAuditWorkspace(state) {
    const items = [...state.details.values()]
        .flatMap(detail => [...detail.activity.permissions, ...detail.activity.usage, ...detail.activity.errors, ...detail.activity.warnings])
        .sort(sortByTimestampDesc)
        .slice(0, 80);
    const warnings = [...state.details.values()]
        .flatMap(detail => detail.activity.warnings)
        .sort(sortByTimestampDesc)
        .slice(0, 40);
    const errors = [...state.details.values()]
        .flatMap(detail => detail.activity.errors)
        .sort(sortByTimestampDesc)
        .slice(0, 40);
    return `
        <div class="authority-governance-page">
            <header class="authority-governance-page__header">
                <div>
                    <h2>审计记录</h2>
                    <p>按时间追踪权限请求、能力调用、运行告警与错误。</p>
                </div>
                <span class="authority-inline-stat"><strong>${items.length}</strong> 条近期记录</span>
            </header>
            <div class="authority-audit-workspace">
                <main class="authority-audit-workspace__main">
                    <div class="authority-section-heading">
                        <div>
                            <h3>最近活动</h3>
                            <div class="authority-muted">按时间倒序显示最近发生的事情</div>
                        </div>
                    </div>
                    ${renderActivityLogRows(items, '暂无活动记录。')}
                </main>
                <aside class="authority-context-rail authority-audit-inspector">
                    <div class="authority-context-rail__header"><strong>需要关注</strong><span>${warnings.length + errors.length}</span></div>
                    <div class="authority-context-rail__scroll">
                        <section class="authority-context-rail__section">
                            <div class="authority-section-heading"><div><h3>运行告警</h3><div class="authority-muted">任务变慢、排队或反复重试</div></div></div>
                            ${renderActivityLogRows(warnings, '暂无告警记录。')}
                        </section>
                        <section class="authority-context-rail__section">
                            <div class="authority-section-heading"><div><h3>错误记录</h3><div class="authority-muted">需要排查的失败事件</div></div></div>
                            ${renderActivityLogRows(errors, '暂无错误记录。')}
                        </section>
                    </div>
                </aside>
            </div>
        </div>
    `;
}
export function renderPolicyWorkbench(state) {
    if (!state.isAdmin) {
        return '<div class="authority-empty">只有管理员可查看和修改全局策略。</div>';
    }
    const policies = state.policies;
    if (!policies) {
        return '<div class="authority-empty">策略尚未加载。</div>';
    }
    const extensionId = state.policyEditorExtensionId ?? state.selectedExtensionId ?? state.extensions[0]?.id ?? '';
    const overrides = extensionId ? Object.values(policies.extensions[extensionId] ?? {}) : [];
    const totalOverrides = Object.values(policies.extensions)
        .reduce((sum, extensionPolicies) => sum + Object.keys(extensionPolicies).length, 0);
    const defaultCounts = STATUS_OPTIONS.reduce((counts, status) => {
        counts[status] = RESOURCE_OPTIONS.filter(resource => policies.defaults[resource] === status).length;
        return counts;
    }, { granted: 0, denied: 0, prompt: 0, blocked: 0 });
    return `
        <div class="authority-policy-workspace">
            <main class="authority-policy-workspace__main">
                <header class="authority-governance-page__header">
                    <div>
                        <h2>全局策略</h2>
                        <p>设置每类能力的默认决定，并为单个扩展添加精确覆盖。</p>
                    </div>
                    <span class="authority-inline-stat"><strong>${RESOURCE_OPTIONS.length}</strong> 类资源</span>
                </header>

                <div class="authority-policy-workspace__scroll">
                  <section class="authority-pane-section">
                    <div class="authority-section-heading">
                        <div><h3>默认处理规则</h3><div class="authority-muted">没有更具体的扩展覆盖或持久授权时使用</div></div>
                        <span class="authority-section-count">${RESOURCE_OPTIONS.length}</span>
                    </div>
                    <div class="authority-table-wrap">
                        <table class="authority-data-table authority-policy-matrix">
                            <thead>
                                <tr>
                                    <th>能力</th>
                                    <th>内部名称</th>
                                    <th>风险</th>
                                    <th>默认决定</th>
                                </tr>
                            </thead>
                            <tbody>
                                ${RESOURCE_OPTIONS.map(resource => `
                                    <tr>
                                        <td><strong>${escapeHtml(getResourceLabel(resource))}</strong></td>
                                        <td><code>${escapeHtml(resource)}</code></td>
                                        <td><span class="authority-risk-label authority-risk-label--${getRiskLevel(resource)}">${escapeHtml(getRiskLabel(getRiskLevel(resource)))}</span></td>
                                        <td>
                                            <select data-policy-default="${escapeHtml(resource)}" aria-label="${escapeHtml(getResourceLabel(resource))}的默认决定">
                                                ${STATUS_OPTIONS.map(status => `<option value="${status}" ${policies.defaults[resource] === status ? 'selected' : ''}>${escapeHtml(getStatusLabel(status))}</option>`).join('')}
                                            </select>
                                        </td>
                                    </tr>
                                `).join('')}
                            </tbody>
                        </table>
                    </div>
                  </section>

                  <section class="authority-pane-section">
                    <div class="authority-section-heading">
                    <div>
                        <h3>扩展覆盖</h3>
                        <div class="authority-muted">按扩展、能力与目标覆盖默认决定</div>
                    </div>
                    <div class="authority-policy-toolbar">
                        <label class="authority-policy-field authority-policy-field--inline">
                            <span>扩展</span>
                            <select data-policy-editor-extension>
                                ${state.extensions.map(extension => `<option value="${escapeHtml(extension.id)}" ${extension.id === extensionId ? 'selected' : ''}>${escapeHtml(extension.displayName)}</option>`).join('')}
                            </select>
                        </label>
                        <button type="button" class="authority-text-button" data-action="add-policy-row">＋ 新增覆盖</button>
                    </div>
                    </div>
                    <div class="authority-policy-rows" data-role="policy-rows">
                        ${overrides.map(entry => renderPolicyOverrideRow(entry)).join('')}
                    </div>
                  </section>
                </div>

                <footer class="authority-policy-savebar">
                    <span>最后保存：${escapeHtml(formatDate(policies.updatedAt))}</span>
                    <button type="button" class="authority-action-button authority-action-button--primary" data-action="save-policies">保存策略</button>
                </footer>
            </main>

            <aside class="authority-context-rail authority-policy-inspector">
                <div class="authority-context-rail__header"><strong>影响预览</strong></div>
                <div class="authority-context-rail__scroll">
                    <section class="authority-context-rail__section">
                        <div class="authority-policy-impact-grid">
                            <span><small>默认允许</small><strong class="authority-status-text--granted">${defaultCounts.granted}</strong></span>
                            <span><small>每次询问</small><strong class="authority-status-text--prompt">${defaultCounts.prompt}</strong></span>
                            <span><small>默认拒绝</small><strong class="authority-status-text--denied">${defaultCounts.denied}</strong></span>
                            <span><small>管理员封锁</small><strong class="authority-status-text--denied">${defaultCounts.blocked}</strong></span>
                        </div>
                    </section>
                    <section class="authority-context-rail__section">
                        <div class="authority-policy-warning">
                            <strong>策略影响全部扩展</strong>
                            <span>拒绝或封锁可能覆盖已有持久授权；保存前仍会执行影响确认。</span>
                        </div>
                    </section>
                    <section class="authority-context-rail__section">
                        <div class="authority-section-heading"><div><h3>判定顺序</h3></div></div>
                        <ol class="authority-evaluation-order">
                            <li><span>1</span><div><strong>管理员封锁</strong><small>不可被其他决定覆盖</small></div></li>
                            <li><span>2</span><div><strong>扩展覆盖</strong><small>${totalOverrides} 条精确规则</small></div></li>
                            <li><span>3</span><div><strong>持久授权</strong><small>用户已经做出的决定</small></div></li>
                            <li><span>4</span><div><strong>默认规则</strong><small>当前资源没有更具体规则时</small></div></li>
                        </ol>
                    </section>
                </div>
            </aside>
        </div>
    `;
}
export function renderPolicyOverrideRow(entry) {
    return `
        <div class="authority-policy-row">
            <select data-policy-field="resource" aria-label="覆盖能力">
                ${RESOURCE_OPTIONS.map(resource => `<option value="${resource}" ${entry?.resource === resource ? 'selected' : ''}>${escapeHtml(getResourceLabel(resource))}</option>`).join('')}
            </select>
            <input data-policy-field="target" type="text" value="${escapeHtml(entry?.target ?? '*')}" placeholder="目标，例如网站域名或频道名" aria-label="覆盖目标" />
            <select data-policy-field="status" aria-label="覆盖决定">
                ${STATUS_OPTIONS.map(status => `<option value="${status}" ${entry?.status === status ? 'selected' : ''}>${escapeHtml(getStatusLabel(status))}</option>`).join('')}
            </select>
            <button type="button" class="menu_button" data-action="remove-policy-row">移除</button>
        </div>
    `;
}
function getDeclaredPermissionValue(declared, resource) {
    switch (resource) {
        case 'storage.kv': return declared.storage?.kv;
        case 'storage.blob': return declared.storage?.blob;
        case 'fs.private': return declared.fs?.private;
        case 'sql.private': return declared.sql?.private;
        case 'trivium.private': return declared.trivium?.private;
        case 'http.fetch': return declared.http?.allow;
        case 'jobs.background': return declared.jobs?.background;
        case 'events.stream': return declared.events?.channels;
        case 'module.execute': return declared.modules?.execute;
        case 'agent.run': return declared.agent?.run;
        case 'agent.browser': return declared.agent?.browser;
        default: return undefined;
    }
}
function renderDeclaredCapabilityRows(declared) {
    const entries = RESOURCE_OPTIONS.flatMap(resource => {
        const value = getDeclaredPermissionValue(declared, resource);
        if (!value || (Array.isArray(value) && value.length === 0))
            return [];
        return [{
                resource,
                target: Array.isArray(value) ? value.join(' · ') : '扩展私有范围',
            }];
    });
    if (entries.length === 0) {
        return '<div class="authority-empty">该扩展还没有声明任何权限。</div>';
    }
    return `
        <div class="authority-capability-list">
            ${entries.map(({ resource, target }) => {
        const risk = getRiskLevel(resource);
        return `
                    <div class="authority-capability-row">
                        <span class="authority-capability-row__mark authority-capability-row__mark--${risk}" aria-hidden="true"></span>
                        <span class="authority-capability-row__body">
                            <strong>${escapeHtml(getResourceLabel(resource))}</strong>
                            <code>${escapeHtml(resource)}</code>
                            <small>${escapeHtml(target)}</small>
                        </span>
                        <span class="authority-risk-label authority-risk-label--${risk}">${escapeHtml(getRiskLabel(risk))}</span>
                    </div>
                `;
    }).join('')}
        </div>
    `;
}
function renderCompactStorageSummary(storage) {
    const items = [
        ['KV', `${storage.kvEntries} 项`, '键值数据'],
        ['Blob', formatBytes(storage.blobBytes), `${storage.blobCount} 个对象`],
        ['SQL', `${storage.sqlDatabaseCount} 个`, formatBytes(storage.sqlDatabaseBytes)],
        ['Trivium', `${storage.triviumDatabaseCount} 个`, formatBytes(storage.triviumDatabaseBytes)],
        ['私有文件', formatBytes(storage.files.totalSizeBytes), `${storage.files.fileCount} 个文件`],
    ];
    return `
        <div class="authority-storage-strip">
            ${items.map(([label, value, meta]) => `
                <span>
                    <small>${escapeHtml(label)}</small>
                    <strong>${escapeHtml(value)}</strong>
                    <em>${escapeHtml(meta)}</em>
                </span>
            `).join('')}
        </div>
    `;
}
//# sourceMappingURL=governance-workbench.js.map
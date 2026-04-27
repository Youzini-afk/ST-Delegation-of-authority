import { escapeHtml, formatDate, formatJson } from '../dom.js';
import { formatBytes, getActivityKindLabel, getActivityMessageLabel, getJobAttemptEventLabel, getJobStatusLabel, getJobTypeLabel, getResourceLabel, getRiskLabel, getRiskLevel, getStatusLabel, getSystemMessageLabel, } from './formatters.js';
export function renderKpiCard(label, value, meta) {
    return `
        <div class="authority-kpi-card">
            <div class="authority-kpi-card__label">${escapeHtml(label)}</div>
            <div class="authority-kpi-card__value">${escapeHtml(value)}</div>
            <div class="authority-kpi-card__meta">${escapeHtml(meta)}</div>
        </div>
    `;
}
export function renderMetricTile(label, value, meta, tone = 'neutral') {
    return `
        <div class="authority-metric-tile authority-metric-tile--${tone}">
            <div class="authority-metric-tile__label">${escapeHtml(label)}</div>
            <div class="authority-metric-tile__value">${escapeHtml(value)}</div>
            <div class="authority-metric-tile__meta">${escapeHtml(meta)}</div>
        </div>
    `;
}
export function renderStorageCard(label, value, meta) {
    return `
        <div class="authority-storage-card">
            <div class="authority-storage-card__label">${escapeHtml(label)}</div>
            <div class="authority-storage-card__value">${escapeHtml(value)}</div>
            <div class="authority-storage-card__meta">${escapeHtml(meta)}</div>
        </div>
    `;
}
export function renderAlertStack(items) {
    if (items.length === 0) {
        return '';
    }
    const warningCount = items.filter(item => item.tone !== 'info').length;
    const summary = warningCount > 0
        ? `${items.length} 条提醒 · ${warningCount} 条需要注意`
        : `${items.length} 条状态信息`;
    return `
        <details class="authority-alert-drawer">
            <summary>
                <span class="authority-alert-drawer__title">组件状态与后台服务提醒</span>
                <span class="authority-alert-drawer__meta">${escapeHtml(summary)}</span>
            </summary>
            <div class="authority-alert-stack">
                ${items.map(item => `
                    <div class="authority-alert authority-alert--${item.tone}">
                        <strong>${escapeHtml(item.title)}</strong>
                        <span>${escapeHtml(item.message)}</span>
                    </div>
                `).join('')}
            </div>
        </details>
    `;
}
export function renderCapabilityMatrix(resources) {
    return `
        <div class="authority-capability-grid">
            ${resources.map(resource => {
        const risk = getRiskLevel(resource);
        return `
                    <div class="authority-capability-chip">
                        <strong>${escapeHtml(getResourceLabel(resource))}</strong>
                        <div class="authority-muted">${escapeHtml(resource)}</div>
                        <div class="authority-chip-row">
                            <span class="authority-pill authority-pill--${risk}">${escapeHtml(getRiskLabel(risk))}</span>
                            <span class="authority-pill authority-pill--usage">权限标识</span>
                        </div>
                    </div>
                `;
    }).join('')}
        </div>
    `;
}
export function renderStringList(items, emptyText) {
    if (items.length === 0) {
        return `<div class="authority-empty">${escapeHtml(emptyText)}</div>`;
    }
    return `<div class="authority-chip-row">${items.map(item => `<span class="authority-pill authority-pill--prompt">${escapeHtml(item)}</span>`).join('')}</div>`;
}
export function renderGrantList(extensionId, grants, emptyText) {
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
export function renderSettingsRow(label, description, control, tone = 'neutral') {
    return `
        <div class="authority-settings-row authority-settings-row--${tone}">
            <div>
                <strong>${escapeHtml(label)}</strong>
                <div class="authority-muted">${escapeHtml(description)}</div>
            </div>
            <div class="authority-settings-row__control">${control}</div>
        </div>
    `;
}
export function renderGrantSettingsRows(extensionId, grants, emptyText) {
    if (grants.length === 0) {
        return `<div class="authority-empty">${escapeHtml(emptyText)}</div>`;
    }
    return `
        <div class="authority-settings-list">
            ${grants.map(grant => renderSettingsRow(getResourceLabel(grant.resource), grant.target, `
                    <span class="authority-pill authority-pill--${getRiskLevel(grant.resource)}">${escapeHtml(getRiskLabel(getRiskLevel(grant.resource)))}</span>
                    <span class="authority-pill authority-pill--${grant.status}">${escapeHtml(getStatusLabel(grant.status))}</span>
                    <button type="button" class="menu_button" data-action="reset-grant" data-extension-id="${escapeHtml(extensionId)}" data-grant-key="${escapeHtml(grant.key)}">重置</button>
                `, grant.status === 'granted' ? 'success' : grant.status === 'denied' || grant.status === 'blocked' ? 'error' : 'warning')).join('')}
        </div>
    `;
}
export function renderActivityList(items, emptyText) {
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
                    <div>${escapeHtml(getActivityMessageLabel(item.message))}</div>
                    ${item.details ? `<pre class="authority-code-block">${escapeHtml(formatJson(item.details))}</pre>` : ''}
                </div>
            `).join('')}
        </div>
    `;
}
export function renderActivityLogRows(items, emptyText) {
    if (items.length === 0) {
        return `<div class="authority-empty">${escapeHtml(emptyText)}</div>`;
    }
    return `
        <div class="authority-log-list">
            ${items.map(item => `
                <div class="authority-log-row authority-log-row--${item.kind}">
                    <span class="authority-log-row__time">${escapeHtml(formatDate(item.timestamp))}</span>
                    <span class="authority-log-row__kind">${escapeHtml(getActivityKindLabel(item.kind))}</span>
                    <span class="authority-log-row__source">${escapeHtml(item.extensionId)}</span>
                    <span class="authority-log-row__message">${escapeHtml(getActivityMessageLabel(item.message))}</span>
                    ${item.details ? `<pre class="authority-code-block">${escapeHtml(formatJson(item.details))}</pre>` : ''}
                </div>
            `).join('')}
        </div>
    `;
}
export function renderJobList(items, emptyText) {
    if (items.length === 0) {
        return `<div class="authority-empty">${escapeHtml(emptyText)}</div>`;
    }
    return `
        <div class="authority-stack">
            ${items.map(item => `
                <div class="authority-list-card authority-list-card--column">
                    <div class="authority-list-card__meta">
                        <span class="authority-pill authority-pill--${item.status}">${escapeHtml(getJobStatusLabel(item.status))}</span>
                        <span>${escapeHtml(getJobTypeLabel(item.type))}</span>
                        <span>${escapeHtml(formatDate(item.updatedAt))}</span>
                    </div>
                    <div>${escapeHtml(item.summary ? getActivityMessageLabel(item.summary) : '暂无说明')}</div>
                    ${getJobAttemptTimeline(item)
        ? `<div class="authority-muted">${escapeHtml(getJobAttemptTimeline(item))}</div>`
        : ''}
                    ${item.error ? `<div class="authority-inline-note authority-inline-note--error">${escapeHtml(getSystemMessageLabel(item.error))}</div>` : ''}
                </div>
            `).join('')}
        </div>
    `;
}
export function renderJobTable(items, emptyText) {
    if (items.length === 0) {
        return `<div class="authority-empty">${escapeHtml(emptyText)}</div>`;
    }
    return `
        <div class="authority-table-wrap">
            <table class="authority-data-table">
                <thead>
                    <tr>
                        <th>任务</th>
                        <th>状态</th>
                        <th>更新时间</th>
                    </tr>
                </thead>
                <tbody>
                    ${items.map(item => `
                        <tr>
                            <td>
                                <strong>${escapeHtml(getJobTypeLabel(item.type))}</strong>
                                <div class="authority-muted">${escapeHtml(item.summary ? getActivityMessageLabel(item.summary) : item.id)}</div>
                                ${getJobAttemptTimeline(item)
        ? `<div class="authority-muted">${escapeHtml(getJobAttemptTimeline(item))}</div>`
        : ''}
                            </td>
                            <td><span class="authority-pill authority-pill--${item.status}">${escapeHtml(getJobStatusLabel(item.status))}</span></td>
                            <td>${escapeHtml(formatDate(item.updatedAt))}</td>
                        </tr>
                    `).join('')}
                </tbody>
            </table>
        </div>
    `;
}
function getJobAttemptTimeline(item) {
    if (!item.attemptHistory || item.attemptHistory.length === 0) {
        return '';
    }
    return item.attemptHistory
        .slice(-4)
        .map(attempt => {
        const parts = [
            `#${attempt.attempt}`,
            getJobAttemptEventLabel(attempt.event),
            formatDate(attempt.timestamp),
        ];
        if (attempt.backoffMs != null) {
            parts.push(`backoff ${attempt.backoffMs}ms`);
        }
        if (attempt.error) {
            parts.push(getSystemMessageLabel(attempt.error));
        }
        return parts.join(' · ');
    })
        .join(' → ');
}
export function renderPolicyList(items, emptyText) {
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
export function renderPolicyRows(items, emptyText) {
    if (items.length === 0) {
        return `<div class="authority-empty">${escapeHtml(emptyText)}</div>`;
    }
    return `
        <div class="authority-settings-list">
            ${items.map(item => renderSettingsRow(getResourceLabel(item.resource), `${item.target} · ${formatDate(item.updatedAt)}`, `<span class="authority-pill authority-pill--${item.status}">${escapeHtml(getStatusLabel(item.status))}</span>`, item.status === 'granted' ? 'success' : item.status === 'denied' || item.status === 'blocked' ? 'error' : 'warning')).join('')}
        </div>
    `;
}
export function renderDatabaseList(items, emptyText) {
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
                        <div class="authority-muted">${escapeHtml(`${item.runtimeConfig.journalMode.toUpperCase()} · sync ${item.runtimeConfig.synchronous} · FK ${item.runtimeConfig.foreignKeys ? 'ON' : 'OFF'}`)}</div>
                    </div>
                    <div class="authority-list-card__actions">
                        <span class="authority-pill authority-pill--runtime">${escapeHtml(getSqlSlowQueryLabel(item))}</span>
                        <span class="authority-pill authority-pill--prompt">${escapeHtml(formatBytes(item.sizeBytes))}</span>
                        <span class="authority-muted">${escapeHtml(formatDate(item.updatedAt ?? undefined))}</span>
                    </div>
                </div>
            `).join('')}
        </div>
    `;
}
export function renderDatabaseTable(items, emptyText) {
    if (items.length === 0) {
        return `<div class="authority-empty">${escapeHtml(emptyText)}</div>`;
    }
    return `
        <div class="authority-table-wrap">
            <table class="authority-data-table">
                <thead>
                    <tr>
                        <th>数据库</th>
                        <th>文件</th>
                        <th>运行时</th>
                        <th>慢查询诊断</th>
                        <th>体积</th>
                        <th>更新时间</th>
                    </tr>
                </thead>
                <tbody>
                    ${items.map(item => `
                        <tr>
                            <td><strong>${escapeHtml(item.name)}</strong></td>
                            <td>${escapeHtml(item.fileName)}</td>
                            <td>
                                ${escapeHtml(getSqlRuntimeConfigLabel(item))}
                                <div class="authority-muted">${escapeHtml(getSqlRuntimeConfigMeta(item))}</div>
                            </td>
                            <td>
                                <span class="authority-pill authority-pill--runtime">${escapeHtml(getSqlSlowQueryLabel(item))}</span>
                                <div class="authority-muted">${escapeHtml(getSqlSlowQueryMeta(item))}</div>
                            </td>
                            <td>${escapeHtml(formatBytes(item.sizeBytes))}</td>
                            <td>${escapeHtml(formatDate(item.updatedAt ?? undefined))}</td>
                        </tr>
                    `).join('')}
                </tbody>
            </table>
        </div>
    `;
}
function getSqlRuntimeConfigLabel(item) {
    return `${item.runtimeConfig.journalMode.toUpperCase()} · sync ${item.runtimeConfig.synchronous}`;
}
function getSqlRuntimeConfigMeta(item) {
    return `busy ${item.runtimeConfig.busyTimeoutMs}ms · FK ${item.runtimeConfig.foreignKeys ? 'ON' : 'OFF'} · page ORDER BY ${item.runtimeConfig.pagedQueryRequiresOrderBy ? 'required' : 'optional'}`;
}
function getSqlSlowQueryLabel(item) {
    if (item.slowQuery.count === 0) {
        return '无慢查询';
    }
    return `慢查询 ${item.slowQuery.count} 次`;
}
function getSqlSlowQueryMeta(item) {
    if (item.slowQuery.count === 0) {
        return '尚未记录到 slow SQL';
    }
    return `${item.slowQuery.lastElapsedMs ?? '未知'}ms · ${item.slowQuery.lastStatementPreview ?? '未记录'} · ${formatDate(item.slowQuery.lastOccurredAt ?? undefined)}`;
}
export function renderTriviumDatabaseList(items, emptyText) {
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
                        <span class="authority-pill authority-pill--runtime">${escapeHtml(item.storageMode ?? '未知模式')}</span>
                        <span class="authority-pill authority-pill--${escapeHtml(getTriviumIndexHealthTone(item))}">${escapeHtml(getTriviumIndexHealthLabel(item))}</span>
                        <span class="authority-pill authority-pill--prompt">${escapeHtml(formatBytes(item.totalSizeBytes))}</span>
                        <span class="authority-muted">${escapeHtml(formatDate(item.updatedAt ?? undefined))}</span>
                    </div>
                </div>
            `).join('')}
        </div>
    `;
}
export function renderTriviumDatabaseTable(items, emptyText) {
    if (items.length === 0) {
        return `<div class="authority-empty">${escapeHtml(emptyText)}</div>`;
    }
    return `
        <div class="authority-table-wrap">
            <table class="authority-data-table">
                <thead>
                    <tr>
                        <th>记忆库</th>
                        <th>文件</th>
                        <th>维度 / 类型</th>
                        <th>索引健康</th>
                        <th>存储</th>
                        <th>体积</th>
                        <th>更新时间</th>
                    </tr>
                </thead>
                <tbody>
                    ${items.map(item => `
                        <tr>
                            <td><strong>${escapeHtml(item.name)}</strong></td>
                            <td>${escapeHtml(item.fileName)}</td>
                            <td>${escapeHtml(item.dim ? `${item.dim} · ${item.dtype ?? '未知类型'}` : item.dtype ?? '未记录')}</td>
                            <td>
                                <span class="authority-pill authority-pill--${escapeHtml(getTriviumIndexHealthTone(item))}">${escapeHtml(getTriviumIndexHealthLabel(item))}</span>
                                <div class="authority-muted">${escapeHtml(getTriviumIndexHealthMeta(item))}</div>
                            </td>
                            <td>${escapeHtml(item.storageMode ?? '未记录')}</td>
                            <td>${escapeHtml(formatBytes(item.totalSizeBytes))}</td>
                            <td>${escapeHtml(formatDate(item.updatedAt ?? undefined))}</td>
                        </tr>
                    `).join('')}
                </tbody>
            </table>
        </div>
    `;
}
export function renderDatabaseAssetSections(databases, triviumDatabases, emptyText) {
    if (databases.length === 0 && triviumDatabases.length === 0) {
        return `<div class="authority-empty">${escapeHtml(emptyText)}</div>`;
    }
    return `
        <div class="authority-stack">
            <section class="authority-card authority-card--flat">
                <div class="authority-card__header">
                    <div>
                        <h3>SQL 私有数据库</h3>
                        <div class="authority-muted">传统结构化数据库文件</div>
                    </div>
                    <div class="authority-list-card__actions">
                        <span class="authority-pill authority-pill--prompt">${databases.length} 个</span>
                        <span class="authority-pill authority-pill--prompt">${escapeHtml(formatBytes(databases.reduce((sum, item) => sum + item.sizeBytes, 0)))}</span>
                    </div>
                </div>
                ${renderDatabaseTable(databases, '当前没有 SQL 私有数据库。')}
            </section>
            <section class="authority-card authority-card--flat">
                <div class="authority-card__header">
                    <div>
                        <h3>Trivium 私有记忆库</h3>
                        <div class="authority-muted">向量 / 图谱 / 文本混合检索数据库</div>
                    </div>
                    <div class="authority-list-card__actions">
                        <span class="authority-pill authority-pill--runtime">${triviumDatabases.length} 个</span>
                        <span class="authority-pill authority-pill--prompt">${escapeHtml(formatBytes(triviumDatabases.reduce((sum, item) => sum + item.totalSizeBytes, 0)))}</span>
                    </div>
                </div>
                ${renderTriviumDatabaseTable(triviumDatabases, '当前没有 Trivium 私有记忆库。')}
            </section>
        </div>
    `;
}
function getTriviumIndexHealthTone(item) {
    switch (item.indexHealth?.status) {
        case 'fresh':
            return 'granted';
        case 'stale':
            return 'warning';
        default:
            return 'prompt';
    }
}
function getTriviumIndexHealthLabel(item) {
    switch (item.indexHealth?.status) {
        case 'fresh':
            return '索引新鲜';
        case 'stale':
            return '需重建';
        default:
            return '未建索引';
    }
}
function getTriviumIndexHealthMeta(item) {
    const health = item.indexHealth;
    if (!health) {
        return '暂无索引诊断';
    }
    if (health.reason) {
        return health.reason;
    }
    if (health.lastTextRebuildAt) {
        return `最近重建：${formatDate(health.lastTextRebuildAt)}`;
    }
    if (health.lastTextWriteAt) {
        return `最近写入：${formatDate(health.lastTextWriteAt)}`;
    }
    return '暂无索引诊断';
}
export function renderDatabaseGroupList(items, emptyText) {
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
                            <span class="authority-pill authority-pill--prompt">${item.databaseCount} 个库</span>
                            <span class="authority-pill authority-pill--prompt">${escapeHtml(formatBytes(item.totalSizeBytes))}</span>
                        </div>
                    </div>
                    <div class="authority-stack">
                        ${renderDatabaseList(item.databases, '该扩展还没有 SQL 私有数据库。')}
                        ${renderTriviumDatabaseList(item.triviumDatabases, '该扩展还没有 Trivium 私有记忆库。')}
                    </div>
                </div>
            `).join('')}
        </div>
    `;
}
export function renderDatabaseGroupTable(items, emptyText) {
    if (items.length === 0) {
        return `<div class="authority-empty">${escapeHtml(emptyText)}</div>`;
    }
    return `
        <div class="authority-stack">
            ${items.map(item => `
                <section class="authority-card authority-card--flat">
                    <div class="authority-card__header">
                        <div>
                            <h3>${escapeHtml(item.extension.displayName)}</h3>
                            <div class="authority-muted">${escapeHtml(item.extension.id)}</div>
                        </div>
                        <div class="authority-list-card__actions">
                            <span class="authority-pill authority-pill--prompt">${item.databaseCount} 个数据库</span>
                            <span class="authority-pill authority-pill--prompt">${escapeHtml(formatBytes(item.totalSizeBytes))}</span>
                        </div>
                    </div>
                    ${renderDatabaseAssetSections(item.databases, item.triviumDatabases, '该扩展还没有私有数据库。')}
                </section>
            `).join('')}
        </div>
    `;
}
export function renderStorageSummary(storage) {
    return `
        <div class="authority-storage-grid">
            ${renderStorageCard('键值条目', String(storage.kvEntries), '扩展保存的键值数据')}
            ${renderStorageCard('文件数量', String(storage.blobCount), formatBytes(storage.blobBytes))}
            ${renderStorageCard('数据库数量', String(storage.databaseCount), `总计 ${formatBytes(storage.databaseBytes)}`)}
            ${renderStorageCard('SQL 数据库', String(storage.sqlDatabaseCount), formatBytes(storage.sqlDatabaseBytes))}
            ${renderStorageCard('Trivium 记忆库', String(storage.triviumDatabaseCount), formatBytes(storage.triviumDatabaseBytes))}
            ${renderStorageCard('私有文件', String(storage.files.fileCount), `${storage.files.directoryCount} 个目录`)}
            ${renderStorageCard('私有文件体积', formatBytes(storage.files.totalSizeBytes), '仅统计私有文件区')}
            ${renderStorageCard('最近文件更新', storage.files.latestUpdatedAt ? formatDate(storage.files.latestUpdatedAt) : '未记录', '最后一次写入时间')}
        </div>
    `;
}
//# sourceMappingURL=components.js.map
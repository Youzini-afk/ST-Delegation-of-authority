import type { AuthorityGrant, AuthorityPolicyEntry, JobRecord, PermissionResource, SqlDatabaseRecord } from '@stdo/shared-types';
import { escapeHtml, formatDate, formatJson } from '../dom.js';
import {
    formatBytes,
    getActivityKindLabel,
    getActivityMessageLabel,
    getJobStatusLabel,
    getJobTypeLabel,
    getResourceLabel,
    getRiskLabel,
    getRiskLevel,
    getStatusLabel,
    getSystemMessageLabel,
} from './formatters.js';
import type { ActivityRecord, DatabaseGroupSummary, ExtensionStorageSummary } from './types.js';

export type AlertTone = 'info' | 'warning' | 'error';
export type MetricTone = 'neutral' | 'primary' | 'runtime' | 'warning' | 'error' | 'success';

export interface AlertItem {
    tone: AlertTone;
    title: string;
    message: string;
}

export function renderKpiCard(label: string, value: string, meta: string): string {
    return `
        <div class="authority-kpi-card">
            <div class="authority-kpi-card__label">${escapeHtml(label)}</div>
            <div class="authority-kpi-card__value">${escapeHtml(value)}</div>
            <div class="authority-kpi-card__meta">${escapeHtml(meta)}</div>
        </div>
    `;
}

export function renderMetricTile(label: string, value: string, meta: string, tone: MetricTone = 'neutral'): string {
    return `
        <div class="authority-metric-tile authority-metric-tile--${tone}">
            <div class="authority-metric-tile__label">${escapeHtml(label)}</div>
            <div class="authority-metric-tile__value">${escapeHtml(value)}</div>
            <div class="authority-metric-tile__meta">${escapeHtml(meta)}</div>
        </div>
    `;
}

export function renderStorageCard(label: string, value: string, meta: string): string {
    return `
        <div class="authority-storage-card">
            <div class="authority-storage-card__label">${escapeHtml(label)}</div>
            <div class="authority-storage-card__value">${escapeHtml(value)}</div>
            <div class="authority-storage-card__meta">${escapeHtml(meta)}</div>
        </div>
    `;
}

export function renderAlertStack(items: AlertItem[]): string {
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

export function renderCapabilityMatrix(resources: PermissionResource[]): string {
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

export function renderStringList(items: string[], emptyText: string): string {
    if (items.length === 0) {
        return `<div class="authority-empty">${escapeHtml(emptyText)}</div>`;
    }
    return `<div class="authority-chip-row">${items.map(item => `<span class="authority-pill authority-pill--prompt">${escapeHtml(item)}</span>`).join('')}</div>`;
}

export function renderGrantList(extensionId: string, grants: AuthorityGrant[], emptyText: string): string {
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

export function renderSettingsRow(label: string, description: string, control: string, tone: MetricTone = 'neutral'): string {
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

export function renderGrantSettingsRows(extensionId: string, grants: AuthorityGrant[], emptyText: string): string {
    if (grants.length === 0) {
        return `<div class="authority-empty">${escapeHtml(emptyText)}</div>`;
    }

    return `
        <div class="authority-settings-list">
            ${grants.map(grant => renderSettingsRow(
        getResourceLabel(grant.resource),
        grant.target,
        `
                    <span class="authority-pill authority-pill--${getRiskLevel(grant.resource)}">${escapeHtml(getRiskLabel(getRiskLevel(grant.resource)))}</span>
                    <span class="authority-pill authority-pill--${grant.status}">${escapeHtml(getStatusLabel(grant.status))}</span>
                    <button type="button" class="menu_button" data-action="reset-grant" data-extension-id="${escapeHtml(extensionId)}" data-grant-key="${escapeHtml(grant.key)}">重置</button>
                `,
        grant.status === 'granted' ? 'success' : grant.status === 'denied' || grant.status === 'blocked' ? 'error' : 'warning',
    )).join('')}
        </div>
    `;
}

export function renderActivityList(items: ActivityRecord[], emptyText: string): string {
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

export function renderActivityLogRows(items: ActivityRecord[], emptyText: string): string {
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

export function renderJobList(items: JobRecord[], emptyText: string): string {
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
                    ${item.error ? `<div class="authority-inline-note authority-inline-note--error">${escapeHtml(getSystemMessageLabel(item.error))}</div>` : ''}
                </div>
            `).join('')}
        </div>
    `;
}

export function renderJobTable(items: JobRecord[], emptyText: string): string {
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

export function renderPolicyList(items: AuthorityPolicyEntry[], emptyText: string): string {
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

export function renderPolicyRows(items: AuthorityPolicyEntry[], emptyText: string): string {
    if (items.length === 0) {
        return `<div class="authority-empty">${escapeHtml(emptyText)}</div>`;
    }

    return `
        <div class="authority-settings-list">
            ${items.map(item => renderSettingsRow(
        getResourceLabel(item.resource),
        `${item.target} · ${formatDate(item.updatedAt)}`,
        `<span class="authority-pill authority-pill--${item.status}">${escapeHtml(getStatusLabel(item.status))}</span>`,
        item.status === 'granted' ? 'success' : item.status === 'denied' || item.status === 'blocked' ? 'error' : 'warning',
    )).join('')}
        </div>
    `;
}

export function renderDatabaseList(items: SqlDatabaseRecord[], emptyText: string): string {
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

export function renderDatabaseTable(items: SqlDatabaseRecord[], emptyText: string): string {
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
                        <th>体积</th>
                        <th>更新时间</th>
                    </tr>
                </thead>
                <tbody>
                    ${items.map(item => `
                        <tr>
                            <td><strong>${escapeHtml(item.name)}</strong></td>
                            <td>${escapeHtml(item.fileName)}</td>
                            <td>${escapeHtml(formatBytes(item.sizeBytes))}</td>
                            <td>${escapeHtml(formatDate(item.updatedAt))}</td>
                        </tr>
                    `).join('')}
                </tbody>
            </table>
        </div>
    `;
}

export function renderDatabaseGroupList(items: DatabaseGroupSummary[], emptyText: string): string {
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
                    ${renderDatabaseList(item.databases, '该扩展还没有私有数据库。')}
                </div>
            `).join('')}
        </div>
    `;
}

export function renderDatabaseGroupTable(items: DatabaseGroupSummary[], emptyText: string): string {
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
                            <span class="authority-pill authority-pill--prompt">${item.databases.length} 个数据库</span>
                            <span class="authority-pill authority-pill--prompt">${escapeHtml(formatBytes(item.totalSizeBytes))}</span>
                        </div>
                    </div>
                    ${renderDatabaseTable(item.databases, '该扩展还没有私有数据库。')}
                </section>
            `).join('')}
        </div>
    `;
}

export function renderStorageSummary(storage: ExtensionStorageSummary): string {
    return `
        <div class="authority-storage-grid">
            ${renderStorageCard('键值条目', String(storage.kvEntries), '扩展保存的键值数据')}
            ${renderStorageCard('文件数量', String(storage.blobCount), formatBytes(storage.blobBytes))}
            ${renderStorageCard('数据库数量', String(storage.databaseCount), formatBytes(storage.databaseBytes))}
            ${renderStorageCard('私有文件', String(storage.files.fileCount), `${storage.files.directoryCount} 个目录`)}
            ${renderStorageCard('私有文件体积', formatBytes(storage.files.totalSizeBytes), '仅统计私有文件区')}
            ${renderStorageCard('最近文件更新', storage.files.latestUpdatedAt ? formatDate(storage.files.latestUpdatedAt) : '未记录', '最后一次写入时间')}
        </div>
    `;
}

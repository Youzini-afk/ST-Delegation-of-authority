import { escapeHtml, formatDate, formatJson } from '../dom.js';
import { formatBytes, getActivityKindLabel, getResourceLabel, getRiskLabel, getRiskLevel, getStatusLabel, } from './formatters.js';
export function renderKpiCard(label, value, meta) {
    return `
        <div class="authority-kpi-card">
            <div class="authority-kpi-card__label">${escapeHtml(label)}</div>
            <div class="authority-kpi-card__value">${escapeHtml(value)}</div>
            <div class="authority-kpi-card__meta">${escapeHtml(meta)}</div>
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
export function renderCapabilityMatrix(resources) {
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
                    <div>${escapeHtml(item.message)}</div>
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
export function renderStorageSummary(storage) {
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
//# sourceMappingURL=components.js.map
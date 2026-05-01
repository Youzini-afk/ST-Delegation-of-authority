import { escapeHtml } from '../dom.js';
export function normalizeStManagerControlConfig(value) {
    if (!value || typeof value !== 'object') {
        return null;
    }
    const record = value;
    return {
        enabled: Boolean(record.enabled),
        manager_url: typeof record.manager_url === 'string' ? record.manager_url : '',
        control_key_masked: typeof record.control_key_masked === 'string' ? record.control_key_masked : '',
        control_key_fingerprint: typeof record.control_key_fingerprint === 'string' ? record.control_key_fingerprint : '',
    };
}
export function buildStManagerControlPayload(values) {
    return {
        enabled: values.enabled,
        manager_url: values.managerUrl.trim().replace(/\/+$/, ''),
        ...(values.controlKey.trim() ? { control_key: values.controlKey.trim() } : {}),
    };
}
export function renderStManagerControlSection(config, backups, busy) {
    const enabled = Boolean(config?.enabled);
    const disabledAttr = busy ? 'disabled' : '';
    const managerUrl = config?.manager_url ?? '';
    const keyLabel = config?.control_key_masked || '未保存';
    return `
        <section class="authority-card authority-card--flat" data-role="st-manager-control-panel">
            <div class="authority-card__header">
                <div>
                    <h3>ST-Manager 控制</h3>
                    <div class="authority-muted">从酒馆侧触发 ST-Manager 备份、恢复预览与恢复。</div>
                </div>
                <div class="authority-page-actions authority-page-actions--inline">
                    <span class="authority-pill authority-pill--${enabled ? 'granted' : 'warning'}">${enabled ? '已配置' : '未配置'}</span>
                    <span class="authority-pill authority-pill--runtime">${escapeHtml(keyLabel)}</span>
                </div>
            </div>
            <div class="authority-settings-list">
                <div class="authority-settings-row">
                    <div>
                        <strong>连接</strong>
                        <div class="authority-muted">${escapeHtml(managerUrl || '填写 ST-Manager URL 和 Control Key')}</div>
                    </div>
                    <div class="authority-settings-row__control authority-settings-row__control--stacked">
                        <input class="authority-bridge-key-field" data-role="st-manager-control-url" type="url" value="${escapeHtml(managerUrl)}" placeholder="https://manager.example" ${disabledAttr} />
                        <input class="authority-bridge-key-field" data-role="st-manager-control-key" type="password" value="" placeholder="stmc_..." ${disabledAttr} />
                    </div>
                </div>
                <div class="authority-settings-row">
                    <div>
                        <strong>最近备份</strong>
                        <div class="authority-muted">${escapeHtml(String(backups.length))} 个备份可用</div>
                    </div>
                    <div class="authority-bridge-resource-grid">
                        ${backups.map(backup => `
                            <label class="authority-bridge-resource">
                                <input type="radio" name="st-manager-control-backup" data-role="st-manager-control-backup" value="${escapeHtml(backup.backup_id)}" ${disabledAttr} />
                                <span>${escapeHtml(backup.backup_id)} · ${escapeHtml(String(backup.total_files ?? 0))}</span>
                            </label>
                        `).join('') || '<span class="authority-muted">暂无备份</span>'}
                    </div>
                </div>
                <div class="authority-settings-row">
                    <div>
                        <strong>恢复策略</strong>
                        <div class="authority-muted">默认跳过已有文件；允许覆盖时会覆盖酒馆中的同路径资源。</div>
                    </div>
                    <label class="authority-bridge-toggle">
                        <input type="checkbox" data-role="st-manager-control-overwrite" ${disabledAttr} />
                        <span>允许覆盖</span>
                    </label>
                </div>
            </div>
            <div class="authority-policy-footer">
                <div class="authority-chip-row">
                    <span class="authority-pill authority-pill--runtime">${escapeHtml(config?.control_key_fingerprint || '无指纹')}</span>
                </div>
                <div class="authority-page-actions authority-page-actions--inline">
                    <button type="button" class="authority-action-button" data-action="save-st-manager-control" ${disabledAttr}>保存控制配置</button>
                    <button type="button" class="authority-action-button" data-action="probe-st-manager-control" ${disabledAttr}>测试连接</button>
                    <button type="button" class="authority-action-button" data-action="pair-st-manager-control" ${disabledAttr}>同步 Bridge 配置</button>
                    <button type="button" class="authority-action-button authority-action-button--primary" data-action="start-st-manager-backup" ${disabledAttr}>立即备份</button>
                    <button type="button" class="authority-action-button" data-action="refresh-st-manager-backups" ${disabledAttr}>刷新列表</button>
                    <button type="button" class="authority-action-button" data-action="preview-st-manager-restore" ${disabledAttr}>恢复预览</button>
                    <button type="button" class="authority-action-button authority-action-button--primary" data-action="restore-st-manager-backup" ${disabledAttr}>恢复到酒馆</button>
                </div>
            </div>
        </section>
    `;
}
//# sourceMappingURL=st-manager-control.js.map
import { escapeHtml, formatDate } from '../dom.js';
import { formatBytes, getCoreStateLabel, getInstallStatusLabel } from './formatters.js';
import { renderStManagerBridgeSection } from './st-manager-bridge.js';
import { renderStManagerControlSection } from './st-manager-control.js';
const MISSING_TEXT = '未获取';
const SYSTEM_VIEWS = [
    { id: 'runtime', label: '运行状态', description: 'Core、安装与部署' },
    { id: 'recovery', label: '版本与恢复', description: '检查点与安全回退' },
    { id: 'migration', label: '数据迁移', description: '数据包与原生目录' },
    { id: 'diagnostics', label: '诊断', description: '运行信息与诊断导出' },
    { id: 'backup', label: '远程备份', description: 'ST-Manager 与桥接' },
];
export function renderSystemWorkbench(state) {
    return `
        <div class="authority-system-shell">
            ${renderNavigation(state)}
            <div class="authority-system-stage">${renderSelectedView(state)}</div>
        </div>
    `;
}
function renderNavigation(state) {
    const activeOperations = state.packageOperations.filter(item => item.status === 'queued' || item.status === 'running').length
        + state.nativeMigrationOperations.filter(item => item.status === 'applying' || item.status === 'rolling_back').length;
    return `
        <aside class="authority-system-nav" aria-label="系统与恢复">
            <div class="authority-system-nav__header"><strong>系统与恢复</strong></div>
            <nav>
                ${SYSTEM_VIEWS.map(view => `
                    <button type="button"
                        class="authority-system-nav__item ${state.system.selectedView === view.id ? 'authority-system-nav__item--active' : ''}"
                        data-action="system-select-view" data-system-view="${view.id}"
                        ${state.system.selectedView === view.id ? 'aria-current="page"' : ''}>
                        <span>${escapeHtml(view.label)}</span>
                        <small>${escapeHtml(view.description)}</small>
                        ${view.id === 'recovery' && state.system.workspaceStatus?.dirty ? '<i class="authority-system-nav__signal" aria-label="存在未记录变更"></i>' : ''}
                        ${view.id === 'migration' && activeOperations > 0 ? `<i class="authority-system-nav__count">${activeOperations}</i>` : ''}
                    </button>
                `).join('')}
            </nav>
            <div class="authority-system-nav__footer"><span>管理员功能</span><small>高风险操作均会再次确认</small></div>
        </aside>
    `;
}
function renderSelectedView(state) {
    switch (state.system.selectedView) {
        case 'recovery': return renderRecovery(state);
        case 'migration': return renderMigration(state);
        case 'diagnostics': return renderDiagnostics(state);
        case 'backup': return renderBackup(state);
        default: return renderRuntime(state);
    }
}
function renderRuntime(state) {
    const probe = state.probe;
    const core = probe?.core;
    const health = core?.health;
    const result = state.updateResult;
    const attention = Number(Boolean(core?.lastError || health?.lastError))
        + Number(Boolean(probe && ['conflict', 'error', 'missing'].includes(probe.installStatus)));
    const disabled = state.updateInProgress ? 'disabled' : '';
    return `
        <div class="authority-system-view">
            <main class="authority-system-view__main">
                ${viewHeader('运行状态', 'Authority Core、前端 SDK 与服务端插件的当前状态。', `<button type="button" class="authority-text-button" data-action="refresh">刷新</button>
         <button type="button" class="authority-action-button" data-action="export-diagnostic-archive" ${state.packageActionInProgress ? 'disabled' : ''}>导出诊断</button>`, runtimeState(core?.state === 'running' ? 'ready' : 'attention', core?.state === 'running' ? '系统正常' : '需要检查'))}
                <div class="authority-system-view__scroll">
                    <section class="authority-runtime-section">
                        <div class="authority-section-heading"><div><h3>运行时</h3></div></div>
                        <div class="authority-runtime-card">
                            <div class="authority-runtime-card__title">
                                <div><strong>Authority Core</strong>${runtimeState(core?.state === 'running' ? 'ready' : 'attention', getCoreStateLabel(core?.state))}</div>
                                <small>${health ? `已运行 ${escapeHtml(formatDuration(health.uptimeMs))}` : '运行信息尚未就绪'}</small>
                            </div>
                            <div class="authority-runtime-facts">
                                ${fact('版本', core?.version ?? probe?.coreBundledVersion ?? MISSING_TEXT)}
                                ${fact('进程 PID', core?.pid ? String(core.pid) : MISSING_TEXT)}
                                ${fact('队列状态', health ? `${health.queuedRequestCount} 等待 · ${health.currentConcurrency} 执行` : MISSING_TEXT)}
                                ${fact('统计', health ? `${health.requestCount} 请求 · ${health.errorCount} 错误` : MISSING_TEXT)}
                            </div>
                            <details class="authority-system-inline-details">
                                <summary>限制与构建信息</summary>
                                <div class="authority-runtime-detail-grid">
                                    ${detailFact('构建编号', health?.buildHash ?? probe?.coreBinarySha256 ?? MISSING_TEXT)}
                                    ${detailFact('监听地址', core?.port ? `127.0.0.1:${core.port}` : MISSING_TEXT)}
                                    ${detailFact('运行模式', health?.runtimeMode ?? MISSING_TEXT)}
                                    ${detailFact('并发', health ? `${health.currentConcurrency} / ${health.maxConcurrency}` : MISSING_TEXT)}
                                    ${detailFact('工作线程', health ? String(health.workerCount) : MISSING_TEXT)}
                                    ${detailFact('任务类型', health?.jobRegistrySummary.jobTypes.join(', ') || MISSING_TEXT)}
                                </div>
                            </details>
                        </div>
                    </section>

                    <section class="authority-runtime-section">
                        <div class="authority-section-heading"><div><h3>安装与部署</h3><div class="authority-muted">更新只允许 Git 快进，不会丢弃本地修改。</div></div></div>
                        <div class="authority-component-table">
                            <div class="authority-component-table__head"><span>组件</span><span>当前状态</span><span>校验结果</span><span>操作</span></div>
                            <div><strong>服务端插件</strong><code title="${escapeHtml(probe?.pluginVersion ?? MISSING_TEXT)}">${escapeHtml(probe?.pluginVersion ?? MISSING_TEXT)}</code><span>${escapeHtml(probe ? getInstallStatusLabel(probe.installStatus) : MISSING_TEXT)}</span><button type="button" class="authority-text-button" data-action="admin-update" data-update-action="git-pull" ${disabled}>更新</button></div>
                            <div><strong>前端 SDK</strong><code title="${escapeHtml(probe?.sdkDeployedVersion ?? MISSING_TEXT)}">${escapeHtml(probe?.sdkDeployedVersion ?? MISSING_TEXT)}</code><span class="${probe?.sdkDeployedVersion === probe?.sdkBundledVersion ? 'authority-status-text--granted' : 'authority-status-text--prompt'}">${probe?.sdkDeployedVersion === probe?.sdkBundledVersion ? '版本一致' : '需要部署'}</span><button type="button" class="authority-text-button" data-action="admin-update" data-update-action="redeploy-sdk" ${disabled}>重新部署</button></div>
                            <div><strong>Authority Core</strong><code title="${escapeHtml(probe?.coreArtifactPlatform ?? MISSING_TEXT)}">${escapeHtml(probe?.coreArtifactPlatform ?? MISSING_TEXT)}</code><span class="${probe?.coreVerified ? 'authority-status-text--granted' : 'authority-status-text--denied'}">${probe?.coreVerified ? 'Hash 匹配' : '校验未通过'}</span><span></span></div>
                        </div>
                    </section>

                    <section class="authority-runtime-section">
                        <div class="authority-section-heading"><div><h3>维护</h3></div></div>
                        <div class="authority-maintenance-list">
                            <div><span><strong>更新插件</strong><small>拉取快进更新、部署 SDK 并恢复 Core；服务端代码变化后可能需要重启 SillyTavern。</small></span><button type="button" class="authority-action-button authority-action-button--primary" data-action="admin-update" data-update-action="git-pull" ${disabled}>${state.updateInProgress ? '处理中…' : '开始更新'}</button></div>
                            <div><span><strong>重新部署前端 SDK</strong><small>不访问远端，只重新同步并校验 Authority 前端扩展。</small></span><button type="button" class="authority-action-button" data-action="admin-update" data-update-action="redeploy-sdk" ${disabled}>${state.updateInProgress ? '处理中…' : '重新部署'}</button></div>
                        </div>
                    </section>
                    ${renderUpdateResult(result)}
                </div>
            </main>
            <aside class="authority-context-rail authority-system-inspector">
                <div class="authority-context-rail__header"><strong>维护状态</strong></div>
                <div class="authority-context-rail__scroll">
                    <section class="authority-context-rail__section">
                        <div class="authority-section-heading"><div><h3>需要处理</h3></div><span class="authority-section-count">${attention}</span></div>
                        ${attention === 0 ? okState('当前无需处理') : `<div class="authority-policy-warning"><strong>发现运行问题</strong><span>${escapeHtml(core?.lastError ?? health?.lastError ?? probe?.installMessage ?? '请查看运行状态。')}</span></div>`}
                    </section>
                    <section class="authority-context-rail__section">
                        <div class="authority-section-heading"><div><h3>上次更新</h3></div></div>
                        ${result ? `<div class="authority-last-update"><strong>${escapeHtml(result.message)}</strong><code>${escapeHtml(result.git?.previousRevision?.slice(0, 8) ?? '—')} → ${escapeHtml(result.git?.currentRevision?.slice(0, 8) ?? '—')}</code><span class="${result.requiresRestart ? 'authority-status-text--prompt' : 'authority-status-text--granted'}">${result.requiresRestart ? '需要重启 SillyTavern' : '无需重启'}</span><small>${escapeHtml(formatDate(result.updatedAt))}</small></div>` : '<div class="authority-empty">本次打开后尚未执行更新。</div>'}
                    </section>
                    <section class="authority-context-rail__section">
                        <div class="authority-section-heading"><div><h3>后台操作</h3></div></div>
                        <div class="authority-muted">${state.updateInProgress || state.packageActionInProgress ? '有维护操作正在后台执行。' : '当前没有运行中的维护操作。'}</div>
                    </section>
                </div>
            </aside>
        </div>
    `;
}
function renderRecovery(state) {
    const recovery = state.system;
    if (!recovery.recoveryLoaded && !recovery.recoveryError) {
        return `<div class="authority-system-view authority-system-view--empty">${viewHeader('版本与恢复', '正在读取检查点、当前变更与恢复事务。')}<div class="authority-empty">正在初始化 SillyTavern 的默认恢复范围…</div></div>`;
    }
    if (recovery.recoveryError && !recovery.workspace) {
        return `<div class="authority-system-view authority-system-view--empty">${viewHeader('版本与恢复', '为整个 SillyTavern 建立检查点并执行安全回退。', '<button type="button" class="authority-action-button" data-action="system-recovery-refresh">重试</button>')}<div class="authority-empty"><strong>恢复范围读取失败</strong><span>${escapeHtml(recovery.recoveryError)}</span></div></div>`;
    }
    const workspace = recovery.workspace;
    const status = recovery.workspaceStatus;
    const selected = recovery.workspaceCommits.find(commit => commit.id === recovery.selectedCommitId)
        ?? recovery.workspaceCommits[0] ?? null;
    const selectedNumber = selected ? recovery.workspaceCommits.length - recovery.workspaceCommits.indexOf(selected) : 0;
    const headId = workspace?.headCommitId ?? null;
    const disabled = recovery.recoveryBusy || recovery.recoveryLoading ? 'disabled' : '';
    return `
        <div class="authority-system-recovery">
            <aside class="authority-recovery-history">
                <div class="authority-recovery-history__header"><span><strong>恢复历史</strong><small>${escapeHtml(workspace?.displayName ?? 'SillyTavern')}</small></span><button type="button" class="authority-text-button" data-action="system-recovery-refresh" ${disabled}>刷新</button></div>
                <div class="authority-recovery-status ${status?.dirty ? 'authority-recovery-status--dirty' : ''}"><strong>${status?.dirty ? `当前有 ${status.changes.length} 项未保存变更` : '当前工作树已受检查点保护'}</strong><small>${status?.dirty ? '建立检查点后再进行高风险操作。' : '没有未记录的路径变化。'}</small></div>
                <div class="authority-recovery-checkpoint"><input type="text" data-role="system-checkpoint-message" placeholder="检查点说明" aria-label="检查点说明" ${disabled}/><button type="button" class="authority-action-button authority-action-button--primary" data-action="system-recovery-checkpoint" ${disabled}>建立检查点</button></div>
                <div class="authority-recovery-commit-list">
                    ${recovery.workspaceCommits.map((commit, index) => `<button type="button" class="authority-recovery-commit ${commit.id === selected?.id ? 'authority-recovery-commit--active' : ''}" data-action="system-select-checkpoint" data-commit-id="${escapeHtml(commit.id)}"><span><strong>CP-${String(recovery.workspaceCommits.length - index).padStart(2, '0')}</strong>${commit.id === headId ? '<i>当前</i>' : ''}</span><b>${escapeHtml(commit.message)}</b><small>${escapeHtml(formatDate(commit.createdAt))} · ${escapeHtml(commit.actor.kind)}</small></button>`).join('') || '<div class="authority-empty">还没有检查点。</div>'}
                </div>
            </aside>

            <div class="authority-recovery-detail">
                <main class="authority-recovery-diff">
                    <header class="authority-mobile-recovery-header authority-mobile-only">
                        <button type="button" data-action="mobile-close-surface" aria-label="返回恢复历史">‹</button>
                        <strong>检查点详情</strong>
                        <span aria-hidden="true"></span>
                    </header>
                    ${viewHeader(selected ? `CP-${String(selectedNumber).padStart(2, '0')} · ${selected.message}` : '版本与恢复', selected ? `${selected.id.slice(0, 12)} · ${formatDate(selected.createdAt)}` : '选择一个检查点查看路径差异。', '', selected?.id === headId ? runtimeState('ready', '当前检查点') : '')}
                    <div class="authority-recovery-diff__scroll">
                        ${status?.pendingRollback ? `<div class="authority-recovery-pending"><strong>检测到未完成的回退事务</strong><span>操作 ${escapeHtml(status.pendingRollback.operationId)} 可以安全继续。</span><button type="button" class="authority-action-button authority-action-button--primary" data-action="system-recovery-resume" ${disabled}>继续回退</button></div>` : ''}
                        ${status?.changes.length ? `<details class="authority-system-inline-details" open><summary>相对当前检查点的未记录变更 <span>${status.changes.length}</span></summary>${renderDiff(status.changes)}</details>` : ''}
                        <section class="authority-runtime-section"><div class="authority-section-heading"><div><h3>检查点内容变化</h3><div class="authority-muted">${selected?.parents.length ? '相对上一个检查点' : '初始检查点'}</div></div><span class="authority-section-count">${recovery.workspaceDiff?.entries.length ?? 0}</span></div>${recovery.workspaceDiff?.entries.length ? renderDiff(recovery.workspaceDiff.entries) : '<div class="authority-empty">该检查点没有可显示的路径差异。</div>'}</section>
                    </div>
                    <footer class="authority-recovery-note">.git、node_modules 与 Authority 历史库不会被纳入检查点。</footer>
                </main>

                <aside class="authority-context-rail authority-recovery-inspector">
                    <div class="authority-context-rail__header"><strong>恢复</strong></div>
                    <div class="authority-context-rail__scroll">
                        <section class="authority-context-rail__section">
                            <div class="authority-section-heading"><div><h3>恢复到此检查点</h3></div></div>
                            ${selected ? `<p>将受跟踪文件恢复到 <code>${escapeHtml(selected.id.slice(0, 12))}</code> 的状态。</p><ul class="authority-impact-list"><li>${recovery.workspaceDiff?.entries.length ?? 0} 个路径属于该检查点差异</li><li>未跟踪文件与排除目录保持不变</li><li>恢复前自动创建安全检查点</li></ul>${selected.id === headId ? okState('当前已经位于此检查点') : `<button type="button" class="authority-action-button authority-action-button--primary authority-block-action" data-action="system-recovery-rollback" data-commit-id="${escapeHtml(selected.id)}" ${disabled}>恢复到此处</button>`}` : '<div class="authority-empty">先建立或选择检查点。</div>'}
                        </section>
                        <section class="authority-context-rail__section"><div class="authority-section-heading"><div><h3>当前保护</h3></div></div>${okState(status?.pendingRollback ? '存在待继续的回退' : '没有待继续的回退')}<div class="authority-muted">当前 HEAD：<code>${escapeHtml(headId?.slice(0, 12) ?? '尚无')}</code></div></section>
                        <details class="authority-context-rail__section authority-offline-rescue"><summary>离线救援</summary><p>即使 SillyTavern 无法启动，也可以在插件目录中运行：</p><code>node runtime/agent.cjs rescue status --workspace ${escapeHtml(workspace?.id ?? 'sillytavern')}</code></details>
                    </div>
                </aside>
            </div>
        </div>
    `;
}
function renderMigration(state) {
    const packages = [...state.packageOperations].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
    const native = [...state.nativeMigrationOperations].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
    const current = packages.find(item => item.status === 'running' || item.status === 'queued') ?? packages[0] ?? null;
    const disabled = state.packageActionInProgress ? 'disabled' : '';
    return `
        <div class="authority-system-view">
            <main class="authority-system-view__main">
                ${viewHeader('数据迁移', '备份、迁移或恢复 Authority 管理的扩展数据。', `<button type="button" class="authority-action-button authority-action-button--primary" data-action="export-portable-package" ${disabled}>${state.packageActionInProgress ? '处理中…' : '创建导出'}</button>`)}
                <div class="authority-system-view__scroll">
                    <section class="authority-runtime-section"><div class="authority-section-heading"><div><h3>Authority 数据包</h3><div class="authority-muted">授权、规则、KV、Blob、私有文件与数据库</div></div></div>${usageSummary(state)}<div class="authority-migration-import"><label><span>导入方式</span><select data-role="import-package-mode" ${disabled}><option value="replace">覆盖导入 · 清空现有数据后导入</option><option value="merge">合并导入 · 保留现有数据并补充</option></select></label><input type="file" data-role="import-package-file" accept=".zip,.authoritypkg.zip,.json,.gz,.authoritypkg,.authoritypkg.json.gz,application/zip,application/json,application/gzip" ${disabled}/><button type="button" class="authority-action-button" data-action="import-portable-package" ${disabled}>开始导入</button></div></section>
                    <section class="authority-runtime-section"><div class="authority-section-heading"><div><h3>操作记录</h3><div class="authority-muted">后台任务不会因关闭界面而中断</div></div><span class="authority-section-count">${packages.length}</span></div>${packageTable(packages, state.packageActionInProgress)}</section>
                    <section class="authority-runtime-section authority-runtime-section--danger"><div class="authority-section-heading"><div><h3>原生 SillyTavern 迁移</h3><div class="authority-muted">从旧 data 或 third-party ZIP 生成预览后再应用</div></div><span class="authority-risk-label authority-risk-label--high">管理员高风险操作</span></div>${nativeMigration(state, native)}</section>
                </div>
            </main>
            <aside class="authority-context-rail authority-migration-inspector"><div class="authority-context-rail__header"><strong>操作详情</strong></div><div class="authority-context-rail__scroll"><section class="authority-context-rail__section">${current ? packageSummary(current) : '<div class="authority-empty">暂无后台迁移操作。</div>'}</section><section class="authority-context-rail__section"><div class="authority-section-heading"><div><h3>数据包范围</h3></div></div><ul class="authority-impact-list"><li>扩展信息与持久授权</li><li>管理员策略</li><li>KV、Blob 与私有文件</li><li>SQL 与 Trivium 数据库</li><li>用量摘要</li></ul></section><section class="authority-context-rail__section"><div class="authority-policy-warning"><strong>按敏感备份保护</strong><span>数据包可能包含密钥材料或私有扩展数据，请勿公开分享。</span></div></section></div></aside>
        </div>
    `;
}
function renderDiagnostics(state) {
    const probe = state.probe;
    const health = probe?.core.health;
    return `
        <div class="authority-system-view">
            <main class="authority-system-view__main">
                ${viewHeader('诊断', '导出可复核的系统快照，或直接检查当前运行限制与数据目录。', `<button type="button" class="authority-action-button" data-action="export-diagnostic-bundle">导出 JSON</button><button type="button" class="authority-action-button authority-action-button--primary" data-action="export-diagnostic-archive" ${state.packageActionInProgress ? 'disabled' : ''}>导出压缩包</button>`)}
                <div class="authority-system-view__scroll">
                    <section class="authority-runtime-section"><div class="authority-section-heading"><div><h3>诊断导出</h3><div class="authority-muted">用于排查安装、Core、权限、任务和扩展数据状态</div></div></div><div class="authority-diagnostic-actions"><div><span><strong>诊断 JSON</strong><small>单文件结构化快照，便于人工检查与问题报告。</small></span><button type="button" class="authority-action-button" data-action="export-diagnostic-bundle">导出 JSON</button></div><div><span><strong>诊断压缩包</strong><small>包含清单化的诊断文件，适合归档或跨机器分析。</small></span><button type="button" class="authority-action-button authority-action-button--primary" data-action="export-diagnostic-archive" ${state.packageActionInProgress ? 'disabled' : ''}>导出压缩包</button></div></div></section>
                    <section class="authority-runtime-section"><div class="authority-section-heading"><div><h3>运行信息</h3></div></div><div class="authority-runtime-detail-grid authority-runtime-detail-grid--diagnostics">${detailFact('插件版本', probe?.pluginVersion ?? MISSING_TEXT)}${detailFact('SDK 版本', probe?.sdkDeployedVersion ?? MISSING_TEXT)}${detailFact('Core 构建', health?.buildHash ?? MISSING_TEXT)}${detailFact('Core API', health?.apiVersion ?? MISSING_TEXT)}${detailFact('数据目录', probe?.storageRoot ?? MISSING_TEXT)}${detailFact('最大请求', probe?.limits.maxRequestBytes ? formatBytes(probe.limits.maxRequestBytes) : MISSING_TEXT)}${detailFact('最大传输', probe?.limits.maxDataTransferBytes ? formatBytes(probe.limits.maxDataTransferBytes) : MISSING_TEXT)}${detailFact('最近错误', health?.lastError ?? probe?.core.lastError ?? '无')}</div></section>
                    <section class="authority-runtime-section"><div class="authority-section-heading"><div><h3>数据占用</h3><div class="authority-muted">诊断包会包含这些区域的规模摘要</div></div></div>${usageSummary(state)}</section>
                </div>
            </main>
            <aside class="authority-context-rail authority-diagnostics-inspector"><div class="authority-context-rail__header"><strong>分享前检查</strong></div><div class="authority-context-rail__scroll"><section class="authority-context-rail__section"><div class="authority-policy-warning"><strong>诊断数据可能敏感</strong><span>其中可能包含本机路径、扩展标识、活动详情和错误文本；发送给他人前请先检查。</span></div></section><section class="authority-context-rail__section"><div class="authority-section-heading"><div><h3>建议提供</h3></div></div><ul class="authority-impact-list"><li>问题发生时间与复现步骤</li><li>诊断压缩包或 JSON</li><li>相关扩展版本</li><li>是否在更新后重启过 ST</li></ul></section></div></aside>
        </div>
    `;
}
function renderBackup(state) {
    return `
        <div class="authority-system-view">
            <main class="authority-system-view__main">
                ${viewHeader('远程备份', '连接 ST-Manager，创建备份、预览恢复并执行恢复。')}
                <div class="authority-system-view__scroll"><section class="authority-runtime-section"><div class="authority-section-heading"><div><h3>ST-Manager 控制</h3><div class="authority-muted">由当前酒馆主动连接 ST-Manager</div></div>${runtimeState(state.stManagerControlConfig?.enabled ? 'ready' : 'attention', state.stManagerControlConfig?.enabled ? '已配置' : '未配置')}</div>${renderStManagerControlSection(state.stManagerControlConfig, state.stManagerControlBackups, state.stManagerControlActionInProgress)}</section><details class="authority-system-inline-details authority-backup-bridge"><summary>高级远程桥接 <span>${state.stManagerBridgeConfig?.enabled ? '已启用' : '未启用'}</span></summary><div class="authority-backup-bridge__body"><div class="authority-inline-note">通常只需要上面的控制配置。仅当 ST-Manager 必须主动回连酒馆时才启用桥接。</div>${renderStManagerBridgeSection(state.stManagerBridgeConfig, state.stManagerBridgeGeneratedKey, state.stManagerBridgeActionInProgress)}</div></details></div>
            </main>
            <aside class="authority-context-rail authority-backup-inspector"><div class="authority-context-rail__header"><strong>备份状态</strong></div><div class="authority-context-rail__scroll"><section class="authority-context-rail__section"><div class="authority-decision-summary"><span><small>控制连接</small><strong class="${state.stManagerControlConfig?.enabled ? 'authority-status-text--granted' : 'authority-status-text--prompt'}">${state.stManagerControlConfig?.enabled ? '开启' : '关闭'}</strong></span><span><small>远程备份</small><strong>${state.stManagerControlBackups.length}</strong></span><span><small>回连桥接</small><strong>${state.stManagerBridgeConfig?.enabled ? '开启' : '关闭'}</strong></span></div></section><section class="authority-context-rail__section"><div class="authority-policy-warning"><strong>恢复前先预览</strong><span>远程恢复会覆盖选定资源；请先运行恢复预览并核对范围。</span></div></section></div></aside>
        </div>
    `;
}
function viewHeader(title, description, actions = '', status = '') {
    return `<header class="authority-system-view__header"><div><div class="authority-system-view__title"><h2>${escapeHtml(title)}</h2>${status}</div><p>${escapeHtml(description)}</p></div>${actions ? `<div class="authority-page-actions">${actions}</div>` : ''}</header>`;
}
function runtimeState(tone, label) {
    return `<span class="authority-runtime-state authority-runtime-state--${tone}"><i></i>${escapeHtml(label)}</span>`;
}
function fact(label, value) {
    return `<span><small>${escapeHtml(label)}</small><strong title="${escapeHtml(value)}">${escapeHtml(value)}</strong></span>`;
}
function detailFact(label, value) {
    return `<span><small>${escapeHtml(label)}</small><code title="${escapeHtml(value)}">${escapeHtml(value)}</code></span>`;
}
function okState(label) {
    return `<div class="authority-system-ok"><i></i><span>${escapeHtml(label)}</span></div>`;
}
function renderUpdateResult(result) {
    if (!result)
        return '';
    return `<section class="authority-runtime-section"><div class="authority-section-heading"><div><h3>最近一次更新</h3><div class="authority-muted">${escapeHtml(result.message)}</div></div>${runtimeState(result.requiresRestart ? 'attention' : 'ready', result.requiresRestart ? '需要重启 ST' : '无需重启 ST')}</div><div class="authority-update-result">${fact('插件版本', `${result.before.pluginVersion} → ${result.after.pluginVersion}`)}${fact('前端版本', `${result.before.sdkDeployedVersion ?? '未部署'} → ${result.after.sdkDeployedVersion ?? '未部署'}`)}${fact('后台服务', getCoreStateLabel(result.core.state))}</div>${result.git ? `<details class="authority-system-inline-details"><summary>Git 输出 <span>${escapeHtml(result.git.branch ?? '未获取')} · ${escapeHtml(result.git.previousRevision ?? '未知')} → ${escapeHtml(result.git.currentRevision ?? '未知')}</span></summary><div>${result.git.stdout ? `<pre class="authority-code-block">${escapeHtml(result.git.stdout)}</pre>` : ''}${result.git.stderr ? `<pre class="authority-code-block">${escapeHtml(result.git.stderr)}</pre>` : ''}</div></details>` : ''}</section>`;
}
function usageSummary(state) {
    const usage = state.usageSummary;
    if (!usage)
        return '<div class="authority-empty">暂时还没拿到数据占用概览。</div>';
    return `<div class="authority-system-usage-summary">${fact('扩展', String(usage.totals.extensionCount))}${fact('存储文件', `${usage.totals.blobCount} · ${formatBytes(usage.totals.blobBytes)}`)}${fact('SQL / Trivium', `${usage.totals.databaseCount} · ${formatBytes(usage.totals.databaseBytes)}`)}${fact('私有文件', `${usage.totals.files.fileCount} · ${formatBytes(usage.totals.files.totalSizeBytes)}`)}${fact('键值条目', String(usage.totals.kvEntries))}</div>`;
}
function packageTable(items, busy) {
    if (!items.length)
        return '<div class="authority-empty">暂时还没有导入或导出任务。</div>';
    return `<div class="authority-table-wrap"><table class="authority-data-table"><thead><tr><th>操作</th><th>内容</th><th>状态</th><th>进度</th><th>更新时间</th><th>结果</th></tr></thead><tbody>${items.map(item => `<tr><td><strong>${item.kind === 'export' ? '导出' : '导入'}</strong><div class="authority-muted">${escapeHtml(item.id)}</div></td><td>${escapeHtml(item.sourceFileName ?? item.summary ?? 'Authority 数据包')}${item.artifact ? `<div class="authority-muted">${escapeHtml(item.artifact.fileName)} · ${escapeHtml(formatBytes(item.artifact.sizeBytes))}</div>` : ''}</td><td>${runtimeState(item.status === 'completed' ? 'ready' : item.status === 'failed' ? 'attention' : 'working', packageStatus(item.status))}</td><td><span class="authority-operation-progress"><i style="--progress:${Math.max(0, Math.min(100, item.progress))}%"></i></span><small>${item.progress}%</small></td><td>${escapeHtml(formatDate(item.updatedAt))}</td><td><div class="authority-page-actions authority-page-actions--inline">${item.artifact ? `<button type="button" class="authority-text-button" data-action="download-package-operation" data-operation-id="${escapeHtml(item.id)}" ${busy ? 'disabled' : ''}>下载</button>` : ''}${item.status === 'failed' ? `<button type="button" class="authority-text-button" data-action="resume-package-operation" data-operation-id="${escapeHtml(item.id)}" ${busy ? 'disabled' : ''}>恢复</button>` : ''}</div></td></tr>`).join('')}</tbody></table></div>`;
}
function packageSummary(item) {
    return `<div class="authority-operation-summary"><div><code>${escapeHtml(item.id)}</code>${runtimeState(item.status === 'completed' ? 'ready' : item.status === 'failed' ? 'attention' : 'working', packageStatus(item.status))}</div><strong>${item.kind === 'export' ? 'Authority 数据包导出' : 'Authority 数据包导入'}</strong><div class="authority-operation-progress authority-operation-progress--wide"><i style="--progress:${Math.max(0, Math.min(100, item.progress))}%"></i></div><span>${item.progress}% · ${escapeHtml(formatDate(item.updatedAt))}</span>${item.error ? `<div class="authority-inline-note authority-inline-note--error">${escapeHtml(item.error)}</div>` : ''}${item.artifact ? `<button type="button" class="authority-action-button" data-action="download-package-operation" data-operation-id="${escapeHtml(item.id)}">下载 ${escapeHtml(item.artifact.fileName)}</button>` : ''}</div>`;
}
function nativeMigration(state, items) {
    const disabled = state.nativeMigrationActionInProgress ? 'disabled' : '';
    return `<div class="authority-native-migration-inputs"><label><span><strong>旧酒馆 data 目录</strong><small>支持 data/default-user 或直接 default-user。</small></span><input type="file" data-role="native-migration-file" data-target="data" accept=".zip,application/zip" ${disabled}/><button type="button" class="authority-action-button" data-action="preview-native-migration" data-target="data" ${disabled}>上传并预览</button></label><label><span><strong>第三方插件目录</strong><small>支持 extensions/third-party 或直接插件文件夹。</small></span><input type="file" data-role="native-migration-file" data-target="third-party" accept=".zip,application/zip" ${disabled}/><button type="button" class="authority-action-button" data-action="preview-native-migration" data-target="third-party" ${disabled}>上传并预览</button></label></div><div class="authority-guardrail-band"><span>不删除缺失文件</span><span>不运行 npm install</span><span>不重启</span><span>不自动启用脚本</span></div>${items.length ? `<div class="authority-table-wrap"><table class="authority-data-table"><thead><tr><th>迁移任务</th><th>状态</th><th>预览统计</th><th>执行结果</th><th>更新时间</th><th>动作</th></tr></thead><tbody>${items.map(item => nativeRow(item, state.nativeMigrationActionInProgress)).join('')}</tbody></table></div>` : '<div class="authority-empty">暂时还没有原生迁移任务。上传 ZIP 后会先生成预览。</div>'}`;
}
function nativeRow(item, busy) {
    const rejected = item.entries?.filter(entry => entry.action === 'reject').length ?? 0;
    const created = item.entries?.filter(entry => entry.action === 'create').length ?? 0;
    const overwritten = item.entries?.filter(entry => entry.action === 'overwrite').length ?? 0;
    const canApply = item.status === 'previewed' && rejected === 0;
    const canRollback = item.status === 'applied' || item.status === 'needs_rollback';
    return `<tr><td><strong>${item.target === 'data' ? 'Data 目录' : '第三方插件'}</strong><div class="authority-muted">${escapeHtml(item.id)}</div><div class="authority-muted">${escapeHtml(item.sourceFileName)} · ${escapeHtml(formatBytes(item.sourceSizeBytes))}</div></td><td>${runtimeState(item.status === 'applied' || item.status === 'rolled_back' ? 'ready' : item.status === 'failed' || item.status === 'needs_rollback' ? 'attention' : 'working', nativeStatus(item.status))}</td><td><div>${item.entryCount} 个文件 · ${escapeHtml(formatBytes(item.totalSizeBytes))}</div><div class="authority-muted">新增 ${created} · 覆盖候选 ${overwritten} · 拒绝 ${rejected}</div>${item.warnings.length ? `<div class="authority-muted">${escapeHtml(item.warnings.join('；'))}</div>` : ''}</td><td><div>已创建 ${item.createdCount} · 已覆盖 ${item.overwrittenCount} · 已跳过 ${item.skippedCount}</div>${item.error ? `<div class="authority-muted">${escapeHtml(item.error)}</div>` : ''}</td><td>${escapeHtml(formatDate(item.updatedAt))}</td><td><div class="authority-page-actions authority-page-actions--inline">${canApply ? `<select data-role="native-migration-mode" data-operation-id="${escapeHtml(item.id)}" ${busy ? 'disabled' : ''}><option value="skip">跳过已有文件</option><option value="overwrite">覆盖并保留回滚备份</option></select><button type="button" class="authority-text-button" data-action="apply-native-migration" data-operation-id="${escapeHtml(item.id)}" ${busy ? 'disabled' : ''}>应用</button>` : ''}${canRollback ? `<button type="button" class="authority-text-button authority-text-button--danger" data-action="rollback-native-migration" data-operation-id="${escapeHtml(item.id)}" ${busy ? 'disabled' : ''}>回滚</button>` : ''}${rejected ? '<span class="authority-muted">存在被拒绝文件</span>' : ''}</div></td></tr>`;
}
function renderDiff(items) {
    return `<div class="authority-recovery-file-list">${items.map(item => `<div><span class="authority-recovery-file-status authority-recovery-file-status--${escapeHtml(item.status)}">${escapeHtml({ added: 'A', modified: 'M', deleted: 'D', type_changed: 'T' }[item.status] ?? '?')}</span><code>${escapeHtml(item.path)}</code></div>`).join('')}</div>`;
}
function packageStatus(status) {
    return status === 'completed' ? '已完成' : status === 'failed' ? '失败' : status === 'running' ? '处理中' : '排队中';
}
function nativeStatus(status) {
    return { previewed: '已预览', applying: '导入中', applied: '已导入', rolling_back: '回滚中', rolled_back: '已回滚', needs_rollback: '需要回滚', failed: '失败' }[status];
}
function formatDuration(milliseconds) {
    const minutes = Math.max(0, Math.floor(milliseconds / 60_000));
    const days = Math.floor(minutes / 1_440);
    const hours = Math.floor((minutes % 1_440) / 60);
    if (days)
        return `${days} 天 ${hours} 小时`;
    if (hours)
        return `${hours} 小时 ${minutes % 60} 分`;
    return `${minutes} 分钟`;
}
//# sourceMappingURL=system-workbench.js.map
import { escapeHtml, formatDate } from '../dom.js';
const ACTIVE_RUN_STATUSES = new Set([
    'queued', 'running', 'waiting_approval', 'waiting_tool', 'cancelling',
]);
const SENSITIVE_FIELD_NAMES = new Set([
    'apikey', 'authorization', 'accesstoken', 'refreshtoken', 'token', 'secret',
    'clientsecret', 'password', 'passwd', 'cookie', 'setcookie',
]);
export function getActiveAgentSessionRun(snapshot) {
    if (!snapshot)
        return null;
    const ref = snapshot.refs.find(item => item.name === 'main') ?? snapshot.refs[0];
    return ref?.activeRunId ? snapshot.runs.find(run => run.id === ref.activeRunId) ?? null : null;
}
export function isActiveAgentSession(snapshot) {
    const run = getActiveAgentSessionRun(snapshot);
    return Boolean(run && ACTIVE_RUN_STATUSES.has(run.status));
}
export function renderAgentWorkbench(state) {
    if (state.loading && !state.loaded) {
        return '<div class="authority-loading">正在载入 Agent 工作台…</div>';
    }
    if (state.error && !state.loaded) {
        return `<div class="authority-empty" role="alert">Agent 工作台载入失败：${escapeHtml(state.error)}</div>`;
    }
    const disabled = state.busy || state.loading ? 'disabled' : '';
    const hasSelectedSession = Boolean(state.selectedSession && !state.creatingSession);
    const selectedWorkspace = state.workspaces.find(workspace => workspace.id === state.selectedWorkspaceId) ?? null;
    return `
        <div class="authority-agent-workbench">
            ${state.error ? `<div class="authority-agent-error" role="alert">${escapeHtml(state.error)}</div>` : ''}
            <div class="authority-agent-ide ${hasSelectedSession ? '' : 'authority-agent-ide--new'}">
                <aside class="authority-agent-rail" aria-label="Agent Sessions">
                    <header class="authority-agent-rail__header">
                        <strong>Sessions</strong>
                        <button type="button" class="authority-agent-icon-button" data-action="agent-refresh" aria-label="刷新 Sessions" title="刷新" ${disabled}>↻</button>
                    </header>
                    <button type="button" class="authority-agent-new-session" data-action="agent-new-session" ${disabled}>＋ 新建 Session</button>
                    <label class="authority-agent-session-search">
                        <span class="sr-only">搜索 Sessions</span>
                        <input type="search" data-role="agent-session-filter" placeholder="搜索 Sessions…" autocomplete="off" ${disabled} />
                    </label>
                    ${renderSessionHistory(state, disabled)}
                </aside>
                <main class="authority-agent-main" data-role="agent-session-main" aria-label="Agent 对话">
                    ${renderAgentSessionMain(state, disabled)}
                </main>
                ${hasSelectedSession ? `<aside class="authority-agent-inspector" aria-label="当前 Session 上下文">${renderInspector(state, selectedWorkspace, disabled)}</aside>` : ''}
            </div>
        </div>
    `;
}
export function getAgentStatusAnnouncement(state) {
    if (state.error)
        return `Agent 错误：${redactSensitiveText(state.error)}`;
    if (state.loading && !state.loaded)
        return '正在载入 Agent 工作台';
    if (state.creatingSession || !state.selectedSession)
        return '新建 Session 已就绪';
    const snapshot = state.selectedSession;
    const run = getActiveAgentSessionRun(snapshot) ?? snapshot.runs.at(-1) ?? null;
    const approvals = snapshot.approvals.filter(approval => approval.status === 'pending').length;
    const queued = snapshot.pendingMessages.length;
    return [
        `Session ${snapshot.session.title}`,
        `状态：${sessionStatusLabel(run?.status ?? 'idle')}`,
        approvals ? `等待 ${approvals} 项审批` : '',
        queued ? `${queued} 条消息排队` : '',
    ].filter(Boolean).join('；');
}
export function renderAgentSessionMain(state, disabled = '') {
    if (state.creatingSession || !state.selectedSession) {
        return renderNewSession(state, disabled);
    }
    const snapshot = state.selectedSession;
    const run = getActiveAgentSessionRun(snapshot);
    const queued = snapshot.pendingMessages.length;
    return `
        <section class="authority-agent-session">
            <div class="authority-agent-session__top">
                <header class="authority-agent-session__header">
                    <div class="authority-agent-session__identity">
                        <h2>${escapeHtml(snapshot.session.title)}</h2>
                        <span>持久 Session · ${escapeHtml(modeLabel(snapshot.session.mode))}</span>
                    </div>
                    <div class="authority-agent-session__actions">
                        ${renderSessionStatus(run?.status ?? 'idle')}
                        ${run && ACTIVE_RUN_STATUSES.has(run.status)
        ? `<button type="button" class="authority-agent-icon-button" data-action="agent-cancel-run" data-session-id="${escapeHtml(snapshot.session.id)}" data-run-id="${escapeHtml(run.id)}" aria-label="取消当前运行" title="取消当前运行" ${disabled}>■</button>`
        : ''}
                        ${run?.status === 'suspended'
        ? `<button type="button" class="authority-action-button authority-action-button--primary" data-action="agent-resume-run" data-session-id="${escapeHtml(snapshot.session.id)}" data-run-id="${escapeHtml(run.id)}" ${disabled}>检查后恢复</button>`
        : ''}
                        ${renderSessionMenu(state, snapshot, disabled)}
                    </div>
                </header>
                ${run?.suspensionReason ? `<div class="authority-agent-recovery-banner"><strong>运行已暂停</strong><span>${escapeHtml(redactSensitiveText(run.suspensionReason))}</span></div>` : ''}
            </div>
            <div class="authority-agent-timeline" data-role="agent-timeline">
                ${renderTimeline(snapshot)}
            </div>
            <footer class="authority-agent-composer">
                ${queued ? `<div class="authority-agent-composer__queue">已有 ${escapeHtml(String(queued))} 条消息等待下一个安全边界</div>` : ''}
                <textarea data-role="agent-message" rows="3" placeholder="继续说明目标、补充上下文，或在运行中调整方向…" aria-label="发送给 Agent" ${disabled}></textarea>
                <div class="authority-agent-composer__bar">
                    <label>投递方式
                        <select data-role="agent-message-delivery" ${disabled}>
                            <option value="auto">自动判断</option>
                            <option value="steer">调整当前运行</option>
                            <option value="follow_up">当前运行后继续</option>
                        </select>
                    </label>
                    <span class="authority-muted">当前策略：${escapeHtml(modeLabel(snapshot.session.mode))}</span>
                    <button type="button" class="authority-agent-send" data-action="agent-send-message" data-session-id="${escapeHtml(snapshot.session.id)}" ${disabled}>发送 ↑</button>
                </div>
            </footer>
        </section>
    `;
}
function renderNewSession(state, disabled) {
    const hasProfile = state.profiles.length > 0;
    const canCreate = state.workspaces.length > 0 && hasProfile && !disabled;
    const suggestions = [
        '检查最近的错误，定位原因并修复',
        '梳理当前插件结构，找出最值得重构的部分',
        '帮我处理 SillyTavern 中两个扩展的冲突',
    ];
    return `
        <section class="authority-agent-session authority-agent-session--new">
            <div class="authority-agent-welcome">
                <div class="authority-agent-welcome__mark" aria-hidden="true">A</div>
                <h2>你想让 Agent 做什么？</h2>
                <p>直接描述目标。Authority 会在整个 SillyTavern 范围内理解、执行并保留可恢复的版本记录。</p>
                <div class="authority-agent-suggestions" aria-label="建议任务">
                    ${suggestions.map(prompt => `<button type="button" data-action="agent-use-prompt" data-prompt="${escapeHtml(prompt)}" ${disabled}>${escapeHtml(prompt)}</button>`).join('')}
                </div>
                ${hasProfile ? '' : `<div class="authority-agent-setup-note"><span>开始前需要配置一个模型连接。</span><button type="button" data-tab="settings">前往设置</button></div>`}
            </div>
            <footer class="authority-agent-composer authority-agent-composer--welcome">
                <textarea data-role="agent-new-message" rows="4" placeholder="向 Authority 描述你想完成的事情…" aria-label="新 Session 第一条消息" ${disabled}></textarea>
                <div class="authority-agent-composer__bar">
                    <details class="authority-agent-policy-menu">
                        <summary>执行策略 · 审批后执行</summary>
                        <div class="authority-agent-policy-menu__body">
                            <label class="authority-agent-field">策略
                                <select data-role="agent-new-mode" ${disabled}>
                                    <option value="ask">审批后执行</option>
                                    <option value="plan">只规划，不修改</option>
                                    <option value="auto">按全局策略自动执行</option>
                                </select>
                            </label>
                            <label class="authority-agent-field">单次运行最大步骤
                                <input data-role="agent-new-max-steps" type="number" min="1" max="64" value="24" ${disabled} />
                            </label>
                        </div>
                    </details>
                    <span class="authority-muted">作用域：整个 SillyTavern</span>
                    <button type="button" class="authority-agent-send" data-action="agent-create-session" ${canCreate ? '' : 'disabled'}>开始 ↑</button>
                </div>
            </footer>
        </section>
    `;
}
function renderSessionMenu(state, snapshot, disabled) {
    return `
        <details class="authority-agent-session-menu">
            <summary aria-label="Session 设置" title="Session 设置">•••</summary>
            <div class="authority-agent-session-menu__body">
                <label class="authority-agent-field">标题<input data-role="agent-session-title" value="${escapeHtml(snapshot.session.title)}" ${disabled} /></label>
                <label class="authority-agent-field">模型连接<select data-role="agent-session-profile" ${disabled}>${profileOptions(state.profiles, snapshot.session.profileId)}</select></label>
                <label class="authority-agent-field">执行策略<select data-role="agent-session-mode" ${disabled}>${modeOptions(snapshot.session.mode)}</select></label>
                <label class="authority-agent-field">最大步骤<input data-role="agent-session-max-steps" type="number" min="1" max="64" value="${escapeHtml(String(snapshot.session.maxSteps))}" ${disabled} /></label>
                <button type="button" class="authority-action-button authority-action-button--primary" data-action="agent-update-session" data-session-id="${escapeHtml(snapshot.session.id)}" ${disabled}>保存 Session 设置</button>
            </div>
        </details>
    `;
}
function renderSessionHistory(state, disabled) {
    return `
        <nav class="authority-agent-session-list" aria-label="历史 Sessions">
            ${state.sessions.sessions.map(session => `
                <button type="button" class="authority-agent-session-item ${state.selectedSession?.session.id === session.id && !state.creatingSession ? 'authority-agent-session-item--active' : ''}" data-action="agent-select-session" data-session-id="${escapeHtml(session.id)}" ${disabled}>
                    <span class="authority-agent-session-item__main">
                        <strong>${escapeHtml(session.title)}</strong>
                        <small>${escapeHtml(session.lastMessagePreview ?? '还没有消息')}</small>
                        <small>${escapeHtml(formatDate(session.updatedAt))}</small>
                    </span>
                    <span class="authority-agent-session-item__meta">
                        ${renderSessionStatus(session.status)}
                        ${session.pendingApprovalCount ? `<b title="待审批">${escapeHtml(String(session.pendingApprovalCount))}</b>` : ''}
                    </span>
                </button>
            `).join('') || '<div class="authority-agent-rail__empty">还没有 Session</div>'}
            ${state.sessions.page.hasMore ? `<button type="button" class="authority-agent-load-more" data-action="agent-load-more-sessions" ${disabled}>加载更早记录</button>` : ''}
        </nav>
    `;
}
function renderTimeline(snapshot) {
    const ref = snapshot.refs.find(item => item.name === 'main') ?? snapshot.refs[0];
    const path = new Set(snapshot.activePaths[ref?.name ?? 'main'] ?? []);
    const entries = snapshot.conversation
        .filter(entry => path.has(entry.id))
        .sort((left, right) => left.sequence - right.sequence);
    if (entries.length === 0) {
        return '<div class="authority-agent-timeline__empty"><strong>这段 Session 还没有消息</strong><span>在下方输入框告诉 Agent 你想完成什么。</span></div>';
    }
    return entries.map(entry => renderTimelineEntry(entry, snapshot)).join('');
}
function renderTimelineEntry(entry, snapshot) {
    if (entry.kind === 'compaction') {
        return `<div class="authority-agent-memory-marker"><span>上下文已压缩</span><p>${escapeHtml(previewText(entry.summary, 2_000))}</p></div>`;
    }
    if (entry.kind === 'branch_summary') {
        return `<div class="authority-agent-memory-marker"><span>分支摘要</span><p>${escapeHtml(previewText(entry.summary, 2_000))}</p></div>`;
    }
    if (entry.role === 'tool') {
        const invocation = snapshot.invocations.find(item => item.callId === entry.toolCallId);
        return `
            <article class="authority-agent-tool-line">
                <span class="authority-agent-tool-line__icon">⌁</span>
                <div><strong>${escapeHtml(invocation?.toolId ?? entry.toolCallId ?? '操作')}</strong><span>${escapeHtml(toolStatusLabel(invocation?.status ?? 'completed'))}</span></div>
                ${entry.content ? `<details><summary>查看结果</summary><pre>${escapeHtml(previewText(entry.content, 12_000))}</pre></details>` : ''}
            </article>
        `;
    }
    if (entry.role === 'system') {
        return `<details class="authority-agent-system-message"><summary>Session 指令</summary><pre>${escapeHtml(previewText(entry.content ?? '', 12_000))}</pre></details>`;
    }
    const isUser = entry.role === 'user';
    return `
        <article class="authority-agent-message authority-agent-message--${isUser ? 'user' : 'assistant'}">
            <header><strong>${isUser ? '你' : 'Authority'}</strong><time>${escapeHtml(formatDate(entry.timestamp))}</time></header>
            ${entry.content ? `<div class="authority-agent-message__content">${escapeHtml(previewText(entry.content, 30_000))}</div>` : ''}
            ${entry.toolCalls?.length ? `<div class="authority-agent-message__tools">${entry.toolCalls.map(call => `<span>准备执行 <code>${escapeHtml(call.name)}</code></span>`).join('')}</div>` : ''}
        </article>
    `;
}
function renderInspector(state, selectedWorkspace, disabled) {
    const tabs = [
        ['activity', '任务'], ['workspace', '变更'],
    ];
    return `
        <div class="authority-agent-inspector__tabs" role="tablist" aria-label="Session 上下文">
            ${tabs.map(([value, label]) => `<button type="button" role="tab" id="authority-agent-inspector-tab-${value}" class="${state.inspectorTab === value ? 'is-active' : ''}" data-action="agent-inspector-tab" data-inspector-tab="${value}" aria-selected="${state.inspectorTab === value}" aria-controls="authority-agent-inspector-panel-${value}" tabindex="${state.inspectorTab === value ? '0' : '-1'}" ${disabled}>${label}</button>`).join('')}
        </div>
        <div class="authority-agent-inspector__body">
            <div id="authority-agent-inspector-panel-activity" role="tabpanel" aria-labelledby="authority-agent-inspector-tab-activity" tabindex="0" ${state.inspectorTab === 'activity' ? '' : 'hidden'}>
                ${renderActivityInspector(state, disabled)}
            </div>
            <div id="authority-agent-inspector-panel-workspace" role="tabpanel" aria-labelledby="authority-agent-inspector-tab-workspace" tabindex="0" ${state.inspectorTab === 'workspace' ? '' : 'hidden'}>
                ${renderChangesInspector(state, selectedWorkspace, disabled)}
            </div>
        </div>
    `;
}
function renderActivityInspector(state, disabled) {
    const snapshot = state.selectedSession;
    if (!snapshot || state.creatingSession) {
        return '<div class="authority-agent-inspector-empty"><strong>暂无任务上下文</strong><span>运行、审批和执行记录会在这里出现。</span></div>';
    }
    const run = getActiveAgentSessionRun(snapshot) ?? snapshot.runs.at(-1) ?? null;
    const approvals = snapshot.approvals.filter(approval => approval.status === 'pending');
    const invocations = run ? snapshot.invocations.filter(item => item.runId === run.id) : snapshot.invocations;
    const steps = run ? snapshot.steps.filter(item => item.runId === run.id) : [];
    return `
        ${approvals.length ? `<section class="authority-agent-approval-queue"><header><strong>等待批准</strong><span>${approvals.length}</span></header>${approvals.map(approval => `
            <article class="authority-agent-approval">
                <div><strong>${escapeHtml(redactSensitiveText(approval.title))}</strong><span>${escapeHtml(redactSensitiveText(approval.summary))}</span></div>
                <pre>${escapeHtml(previewValue(approval.arguments))}</pre>
                <div class="authority-page-actions authority-page-actions--inline">
                    <button type="button" class="authority-action-button authority-action-button--primary" data-action="agent-resolve-approval" data-session-id="${escapeHtml(snapshot.session.id)}" data-approval-id="${escapeHtml(approval.id)}" data-decision="approve" ${disabled}>批准</button>
                    <button type="button" class="authority-action-button" data-action="agent-resolve-approval" data-session-id="${escapeHtml(snapshot.session.id)}" data-approval-id="${escapeHtml(approval.id)}" data-decision="deny" ${disabled}>拒绝</button>
                </div>
            </article>
        `).join('')}</section>` : ''}
        <section class="authority-agent-inspector-section">
            <header><strong>当前运行</strong>${run ? renderSessionStatus(run.status) : renderSessionStatus('idle')}</header>
            ${run ? `<dl class="authority-agent-description-list">
                <div><dt>进度</dt><dd>${escapeHtml(`${run.stepCount} / ${run.maxSteps}`)} 步</dd></div>
                <div><dt>策略</dt><dd>${escapeHtml(modeLabel(run.mode))}</dd></div>
                <div><dt>恢复</dt><dd>${escapeHtml(String(run.resumeCount))} 次</dd></div>
            </dl>${run.error ? `<div class="authority-inline-note">${escapeHtml(redactSensitiveText(run.error))}</div>` : ''}` : '<div class="authority-muted">Session 当前空闲。</div>'}
        </section>
        ${snapshot.pendingMessages.length ? `<section class="authority-agent-inspector-section"><header><strong>等待消息</strong><span>${snapshot.pendingMessages.length}</span></header><div class="authority-agent-queue-list">${snapshot.pendingMessages.map(message => `<div><b>${escapeHtml(queueKindLabel(message.kind))}</b><span>${escapeHtml(previewText(message.content, 500))}</span></div>`).join('')}</div></section>` : ''}
        <section class="authority-agent-inspector-section">
            <header><strong>执行记录</strong><span>${invocations.length}</span></header>
            <div class="authority-agent-tool-trace">${invocations.slice().reverse().map(renderInvocation).join('') || '<div class="authority-muted">尚无执行记录。</div>'}</div>
        </section>
        <details class="authority-agent-inspector-panel">
            <summary><span>运行诊断</span><span>${steps.length} steps · ${snapshot.generations.filter(item => !run || item.runId === run.id).length} generations</span></summary>
            <div class="authority-agent-inspector-panel__body authority-stack">${steps.slice().reverse().map(step => `<div class="authority-list-card"><strong>Step ${step.index + 1}</strong><span>${escapeHtml(step.status)} · ${escapeHtml(formatDate(step.updatedAt))}</span></div>`).join('') || '<div class="authority-muted">没有执行记录。</div>'}</div>
        </details>
    `;
}
function renderChangesInspector(state, selected, disabled) {
    const status = state.workspaceStatus;
    if (!selected) {
        return '<div class="authority-agent-inspector-empty"><strong>版本树尚未就绪</strong><span>Authority 正在初始化 SillyTavern 的默认恢复范围。</span></div>';
    }
    return `
        <section class="authority-agent-inspector-section authority-agent-changes">
            <header><strong>SillyTavern 版本树</strong><button type="button" class="authority-agent-icon-button" data-action="agent-workspace-refresh" aria-label="刷新变更" title="刷新变更" ${disabled}>↻</button></header>
            <div class="authority-agent-workspace-facts">
                <div><strong>${status?.dirty ? '有未记录变更' : '状态干净'}</strong><span>当前状态</span></div>
                <div><strong>${escapeHtml(selected.headCommitId?.slice(0, 10) ?? '尚无')}</strong><span>当前检查点</span></div>
            </div>
            ${status?.pendingRollback ? `<div class="authority-agent-recovery-callout"><span>检测到未完成的回退事务。</span><button type="button" class="authority-action-button authority-action-button--primary" data-action="agent-workspace-resume" ${disabled}>继续回退</button></div>` : ''}
            <div class="authority-agent-checkpoint">
                <input data-role="agent-checkpoint-message" type="text" placeholder="检查点说明" aria-label="检查点说明" ${disabled} />
                <button type="button" class="authority-action-button" data-action="agent-workspace-checkpoint" ${disabled}>建立检查点</button>
            </div>
            ${status?.changes.length ? `<details class="authority-agent-subsection" open><summary><span>当前变更</span><span>${escapeHtml(String(status.changes.length))}</span></summary>${renderDiffEntries(status.changes)}</details>` : '<div class="authority-muted">当前没有未记录变更。</div>'}
            ${state.workspaceDiff?.entries.length ? `<details class="authority-agent-subsection"><summary><span>最近检查点差异</span><span>${escapeHtml(String(state.workspaceDiff.entries.length))}</span></summary>${renderDiffEntries(state.workspaceDiff.entries)}</details>` : ''}
            <div class="authority-agent-subheading"><strong>检查点</strong><span>${escapeHtml(String(state.workspaceCommits.length))}</span></div>
            <div class="authority-agent-commit-list">${state.workspaceCommits.map(commit => renderCommitItem(commit, selected.headCommitId, disabled)).join('') || '<div class="authority-muted">暂无检查点。</div>'}</div>
        </section>
    `;
}
function renderSessionStatus(status) {
    const tone = status === 'completed' || status === 'idle' ? 'granted'
        : status === 'failed' || status === 'suspended' ? 'warning'
            : status === 'running' ? 'runtime' : 'prompt';
    return `<span class="authority-pill authority-pill--${tone}">${escapeHtml(sessionStatusLabel(status))}</span>`;
}
function sessionStatusLabel(status) {
    return {
        idle: '空闲', queued: '排队', running: '运行中', waiting_approval: '等待审批', waiting_tool: '等待操作',
        cancelling: '正在取消', suspended: '已暂停', completed: '已完成', failed: '失败', cancelled: '已取消',
    }[status];
}
function renderInvocation(invocation) {
    return `<article class="authority-agent-tool-trace__item"><div><strong>${escapeHtml(invocation.toolId)}</strong><span>${escapeHtml(toolStatusLabel(invocation.status))}</span></div><details><summary>参数与结果</summary><pre>${escapeHtml(previewValue(invocation.arguments))}</pre>${invocation.result === undefined ? '' : `<pre>${escapeHtml(previewValue(invocation.result))}</pre>`}${invocation.error ? `<p>${escapeHtml(redactSensitiveText(invocation.error))}</p>` : ''}</details></article>`;
}
function toolStatusLabel(status) {
    return {
        pending: '等待执行', waiting_approval: '等待审批', claimed: '执行中', completed: '完成', failed: '失败',
        cancelled: '取消', outcome_unknown: '结果未知', timed_out: '超时',
    }[status];
}
function queueKindLabel(kind) {
    return kind === 'steer' ? '调整' : kind === 'follow_up' ? '继续' : '下一轮';
}
function modeLabel(mode) {
    return mode === 'plan' ? '只规划' : mode === 'auto' ? '按策略自动执行' : '审批后执行';
}
function modeOptions(selected) {
    return [['ask', '审批后执行'], ['plan', '只规划，不修改'], ['auto', '按全局策略自动执行']]
        .map(([value, label]) => `<option value="${value}" ${value === selected ? 'selected' : ''}>${label}</option>`)
        .join('');
}
function renderCommitItem(commit, head, disabled) {
    return `<article class="authority-agent-commit"><div><code>${escapeHtml(commit.id.slice(0, 10))}</code>${commit.id === head ? ' <span class="authority-pill authority-pill--granted">当前</span>' : ''}</div><strong>${escapeHtml(commit.message)}</strong><span class="authority-muted">${escapeHtml(formatDate(commit.createdAt))}</span>${commit.id === head ? '' : `<button type="button" class="authority-action-button" data-action="agent-workspace-rollback" data-commit-id="${escapeHtml(commit.id)}" ${disabled}>回退到这里</button>`}</article>`;
}
function renderDiffEntries(entries) {
    return `<div class="authority-agent-diff-list">${entries.map(entry => `<div><code>${escapeHtml(entry.path)}</code><span>${escapeHtml(entry.status)}</span></div>`).join('')}</div>`;
}
function profileOptions(profiles, selectedId) {
    return profiles.length === 0
        ? '<option value="">尚无模型连接</option>'
        : profiles.map(profile => `<option value="${escapeHtml(profile.id)}" ${profile.id === selectedId ? 'selected' : ''}>${escapeHtml(profile.displayName)} · ${escapeHtml(profile.model)}</option>`).join('');
}
function previewValue(value) {
    try {
        return previewText(JSON.stringify(value, (key, item) => (key && SENSITIVE_FIELD_NAMES.has(key.replace(/[^a-z0-9]/gi, '').toLowerCase()) ? '[REDACTED]' : item), 2), 20_000);
    }
    catch {
        return '[无法序列化]';
    }
}
function previewText(value, maximum) {
    const redacted = redactSensitiveText(value);
    return redacted.length <= maximum ? redacted : `${redacted.slice(0, maximum)}\n…预览已截断`;
}
function redactSensitiveText(value) {
    return value
        .replace(/\b((?:api[\s_-]?key|access[\s_-]?token|refresh[\s_-]?token|authorization|password|passwd|secret|token|cookie|set-cookie)\s*[:=]\s*)(?:(?:Bearer|Basic)\s+)?(?:"[^"\r\n]*"|'[^'\r\n]*'|[^\s,;]+)/gi, '$1[REDACTED]')
        .replace(/\b(Bearer|Basic)\s+[a-zA-Z0-9._~+/=-]+/gi, '$1 [REDACTED]')
        .replace(/\bsk-[a-zA-Z0-9_-]{8,}\b/g, '[REDACTED]')
        .replace(/\beyJ[a-zA-Z0-9_-]{8,}\.[a-zA-Z0-9_-]{8,}\.[a-zA-Z0-9_-]{8,}\b/g, '[REDACTED]')
        .replace(/([?&](?:api[_-]?key|access[_-]?token|token)=)[^&\s]+/gi, '$1[REDACTED]');
}
//# sourceMappingURL=agent-workbench.js.map
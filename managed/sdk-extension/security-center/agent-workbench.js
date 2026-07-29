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
        return `<div class="authority-empty">Agent 工作台载入失败：${escapeHtml(state.error)}</div>`;
    }
    const selectedWorkspace = state.workspaces.find(workspace => workspace.id === state.selectedWorkspaceId) ?? null;
    const selectedProfile = state.profiles.find(profile => profile.id === state.selectedProfileId) ?? null;
    const disabled = state.busy || state.loading ? 'disabled' : '';
    return `
        <div class="authority-agent-workbench">
            ${state.error ? `<div class="authority-agent-error">${escapeHtml(state.error)}</div>` : ''}
            <div class="authority-agent-ide">
                <aside class="authority-agent-rail" aria-label="Agent 会话">
                    <header class="authority-agent-rail__header">
                        <div><span class="authority-eyebrow">Authority Agent</span><strong>会话</strong></div>
                        <button type="button" class="authority-agent-icon-button" data-action="agent-refresh" aria-label="刷新会话" title="刷新" ${disabled}>↻</button>
                    </header>
                    <button type="button" class="authority-agent-new-session" data-action="agent-new-session" ${disabled}>＋ 新会话</button>
                    ${renderSessionHistory(state, disabled)}
                </aside>
                <main class="authority-agent-main" data-role="agent-session-main" aria-label="Agent 对话">
                    ${renderAgentSessionMain(state, disabled)}
                </main>
                <aside class="authority-agent-inspector" aria-label="Agent 上下文与活动">
                    ${renderInspector(state, selectedWorkspace, selectedProfile, disabled)}
                </aside>
            </div>
        </div>
    `;
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
            <header class="authority-agent-session__header">
                <div class="authority-agent-session__identity">
                    <h2>${escapeHtml(snapshot.session.title)}</h2>
                    <span>${escapeHtml(snapshot.session.workspaceId)} · ${escapeHtml(snapshot.session.mode)}</span>
                </div>
                <div class="authority-agent-session__actions">
                    ${renderSessionStatus(run?.status ?? 'idle')}
                    ${run && ACTIVE_RUN_STATUSES.has(run.status)
        ? `<button type="button" class="authority-agent-icon-button" data-action="agent-cancel-run" data-session-id="${escapeHtml(snapshot.session.id)}" data-run-id="${escapeHtml(run.id)}" title="取消当前运行" ${disabled}>■</button>`
        : ''}
                    ${run?.status === 'suspended'
        ? `<button type="button" class="authority-action-button authority-action-button--primary" data-action="agent-resume-run" data-session-id="${escapeHtml(snapshot.session.id)}" data-run-id="${escapeHtml(run.id)}" ${disabled}>检查后恢复</button>`
        : ''}
                </div>
            </header>
            ${run?.suspensionReason ? `<div class="authority-agent-recovery-banner"><strong>运行已暂停</strong><span>${escapeHtml(redactSensitiveText(run.suspensionReason))}</span></div>` : ''}
            <div class="authority-agent-timeline" data-role="agent-timeline">
                ${renderTimeline(snapshot)}
            </div>
            <footer class="authority-agent-composer">
                ${queued ? `<div class="authority-agent-composer__queue">已有 ${escapeHtml(String(queued))} 条消息等待下一个安全边界</div>` : ''}
                <textarea data-role="agent-message" rows="3" placeholder="继续说明目标、补充上下文，或在运行中调整方向…" aria-label="发送给 Agent" ${disabled}></textarea>
                <div class="authority-agent-composer__bar">
                    <label>投递
                        <select data-role="agent-message-delivery" ${disabled}>
                            <option value="auto">自动</option>
                            <option value="steer">调整当前运行</option>
                            <option value="follow_up">当前运行后继续</option>
                        </select>
                    </label>
                    <span class="authority-muted">Enter 换行 · 点击发送执行</span>
                    <button type="button" class="authority-agent-send" data-action="agent-send-message" data-session-id="${escapeHtml(snapshot.session.id)}" ${disabled}>发送 ↑</button>
                </div>
            </footer>
        </section>
    `;
}
function renderNewSession(state, disabled) {
    const canCreate = state.workspaces.length > 0 && state.profiles.length > 0 && !disabled;
    return `
        <section class="authority-agent-session authority-agent-session--new">
            <div class="authority-agent-welcome">
                <div class="authority-agent-welcome__mark">A</div>
                <h2>开始一段持续会话</h2>
                <p>选择工作区和模型，然后直接告诉 Agent 你想完成什么。后续消息会留在同一条会话里。</p>
                <div class="authority-agent-session-setup">
                    <label class="authority-agent-field">工作区<select data-role="agent-new-workspace" ${disabled}>${optionList(state.workspaces, state.selectedWorkspaceId)}</select></label>
                    <label class="authority-agent-field">LLM 配置<select data-role="agent-new-profile" ${disabled}>${profileOptions(state.profiles, state.selectedProfileId)}</select></label>
                    <label class="authority-agent-field">执行模式<select data-role="agent-new-mode" ${disabled}><option value="ask">ask · 变更前审批</option><option value="plan">plan · 只规划</option><option value="auto">auto · 按策略执行</option></select></label>
                    <label class="authority-agent-field">单次运行最大步骤<input data-role="agent-new-max-steps" type="number" min="1" max="64" value="24" ${disabled} /></label>
                </div>
            </div>
            <footer class="authority-agent-composer authority-agent-composer--welcome">
                <textarea data-role="agent-new-message" rows="4" placeholder="例如：检查这个插件的持久化与回退设计，先理解现状，再提出并实施修复。" aria-label="新会话第一条消息" ${disabled}></textarea>
                <div class="authority-agent-composer__bar">
                    <span class="authority-muted">这会创建会话，并启动它的第一次运行</span>
                    <button type="button" class="authority-agent-send" data-action="agent-create-session" ${canCreate ? '' : 'disabled'}>开始 ↑</button>
                </div>
            </footer>
        </section>
    `;
}
function renderSessionHistory(state, disabled) {
    return `
        <nav class="authority-agent-session-list" aria-label="历史会话">
            ${state.sessions.sessions.map(session => `
                <button type="button" class="authority-agent-session-item ${state.selectedSession?.session.id === session.id && !state.creatingSession ? 'authority-agent-session-item--active' : ''}" data-action="agent-select-session" data-session-id="${escapeHtml(session.id)}" ${disabled}>
                    <span class="authority-agent-session-item__main">
                        <strong>${escapeHtml(session.title)}</strong>
                        <small>${escapeHtml(session.lastMessagePreview ?? '还没有消息')}</small>
                        <small>${escapeHtml(formatDate(session.updatedAt))} · ${escapeHtml(session.workspaceId)}</small>
                    </span>
                    <span class="authority-agent-session-item__meta">
                        ${renderSessionStatus(session.status)}
                        ${session.pendingApprovalCount ? `<b title="待审批">${escapeHtml(String(session.pendingApprovalCount))}</b>` : ''}
                    </span>
                </button>
            `).join('') || '<div class="authority-agent-rail__empty">还没有会话</div>'}
            ${state.sessions.page.hasMore ? `<button type="button" class="authority-agent-load-more" data-action="agent-load-more-sessions" ${disabled}>加载更早会话</button>` : ''}
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
        return '<div class="authority-agent-timeline__empty"><strong>这段会话还没有消息</strong><span>在下方输入框告诉 Agent 你想完成什么。</span></div>';
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
                <div><strong>${escapeHtml(invocation?.toolId ?? entry.toolCallId ?? '工具')}</strong><span>${escapeHtml(toolStatusLabel(invocation?.status ?? 'completed'))}</span></div>
                ${entry.content ? `<details><summary>查看结果</summary><pre>${escapeHtml(previewText(entry.content, 12_000))}</pre></details>` : ''}
            </article>
        `;
    }
    if (entry.role === 'system') {
        return `<details class="authority-agent-system-message"><summary>会话指令</summary><pre>${escapeHtml(previewText(entry.content ?? '', 12_000))}</pre></details>`;
    }
    const isUser = entry.role === 'user';
    return `
        <article class="authority-agent-message authority-agent-message--${isUser ? 'user' : 'assistant'}">
            <header><strong>${isUser ? '你' : 'Authority'}</strong><time>${escapeHtml(formatDate(entry.timestamp))}</time></header>
            ${entry.content ? `<div class="authority-agent-message__content">${escapeHtml(previewText(entry.content, 30_000))}</div>` : ''}
            ${entry.toolCalls?.length ? `<div class="authority-agent-message__tools">${entry.toolCalls.map(call => `<span>准备调用 <code>${escapeHtml(call.name)}</code></span>`).join('')}</div>` : ''}
        </article>
    `;
}
function renderInspector(state, selectedWorkspace, selectedProfile, disabled) {
    const tabs = [
        ['activity', '活动'], ['workspace', '变更'], ['settings', '设置'],
    ];
    return `
        <div class="authority-agent-inspector__tabs" role="tablist">
            ${tabs.map(([value, label]) => `<button type="button" role="tab" class="${state.inspectorTab === value ? 'is-active' : ''}" data-action="agent-inspector-tab" data-inspector-tab="${value}" aria-selected="${state.inspectorTab === value}" ${disabled}>${label}</button>`).join('')}
        </div>
        <div class="authority-agent-inspector__body">
            ${state.inspectorTab === 'activity'
        ? renderActivityInspector(state, disabled)
        : state.inspectorTab === 'workspace'
            ? renderWorkspaceStudio(state, selectedWorkspace, disabled, Boolean(state.selectedSession && !state.creatingSession))
            : renderSettingsInspector(state, selectedProfile, disabled)}
        </div>
    `;
}
function renderActivityInspector(state, disabled) {
    const snapshot = state.selectedSession;
    if (!snapshot || state.creatingSession) {
        return '<div class="authority-agent-inspector-empty"><strong>活动将在这里出现</strong><span>工具调用、审批和恢复状态不会挤进对话。</span></div>';
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
                <div><dt>Run</dt><dd><code>${escapeHtml(run.id)}</code></dd></div>
                <div><dt>步骤</dt><dd>${escapeHtml(`${run.stepCount} / ${run.maxSteps}`)}</dd></div>
                <div><dt>模式</dt><dd>${escapeHtml(run.mode)}</dd></div>
                <div><dt>恢复</dt><dd>${escapeHtml(String(run.resumeCount))} 次</dd></div>
            </dl>${run.error ? `<div class="authority-inline-note">${escapeHtml(redactSensitiveText(run.error))}</div>` : ''}` : '<div class="authority-muted">会话当前空闲。</div>'}
        </section>
        ${snapshot.pendingMessages.length ? `<section class="authority-agent-inspector-section"><header><strong>等待消息</strong><span>${snapshot.pendingMessages.length}</span></header><div class="authority-agent-queue-list">${snapshot.pendingMessages.map(message => `<div><b>${escapeHtml(queueKindLabel(message.kind))}</b><span>${escapeHtml(previewText(message.content, 500))}</span></div>`).join('')}</div></section>` : ''}
        <section class="authority-agent-inspector-section">
            <header><strong>工具</strong><span>${invocations.length}</span></header>
            <div class="authority-agent-tool-trace">${invocations.slice().reverse().map(renderInvocation).join('') || '<div class="authority-muted">尚未调用工具。</div>'}</div>
        </section>
        <details class="authority-agent-inspector-panel">
            <summary><span>执行诊断</span><span>${steps.length} steps · ${snapshot.generations.filter(item => !run || item.runId === run.id).length} generations</span></summary>
            <div class="authority-agent-inspector-panel__body authority-stack">${steps.slice().reverse().map(step => `<div class="authority-list-card"><strong>Step ${step.index + 1}</strong><span>${escapeHtml(step.status)} · ${escapeHtml(formatDate(step.updatedAt))}</span></div>`).join('') || '<div class="authority-muted">没有执行记录。</div>'}</div>
        </details>
    `;
}
function renderSettingsInspector(state, selectedProfile, disabled) {
    const snapshot = state.selectedSession;
    return `
        ${snapshot && !state.creatingSession ? `<section class="authority-agent-inspector-section">
            <header><strong>会话设置</strong><span>${escapeHtml(snapshot.session.id.slice(0, 8))}</span></header>
            <div class="authority-stack">
                <label class="authority-agent-field">标题<input data-role="agent-session-title" value="${escapeHtml(snapshot.session.title)}" ${disabled} /></label>
                <label class="authority-agent-field">LLM 配置<select data-role="agent-session-profile" ${disabled}>${profileOptions(state.profiles, snapshot.session.profileId)}</select></label>
                <div class="authority-agent-launch-options">
                    <label class="authority-agent-field">模式<select data-role="agent-session-mode" ${disabled}>${modeOptions(snapshot.session.mode)}</select></label>
                    <label class="authority-agent-field">最大步骤<input data-role="agent-session-max-steps" type="number" min="1" max="64" value="${escapeHtml(String(snapshot.session.maxSteps))}" ${disabled} /></label>
                </div>
                <button type="button" class="authority-action-button" data-action="agent-update-session" data-session-id="${escapeHtml(snapshot.session.id)}" ${disabled}>保存会话设置</button>
            </div>
        </section>` : '<div class="authority-inline-note">新会话的工作区、模型与模式在中间设置。</div>'}
        ${renderProfileStudio(state, selectedProfile, disabled)}
        ${renderToolCatalog(state)}
    `;
}
function renderWorkspaceStudio(state, selected, disabled, locked) {
    const status = state.workspaceStatus;
    return `
        <section class="authority-agent-inspector-section">
            <header><strong>工作区与恢复</strong><span>${escapeHtml(selected?.displayName ?? '未选择')}</span></header>
            <div class="authority-stack">
                <label class="authority-agent-field">当前工作区<select data-role="agent-workspace-select" ${disabled || locked ? 'disabled' : ''}>${optionList(state.workspaces, state.selectedWorkspaceId)}</select></label>
                <div class="authority-page-actions authority-page-actions--inline">
                    <button type="button" class="authority-action-button" data-action="agent-workspace-refresh" ${disabled || !selected ? 'disabled' : ''}>检查状态</button>
                    ${status?.pendingRollback ? `<button type="button" class="authority-action-button authority-action-button--primary" data-action="agent-workspace-resume" ${disabled}>恢复中断的回退</button>` : ''}
                </div>
                ${selected ? `
                    <div class="authority-agent-workspace-facts">
                        <div><strong>${status?.dirty ? '有未提交变更' : '工作区干净'}</strong><span>当前状态</span></div>
                        <div><strong>${escapeHtml(selected.headCommitId?.slice(0, 12) ?? '尚无检查点')}</strong><span>HEAD</span></div>
                    </div>
                    <dl class="authority-agent-description-list">
                        <div><dt>根目录</dt><dd><code>${escapeHtml(selected.rootPath)}</code></dd></div>
                        <div><dt>允许用户</dt><dd>${escapeHtml(selected.allowedUserHandles.join(', ') || '仅管理员')}</dd></div>
                    </dl>
                    <div class="authority-agent-checkpoint">
                        <input data-role="agent-checkpoint-message" type="text" placeholder="检查点说明" aria-label="检查点说明" ${disabled} />
                        <button type="button" class="authority-action-button authority-action-button--primary" data-action="agent-workspace-checkpoint" ${disabled}>建立检查点</button>
                    </div>
                    ${status?.changes.length ? `<details class="authority-agent-subsection"><summary><span>未提交变更</span><span>${escapeHtml(String(status.changes.length))}</span></summary>${renderDiffEntries(status.changes)}</details>` : ''}
                    ${state.workspaceDiff?.entries.length ? `<details class="authority-agent-subsection"><summary><span>历史差异</span><span>${escapeHtml(String(state.workspaceDiff.entries.length))}</span></summary>${renderDiffEntries(state.workspaceDiff.entries)}</details>` : ''}
                    <div class="authority-agent-subheading"><strong>检查点</strong><span>${escapeHtml(String(state.workspaceCommits.length))}</span></div>
                    <div class="authority-agent-commit-list">${state.workspaceCommits.map(commit => renderCommitItem(commit, selected.headCommitId, disabled)).join('') || '<div class="authority-muted">暂无检查点。</div>'}</div>
                ` : '<div class="authority-muted">先注册一个允许 Agent 操作的工作区。</div>'}
                <details class="authority-agent-subsection">
                    <summary><span>注册工作区</span><span>＋</span></summary>
                    <div class="authority-agent-subsection__body authority-stack">
                        <label class="authority-agent-field">显示名称<input data-role="agent-workspace-name" type="text" placeholder="SillyTavern 源码" ${disabled} /></label>
                        <label class="authority-agent-field">根目录<input data-role="agent-workspace-root" type="text" placeholder="C:\\project\\SillyTavern\\SillyTavern" ${disabled} /></label>
                        <label class="authority-agent-field">工作区 ID（可选）<input data-role="agent-workspace-id" type="text" placeholder="sillytavern" ${disabled} /></label>
                        <label class="authority-agent-field">允许用户（逗号分隔）<input data-role="agent-workspace-users" type="text" placeholder="admin" ${disabled} /></label>
                        <button type="button" class="authority-action-button" data-action="agent-register-workspace" ${disabled}>注册</button>
                    </div>
                </details>
            </div>
        </section>
    `;
}
function renderProfileStudio(state, selected, disabled) {
    return `
        <details class="authority-agent-inspector-panel" ${state.profiles.length === 0 ? 'open' : ''}>
            <summary><span>LLM 配置</span><span>${escapeHtml(String(state.profiles.length))}</span></summary>
            <div class="authority-agent-inspector-panel__body authority-stack">
                <div class="authority-muted">密钥只写入服务端；界面只显示掩码与指纹。</div>
                <div class="authority-agent-profile-list">${state.profiles.map(profile => `
                    <div class="authority-agent-profile-item">
                        <span><strong>${escapeHtml(profile.displayName)}</strong><small>${escapeHtml(`${profile.model} · ${profile.baseUrl}`)}</small><small>${escapeHtml(profile.apiKeyConfigured ? `Key ${profile.apiKeyMasked ?? '********'} · ${profile.apiKeyFingerprint ?? '无指纹'}` : '未配置 Key')}</small></span>
                        <div class="authority-page-actions authority-page-actions--inline">
                            <button type="button" class="authority-action-button" data-action="agent-edit-profile" data-profile-id="${escapeHtml(profile.id)}" ${disabled}>编辑</button>
                            <button type="button" class="authority-action-button" data-action="agent-delete-profile" data-profile-id="${escapeHtml(profile.id)}" ${disabled}>删除</button>
                        </div>
                    </div>
                `).join('') || '<div class="authority-muted">尚未配置模型。</div>'}</div>
                <details class="authority-agent-subsection" ${selected ? 'open' : ''}>
                    <summary><span>${selected ? '编辑配置' : '新增配置'}</span><span>＋</span></summary>
                    <div class="authority-agent-subsection__body authority-stack">
                        <input data-role="agent-profile-id" type="hidden" value="${escapeHtml(selected?.id ?? '')}" />
                        <label class="authority-agent-field">名称<input data-role="agent-profile-name" type="text" value="${escapeHtml(selected?.displayName ?? '')}" ${disabled} /></label>
                        <label class="authority-agent-field">模型<input data-role="agent-profile-model" type="text" value="${escapeHtml(selected?.model ?? '')}" ${disabled} /></label>
                        <label class="authority-agent-field">OpenAI-compatible Base URL<input data-role="agent-profile-base-url" type="url" value="${escapeHtml(selected?.baseUrl ?? 'https://api.openai.com/v1')}" ${disabled} /></label>
                        <label class="authority-agent-field">API Key<input data-role="agent-profile-api-key" type="password" autocomplete="new-password" placeholder="${escapeHtml(selected?.apiKeyMasked ?? '留空则不设置')}" ${disabled} /></label>
                        <div class="authority-agent-launch-options">
                            <label class="authority-agent-field">Temperature<input data-role="agent-profile-temperature" type="number" min="0" max="2" step="0.1" value="${escapeHtml(String(selected?.temperature ?? 0.2))}" ${disabled} /></label>
                            <label class="authority-agent-field">最大输出 tokens<input data-role="agent-profile-max-tokens" type="number" min="1" max="1000000" value="${escapeHtml(String(selected?.maxOutputTokens ?? 8192))}" ${disabled} /></label>
                        </div>
                        <label class="authority-agent-field">超时（ms）<input data-role="agent-profile-timeout" type="number" min="1000" max="600000" value="${escapeHtml(String(selected?.timeoutMs ?? 120000))}" ${disabled} /></label>
                        <div class="authority-page-actions">
                            <button type="button" class="authority-action-button authority-action-button--primary" data-action="agent-save-profile" ${disabled}>保存配置</button>
                            ${selected ? `<button type="button" class="authority-action-button" data-action="agent-new-profile" ${disabled}>取消编辑</button>` : ''}
                        </div>
                    </div>
                </details>
            </div>
        </details>
    `;
}
function renderToolCatalog(state) {
    return `
        <details class="authority-agent-inspector-panel">
            <summary><span>工具目录</span><span>${escapeHtml(String(state.tools.length))}</span></summary>
            <div class="authority-agent-inspector-panel__body authority-stack">
                <div class="authority-agent-tool-list">${state.tools.map(tool => `<article class="authority-agent-tool-item"><strong>${escapeHtml(tool.title)}</strong><p>${escapeHtml(tool.description)}</p><small>${escapeHtml(`${tool.id} · ${tool.execution} · ${tool.riskLevel} · ${tool.approvalPolicy}`)}</small></article>`).join('') || '<div class="authority-muted">没有可用工具。</div>'}</div>
            </div>
        </details>
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
        idle: '空闲', queued: '排队', running: '运行中', waiting_approval: '等待审批', waiting_tool: '等待工具',
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
function modeOptions(selected) {
    return [['ask', 'ask · 变更前审批'], ['plan', 'plan · 只规划'], ['auto', 'auto · 按策略执行']]
        .map(([value, label]) => `<option value="${value}" ${value === selected ? 'selected' : ''}>${label}</option>`)
        .join('');
}
function renderCommitItem(commit, head, disabled) {
    return `<article class="authority-agent-commit"><div><code>${escapeHtml(commit.id.slice(0, 12))}</code>${commit.id === head ? ' <span class="authority-pill authority-pill--granted">HEAD</span>' : ''}</div><strong>${escapeHtml(commit.message)}</strong><span class="authority-muted">${escapeHtml(formatDate(commit.createdAt))}</span>${commit.id === head ? '' : `<button type="button" class="authority-action-button" data-action="agent-workspace-rollback" data-commit-id="${escapeHtml(commit.id)}" ${disabled}>回退到这里</button>`}</article>`;
}
function renderDiffEntries(entries) {
    return `<div class="authority-agent-diff-list">${entries.map(entry => `<div><code>${escapeHtml(entry.path)}</code><span>${escapeHtml(entry.status)}</span></div>`).join('')}</div>`;
}
function optionList(items, selectedId) {
    return items.length === 0
        ? '<option value="">尚无工作区</option>'
        : items.map(item => `<option value="${escapeHtml(item.id)}" ${item.id === selectedId ? 'selected' : ''}>${escapeHtml(item.displayName)} · ${escapeHtml(item.id)}</option>`).join('');
}
function profileOptions(profiles, selectedId) {
    return profiles.length === 0
        ? '<option value="">尚无 LLM 配置</option>'
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
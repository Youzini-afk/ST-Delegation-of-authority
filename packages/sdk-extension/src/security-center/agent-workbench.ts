import type {
    AgentLlmProfile,
    AgentRunDetail,
    AgentRunStatus,
    AgentToolInvocation,
    WorkspaceCommitObject,
} from '@stdo/shared-types';
import { escapeHtml, formatDate } from '../dom.js';
import type { AgentWorkbenchState } from './types.js';

const ACTIVE_RUN_STATUSES = new Set<AgentRunStatus>(['queued', 'running', 'waiting_approval', 'waiting_browser_tool']);
const SENSITIVE_FIELD_NAMES = new Set([
    'apikey', 'authorization', 'accesstoken', 'refreshtoken', 'token', 'secret',
    'clientsecret', 'password', 'passwd', 'cookie', 'setcookie',
]);

export function isActiveAgentRun(status: AgentRunStatus): boolean {
    return ACTIVE_RUN_STATUSES.has(status);
}

export function renderAgentWorkbench(state: AgentWorkbenchState): string {
    if (state.loading && !state.loaded) {
        return '<div class="authority-loading">正在载入 Agent 工作台…</div>';
    }
    if (state.error && !state.loaded) {
        return `<div class="authority-empty">Agent 工作台载入失败：${escapeHtml(state.error)}</div>`;
    }

    const selectedProfile = state.profiles.find(profile => profile.id === state.selectedProfileId) ?? null;
    const selectedWorkspace = state.workspaces.find(workspace => workspace.id === state.selectedWorkspaceId) ?? null;
    const disabled = state.busy || state.loading ? 'disabled' : '';

    return `
        <div class="authority-page-stack authority-agent-workbench">
            <div class="authority-page-header">
                <div>
                    <div class="authority-eyebrow">Agent Studio</div>
                    <h2>Agent 工作台</h2>
                    <p>为 SillyTavern 工作区规划、执行、审批和恢复操作。所有变更仍受工具权限、工作区边界与版本检查点约束。</p>
                </div>
                <div class="authority-page-actions">
                    <button type="button" class="authority-action-button" data-action="agent-refresh" ${disabled}>刷新</button>
                    <button type="button" class="authority-action-button" data-action="agent-prune-runs" ${disabled}>保留最近 200 条终态记录</button>
                </div>
            </div>
            ${state.error ? `<div class="authority-inline-note">${escapeHtml(state.error)}</div>` : ''}
            <section class="authority-ops-ribbon">
                <div class="authority-ops-card authority-ops-card--featured"><span class="authority-muted">运行记录</span><strong>${escapeHtml(String(state.runs.page.totalCount))}</strong><div>当前筛选总数</div></div>
                <div class="authority-ops-card"><span class="authority-muted">进行中</span><strong>${escapeHtml(String(state.runs.runs.filter(run => isActiveAgentRun(run.status)).length))}</strong><div>当前页</div></div>
                <div class="authority-ops-card"><span class="authority-muted">工作区</span><strong>${escapeHtml(String(state.workspaces.length))}</strong><div>受版本保护</div></div>
                <div class="authority-ops-card"><span class="authority-muted">可用工具</span><strong>${escapeHtml(String(state.tools.length))}</strong><div>Host / Module / Browser</div></div>
            </section>
            <div class="authority-agent-studio-layout">
                <aside class="authority-agent-sidebar authority-stack">
                    ${renderRunLauncher(state, disabled)}
                    ${renderRunHistory(state, disabled)}
                </aside>
                <main class="authority-agent-main" data-role="agent-run-detail">
                    ${renderAgentRunDetail(state.selectedRun, state.busy)}
                </main>
            </div>
            ${renderWorkspaceStudio(state, selectedWorkspace, disabled)}
            ${renderProfileStudio(state, selectedProfile, disabled)}
            ${renderToolCatalog(state)}
        </div>
    `;
}

export function renderAgentRunDetail(detail: AgentRunDetail | null, busy = false): string {
    if (!detail) {
        return '<section class="authority-card authority-card--flat"><div class="authority-empty">选择一条运行记录查看步骤、审批、工具结果与最终输出。</div></section>';
    }

    const { run } = detail;
    const pendingApprovals = detail.approvals.filter(approval => approval.status === 'pending');
    const disabled = busy ? 'disabled' : '';
    return `
        <section class="authority-card authority-card--flat authority-agent-run-detail">
            <div class="authority-card__header">
                <div>
                    <div class="authority-eyebrow">Run ${escapeHtml(run.id)}</div>
                    <h3>${escapeHtml(redactSensitiveText(run.goal))}</h3>
                    <div class="authority-muted">${escapeHtml(run.workspaceId)} · ${escapeHtml(run.profileId)} · ${escapeHtml(formatDate(run.createdAt))}</div>
                </div>
                <div class="authority-page-actions authority-page-actions--inline">
                    ${renderRunStatus(run.status)}
                    ${isActiveAgentRun(run.status) ? `<button type="button" class="authority-action-button" data-action="agent-cancel-run" data-run-id="${escapeHtml(run.id)}" ${disabled}>取消</button>` : ''}
                </div>
            </div>
            <div class="authority-kv-grid">
                <div><strong>模式</strong><div>${escapeHtml(run.mode)}</div></div>
                <div><strong>步骤</strong><div>${escapeHtml(`${run.stepCount} / ${run.maxSteps}`)}</div></div>
                <div><strong>调用方</strong><div>${escapeHtml(`${run.callerUserHandle} · ${run.callerExtensionId}`)}</div></div>
                <div><strong>更新时间</strong><div>${escapeHtml(formatDate(run.updatedAt))}</div></div>
            </div>
            ${run.error ? `<div class="authority-inline-note authority-inline-note--warning">${escapeHtml(redactSensitiveText(run.error))}</div>` : ''}
            ${pendingApprovals.map(approval => `
                <div class="authority-agent-approval">
                    <div><strong>${escapeHtml(redactSensitiveText(approval.title))}</strong><div class="authority-muted">${escapeHtml(redactSensitiveText(approval.summary))} · 风险 ${escapeHtml(approval.riskLevel)}</div></div>
                    <pre class="authority-code-block">${escapeHtml(previewValue(approval.arguments))}</pre>
                    <div class="authority-page-actions authority-page-actions--inline">
                        <button type="button" class="authority-action-button authority-action-button--primary" data-action="agent-resolve-approval" data-run-id="${escapeHtml(run.id)}" data-approval-id="${escapeHtml(approval.id)}" data-decision="approve" ${disabled}>批准</button>
                        <button type="button" class="authority-action-button" data-action="agent-resolve-approval" data-run-id="${escapeHtml(run.id)}" data-approval-id="${escapeHtml(approval.id)}" data-decision="deny" ${disabled}>拒绝</button>
                    </div>
                </div>
            `).join('')}
            <div class="authority-stack">
                <details open>
                    <summary><strong>对话与输出（${escapeHtml(String(detail.messages.length))}）</strong></summary>
                    <div class="authority-agent-transcript">
                        ${detail.messages.map(message => `
                            <article class="authority-list-card authority-list-card--column">
                                <strong>${escapeHtml(message.role)}${message.toolCallId ? ` · ${escapeHtml(message.toolCallId)}` : ''}</strong>
                                <pre class="authority-code-block">${escapeHtml(previewText(message.content ?? '', 20_000))}</pre>
                            </article>
                        `).join('') || '<div class="authority-empty">暂无消息。</div>'}
                    </div>
                </details>
                <details>
                    <summary><strong>工具调用（${escapeHtml(String(detail.invocations.length))}）</strong></summary>
                    <div class="authority-stack">${detail.invocations.map(renderInvocation).join('') || '<div class="authority-empty">尚未调用工具。</div>'}</div>
                </details>
                <details>
                    <summary><strong>事件（${escapeHtml(String(detail.events.length))}）</strong></summary>
                    <div class="authority-stack">${detail.events.slice().reverse().map(event => `
                        <div class="authority-list-card"><strong>${escapeHtml(event.type)}</strong><span>${escapeHtml(formatDate(event.timestamp))}</span></div>
                    `).join('')}</div>
                </details>
            </div>
        </section>
    `;
}

function renderRunLauncher(state: AgentWorkbenchState, disabled: string): string {
    return `
        <section class="authority-card authority-card--flat">
            <div class="authority-card__header"><div><h3>新建运行</h3><div class="authority-muted">先选择工作区和模型，再描述目标。</div></div></div>
            <div class="authority-stack">
                <label>目标<textarea data-role="agent-run-goal" rows="4" placeholder="例如：定位角色卡加载冲突，给出修复并运行相关测试" ${disabled}></textarea></label>
                <label>补充指令<textarea data-role="agent-run-instructions" rows="3" placeholder="可选：验收标准、不能触碰的范围" ${disabled}></textarea></label>
                <label>工作区<select data-role="agent-run-workspace" ${disabled}>${optionList(state.workspaces, state.selectedWorkspaceId)}</select></label>
                <label>LLM 配置<select data-role="agent-run-profile" ${disabled}>${profileOptions(state.profiles)}</select></label>
                <div class="authority-form-grid">
                    <label>模式<select data-role="agent-run-mode" ${disabled}><option value="ask">ask · 变更前审批</option><option value="plan">plan · 只规划</option><option value="auto">auto · 按策略执行</option></select></label>
                    <label>最大步骤<input data-role="agent-run-max-steps" type="number" min="1" max="64" value="24" ${disabled} /></label>
                </div>
                <button type="button" class="authority-action-button authority-action-button--primary" data-action="agent-create-run" ${disabled}>启动 Agent</button>
            </div>
        </section>
    `;
}

function renderRunHistory(state: AgentWorkbenchState, disabled: string): string {
    const statuses: Array<[AgentRunStatus | '', string]> = [
        ['', '全部状态'], ['queued', '排队'], ['running', '运行中'], ['waiting_approval', '等待审批'],
        ['waiting_browser_tool', '等待浏览器'], ['completed', '已完成'], ['failed', '失败'],
        ['cancelled', '已取消'], ['interrupted', '已中断'],
    ];
    return `
        <section class="authority-card authority-card--flat">
            <div class="authority-card__header"><div><h3>运行历史</h3><div class="authority-muted">${escapeHtml(String(state.runs.page.totalCount))} 条</div></div></div>
            <select data-role="agent-run-status" aria-label="按运行状态筛选" ${disabled}>${statuses.map(([value, label]) => `<option value="${value}" ${state.runStatus === value ? 'selected' : ''}>${label}</option>`).join('')}</select>
            <div class="authority-agent-run-list">
                ${state.runs.runs.map(run => `
                    <button type="button" class="authority-extension-item ${state.selectedRun?.run.id === run.id ? 'is-active' : ''}" data-action="agent-select-run" data-run-id="${escapeHtml(run.id)}" ${disabled}>
                        <span><strong>${escapeHtml(previewText(run.goal, 80))}</strong><small>${escapeHtml(formatDate(run.createdAt))} · ${escapeHtml(run.workspaceId)}</small></span>
                        ${renderRunStatus(run.status)}
                    </button>
                `).join('') || '<div class="authority-empty">暂无运行记录。</div>'}
            </div>
            ${state.runs.page.hasMore ? `<button type="button" class="authority-action-button" data-action="agent-load-more-runs" ${disabled}>加载更多</button>` : ''}
        </section>
    `;
}

function renderWorkspaceStudio(state: AgentWorkbenchState, selected: AgentWorkbenchState['workspaces'][number] | null, disabled: string): string {
    const status = state.workspaceStatus;
    return `
        <section class="authority-card authority-card--flat">
            <div class="authority-card__header"><div><h3>工作区与恢复</h3><div class="authority-muted">检查未提交变更、建立检查点，或回到任意历史提交。</div></div></div>
            <div class="authority-form-grid">
                <label>当前工作区<select data-role="agent-workspace-select" ${disabled}>${optionList(state.workspaces, state.selectedWorkspaceId)}</select></label>
                <div class="authority-page-actions authority-page-actions--inline">
                    <button type="button" class="authority-action-button" data-action="agent-workspace-refresh" ${disabled || !selected ? 'disabled' : ''}>检查状态</button>
                    ${status?.pendingRollback ? `<button type="button" class="authority-action-button authority-action-button--primary" data-action="agent-workspace-resume" ${disabled}>恢复中断的回退</button>` : ''}
                </div>
            </div>
            ${selected ? `
                <div class="authority-kv-grid">
                    <div><strong>根目录</strong><div>${escapeHtml(selected.rootPath)}</div></div>
                    <div><strong>HEAD</strong><div>${escapeHtml(selected.headCommitId ?? '尚无检查点')}</div></div>
                    <div><strong>状态</strong><div>${status?.dirty ? '有未提交变更' : '干净'}</div></div>
                    <div><strong>允许用户</strong><div>${escapeHtml(selected.allowedUserHandles.join(', ') || '仅管理员')}</div></div>
                </div>
                <div class="authority-page-actions">
                    <input data-role="agent-checkpoint-message" type="text" placeholder="检查点说明" ${disabled} />
                    <button type="button" class="authority-action-button authority-action-button--primary" data-action="agent-workspace-checkpoint" ${disabled}>建立检查点</button>
                </div>
                ${status?.changes.length ? `<details><summary><strong>未提交变更（${escapeHtml(String(status.changes.length))}）</strong></summary>${renderDiffEntries(status.changes)}</details>` : ''}
                ${state.workspaceDiff?.entries.length ? `<details><summary><strong>历史差异（${escapeHtml(String(state.workspaceDiff.entries.length))}）</strong></summary>${renderDiffEntries(state.workspaceDiff.entries)}</details>` : ''}
                <div class="authority-table-wrap"><table class="authority-data-table"><thead><tr><th>提交</th><th>说明</th><th>时间</th><th>动作</th></tr></thead><tbody>
                    ${state.workspaceCommits.map(commit => renderCommitRow(commit, selected.headCommitId, disabled)).join('') || '<tr><td colspan="4">暂无检查点。</td></tr>'}
                </tbody></table></div>
            ` : '<div class="authority-empty">先注册一个允许 Agent 操作的工作区。</div>'}
            <details>
                <summary><strong>注册工作区</strong></summary>
                <div class="authority-form-grid">
                    <label>显示名称<input data-role="agent-workspace-name" type="text" placeholder="SillyTavern 源码" ${disabled} /></label>
                    <label>根目录<input data-role="agent-workspace-root" type="text" placeholder="C:\\project\\SillyTavern\\SillyTavern" ${disabled} /></label>
                    <label>工作区 ID（可选）<input data-role="agent-workspace-id" type="text" placeholder="sillytavern" ${disabled} /></label>
                    <label>允许用户（逗号分隔）<input data-role="agent-workspace-users" type="text" placeholder="admin" ${disabled} /></label>
                </div>
                <button type="button" class="authority-action-button" data-action="agent-register-workspace" ${disabled}>注册</button>
            </details>
        </section>
    `;
}

function renderProfileStudio(state: AgentWorkbenchState, selected: AgentLlmProfile | null, disabled: string): string {
    return `
        <section class="authority-card authority-card--flat">
            <div class="authority-card__header"><div><h3>LLM 配置</h3><div class="authority-muted">密钥只写入服务端；界面只显示掩码与指纹。</div></div></div>
            <div class="authority-agent-profile-list">
                ${state.profiles.map(profile => `
                    <div class="authority-list-card">
                        <span><strong>${escapeHtml(profile.displayName)}</strong><small>${escapeHtml(`${profile.model} · ${profile.baseUrl}`)}</small><small>${escapeHtml(profile.apiKeyConfigured ? `Key ${profile.apiKeyMasked ?? '********'} · ${profile.apiKeyFingerprint ?? '无指纹'}` : '未配置 Key')}</small></span>
                        <div class="authority-page-actions authority-page-actions--inline">
                            <button type="button" class="authority-action-button" data-action="agent-edit-profile" data-profile-id="${escapeHtml(profile.id)}" ${disabled}>编辑</button>
                            <button type="button" class="authority-action-button" data-action="agent-delete-profile" data-profile-id="${escapeHtml(profile.id)}" ${disabled}>删除</button>
                        </div>
                    </div>
                `).join('') || '<div class="authority-empty">尚未配置模型。</div>'}
            </div>
            <details ${selected ? 'open' : ''}>
                <summary><strong>${selected ? '编辑配置' : '新增配置'}</strong></summary>
                <div class="authority-form-grid">
                    <input data-role="agent-profile-id" type="hidden" value="${escapeHtml(selected?.id ?? '')}" />
                    <label>名称<input data-role="agent-profile-name" type="text" value="${escapeHtml(selected?.displayName ?? '')}" ${disabled} /></label>
                    <label>模型<input data-role="agent-profile-model" type="text" value="${escapeHtml(selected?.model ?? '')}" ${disabled} /></label>
                    <label>OpenAI-compatible Base URL<input data-role="agent-profile-base-url" type="url" value="${escapeHtml(selected?.baseUrl ?? 'https://api.openai.com/v1')}" ${disabled} /></label>
                    <label>API Key<input data-role="agent-profile-api-key" type="password" autocomplete="new-password" placeholder="${escapeHtml(selected?.apiKeyMasked ?? '留空则不设置')}" ${disabled} /></label>
                    <label>Temperature<input data-role="agent-profile-temperature" type="number" min="0" max="2" step="0.1" value="${escapeHtml(String(selected?.temperature ?? 0.2))}" ${disabled} /></label>
                    <label>最大输出 tokens<input data-role="agent-profile-max-tokens" type="number" min="1" max="1000000" value="${escapeHtml(String(selected?.maxOutputTokens ?? 8192))}" ${disabled} /></label>
                    <label>超时（ms）<input data-role="agent-profile-timeout" type="number" min="1000" max="600000" value="${escapeHtml(String(selected?.timeoutMs ?? 120000))}" ${disabled} /></label>
                </div>
                <div class="authority-page-actions">
                    <button type="button" class="authority-action-button authority-action-button--primary" data-action="agent-save-profile" ${disabled}>保存配置</button>
                    ${selected ? `<button type="button" class="authority-action-button" data-action="agent-new-profile" ${disabled}>取消编辑</button>` : ''}
                </div>
            </details>
        </section>
    `;
}

function renderToolCatalog(state: AgentWorkbenchState): string {
    return `
        <section class="authority-card authority-card--flat">
            <div class="authority-card__header"><div><h3>Agent 工具目录</h3><div class="authority-muted">实际可用范围还会被每次 Run 的 allowedTools、模式与审批策略收窄。</div></div></div>
            <div class="authority-capability-grid">${state.tools.map(tool => `
                <div class="authority-list-card authority-list-card--column"><strong>${escapeHtml(tool.title)}</strong><div>${escapeHtml(tool.description)}</div><small>${escapeHtml(`${tool.id} · ${tool.execution} · ${tool.riskLevel} · ${tool.approvalPolicy}`)}</small></div>
            `).join('') || '<div class="authority-empty">没有可用工具。</div>'}</div>
        </section>
    `;
}

function renderRunStatus(status: AgentRunStatus): string {
    const tone = status === 'completed' ? 'granted'
        : status === 'failed' || status === 'interrupted' ? 'warning'
            : status === 'running' ? 'runtime' : 'prompt';
    return `<span class="authority-pill authority-pill--${tone}">${escapeHtml(runStatusLabel(status))}</span>`;
}

function runStatusLabel(status: AgentRunStatus): string {
    return ({
        queued: '排队', running: '运行中', waiting_approval: '等待审批', waiting_browser_tool: '等待浏览器',
        completed: '已完成', failed: '失败', cancelled: '已取消', interrupted: '已中断',
    } satisfies Record<AgentRunStatus, string>)[status];
}

function renderInvocation(invocation: AgentToolInvocation): string {
    return `<article class="authority-list-card authority-list-card--column"><strong>${escapeHtml(invocation.toolId)} · ${escapeHtml(invocation.status)}</strong><pre class="authority-code-block">${escapeHtml(previewValue(invocation.arguments))}</pre>${invocation.result === undefined ? '' : `<pre class="authority-code-block">${escapeHtml(previewValue(invocation.result))}</pre>`}${invocation.error ? `<div class="authority-muted">${escapeHtml(redactSensitiveText(invocation.error))}</div>` : ''}</article>`;
}

function renderCommitRow(commit: WorkspaceCommitObject, head: string | null, disabled: string): string {
    return `<tr><td><code>${escapeHtml(commit.id.slice(0, 12))}</code>${commit.id === head ? ' <span class="authority-pill authority-pill--granted">HEAD</span>' : ''}</td><td>${escapeHtml(commit.message)}</td><td>${escapeHtml(formatDate(commit.createdAt))}</td><td>${commit.id === head ? '' : `<button type="button" class="authority-action-button" data-action="agent-workspace-rollback" data-commit-id="${escapeHtml(commit.id)}" ${disabled}>回退到这里</button>`}</td></tr>`;
}

function renderDiffEntries(entries: Array<{ path: string; status: string }>): string {
    return `<div class="authority-stack">${entries.map(entry => `<div class="authority-list-card"><code>${escapeHtml(entry.path)}</code><span>${escapeHtml(entry.status)}</span></div>`).join('')}</div>`;
}

function optionList(items: Array<{ id: string; displayName: string }>, selectedId: string | null): string {
    return items.length === 0
        ? '<option value="">尚无工作区</option>'
        : items.map(item => `<option value="${escapeHtml(item.id)}" ${item.id === selectedId ? 'selected' : ''}>${escapeHtml(item.displayName)} · ${escapeHtml(item.id)}</option>`).join('');
}

function profileOptions(profiles: AgentLlmProfile[]): string {
    return profiles.length === 0
        ? '<option value="">尚无 LLM 配置</option>'
        : profiles.map(profile => `<option value="${escapeHtml(profile.id)}">${escapeHtml(profile.displayName)} · ${escapeHtml(profile.model)}</option>`).join('');
}

function previewValue(value: unknown): string {
    try {
        return previewText(JSON.stringify(value, (key, item) => (
            key && SENSITIVE_FIELD_NAMES.has(key.replace(/[^a-z0-9]/gi, '').toLowerCase())
                ? '[REDACTED]'
                : item
        ), 2), 20_000);
    } catch {
        return '[无法序列化]';
    }
}

function previewText(value: string, maximum: number): string {
    const redacted = redactSensitiveText(value);
    return redacted.length <= maximum ? redacted : `${redacted.slice(0, maximum)}\n…预览已截断`;
}

function redactSensitiveText(value: string): string {
    return value
        .replace(/\b((?:api[\s_-]?key|access[\s_-]?token|refresh[\s_-]?token|authorization|password|passwd|secret|token|cookie|set-cookie)\s*[:=]\s*)(?:(?:Bearer|Basic)\s+)?(?:"[^"\r\n]*"|'[^'\r\n]*'|[^\s,;]+)/gi, '$1[REDACTED]')
        .replace(/\b(Bearer|Basic)\s+[a-zA-Z0-9._~+/=-]+/gi, '$1 [REDACTED]')
        .replace(/\bsk-[a-zA-Z0-9_-]{8,}\b/g, '[REDACTED]')
        .replace(/\beyJ[a-zA-Z0-9_-]{8,}\.[a-zA-Z0-9_-]{8,}\.[a-zA-Z0-9_-]{8,}\b/g, '[REDACTED]')
        .replace(/([?&](?:api[_-]?key|access[_-]?token|token)=)[^&\s]+/gi, '$1[REDACTED]');
}

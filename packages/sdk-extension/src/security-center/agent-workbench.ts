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
    const activeRunCount = state.runs.runs.filter(run => isActiveAgentRun(run.status)).length;

    return `
        <div class="authority-agent-workbench">
            <header class="authority-agent-header">
                <div>
                    <div class="authority-eyebrow">Agent workspace</div>
                    <h2>Agent 工作台</h2>
                    <p>规划、执行和审查对 SillyTavern 的变更；每次写入仍受权限、工作区边界与版本检查点保护。</p>
                </div>
                <div class="authority-page-actions">
                    <button type="button" class="authority-action-button" data-action="agent-refresh" ${disabled}>刷新</button>
                    <button type="button" class="authority-action-button" data-action="agent-prune-runs" ${disabled}>保留最近 200 条终态记录</button>
                </div>
            </header>
            ${state.error ? `<div class="authority-inline-note">${escapeHtml(state.error)}</div>` : ''}
            <div class="authority-agent-summary" aria-label="Agent 状态摘要">
                <span><strong>${escapeHtml(String(activeRunCount))}</strong> 进行中</span>
                <span><strong>${escapeHtml(String(state.runs.page.totalCount))}</strong> 条运行</span>
                <span><strong>${escapeHtml(String(state.workspaces.length))}</strong> 个工作区</span>
                <span><strong>${escapeHtml(String(state.tools.length))}</strong> 个工具</span>
            </div>
            <div class="authority-agent-ide">
                <aside class="authority-agent-rail" aria-label="运行与历史">
                    ${renderRunLauncher(state, disabled)}
                    ${renderRunHistory(state, disabled)}
                </aside>
                <section class="authority-agent-main" data-role="agent-run-detail" aria-label="运行详情">
                    ${renderAgentRunDetail(state.selectedRun, state.busy)}
                </section>
                <aside class="authority-agent-inspector" aria-label="工作区与 Agent 配置">
                    <div class="authority-agent-inspector__header">
                        <div>
                            <div class="authority-eyebrow">Inspector</div>
                            <h3>变更与环境</h3>
                        </div>
                    </div>
                    <div class="authority-agent-inspector__body">
                        ${renderWorkspaceStudio(state, selectedWorkspace, disabled)}
                        ${renderProfileStudio(state, selectedProfile, disabled)}
                        ${renderToolCatalog(state)}
                    </div>
                </aside>
            </div>
        </div>
    `;
}

export function renderAgentRunDetail(detail: AgentRunDetail | null, busy = false): string {
    if (!detail) {
        return '<div class="authority-agent-empty"><div><strong>还没有选中运行</strong><p>从左侧选择历史记录，或创建一个新的 Agent 任务。</p></div></div>';
    }

    const { run } = detail;
    const pendingApprovals = detail.approvals.filter(approval => approval.status === 'pending');
    const disabled = busy ? 'disabled' : '';
    return `
        <article class="authority-agent-run-detail">
            <header class="authority-agent-run-header">
                <div>
                    <div class="authority-eyebrow">Run ${escapeHtml(run.id)}</div>
                    <h3>${escapeHtml(redactSensitiveText(run.goal))}</h3>
                    <div class="authority-muted">${escapeHtml(run.workspaceId)} · ${escapeHtml(run.profileId)} · ${escapeHtml(formatDate(run.createdAt))}</div>
                </div>
                <div class="authority-page-actions authority-page-actions--inline">
                    ${renderRunStatus(run.status)}
                    ${isActiveAgentRun(run.status) ? `<button type="button" class="authority-action-button" data-action="agent-cancel-run" data-run-id="${escapeHtml(run.id)}" ${disabled}>取消</button>` : ''}
                </div>
            </header>
            <div class="authority-agent-run-meta">
                <span><strong>模式</strong>${escapeHtml(run.mode)}</span>
                <span><strong>步骤</strong>${escapeHtml(`${run.stepCount} / ${run.maxSteps}`)}</span>
                <span><strong>调用方</strong>${escapeHtml(`${run.callerUserHandle} · ${run.callerExtensionId}`)}</span>
                <span><strong>更新</strong>${escapeHtml(formatDate(run.updatedAt))}</span>
            </div>
            ${run.error ? `<div class="authority-inline-note authority-inline-note--warning">${escapeHtml(redactSensitiveText(run.error))}</div>` : ''}
            ${pendingApprovals.length ? `
                <section class="authority-agent-approval-queue" aria-label="待审批操作">
                    <div class="authority-agent-section-heading"><div><strong>等待你的决定</strong><span>${escapeHtml(String(pendingApprovals.length))} 项操作</span></div></div>
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
                </section>
            ` : ''}
            <section class="authority-agent-conversation">
                <div class="authority-agent-section-heading">
                    <div><strong>对话与输出</strong><span>${escapeHtml(String(detail.messages.length))} 条消息</span></div>
                </div>
                <div class="authority-agent-transcript">
                    ${detail.messages.map(message => `
                        <article class="authority-agent-message">
                            <header><strong>${escapeHtml(message.role)}</strong>${message.toolCallId ? `<code>${escapeHtml(message.toolCallId)}</code>` : ''}</header>
                            <pre class="authority-code-block">${escapeHtml(previewText(message.content ?? '', 20_000))}</pre>
                        </article>
                    `).join('') || '<div class="authority-empty">暂无消息。</div>'}
                </div>
            </section>
            <section class="authority-agent-trace">
                <details>
                    <summary><span>工具调用</span><span>${escapeHtml(String(detail.invocations.length))}</span></summary>
                    <div class="authority-stack">${detail.invocations.map(renderInvocation).join('') || '<div class="authority-empty">尚未调用工具。</div>'}</div>
                </details>
                <details>
                    <summary><span>运行事件</span><span>${escapeHtml(String(detail.events.length))}</span></summary>
                    <div class="authority-stack">${detail.events.slice().reverse().map(event => `
                        <div class="authority-list-card"><strong>${escapeHtml(event.type)}</strong><span>${escapeHtml(formatDate(event.timestamp))}</span></div>
                    `).join('') || '<div class="authority-empty">暂无事件。</div>'}</div>
                </details>
            </section>
        </article>
    `;
}

function renderRunLauncher(state: AgentWorkbenchState, disabled: string): string {
    return `
        <details class="authority-agent-panel authority-agent-launcher" open>
            <summary><span>新建运行</span><span class="authority-muted">描述目标</span></summary>
            <div class="authority-agent-panel__body authority-stack">
                <label class="authority-agent-field">目标<textarea data-role="agent-run-goal" rows="4" placeholder="例如：定位角色卡加载冲突，给出修复并运行相关测试" ${disabled}></textarea></label>
                <label class="authority-agent-field">补充指令<textarea data-role="agent-run-instructions" rows="3" placeholder="可选：验收标准、不能触碰的范围" ${disabled}></textarea></label>
                <label class="authority-agent-field">工作区<select data-role="agent-run-workspace" ${disabled}>${optionList(state.workspaces, state.selectedWorkspaceId)}</select></label>
                <label class="authority-agent-field">LLM 配置<select data-role="agent-run-profile" ${disabled}>${profileOptions(state.profiles)}</select></label>
                <div class="authority-agent-launch-options">
                    <label class="authority-agent-field">模式<select data-role="agent-run-mode" ${disabled}><option value="ask">ask · 变更前审批</option><option value="plan">plan · 只规划</option><option value="auto">auto · 按策略执行</option></select></label>
                    <label class="authority-agent-field">最大步骤<input data-role="agent-run-max-steps" type="number" min="1" max="64" value="24" ${disabled} /></label>
                </div>
                <button type="button" class="authority-action-button authority-action-button--primary" data-action="agent-create-run" ${disabled}>启动 Agent</button>
            </div>
        </details>
    `;
}

function renderRunHistory(state: AgentWorkbenchState, disabled: string): string {
    const statuses: Array<[AgentRunStatus | '', string]> = [
        ['', '全部状态'], ['queued', '排队'], ['running', '运行中'], ['waiting_approval', '等待审批'],
        ['waiting_browser_tool', '等待浏览器'], ['completed', '已完成'], ['failed', '失败'],
        ['cancelled', '已取消'], ['interrupted', '已中断'],
    ];
    return `
        <section class="authority-agent-panel authority-agent-history">
            <div class="authority-agent-panel__header"><strong>运行历史</strong><span class="authority-muted">${escapeHtml(String(state.runs.page.totalCount))} 条</span></div>
            <div class="authority-agent-history__filter"><select data-role="agent-run-status" aria-label="按运行状态筛选" ${disabled}>${statuses.map(([value, label]) => `<option value="${value}" ${state.runStatus === value ? 'selected' : ''}>${label}</option>`).join('')}</select></div>
            <div class="authority-agent-run-list">
                ${state.runs.runs.map(run => `
                    <button type="button" class="authority-agent-run-item ${state.selectedRun?.run.id === run.id ? 'authority-agent-run-item--active' : ''}" data-action="agent-select-run" data-run-id="${escapeHtml(run.id)}" ${disabled}>
                        <span><strong>${escapeHtml(previewText(run.goal, 160))}</strong><small>${escapeHtml(formatDate(run.createdAt))} · ${escapeHtml(run.workspaceId)}</small></span>
                        ${renderRunStatus(run.status)}
                    </button>
                `).join('') || '<div class="authority-empty">暂无运行记录。</div>'}
            </div>
            ${state.runs.page.hasMore ? `<div class="authority-agent-panel__footer"><button type="button" class="authority-action-button" data-action="agent-load-more-runs" ${disabled}>加载更多</button></div>` : ''}
        </section>
    `;
}

function renderWorkspaceStudio(state: AgentWorkbenchState, selected: AgentWorkbenchState['workspaces'][number] | null, disabled: string): string {
    const status = state.workspaceStatus;
    return `
        <details class="authority-agent-inspector-panel" open>
            <summary><span>工作区与恢复</span><span class="authority-muted">${escapeHtml(selected?.displayName ?? '未选择')}</span></summary>
            <div class="authority-agent-inspector-panel__body authority-stack">
                <label class="authority-agent-field">当前工作区<select data-role="agent-workspace-select" ${disabled}>${optionList(state.workspaces, state.selectedWorkspaceId)}</select></label>
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
                <div class="authority-agent-commit-list">
                    ${state.workspaceCommits.map(commit => renderCommitItem(commit, selected.headCommitId, disabled)).join('') || '<div class="authority-empty">暂无检查点。</div>'}
                </div>
            ` : '<div class="authority-empty">先注册一个允许 Agent 操作的工作区。</div>'}
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
        </details>
    `;
}

function renderProfileStudio(state: AgentWorkbenchState, selected: AgentLlmProfile | null, disabled: string): string {
    return `
        <details class="authority-agent-inspector-panel" ${state.profiles.length === 0 || selected ? 'open' : ''}>
            <summary><span>LLM 配置</span><span class="authority-muted">${escapeHtml(String(state.profiles.length))} 个</span></summary>
            <div class="authority-agent-inspector-panel__body authority-stack">
                <div class="authority-muted">密钥只写入服务端；界面只显示掩码与指纹。</div>
                <div class="authority-agent-profile-list">
                ${state.profiles.map(profile => `
                    <div class="authority-agent-profile-item">
                        <span><strong>${escapeHtml(profile.displayName)}</strong><small>${escapeHtml(`${profile.model} · ${profile.baseUrl}`)}</small><small>${escapeHtml(profile.apiKeyConfigured ? `Key ${profile.apiKeyMasked ?? '********'} · ${profile.apiKeyFingerprint ?? '无指纹'}` : '未配置 Key')}</small></span>
                        <div class="authority-page-actions authority-page-actions--inline">
                            <button type="button" class="authority-action-button" data-action="agent-edit-profile" data-profile-id="${escapeHtml(profile.id)}" ${disabled}>编辑</button>
                            <button type="button" class="authority-action-button" data-action="agent-delete-profile" data-profile-id="${escapeHtml(profile.id)}" ${disabled}>删除</button>
                        </div>
                    </div>
                `).join('') || '<div class="authority-empty">尚未配置模型。</div>'}
                </div>
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

function renderToolCatalog(state: AgentWorkbenchState): string {
    return `
        <details class="authority-agent-inspector-panel">
            <summary><span>工具目录</span><span class="authority-muted">${escapeHtml(String(state.tools.length))} 个</span></summary>
            <div class="authority-agent-inspector-panel__body authority-stack">
                <div class="authority-muted">每次运行还会按 allowedTools、模式与审批策略收窄可用范围。</div>
                <div class="authority-agent-tool-list">${state.tools.map(tool => `
                    <article class="authority-agent-tool-item"><strong>${escapeHtml(tool.title)}</strong><p>${escapeHtml(tool.description)}</p><small>${escapeHtml(`${tool.id} · ${tool.execution} · ${tool.riskLevel} · ${tool.approvalPolicy}`)}</small></article>
                `).join('') || '<div class="authority-empty">没有可用工具。</div>'}</div>
            </div>
        </details>
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

function renderCommitItem(commit: WorkspaceCommitObject, head: string | null, disabled: string): string {
    return `
        <article class="authority-agent-commit">
            <div><code>${escapeHtml(commit.id.slice(0, 12))}</code>${commit.id === head ? ' <span class="authority-pill authority-pill--granted">HEAD</span>' : ''}</div>
            <strong>${escapeHtml(commit.message)}</strong>
            <span class="authority-muted">${escapeHtml(formatDate(commit.createdAt))}</span>
            ${commit.id === head ? '' : `<button type="button" class="authority-action-button" data-action="agent-workspace-rollback" data-commit-id="${escapeHtml(commit.id)}" ${disabled}>回退到这里</button>`}
        </article>
    `;
}

function renderDiffEntries(entries: Array<{ path: string; status: string }>): string {
    return `<div class="authority-agent-diff-list">${entries.map(entry => `<div><code>${escapeHtml(entry.path)}</code><span>${escapeHtml(entry.status)}</span></div>`).join('')}</div>`;
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

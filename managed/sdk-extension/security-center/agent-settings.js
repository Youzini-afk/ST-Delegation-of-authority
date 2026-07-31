import { escapeHtml } from '../dom.js';
export function renderAgentSettings(state) {
    if (state.loading && !state.loaded) {
        return '<div class="authority-loading">正在载入模型连接…</div>';
    }
    const disabled = state.busy || state.loading ? 'disabled' : '';
    const selected = state.profiles.find(profile => profile.id === state.selectedProfileId) ?? null;
    return `
        <div class="authority-settings-shell">
            <aside class="authority-settings-nav" aria-label="设置分类">
                <header><span class="authority-eyebrow">SETTINGS</span><strong>设置</strong></header>
                <div class="authority-settings-nav__group">
                    <span>Agent</span>
                    <div class="authority-settings-nav__item authority-settings-nav__item--active" aria-current="page">模型与连接</div>
                </div>
                <p>配置只保存在 Authority 服务端。Session 会记录实际使用的配置快照。</p>
            </aside>
            <main class="authority-settings-content">
                <header class="authority-settings-content__header">
                    <div>
                        <h2>模型与连接</h2>
                        <p>管理 Authority Agent 的 OpenAI-compatible 连接。</p>
                    </div>
                    <button type="button" class="authority-action-button" data-action="agent-new-profile" ${disabled}>＋ 新增连接</button>
                </header>
                ${state.error ? `<div class="authority-inline-note">${escapeHtml(state.error)}</div>` : ''}
                <div class="authority-model-settings">
                    <nav class="authority-model-profile-list" aria-label="模型连接">
                        ${state.profiles.map(profile => `
                            <button type="button" class="authority-model-profile ${profile.id === selected?.id ? 'authority-model-profile--active' : ''}" data-action="agent-edit-profile" data-profile-id="${escapeHtml(profile.id)}" ${disabled}>
                                <span><strong>${escapeHtml(profile.displayName)}</strong><small>${escapeHtml(profile.model)}</small></span>
                                <i class="authority-status-dot authority-status-dot--${profile.apiKeyConfigured ? 'running' : 'starting'}" aria-hidden="true"></i>
                            </button>
                        `).join('') || '<div class="authority-settings-empty">尚未配置模型连接。</div>'}
                    </nav>
                    <section class="authority-model-editor" aria-label="连接配置">
                        <header>
                            <button type="button" class="authority-settings-mobile-back authority-mobile-only" data-action="mobile-close-surface" aria-label="返回模型连接列表">‹</button>
                            <div><span class="authority-eyebrow">${selected ? 'EDIT CONNECTION' : 'NEW CONNECTION'}</span><h3>${escapeHtml(selected?.displayName ?? '新增模型连接')}</h3></div>
                            ${selected?.apiKeyConfigured ? '<span class="authority-pill authority-pill--granted">已配置密钥</span>' : '<span class="authority-pill authority-pill--prompt">未配置密钥</span>'}
                        </header>
                        <input data-role="agent-profile-id" type="hidden" value="${escapeHtml(selected?.id ?? '')}" />
                        ${selected && (selected.contextWindowTokens === null || selected.maxOutputTokens === null)
        ? '<div class="authority-inline-note">这是旧版模型配置。请补充“上下文窗口”和“最大输出 tokens”，保存后 Agent 才能运行并自动整理上下文。</div>'
        : ''}
                        <div class="authority-model-editor__section">
                            <h4>连接</h4>
                            <label class="authority-agent-field">显示名称<input data-role="agent-profile-name" type="text" value="${escapeHtml(selected?.displayName ?? '')}" placeholder="主 Agent" ${disabled} /></label>
                            <label class="authority-agent-field">Endpoint URL<input data-role="agent-profile-base-url" type="url" value="${escapeHtml(selected?.baseUrl ?? 'https://api.openai.com/v1')}" ${disabled} /></label>
                            <label class="authority-agent-field">API Key
                                <span class="authority-secret-input"><input data-role="agent-profile-api-key" type="password" autocomplete="new-password" placeholder="${escapeHtml(selected?.apiKeyMasked ?? '输入 API Key')}" ${disabled} /><small>${escapeHtml(selected?.apiKeyFingerprint ? `指纹 ${selected.apiKeyFingerprint}` : '密钥不会返回前端')}</small></span>
                            </label>
                        </div>
                        <div class="authority-model-editor__section">
                            <h4>模型参数</h4>
                            <label class="authority-agent-field">模型<input data-role="agent-profile-model" type="text" value="${escapeHtml(selected?.model ?? '')}" placeholder="gpt-5.1" ${disabled} /></label>
                            <div class="authority-model-editor__grid">
                                <label class="authority-agent-field">Temperature<input data-role="agent-profile-temperature" type="number" min="0" max="2" step="0.1" value="${escapeHtml(String(selected?.temperature ?? 0.2))}" ${disabled} /></label>
                                <label class="authority-agent-field">上下文窗口 tokens<input data-role="agent-profile-context-window" type="number" min="1" value="${escapeHtml(String(selected?.contextWindowTokens ?? ''))}" placeholder="例如 128000" required ${disabled} /></label>
                                <label class="authority-agent-field">最大输出 tokens<input data-role="agent-profile-max-tokens" type="number" min="1" value="${escapeHtml(String(selected?.maxOutputTokens ?? (selected ? '' : 8192)))}" required ${disabled} /></label>
                                <label class="authority-agent-field">请求超时（ms，0 为不限制）<input data-role="agent-profile-timeout" type="number" min="0" value="${escapeHtml(String(selected?.timeoutMs ?? 0))}" ${disabled} /></label>
                            </div>
                        </div>
                        ${state.profileTest ? `<div class="authority-connection-test authority-connection-test--${state.profileTest.status}" data-role="agent-profile-test-result" role="status"><i aria-hidden="true"></i><span>${escapeHtml(state.profileTest.message)}</span></div>` : ''}
                        <footer>
                            ${selected ? `<button type="button" class="authority-action-button authority-action-button--danger" data-action="agent-delete-profile" data-profile-id="${escapeHtml(selected.id)}" ${disabled}>删除连接</button>` : '<span></span>'}
                            <div class="authority-model-editor__footer-actions">
                                <button type="button" class="authority-action-button" data-action="agent-test-profile" ${disabled}>测试连接</button>
                                <button type="button" class="authority-action-button authority-action-button--primary" data-action="agent-save-profile" ${disabled}>保存设置</button>
                            </div>
                        </footer>
                    </section>
                </div>
            </main>
        </div>
    `;
}
//# sourceMappingURL=agent-settings.js.map
import { escapeHtml } from '../dom.js';
export function workspaceFileDiffKey(workspaceId, from, to, path) {
    return JSON.stringify([workspaceId, from, to, path]);
}
export function renderWorkspaceDiffEntries(entries, context) {
    return `<div class="authority-file-diff-list">${entries.map(entry => renderEntry(entry, context)).join('')}</div>`;
}
function renderEntry(entry, context) {
    const key = workspaceFileDiffKey(context.workspaceId, context.from, context.to, entry.path);
    const state = context.states.get(key);
    const expanded = Boolean(state?.expanded && state.response);
    const disabled = context.disabled || state?.loading ? 'disabled' : '';
    const actionLabel = state?.loading ? '读取中…'
        : state?.error ? '重试'
            : state?.response ? expanded ? '收起' : '展开差异'
                : '查看差异';
    return `
        <section class="authority-file-diff ${expanded ? 'authority-file-diff--expanded' : ''}">
            <div class="authority-file-diff__header">
                <span class="authority-file-diff__status authority-file-diff__status--${escapeHtml(entry.status)}">${escapeHtml(statusMark(entry.status))}</span>
                <code title="${escapeHtml(entry.path)}">${escapeHtml(entry.path)}</code>
                <button type="button" class="authority-text-button" data-action="${context.action}" data-diff-scope="${context.scope}" data-path="${escapeHtml(entry.path)}" aria-expanded="${expanded}" ${disabled}>${actionLabel}</button>
            </div>
            ${state?.error ? `<div class="authority-file-diff__notice authority-file-diff__notice--error">${escapeHtml(state.error)}</div>` : ''}
            ${expanded && state?.response ? renderFileDiff(state.response) : ''}
        </section>
    `;
}
function renderFileDiff(diff) {
    if (diff.kind === 'binary') {
        return '<div class="authority-file-diff__notice">二进制文件不能显示文本差异。</div>';
    }
    if (diff.kind === 'unavailable') {
        return `<div class="authority-file-diff__notice">${escapeHtml(unavailableLabel(diff.reason))}</div>`;
    }
    const metadataNotice = textMetadataNotice(diff);
    if (diff.hunks.length === 0) {
        return `<div class="authority-file-diff__notice">${escapeHtml(metadataNotice ?? '没有可显示的行级差异，可能只改变了空文件或文件属性。')}</div>`;
    }
    return `
        <div class="authority-file-diff__content" role="region" aria-label="${escapeHtml(diff.path)} 的代码差异">
            ${diff.hunks.map((hunk, index) => `
                <div class="authority-file-diff__hunk">
                    ${index > 0 ? '<div class="authority-file-diff__separator">···</div>' : ''}
                    ${hunk.lines.map(line => `
                        <div class="authority-file-diff__line authority-file-diff__line--${line.kind}">
                            <span class="authority-file-diff__numbers"><i>${line.beforeLine ?? ''}</i><i>${line.afterLine ?? ''}</i></span>
                            <code><b>${line.kind === 'added' ? '+' : line.kind === 'deleted' ? '−' : ' '}</b>${escapeHtml(line.text)}</code>
                        </div>
                    `).join('')}
                </div>
            `).join('')}
            ${metadataNotice ? `<div class="authority-file-diff__notice">${escapeHtml(metadataNotice)}</div>` : ''}
            ${diff.truncated ? '<div class="authority-file-diff__notice">差异过长，已按安全上限截断。</div>' : ''}
        </div>
    `;
}
function textMetadataNotice(diff) {
    const metadata = diff.textMetadata;
    if (diff.status !== 'modified' || !metadata)
        return null;
    const changes = [];
    if (metadata.before.lineEnding !== metadata.after.lineEnding
        && metadata.before.lineEnding !== 'none'
        && metadata.after.lineEnding !== 'none') {
        changes.push(`换行格式 ${lineEndingLabel(metadata.before.lineEnding)} → ${lineEndingLabel(metadata.after.lineEnding)}`);
    }
    if (metadata.before.endsWithNewline !== metadata.after.endsWithNewline) {
        changes.push(`文件末尾换行 ${metadata.before.endsWithNewline ? '有' : '无'} → ${metadata.after.endsWithNewline ? '有' : '无'}`);
    }
    return changes.length ? `${changes.join('；')}。` : null;
}
function lineEndingLabel(value) {
    return { none: '无', lf: 'LF', crlf: 'CRLF', cr: 'CR', mixed: '混合' }[value];
}
function statusMark(status) {
    return { added: 'A', modified: 'M', deleted: 'D', type_changed: 'T' }[status];
}
function unavailableLabel(reason) {
    if (reason === 'file_too_large')
        return '文件超过 512 KiB，未加载内容差异。';
    if (reason === 'diff_too_complex')
        return '差异规模过大，无法在控制台内安全展开。';
    return '该路径类型不支持文本差异。';
}
//# sourceMappingURL=workspace-diff-view.js.map
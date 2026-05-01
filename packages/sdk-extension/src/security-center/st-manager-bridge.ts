import { escapeHtml } from '../dom.js';
import { formatBytes } from './formatters.js';

export type StManagerResourceType = 'characters' | 'chats' | 'worlds' | 'presets' | 'regex' | 'quick_replies';

export interface StManagerBridgeConfig {
    enabled: boolean;
    bound_user_handle: string | null;
    key_fingerprint: string | null;
    key_masked: string | null;
    max_file_size: number;
    resource_types: StManagerResourceType[];
    bridge_key?: string;
}

export interface StManagerBridgeFormValues {
    enabled: boolean;
    maxFileSizeMiB: number;
    resourceTypes: string[];
    rotateKey?: boolean;
}

export interface StManagerBridgeAdminPayload {
    enabled: boolean;
    max_file_size: number;
    resource_types: StManagerResourceType[];
    rotate_key?: true;
}

const MIB = 1024 * 1024;
const DEFAULT_MAX_FILE_SIZE = 100 * MIB;

export const ST_MANAGER_RESOURCE_OPTIONS: Array<{ type: StManagerResourceType; label: string }> = [
    { type: 'characters', label: '角色卡' },
    { type: 'chats', label: '聊天记录' },
    { type: 'worlds', label: '世界书' },
    { type: 'presets', label: '预设' },
    { type: 'regex', label: 'Regex' },
    { type: 'quick_replies', label: 'QuickReplies' },
];

const RESOURCE_TYPES = ST_MANAGER_RESOURCE_OPTIONS.map(option => option.type);

export function normalizeStManagerBridgeConfig(value: unknown): StManagerBridgeConfig | null {
    if (!value || typeof value !== 'object') {
        return null;
    }

    const record = value as Record<string, unknown>;
    return {
        enabled: Boolean(record.enabled),
        bound_user_handle: typeof record.bound_user_handle === 'string' ? record.bound_user_handle : null,
        key_fingerprint: typeof record.key_fingerprint === 'string' ? record.key_fingerprint : null,
        key_masked: typeof record.key_masked === 'string' ? record.key_masked : null,
        max_file_size: normalizeMaxFileSize(record.max_file_size),
        resource_types: normalizeResourceTypes(record.resource_types),
        ...(typeof record.bridge_key === 'string' && record.bridge_key ? { bridge_key: record.bridge_key } : {}),
    };
}

export function buildStManagerBridgePayload(values: StManagerBridgeFormValues): StManagerBridgeAdminPayload {
    const maxFileSizeMiB = Number(values.maxFileSizeMiB);
    return {
        enabled: values.enabled,
        max_file_size: Number.isFinite(maxFileSizeMiB) && maxFileSizeMiB < 0
            ? -1
            : Math.max(1, Math.floor(maxFileSizeMiB || 1)) * MIB,
        resource_types: normalizeResourceTypes(values.resourceTypes),
        ...(values.rotateKey ? { rotate_key: true } : {}),
    };
}

export function renderStManagerBridgeSection(config: StManagerBridgeConfig | null, generatedKey: string | null, busy: boolean): string {
    const enabled = Boolean(config?.enabled);
    const maxFileSize = config?.max_file_size ?? DEFAULT_MAX_FILE_SIZE;
    const maxFileSizeMiB = maxFileSize < 0 ? -1 : Math.max(1, Math.ceil(maxFileSize / MIB));
    const resourceTypes = new Set(config?.resource_types ?? RESOURCE_TYPES);
    const statusTone = enabled ? 'granted' : 'warning';
    const statusLabel = enabled ? '已启用' : '未启用';
    const keyLabel = config?.key_masked ?? '未生成';
    const boundUser = config?.bound_user_handle ?? '未绑定';
    const rotateLabel = enabled ? '轮换 Key' : '启用并生成 Key';
    const disabledAttr = busy ? 'disabled' : '';

    return `
        <section class="authority-card authority-card--flat" data-role="st-manager-bridge-panel">
            <div class="authority-card__header">
                <div>
                    <h3>ST-Manager 远程备份桥接</h3>
                    <div class="authority-muted">公网备份/恢复通道、Bridge Key 与资源类型开关</div>
                </div>
                <div class="authority-page-actions authority-page-actions--inline">
                    <span class="authority-pill authority-pill--${statusTone}">${escapeHtml(statusLabel)}</span>
                    <span class="authority-pill authority-pill--prompt">${escapeHtml(keyLabel)}</span>
                </div>
            </div>
            ${generatedKey ? `
                <div class="authority-inline-note authority-inline-note--warning" data-role="st-manager-bridge-key-note">
                    <strong>新 Bridge Key</strong>
                    <div class="authority-page-actions authority-page-actions--inline">
                        <input class="authority-bridge-key-field" data-role="st-manager-bridge-key" type="password" readonly value="${escapeHtml(generatedKey)}" />
                        <button type="button" class="authority-action-button" data-action="toggle-secret-visibility" data-target-role="st-manager-bridge-key" title="显示或隐藏 Bridge Key" aria-pressed="false" ${disabledAttr}>👁</button>
                        <button type="button" class="authority-action-button authority-action-button--primary" data-action="copy-st-manager-bridge-key" ${disabledAttr}>复制 Key</button>
                    </div>
                    <div class="authority-muted">Key 默认隐藏，可用小眼睛临时查看。</div>
                </div>
            ` : ''}
            <div class="authority-settings-list">
                <div class="authority-settings-row authority-settings-row--${enabled ? 'success' : 'warning'}">
                    <div>
                        <strong>桥接状态</strong>
                        <div class="authority-muted">绑定用户：${escapeHtml(boundUser)} · 单文件上限：${escapeHtml(formatBridgeMaxFileSize(maxFileSize))}</div>
                    </div>
                    <div class="authority-settings-row__control">
                        <label class="authority-bridge-toggle">
                            <input type="checkbox" data-role="st-manager-bridge-enabled" ${enabled ? 'checked' : ''} ${disabledAttr} />
                            <span>启用</span>
                        </label>
                    </div>
                </div>
                <div class="authority-settings-row">
                    <div>
                        <strong>最大文件大小</strong>
                        <div class="authority-muted">聊天 jsonl 和角色卡传输会按这个上限校验；填 -1 表示不限制。</div>
                    </div>
                    <div class="authority-settings-row__control">
                        <input class="authority-bridge-size-input" data-role="st-manager-bridge-max-file-size" type="number" min="-1" step="1" value="${escapeHtml(String(maxFileSizeMiB))}" ${disabledAttr} />
                        <span class="authority-muted">MiB</span>
                    </div>
                </div>
                <div class="authority-settings-row">
                    <div>
                        <strong>允许备份的资源</strong>
                        <div class="authority-muted">ST-Manager 只能读取和恢复选中的资源类型。</div>
                    </div>
                    <div class="authority-bridge-resource-grid">
                        ${ST_MANAGER_RESOURCE_OPTIONS.map(option => `
                            <label class="authority-bridge-resource">
                                <input type="checkbox" data-role="st-manager-bridge-resource" value="${option.type}" ${resourceTypes.has(option.type) ? 'checked' : ''} ${disabledAttr} />
                                <span>${escapeHtml(option.label)}</span>
                            </label>
                        `).join('')}
                    </div>
                </div>
            </div>
            <div class="authority-policy-footer">
                <div class="authority-chip-row">
                    <span class="authority-pill authority-pill--runtime">Authorization: Bearer</span>
                    <span class="authority-pill authority-pill--runtime">X-ST-Manager-Key</span>
                    <span class="authority-pill authority-pill--admin">${escapeHtml(config?.key_fingerprint ?? '无指纹')}</span>
                </div>
                <div class="authority-page-actions authority-page-actions--inline">
                    <button type="button" class="authority-action-button" data-action="save-st-manager-bridge-config" ${disabledAttr}>保存配置</button>
                    <button type="button" class="authority-action-button authority-action-button--primary" data-action="rotate-st-manager-bridge-key" ${disabledAttr}>${escapeHtml(rotateLabel)}</button>
                    <button type="button" class="authority-action-button" data-action="disable-st-manager-bridge" ${!enabled || busy ? 'disabled' : ''}>禁用桥接</button>
                </div>
            </div>
        </section>
    `;
}

function normalizeMaxFileSize(value: unknown): number {
    const size = Number(value);
    if (!Number.isFinite(size) || size === 0) {
        return DEFAULT_MAX_FILE_SIZE;
    }
    if (size < 0) {
        return -1;
    }
    return Math.max(1, Math.floor(size));
}

function formatBridgeMaxFileSize(value: number): string {
    return value < 0 ? '不限制' : formatBytes(value);
}

function normalizeResourceTypes(value: unknown): StManagerResourceType[] {
    if (!Array.isArray(value)) {
        return [...RESOURCE_TYPES];
    }
    const selected = value.filter((item): item is StManagerResourceType => typeof item === 'string' && RESOURCE_TYPES.includes(item as StManagerResourceType));
    return selected.length ? selected : [...RESOURCE_TYPES];
}

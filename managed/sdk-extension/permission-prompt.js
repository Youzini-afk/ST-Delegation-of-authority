import { Popup, POPUP_RESULT, POPUP_TYPE } from '/scripts/popup.js';
import { renderExtensionTemplateAsync } from '/scripts/extensions.js';
import { AUTHORITY_EXTENSION_NAME } from './api.js';
import { htmlToElement } from './dom.js';
const POPUP_TEXT_TYPE = POPUP_TYPE.TEXT ?? 0;
const POPUP_CUSTOM1 = POPUP_RESULT.CUSTOM1 ?? 1001;
const POPUP_CUSTOM2 = POPUP_RESULT.CUSTOM2 ?? 1002;
const POPUP_CUSTOM3 = POPUP_RESULT.CUSTOM3 ?? 1003;
const POPUP_CUSTOM4 = POPUP_RESULT.CUSTOM4 ?? 1004;
const RESULT_TO_DECISION = new Map([
    [POPUP_CUSTOM1, 'allow-once'],
    [POPUP_CUSTOM2, 'allow-session'],
    [POPUP_CUSTOM3, 'allow-always'],
    [POPUP_CUSTOM4, 'deny'],
]);
export async function showPermissionPrompt(context) {
    const html = await renderExtensionTemplateAsync(AUTHORITY_EXTENSION_NAME, 'permission-dialog', {}, false, false);
    const root = htmlToElement(html);
    setField(root, 'extension-name', context.extensionDisplayName);
    setField(root, 'extension-id', context.extensionId);
    setField(root, 'resource', getResourceLabel(context.resource));
    setField(root, 'target', getTargetLabel(context.resource, context.target));
    setField(root, 'risk', getRiskLabel(context.riskLevel));
    setField(root, 'reason', context.reason || getDefaultReason(context.resource));
    const popup = new Popup(root, POPUP_TEXT_TYPE, '', {
        okButton: false,
        cancelButton: '取消',
        customButtons: [
            { text: '仅允许一次', result: POPUP_CUSTOM1 },
            { text: '允许本会话', result: POPUP_CUSTOM2 },
            { text: '始终允许', result: POPUP_CUSTOM3 },
            { text: '拒绝并记住', result: POPUP_CUSTOM4, appendAtEnd: true },
        ],
    });
    const result = await popup.show();
    return RESULT_TO_DECISION.get(result) ?? null;
}
function setField(root, name, value) {
    const target = root.querySelector(`[data-field="${name}"]`);
    if (target) {
        target.textContent = value;
    }
}
function getResourceLabel(resource) {
    switch (resource) {
        case 'storage.kv':
            return 'KV 存储';
        case 'storage.blob':
            return 'Blob 存储';
        case 'fs.private':
            return '私有文件夹';
        case 'sql.private':
            return '私有 SQL 数据库';
        case 'http.fetch':
            return '外部 HTTP 访问';
        case 'jobs.background':
            return '后台任务';
        case 'events.stream':
            return '事件流订阅';
        default:
            return resource;
    }
}
function getTargetLabel(resource, target) {
    if (resource === 'fs.private' && (!target || target === '*')) {
        return '插件私有目录';
    }
    return target || 'default';
}
function getDefaultReason(resource) {
    if (resource === 'fs.private') {
        return '该扩展请求在它自己的服务端私有目录中创建、读取、修改或删除文件。';
    }
    return '该扩展请求使用一项受治理的服务端能力。';
}
function getRiskLabel(riskLevel) {
    switch (riskLevel) {
        case 'low':
            return '低风险';
        case 'medium':
            return '中风险';
        case 'high':
            return '高风险';
        default:
            return riskLevel;
    }
}
//# sourceMappingURL=permission-prompt.js.map
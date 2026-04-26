import type { ControlExtensionRecord, DeclaredPermissions, InstallType, JobStatus, PermissionResource, PermissionStatus } from '@stdo/shared-types';
import type { ActivityRecord, AuthorityRiskLevel, ExtensionSummary } from './types.js';

export function formatBytes(bytes: number): string {
    if (!Number.isFinite(bytes) || bytes <= 0) {
        return '0 B';
    }
    const units = ['B', 'KB', 'MB', 'GB', 'TB'];
    let value = bytes;
    let unitIndex = 0;
    while (value >= 1024 && unitIndex < units.length - 1) {
        value /= 1024;
        unitIndex += 1;
    }
    return `${value >= 10 || unitIndex === 0 ? value.toFixed(0) : value.toFixed(1)} ${units[unitIndex]}`;
}

export function getCoreStateLabel(state?: string): string {
    switch (state) {
        case 'running': return '运行中';
        case 'starting': return '启动中';
        case 'stopping': return '停止中';
        case 'stopped': return '已停止';
        case 'disabled': return '已禁用';
        case 'error': return '错误';
        default: return '未知';
    }
}

export function getInstallStatusLabel(status: string): string {
    switch (status) {
        case 'ready': return '就绪';
        case 'installed': return '已安装';
        case 'updated': return '已更新';
        case 'missing': return '缺失';
        case 'conflict': return '冲突';
        case 'error': return '错误';
        default: return '状态未知';
    }
}

export function getJobTypeLabel(type: string): string {
    switch (type) {
        case 'delay': return '延时任务';
        default: return type;
    }
}

export function getActivityMessageLabel(message: string): string {
    switch (message) {
        case 'Session initialized': return '已建立会话';
        case 'Permission resolved': return '已保存权限决定';
        case 'Persistent grants reset': return '已重置持久授权';
        case 'KV set': return '已写入键值数据';
        case 'Blob stored': return '已保存文件';
        case 'Private file mkdir': return '已创建私有目录';
        case 'Private file read dir': return '已读取私有目录';
        case 'Private file write': return '已写入私有文件';
        case 'Private file read': return '已读取私有文件';
        case 'Private file delete': return '已删除私有文件';
        case 'Private file stat': return '已查看文件信息';
        case 'SQL query': return '已查询数据库';
        case 'SQL exec': return '已执行数据库命令';
        case 'SQL batch': return '已批量执行数据库命令';
        case 'SQL transaction': return '已执行数据库事务';
        case 'SQL migrate': return '已执行数据库迁移';
        case 'SQL list databases': return '已读取数据库列表';
        case 'HTTP fetch': return '已发起网络请求';
        case 'Job created': return '已创建后台任务';
        case 'Job cancelled': return '已取消后台任务';
        case 'Policies updated': return '已更新策略';
        case 'Cancelled by user': return '用户已取消';
        default: return message;
    }
}

export function getSystemMessageLabel(message: string): string {
    if (message === 'Authority SDK deployment has not run yet.') {
        return '权限中心组件还没有部署。';
    }
    if (message === 'Managed Authority SDK bundle is not embedded in this plugin build.') {
        return '当前插件构建里没有打包权限中心组件。';
    }
    if (message === 'Unable to resolve the SillyTavern root for managed SDK deployment.') {
        return '无法定位 SillyTavern 根目录，暂时不能部署权限中心组件。';
    }
    if (message === 'Authority release metadata is missing.') {
        return '缺少权限中心的发布元数据。';
    }
    if (message === 'Managed authority-core binary hash does not match its metadata.') {
        return '后台服务文件校验失败：与本地元数据不一致。';
    }
    if (message === 'Managed authority-core binary hash does not match platform release metadata.') {
        return '后台服务文件校验失败：与平台发布信息不一致。';
    }
    if (message === 'Managed authority-core binary hash does not match release metadata.') {
        return '后台服务文件校验失败：与发布元数据不一致。';
    }
    if (message.startsWith('Authority SDK target already exists and is not managed by ')) {
        return '权限中心目标目录已存在，但不是由当前插件管理，不能自动覆盖。';
    }
    if (message.startsWith('Managed authority-core artifacts target ')) {
        return '内置后台服务支持的平台与当前运行环境不匹配。';
    }
    if (message.startsWith('Managed authority-core metadata is missing for ')) {
        return '缺少当前平台对应的后台服务元数据。';
    }
    if (message.startsWith('Managed authority-core metadata for ') && message.endsWith(' is invalid.')) {
        return '当前平台对应的后台服务元数据无效。';
    }
    if (message.startsWith('Managed authority-core metadata platform mismatch: ')) {
        return '后台服务元数据记录的平台信息与当前环境不一致。';
    }
    if (message.startsWith('Managed authority-core version mismatch: expected ')) {
        return '后台服务版本与发布记录不一致。';
    }
    if (message.startsWith('Managed authority-core binary is missing: ')) {
        return '缺少后台服务可执行文件。';
    }
    if (message.startsWith('Authority SDK deployed to ')) {
        return localizeInstallMessage(message, 'Authority SDK deployed to ', '权限中心组件已部署到 ');
    }
    if (message.startsWith('Authority SDK refreshed at ')) {
        return localizeInstallMessage(message, 'Authority SDK refreshed at ', '权限中心组件已更新到 ');
    }
    if (message.startsWith('Authority SDK is already available at ')) {
        return localizeInstallMessage(message, 'Authority SDK is already available at ', '权限中心组件已存在于 ');
    }
    return message;
}

function localizeInstallMessage(message: string, englishPrefix: string, chinesePrefix: string): string {
    const withoutPrefix = message.slice(englishPrefix.length);

    if (withoutPrefix.includes('. Core verification warning: ')) {
        const [targetDir, warning = ''] = withoutPrefix.split('. Core verification warning: ');
        return `${chinesePrefix}${targetDir}。后台服务校验提醒：${getSystemMessageLabel(stripTrailingPeriod(warning))}`;
    }

    if (withoutPrefix.includes('. Core verified for ')) {
        const [targetDir, rest = ''] = withoutPrefix.split('. Core verified for ');
        if (rest.includes(' with warnings: ')) {
            const [platform, warning = ''] = rest.split(' with warnings: ');
            return `${chinesePrefix}${targetDir}。后台服务已完成 ${platform} 校验，但仍有提醒：${getSystemMessageLabel(stripTrailingPeriod(warning))}`;
        }
        return `${chinesePrefix}${targetDir}。后台服务已完成 ${stripTrailingPeriod(rest)} 校验。`;
    }

    if (withoutPrefix.includes('. Core artifact verified for ')) {
        const [targetDir, platform = ''] = withoutPrefix.split('. Core artifact verified for ');
        return `${chinesePrefix}${targetDir}。后台服务已完成 ${stripTrailingPeriod(platform)} 校验。`;
    }

    return `${chinesePrefix}${stripTrailingPeriod(withoutPrefix)}。`;
}

function stripTrailingPeriod(message: string): string {
    return message.replace(/\.$/, '');
}

export function getDeclaredPermissionLabels(declaredPermissions: DeclaredPermissions): string[] {
    const labels: string[] = [];
    if (declaredPermissions.storage?.kv) labels.push('键值数据');
    if (declaredPermissions.storage?.blob) labels.push('文件存储');
    if (declaredPermissions.fs?.private) labels.push('私有文件');
    if (declaredPermissions.sql?.private) labels.push(Array.isArray(declaredPermissions.sql.private) ? `私有数据库（${declaredPermissions.sql.private.join('、')}）` : '私有数据库');
    if (declaredPermissions.trivium?.private) labels.push(Array.isArray(declaredPermissions.trivium.private) ? `私有记忆数据库（${declaredPermissions.trivium.private.join('、')}）` : '私有记忆数据库');
    if (declaredPermissions.http?.allow?.length) labels.push(`网络访问（${declaredPermissions.http.allow.join('、')}）`);
    if (declaredPermissions.jobs?.background) labels.push(Array.isArray(declaredPermissions.jobs.background) ? `后台任务（${declaredPermissions.jobs.background.join('、')}）` : '后台任务');
    if (declaredPermissions.events?.channels) labels.push(Array.isArray(declaredPermissions.events.channels) ? `消息通道（${declaredPermissions.events.channels.join('、')}）` : '消息通道');
    return labels;
}

export function getResourceLabel(resource: PermissionResource): string {
    switch (resource) {
        case 'storage.kv': return '键值数据';
        case 'storage.blob': return '文件存储';
        case 'fs.private': return '私有文件';
        case 'sql.private': return '私有数据库';
        case 'trivium.private': return '私有记忆数据库';
        case 'http.fetch': return '网络访问';
        case 'jobs.background': return '后台任务';
        case 'events.stream': return '消息通道';
        default: return '未分类能力';
    }
}

export function getStatusLabel(status: PermissionStatus): string {
    switch (status) {
        case 'prompt': return '询问';
        case 'granted': return '允许';
        case 'denied': return '拒绝';
        case 'blocked': return '封锁';
        default: return '状态未知';
    }
}

export function getActivityKindLabel(kind: ActivityRecord['kind']): string {
    switch (kind) {
        case 'permission': return '权限申请';
        case 'usage': return '能力使用';
        case 'error': return '错误';
        default: return '未分类';
    }
}

export function getRiskLevel(resource: PermissionResource): AuthorityRiskLevel {
    switch (resource) {
        case 'storage.kv':
        case 'storage.blob':
        case 'events.stream':
            return 'low';
        case 'fs.private':
        case 'sql.private':
        case 'http.fetch':
        case 'jobs.background':
            return 'medium';
        case 'trivium.private':
            return 'high';
        default:
            return 'high';
    }
}

export function getExtensionRiskLevel(extension: ExtensionSummary | ControlExtensionRecord): AuthorityRiskLevel {
    if (
        extension.declaredPermissions.trivium?.private
    ) {
        return 'high';
    }
    if (
        extension.declaredPermissions.sql?.private
        || extension.declaredPermissions.http?.allow?.length
        || extension.declaredPermissions.jobs?.background
        || extension.declaredPermissions.fs?.private
    ) {
        return 'medium';
    }
    return 'low';
}

export function getRiskLabel(risk: AuthorityRiskLevel): string {
    switch (risk) {
        case 'low': return '低风险';
        case 'medium': return '中风险';
        case 'high': return '高风险';
        default: return '风险未知';
    }
}

export function getInstallTypeLabel(installType: InstallType): string {
    switch (installType) {
        case 'system': return '系统内置';
        case 'local': return '本地安装';
        case 'global': return '全局安装';
        default: return '安装方式未知';
    }
}

export function getJobStatusLabel(status: JobStatus): string {
    switch (status) {
        case 'queued': return '排队中';
        case 'running': return '执行中';
        case 'completed': return '已完成';
        case 'failed': return '失败';
        case 'cancelled': return '已取消';
        default: return '状态未知';
    }
}

export function sortByTimestampDesc(left: ActivityRecord, right: ActivityRecord): number {
    return right.timestamp.localeCompare(left.timestamp);
}

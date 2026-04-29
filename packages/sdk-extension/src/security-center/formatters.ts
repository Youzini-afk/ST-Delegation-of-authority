import type { ControlExtensionRecord, DeclaredPermissions, InstallType, JobAttemptEvent, JobStatus, PermissionResource, PermissionStatus } from '@stdo/shared-types';
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
        case 'sql.backup': return 'SQL 备份';
        case 'trivium.flush': return 'Trivium 落盘';
        case 'fs.import-jsonl': return '导入 JSONL 文件';
        default: return type;
    }
}

export function getActivityMessageLabel(message: string): string {
    switch (message) {
        case 'Session initialized': return '已建立会话';
        case 'Permission resolved': return '已保存权限决定';
        case 'Permission granted': return '已允许权限请求';
        case 'Permission denied': return '权限请求被拒绝';
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
        case 'HTTP fetch': return '已发起 HTTP 请求';
        case 'Job created': return '已创建后台任务';
        case 'Job cancelled': return '已取消后台任务';
        case 'Job requeued': return '已安全重新排队后台任务';
        case 'Job queue full': return '后台任务队列已满';
        case 'Job retry scheduled': return '后台任务已安排重试';
        case 'Job failed': return '后台任务执行失败';
        case 'Job timed out': return '后台任务执行超时';
        case 'Slow job': return '后台任务执行偏慢';
        case 'Policies updated': return '已更新策略';
        case 'Cancelled by user': return '用户已取消';
        default: return message;
    }
}

export function getSystemMessageLabel(message: string): string {
    if (message.startsWith('http_fetch_ssrf_denied: ')) {
        const detail = message.slice('http_fetch_ssrf_denied: '.length);
        return `网络访问被 SSRF 防护拒绝：${detail}`;
    }
    if (message.startsWith('http_fetch_invalid_scheme: ')) {
        return '网络访问仅允许 http / https 协议。';
    }
    if (message === 'http_fetch_too_many_redirects') {
        return '网络访问重定向次数过多，已被中止。';
    }
    if (message === 'http_fetch_redirect_missing_location') {
        return '网络访问返回了缺少 Location 的重定向响应。';
    }
    if (message.startsWith('http_fetch_redirect_invalid_location: ')) {
        return '网络访问的重定向地址无效。';
    }
    if (message.startsWith('http_fetch_dns_resolution_failed: ')) {
        return '网络访问目标主机解析失败。';
    }
    if (message === 'job_timeout') {
        return '后台任务执行超时。';
    }
    if (message === 'job_requeue_requires_terminal_status') {
        return '只有已结束的后台任务才能安全重新排队。';
    }
    if (message === 'job_requeue_completed_is_not_safe') {
        return '已完成任务默认不允许安全重新排队，以避免重复副作用。';
    }
    if (message === 'job_requeue_sql_backup_with_target_name_is_not_safe') {
        return '带固定 targetName 的 SQL 备份任务不允许安全重新排队，以避免覆盖已有备份。';
    }
    if (message === 'job_requeue_fs_import_jsonl_is_not_safe') {
        return 'JSONL 导入任务默认不允许安全重新排队，以避免覆盖目标文件。';
    }
    if (message === 'Authority SDK deployment has not run yet.') {
        return '前端组件还没有部署。';
    }
    if (message === 'Managed Authority SDK bundle is not embedded in this plugin build.') {
        return '当前插件包里没有带上前端组件。';
    }
    if (message === 'Unable to resolve the SillyTavern root for managed SDK deployment.') {
        return '找不到 SillyTavern 根目录，暂时不能部署前端组件。';
    }
    if (message === 'Authority release metadata is missing.') {
        return '缺少当前插件的发布信息。';
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
    if (message.startsWith('Authority core binary for ')) {
        return '缺少当前平台的后台服务可执行文件。请使用多平台安装包，或在完整源码目录运行 npm run build:core。';
    }
    if (message.startsWith('Managed authority-core for ') && message.includes(' was built locally from source')) {
        return '当前平台的后台服务已从本地源码自动构建。';
    }
    if (message.startsWith('Managed authority-core for ') && message.includes(' local core build is disabled by AUTHORITY_CORE_AUTOBUILD')) {
        return '当前平台缺少后台服务，且本地自动构建已被 AUTHORITY_CORE_AUTOBUILD 禁用。';
    }
    if (message.startsWith('Managed authority-core for ') && message.includes(' local source build is unavailable')) {
        return '当前平台缺少后台服务，且当前安装目录不是可本地构建的完整源码。请使用多平台安装包。';
    }
    if (message.startsWith('Managed authority-core for ') && message.includes(' Cargo is not available')) {
        return '当前平台缺少后台服务，且没有检测到 Rust/Cargo。请安装 Rust/Cargo 后在插件目录运行 npm run build:core，或使用多平台安装包。';
    }
    if (message.startsWith('Managed authority-core for ') && message.includes(' local source build failed')) {
        return '当前平台缺少后台服务，尝试从本地源码构建失败。请查看服务端日志，或使用多平台安装包。';
    }
    if (message.startsWith('Managed authority-core release metadata targets ')) {
        return '发布元数据未列出当前平台，但本地当前平台后台服务已通过校验。';
    }
    if (message.startsWith('Authority SDK target already exists and is not managed by ')) {
        return '前端组件目录已经存在，但不是当前插件在管理，不能自动覆盖。';
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
        return localizeInstallMessage(message, 'Authority SDK deployed to ', '前端组件已部署到 ');
    }
    if (message.startsWith('Authority SDK refreshed at ')) {
        return localizeInstallMessage(message, 'Authority SDK refreshed at ', '前端组件已更新到 ');
    }
    if (message.startsWith('Authority SDK is already available at ')) {
        return localizeInstallMessage(message, 'Authority SDK is already available at ', '前端组件已存在于 ');
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
    if (declaredPermissions.trivium?.private) labels.push(Array.isArray(declaredPermissions.trivium.private) ? `Trivium 私有记忆库（${declaredPermissions.trivium.private.join('、')}）` : 'Trivium 私有记忆库');
    if (declaredPermissions.http?.allow?.length) labels.push(`HTTP 访问（${declaredPermissions.http.allow.join('、')}）`);
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
        case 'trivium.private': return 'Trivium 私有记忆库';
        case 'http.fetch': return 'HTTP 访问';
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
        case 'warning': return '告警';
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

export function getJobAttemptEventLabel(event: JobAttemptEvent): string {
    switch (event) {
        case 'started': return '开始';
        case 'retryScheduled': return '安排重试';
        case 'completed': return '完成';
        case 'failed': return '失败';
        case 'cancelled': return '取消';
        case 'recovered': return '恢复扫尾';
        default: return '未知';
    }
}

export function sortByTimestampDesc(left: ActivityRecord, right: ActivityRecord): number {
    return right.timestamp.localeCompare(left.timestamp);
}

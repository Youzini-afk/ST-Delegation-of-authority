export function formatBytes(bytes) {
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
export function getCoreStateLabel(state) {
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
export function getInstallStatusLabel(status) {
    switch (status) {
        case 'ready': return '就绪';
        case 'installed': return '已安装';
        case 'updated': return '已更新';
        case 'missing': return '缺失';
        case 'conflict': return '冲突';
        case 'error': return '错误';
        default: return status;
    }
}
export function getDeclaredPermissionLabels(declaredPermissions) {
    const labels = [];
    if (declaredPermissions.storage?.kv)
        labels.push('storage.kv');
    if (declaredPermissions.storage?.blob)
        labels.push('storage.blob');
    if (declaredPermissions.fs?.private)
        labels.push('fs.private');
    if (declaredPermissions.sql?.private)
        labels.push(Array.isArray(declaredPermissions.sql.private) ? `sql.private -> ${declaredPermissions.sql.private.join(', ')}` : 'sql.private');
    if (declaredPermissions.http?.allow?.length)
        labels.push(`http.fetch -> ${declaredPermissions.http.allow.join(', ')}`);
    if (declaredPermissions.jobs?.background)
        labels.push(Array.isArray(declaredPermissions.jobs.background) ? `jobs.background -> ${declaredPermissions.jobs.background.join(', ')}` : 'jobs.background');
    if (declaredPermissions.events?.channels)
        labels.push(Array.isArray(declaredPermissions.events.channels) ? `events.stream -> ${declaredPermissions.events.channels.join(', ')}` : 'events.stream');
    return labels;
}
export function getResourceLabel(resource) {
    switch (resource) {
        case 'storage.kv': return 'KV 存储';
        case 'storage.blob': return 'Blob 存储';
        case 'fs.private': return '私有文件夹';
        case 'sql.private': return '私有 SQL 数据库';
        case 'http.fetch': return 'HTTP 访问';
        case 'jobs.background': return '后台任务';
        case 'events.stream': return '事件流';
        default: return resource;
    }
}
export function getStatusLabel(status) {
    switch (status) {
        case 'prompt': return '询问';
        case 'granted': return '允许';
        case 'denied': return '拒绝';
        case 'blocked': return '封锁';
        default: return status;
    }
}
export function getActivityKindLabel(kind) {
    switch (kind) {
        case 'permission': return '权限';
        case 'usage': return '调用';
        case 'error': return '错误';
        default: return kind;
    }
}
export function getRiskLevel(resource) {
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
        default:
            return 'high';
    }
}
export function getExtensionRiskLevel(extension) {
    const declared = getDeclaredPermissionLabels(extension.declaredPermissions);
    if (declared.some(item => item.includes('sql.private') || item.includes('http.fetch') || item.includes('jobs.background') || item.includes('fs.private'))) {
        return 'medium';
    }
    return declared.length > 0 ? 'low' : 'low';
}
export function getRiskLabel(risk) {
    switch (risk) {
        case 'low': return '低风险';
        case 'medium': return '中风险';
        case 'high': return '高风险';
        default: return risk;
    }
}
export function sortByTimestampDesc(left, right) {
    return right.timestamp.localeCompare(left.timestamp);
}
//# sourceMappingURL=formatters.js.map
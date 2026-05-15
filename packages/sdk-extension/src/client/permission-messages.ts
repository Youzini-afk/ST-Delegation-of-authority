import type { PermissionEvaluateResponse, PermissionResource } from '@stdo/shared-types';

export type AuthorityPermissionErrorDecision = Exclude<PermissionEvaluateResponse['decision'], 'granted'>;

export type AuthorityPermissionErrorCode = 'permission_not_granted' | 'permission_denied' | 'permission_blocked';

export function getPermissionFailureMessage(
    displayName: string,
    resource: PermissionResource,
    target: string,
    decision: PermissionEvaluateResponse['decision'],
): string {
    const resourceName = getPermissionResourceLabel(resource);
    const resourceLabel = target && target !== '*' ? `${resourceName} (${target})` : resourceName;
    if (decision === 'denied') {
        return `${displayName} 对 ${resourceLabel} 的请求已被拒绝，请在安全中心手动重置。`;
    }

    if (decision === 'blocked') {
        return `${displayName} 对 ${resourceLabel} 的请求被平台安全规则或管理员策略封锁。`;
    }

    return `${displayName} 没有获得 ${resourceLabel} 的访问授权。`;
}

export function getPermissionEvaluationMessage(
    displayName: string,
    resource: PermissionResource,
    target: string,
    decision: PermissionEvaluateResponse['decision'],
): string {
    if (decision === 'granted') {
        const resourceName = getPermissionResourceLabel(resource);
        const resourceLabel = target && target !== '*' ? `${resourceName} (${target})` : resourceName;
        return `${displayName} 当前已获得 ${resourceLabel} 的访问授权。`;
    }

    return getPermissionFailureMessage(displayName, resource, target, decision);
}

export function getAuthorityPermissionErrorCode(decision: AuthorityPermissionErrorDecision): AuthorityPermissionErrorCode {
    if (decision === 'denied') {
        return 'permission_denied';
    }

    if (decision === 'blocked') {
        return 'permission_blocked';
    }

    return 'permission_not_granted';
}

export function getPermissionResourceLabel(resource: PermissionResource): string {
    switch (resource) {
        case 'storage.kv':
            return 'KV 存储';
        case 'storage.blob':
            return 'Blob 存储';
        case 'fs.private':
            return '私有文件夹';
        case 'sql.private':
            return '私有 SQL 数据库';
        case 'trivium.private':
            return '私有记忆数据库';
        case 'http.fetch':
            return 'HTTP 访问';
        case 'jobs.background':
            return '后台任务';
        case 'events.stream':
            return '事件流';
        default:
            return resource;
    }
}

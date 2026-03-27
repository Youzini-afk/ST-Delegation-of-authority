import { MAX_AUDIT_LINES } from '../constants.js';
import { getUserAuthorityPaths } from '../store/authority-paths.js';
import type { ActivityRecord, UserContext } from '../types.js';
import { appendJsonl, nowIso, tailJsonl } from '../utils.js';

export class AuditService {
    logPermission(user: UserContext, extensionId: string, message: string, details?: Record<string, unknown>): void {
        const paths = getUserAuthorityPaths(user);
        const record: ActivityRecord = {
            timestamp: nowIso(),
            kind: 'permission',
            extensionId,
            message,
        };

        if (details) {
            record.details = details;
        }

        appendJsonl(paths.permissionsAuditFile, record);
    }

    logUsage(user: UserContext, extensionId: string, message: string, details?: Record<string, unknown>): void {
        const paths = getUserAuthorityPaths(user);
        const record: ActivityRecord = {
            timestamp: nowIso(),
            kind: 'usage',
            extensionId,
            message,
        };

        if (details) {
            record.details = details;
        }

        appendJsonl(paths.usageAuditFile, record);
    }

    logError(user: UserContext, extensionId: string, message: string, details?: Record<string, unknown>): void {
        const paths = getUserAuthorityPaths(user);
        const record: ActivityRecord = {
            timestamp: nowIso(),
            kind: 'error',
            extensionId,
            message,
        };

        if (details) {
            record.details = details;
        }

        appendJsonl(paths.errorsAuditFile, record);
    }

    getRecentActivity(user: UserContext, extensionId: string): { permissions: ActivityRecord[]; usage: ActivityRecord[]; errors: ActivityRecord[] } {
        const paths = getUserAuthorityPaths(user);

        return {
            permissions: tailJsonl<ActivityRecord>(paths.permissionsAuditFile, MAX_AUDIT_LINES).filter(item => item.extensionId === extensionId),
            usage: tailJsonl<ActivityRecord>(paths.usageAuditFile, MAX_AUDIT_LINES).filter(item => item.extensionId === extensionId),
            errors: tailJsonl<ActivityRecord>(paths.errorsAuditFile, MAX_AUDIT_LINES).filter(item => item.extensionId === extensionId),
        };
    }
}

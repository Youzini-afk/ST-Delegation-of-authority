import { MAX_AUDIT_LINES } from '../constants.js';
import { getUserAuthorityPaths } from '../store/authority-paths.js';
import type { ActivityRecord, UserContext } from '../types.js';
import { nowIso } from '../utils.js';
import { CoreService } from './core-service.js';

export class AuditService {
    constructor(private readonly core: CoreService) {}

    async logPermission(user: UserContext, extensionId: string, message: string, details?: Record<string, unknown>): Promise<void> {
        await this.log(user, {
            timestamp: nowIso(),
            kind: 'permission',
            extensionId,
            message,
            ...(details ? { details } : {}),
        });
    }

    async logUsage(user: UserContext, extensionId: string, message: string, details?: Record<string, unknown>): Promise<void> {
        await this.log(user, {
            timestamp: nowIso(),
            kind: 'usage',
            extensionId,
            message,
            ...(details ? { details } : {}),
        });
    }

    async logError(user: UserContext, extensionId: string, message: string, details?: Record<string, unknown>): Promise<void> {
        await this.log(user, {
            timestamp: nowIso(),
            kind: 'error',
            extensionId,
            message,
            ...(details ? { details } : {}),
        });
    }

    async logWarning(user: UserContext, extensionId: string, message: string, details?: Record<string, unknown>): Promise<void> {
        await this.log(user, {
            timestamp: nowIso(),
            kind: 'warning',
            extensionId,
            message,
            ...(details ? { details } : {}),
        });
    }

    async getRecentActivity(user: UserContext, extensionId: string): Promise<{ permissions: ActivityRecord[]; usage: ActivityRecord[]; errors: ActivityRecord[]; warnings: ActivityRecord[] }> {
        const response = await this.getRecentActivityPage(user, extensionId);
        return {
            permissions: response.permissions,
            usage: response.usage,
            errors: response.errors,
            warnings: response.warnings,
        };
    }

    async getRecentActivityPage(user: UserContext, extensionId: string) {
        const paths = getUserAuthorityPaths(user);
        return await this.core.getRecentControlAudit(paths.controlDbFile, {
            userHandle: user.handle,
            extensionId,
            limit: MAX_AUDIT_LINES,
        });
    }

    private async log(user: UserContext, record: ActivityRecord): Promise<void> {
        const paths = getUserAuthorityPaths(user);
        await this.core.logControlAudit(paths.controlDbFile, {
            userHandle: user.handle,
            record,
        });
    }
}

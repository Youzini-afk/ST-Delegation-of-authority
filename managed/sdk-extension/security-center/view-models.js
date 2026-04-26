import { sortByTimestampDesc } from './formatters.js';
export function buildOverviewModel(state) {
    const databaseGroups = getDatabaseGroupSummaries(state.extensions, state.details);
    const totalDatabaseCount = databaseGroups.reduce((sum, item) => sum + item.databaseCount, 0);
    const totalDatabaseSize = databaseGroups.reduce((sum, item) => sum + item.totalSizeBytes, 0);
    const allDetails = [...state.details.values()];
    const allJobs = allDetails
        .flatMap(detail => detail.jobs)
        .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt));
    const activeJobs = allJobs.filter(item => item.status === 'queued' || item.status === 'running').slice(0, 8);
    const failedJobs = allJobs.filter(item => item.status === 'failed' || item.status === 'cancelled').slice(0, 8);
    const recentErrors = allDetails
        .flatMap(detail => detail.activity.errors)
        .sort(sortByTimestampDesc)
        .slice(0, 8);
    const recentWarnings = allDetails
        .flatMap(detail => detail.activity.warnings)
        .sort(sortByTimestampDesc)
        .slice(0, 8);
    const recentPermissionDenials = allDetails
        .flatMap(detail => detail.activity.permissions)
        .filter(item => item.message === 'Permission denied')
        .sort(sortByTimestampDesc)
        .slice(0, 8);
    const recentActivity = allDetails
        .flatMap(detail => [...detail.activity.permissions, ...detail.activity.usage, ...detail.activity.errors, ...detail.activity.warnings])
        .sort(sortByTimestampDesc)
        .slice(0, 8);
    return {
        databaseGroups,
        totalDatabaseCount,
        totalDatabaseSize,
        totalBlobBytes: state.extensions.reduce((sum, item) => sum + item.storage.blobBytes, 0),
        totalPrivateFileBytes: state.extensions.reduce((sum, item) => sum + item.storage.files.totalSizeBytes, 0),
        totalGrantCount: allDetails.reduce((sum, detail) => sum + detail.grants.length, 0),
        totalPolicyCount: allDetails.reduce((sum, detail) => sum + detail.policies.length, 0),
        activeJobs,
        failedJobs,
        recentErrors,
        recentWarnings,
        recentPermissionDenials,
        recentActivity,
    };
}
export function getDatabaseGroupSummaries(extensions, details) {
    return extensions.map(extension => {
        const databases = [...(details.get(extension.id)?.databases ?? [])]
            .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt));
        const triviumDatabases = [...(details.get(extension.id)?.triviumDatabases ?? [])]
            .sort((left, right) => (right.updatedAt ?? '').localeCompare(left.updatedAt ?? ''));
        const latestUpdatedAt = [
            databases[0]?.updatedAt ?? null,
            triviumDatabases[0]?.updatedAt ?? null,
        ]
            .filter((value) => value !== null)
            .sort((left, right) => right.localeCompare(left))[0] ?? null;
        return {
            extension,
            databases,
            triviumDatabases,
            databaseCount: databases.length + triviumDatabases.length,
            totalSizeBytes: databases.reduce((sum, item) => sum + item.sizeBytes, 0) + triviumDatabases.reduce((sum, item) => sum + item.totalSizeBytes, 0),
            latestUpdatedAt,
        };
    })
        .filter(item => item.databaseCount > 0)
        .sort((left, right) => (right.latestUpdatedAt ?? '').localeCompare(left.latestUpdatedAt ?? ''));
}
//# sourceMappingURL=view-models.js.map
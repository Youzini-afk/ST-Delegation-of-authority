import type { PermissionResource, PermissionStatus } from '@stdo/shared-types';

export const RESOURCE_OPTIONS: PermissionResource[] = [
    'storage.kv',
    'storage.blob',
    'fs.private',
    'sql.private',
    'trivium.private',
    'http.fetch',
    'jobs.background',
    'events.stream',
    'module.execute',
    'agent.run',
    'agent.browser',
];

export const STATUS_OPTIONS: PermissionStatus[] = ['prompt', 'granted', 'denied', 'blocked'];

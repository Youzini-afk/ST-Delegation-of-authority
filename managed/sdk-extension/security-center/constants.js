import { AUTHORITY_EXTENSION_DISPLAY_NAME, AUTHORITY_EXTENSION_ID, AUTHORITY_EXTENSION_VERSION, } from '../api.js';
export const SECURITY_CENTER_CONFIG = {
    extensionId: AUTHORITY_EXTENSION_ID,
    displayName: AUTHORITY_EXTENSION_DISPLAY_NAME,
    version: AUTHORITY_EXTENSION_VERSION,
    installType: 'local',
    declaredPermissions: {},
    uiLabel: '扩展权限中心',
};
export const RESOURCE_OPTIONS = ['storage.kv', 'storage.blob', 'fs.private', 'sql.private', 'trivium.private', 'http.fetch', 'jobs.background', 'events.stream'];
export const STATUS_OPTIONS = ['prompt', 'granted', 'denied', 'blocked'];
export const TOP_BAR_DRAWER_ID = 'authority-security-center-drawer';
export const TOP_BAR_ICON_ID = 'authority-security-center-drawer-icon';
export const TOP_BAR_CONTENT_ID = 'authority-security-center-drawer-content';
//# sourceMappingURL=constants.js.map
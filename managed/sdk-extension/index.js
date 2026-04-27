import { bootstrapSecurityCenter, openSecurityCenter } from './security-center.js';
import { AuthoritySDK } from './sdk.js';
void bootstrapSecurityCenter();
window.STAuthority = {
    AuthoritySDK,
    openSecurityCenter,
};
export { AuthorityClient, AuthorityPermissionError, isAuthorityPermissionError, splitAuthorityItemsIntoChunks, } from './client.js';
export { AuthorityApiError } from './api.js';
export { AuthoritySDK, openSecurityCenter };
//# sourceMappingURL=index.js.map
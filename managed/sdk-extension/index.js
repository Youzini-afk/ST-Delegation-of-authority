import { bootstrapSecurityCenter, openSecurityCenter } from './security-center.js';
import { AuthoritySDK } from './sdk.js';
void bootstrapSecurityCenter();
window.STAuthority = {
    AuthoritySDK,
    openSecurityCenter,
};
export { AuthoritySDK, openSecurityCenter };
//# sourceMappingURL=index.js.map
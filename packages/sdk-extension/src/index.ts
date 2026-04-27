import { bootstrapSecurityCenter, openSecurityCenter } from './security-center.js';
import { AuthoritySDK } from './sdk.js';

void bootstrapSecurityCenter();

window.STAuthority = {
    AuthoritySDK,
    openSecurityCenter,
};

export {
    AuthorityClient,
    AuthorityPermissionError,
    isAuthorityPermissionError,
    splitAuthorityItemsIntoChunks,
} from './client.js';
export {
    AuthorityApiError,
    AuthorityAuthError,
    AuthoritySessionError,
    AuthorityValidationError,
    AuthorityLimitError,
    AuthorityTimeoutError,
    AuthorityCoreError,
} from './api.js';
export type {
    AuthorityChunk,
    AuthorityChunkSplitOptions,
    AuthorityChunkedFailure,
    AuthorityChunkedMutationChunkResult,
    AuthorityChunkedTriviumMutationResult,
    AuthorityChunkedTriviumOptions,
    AuthorityChunkedTriviumProgress,
    AuthorityChunkedTriviumUpsertResult,
    AuthorityPermissionErrorCode,
    AuthorityPermissionErrorDecision,
    AuthorityPermissionErrorDetails,
    AuthorityPermissionExplainResult,
} from './client.js';
export { AuthoritySDK, openSecurityCenter };

import { bootstrapSecurityCenter, openSecurityCenter } from './security-center.js';
import { AuthoritySDK } from './sdk.js';

void bootstrapSecurityCenter();

window.STAuthority = {
    AuthoritySDK,
    openSecurityCenter,
};

export {
    AuthorityClient,
    splitAuthorityItemsIntoChunks,
} from './client.js';
export type {
    AuthorityChunk,
    AuthorityChunkSplitOptions,
    AuthorityChunkedFailure,
    AuthorityChunkedMutationChunkResult,
    AuthorityChunkedTriviumMutationResult,
    AuthorityChunkedTriviumOptions,
    AuthorityChunkedTriviumProgress,
    AuthorityChunkedTriviumUpsertResponseItem,
    AuthorityChunkedTriviumUpsertResult,
} from './client.js';
export { AuthoritySDK, openSecurityCenter };

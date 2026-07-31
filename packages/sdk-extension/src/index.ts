import { bootstrapSecurityCenter, openSecurityCenter } from './security-center.js';
import { AuthoritySDK } from './sdk.js';
import { bootstrapHostEventRecorder } from './host-event-recorder.js';

void bootstrapSecurityCenter();

window.STAuthority = {
    AuthoritySDK,
    openSecurityCenter,
};

bootstrapHostEventRecorder();

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
    AgentSessionRunWaitOptions,
    AgentSessionSubscribeOptions,
    AgentWorkspaceDiffOptions,
    AuthorityModuleTransactionOptions,
    AuthorityModuleTransactionResponse,
    AuthorityPermissionErrorCode,
    AuthorityPermissionErrorDecision,
    AuthorityPermissionErrorDetails,
    AuthorityPermissionExplainResult,
} from './client.js';
export type {
    AuthorityHostChange,
    AuthorityHostCommitEvent,
    AuthorityHostCommitResponse,
    AuthorityHostConversationState,
    AuthorityHostEventListRequest,
    AuthorityHostEventListResponse,
    AuthorityHostEventRecord,
    AuthorityHostTransactionContext,
} from '@stdo/shared-types';
export { AuthoritySDK, openSecurityCenter };

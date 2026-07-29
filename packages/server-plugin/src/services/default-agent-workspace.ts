import type { AgentWorkspaceRecord, AgentWorkspaceRegisterRequest } from '@stdo/shared-types';

export const DEFAULT_AGENT_WORKSPACE_ID = 'sillytavern';

interface DefaultAgentWorkspaceServices {
    install: {
        getSillyTavernRoot(): string | null;
    };
    workspaceHistory: {
        registerWorkspace(request: AgentWorkspaceRegisterRequest): Promise<AgentWorkspaceRecord>;
    };
}

/**
 * Resolves and idempotently registers the built-in Agent scope. The history
 * registry deduplicates by canonical root path, so existing installations
 * keep their original workspace id while the UI still receives the real
 * record to use.
 */
export async function ensureDefaultAgentWorkspace(
    services: DefaultAgentWorkspaceServices,
): Promise<AgentWorkspaceRecord | null> {
    const sillyTavernRoot = services.install.getSillyTavernRoot();
    if (!sillyTavernRoot) return null;
    return await services.workspaceHistory.registerWorkspace({
        id: DEFAULT_AGENT_WORKSPACE_ID,
        displayName: 'SillyTavern',
        rootPath: sillyTavernRoot,
    });
}

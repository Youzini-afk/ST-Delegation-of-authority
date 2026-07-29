import { describe, expect, it, vi } from 'vitest';
import { ensureDefaultAgentWorkspace } from './default-agent-workspace.js';

describe('default Agent workspace', () => {
    it('registers the resolved SillyTavern root with a stable preferred id', async () => {
        const workspace = { id: 'existing-root-record' } as never;
        const registerWorkspace = vi.fn().mockResolvedValue(workspace);

        await expect(ensureDefaultAgentWorkspace({
            install: { getSillyTavernRoot: () => 'D:\\SillyTavern' },
            workspaceHistory: { registerWorkspace },
        })).resolves.toBe(workspace);
        expect(registerWorkspace).toHaveBeenCalledWith({
            id: 'sillytavern',
            displayName: 'SillyTavern',
            rootPath: 'D:\\SillyTavern',
        });
    });

    it('does not create a misleading scope when the SillyTavern root is unknown', async () => {
        const registerWorkspace = vi.fn();
        await expect(ensureDefaultAgentWorkspace({
            install: { getSillyTavernRoot: () => null },
            workspaceHistory: { registerWorkspace },
        })).resolves.toBeNull();
        expect(registerWorkspace).not.toHaveBeenCalled();
    });
});

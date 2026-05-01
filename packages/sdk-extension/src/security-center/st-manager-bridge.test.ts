import { describe, expect, it } from 'vitest';
import {
    buildStManagerBridgePayload,
    normalizeStManagerBridgeConfig,
    renderStManagerBridgeSection,
    ST_MANAGER_RESOURCE_OPTIONS,
    type StManagerBridgeConfig,
} from './st-manager-bridge.js';

describe('st-manager bridge view helpers', () => {
    const config: StManagerBridgeConfig = {
        enabled: false,
        bound_user_handle: null,
        key_fingerprint: null,
        key_masked: null,
        max_file_size: 100 * 1024 * 1024,
        resource_types: ['characters', 'chats', 'worlds', 'presets', 'regex', 'quick_replies'],
    };

    it('renders the bridge configuration panel with key generation and resource controls', () => {
        const html = renderStManagerBridgeSection(config, null, false);

        expect(html).toContain('ST-Manager 远程备份桥接');
        expect(html).toContain('data-action="rotate-st-manager-bridge-key"');
        expect(html).toContain('启用并生成 Key');
        for (const option of ST_MANAGER_RESOURCE_OPTIONS) {
            expect(html).toContain(`value="${option.type}"`);
            expect(html).toContain(option.label);
        }
    });

    it('renders a newly generated bridge key as a one-time copy field', () => {
        const html = renderStManagerBridgeSection({
            ...config,
            enabled: true,
            bound_user_handle: 'alice',
            key_masked: 'stmb_abc...1234',
            key_fingerprint: 'abcdef123456',
        }, 'stmb_plain_key', false);

        expect(html).toContain('value="stmb_plain_key"');
        expect(html).toContain('data-action="copy-st-manager-bridge-key"');
        expect(html).toContain('alice');
        expect(html).toContain('stmb_abc...1234');
    });

    it('builds a safe admin config payload from form values', () => {
        expect(buildStManagerBridgePayload({
            enabled: true,
            maxFileSizeMiB: 256,
            resourceTypes: ['characters', 'regex', 'bad'],
            rotateKey: true,
        })).toEqual({
            enabled: true,
            max_file_size: 256 * 1024 * 1024,
            resource_types: ['characters', 'regex'],
            rotate_key: true,
        });
    });

    it('normalizes, renders, and saves negative max file size as unlimited', () => {
        const unlimitedConfig = normalizeStManagerBridgeConfig({
            ...config,
            max_file_size: -1024,
        });

        expect(unlimitedConfig?.max_file_size).toBe(-1);
        expect(renderStManagerBridgeSection(unlimitedConfig, null, false)).toContain('单文件上限：不限制');
        expect(renderStManagerBridgeSection(unlimitedConfig, null, false)).toContain('value="-1"');
        expect(buildStManagerBridgePayload({
            enabled: true,
            maxFileSizeMiB: -1,
            resourceTypes: ['characters'],
        })).toEqual({
            enabled: true,
            max_file_size: -1,
            resource_types: ['characters'],
        });
    });
});

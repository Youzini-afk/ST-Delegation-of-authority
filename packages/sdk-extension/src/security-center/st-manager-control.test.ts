import { describe, expect, it } from 'vitest';
import {
    buildStManagerControlPayload,
    normalizeStManagerControlConfig,
    renderStManagerControlSection,
} from './st-manager-control.js';

describe('st-manager control view helpers', () => {
    it('normalizes public config and builds save payload', () => {
        const config = normalizeStManagerControlConfig({
            enabled: true,
            manager_url: 'https://manager.example',
            control_key_masked: 'stmc...abcd',
            control_key_fingerprint: 'abcdef123456',
        });

        expect(config).toEqual({
            enabled: true,
            manager_url: 'https://manager.example',
            control_key_masked: 'stmc...abcd',
            control_key_fingerprint: 'abcdef123456',
        });
        expect(buildStManagerControlPayload({
            enabled: true,
            managerUrl: 'https://manager.example/',
            controlKey: 'stmc_plain',
        })).toEqual({
            enabled: true,
            manager_url: 'https://manager.example',
            control_key: 'stmc_plain',
        });
    });

    it('renders backup, list, restore preview, and restore controls', () => {
        const html = renderStManagerControlSection({
            enabled: true,
            manager_url: 'https://manager.example',
            control_key_masked: 'stmc...abcd',
            control_key_fingerprint: 'abcdef123456',
        }, [{ backup_id: 'backup-001', created_at: '2026-05-01', total_files: 2 }], false);

        expect(html).toContain('ST-Manager 控制');
        expect(html).toContain('data-action="probe-st-manager-control"');
        expect(html).toContain('data-action="pair-st-manager-control"');
        expect(html).toContain('data-action="start-st-manager-backup"');
        expect(html).toContain('data-action="preview-st-manager-restore"');
        expect(html).toContain('data-action="restore-st-manager-backup"');
        expect(html).toContain('允许覆盖');
        expect(html).toContain('backup-001');
    });
});

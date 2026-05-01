import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
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
        expect(html).toContain('只需要 ST-Manager URL 和 Control Key');
        expect(html).toContain('data-action="probe-st-manager-control"');
        expect(html).toContain('data-action="pair-st-manager-control"');
        expect(html).toContain('同步回连配置（可选）');
        expect(html).toContain('data-role="st-manager-control-resource"');
        expect(html).toContain('data-action="start-st-manager-backup"');
        expect(html).toContain('data-action="preview-st-manager-restore"');
        expect(html).toContain('data-action="restore-st-manager-backup"');
        expect(html).toContain('允许覆盖');
        expect(html).toContain('backup-001');
    });

    it('renders the control key as a hideable password field', () => {
        const html = renderStManagerControlSection({
            enabled: true,
            manager_url: 'https://manager.example',
            control_key_masked: 'stmc...abcd',
            control_key_fingerprint: 'abcdef123456',
        }, [], false);

        expect(html).toContain('data-role="st-manager-control-key" type="password"');
        expect(html).toContain('data-action="toggle-secret-visibility"');
        expect(html).toContain('data-target-role="st-manager-control-key"');
    });

    it('captures control form values before rendering the busy state', () => {
        const source = fs.readFileSync(path.resolve(__dirname, '../security-center.ts'), 'utf8');
        const methodStart = source.indexOf('private async updateStManagerControlConfig()');
        const methodEnd = source.indexOf('private async probeStManagerControl()', methodStart);
        const method = source.slice(methodStart, methodEnd);

        expect(method.indexOf('const payload = buildStManagerControlPayload')).toBeGreaterThanOrEqual(0);
        expect(method.indexOf('this.state.stManagerControlActionInProgress = true')).toBeGreaterThanOrEqual(0);
        expect(method.indexOf('const payload = buildStManagerControlPayload')).toBeLessThan(
            method.indexOf('this.state.stManagerControlActionInProgress = true'),
        );
    });
});

import { describe, expect, it } from 'vitest';
import { RESOURCE_OPTIONS } from './options.js';
import {
    renderAuditWorkspace,
    renderDataAssets,
    renderExtensionDirectory,
    renderExtensionDossier,
    renderGovernanceOverview,
    renderPolicyOverrideRow,
    renderPolicyWorkbench,
} from './governance-workbench.js';
import type { ExtensionDetailResponse, ExtensionSummary, SecurityCenterState } from './types.js';

describe('Extension governance workbench rendering', () => {
    it('renders a searchable active directory and escapes extension identity', () => {
        const state = governanceState();
        const extension = extensionSummary('<unsafe> Memory');
        state.extensions = [extension];
        state.selectedExtensionId = extension.id;
        state.extensionFilter = 'memory';

        const directory = renderExtensionDirectory(state);

        expect(directory.count).toBe(1);
        expect(directory.html).toContain('&lt;unsafe&gt; Memory');
        expect(directory.html).not.toContain('<unsafe>');
        expect(directory.html).toContain('aria-current="page"');
        expect(directory.html).toContain(`data-extension-id="${extension.id}"`);
    });

    it('keeps overview, data, and audit as focused workspaces instead of metric walls', () => {
        const state = governanceState();

        const overview = renderGovernanceOverview(state);
        const data = renderDataAssets(state);
        const audit = renderAuditWorkspace(state);

        expect(overview).toContain('authority-governance-glance');
        expect(overview).toContain('data-tab="activity"');
        expect(overview).toContain('authority-context-rail');
        expect(data).toContain('authority-data-workspace');
        expect(data).toContain('当前没有发现任何扩展私有数据库');
        expect(audit).toContain('authority-audit-workspace');
        expect(audit).toContain('需要关注');
        expect(overview).not.toContain('authority-metric-grid');
    });

    it('renders extension capabilities, data, grants, and audit controls without losing actions', () => {
        const state = governanceState();
        const extension = extensionSummary('Bionic Memory Ecology');
        state.extensions = [extension];
        state.selectedExtensionId = extension.id;
        state.details.set(extension.id, extensionDetail(extension));

        const html = renderExtensionDossier(state);

        expect(html).toContain('authority-extension-dossier');
        expect(html).toContain('id="authority-extension-permission-inspector" role="tabpanel"');
        expect(html).toContain('aria-labelledby="authority-mobile-governance-tab-permissions"');
        expect(html).toContain('storage.kv');
        expect(html).toContain('data-tab="databases"');
        expect(html).toContain('data-tab="policies"');
        expect(html).toContain('data-action="reset-all-grants"');
        expect(html).toContain('data-tab="activity"');
        expect(html).toContain('authority-storage-strip');
        expect(html).toContain('authority-extension-inspector');
    });

    it('keeps every policy field and adds accessible field names', () => {
        const state = governanceState();
        state.policies = {
            defaults: Object.fromEntries(RESOURCE_OPTIONS.map(resource => [resource, 'prompt'])),
            extensions: {},
            limits: {} as NonNullable<SecurityCenterState['policies']>['limits'],
            updatedAt: '2026-07-30T00:00:00.000Z',
        };

        const policy = renderPolicyWorkbench(state);
        const row = renderPolicyOverrideRow();

        expect(policy).toContain('data-policy-default=');
        expect(policy).toContain('data-policy-editor-extension');
        expect(policy).toContain('data-role="policy-rows"');
        expect(policy).toContain('data-action="add-policy-row"');
        expect(policy).toContain('data-action="save-policies"');
        expect(policy).toContain('aria-label="键值数据的默认决定"');
        expect(row).toContain('data-policy-field="resource"');
        expect(row).toContain('data-policy-field="target"');
        expect(row).toContain('data-policy-field="status"');
        expect(row).toContain('data-action="remove-policy-row"');
        expect(row).toContain('aria-label="覆盖目标"');
    });
});

function governanceState(): SecurityCenterState {
    return {
        loading: false,
        error: null,
        isAdmin: true,
        probe: null,
        session: null,
        usageSummary: null,
        extensions: [],
        details: new Map(),
        selectedExtensionId: null,
        selectedTab: 'detail',
        extensionFilter: '',
        policies: null,
        agent: {} as SecurityCenterState['agent'],
        system: {} as SecurityCenterState['system'],
        mobile: { surface: 'none' },
        policyEditorExtensionId: null,
        packageOperations: [],
        packageActionInProgress: false,
        nativeMigrationOperations: [],
        nativeMigrationActionInProgress: false,
        stManagerBridgeConfig: null,
        stManagerBridgeGeneratedKey: null,
        stManagerBridgeActionInProgress: false,
        stManagerControlConfig: null,
        stManagerControlBackups: [],
        stManagerControlActionInProgress: false,
        updateResult: null,
        updateInProgress: false,
    };
}

function extensionSummary(displayName: string): ExtensionSummary {
    return {
        id: 'third-party/bionic-memory',
        displayName,
        version: '8.0.8',
        installType: 'local',
        firstSeenAt: '2026-07-01T00:00:00.000Z',
        lastSeenAt: '2026-07-30T00:00:00.000Z',
        declaredPermissions: { storage: { kv: true, blob: true } },
        grantedCount: 1,
        deniedCount: 0,
        storage: emptyStorage(),
    } as ExtensionSummary;
}

function extensionDetail(extension: ExtensionSummary): ExtensionDetailResponse {
    return {
        extension,
        grants: [],
        policies: [],
        storage: emptyStorage(),
        databases: [],
        triviumDatabases: [],
        jobs: [],
        activity: { permissions: [], usage: [], warnings: [], errors: [] },
    } as unknown as ExtensionDetailResponse;
}

function emptyStorage() {
    return {
        kvEntries: 0,
        blobCount: 0,
        blobBytes: 0,
        sqlDatabaseCount: 0,
        sqlDatabaseBytes: 0,
        triviumDatabaseCount: 0,
        triviumDatabaseBytes: 0,
        files: { fileCount: 0, totalSizeBytes: 0 },
    };
}

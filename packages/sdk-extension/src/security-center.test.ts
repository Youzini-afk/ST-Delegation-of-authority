import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

describe('Security Center tab interaction', () => {
    const source = fs.readFileSync(path.resolve(__dirname, 'security-center.ts'), 'utf8');
    const components = fs.readFileSync(path.resolve(__dirname, 'security-center/components.ts'), 'utf8');
    const constants = fs.readFileSync(path.resolve(__dirname, 'security-center/constants.ts'), 'utf8');
    const impactConfirmation = fs.readFileSync(path.resolve(__dirname, 'security-center/impact-confirmation.ts'), 'utf8');
    const agentWorkbench = fs.readFileSync(path.resolve(__dirname, 'security-center/agent-workbench.ts'), 'utf8');
    const governanceWorkbench = fs.readFileSync(path.resolve(__dirname, 'security-center/governance-workbench.ts'), 'utf8');
    const systemWorkbench = fs.readFileSync(path.resolve(__dirname, 'security-center/system-workbench.ts'), 'utf8');
    const html = fs.readFileSync(path.resolve(__dirname, '../static/security-center.html'), 'utf8');
    const css = fs.readFileSync(path.resolve(__dirname, '../static/style.css'), 'utf8');
    const systemCss = fs.readFileSync(path.resolve(__dirname, '../static/styles/system-workbench.css'), 'utf8');

    it('declares a primary tab name whitelist matching all valid CenterTab values', () => {
        expect(source).toContain("const PRIMARY_TAB_NAMES: readonly CenterTab[] = ['overview', 'detail', 'databases', 'activity', 'agent', 'policies', 'updates', 'settings']");
    });

    it('provides a type guard to validate arbitrary tab values against the whitelist', () => {
        expect(source).toContain('function isValidCenterTab(value: string | undefined): value is CenterTab {');
        expect(source).toContain('(PRIMARY_TAB_NAMES as readonly string[]).includes(value)');
    });

    it('maps the eight views into Agent, extensions, system, and settings areas', () => {
        expect(source).toContain("type CenterArea = 'agent' | 'governance' | 'system' | 'settings'");
        expect(source).toContain("if (tab === 'agent') return 'agent'");
        expect(source).toContain("if (tab === 'updates') return 'system'");
        expect(source).toContain("if (tab === 'settings') return 'settings'");
        expect(source).toContain("return 'governance'");
    });

    it('validates tab values in switchTab against the primary tab whitelist', () => {
        const switchTabStart = source.indexOf('private switchTab(tab: CenterTab): void {');
        expect(switchTabStart).toBeGreaterThanOrEqual(0);
        const switchTabEnd = source.indexOf('private render(): void {', switchTabStart);
        const switchTabBody = source.slice(switchTabStart, switchTabEnd);
        expect(switchTabBody).toContain('PRIMARY_TAB_NAMES.includes(tab)');
        expect(switchTabBody).toContain("tab === 'agent' || tab === 'policies' || tab === 'updates' || tab === 'settings'");
        expect(switchTabBody).toContain('this.state.selectedTab === tab');
        expect(switchTabBody).toContain('this.renderTabs()');
        expect(switchTabBody).toContain('this.toggleSections()');
        expect(switchTabBody).not.toContain('this.render()');
    });

    it('renders the active primary area and manages the governance tablist', () => {
        const renderTabsStart = source.indexOf('private renderTabs(): void {');
        expect(renderTabsStart).toBeGreaterThanOrEqual(0);
        const renderTabsEnd = source.indexOf('private renderExtensionList(): void {', renderTabsStart);
        const renderTabsBody = source.slice(renderTabsStart, renderTabsEnd);
        expect(renderTabsBody).toContain("'[data-area]'");
        expect(renderTabsBody).toContain("'authority-area-tab--active'");
        expect(renderTabsBody).toContain("'aria-current'");
        expect(renderTabsBody).toContain("'[data-role=\"governance-tabs\"]'");
        expect(renderTabsBody).toContain('[role="tablist"]');
        expect(renderTabsBody).toContain('[role="tab"]');
        expect(renderTabsBody).toContain('PRIMARY_TAB_NAMES.includes(tabName)');
        expect(renderTabsBody).toContain('aria-selected');
        expect(renderTabsBody).toContain("tab.setAttribute('tabindex'");
    });

    it('maintains aria-hidden and tabindex for tab panels in toggleSections', () => {
        const toggleSectionsStart = source.indexOf('private toggleSections(): void {');
        expect(toggleSectionsStart).toBeGreaterThanOrEqual(0);
        const toggleSectionsEnd = source.indexOf('private resolveSelectedExtensionId(): string | null {', toggleSectionsStart);
        const toggleSectionsBody = source.slice(toggleSectionsStart, toggleSectionsEnd);
        expect(toggleSectionsBody).toContain("'[data-area-panel]'");
        expect(toggleSectionsBody).toContain('getCenterArea(this.state.selectedTab)');
        expect(toggleSectionsBody).toContain('PRIMARY_TAB_NAMES.includes(name)');
        expect(toggleSectionsBody).toContain('aria-hidden');
        expect(toggleSectionsBody).toContain("section.setAttribute('tabindex'");
    });

    it('adds keyboard navigation for the primary tablist with ArrowLeft/ArrowRight/Home/End', () => {
        expect(source).toContain("case 'ArrowLeft':");
        expect(source).toContain("case 'ArrowRight':");
        expect(source).toContain("case 'Home':");
        expect(source).toContain("case 'End':");
        expect(source).toContain('event.preventDefault();');
        expect(source).toContain('nextTab.focus();');
        expect(source).toContain('this.switchTab(tab);');
        expect(source).toContain("inspectorTab === 'activity' || inspectorTab === 'workspace'");
        expect(source).toContain('this.selectAgentInspectorTab(inspectorTab);');
    });

    it('preserves delegated click handling via Element.closest for SVG compatibility', () => {
        const bindEventsStart = source.indexOf('private bindEvents(): void {');
        expect(bindEventsStart).toBeGreaterThanOrEqual(0);
        const bindEventsEnd = source.indexOf('private async refresh(): Promise<void> {', bindEventsStart);
        const bindEventsBody = source.slice(bindEventsStart, bindEventsEnd);
        expect(bindEventsBody).toContain('event.target instanceof Element');
        expect(bindEventsBody).toContain("target.closest<HTMLElement>('.authority-tab[data-tab]')");
        expect(bindEventsBody).toContain("target.closest<HTMLElement>('[data-tab]:not(.authority-tab)')");
    });

    it('separates primary tab clicks from non-primary data-tab action buttons', () => {
        const bindEventsStart = source.indexOf('private bindEvents(): void {');
        expect(bindEventsStart).toBeGreaterThanOrEqual(0);
        const bindEventsEnd = source.indexOf('private async refresh(): Promise<void> {', bindEventsStart);
        const bindEventsBody = source.slice(bindEventsStart, bindEventsEnd);
        // Primary tabs use the tablist-aware path
        expect(bindEventsBody).toContain("target.closest<HTMLElement>('.authority-tab[data-tab]')");
        // Action buttons (hero CTA, back button) use a separate path without role=tab assumptions
        expect(bindEventsBody).toContain("target.closest<HTMLElement>('[data-tab]:not(.authority-tab)')");
        // Both paths validate through the type guard before calling switchTab
        expect(bindEventsBody).toContain('if (isValidCenterTab(tab)) {');
    });

    it('static HTML preserves all eight panels and groups them below four primary areas', () => {
        const areas = Array.from(html.matchAll(/<button[^>]*class="authority-area-tab"[^>]*data-area="([^"]+)"[^>]*>/g));
        const tabs = Array.from(html.matchAll(/<button[^>]*class="authority-tab"[^>]*data-tab="([^"]+)"[^>]*>/g));
        const panels = Array.from(html.matchAll(/<section[^>]*data-section="([^"]+)"[^>]*>/g));
        const areaPanels = Array.from(html.matchAll(/<section[^>]*data-area-panel="([^"]+)"[^>]*>/g));
        const areaNames = areas.map(match => match[1]);
        const tabNames = tabs.map(match => match[1]);
        const panelNames = panels.map(match => match[1]);

        expect(areaNames).toEqual(['agent', 'governance', 'system', 'settings']);
        expect(tabNames).toEqual(['detail', 'overview', 'databases', 'activity', 'policies']);
        expect(panelNames).toEqual(['agent', 'detail', 'overview', 'databases', 'activity', 'policies', 'updates', 'settings']);
        expect(areaPanels.map(match => match[1])).toEqual(['agent', 'governance', 'system', 'settings']);

        for (const match of tabs) {
            const tabHtml = match[0];
            const tabName = match[1];
            expect(tabHtml).toContain('role="tab"');
            expect(tabHtml).toContain(`id="security-center-tab-${tabName}"`);
            expect(tabHtml).toContain(`aria-controls="security-center-tabpanel-${tabName}"`);
        }

        for (const match of panels) {
            const panelHtml = match[0];
            const panelName = match[1];
            expect(panelHtml).toContain('role="tabpanel"');
            expect(panelHtml).toContain(`id="security-center-tabpanel-${panelName}"`);
            expect(panelHtml).toContain(`aria-labelledby="security-center-tab-${panelName}"`);
        }
        expect(areas[0][0]).toContain('id="security-center-tab-agent"');
        expect(areas[2][0]).toContain('id="security-center-tab-updates"');
        expect(areas[3][0]).toContain('id="security-center-tab-settings"');
    });

    it('static HTML has role=tablist on the tab container', () => {
        expect(html).toContain('<nav class="authority-tabs" role="tablist"');
        expect(html).toContain('data-role="agent-live-status" role="status" aria-live="polite" aria-atomic="true"');
    });

    it('uses a dedicated mobile presentation layer with four stable destinations', () => {
        const mobileDestinations = Array.from(html.matchAll(/class="authority-mobile-nav__item"[^>]*data-area="([^"]+)"/g));
        expect(mobileDestinations.map(match => match[1])).toEqual(['agent', 'governance', 'system', 'settings']);
        expect(html).toContain('data-action="mobile-close-surface"');
        expect(html).toContain('data-role="mobile-governance-tabs"');
        expect(html).toContain('data-mobile-surface="governance-inspector"');
        expect(html).toContain('id="authority-mobile-governance-tab-permissions" aria-controls="authority-extension-permission-inspector"');
        expect(source).toContain("target.closest<HTMLElement>('[data-action^=\"mobile-\"]')");
        expect(source).toContain('this.root.dataset.mobileSurface = this.state.mobile.surface');
        expect(source).toContain("event.key === 'Escape' && this.mobileMediaQuery.matches");
        expect(source).toContain("nextTab.closest('[data-role=\"mobile-governance-tabs\"]')");
        expect(source).toContain("agentMain?.toggleAttribute('inert', shouldInert)");
        expect(source).toContain('getCenterArea(this.state.selectedTab) !== getCenterArea(tab)');
        expect(source).toContain("this.state.system.selectedView = 'recovery'");
        expect(source).toContain("this.setMobileSurface('settings-editor', true, undefined, mobileFocusOrigin)");
        expect(source).toContain("this.setMobileSurface('system-detail', true, undefined, mobileFocusOrigin)");
        expect(css).toContain('.authority-governance-layout > .authority-governance-stage');
        expect(css).toContain("[data-mobile-area='governance'][data-mobile-surface='governance-detail'] .authority-governance-stage");
        expect(css).toContain("[data-mobile-area='settings'][data-mobile-surface='settings-editor'] .authority-model-editor");
        expect(css).toContain('grid-template-columns: repeat(4, minmax(0, 1fr))');
    });

    it('uses restrained motion for real view changes without replaying it during background redraws', () => {
        expect(css).toContain('--authority-motion-panel: 220ms');
        expect(css).toContain('@keyframes authority-view-enter');
        expect(css).toContain('@keyframes authority-dialog-enter');
        expect(css).toContain('.authority-area-panel:not([hidden]) > .authority-section:not([hidden])');
        expect(css).toContain('.authority-motion-enter');
        expect(css).toContain('visibility 0s linear var(--authority-motion-panel)');
        expect(css).toContain('animation: none !important');
        expect(css).toContain('transition-delay: 0s !important');
        expect(css).toContain(':is(.authority-panel, .authority-permission-dialog, .authority-impact-dialog),');
        expect(source).toContain('private playSurfaceEntrance(selector: string): void');
        expect(source).toContain("window.matchMedia('(prefers-reduced-motion: reduce)').matches");
        expect(source).toContain("setInert('.authority-recovery-detail'");
        expect(source).toContain("setInert('.authority-model-editor'");
        expect(source).toContain('preparedOrigin === undefined ? this.captureMobileFocus(origin) : preparedOrigin');
        expect(systemWorkbench).toContain('class="authority-recovery-detail"');
        expect(systemCss).toContain('.authority-recovery-detail {');
        expect(systemCss).toContain('.authority-system-recovery > .authority-recovery-detail > .authority-recovery-inspector');

        const renderStart = source.indexOf('private render(): void {');
        const renderEnd = source.indexOf('private renderHeader(): void {', renderStart);
        expect(source.slice(renderStart, renderEnd)).not.toContain('playSurfaceEntrance');
        const agentSurfaceStart = source.indexOf('private renderAgentSurfaces(): void {');
        const agentSurfaceEnd = source.indexOf('private captureAgentFormDraft', agentSurfaceStart);
        expect(source.slice(agentSurfaceStart, agentSurfaceEnd)).not.toContain('playSurfaceEntrance');
    });

    it('keeps the approved direction: compact product bar, persistent top navigation, and extension-first governance', () => {
        expect(html).toContain('Delegation of Authority');
        expect(html).toContain('class="authority-app-shell"');
        expect(html).toContain('data-area="governance" data-tab="detail"');
        expect(html).toContain('data-area="settings" data-tab="settings"');
        expect(html).not.toContain('新建任务');
        expect(css).toContain('grid-template-columns: max-content minmax(0, 1fr) max-content');
        expect(css).toContain('width: min(1540px, 96vw) !important');
        expect(css).not.toContain('grid-template-columns: 82px minmax(0, 1fr)');
    });

    it('does not rebuild governance overview as a six-card metric wall', () => {
        expect(source).toContain('renderGovernanceOverview(this.state)');
        expect(governanceWorkbench).toContain('authority-governance-glance');
        expect(governanceWorkbench).not.toContain('renderMetricTile(');
    });

    it('keeps extension governance as a directory-first multi-pane workspace', () => {
        expect(html).toContain('<aside class="authority-extension-nav" aria-label="扩展目录">');
        expect(html).toContain('data-role="extension-search"');
        expect(html).toContain('data-role="extension-list"');
        expect(html).toContain('data-role="governance-tabs"');
        expect(governanceWorkbench).toContain('authority-extension-dossier');
        expect(governanceWorkbench).toContain('authority-context-rail authority-extension-inspector');
        expect(governanceWorkbench).toContain('authority-policy-workspace');
        expect(governanceWorkbench).toContain('authority-context-rail authority-policy-inspector');
        expect(css).toContain('grid-template-columns: 226px minmax(0, 1fr)');
        expect(css).toContain('.authority-extension-dossier,');
        expect(css).toContain('.authority-policy-workspace {');
    });

    it('preserves governance actions and policy fields through the visual reorganization', () => {
        expect(components).toContain('data-action="reset-grant"');
        expect(governanceWorkbench).toContain('data-action="reset-all-grants"');
        expect(governanceWorkbench).toContain('data-action="add-policy-row"');
        expect(governanceWorkbench).toContain('data-action="save-policies"');
        expect(governanceWorkbench).toContain('data-policy-default=');
        expect(governanceWorkbench).toContain('data-policy-editor-extension');
        expect(governanceWorkbench).toContain('data-role="policy-rows"');
    });

    it('uses a dedicated system workbench with maintenance, recovery, migration, diagnostics, and backup views', () => {
        expect(source).toContain("const SYSTEM_VIEW_NAMES: readonly SystemView[] = ['runtime', 'recovery', 'migration', 'diagnostics', 'backup']");
        expect(source).toContain('renderSystemWorkbench(this.state)');
        expect(systemWorkbench).toContain("{ id: 'runtime', label: '运行状态'");
        expect(systemWorkbench).toContain("{ id: 'recovery', label: '版本与恢复'");
        expect(systemWorkbench).toContain("{ id: 'migration', label: '数据迁移'");
        expect(systemWorkbench).toContain("{ id: 'diagnostics', label: '诊断'");
        expect(systemWorkbench).toContain("{ id: 'backup', label: '远程备份'");
        expect(systemCss).toContain(".authority-section[data-section='updates'] > [data-role='updates-view']");
        expect(systemCss).toContain('grid-template-columns: 250px minmax(0, 1fr) 290px');
        expect(source).toContain("activeButton?.scrollIntoView({ block: 'nearest', inline: 'nearest' })");
    });

    it('binds recovery to the default whole-ST workspace and protects destructive rollback', () => {
        expect(source).toContain('client.agent.admin.workspaces.default()');
        expect(source).toContain('.agent.admin.workspaces.checkpoint(workspace.id');
        expect(source).toContain('.agent.admin.workspaces.rollback(workspace.id');
        expect(source).toContain('.agent.admin.workspaces.resumeRollback(workspace.id)');
        expect(source).toContain("confirmLabel: '建立保护并恢复'");
        expect(source).toContain("force: hasUnrecordedChanges");
        expect(systemWorkbench).toContain('node runtime/agent.cjs rescue status --workspace');
    });

    it('declares agent.run before the built-in workbench creates runs', () => {
        expect(constants).toContain('declaredPermissions: { agent: { run: true } }');
        expect(source).toContain("AuthoritySDK.init(SECURITY_CENTER_CONFIG)");
    });

    it('keeps Agent composer drafts across redraws and rejects stale session refreshes', () => {
        expect(source).toContain('const draft = this.captureAgentFormDraft(container);');
        expect(source).toContain('this.restoreAgentFormDraft(container, draft);');
        expect(source).toContain('const focus = this.captureAgentFocus(container);');
        expect(source).toContain('this.restoreAgentFocus(container, focus);');
        expect(source).toContain('getAgentStatusAnnouncement(this.state.agent)');
        expect(agentWorkbench).toContain('role="alert"');
        expect(source).toContain('const generation = ++this.agentRefreshGeneration;');
        expect(source).toContain('if (generation !== this.agentRefreshGeneration) return;');
        expect(source).toContain('if (this.state.agent.selectedSession?.session.id !== sessionId) return;');
        expect(source).toContain('agent.sessions.subscribe(sessionId');
    });

    it('connects model testing, failed-run continuation, and lazy file diffs to real Agent APIs', () => {
        expect(source).toContain("case 'agent-test-profile':");
        expect(source).toContain('.agent.admin.profiles.test({ profile: input })');
        expect(source).toContain("case 'agent-continue-failed-run':");
        expect(source).toContain("run?.status !== 'failed'");
        expect(source).toContain('client.agent.sessions.continueFailedRun(sessionId, runId)');
        expect(source).toContain("case 'agent-file-diff':");
        expect(source).toContain("'[data-action=\"system-file-diff\"]'");
        expect(source).toContain('.agent.admin.workspaces.fileDiff(workspaceId');
        expect(source).toContain('workspaceFileDiffKey(workspaceId, from, to, path)');
    });

    it('static CSS disables pointer-events on tab icon descendants', () => {
        expect(css).toContain('.authority-tab__icon,');
        expect(css).toContain('.authority-tab__icon * {');
        expect(css).toContain('pointer-events: none;');
    });

    it('skins scrollbars across Authority surfaces without exposing navigation overflow', () => {
        expect(css).toContain('--authority-scrollbar-thumb:');
        expect(css).toContain('scrollbar-color: var(--authority-scrollbar-thumb) transparent;');
        expect(css).toContain('*::-webkit-scrollbar-thumb {');
        expect(css).toContain('*::-webkit-scrollbar-thumb:hover {');
        expect(css).toContain('*::-webkit-scrollbar-thumb:active {');
        expect(css).toContain('*::-webkit-scrollbar-button {');
        expect(css).toContain('.authority-area-tabs::-webkit-scrollbar {');
    });

    it('removes superseded one-shot Agent and legacy system workspace styles', () => {
        expect(css).not.toContain('.authority-agent-launch-options');
        expect(css).not.toContain('.authority-agent-session-setup');
        expect(css).not.toContain('.authority-agent-profile-item');
        expect(css).not.toContain('.authority-agent-tool-item');
        expect(css).not.toContain('.authority-system-health-grid');
        expect(css).not.toContain('.authority-system-operation-row');
        expect(css).not.toContain('.authority-system-section');
        expect(css).not.toContain('.authority-system-import');
        expect(css).not.toContain('.authority-system-usage-summary');
        expect(systemCss).toContain('.authority-system-usage-summary');
    });

    it('routes destructive actions through the themed impact confirmation flow', () => {
        expect(source).not.toMatch(/\b(?:window\.|globalThis\.)?confirm\s*\(/);
        expect(source.match(/showImpactConfirmation\(/g)?.length).toBeGreaterThanOrEqual(10);
        expect(impactConfirmation).toContain("import { Popup, POPUP_RESULT, POPUP_TYPE } from '/scripts/popup.js'");
        expect(impactConfirmation).toContain("cancelButton: '取消'");
        expect(impactConfirmation).toContain('options.effects');
        expect(impactConfirmation).toContain('value.textContent = options.target');
    });
});

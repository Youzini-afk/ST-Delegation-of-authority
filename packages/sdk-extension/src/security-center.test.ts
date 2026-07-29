import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

describe('Security Center tab interaction', () => {
    const source = fs.readFileSync(path.resolve(__dirname, 'security-center.ts'), 'utf8');
    const constants = fs.readFileSync(path.resolve(__dirname, 'security-center/constants.ts'), 'utf8');
    const impactConfirmation = fs.readFileSync(path.resolve(__dirname, 'security-center/impact-confirmation.ts'), 'utf8');
    const html = fs.readFileSync(path.resolve(__dirname, '../static/security-center.html'), 'utf8');
    const css = fs.readFileSync(path.resolve(__dirname, '../static/style.css'), 'utf8');

    it('declares a primary tab name whitelist matching all valid CenterTab values', () => {
        expect(source).toContain("const PRIMARY_TAB_NAMES: readonly CenterTab[] = ['overview', 'detail', 'databases', 'activity', 'agent', 'policies', 'updates']");
    });

    it('provides a type guard to validate arbitrary tab values against the whitelist', () => {
        expect(source).toContain('function isValidCenterTab(value: string | undefined): value is CenterTab {');
        expect(source).toContain('(PRIMARY_TAB_NAMES as readonly string[]).includes(value)');
    });

    it('maps the seven views into Agent, governance, and system areas', () => {
        expect(source).toContain("type CenterArea = 'agent' | 'governance' | 'system'");
        expect(source).toContain("if (tab === 'agent') return 'agent'");
        expect(source).toContain("if (tab === 'updates') return 'system'");
        expect(source).toContain("return 'governance'");
    });

    it('validates tab values in switchTab against the primary tab whitelist', () => {
        const switchTabStart = source.indexOf('private switchTab(tab: CenterTab): void {');
        expect(switchTabStart).toBeGreaterThanOrEqual(0);
        const switchTabEnd = source.indexOf('private async render(): Promise<void> {', switchTabStart);
        const switchTabBody = source.slice(switchTabStart, switchTabEnd);
        expect(switchTabBody).toContain('PRIMARY_TAB_NAMES.includes(tab)');
        expect(switchTabBody).toContain("tab === 'agent' || tab === 'policies' || tab === 'updates'");
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
        const toggleSectionsEnd = source.indexOf('private loadOverviewSectionState(', toggleSectionsStart);
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

    it('static HTML preserves all seven panels and groups them below three primary areas', () => {
        const areas = Array.from(html.matchAll(/<button[^>]*class="authority-area-tab"[^>]*data-area="([^"]+)"[^>]*>/g));
        const tabs = Array.from(html.matchAll(/<button[^>]*class="authority-tab"[^>]*data-tab="([^"]+)"[^>]*>/g));
        const panels = Array.from(html.matchAll(/<section[^>]*data-section="([^"]+)"[^>]*>/g));
        const areaPanels = Array.from(html.matchAll(/<section[^>]*data-area-panel="([^"]+)"[^>]*>/g));
        const areaNames = areas.map(match => match[1]);
        const tabNames = tabs.map(match => match[1]);
        const panelNames = panels.map(match => match[1]);

        expect(areaNames).toEqual(['agent', 'governance', 'system']);
        expect(tabNames).toEqual(['detail', 'overview', 'databases', 'activity', 'policies']);
        expect(panelNames).toEqual(['agent', 'detail', 'overview', 'databases', 'activity', 'policies', 'updates']);
        expect(areaPanels.map(match => match[1])).toEqual(['agent', 'governance', 'system']);

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
    });

    it('static HTML has role=tablist on the tab container', () => {
        expect(html).toContain('<nav class="authority-tabs" role="tablist"');
    });

    it('keeps the preview direction: compact brand bar, side navigation, and extension-first governance', () => {
        expect(html).toContain('SillyTavern Agent Platform');
        expect(html).toContain('class="authority-app-shell"');
        expect(html).toContain('data-area="governance" data-tab="detail"');
        expect(css).toContain('grid-template-columns: 82px minmax(0, 1fr)');
        expect(css).toContain('width: min(1180px, 92vw) !important');
        expect(css).not.toContain('width: min(1500px, 94vw) !important');
    });

    it('does not rebuild governance overview as a six-card metric wall', () => {
        const overviewStart = source.indexOf('private async renderOverviewSection(): Promise<void> {');
        const overviewEnd = source.indexOf('private async renderDetailSection(): Promise<void> {', overviewStart);
        const overviewBody = source.slice(overviewStart, overviewEnd);
        expect(overviewBody).toContain('authority-governance-glance');
        expect(overviewBody).not.toContain('renderMetricTile(');
    });

    it('declares agent.run before the built-in workbench creates runs', () => {
        expect(constants).toContain('declaredPermissions: { agent: { run: true } }');
        expect(source).toContain("AuthoritySDK.init(SECURITY_CENTER_CONFIG)");
    });

    it('keeps Agent composer drafts across redraws and rejects stale session refreshes', () => {
        expect(source).toContain('const draft = this.captureAgentFormDraft(container);');
        expect(source).toContain('this.restoreAgentFormDraft(container, draft);');
        expect(source).toContain('const generation = ++this.agentRefreshGeneration;');
        expect(source).toContain('if (generation !== this.agentRefreshGeneration) return;');
        expect(source).toContain('if (this.state.agent.selectedSession?.session.id !== sessionId) return;');
        expect(source).toContain('agent.sessions.subscribe(sessionId');
    });

    it('static CSS disables pointer-events on tab icon descendants', () => {
        expect(css).toContain('.authority-tab__icon,');
        expect(css).toContain('.authority-tab__icon * {');
        expect(css).toContain('pointer-events: none;');
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

import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

describe('Security Center host accessibility', () => {
    const source = fs.readFileSync(path.resolve(__dirname, 'host.ts'), 'utf8');

    it('uses the SillyTavern dialog host for popup fallback', () => {
        expect(source).toContain("import { Popup, POPUP_TYPE } from '/scripts/popup.js'");
        expect(source).toContain("new Popup(root, POPUP_TYPE.DISPLAY ?? 4, '', { large: true })");
        expect(source).not.toContain("overlay.className = 'authority-floating-overlay'");
    });

    it('exposes the drawer toggle as one keyboard focus target with state', () => {
        expect(source).toContain('role="button"');
        expect(source).toContain(`aria-controls="\${TOP_BAR_CONTENT_ID}"`);
        expect(source).toContain('aria-expanded="false"');
        expect(source).toContain('aria-hidden="true"');
        expect(source).not.toContain('icon.tabIndex');
    });

    it('keeps drawer visibility and focus synchronized when it closes', () => {
        expect(source).toContain('new MutationObserver(() => {');
        expect(source).toContain("content.classList.contains('openDrawer')");
        expect(source).toContain("toggle?.setAttribute('aria-expanded', String(isOpen))");
        expect(source).toContain("drawer?.setAttribute('aria-hidden', String(!isOpen))");
        expect(source).toContain('drawer?.contains(document.activeElement)');
        expect(source).toContain('toggle?.focus()');
    });
});

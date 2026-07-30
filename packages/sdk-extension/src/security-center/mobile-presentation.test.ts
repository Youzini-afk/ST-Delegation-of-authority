import { describe, expect, it } from 'vitest';
import { getMobileBackSurface, isMobileSurface, MOBILE_SURFACES } from './mobile-presentation.js';

describe('Security Center mobile presentation state', () => {
    it('accepts only the explicit single-surface states', () => {
        for (const surface of MOBILE_SURFACES) expect(isMobileSurface(surface)).toBe(true);
        expect(isMobileSurface('agent-and-inspector')).toBe(false);
        expect(isMobileSurface(undefined)).toBe(false);
    });

    it('returns from the permission inspector to the extension detail before the directory', () => {
        expect(getMobileBackSurface('governance-inspector')).toBe('governance-detail');
        expect(getMobileBackSurface('governance-detail')).toBe('none');
        expect(getMobileBackSurface('agent-sessions')).toBe('none');
        expect(getMobileBackSurface('system-detail')).toBe('none');
    });
});

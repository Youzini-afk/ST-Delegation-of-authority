import type { MobileSurface } from './types.js';

export const MOBILE_SURFACES: readonly MobileSurface[] = [
    'none',
    'agent-sessions',
    'agent-inspector',
    'governance-detail',
    'governance-inspector',
    'system-detail',
    'settings-editor',
];

export function isMobileSurface(value: string | undefined): value is MobileSurface {
    return typeof value === 'string' && (MOBILE_SURFACES as readonly string[]).includes(value);
}

export function getMobileBackSurface(surface: MobileSurface): MobileSurface {
    return surface === 'governance-inspector' ? 'governance-detail' : 'none';
}

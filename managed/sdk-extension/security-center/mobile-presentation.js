export const MOBILE_SURFACES = [
    'none',
    'agent-sessions',
    'agent-inspector',
    'governance-detail',
    'governance-inspector',
    'system-detail',
    'settings-editor',
];
export function isMobileSurface(value) {
    return typeof value === 'string' && MOBILE_SURFACES.includes(value);
}
export function getMobileBackSurface(surface) {
    return surface === 'governance-inspector' ? 'governance-detail' : 'none';
}
//# sourceMappingURL=mobile-presentation.js.map
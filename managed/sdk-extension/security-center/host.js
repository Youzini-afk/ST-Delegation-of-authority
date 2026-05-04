import { renderExtensionTemplateAsync } from '/scripts/extensions.js';
import { AUTHORITY_EXTENSION_NAME } from '../api.js';
import { clearChildren, htmlToElement, waitForElement } from '../dom.js';
import { TOP_BAR_CONTENT_ID, TOP_BAR_DRAWER_ID, TOP_BAR_ICON_ID, } from './constants.js';
let bootPromise = null;
let workspaceRenderToken = 0;
export function bootstrapSecurityCenter(createView) {
    if (!bootPromise) {
        bootPromise = doBootstrapSecurityCenter(createView);
    }
    return bootPromise;
}
export async function openSecurityCenter(createView, options = {}) {
    const openedInDrawer = await openSecurityCenterDrawer(createView, options);
    if (openedInDrawer) {
        return;
    }
    await openSecurityCenterPopup(createView, options);
}
async function openSecurityCenterPopup(createView, options) {
    const html = await renderExtensionTemplateAsync(AUTHORITY_EXTENSION_NAME, 'security-center', {}, false, false);
    const root = htmlToElement(html);
    root.classList.add('authority-panel--popup');
    const overlay = document.createElement('div');
    overlay.className = 'authority-floating-overlay';
    overlay.appendChild(root);
    document.body.appendChild(overlay);
    const view = createView(root, options.focusExtensionId);
    const close = () => {
        document.removeEventListener('keydown', onKeyDown);
        overlay.remove();
    };
    const onKeyDown = (e) => {
        if (e.key === 'Escape')
            close();
    };
    overlay.addEventListener('click', (e) => { if (e.target === overlay)
        close(); });
    document.addEventListener('keydown', onKeyDown);
    await view.initialize();
}
async function doBootstrapSecurityCenter(createView) {
    try {
        await waitForElement('#top-settings-holder');
        mountSecurityCenterTopBarButton(createView);
    }
    catch (error) {
        console.warn('扩展权限中心顶部入口挂载失败：', error);
    }
}
async function openSecurityCenterDrawer(createView, options) {
    mountSecurityCenterTopBarButton(createView);
    const content = ensureSecurityCenterDrawerContent();
    if (!(content instanceof HTMLElement)) {
        return false;
    }
    if (content.childElementCount > 0 && !options.focusExtensionId) {
        openSecurityCenterDrawerPanel();
        return true;
    }
    const renderToken = ++workspaceRenderToken;
    const html = await renderExtensionTemplateAsync(AUTHORITY_EXTENSION_NAME, 'security-center', {}, false, false);
    if (renderToken !== workspaceRenderToken) {
        return true;
    }
    const root = htmlToElement(html);
    root.classList.add('authority-panel--drawer');
    clearChildren(content);
    content.appendChild(root);
    openSecurityCenterDrawerPanel();
    const view = createView(root, options.focusExtensionId);
    await view.initialize();
    return true;
}
function ensureSecurityCenterDrawerContent() {
    const drawer = document.getElementById(TOP_BAR_CONTENT_ID);
    if (!(drawer instanceof HTMLElement)) {
        return null;
    }
    return drawer.querySelector('[data-role="security-center-content"]');
}
function mountSecurityCenterTopBarButton(createView) {
    const holder = document.querySelector('#top-settings-holder');
    if (!holder) {
        return;
    }
    if (holder.querySelector(`#${TOP_BAR_DRAWER_ID}`)) {
        return;
    }
    const drawer = htmlToElement(`
        <div id="${TOP_BAR_DRAWER_ID}" class="drawer authority-top-drawer">
            <div class="drawer-toggle drawer-header authority-top-drawer__toggle">
                <div id="${TOP_BAR_ICON_ID}" class="drawer-icon fa-solid fa-shield-halved fa-fw closedIcon" title="扩展权限中心" data-i18n="[title]扩展权限中心"></div>
            </div>
            <div id="${TOP_BAR_CONTENT_ID}" class="drawer-content closedDrawer authority-drawer-content">
                <div class="authority-drawer-content__body" data-role="security-center-content"></div>
            </div>
        </div>
    `);
    const toggle = drawer.querySelector('.authority-top-drawer__toggle');
    const icon = drawer.querySelector(`#${TOP_BAR_ICON_ID}`);
    if (toggle) {
        toggle.tabIndex = 0;
        const stopPointerPropagation = (event) => {
            event.stopPropagation();
        };
        toggle.addEventListener('mousedown', stopPointerPropagation);
        toggle.addEventListener('touchstart', stopPointerPropagation, { passive: true });
        toggle.addEventListener('click', event => {
            event.preventDefault();
            event.stopPropagation();
            if (isSecurityCenterDrawerOpen()) {
                closeSecurityCenterDrawer();
                return;
            }
            void openSecurityCenter(createView);
        });
        toggle.addEventListener('keydown', event => {
            if (!(event instanceof KeyboardEvent)) {
                return;
            }
            if (event.key !== 'Enter' && event.key !== ' ') {
                return;
            }
            event.preventDefault();
            if (isSecurityCenterDrawerOpen()) {
                closeSecurityCenterDrawer();
                return;
            }
            void openSecurityCenter(createView);
        });
    }
    if (icon) {
        icon.tabIndex = 0;
    }
    const anchor = holder.querySelector('#extensions-settings-button') ?? holder.querySelector('#WI-SP-button');
    if (anchor) {
        holder.insertBefore(drawer, anchor);
        return;
    }
    holder.appendChild(drawer);
}
function isSecurityCenterDrawerOpen() {
    const drawer = document.getElementById(TOP_BAR_CONTENT_ID);
    return drawer instanceof HTMLElement && drawer.classList.contains('openDrawer');
}
function openSecurityCenterDrawerPanel() {
    closeNonPinnedDrawers();
    const drawer = document.getElementById(TOP_BAR_CONTENT_ID);
    if (drawer instanceof HTMLElement) {
        drawer.classList.remove('closedDrawer');
        drawer.classList.add('openDrawer');
    }
    setSecurityCenterIconOpenState(true);
}
function closeSecurityCenterDrawer() {
    workspaceRenderToken += 1;
    const drawer = document.getElementById(TOP_BAR_CONTENT_ID);
    if (drawer instanceof HTMLElement) {
        drawer.classList.remove('openDrawer');
        drawer.classList.add('closedDrawer');
    }
    setSecurityCenterIconOpenState(false);
}
function closeNonPinnedDrawers() {
    const openIcons = Array.from(document.querySelectorAll('.openIcon:not(.drawerPinnedOpen)'));
    for (const icon of openIcons) {
        if (icon.id === TOP_BAR_ICON_ID) {
            continue;
        }
        icon.classList.remove('openIcon');
        icon.classList.add('closedIcon');
    }
    const openDrawers = Array.from(document.querySelectorAll('.openDrawer:not(.pinnedOpen)'));
    for (const drawer of openDrawers) {
        if (drawer.id === TOP_BAR_CONTENT_ID) {
            continue;
        }
        drawer.classList.remove('openDrawer');
        drawer.classList.add('closedDrawer');
    }
}
function setSecurityCenterIconOpenState(isOpen) {
    const icon = document.getElementById(TOP_BAR_ICON_ID);
    if (!(icon instanceof HTMLElement)) {
        return;
    }
    icon.classList.toggle('openIcon', isOpen);
    icon.classList.toggle('closedIcon', !isOpen);
}
//# sourceMappingURL=host.js.map
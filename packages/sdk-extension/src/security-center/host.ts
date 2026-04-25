import { Popup, POPUP_TYPE } from '/scripts/popup.js';
import { renderExtensionTemplateAsync } from '/scripts/extensions.js';
import { AUTHORITY_EXTENSION_NAME } from '../api.js';
import { clearChildren, htmlToElement, waitForElement } from '../dom.js';
import {
    TOP_BAR_CONTENT_ID,
    TOP_BAR_DRAWER_ID,
    TOP_BAR_ICON_ID,
} from './constants.js';
import type { SecurityCenterOpenOptions } from './types.js';

const POPUP_TEXT_TYPE = POPUP_TYPE.TEXT ?? 0;

export interface SecurityCenterViewInstance {
    initialize(): Promise<void>;
}

export type SecurityCenterViewFactory = (root: HTMLElement, focusExtensionId?: string) => SecurityCenterViewInstance;

let bootPromise: Promise<void> | null = null;
let workspaceRenderToken = 0;

export function bootstrapSecurityCenter(createView: SecurityCenterViewFactory): Promise<void> {
    if (!bootPromise) {
        bootPromise = doBootstrapSecurityCenter(createView);
    }
    return bootPromise;
}

export async function openSecurityCenter(createView: SecurityCenterViewFactory, options: SecurityCenterOpenOptions = {}): Promise<void> {
    const openedInDrawer = await openSecurityCenterDrawer(createView, options);
    if (openedInDrawer) {
        return;
    }

    await openSecurityCenterPopup(createView, options);
}

async function openSecurityCenterPopup(createView: SecurityCenterViewFactory, options: SecurityCenterOpenOptions): Promise<void> {
    const html = await renderExtensionTemplateAsync(AUTHORITY_EXTENSION_NAME, 'security-center', {}, false, false);
    const root = htmlToElement(html);
    root.classList.add('authority-panel--popup');
    const view = createView(root, options.focusExtensionId);

    const popup = new Popup(root, POPUP_TEXT_TYPE, '', {
        okButton: '关闭',
        wide: true,
        large: true,
        allowVerticalScrolling: true,
        onOpen: () => view.initialize(),
    });

    await popup.show();
}

async function doBootstrapSecurityCenter(createView: SecurityCenterViewFactory): Promise<void> {
    try {
        const menu = await waitForElement('#extensionsMenu');
        if (!menu.querySelector('#authority-security-center-button')) {
            const html = await renderExtensionTemplateAsync(AUTHORITY_EXTENSION_NAME, 'menu-button', {}, false, false);
            const button = htmlToElement(html);
            button.addEventListener('click', () => void openSecurityCenter(createView));
            menu.appendChild(button);
        }
    } catch (error) {
        console.warn('扩展权限中心菜单入口挂载失败：', error);
    }

    try {
        await waitForElement('#top-settings-holder');
        mountSecurityCenterTopBarButton(createView);
    } catch (error) {
        console.warn('扩展权限中心顶部入口挂载失败：', error);
    }
}

async function openSecurityCenterDrawer(createView: SecurityCenterViewFactory, options: SecurityCenterOpenOptions): Promise<boolean> {
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

function ensureSecurityCenterDrawerContent(): HTMLElement | null {
    const drawer = document.getElementById(TOP_BAR_CONTENT_ID);
    if (!(drawer instanceof HTMLElement)) {
        return null;
    }

    return drawer.querySelector<HTMLElement>('[data-role="security-center-content"]');
}

function mountSecurityCenterTopBarButton(createView: SecurityCenterViewFactory): void {
    const holder = document.querySelector<HTMLElement>('#top-settings-holder');
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

    const toggle = drawer.querySelector<HTMLElement>('.authority-top-drawer__toggle');
    const icon = drawer.querySelector<HTMLElement>(`#${TOP_BAR_ICON_ID}`);
    if (toggle) {
        toggle.tabIndex = 0;
        const stopPointerPropagation = (event: Event) => {
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

function isSecurityCenterDrawerOpen(): boolean {
    const drawer = document.getElementById(TOP_BAR_CONTENT_ID);
    return drawer instanceof HTMLElement && drawer.classList.contains('openDrawer');
}

function openSecurityCenterDrawerPanel(): void {
    closeNonPinnedDrawers();

    const drawer = document.getElementById(TOP_BAR_CONTENT_ID);
    if (drawer instanceof HTMLElement) {
        drawer.classList.remove('closedDrawer');
        drawer.classList.add('openDrawer');
    }

    setSecurityCenterIconOpenState(true);
}

function closeSecurityCenterDrawer(): void {
    workspaceRenderToken += 1;

    const drawer = document.getElementById(TOP_BAR_CONTENT_ID);
    if (drawer instanceof HTMLElement) {
        drawer.classList.remove('openDrawer');
        drawer.classList.add('closedDrawer');
    }

    setSecurityCenterIconOpenState(false);
}

function closeNonPinnedDrawers(): void {
    const openIcons = Array.from(document.querySelectorAll<HTMLElement>('.openIcon:not(.drawerPinnedOpen)'));
    for (const icon of openIcons) {
        if (icon.id === TOP_BAR_ICON_ID) {
            continue;
        }

        icon.classList.remove('openIcon');
        icon.classList.add('closedIcon');
    }

    const openDrawers = Array.from(document.querySelectorAll<HTMLElement>('.openDrawer:not(.pinnedOpen)'));
    for (const drawer of openDrawers) {
        if (drawer.id === TOP_BAR_CONTENT_ID) {
            continue;
        }

        drawer.classList.remove('openDrawer');
        drawer.classList.add('closedDrawer');
    }
}

function setSecurityCenterIconOpenState(isOpen: boolean): void {
    const icon = document.getElementById(TOP_BAR_ICON_ID);
    if (!(icon instanceof HTMLElement)) {
        return;
    }

    icon.classList.toggle('openIcon', isOpen);
    icon.classList.toggle('closedIcon', !isOpen);
}

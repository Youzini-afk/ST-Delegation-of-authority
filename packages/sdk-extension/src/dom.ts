export function htmlToElement(html: string): HTMLElement {
    const template = document.createElement('template');
    template.innerHTML = html.trim();
    const element = template.content.firstElementChild;

    if (!(element instanceof HTMLElement)) {
        throw new Error('Expected template to contain an HTMLElement root');
    }

    return element;
}

export async function waitForElement(selector: string, timeoutMs = 15000): Promise<HTMLElement> {
    const startedAt = Date.now();

    while (Date.now() - startedAt < timeoutMs) {
        const element = document.querySelector(selector);
        if (element instanceof HTMLElement) {
            return element;
        }

        await new Promise(resolve => window.setTimeout(resolve, 100));
    }

    throw new Error(`Timed out waiting for element: ${selector}`);
}

export function clearChildren(element: HTMLElement): void {
    while (element.firstChild) {
        element.removeChild(element.firstChild);
    }
}

export function formatDate(value?: string): string {
    if (!value) {
        return 'N/A';
    }

    const date = new Date(value);
    if (Number.isNaN(date.getTime())) {
        return value;
    }

    return `${date.toLocaleDateString()} ${date.toLocaleTimeString()}`;
}

export function escapeHtml(value: unknown): string {
    const text = String(value ?? '');
    return text
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
}

export function formatJson(value: unknown): string {
    return JSON.stringify(value, null, 2);
}

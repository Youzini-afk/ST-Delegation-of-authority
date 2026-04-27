import { renderExtensionTemplateAsync } from '/scripts/extensions.js';
import { Popup, POPUP_TYPE } from '/scripts/popup.js';
import { AUTHORITY_VERSION } from './version.js';

const EXTENSION_NAME = 'third-party/st-authority-example';
const DISPLAY_NAME = 'Authority Example';
const VERSION = AUTHORITY_VERSION;
const DEFAULT_HTTP_URL = 'https://jsonplaceholder.typicode.com/todos/1';
const POPUP_TEXT_TYPE = POPUP_TYPE.TEXT ?? 0;

interface AuthoritySdkLike {
    init(config: {
        extensionId: string;
        displayName: string;
        version: string;
        installType: 'local';
        uiLabel: string;
        declaredPermissions: Record<string, unknown>;
    }): Promise<any>;
}

let authorityClient: any = null;

void bootstrap();

async function bootstrap(): Promise<void> {
    const sdk = window.STAuthority?.AuthoritySDK as AuthoritySdkLike | undefined;
    if (!sdk) {
        throw new Error('Authority SDK extension is not loaded');
    }

    authorityClient = await sdk.init({
        extensionId: EXTENSION_NAME,
        displayName: DISPLAY_NAME,
        version: VERSION,
        installType: 'local',
        uiLabel: 'Authority Example',
        declaredPermissions: {
            storage: {
                kv: true,
                blob: true,
            },
            http: {
                allow: ['jsonplaceholder.typicode.com'],
            },
            jobs: {
                background: ['delay'],
            },
            events: {
                channels: [`extension:${EXTENSION_NAME}`],
            },
        },
    });

    const menu = document.querySelector<HTMLElement>('#extensionsMenu');
    if (!menu || menu.querySelector('#authority-example-button')) {
        return;
    }

    const html = await renderExtensionTemplateAsync(EXTENSION_NAME, 'menu-button', {}, false, false);
    const template = document.createElement('template');
    template.innerHTML = html.trim();
    const button = template.content.firstElementChild;
    if (!(button instanceof HTMLElement)) {
        throw new Error('Failed to render Authority Example menu button');
    }

    button.addEventListener('click', () => {
        void openDemoPanel();
    });

    menu.appendChild(button);
}

async function openDemoPanel(): Promise<void> {
    if (!authorityClient) {
        throw new Error('Authority client is not ready');
    }

    const html = await renderExtensionTemplateAsync(EXTENSION_NAME, 'demo-panel', {}, false, false);
    const template = document.createElement('template');
    template.innerHTML = html.trim();
    const root = template.content.firstElementChild;
    if (!(root instanceof HTMLElement)) {
        throw new Error('Failed to render Authority Example panel');
    }

    const view = new ExampleDemoView(root, authorityClient);
    const popup = new Popup(root, POPUP_TEXT_TYPE, '', {
        okButton: '关闭',
        wide: true,
        large: true,
        allowVerticalScrolling: true,
        onOpen: () => view.initialize(),
        onClose: () => view.dispose(),
    });

    await popup.show();
}

class ExampleDemoView {
    private subscription: { close(): void } | null = null;
    private lastJobId = '';

    constructor(
        private readonly root: HTMLElement,
        private readonly authority: any,
    ) {}

    async initialize(): Promise<void> {
        this.bindEvents();
        await this.refreshSession();
        this.setValue('http-url', DEFAULT_HTTP_URL);
        this.setValue('blob-name', 'hello.txt');
        this.setValue('blob-content', 'Authority Blob demo content');
        this.setValue('kv-key', 'demo-key');
        this.setValue('kv-value', '{"hello":"world"}');
        this.setValue('job-duration', '3000');
        this.setValue('job-message', 'Authority delay job finished');
        this.log('示例扩展已初始化。');
    }

    dispose(): void {
        this.subscription?.close();
        this.subscription = null;
    }

    private bindEvents(): void {
        this.root.addEventListener('click', event => {
            const target = event.target instanceof HTMLElement ? event.target.closest<HTMLElement>('[data-action]') : null;
            if (!target) {
                return;
            }

            const action = target.dataset.action ?? '';
            void this.runAction(action);
        });
    }

    private async runAction(action: string): Promise<void> {
        try {
            switch (action) {
                case 'refresh-session':
                    await this.refreshSession(true);
                    break;
                case 'open-security-center':
                    await this.authority.openSecurityCenter();
                    break;
                case 'kv-set':
                    await this.kvSet();
                    break;
                case 'kv-get':
                    await this.kvGet();
                    break;
                case 'kv-delete':
                    await this.kvDelete();
                    break;
                case 'kv-list':
                    await this.kvList();
                    break;
                case 'blob-put':
                    await this.blobPut();
                    break;
                case 'blob-get':
                    await this.blobGet();
                    break;
                case 'blob-delete':
                    await this.blobDelete();
                    break;
                case 'blob-list':
                    await this.blobList();
                    break;
                case 'http-fetch':
                    await this.httpFetch();
                    break;
                case 'job-create':
                    await this.jobCreate();
                    break;
                case 'job-get':
                    await this.jobGet();
                    break;
                case 'job-list':
                    await this.jobList();
                    break;
                case 'job-cancel':
                    await this.jobCancel();
                    break;
                case 'events-connect':
                    await this.eventsConnect();
                    break;
                case 'events-disconnect':
                    this.eventsDisconnect();
                    break;
                default:
                    this.log(`未处理的动作: ${action}`);
            }
        } catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            this.log(`操作失败: ${message}`, { action });
            toastr.error(message, 'Authority Example');
        }
    }

    private async refreshSession(force = false): Promise<void> {
        await this.authority.init(force);
        this.renderSession();
    }

    private async kvSet(): Promise<void> {
        const key = this.getValue('kv-key');
        const value = safeJsonParse(this.getValue('kv-value'));
        await this.authority.storage.kv.set(key, value);
        this.log(`KV 已写入: ${key}`, value);
        await this.kvList();
    }

    private async kvGet(): Promise<void> {
        const key = this.getValue('kv-key');
        const value = await this.authority.storage.kv.get(key);
        this.renderResult({ action: 'kv.get', key, value });
        this.log(`KV 已读取: ${key}`, value);
    }

    private async kvDelete(): Promise<void> {
        const key = this.getValue('kv-key');
        await this.authority.storage.kv.delete(key);
        this.log(`KV 已删除: ${key}`);
        await this.kvList();
    }

    private async kvList(): Promise<void> {
        const entries = await this.authority.storage.kv.list();
        this.renderResult({ action: 'kv.list', entries });
    }

    private async blobPut(): Promise<void> {
        const record = await this.authority.storage.blob.put({
            name: this.getValue('blob-name'),
            content: this.getValue('blob-content'),
            encoding: 'utf8',
            contentType: 'text/plain;charset=utf-8',
        });
        this.log(`Blob 已写入: ${record.id}`, record);
        this.renderResult({ action: 'blob.put', record });
    }

    private async blobGet(): Promise<void> {
        const id = this.getValue('blob-name').replace(/[^a-zA-Z0-9._-]/g, '_');
        const blob = await this.authority.storage.blob.get(id);
        this.renderResult({
            action: 'blob.get',
            record: blob.record,
            decodedText: decodeBase64Utf8(blob.content),
        });
    }

    private async blobDelete(): Promise<void> {
        const id = this.getValue('blob-name').replace(/[^a-zA-Z0-9._-]/g, '_');
        await this.authority.storage.blob.delete(id);
        this.log(`Blob 已删除: ${id}`);
        await this.blobList();
    }

    private async blobList(): Promise<void> {
        const entries = await this.authority.storage.blob.list();
        this.renderResult({ action: 'blob.list', entries });
    }

    private async httpFetch(): Promise<void> {
        const result = await this.authority.http.fetch({
            url: this.getValue('http-url'),
            method: 'GET',
        });
        this.renderResult({ action: 'http.fetch', result });
    }

    private async jobCreate(): Promise<void> {
        const durationMs = Number(this.getValue('job-duration')) || 3000;
        const message = this.getValue('job-message');
        const job = await this.authority.jobs.create('delay', { durationMs, message });
        this.lastJobId = job.id;
        this.setValue('job-id', job.id);
        this.renderResult({ action: 'job.create', job });
        this.log(`任务已创建: ${job.id}`, job);
    }

    private async jobGet(): Promise<void> {
        const job = await this.authority.jobs.get(this.getJobId());
        this.renderResult({ action: 'job.get', job });
    }

    private async jobList(): Promise<void> {
        const jobs = await this.authority.jobs.list();
        this.renderResult({ action: 'job.list', jobs });
    }

    private async jobCancel(): Promise<void> {
        const job = await this.authority.jobs.cancel(this.getJobId());
        this.renderResult({ action: 'job.cancel', job });
    }

    private async eventsConnect(): Promise<void> {
        if (this.subscription) {
            this.log('事件流已经连接。');
            return;
        }

        this.subscription = await this.authority.events.subscribe({
            channel: `extension:${EXTENSION_NAME}`,
            onEvent: (event: { name: string; data: unknown }) => {
                this.log(`SSE 事件: ${event.name}`, event.data);
                if (event.name === 'authority.job') {
                    this.renderResult({ action: 'event.job', event: event.data });
                }
            },
        });

        this.log('事件流已连接。');
    }

    private eventsDisconnect(): void {
        this.subscription?.close();
        this.subscription = null;
        this.log('事件流已断开。');
    }

    private renderSession(): void {
        this.setOutput('session', {
            session: this.authority.getSession(),
            capabilities: this.authority.getCapabilities(),
        });
    }

    private renderResult(value: unknown): void {
        this.setOutput('result', value);
    }

    private setOutput(name: string, value: unknown): void {
        const target = this.root.querySelector<HTMLElement>(`[data-output="${name}"]`);
        if (target) {
            target.textContent = JSON.stringify(value, null, 2);
        }
    }

    private log(message: string, details?: unknown): void {
        const target = this.root.querySelector<HTMLElement>('[data-output="log"]');
        if (!target) {
            return;
        }

        const timestamp = new Date().toLocaleTimeString();
        const nextLine = details === undefined
            ? `[${timestamp}] ${message}`
            : `[${timestamp}] ${message}\n${JSON.stringify(details, null, 2)}`;
        const existing = target.textContent?.trim() ?? '';
        const merged = [nextLine, existing].filter(Boolean).slice(0, 30).join('\n\n');
        target.textContent = merged;
    }

    private getValue(name: string): string {
        const input = this.root.querySelector<HTMLInputElement | HTMLTextAreaElement>(`[data-field="${name}"]`);
        return input?.value?.trim() ?? '';
    }

    private setValue(name: string, value: string): void {
        const input = this.root.querySelector<HTMLInputElement | HTMLTextAreaElement>(`[data-field="${name}"]`);
        if (input) {
            input.value = value;
        }
    }

    private getJobId(): string {
        return this.getValue('job-id') || this.lastJobId;
    }
}

function safeJsonParse(value: string): unknown {
    try {
        return JSON.parse(value);
    } catch {
        return value;
    }
}

function decodeBase64Utf8(value: string): string {
    try {
        const binary = atob(value);
        const bytes = Uint8Array.from(binary, char => char.charCodeAt(0));
        return new TextDecoder().decode(bytes);
    } catch {
        return value;
    }
}

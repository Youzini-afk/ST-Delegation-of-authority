import { authorityRequest, buildEventStreamUrl, hostnameFromUrl, isInvalidSessionError } from './api.js';
import { showPermissionPrompt } from './permission-prompt.js';
import { openSecurityCenter } from './security-center.js';
export class AuthorityClient {
    config;
    storage;
    sql;
    http;
    jobs;
    events;
    session = null;
    sessionPromise = null;
    runtimeGrants = new Map();
    constructor(config) {
        this.config = config;
        this.storage = {
            kv: {
                get: async (key) => {
                    await this.ensurePermission({ resource: 'storage.kv', reason: `读取键 ${key}` });
                    const response = await this.requestWithSession('/storage/kv/get', {
                        method: 'POST',
                        body: { key },
                    });
                    return response.value;
                },
                set: async (key, value) => {
                    await this.ensurePermission({ resource: 'storage.kv', reason: `写入键 ${key}` });
                    await this.requestWithSession('/storage/kv/set', {
                        method: 'POST',
                        body: { key, value },
                    });
                },
                delete: async (key) => {
                    await this.ensurePermission({ resource: 'storage.kv', reason: `删除键 ${key}` });
                    await this.requestWithSession('/storage/kv/delete', {
                        method: 'POST',
                        body: { key },
                    });
                },
                list: async () => {
                    await this.ensurePermission({ resource: 'storage.kv', reason: '列出 KV 存储' });
                    const response = await this.requestWithSession('/storage/kv/list', {
                        method: 'POST',
                    });
                    return response.entries;
                },
            },
            blob: {
                put: async (input) => {
                    await this.ensurePermission({ resource: 'storage.blob', reason: `写入 Blob ${input.name}` });
                    return await this.requestWithSession('/storage/blob/put', {
                        method: 'POST',
                        body: input,
                    });
                },
                get: async (id) => {
                    await this.ensurePermission({ resource: 'storage.blob', reason: `读取 Blob ${id}` });
                    return await this.requestWithSession('/storage/blob/get', {
                        method: 'POST',
                        body: { id },
                    });
                },
                delete: async (id) => {
                    await this.ensurePermission({ resource: 'storage.blob', reason: `删除 Blob ${id}` });
                    await this.requestWithSession('/storage/blob/delete', {
                        method: 'POST',
                        body: { id },
                    });
                },
                list: async () => {
                    await this.ensurePermission({ resource: 'storage.blob', reason: '列出 Blob 存储' });
                    const response = await this.requestWithSession('/storage/blob/list', {
                        method: 'POST',
                    });
                    return response.entries;
                },
            },
        };
        this.sql = {
            query: async (input) => {
                const database = getSqlDatabaseName(input.database);
                await this.ensurePermission({
                    resource: 'sql.private',
                    target: database,
                    reason: `查询 SQL 数据库 ${database}`,
                });
                return await this.requestWithSession('/sql/query', {
                    method: 'POST',
                    body: {
                        ...input,
                        database,
                    },
                });
            },
            exec: async (input) => {
                const database = getSqlDatabaseName(input.database);
                await this.ensurePermission({
                    resource: 'sql.private',
                    target: database,
                    reason: `执行 SQL 数据库 ${database}`,
                });
                return await this.requestWithSession('/sql/exec', {
                    method: 'POST',
                    body: {
                        ...input,
                        database,
                    },
                });
            },
            batch: async (input) => {
                const database = getSqlDatabaseName(input.database);
                await this.ensurePermission({
                    resource: 'sql.private',
                    target: database,
                    reason: `批量执行 SQL 数据库 ${database}`,
                });
                return await this.requestWithSession('/sql/batch', {
                    method: 'POST',
                    body: {
                        ...input,
                        database,
                    },
                });
            },
        };
        this.http = {
            fetch: async (input) => {
                const hostname = hostnameFromUrl(input.url);
                await this.ensurePermission({
                    resource: 'http.fetch',
                    target: hostname,
                    reason: `访问主机 ${hostname}`,
                });
                return await this.requestWithSession('/http/fetch', {
                    method: 'POST',
                    body: input,
                });
            },
        };
        this.jobs = {
            create: async (type, payload = {}) => {
                await this.ensurePermission({
                    resource: 'jobs.background',
                    target: type,
                    reason: `创建后台任务 ${type}`,
                });
                return await this.requestWithSession('/jobs/create', {
                    method: 'POST',
                    body: { type, payload },
                });
            },
            get: async (id) => {
                return await this.requestWithSession(`/jobs/${encodeURIComponent(id)}`);
            },
            list: async () => {
                return await this.requestWithSession('/jobs');
            },
            cancel: async (id) => {
                return await this.requestWithSession(`/jobs/${encodeURIComponent(id)}/cancel`, {
                    method: 'POST',
                });
            },
        };
        this.events = {
            subscribe: async (channelOrOptions, handler) => {
                const options = typeof channelOrOptions === 'string'
                    ? {
                        channel: channelOrOptions,
                        onEvent: handler,
                    }
                    : {
                        channel: channelOrOptions?.channel,
                        eventNames: channelOrOptions?.eventNames,
                        onEvent: channelOrOptions?.onEvent ?? handler,
                    };
                const session = await this.ensureInitialized();
                const channel = options.channel ?? `extension:${this.config.extensionId}`;
                const eventNames = options.eventNames ?? ['authority.connected', 'authority.job'];
                await this.ensurePermission({
                    resource: 'events.stream',
                    target: channel,
                    reason: `订阅事件流 ${channel}`,
                });
                const source = new EventSource(buildEventStreamUrl(session.sessionToken, channel), {
                    withCredentials: true,
                });
                const notify = (name, data) => {
                    options.onEvent?.({ name, data });
                };
                for (const name of eventNames) {
                    source.addEventListener(name, event => {
                        const payload = event instanceof MessageEvent ? safeParse(event.data) : undefined;
                        notify(name, payload);
                    });
                }
                source.onmessage = event => {
                    notify('message', safeParse(event.data));
                };
                source.onerror = () => {
                    console.warn('Authority event stream disconnected for', this.config.extensionId, channel);
                };
                return {
                    close: () => source.close(),
                };
            },
        };
    }
    async init(force = false) {
        if (force) {
            this.session = null;
            this.sessionPromise = null;
        }
        return await this.ensureInitialized();
    }
    setConfig(config) {
        this.config = cloneInitConfig(config);
    }
    getSession() {
        if (!this.session) {
            return null;
        }
        return {
            ...this.session,
            grants: this.buildGrantSnapshot(),
            policies: [...this.session.policies],
        };
    }
    getCapabilities() {
        const session = this.getSession();
        if (!session) {
            return null;
        }
        return {
            declaredPermissions: this.config.declaredPermissions,
            features: session.features,
            grants: groupByResource(session.grants),
            policies: groupByResource(session.policies),
        };
    }
    async ensurePermission(request) {
        const evaluation = await this.evaluatePermission(request);
        const resolved = evaluation.decision === 'prompt'
            ? await this.requestPermission(request, evaluation)
            : evaluation;
        if (resolved.decision !== 'granted') {
            const message = getPermissionFailureMessage(this.config.displayName, resolved.resource, resolved.target, resolved.decision);
            toastr.warning(message, 'Authority');
            if (resolved.decision === 'denied' || resolved.decision === 'blocked') {
                void openSecurityCenter({ focusExtensionId: this.config.extensionId });
            }
            throw new Error(message);
        }
        return resolved;
    }
    async requestPermission(request, evaluation) {
        const current = evaluation ?? await this.evaluatePermission(request);
        if (current.decision === 'granted') {
            return current;
        }
        if (current.decision === 'denied' || current.decision === 'blocked') {
            return current;
        }
        const promptContext = {
            extensionDisplayName: this.config.displayName,
            extensionId: this.config.extensionId,
            resource: current.resource,
            target: current.target,
            riskLevel: current.riskLevel,
        };
        if (request.reason) {
            promptContext.reason = request.reason;
        }
        const choice = await showPermissionPrompt(promptContext);
        if (!choice) {
            return current;
        }
        const grant = await this.requestWithSession('/permissions/resolve', {
            method: 'POST',
            body: {
                ...request,
                choice,
            },
        });
        this.mergeGrant(grant);
        return {
            decision: grant.status,
            key: grant.key,
            riskLevel: grant.riskLevel,
            target: grant.target,
            resource: grant.resource,
            grant,
        };
    }
    async openSecurityCenter() {
        await openSecurityCenter({ focusExtensionId: this.config.extensionId });
    }
    async evaluatePermission(request) {
        return await this.requestWithSession('/permissions/evaluate', {
            method: 'POST',
            body: request,
        });
    }
    async ensureInitialized() {
        if (this.session) {
            return this.session;
        }
        if (!this.sessionPromise) {
            this.sessionPromise = authorityRequest('/session/init', {
                method: 'POST',
                body: cloneInitConfig(this.config),
            }).then(session => {
                this.session = {
                    ...session,
                    grants: [...session.grants],
                    policies: [...session.policies],
                };
                return session;
            }).finally(() => {
                this.sessionPromise = null;
            });
        }
        return await this.sessionPromise;
    }
    async requestWithSession(path, options = {}, retried = false) {
        const session = await this.ensureInitialized();
        try {
            const requestOptions = {
                body: options.body,
                sessionToken: session.sessionToken,
            };
            if (options.method) {
                return await authorityRequest(path, {
                    ...requestOptions,
                    method: options.method,
                });
            }
            return await authorityRequest(path, requestOptions);
        }
        catch (error) {
            if (!retried && isInvalidSessionError(error)) {
                await this.init(true);
                return await this.requestWithSession(path, options, true);
            }
            throw error;
        }
    }
    mergeGrant(grant) {
        this.runtimeGrants.set(grant.key, grant);
        if (!this.session) {
            return;
        }
        if (grant.scope === 'persistent') {
            this.session = {
                ...this.session,
                grants: [
                    ...this.session.grants.filter(item => item.key !== grant.key),
                    grant,
                ],
            };
        }
    }
    buildGrantSnapshot() {
        if (!this.session) {
            return [];
        }
        const grants = new Map();
        for (const grant of this.session.grants) {
            grants.set(grant.key, grant);
        }
        for (const grant of this.runtimeGrants.values()) {
            grants.set(grant.key, grant);
        }
        return [...grants.values()].sort((left, right) => left.key.localeCompare(right.key));
    }
}
function cloneInitConfig(config) {
    const clone = {
        extensionId: config.extensionId,
        displayName: config.displayName,
        version: config.version,
        installType: config.installType,
        declaredPermissions: JSON.parse(JSON.stringify(config.declaredPermissions ?? {})),
    };
    if (config.uiLabel) {
        clone.uiLabel = config.uiLabel;
    }
    return clone;
}
function groupByResource(items) {
    const result = {
        'storage.kv': [],
        'storage.blob': [],
        'sql.private': [],
        'http.fetch': [],
        'jobs.background': [],
        'events.stream': [],
    };
    for (const item of items) {
        result[item.resource].push(item);
    }
    return result;
}
function safeParse(value) {
    try {
        return JSON.parse(value);
    }
    catch {
        return value;
    }
}
function getPermissionFailureMessage(displayName, resource, target, decision) {
    const resourceLabel = target && target !== '*' ? `${resource} (${target})` : resource;
    if (decision === 'denied') {
        return `${displayName} 对 ${resourceLabel} 的请求已被拒绝，请在安全中心手动重置。`;
    }
    if (decision === 'blocked') {
        return `${displayName} 对 ${resourceLabel} 的请求被管理员策略封锁。`;
    }
    return `${displayName} 没有获得 ${resourceLabel} 的访问授权。`;
}
function getSqlDatabaseName(value) {
    return typeof value === 'string' && value.trim() ? value.trim() : 'default';
}
//# sourceMappingURL=client.js.map
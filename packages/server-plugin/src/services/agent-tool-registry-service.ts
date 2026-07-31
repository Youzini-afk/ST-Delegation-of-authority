import crypto from 'node:crypto';
import type {
    AgentBrowserToolRegistrationRequest,
    AgentBrowserToolRegistrationResponse,
    AgentToolDescriptor,
    ModuleTransactionManifest,
} from '@stdo/shared-types';
import type { ModuleHostService } from './module-host-service.js';

const DEFAULT_BROWSER_LEASE_MS = 60_000;
const BROWSER_TOOL_ID_PATTERN = /^[a-zA-Z][a-zA-Z0-9._-]*$/;

interface BrowserToolRegistration {
    userHandle: string;
    extensionId: string;
    browserInstanceId: string;
    registrationId: string;
    leaseExpiresAt: string;
    tools: AgentToolDescriptor[];
}

export class AgentToolRegistryService {
    private readonly browserRegistrations = new Map<string, BrowserToolRegistration>();

    constructor(
        private readonly hostTools: { list(): AgentToolDescriptor[] },
        private readonly moduleHost?: ModuleHostService,
        private readonly now: () => number = () => Date.now(),
    ) {}

    list(userHandle: string, extensionId: string): AgentToolDescriptor[] {
        const tools = [
            ...this.hostTools.list(),
            ...moduleToolDescriptors(this.moduleHost),
            ...this.browserTools(userHandle, extensionId),
        ];
        const ids = new Set<string>();
        for (const tool of tools) {
            if (ids.has(tool.id)) throw new Error(`Agent tool id collision: ${tool.id}`);
            ids.add(tool.id);
        }
        return structuredClone(tools);
    }

    registerBrowserTools(
        userHandle: string,
        extensionId: string,
        request: AgentBrowserToolRegistrationRequest,
    ): AgentBrowserToolRegistrationResponse {
        const user = requiredText(userHandle, 'Browser tool user handle', 200);
        const owner = requiredText(extensionId, 'Browser tool extension id', 128);
        const browserInstanceId = requiredText(request.browserInstanceId, 'Browser instance id', 128);
        const leaseDurationMs = request.leaseDurationMs ?? DEFAULT_BROWSER_LEASE_MS;
        if (!Number.isSafeInteger(leaseDurationMs) || leaseDurationMs < 1) {
            throw new Error('Browser tool leaseDurationMs must be a positive integer');
        }
        if (!Array.isArray(request.tools) || request.tools.length === 0) {
            throw new Error('Browser tool registration must contain at least one tool');
        }
        let serializedTools: string;
        try {
            serializedTools = JSON.stringify(request.tools);
        } catch {
            throw new Error('Browser tool registration must be JSON serializable');
        }

        this.pruneBrowserRegistrations();
        const registrationKey = browserRegistrationKey(user, owner, browserInstanceId);
        const localIds = new Set<string>();
        const normalizedTools = request.tools.map(input => {
            const normalized = normalizeBrowserTool(input);
            if (localIds.has(normalized.id)) throw new Error(`Duplicate browser tool id: ${normalized.id}`);
            localIds.add(normalized.id);
            return normalized;
        });
        const registrationId = hashValue(JSON.stringify(normalizedTools));
        const prefix = `browser_${shortHash(`${user}\0${owner}\0${browserInstanceId}\0${registrationId}`)}_`;
        const tools = normalizedTools.map(normalized => ({
            ...normalized,
            id: `${prefix}${normalized.id}`,
            execution: 'browser' as const,
            source: {
                kind: 'browser' as const,
                userHandle: user,
                extensionId: owner,
                browserInstanceId,
                registrationId,
            },
        }));
        const leaseExpiresAt = new Date(this.now() + leaseDurationMs).toISOString();
        this.browserRegistrations.set(registrationKey, {
            userHandle: user,
            extensionId: owner,
            browserInstanceId,
            registrationId,
            leaseExpiresAt,
            tools,
        });
        return { browserInstanceId, registrationId, leaseExpiresAt, tools: structuredClone(tools) };
    }

    browserDescriptors(userHandle: string, extensionId: string, browserInstanceId: string): AgentToolDescriptor[] {
        this.pruneBrowserRegistrations();
        const registration = this.browserRegistrations.get(browserRegistrationKey(userHandle, extensionId, browserInstanceId));
        if (!registration) throw new Error(`Browser tool registration is unavailable: ${browserInstanceId}`);
        return structuredClone(registration.tools);
    }

    private browserTools(userHandle: string, extensionId: string): AgentToolDescriptor[] {
        this.pruneBrowserRegistrations();
        return [...this.browserRegistrations.values()]
            .filter(registration => registration.userHandle === userHandle && registration.extensionId === extensionId)
            .flatMap(registration => registration.tools);
    }

    private pruneBrowserRegistrations(): void {
        const timestamp = this.now();
        for (const [key, registration] of this.browserRegistrations) {
            if (Date.parse(registration.leaseExpiresAt) <= timestamp) this.browserRegistrations.delete(key);
        }
    }
}

function moduleToolDescriptors(moduleHost?: ModuleHostService): AgentToolDescriptor[] {
    if (!moduleHost) return [];
    return moduleHost.listManifests().modules.flatMap(module => Object.entries(module.transactions).map(([name, transaction]) => ({
        id: `module:${module.id}:${name}`,
        title: `${module.displayName}: ${transaction.title}`,
        description: `${transaction.description || transaction.title} This Authority module transaction may have effects outside workspace rollback.`,
        inputSchema: moduleTransactionSchema(transaction),
        ...(transaction.outputSchema ? { outputSchema: structuredClone(transaction.outputSchema) } : {}),
        execution: 'module' as const,
        riskLevel: transaction.riskLevel,
        approvalPolicy: transaction.riskLevel === 'high'
            ? 'always' as const
            : transaction.riskLevel === 'medium' ? 'on-mutation' as const : 'never' as const,
        mutatesWorkspace: false,
        source: { kind: 'module' as const, moduleId: module.id, transactionName: name },
    })));
}

function moduleTransactionSchema(transaction: ModuleTransactionManifest): Record<string, unknown> {
    return {
        type: 'object',
        properties: {
            input: transaction.inputSchema ?? { type: 'object' },
            idempotencyKey: { type: 'string' },
            options: {
                type: 'object',
                properties: { timeoutMs: { type: 'integer', minimum: 1 } },
                additionalProperties: false,
            },
        },
        ...(transaction.idempotency === 'required' ? { required: ['idempotencyKey'] } : {}),
        additionalProperties: false,
    };
}

function normalizeBrowserTool(
    input: AgentBrowserToolRegistrationRequest['tools'][number],
): Omit<AgentToolDescriptor, 'execution' | 'source'> {
    if (!input || typeof input !== 'object') throw new Error('Browser tool descriptor must be an object');
    const id = requiredText(input.id, 'Browser tool id');
    if (!BROWSER_TOOL_ID_PATTERN.test(id)) throw new Error(`Browser tool id is invalid: ${id}`);
    const title = requiredText(input.title, 'Browser tool title');
    const description = requiredText(input.description, 'Browser tool description');
    if (!isSchema(input.inputSchema) || (input.outputSchema !== undefined && !isSchema(input.outputSchema))) {
        throw new Error(`Browser tool schema is invalid: ${id}`);
    }
    if (input.riskLevel !== 'low' && input.riskLevel !== 'medium' && input.riskLevel !== 'high') {
        throw new Error(`Browser tool risk level is invalid: ${id}`);
    }
    if (input.approvalPolicy !== 'never' && input.approvalPolicy !== 'on-mutation' && input.approvalPolicy !== 'always') {
        throw new Error(`Browser tool approval policy is invalid: ${id}`);
    }
    if (input.mutatesWorkspace !== false) throw new Error(`Browser tools cannot declare workspace mutations: ${id}`);
    const riskLevel = input.riskLevel === 'high' ? 'high' as const : 'medium' as const;
    const approvalPolicy = riskLevel === 'high' || input.approvalPolicy === 'always'
        ? 'always' as const
        : 'on-mutation' as const;
    return {
        id,
        title,
        description,
        inputSchema: structuredClone(input.inputSchema),
        ...(input.outputSchema ? { outputSchema: structuredClone(input.outputSchema) } : {}),
        riskLevel,
        approvalPolicy,
        mutatesWorkspace: false,
    };
}

function browserRegistrationKey(userHandle: string, extensionId: string, browserInstanceId: string): string {
    return `${userHandle}\0${extensionId}\0${browserInstanceId}`;
}

function shortHash(value: string): string {
    return hashValue(value).slice(0, 24);
}

function hashValue(value: string): string {
    return crypto.createHash('sha256').update(value).digest('hex');
}

function isSchema(value: unknown): value is Record<string, unknown> {
    return Boolean(value && typeof value === 'object' && !Array.isArray(value));
}

function requiredText(value: unknown, label: string, maxLength?: number): string {
    if (typeof value !== 'string' || !value.trim()) throw new Error(`${label} is required`);
    const result = value.trim();
    if (maxLength !== undefined && result.length > maxLength) throw new Error(`${label} exceeds ${maxLength} characters`);
    return result;
}

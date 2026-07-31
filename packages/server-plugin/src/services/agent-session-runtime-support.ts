import crypto from 'node:crypto';
import type { AgentExecutionMode, AgentLlmMessage, AgentToolDescriptor } from '@stdo/shared-types';
import type { AgentLlmToolDefinition } from './agent-llm-client.js';
import type {
    AgentSessionGenerationState,
    AgentSessionRunState,
    AgentSessionSnapshot,
    AgentSessionStepState,
    AgentSessionToolInvocationState,
} from './agent-session-model.js';

export const TERMINAL_RUNS = new Set<AgentSessionRunState['status']>(['completed', 'failed', 'cancelled']);
export const TERMINAL_TOOLS = new Set<AgentSessionToolInvocationState['status']>([
    'completed', 'failed', 'cancelled', 'outcome_unknown', 'timed_out',
]);

export function activeStep(snapshot: AgentSessionSnapshot, runId: string): AgentSessionStepState | undefined {
    return snapshot.steps.find(step => step.runId === runId && step.status === 'running');
}

export function activeGeneration(snapshot: AgentSessionSnapshot, stepId: string): AgentSessionGenerationState | undefined {
    return snapshot.generations.find(generation => generation.stepId === stepId && generation.status === 'running');
}

export function activeInvocation(snapshot: AgentSessionSnapshot, stepId: string): AgentSessionToolInvocationState | undefined {
    return snapshot.invocations.find(invocation => invocation.stepId === stepId && !TERMINAL_TOOLS.has(invocation.status));
}

export function requireRun(snapshot: AgentSessionSnapshot, runId: string): AgentSessionRunState {
    const run = snapshot.runs.find(item => item.id === runId);
    if (!run) throw new Error(`Agent session run not found: ${runId}`);
    return run;
}

export function requireRef(snapshot: AgentSessionSnapshot, refName: string) {
    const ref = snapshot.refs.find(item => item.name === refName);
    if (!ref) throw new Error(`Agent session ref not found: ${refName}`);
    return ref;
}

export function conversationMessages(snapshot: AgentSessionSnapshot, run: AgentSessionRunState): AgentLlmMessage[] {
    const path = new Set(snapshot.activePaths[run.ref] ?? []);
    const active = snapshot.conversation.filter(entry => path.has(entry.id));
    const lastCompaction = [...active].reverse().find(entry => entry.kind === 'compaction');
    const messages: AgentLlmMessage[] = [{ role: 'system', content: systemPrompt(snapshot.session.workspaceId, run.mode) }];
    if (lastCompaction?.kind === 'compaction') {
        messages.push({ role: 'system', content: `Conversation summary:\n${lastCompaction.summary}` });
        const keep = new Set(lastCompaction.retainedEntryIds);
        for (const entry of active) {
            if (entry.sequence <= lastCompaction.sequence && !keep.has(entry.id)) continue;
            appendProjectedMessage(messages, entry);
        }
        return messages;
    }
    for (const entry of active) appendProjectedMessage(messages, entry);
    return messages;
}

function appendProjectedMessage(messages: AgentLlmMessage[], entry: AgentSessionSnapshot['conversation'][number]): void {
    if (entry.kind === 'branch_summary') {
        messages.push({ role: 'system', content: `Earlier branch summary:\n${entry.summary}` });
    } else if (entry.kind === 'message') {
        messages.push({
            role: entry.role,
            content: entry.content,
            ...(entry.toolCallId ? { toolCallId: entry.toolCallId } : {}),
            ...(entry.toolCalls ? { toolCalls: entry.toolCalls } : {}),
        });
    }
}

export function mapLlmTools(descriptors: AgentToolDescriptor[]): {
    definitions: AgentLlmToolDefinition[];
    nameToId: Map<string, string>;
} {
    const nameToId = new Map<string, string>();
    const definitions = descriptors.map(descriptor => {
        const name = llmToolName(descriptor.id);
        if (nameToId.has(name)) throw new Error(`Agent tool name collision: ${descriptor.id}`);
        nameToId.set(name, descriptor.id);
        return {
            type: 'function' as const,
            function: { name, description: descriptor.description, parameters: descriptor.inputSchema },
        };
    });
    return { definitions, nameToId };
}

function llmToolName(toolId: string): string {
    const normalized = toolId.replace(/[^a-zA-Z0-9_-]/g, '_');
    if (normalized === toolId && normalized.length <= 64) return normalized;
    return `${normalized.slice(0, 51)}_${crypto.createHash('sha256').update(toolId).digest('hex').slice(0, 12)}`;
}

export function isPlanSafeTool(tool: AgentToolDescriptor): boolean {
    return tool.execution === 'host' && !tool.mutatesWorkspace && tool.approvalPolicy === 'never';
}

export function normalizeMode(value: unknown): AgentExecutionMode {
    if (value === undefined) return 'ask';
    if (value !== 'plan' && value !== 'ask' && value !== 'auto') throw new Error('Agent mode must be plan, ask, or auto');
    return value;
}

export function normalizeAllowedTools(value: unknown, available: AgentToolDescriptor[]): string[] {
    const ids = new Set(available.map(tool => tool.id));
    if (value === undefined) return [...ids];
    if (!Array.isArray(value) || value.some(item => typeof item !== 'string')) {
        throw new Error('allowedTools must be an array of tool ids');
    }
    const result = [...new Set(value as string[])];
    for (const id of result) {
        if (!ids.has(id)) throw new Error(`Unknown Agent tool: ${id}`);
    }
    return result;
}

export function selectOne<T>(requestedId: string | undefined, items: T[], id: (item: T) => string, label: string): T {
    if (requestedId !== undefined) {
        const selected = items.find(item => id(item) === requestedId);
        if (!selected) throw new Error(`Agent ${label} not found: ${requestedId}`);
        return selected;
    }
    if (items.length !== 1) {
        throw new Error(items.length === 0
            ? `No Agent ${label} is configured`
            : `Agent ${label} must be selected because multiple are configured`);
    }
    return items[0]!;
}

export function parseToolArguments(value: string): unknown {
    let parsed: unknown;
    try {
        parsed = JSON.parse(value);
    } catch (error) {
        throw new Error(`Tool arguments are invalid JSON: ${errorMessage(error)}`);
    }
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
        throw new Error('Tool arguments must be a JSON object');
    }
    return parsed;
}

export function boundedToolValue(value: unknown): unknown {
    return value === undefined ? null : value;
}

export function formatInitialMessage(message: unknown, instructions?: string, context?: unknown): string {
    const content = requiredText(message, 'Agent message');
    const normalizedInstructions = instructions === undefined
        ? undefined
        : requiredText(instructions, 'Agent instructions');
    let serializedContext: string | undefined;
    if (context !== undefined) {
        try {
            serializedContext = JSON.stringify(context);
        } catch (error) {
            throw new Error(`Agent context must be JSON serializable: ${errorMessage(error)}`);
        }
    }
    return [
        content,
        ...(normalizedInstructions ? [`Additional instructions:\n${normalizedInstructions}`] : []),
        ...(serializedContext ? [`Caller context (JSON):\n${serializedContext}`] : []),
    ].join('\n\n');
}

export function titleFromMessage(message: string): string {
    const firstLine = message.split(/\r?\n/, 1)[0]!.trim();
    return (firstLine || 'New Agent session').slice(0, 120);
}

function systemPrompt(workspaceId: string, mode: AgentExecutionMode): string {
    return [
        'You are Authority Agent, an IDE-grade operator for a registered SillyTavern workspace.',
        `Registered workspace: ${workspaceId}. All tool paths are relative to its private root.`,
        `Execution mode: ${mode}.`,
        'This is a persistent session. Use the conversation as durable context and treat tool results as authoritative.',
        'Inspect relevant files before changing them. Use registered tools for every action and rely on their returned results.',
        'Keep writes narrow. Shell commands checkpoint the workspace except .git and node_modules, and always require approval because those paths and effects outside the workspace cannot be rolled back.',
        mode === 'plan'
            ? 'Plan mode is read-only: only Authority host inspection tools are available.'
            : mode === 'ask'
                ? 'Ask mode pauses before each workspace mutation so the user can approve or deny it.'
                : 'Auto mode may execute workspace mutations without pausing; every mutation is still checkpointed for rollback.',
        'When the current request is complete, return a concise result and verification status. The session remains open for follow-up work.',
    ].join('\n');
}

export function requiredText(value: unknown, label: string, maxLength?: number): string {
    if (typeof value !== 'string' || !value.trim()) throw new Error(`${label} is required`);
    const result = value.trim();
    if (maxLength !== undefined && result.length > maxLength) throw new Error(`${label} exceeds ${maxLength} characters`);
    return result;
}

export function isTimeoutMessage(message: string): boolean {
    return /timed? out|timeout/i.test(message);
}

export function isObject(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export function errorMessage(error: unknown): string {
    return error instanceof Error ? error.message : String(error);
}

export function delay(milliseconds: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, milliseconds));
}

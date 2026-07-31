import type { AgentLlmMessage } from '@stdo/shared-types';
import type { StoredAgentLlmProfile } from './agent-profile-store-service.js';
import type { AgentLlmToolDefinition } from './agent-llm-client.js';
import type {
    AgentConversationEntry,
    AgentSessionRunState,
    AgentSessionSnapshot,
} from './agent-session-model.js';

const SUMMARIZATION_SYSTEM_PROMPT = [
    'You are a context summarization assistant.',
    'Read the supplied Authority Agent conversation and produce only the structured checkpoint requested.',
    'Do not continue the task, answer the user, or call tools.',
].join(' ');

const CREATE_SUMMARY_PROMPT = `Create a compact, loss-aware checkpoint that another Agent can use to continue the work.

Use this exact structure:

## Goal
## Constraints & Preferences
## Progress
### Done
### In Progress
### Blocked
## Key Decisions
## Next Steps
## Critical Context

Preserve exact file paths, symbols, commands, identifiers, error messages, user decisions, unresolved tool outcomes, and verification status. Distinguish facts from assumptions. Be concise and do not repeat information.`;

const UPDATE_SUMMARY_PROMPT = `Update the checkpoint in <previous-summary> with the new conversation segment.

Keep the same structure. Preserve still-valid details, merge new progress and decisions, remove only information that is demonstrably obsolete, and keep exact file paths, symbols, commands, identifiers, error messages, user decisions, unresolved tool outcomes, and verification status. Output only the updated checkpoint.`;

export interface AgentCompactionPlan {
    runId: string;
    ref: string;
    profileId: string;
    sourceLeafEntryId: string;
    sourceLastSequence: number;
    firstKeptEntryId: string | null;
    retainedEntryIds: string[];
    retainedMessages: AgentLlmMessage[];
    sourceText: string;
    previousSummary?: string;
    tokensBefore: number;
    contextWindowTokens: number;
    maxOutputTokens: number;
    summaryOutputTokens: number;
    forced: boolean;
}

export interface AgentCompactionRequestChunk {
    messages: AgentLlmMessage[];
    consumedChars: number;
}

export interface AgentCompactionChunkOptions {
    /** Adaptive provider-overflow hint. This is not a task quota. */
    maxSourceChars?: number;
    /** Adaptive provider-overflow hint. This is not a task quota. */
    summaryOutputTokens?: number;
}

export function prepareAgentCompaction(
    snapshot: AgentSessionSnapshot,
    run: AgentSessionRunState,
    messages: AgentLlmMessage[],
    tools: AgentLlmToolDefinition[],
    profile: Readonly<StoredAgentLlmProfile>,
    force = false,
): AgentCompactionPlan | null {
    const contextWindowTokens = profile.contextWindowTokens;
    const maxOutputTokens = profile.maxOutputTokens;
    if (contextWindowTokens === null || maxOutputTokens === null) {
        throw new Error('Agent LLM profile requires contextWindowTokens and maxOutputTokens');
    }
    const inputBudget = contextWindowTokens - maxOutputTokens;
    if (inputBudget < 1) throw new Error('Agent LLM profile has no usable input context');

    const active = activeConversation(snapshot, run.ref);
    const tokensBefore = estimateContextTokens(snapshot, active, messages, tools);
    if (!force && tokensBefore <= inputBudget) return null;

    const sourceLeafEntryId = active.at(-1)?.id;
    if (!sourceLeafEntryId) {
        throw new Error('Agent context exceeds the configured window before any conversation can be compacted');
    }
    const latestCompaction = [...active].reverse().find(entry => entry.kind === 'compaction');
    const visible = visibleConversation(active, latestCompaction);
    const requiredReduction = Math.max(1, tokensBefore - inputBudget);
    let removedTokens = 0;
    let boundaryPathIndex = active.length;
    let foundBoundary = false;

    for (let index = 0; index < visible.length; index += 1) {
        const item = visible[index]!;
        const projected = projectEntry(item.entry);
        if (projected) removedTokens += estimateMessageTokens(projected);
        const next = visible[index + 1];
        if (removedTokens < requiredReduction || !next || !isPreferredBoundary(next.entry)) continue;
        boundaryPathIndex = next.pathIndex;
        foundBoundary = true;
        break;
    }

    if (!foundBoundary && removedTokens < requiredReduction && latestCompaction && visible.length === 0) {
        const previousSummary = latestCompaction.summary;
        return {
            runId: run.id,
            ref: run.ref,
            profileId: run.profileId,
            sourceLeafEntryId,
            sourceLastSequence: snapshot.lastSequence,
            firstKeptEntryId: null,
            retainedEntryIds: [],
            retainedMessages: [],
            sourceText: previousSummary,
            tokensBefore,
            contextWindowTokens,
            maxOutputTokens,
            summaryOutputTokens: summaryOutputBudget(contextWindowTokens, maxOutputTokens),
            forced: force,
        };
    }

    const firstKeptEntryId = boundaryPathIndex < active.length ? active[boundaryPathIndex]!.id : null;
    const retainedEntries = active.slice(boundaryPathIndex);
    const retainedEntryIds = retainedEntries.map(entry => entry.id);
    const retainedMessages = retainedEntries.flatMap(entry => {
        const message = projectEntry(entry);
        return message ? [message] : [];
    });
    const messagesToSummarize = visible
        .filter(item => item.pathIndex < boundaryPathIndex)
        .flatMap(item => {
            const message = projectEntry(item.entry);
            return message ? [message] : [];
        });
    const previousSummary = latestCompaction?.summary;
    const sourceText = serializeConversation(messagesToSummarize);
    if (!sourceText && !previousSummary) {
        throw new Error('Agent context exceeds the configured window, but no conversation prefix can be compacted');
    }

    return {
        runId: run.id,
        ref: run.ref,
        profileId: run.profileId,
        sourceLeafEntryId,
        sourceLastSequence: snapshot.lastSequence,
        firstKeptEntryId,
        retainedEntryIds,
        retainedMessages,
        sourceText: sourceText || previousSummary!,
        ...(sourceText && previousSummary ? { previousSummary } : {}),
        tokensBefore,
        contextWindowTokens,
        maxOutputTokens,
        summaryOutputTokens: summaryOutputBudget(contextWindowTokens, maxOutputTokens),
        forced: force,
    };
}

export function nextCompactionRequestChunk(
    plan: AgentCompactionPlan,
    offset: number,
    previousSummary?: string,
    options: AgentCompactionChunkOptions = {},
): AgentCompactionRequestChunk {
    if (offset < 0 || offset >= plan.sourceText.length) {
        throw new Error('Agent compaction source offset is outside the prepared conversation');
    }
    const summaryOutputTokens = options.summaryOutputTokens ?? plan.summaryOutputTokens;
    if (!Number.isSafeInteger(summaryOutputTokens) || summaryOutputTokens < 1
        || summaryOutputTokens >= plan.contextWindowTokens) {
        throw new Error('Agent compaction output budget is invalid');
    }
    const inputBudget = plan.contextWindowTokens - summaryOutputTokens;
    const available = plan.sourceText.length - offset;
    const requestedChars = options.maxSourceChars === undefined
        ? available
        : Math.min(available, Math.max(1, Math.floor(options.maxSourceChars)));
    const remaining = plan.sourceText.slice(offset, offset + requestedChars);
    const createRequest = (segment: string): AgentLlmMessage[] => {
        const content = [
            `<conversation>\n${segment}\n</conversation>`,
            ...(previousSummary ? [`<previous-summary>\n${previousSummary}\n</previous-summary>`] : []),
            previousSummary ? UPDATE_SUMMARY_PROMPT : CREATE_SUMMARY_PROMPT,
        ].join('\n\n');
        return [
            { role: 'system', content: SUMMARIZATION_SYSTEM_PROMPT },
            { role: 'user', content },
        ];
    };

    const whole = createRequest(remaining);
    if (estimateRequestTokens(whole, []) <= inputBudget) {
        return { messages: whole, consumedChars: remaining.length };
    }

    let low = 1;
    let high = remaining.length;
    let best = 0;
    while (low <= high) {
        const middle = Math.floor((low + high) / 2);
        const end = safeSliceEnd(remaining, middle);
        const candidate = createRequest(remaining.slice(0, end));
        if (estimateRequestTokens(candidate, []) <= inputBudget) {
            best = end;
            low = middle + 1;
        } else {
            high = middle - 1;
        }
    }
    if (best < 1) {
        throw new Error('Agent context window is too small for the compaction prompt and configured summary output');
    }
    return { messages: createRequest(remaining.slice(0, best)), consumedChars: best };
}

export function estimateCompactedTokens(
    plan: AgentCompactionPlan,
    summary: string,
    tools: AgentLlmToolDefinition[],
    systemMessage: AgentLlmMessage,
): number {
    return estimateRequestTokens([
        systemMessage,
        { role: 'system', content: `Conversation summary:\n${summary}` },
        ...plan.retainedMessages,
    ], tools);
}

export function estimateRequestTokens(messages: AgentLlmMessage[], tools: AgentLlmToolDefinition[]): number {
    return estimateTextTokens(safeJson({ messages, tools }));
}

export function estimateTextTokens(value: string): number {
    let asciiChars = 0;
    let otherTokens = 0;
    for (const character of value) {
        if (character.codePointAt(0)! <= 0x7f) asciiChars += 1;
        else otherTokens += 1;
    }
    return Math.ceil(asciiChars / 4) + otherTokens;
}

export function providerUsageTokens(value: unknown): number {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return 0;
    const usage = value as Record<string, unknown>;
    const total = firstFinite(usage.total_tokens, usage.totalTokens, usage.total);
    if (total > 0) return Math.ceil(total);
    return Math.ceil(
        firstFinite(usage.prompt_tokens, usage.input_tokens, usage.inputTokens, usage.input)
        + firstFinite(usage.completion_tokens, usage.output_tokens, usage.outputTokens, usage.output)
        + firstFinite(usage.cache_read_input_tokens, usage.cacheRead, usage.cache_read)
        + firstFinite(usage.cache_creation_input_tokens, usage.cacheWrite, usage.cache_write),
    );
}

function estimateContextTokens(
    snapshot: AgentSessionSnapshot,
    active: AgentConversationEntry[],
    messages: AgentLlmMessage[],
    tools: AgentLlmToolDefinition[],
): number {
    const local = estimateRequestTokens(messages, tools);
    const visible = visibleConversation(active, [...active].reverse().find(entry => entry.kind === 'compaction'));
    let assistantIndex = -1;
    for (let index = visible.length - 1; index >= 0; index -= 1) {
        const entry = visible[index]!.entry;
        if (entry.kind === 'message' && entry.role === 'assistant' && entry.stepId !== undefined) {
            assistantIndex = index;
            break;
        }
    }
    if (assistantIndex === -1) return local;
    const assistant = visible[assistantIndex]!.entry;
    if (assistant.kind !== 'message' || !assistant.stepId) return local;
    const generation = [...snapshot.generations].reverse().find(item => item.stepId === assistant.stepId
        && item.status === 'completed');
    const provider = providerUsageTokens(generation?.usage);
    if (provider <= 0) return local;
    const trailing = visible.slice(assistantIndex + 1).reduce((total, item) => {
        const message = projectEntry(item.entry);
        return total + (message ? estimateMessageTokens(message) : 0);
    }, 0);
    return Math.max(local, provider + trailing);
}

function activeConversation(snapshot: AgentSessionSnapshot, ref: string): AgentConversationEntry[] {
    const byId = new Map(snapshot.conversation.map(entry => [entry.id, entry]));
    return (snapshot.activePaths[ref] ?? []).map(id => byId.get(id)).filter((entry): entry is AgentConversationEntry => Boolean(entry));
}

function visibleConversation(
    active: AgentConversationEntry[],
    latestCompaction: Extract<AgentConversationEntry, { kind: 'compaction' }> | undefined,
): Array<{ entry: AgentConversationEntry; pathIndex: number }> {
    if (!latestCompaction) return active.map((entry, pathIndex) => ({ entry, pathIndex }));
    const retained = new Set(latestCompaction.retainedEntryIds);
    return active.flatMap((entry, pathIndex) => {
        if (entry.kind === 'compaction') return [];
        if (entry.sequence <= latestCompaction.sequence && !retained.has(entry.id)) return [];
        return [{ entry, pathIndex }];
    });
}

function projectEntry(entry: AgentConversationEntry): AgentLlmMessage | null {
    if (entry.kind === 'compaction') return null;
    if (entry.kind === 'branch_summary') {
        return { role: 'system', content: `Earlier branch summary:\n${entry.summary}` };
    }
    return {
        role: entry.role,
        content: entry.content,
        ...(entry.toolCallId ? { toolCallId: entry.toolCallId } : {}),
        ...(entry.toolCalls ? { toolCalls: entry.toolCalls } : {}),
    };
}

function isPreferredBoundary(entry: AgentConversationEntry): boolean {
    return entry.kind === 'message' && (entry.role === 'user' || entry.role === 'assistant');
}

function estimateMessageTokens(message: AgentLlmMessage): number {
    return estimateTextTokens(safeJson(message));
}

function serializeConversation(messages: AgentLlmMessage[]): string {
    return messages.map(message => {
        const details = [
            `[${message.role}]`,
            message.content ?? '',
            ...(message.toolCalls?.length
                ? [`Tool calls:\n${message.toolCalls.map(call => `${call.name}(${call.arguments}) [${call.id}]`).join('\n')}`]
                : []),
            ...(message.toolCallId ? [`Tool call id: ${message.toolCallId}`] : []),
        ].filter(Boolean);
        return details.join('\n');
    }).join('\n\n');
}

function summaryOutputBudget(contextWindowTokens: number, maxOutputTokens: number): number {
    return Math.min(maxOutputTokens, Math.max(1, Math.floor(contextWindowTokens / 4)));
}

function safeSliceEnd(value: string, requested: number): number {
    if (requested >= value.length) return value.length;
    const code = value.charCodeAt(requested - 1);
    return code >= 0xd800 && code <= 0xdbff ? requested - 1 : requested;
}

function safeJson(value: unknown): string {
    try {
        return JSON.stringify(value) ?? 'null';
    } catch {
        return String(value);
    }
}

function firstFinite(...values: unknown[]): number {
    for (const value of values) {
        if (typeof value === 'number' && Number.isFinite(value) && value >= 0) return value;
    }
    return 0;
}

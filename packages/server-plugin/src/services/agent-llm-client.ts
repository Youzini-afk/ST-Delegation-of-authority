import type { AgentLlmMessage } from '@stdo/shared-types';
import type { StoredAgentLlmProfile } from './agent-profile-store-service.js';

const MAX_RESPONSE_BYTES = 10 * 1024 * 1024;
const MAX_REQUEST_BYTES = 8 * 1024 * 1024;
const MAX_ASSISTANT_CONTENT_CHARS = 256 * 1024;
const MAX_TOOL_ARGUMENT_CHARS = 128 * 1024;
const MAX_TOTAL_TOOL_ARGUMENT_CHARS = 1024 * 1024;
const MAX_USAGE_CHARS = 16 * 1024;

export interface AgentLlmToolDefinition {
    type: 'function';
    function: {
        name: string;
        description: string;
        parameters: Record<string, unknown>;
    };
}

export interface AgentLlmCompletionRequest {
    messages: AgentLlmMessage[];
    tools: AgentLlmToolDefinition[];
    signal: AbortSignal;
}

export interface AgentLlmCompletionResponse {
    message: AgentLlmMessage;
    finishReason: string | null;
    usage?: unknown;
    providerRequestId?: string;
}

export type AgentCompletionRequester = (
    profile: Readonly<StoredAgentLlmProfile>,
    request: AgentLlmCompletionRequest,
) => Promise<AgentLlmCompletionResponse>;

export class AgentLlmClient {
    constructor(private readonly fetchImpl: typeof fetch = fetch) {}

    async complete(
        profile: Readonly<StoredAgentLlmProfile>,
        request: AgentLlmCompletionRequest,
    ): Promise<AgentLlmCompletionResponse> {
        const controller = new AbortController();
        const forwardAbort = () => controller.abort(request.signal.reason);
        if (request.signal.aborted) {
            forwardAbort();
        } else {
            request.signal.addEventListener('abort', forwardAbort, { once: true });
        }
        const timer = setTimeout(() => controller.abort(new Error(`LLM request timed out after ${profile.timeoutMs} ms`)), profile.timeoutMs);
        try {
            throwIfAborted(controller.signal);
            const body = JSON.stringify({
                model: profile.model,
                messages: request.messages.map(toOpenAiMessage),
                stream: false,
                ...(request.tools.length > 0 ? { tools: request.tools, tool_choice: 'auto' } : {}),
                ...(profile.temperature === null ? {} : { temperature: profile.temperature }),
                ...(profile.maxOutputTokens === null ? {} : { max_tokens: profile.maxOutputTokens }),
            });
            if (Buffer.byteLength(body, 'utf8') > MAX_REQUEST_BYTES) {
                throw new Error('LLM request exceeded the 8 MB limit');
            }
            const response = await this.fetchImpl(completionUrl(profile.baseUrl), {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    ...(profile.apiKey ? { Authorization: `Bearer ${profile.apiKey}` } : {}),
                },
                body,
                signal: controller.signal,
            });
            const text = await readLimitedText(response);
            throwIfAborted(controller.signal);
            if (!response.ok) {
                throw new Error(`LLM request failed (${response.status}): ${redact(text.slice(0, 4_000), profile.apiKey)}`);
            }
            return parseCompletion(text, response.headers.get('x-request-id'));
        } catch (error) {
            if (controller.signal.aborted && !request.signal.aborted) {
                throw controller.signal.reason instanceof Error
                    ? controller.signal.reason
                    : new Error(`LLM request timed out after ${profile.timeoutMs} ms`);
            }
            throw error;
        } finally {
            clearTimeout(timer);
            request.signal.removeEventListener('abort', forwardAbort);
        }
    }
}

async function readLimitedText(response: Response): Promise<string> {
    const declaredLength = Number(response.headers.get('content-length'));
    if (Number.isFinite(declaredLength) && declaredLength > MAX_RESPONSE_BYTES) {
        throw new Error('LLM response exceeded the 10 MB limit');
    }
    if (!response.body) {
        return '';
    }
    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let total = 0;
    let text = '';
    while (true) {
        const { done, value } = await reader.read();
        if (done) {
            return text + decoder.decode();
        }
        total += value.byteLength;
        if (total > MAX_RESPONSE_BYTES) {
            await reader.cancel();
            throw new Error('LLM response exceeded the 10 MB limit');
        }
        text += decoder.decode(value, { stream: true });
    }
}

function redact(value: string, secret: string | null): string {
    return secret ? value.split(secret).join('[redacted]') : value;
}

function throwIfAborted(signal: AbortSignal): void {
    if (signal.aborted) {
        throw signal.reason instanceof Error ? signal.reason : Object.assign(new Error('LLM request aborted'), { name: 'AbortError' });
    }
}

function completionUrl(baseUrl: string): string {
    return baseUrl.endsWith('/chat/completions') ? baseUrl : `${baseUrl}/chat/completions`;
}

function toOpenAiMessage(message: AgentLlmMessage): Record<string, unknown> {
    if (message.role === 'tool') {
        return {
            role: 'tool',
            content: message.content ?? '',
            tool_call_id: message.toolCallId,
        };
    }
    if (message.role === 'assistant' && message.toolCalls?.length) {
        return {
            role: 'assistant',
            content: message.content,
            tool_calls: message.toolCalls.map(call => ({
                id: call.id,
                type: 'function',
                function: { name: call.name, arguments: call.arguments },
            })),
        };
    }
    return { role: message.role, content: message.content ?? '' };
}

function parseCompletion(text: string, responseRequestId: string | null): AgentLlmCompletionResponse {
    let payload: any;
    try {
        payload = JSON.parse(text);
    } catch (error) {
        throw new Error(`LLM returned invalid JSON: ${error instanceof Error ? error.message : String(error)}`);
    }
    const choice = payload?.choices?.[0];
    const message = choice?.message;
    if (!message || message.role !== 'assistant') {
        throw new Error('LLM response did not include an assistant message');
    }
    const content = message.content === null || typeof message.content === 'string' ? message.content : null;
    if (content !== null && content.length > MAX_ASSISTANT_CONTENT_CHARS) {
        throw new Error('LLM assistant content exceeded the 256 KB limit');
    }
    const toolCalls = message.tool_calls === undefined ? undefined : parseToolCalls(message.tool_calls);
    if ((content === null || !content.trim()) && !toolCalls?.length) {
        throw new Error('LLM assistant message was empty');
    }
    const requestId = providerRequestId(responseRequestId, payload?.id);
    return {
        message: {
            role: 'assistant',
            content,
            ...(toolCalls?.length ? { toolCalls } : {}),
        },
        finishReason: typeof choice.finish_reason === 'string' ? choice.finish_reason : null,
        ...(payload.usage === undefined ? {} : { usage: boundedUsage(payload.usage) }),
        ...(requestId ? { providerRequestId: requestId } : {}),
    };
}

function providerRequestId(headerValue: string | null, payloadValue: unknown): string | undefined {
    const value = headerValue || (typeof payloadValue === 'string' ? payloadValue : '');
    return value && value.length <= 500 ? value : undefined;
}

function parseToolCalls(value: unknown): NonNullable<AgentLlmMessage['toolCalls']> {
    if (!Array.isArray(value) || value.length > 32) {
        throw new Error('LLM response contained invalid tool calls');
    }
    const ids = new Set<string>();
    let totalArgumentChars = 0;
    return value.map((call, index) => {
        const id = call?.id;
        const name = call?.function?.name;
        const args = call?.function?.arguments;
        if (
            call?.type !== 'function'
            || typeof id !== 'string'
            || id.length < 1
            || id.length > 256
            || ids.has(id)
            || typeof name !== 'string'
            || !/^[a-zA-Z0-9_-]{1,64}$/.test(name)
            || typeof args !== 'string'
            || args.length > MAX_TOOL_ARGUMENT_CHARS
        ) {
            throw new Error(`LLM response contained an invalid tool call at index ${index}`);
        }
        totalArgumentChars += args.length;
        if (totalArgumentChars > MAX_TOTAL_TOOL_ARGUMENT_CHARS) {
            throw new Error('LLM response tool arguments exceeded the 1 MB combined limit');
        }
        ids.add(id);
        return { id, name, arguments: args };
    });
}

function boundedUsage(value: unknown): unknown {
    const serialized = JSON.stringify(value);
    if (typeof serialized === 'string' && serialized.length <= MAX_USAGE_CHARS) {
        return value;
    }
    return { truncated: true };
}

import { describe, expect, it, vi } from 'vitest';
import type { StoredAgentLlmProfile } from './agent-profile-store-service.js';
import { AgentLlmClient } from './agent-llm-client.js';

describe('AgentLlmClient', () => {
    it('sends OpenAI-compatible tools and parses tool calls', async () => {
        const fetchMock = vi.fn(async () => new Response(JSON.stringify({
            choices: [{
                finish_reason: 'tool_calls',
                message: {
                    role: 'assistant',
                    content: null,
                    tool_calls: [{
                        id: 'call-1',
                        type: 'function',
                        function: { name: 'host_read_file', arguments: '{"path":"a.txt"}' },
                    }],
                },
            }],
            usage: { total_tokens: 12 },
        }), { status: 200 })) as unknown as typeof fetch;
        const client = new AgentLlmClient(fetchMock);
        const result = await client.complete(profile(), {
            messages: [{ role: 'user', content: 'read it' }],
            tools: [{
                type: 'function',
                function: {
                    name: 'host_read_file',
                    description: 'Read a file',
                    parameters: { type: 'object' },
                },
            }],
            signal: new AbortController().signal,
        });

        expect(result.message.toolCalls).toEqual([{
            id: 'call-1',
            name: 'host_read_file',
            arguments: '{"path":"a.txt"}',
        }]);
        expect(fetchMock).toHaveBeenCalledWith('http://localhost:1234/v1/chat/completions', expect.objectContaining({
            method: 'POST',
            headers: expect.objectContaining({ Authorization: 'Bearer secret' }),
        }));
        const body = JSON.parse(String((fetchMock as any).mock.calls[0][1].body));
        expect(body).toMatchObject({ model: 'test', stream: false, tool_choice: 'auto' });
    });

    it('rejects duplicate tool call ids at the provider boundary', async () => {
        const call = { id: 'duplicate', type: 'function', function: { name: 'host_read_file', arguments: '{}' } };
        const fetchMock = vi.fn(async () => new Response(JSON.stringify({
            choices: [{ finish_reason: 'tool_calls', message: { role: 'assistant', content: null, tool_calls: [call, call] } }],
        }), { status: 200 })) as unknown as typeof fetch;
        const client = new AgentLlmClient(fetchMock);
        await expect(client.complete(profile(), {
            messages: [{ role: 'user', content: 'test' }],
            tools: [],
            signal: new AbortController().signal,
        })).rejects.toThrow(/invalid tool call/);
    });

    it('does not start a request when the run is already cancelled', async () => {
        const fetchMock = vi.fn() as unknown as typeof fetch;
        const controller = new AbortController();
        controller.abort(new Error('cancelled'));
        const client = new AgentLlmClient(fetchMock);
        await expect(client.complete(profile(), {
            messages: [{ role: 'user', content: 'test' }],
            tools: [],
            signal: controller.signal,
        })).rejects.toThrow('cancelled');
        expect(fetchMock).not.toHaveBeenCalled();
    });

    it('does not impose an Authority request or assistant-content quota', async () => {
        const fetchMock = vi.fn(async () => new Response(JSON.stringify({
            choices: [{
                finish_reason: 'stop',
                message: { role: 'assistant', content: 'x'.repeat(256 * 1024 + 1) },
            }],
        }), { status: 200 })) as unknown as typeof fetch;
        const client = new AgentLlmClient(fetchMock);

        await expect(client.complete(profile(), {
            messages: [{ role: 'user', content: 'x'.repeat(8 * 1024 * 1024) }],
            tools: [],
            signal: new AbortController().signal,
        })).resolves.toMatchObject({ message: { content: expect.stringMatching(/^x+$/) } });
        expect(fetchMock).toHaveBeenCalledOnce();
    });

    it('preserves large tool arguments and provider usage metadata', async () => {
        const calls = Array.from({ length: 9 }, (_, index) => ({
            id: `call-${index}`,
            type: 'function',
            function: { name: 'host_read_file', arguments: 'x'.repeat(128 * 1024) },
        }));
        const responses = [
            new Response(JSON.stringify({
                choices: [{ finish_reason: 'tool_calls', message: { role: 'assistant', content: null, tool_calls: calls } }],
            }), { status: 200 }),
            new Response(JSON.stringify({
                choices: [{ finish_reason: 'stop', message: { role: 'assistant', content: 'done' } }],
                usage: { provider_blob: 'x'.repeat(20 * 1024) },
            }), { status: 200 }),
        ];
        const client = new AgentLlmClient(vi.fn(async () => responses.shift()!) as unknown as typeof fetch);
        const request = {
            messages: [{ role: 'user' as const, content: 'test' }],
            tools: [],
            signal: new AbortController().signal,
        };

        await expect(client.complete(profile(), request)).resolves.toMatchObject({ message: { toolCalls: expect.any(Array) } });
        await expect(client.complete(profile(), request)).resolves.toMatchObject({
            usage: { provider_blob: expect.stringMatching(/^x+$/) },
        });
    });
});

function profile(): StoredAgentLlmProfile {
    return {
        id: 'profile',
        displayName: 'Profile',
        provider: 'openai-compatible',
        baseUrl: 'http://localhost:1234/v1',
        model: 'test',
        apiKey: 'secret',
        apiKeyConfigured: true,
        apiKeyMasked: '********',
        apiKeyFingerprint: 'abc',
        temperature: null,
        contextWindowTokens: 128_000,
        maxOutputTokens: null,
        timeoutMs: 1_000,
        createdAt: '2026-01-01T00:00:00.000Z',
        updatedAt: '2026-01-01T00:00:00.000Z',
    };
}

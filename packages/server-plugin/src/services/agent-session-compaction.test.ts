import { describe, expect, it } from 'vitest';
import {
    estimateRequestTokens,
    estimateTextTokens,
    nextCompactionRequestChunk,
    providerUsageTokens,
    type AgentCompactionPlan,
} from './agent-session-compaction.js';

describe('Agent session context compaction', () => {
    it('uses provider usage shapes and a Unicode-aware fallback estimate', () => {
        expect(providerUsageTokens({ total_tokens: 1234 })).toBe(1234);
        expect(providerUsageTokens({ inputTokens: 100, outputTokens: 25, cacheRead: 5 })).toBe(130);
        expect(estimateTextTokens('a'.repeat(400))).toBe(100);
        expect(estimateTextTokens('中文上下文')).toBe(5);
    });

    it('chunks an arbitrarily large compaction source by the configured model window', () => {
        const plan: AgentCompactionPlan = {
            runId: 'run',
            ref: 'main',
            profileId: 'profile',
            sourceLeafEntryId: 'leaf',
            sourceLastSequence: 1,
            firstKeptEntryId: null,
            retainedEntryIds: [],
            retainedMessages: [],
            sourceText: 'x'.repeat(100_000),
            tokensBefore: 25_000,
            contextWindowTokens: 2_000,
            maxOutputTokens: 400,
            summaryOutputTokens: 400,
            forced: false,
        };

        const chunk = nextCompactionRequestChunk(plan, 0);
        expect(chunk.consumedChars).toBeGreaterThan(0);
        expect(chunk.consumedChars).toBeLessThan(plan.sourceText.length);
        expect(estimateRequestTokens(chunk.messages, []))
            .toBeLessThanOrEqual(plan.contextWindowTokens - plan.summaryOutputTokens);
    });
});

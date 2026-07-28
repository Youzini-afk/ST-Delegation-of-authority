import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import type { AgentRunDetail } from '@stdo/shared-types';
import { AgentStoreService } from './agent-store-service.js';

const tempDirs: string[] = [];

afterEach(() => {
    for (const dir of tempDirs.splice(0)) {
        fs.rmSync(dir, { recursive: true, force: true });
    }
});

describe('AgentStoreService', () => {
    it('keeps LLM secrets private while preserving them across profile edits', () => {
        const store = createStore();
        const created = store.upsertProfile({
            id: 'main',
            displayName: 'Main',
            provider: 'openai-compatible',
            baseUrl: 'http://localhost:1234/v1/',
            model: 'test-model',
            apiKey: 'secret-api-key',
        });
        expect(created).not.toHaveProperty('apiKey');
        expect(created).toMatchObject({
            baseUrl: 'http://localhost:1234/v1',
            apiKeyConfigured: true,
            apiKeyMasked: 'sec…-key',
        });

        const updated = store.upsertProfile({
            id: 'main',
            displayName: 'Renamed',
            provider: 'openai-compatible',
            baseUrl: 'http://localhost:1234/v1',
            model: 'test-model',
        });
        expect(updated.apiKeyConfigured).toBe(true);
        expect(store.getProfileForRequest('main').apiKey).toBe('secret-api-key');
    });

    it('does not carry an LLM secret to a different origin or cleartext remote endpoint', () => {
        const store = createStore();
        store.upsertProfile({
            id: 'main',
            displayName: 'Main',
            provider: 'openai-compatible',
            baseUrl: 'https://api.example.com/v1',
            model: 'test-model',
            apiKey: 'secret-api-key',
        });

        expect(() => store.upsertProfile({
            id: 'main',
            displayName: 'Other',
            provider: 'openai-compatible',
            baseUrl: 'https://other.example/v1',
            model: 'test-model',
        })).toThrow(/apiKey must be supplied or explicitly cleared/);
        expect(() => store.upsertProfile({
            id: 'insecure',
            displayName: 'Insecure',
            provider: 'openai-compatible',
            baseUrl: 'http://api.example.com/v1',
            model: 'test-model',
        })).toThrow(/must use HTTPS/);

        store.upsertProfile({
            id: 'main',
            displayName: 'Other',
            provider: 'openai-compatible',
            baseUrl: 'https://other.example/v1',
            model: 'test-model',
            apiKey: '',
        });
        expect(store.getProfileForRequest('main').apiKey).toBeNull();
    });

    it('marks unfinished persisted runs interrupted on restart', () => {
        let tick = 0;
        const store = createStore(() => `2026-01-01T00:00:0${tick++}.000Z`);
        store.createRun(runDetail('run-1'));

        const interrupted = store.start();
        expect(interrupted).toMatchObject([{ id: 'run-1', status: 'interrupted' }]);
        expect(store.getRun('run-1')).toMatchObject({
            run: { status: 'interrupted' },
            approvals: [{ status: 'cancelled' }],
            invocations: [{ status: 'cancelled' }],
            events: [{ sequence: 1, type: 'run.interrupted' }],
        });
        expect(store.getRun('run-1').run).not.toHaveProperty('pendingApprovalId');
        expect(store.start()).toEqual([]);
    });

    it('marks a claimed tool outcome unknown after restart', () => {
        const store = createStore();
        const detail = runDetail('run-claimed');
        detail.run.status = 'running';
        detail.invocations[0]!.status = 'claimed';
        store.createRun(detail);

        store.start();

        expect(store.getRun('run-claimed').invocations[0]).toMatchObject({
            status: 'outcome_unknown',
            error: expect.stringContaining('side effects are unknown'),
        });
    });

    it('refuses to persist an oversized Agent run', () => {
        const store = createStore();
        const detail = runDetail('run-oversized');
        detail.messages.push({ role: 'user', content: 'x'.repeat(16 * 1024 * 1024) });

        expect(() => store.createRun(detail)).toThrow('exceeds the 16777216 byte limit');
        expect(() => store.getRun('run-oversized')).toThrow();
    });
});

function createStore(now?: () => string): AgentStoreService {
    const stateDir = fs.mkdtempSync(path.join(os.tmpdir(), 'authority-agent-store-'));
    tempDirs.push(stateDir);
    return new AgentStoreService(stateDir, now ? { now } : {});
}

function runDetail(id: string): AgentRunDetail {
    return {
        run: {
            id,
            callerUserHandle: 'alice',
            callerExtensionId: 'test',
            workspaceId: 'workspace',
            profileId: 'profile',
            goal: 'test',
            mode: 'ask',
            status: 'waiting_approval',
            allowedTools: ['host_write_file'],
            stepCount: 0,
            maxSteps: 4,
            createdAt: '2026-01-01T00:00:00.000Z',
            updatedAt: '2026-01-01T00:00:00.000Z',
            pendingApprovalId: 'approval-1',
        },
        messages: [],
        events: [],
        invocations: [{
            callId: 'call-1',
            runId: id,
            toolId: 'host_write_file',
            execution: 'host',
            arguments: { path: 'a.txt' },
            status: 'waiting_approval',
            createdAt: '2026-01-01T00:00:00.000Z',
            updatedAt: '2026-01-01T00:00:00.000Z',
            deadlineAt: '2026-01-01T00:05:00.000Z',
        }],
        approvals: [{
            id: 'approval-1',
            runId: id,
            callId: 'call-1',
            toolId: 'host_write_file',
            title: 'Write file',
            summary: 'Write a.txt',
            arguments: { path: 'a.txt' },
            riskLevel: 'medium',
            status: 'pending',
            createdAt: '2026-01-01T00:00:00.000Z',
            updatedAt: '2026-01-01T00:00:00.000Z',
        }],
    };
}

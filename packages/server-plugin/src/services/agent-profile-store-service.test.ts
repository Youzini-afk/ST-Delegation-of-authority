import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { AgentProfileStoreService } from './agent-profile-store-service.js';

const tempDirs: string[] = [];

afterEach(() => {
    for (const dir of tempDirs.splice(0)) {
        fs.rmSync(dir, { recursive: true, force: true });
    }
});

describe('AgentProfileStoreService', () => {
    it('keeps LLM secrets private and preserves them across edits and restart', () => {
        const { stateDir, store } = createStore();
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
        expect(new AgentProfileStoreService(stateDir).getProfileForRequest('main').apiKey).toBe('secret-api-key');
    });

    it('does not carry an LLM secret to another origin or a cleartext remote endpoint', () => {
        const { store } = createStore();
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

    it('persists deletion without touching historical run-first files', () => {
        const { stateDir, store } = createStore();
        const runsDir = path.join(stateDir, 'runs');
        const legacyRun = path.join(runsDir, 'legacy.json');
        fs.mkdirSync(runsDir);
        fs.writeFileSync(legacyRun, '{"format":"authority-agent-run/v1"}\n', 'utf8');
        store.upsertProfile({
            id: 'temporary',
            displayName: 'Temporary',
            provider: 'openai-compatible',
            baseUrl: 'http://localhost:1234/v1',
            model: 'test-model',
        });

        expect(store.deleteProfile('temporary')).toBe(true);
        expect(store.deleteProfile('temporary')).toBe(false);
        expect(new AgentProfileStoreService(stateDir).listProfiles()).toEqual([]);
        expect(fs.readFileSync(legacyRun, 'utf8')).toBe('{"format":"authority-agent-run/v1"}\n');
    });
});

function createStore(): { stateDir: string; store: AgentProfileStoreService } {
    const stateDir = fs.mkdtempSync(path.join(os.tmpdir(), 'authority-agent-profiles-'));
    tempDirs.push(stateDir);
    return { stateDir, store: new AgentProfileStoreService(stateDir) };
}

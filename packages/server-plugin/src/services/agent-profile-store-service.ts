import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import type { AgentLlmProfile, AgentLlmProfileInput } from '@stdo/shared-types';
import { atomicWriteJson, ensureDir } from '../utils.js';

const PROFILE_FORMAT = 'authority-agent-profiles/v1';
const SAFE_ID = /^[a-zA-Z0-9._-]+$/;

export interface StoredAgentLlmProfile extends AgentLlmProfile {
    apiKey: string | null;
}

interface StoredProfiles {
    format: typeof PROFILE_FORMAT;
    profiles: StoredAgentLlmProfile[];
}

export interface AgentProfileStoreServiceOptions {
    now?: () => string;
}

/**
 * Owns only the model profiles used by durable Agent Sessions.
 *
 * Historical run-first files may still exist beside profiles.json, but this
 * store deliberately neither discovers nor mutates them.
 */
export class AgentProfileStoreService {
    private readonly now: () => string;

    constructor(
        public readonly stateDir: string,
        options: AgentProfileStoreServiceOptions = {},
    ) {
        this.stateDir = path.resolve(stateDir);
        this.now = options.now ?? (() => new Date().toISOString());
    }

    upsertProfile(input: AgentLlmProfileInput): AgentLlmProfile {
        const profiles = this.readProfiles();
        const requestedId = input.id?.trim();
        if (requestedId !== undefined) {
            assertSafeId(requestedId, 'LLM profile id');
        }
        if (input.provider !== 'openai-compatible') {
            throw new Error('Only openai-compatible LLM profiles are supported');
        }
        const displayName = requiredText(input.displayName, 'LLM profile displayName', 100);
        const model = requiredText(input.model, 'LLM profile model', 200);
        const baseUrl = normalizeBaseUrl(input.baseUrl);
        const temperature = optionalNumber(input.temperature, 'LLM profile temperature', 0, 2);
        const maxOutputTokens = optionalInteger(input.maxOutputTokens, 'LLM profile maxOutputTokens', 1, 1_000_000);
        const timeoutMs = optionalInteger(input.timeoutMs, 'LLM profile timeoutMs', 1_000, 600_000) ?? 120_000;
        const existing = requestedId ? profiles.profiles.find(profile => profile.id === requestedId) : undefined;
        if (existing && input.apiKey === undefined && new URL(existing.baseUrl).origin !== new URL(baseUrl).origin) {
            throw new Error('LLM profile apiKey must be supplied or explicitly cleared when baseUrl origin changes');
        }
        const timestamp = this.now();
        const apiKey = input.apiKey === undefined
            ? existing?.apiKey ?? null
            : input.apiKey.trim() || null;
        const stored: StoredAgentLlmProfile = {
            id: existing?.id ?? requestedId ?? crypto.randomUUID(),
            displayName,
            provider: 'openai-compatible',
            baseUrl,
            model,
            apiKey,
            apiKeyConfigured: Boolean(apiKey),
            apiKeyMasked: maskSecret(apiKey),
            apiKeyFingerprint: fingerprintSecret(apiKey),
            temperature,
            maxOutputTokens,
            timeoutMs,
            createdAt: existing?.createdAt ?? timestamp,
            updatedAt: timestamp,
        };
        const index = profiles.profiles.findIndex(profile => profile.id === stored.id);
        if (index === -1) {
            profiles.profiles.push(stored);
        } else {
            profiles.profiles[index] = stored;
        }
        profiles.profiles.sort((left, right) => left.id.localeCompare(right.id));
        protectDirectory(this.stateDir);
        atomicWriteJson(this.profilesPath(), profiles);
        protectFile(this.profilesPath());
        return publicProfile(stored);
    }

    listProfiles(): AgentLlmProfile[] {
        return this.readProfiles().profiles.map(publicProfile);
    }

    getProfile(profileId: string): AgentLlmProfile {
        return publicProfile(this.getStoredProfile(profileId));
    }

    getProfileForRequest(profileId: string): Readonly<StoredAgentLlmProfile> {
        return structuredClone(this.getStoredProfile(profileId));
    }

    deleteProfile(profileId: string): boolean {
        assertSafeId(profileId, 'LLM profile id');
        const profiles = this.readProfiles();
        const next = profiles.profiles.filter(profile => profile.id !== profileId);
        if (next.length === profiles.profiles.length) {
            return false;
        }
        profiles.profiles = next;
        atomicWriteJson(this.profilesPath(), profiles);
        protectFile(this.profilesPath());
        return true;
    }

    private readProfiles(): StoredProfiles {
        if (!fs.existsSync(this.profilesPath())) {
            return { format: PROFILE_FORMAT, profiles: [] };
        }
        const value = readJson<StoredProfiles>(this.profilesPath(), 'Agent LLM profiles');
        if (value.format !== PROFILE_FORMAT || !Array.isArray(value.profiles)) {
            throw new Error('Invalid Agent LLM profile store');
        }
        return value;
    }

    private getStoredProfile(profileId: string): StoredAgentLlmProfile {
        assertSafeId(profileId, 'LLM profile id');
        const profile = this.readProfiles().profiles.find(item => item.id === profileId);
        if (!profile) {
            throw new Error(`Agent LLM profile not found: ${profileId}`);
        }
        return profile;
    }

    private profilesPath(): string {
        return path.join(this.stateDir, 'profiles.json');
    }
}

function publicProfile(profile: StoredAgentLlmProfile): AgentLlmProfile {
    const { apiKey: _apiKey, ...value } = profile;
    return structuredClone(value);
}

function normalizeBaseUrl(value: string): string {
    const raw = requiredText(value, 'LLM profile baseUrl', 2_000);
    const url = new URL(raw);
    if ((url.protocol !== 'http:' && url.protocol !== 'https:') || url.username || url.password || url.search || url.hash) {
        throw new Error('LLM profile baseUrl must be an http(s) URL without credentials, query, or fragment');
    }
    if (url.protocol === 'http:' && !isLoopbackHostname(url.hostname)) {
        throw new Error('LLM profile baseUrl must use HTTPS unless it targets localhost or a loopback address');
    }
    return url.toString().replace(/\/$/, '');
}

function isLoopbackHostname(hostname: string): boolean {
    const normalized = hostname.toLowerCase();
    return normalized === 'localhost'
        || normalized.endsWith('.localhost')
        || normalized === '::1'
        || normalized === '[::1]'
        || /^127(?:\.\d{1,3}){3}$/.test(normalized);
}

function requiredText(value: unknown, label: string, maxLength: number): string {
    if (typeof value !== 'string' || !value.trim()) {
        throw new Error(`${label} is required`);
    }
    const result = value.trim();
    if (result.length > maxLength) {
        throw new Error(`${label} exceeds ${maxLength} characters`);
    }
    return result;
}

function optionalNumber(value: unknown, label: string, minimum: number, maximum: number): number | null {
    if (value === undefined || value === null) {
        return null;
    }
    if (typeof value !== 'number' || !Number.isFinite(value) || value < minimum || value > maximum) {
        throw new Error(`${label} must be between ${minimum} and ${maximum}`);
    }
    return value;
}

function optionalInteger(value: unknown, label: string, minimum: number, maximum: number): number | null {
    const result = optionalNumber(value, label, minimum, maximum);
    if (result !== null && !Number.isSafeInteger(result)) {
        throw new Error(`${label} must be an integer`);
    }
    return result;
}

function maskSecret(secret: string | null): string | null {
    if (!secret) {
        return null;
    }
    return secret.length <= 8 ? '********' : `${secret.slice(0, 3)}…${secret.slice(-4)}`;
}

function fingerprintSecret(secret: string | null): string | null {
    return secret ? crypto.createHash('sha256').update(secret).digest('hex').slice(0, 12) : null;
}

function assertSafeId(value: string, label: string): void {
    if (!value || value.length > 128 || !SAFE_ID.test(value) || value === '.' || value === '..') {
        throw new Error(`${label} contains invalid characters`);
    }
}

function readJson<T>(filePath: string, label: string): T {
    try {
        return JSON.parse(fs.readFileSync(filePath, 'utf8')) as T;
    } catch (error) {
        throw new Error(`Unable to read ${label}: ${error instanceof Error ? error.message : String(error)}`);
    }
}

function protectDirectory(dirPath: string): void {
    ensureDir(dirPath);
    if (process.platform !== 'win32') {
        fs.chmodSync(dirPath, 0o700);
    }
}

function protectFile(filePath: string): void {
    if (process.platform !== 'win32') {
        fs.chmodSync(filePath, 0o600);
    }
}

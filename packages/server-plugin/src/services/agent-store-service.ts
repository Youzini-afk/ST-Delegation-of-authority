import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import type {
    AgentLlmProfile,
    AgentLlmProfileInput,
    AgentRunDetail,
    AgentRunEvent,
    AgentRunPruneResponse,
    AgentRunRecord,
    AgentRunStatus,
} from '@stdo/shared-types';
import { atomicWriteFile, atomicWriteJson, ensureDir } from '../utils.js';

const PROFILE_FORMAT = 'authority-agent-profiles/v1';
const RUN_FORMAT = 'authority-agent-run/v1';
const SAFE_ID = /^[a-zA-Z0-9._-]+$/;
const ACTIVE_RUNS = new Set<AgentRunStatus>(['queued', 'running', 'waiting_approval', 'waiting_browser_tool']);
const TERMINAL_RUNS = new Set<AgentRunStatus>(['completed', 'failed', 'cancelled', 'interrupted']);
const MAX_STORED_RUN_BYTES = 16 * 1024 * 1024;
const MAX_RETAINED_TERMINAL_RUNS = 1_000;
const MAX_RETAINED_TERMINAL_BYTES = 512 * 1024 * 1024;

export interface StoredAgentLlmProfile extends AgentLlmProfile {
    apiKey: string | null;
}

interface StoredProfiles {
    format: typeof PROFILE_FORMAT;
    profiles: StoredAgentLlmProfile[];
}

interface StoredRun extends AgentRunDetail {
    format: typeof RUN_FORMAT;
}

export interface AgentStoreServiceOptions {
    now?: () => string;
}

export class AgentStoreService {
    private readonly now: () => string;
    private readonly runSummaries = new Map<string, AgentRunRecord>();
    private readonly runSizes = new Map<string, number>();
    private runIndexLoaded = false;

    constructor(
        public readonly stateDir: string,
        options: AgentStoreServiceOptions = {},
    ) {
        this.stateDir = path.resolve(stateDir);
        this.now = options.now ?? (() => new Date().toISOString());
    }

    start(): AgentRunRecord[] {
        protectDirectory(this.stateDir);
        protectDirectory(this.runsDir());
        const interrupted: AgentRunRecord[] = [];
        for (const summary of this.listRuns()) {
            if (!ACTIVE_RUNS.has(summary.status)) {
                continue;
            }
            const run = this.readRun(summary.id);
            const timestamp = this.now();
            run.run.status = 'interrupted';
            run.run.updatedAt = timestamp;
            run.run.finishedAt = timestamp;
            run.run.error = 'Agent host restarted before the run reached a terminal state';
            delete run.run.pendingApprovalId;
            for (const approval of run.approvals) {
                if (approval.status === 'pending') {
                    approval.status = 'cancelled';
                    approval.updatedAt = timestamp;
                    approval.resolvedAt = timestamp;
                }
            }
            for (const invocation of run.invocations) {
                if (invocation.status === 'pending' || invocation.status === 'waiting_approval') {
                    invocation.status = 'cancelled';
                    invocation.updatedAt = timestamp;
                    invocation.error = 'Agent host restarted';
                } else if (invocation.status === 'claimed') {
                    invocation.status = 'outcome_unknown';
                    invocation.updatedAt = timestamp;
                    invocation.error = 'Agent host restarted while the tool was executing; its side effects are unknown';
                }
            }
            run.events.push(this.event(run, 'run.interrupted', timestamp, { reason: run.run.error }));
            this.writeRun(run);
            interrupted.push(structuredClone(run.run));
        }
        this.pruneAutomatically();
        return interrupted;
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

    createRun(detail: AgentRunDetail): AgentRunDetail {
        assertSafeId(detail.run.id, 'Agent run id');
        const filePath = this.runPath(detail.run.id);
        if (fs.existsSync(filePath)) {
            throw new Error(`Agent run already exists: ${detail.run.id}`);
        }
        this.writeRun({ format: RUN_FORMAT, ...structuredClone(detail) });
        return structuredClone(detail);
    }

    getRun(runId: string): AgentRunDetail {
        const { format: _format, ...detail } = this.readRun(runId);
        return structuredClone(detail);
    }

    listRuns(): AgentRunRecord[] {
        this.loadRunIndex();
        return [...this.runSummaries.values()]
            .map(run => structuredClone(run))
            .sort(compareRunsNewestFirst);
    }

    updateRun(runId: string, update: (detail: AgentRunDetail) => void): AgentRunDetail {
        const stored = this.readRun(runId);
        update(stored);
        stored.run.updatedAt = this.now();
        this.writeRun(stored);
        const { format: _format, ...detail } = stored;
        return structuredClone(detail);
    }

    pruneTerminalRuns(
        retainLatest = MAX_RETAINED_TERMINAL_RUNS,
        protectedRunIds: Iterable<string> = [],
    ): AgentRunPruneResponse {
        if (!Number.isSafeInteger(retainLatest) || retainLatest < 0 || retainLatest > MAX_RETAINED_TERMINAL_RUNS) {
            throw new Error(`Agent retainLatest must be an integer between 0 and ${MAX_RETAINED_TERMINAL_RUNS}`);
        }
        this.loadRunIndex();
        const protectedIds = new Set(protectedRunIds);
        const activeRuns = [...this.runSummaries.values()].filter(run => ACTIVE_RUNS.has(run.status)).length;
        const terminalRuns = [...this.runSummaries.values()]
            .filter(run => TERMINAL_RUNS.has(run.status))
            .sort((left, right) => compareNewestFirst(left.updatedAt, left.id, right.updatedAt, right.id));
        let deletedRuns = 0;
        let reclaimedBytes = 0;
        let retainedBytes = 0;
        let retainedTerminalRuns = 0;

        for (const run of terminalRuns) {
            const size = this.runSizes.get(run.id) ?? fs.statSync(this.runPath(run.id)).size;
            if (protectedIds.has(run.id)
                || (retainedTerminalRuns < retainLatest && retainedBytes + size <= MAX_RETAINED_TERMINAL_BYTES)) {
                retainedTerminalRuns += 1;
                retainedBytes += size;
                continue;
            }
            fs.unlinkSync(this.runPath(run.id));
            this.runSummaries.delete(run.id);
            this.runSizes.delete(run.id);
            deletedRuns += 1;
            reclaimedBytes += size;
        }

        return { deletedRuns, reclaimedBytes, retainedTerminalRuns, activeRuns };
    }

    nowIso(): string {
        return this.now();
    }

    private event(run: StoredRun, type: AgentRunEvent['type'], timestamp: string, payload?: unknown): AgentRunEvent {
        return {
            sequence: (run.events.at(-1)?.sequence ?? 0) + 1,
            runId: run.run.id,
            type,
            timestamp,
            ...(payload === undefined ? {} : { payload }),
        };
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

    private loadRunIndex(): void {
        if (this.runIndexLoaded) {
            return;
        }
        ensureDir(this.runsDir());
        this.runSummaries.clear();
        this.runSizes.clear();
        for (const entry of fs.readdirSync(this.runsDir(), { withFileTypes: true })) {
            if (!entry.isFile() || !entry.name.endsWith('.json')) {
                continue;
            }
            try {
                const run = this.readRun(entry.name.slice(0, -5));
                this.runSummaries.set(run.run.id, structuredClone(run.run));
                this.runSizes.set(run.run.id, fs.statSync(this.runPath(run.run.id)).size);
            } catch (error) {
                console.warn(`[authority] Ignoring unreadable Agent run ${entry.name}: ${error instanceof Error ? error.message : String(error)}`);
            }
        }
        this.runIndexLoaded = true;
    }

    private readRun(runId: string): StoredRun {
        const filePath = this.runPath(runId);
        if (fs.statSync(filePath).size > MAX_STORED_RUN_BYTES) {
            throw new Error(`Agent run exceeds the ${MAX_STORED_RUN_BYTES} byte limit: ${runId}`);
        }
        const value = readJson<StoredRun>(filePath, `Agent run ${runId}`);
        if (value.format !== RUN_FORMAT || value.run?.id !== runId || !Array.isArray(value.events)) {
            throw new Error(`Invalid Agent run: ${runId}`);
        }
        return value;
    }

    private writeRun(run: StoredRun): void {
        protectDirectory(this.runsDir());
        const serialized = `${JSON.stringify(run, null, 2)}\n`;
        if (Buffer.byteLength(serialized, 'utf8') > MAX_STORED_RUN_BYTES) {
            throw new Error(`Agent run exceeds the ${MAX_STORED_RUN_BYTES} byte limit: ${run.run.id}`);
        }
        atomicWriteFile(this.runPath(run.run.id), serialized);
        protectFile(this.runPath(run.run.id));
        this.runSummaries.set(run.run.id, structuredClone(run.run));
        this.runSizes.set(run.run.id, Buffer.byteLength(serialized, 'utf8'));
    }

    private pruneAutomatically(): void {
        try {
            this.pruneTerminalRuns();
        } catch (error) {
            console.warn(`[authority] Unable to prune terminal Agent runs: ${error instanceof Error ? error.message : String(error)}`);
        }
    }

    private profilesPath(): string {
        return path.join(this.stateDir, 'profiles.json');
    }

    private runsDir(): string {
        return path.join(this.stateDir, 'runs');
    }

    private runPath(runId: string): string {
        assertSafeId(runId, 'Agent run id');
        return path.join(this.runsDir(), `${runId}.json`);
    }
}

function compareRunsNewestFirst(left: AgentRunRecord, right: AgentRunRecord): number {
    return compareNewestFirst(left.createdAt, left.id, right.createdAt, right.id);
}

function compareNewestFirst(leftTime: string, leftId: string, rightTime: string, rightId: string): number {
    if (leftTime !== rightTime) return leftTime > rightTime ? -1 : 1;
    if (leftId !== rightId) return leftId > rightId ? -1 : 1;
    return 0;
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

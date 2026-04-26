import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { AuthorityFeatureFlags, AuthorityProbeResponse } from '@stdo/shared-types';

const authorityRequestMock = vi.hoisted(() => vi.fn());

vi.mock('./api.js', () => ({
    authorityRequest: authorityRequestMock,
    buildEventStreamUrl: vi.fn(() => 'http://localhost/events'),
    hostnameFromUrl: vi.fn(() => 'example.com'),
    isInvalidSessionError: vi.fn(() => false),
}));

vi.mock('./permission-prompt.js', () => ({
    showPermissionPrompt: vi.fn(),
}));

vi.mock('./security-center.js', () => ({
    openSecurityCenter: vi.fn(),
}));

describe('AuthorityClient', () => {
    beforeEach(() => {
        authorityRequestMock.mockReset();
    });

    it('caches probe responses and exposes feature checks', async () => {
        const { AuthorityClient } = await import('./client.js');
        authorityRequestMock.mockResolvedValue(buildProbe());

        const client = new AuthorityClient({
            extensionId: 'third-party/ext-a',
            displayName: 'Ext A',
            version: '0.1.0',
            installType: 'local',
            declaredPermissions: {},
        });

        const probe = await client.probe();
        expect(probe.features.trivium.queryPage).toBe(true);
        expect(client.hasFeature('trivium.queryPage')).toBe(true);
        expect(await client.probe()).toEqual(probe);
        expect(authorityRequestMock).toHaveBeenCalledTimes(1);
    });

    it('rejects page-aware Trivium calls when probe reports unsupported feature', async () => {
        const { AuthorityClient } = await import('./client.js');
        authorityRequestMock.mockResolvedValue(buildProbe({ queryPage: false }));

        const client = new AuthorityClient({
            extensionId: 'third-party/ext-a',
            displayName: 'Ext A',
            version: '0.1.0',
            installType: 'local',
            declaredPermissions: {},
        });

        await expect(client.trivium.queryPage({ cypher: 'MATCH (n) RETURN n' })).rejects.toThrow('Authority 当前版本尚未提供 Trivium 图查询分页能力');
        expect(authorityRequestMock).toHaveBeenCalledWith('/probe', { method: 'POST' });
    });
});

function buildProbe(overrides: Partial<AuthorityFeatureFlags['trivium']> = {}): AuthorityProbeResponse {
    return {
        id: 'authority',
        online: true,
        version: '0.1.0',
        pluginId: 'authority',
        sdkExtensionId: 'third-party/st-authority-sdk',
        pluginVersion: '0.1.0',
        sdkBundledVersion: '0.1.0',
        sdkDeployedVersion: '0.1.0',
        coreBundledVersion: '0.1.0',
        coreArtifactPlatform: 'win32-x64',
        coreArtifactPlatforms: ['win32-x64'],
        coreArtifactHash: 'hash',
        coreBinarySha256: 'sha256',
        coreVerified: true,
        coreMessage: null,
        installStatus: 'ready',
        installMessage: 'ready',
        storageRoot: 'C:/authority/storage',
        features: {
            securityCenter: true,
            admin: false,
            sql: {
                queryPage: true,
                migrations: true,
            },
            trivium: {
                resolveId: true,
                upsert: true,
                bulkMutations: true,
                filterWherePage: true,
                queryPage: true,
                ...overrides,
            },
            transfers: {
                blob: true,
                fs: true,
                httpFetch: true,
            },
            jobs: {
                background: true,
                builtinTypes: ['delay', 'sql.backup', 'trivium.flush', 'fs.import-jsonl'],
            },
            diagnostics: {
                warnings: true,
                activityPages: true,
                jobsPage: true,
                benchmarkCore: true,
            },
        },
        limits: {
            maxRequestBytes: 1024,
            maxKvValueBytes: 1024,
            maxBlobBytes: 1024,
            maxHttpBodyBytes: 1024,
            maxHttpResponseBytes: 1024,
            maxEventPollLimit: 100,
            maxDataTransferBytes: 1024,
            dataTransferChunkBytes: 256,
            dataTransferInlineThresholdBytes: 256,
        },
        jobs: {
            builtinTypes: ['delay', 'sql.backup', 'trivium.flush', 'fs.import-jsonl'],
            registry: {
                registered: 4,
                jobTypes: ['delay', 'sql.backup', 'trivium.flush', 'fs.import-jsonl'],
            },
        },
        core: {
            enabled: true,
            state: 'running',
            port: 1234,
            pid: 1,
            version: '0.1.0',
            startedAt: new Date().toISOString(),
            lastError: null,
            health: {
                name: 'authority-core',
                apiVersion: 'authority-core/v1',
                version: '0.1.0',
                buildHash: null,
                platform: 'win32-x64',
                pid: 1,
                startedAt: new Date().toISOString(),
                uptimeMs: 10,
                requestCount: 1,
                errorCount: 0,
                activeJobCount: 0,
                queuedJobCount: 0,
                queuedRequestCount: 0,
                runtimeMode: 'managed',
                maxConcurrency: 4,
                currentConcurrency: 0,
                workerCount: 4,
                lastError: null,
                jobRegistrySummary: {
                    registered: 4,
                    jobTypes: ['delay', 'sql.backup', 'trivium.flush', 'fs.import-jsonl'],
                },
                timeoutMs: 5000,
                limits: {
                    maxRequestBytes: 1024,
                    maxKvValueBytes: 1024,
                    maxBlobBytes: 1024,
                    maxHttpBodyBytes: 1024,
                    maxHttpResponseBytes: 1024,
                    maxEventPollLimit: 100,
                },
            },
        },
    };
}

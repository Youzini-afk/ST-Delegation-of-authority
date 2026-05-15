import { describe, expect, it } from 'vitest';
import { AUTHORITY_VERSION } from '../version.js';
import { SessionService } from './session-service.js';
import type { CoreService } from './core-service.js';
import type { SessionRecord } from '../types.js';

describe('SessionService', () => {
    it('builds nested Authority feature flags into session responses', () => {
        const service = new SessionService({} as CoreService);
        const session: SessionRecord = {
            token: 'session-token',
            createdAt: new Date().toISOString(),
            userHandle: 'alice',
            isAdmin: true,
            extension: {
                id: 'third-party/ext-a',
                installType: 'local',
                displayName: 'Ext A',
                version: AUTHORITY_VERSION,
                firstSeenAt: new Date().toISOString(),
            },
            declaredPermissions: {},
            sessionGrants: new Map(),
        };

        const response = service.buildSessionResponse(session, [], [], {
            effectiveInlineThresholdBytes: {
                storageBlobWrite: { bytes: 256 * 1024, source: 'runtime' },
                storageBlobRead: { bytes: 256 * 1024, source: 'runtime' },
                privateFileWrite: { bytes: 256 * 1024, source: 'runtime' },
                privateFileRead: { bytes: 256 * 1024, source: 'runtime' },
                httpFetchRequest: { bytes: 256 * 1024, source: 'runtime' },
                httpFetchResponse: { bytes: 256 * 1024, source: 'runtime' },
            },
            effectiveTransferMaxBytes: {
                storageBlobWrite: { bytes: Number.MAX_SAFE_INTEGER, source: 'runtime' },
                storageBlobRead: { bytes: Number.MAX_SAFE_INTEGER, source: 'runtime' },
                privateFileWrite: { bytes: Number.MAX_SAFE_INTEGER, source: 'runtime' },
                privateFileRead: { bytes: Number.MAX_SAFE_INTEGER, source: 'runtime' },
                httpFetchRequest: { bytes: Number.MAX_SAFE_INTEGER, source: 'runtime' },
                httpFetchResponse: { bytes: Number.MAX_SAFE_INTEGER, source: 'runtime' },
            },
        });

        expect(response.features.admin).toBe(true);
        expect(response.features.sql.queryPage).toBe(true);
        expect(response.features.sql.stat).toBe(true);
        expect(response.features.sql.schemaManifest).toBe(true);
        expect(response.features.trivium.tql).toBe(true);
        expect(response.features.trivium.tqlMut).toBe(true);
        expect(response.features.trivium.propertyIndex).toBe(true);
        expect(response.features.trivium.searchContext).toBe(true);
        expect(response.features.trivium.resolveMany).toBe(true);
        expect(response.features.trivium.mappingPages).toBe(true);
        expect(response.features.trivium.mappingIntegrity).toBe(true);
        expect(response.features.jobs.safeRequeue).toBe(true);
        expect(response.features.jobs.builtinTypes).toEqual(['delay', 'sql.backup', 'trivium.flush', 'fs.import-jsonl']);
        expect(response.features.diagnostics.jobsPage).toBe(true);
        expect(response.features.bme.vectorManifest).toBe(true);
        expect(response.features.bme.vectorApply).toBe(true);
        expect(response.features.bme.serverEmbeddingProbe).toBe(false);
    });
});

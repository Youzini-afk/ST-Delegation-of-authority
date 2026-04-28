import fs from 'node:fs';
import path from 'node:path';
import type {
    ControlTriviumBulkDeleteRequest,
    ControlTriviumBulkLinkRequest,
    ControlTriviumBulkUnlinkRequest,
    ControlTriviumBulkUpsertRequest,
    ControlTriviumBulkUpsertResponse,
    TriviumBuildTextIndexRequest,
    TriviumBulkMutationResponse,
    TriviumCompactRequest,
    TriviumCreateIndexRequest,
    TriviumDeleteRequest,
    TriviumDropIndexRequest,
    TriviumFlushRequest,
    TriviumGetRequest,
    TriviumIndexKeywordRequest,
    TriviumIndexTextRequest,
    TriviumInsertRequest,
    TriviumInsertResponse,
    TriviumInsertWithIdRequest,
    TriviumNeighborsRequest,
    TriviumNeighborsResponse,
    TriviumNodeView,
    TriviumSearchAdvancedRequest,
    TriviumSearchHit,
    TriviumSearchHybridRequest,
    TriviumSearchHybridWithContextRequest,
    TriviumSearchHybridWithContextResponse,
    TriviumSearchRequest,
    TriviumStatRequest,
    TriviumStatResponse,
    TriviumTqlMutRequest,
    TriviumTqlMutResponse,
    TriviumTqlRequest,
    TriviumTqlResponse,
    TriviumUpdatePayloadRequest,
} from '@stdo/shared-types';
import { getUserAuthorityPaths } from '../store/authority-paths.js';
import type { UserContext } from '../types.js';
import { sanitizeFileSegment } from '../utils.js';
import { CoreService } from './core-service.js';
import type { TriviumDatabaseEntry, TriviumPathSet } from './trivium-internal.js';

export class TriviumRepository {
    constructor(private readonly core: CoreService) {}

    listDatabaseEntries(user: UserContext, extensionId: string): TriviumDatabaseEntry[] {
        const directory = this.getDatabaseDirectory(user, extensionId);
        if (!fs.existsSync(directory)) {
            return [];
        }
        return fs.readdirSync(directory, { withFileTypes: true })
            .filter(entry => entry.isFile() && entry.name.endsWith('.tdb'))
            .map(entry => {
                const database = entry.name.slice(0, -'.tdb'.length);
                const paths = this.resolvePaths(user, extensionId, database);
                return {
                    database,
                    entryName: entry.name,
                    ...paths,
                };
            });
    }

    resolvePaths(user: UserContext, extensionId: string, database: string): TriviumPathSet {
        const directory = this.getDatabaseDirectory(user, extensionId);
        return {
            dbPath: path.join(directory, `${sanitizeFileSegment(database)}.tdb`),
            mappingDbPath: path.join(directory, '__mapping__', `${sanitizeFileSegment(database)}.sqlite`),
        };
    }

    getMappingDbPath(user: UserContext, extensionId: string, database: string): string {
        return this.resolvePaths(user, extensionId, database).mappingDbPath;
    }

    async insert(dbPath: string, request: TriviumInsertRequest): Promise<TriviumInsertResponse> {
        return await this.core.insertTrivium(dbPath, request);
    }

    async insertWithId(dbPath: string, request: TriviumInsertWithIdRequest): Promise<void> {
        await this.core.insertTriviumWithId(dbPath, request);
    }

    async updatePayload(dbPath: string, request: TriviumUpdatePayloadRequest): Promise<void> {
        await this.core.updateTriviumPayload(dbPath, request);
    }

    async indexText(dbPath: string, request: TriviumIndexTextRequest): Promise<void> {
        await this.core.indexTextTrivium(dbPath, request);
    }

    async indexKeyword(dbPath: string, request: TriviumIndexKeywordRequest): Promise<void> {
        await this.core.indexKeywordTrivium(dbPath, request);
    }

    async buildTextIndex(dbPath: string, request: TriviumBuildTextIndexRequest = {}): Promise<void> {
        await this.core.buildTextIndexTrivium(dbPath, request);
    }

    async compact(dbPath: string, request: TriviumCompactRequest = {}): Promise<void> {
        await this.core.compactTrivium(dbPath, request);
    }

    async bulkUpsert(dbPath: string, request: ControlTriviumBulkUpsertRequest): Promise<ControlTriviumBulkUpsertResponse> {
        return await this.core.bulkUpsertTrivium(dbPath, request);
    }

    async bulkLink(dbPath: string, request: ControlTriviumBulkLinkRequest): Promise<TriviumBulkMutationResponse> {
        return await this.core.bulkLinkTrivium(dbPath, request);
    }

    async bulkUnlink(dbPath: string, request: ControlTriviumBulkUnlinkRequest): Promise<TriviumBulkMutationResponse> {
        return await this.core.bulkUnlinkTrivium(dbPath, request);
    }

    async bulkDelete(dbPath: string, request: ControlTriviumBulkDeleteRequest): Promise<TriviumBulkMutationResponse> {
        return await this.core.bulkDeleteTrivium(dbPath, request);
    }

    async delete(dbPath: string, request: TriviumDeleteRequest): Promise<void> {
        await this.core.deleteTrivium(dbPath, request);
    }

    async get(dbPath: string, request: TriviumGetRequest): Promise<TriviumNodeView | null> {
        return await this.core.getTrivium(dbPath, request);
    }

    async neighbors(dbPath: string, request: TriviumNeighborsRequest): Promise<TriviumNeighborsResponse> {
        return await this.core.neighborsTrivium(dbPath, request);
    }

    async search(dbPath: string, request: TriviumSearchRequest): Promise<TriviumSearchHit[]> {
        return await this.core.searchTrivium(dbPath, request);
    }

    async searchAdvanced(dbPath: string, request: TriviumSearchAdvancedRequest): Promise<TriviumSearchHit[]> {
        return await this.core.searchAdvancedTrivium(dbPath, request);
    }

    async searchHybrid(dbPath: string, request: TriviumSearchHybridRequest): Promise<TriviumSearchHit[]> {
        return await this.core.searchHybridTrivium(dbPath, request);
    }

    async searchHybridWithContext(
        dbPath: string,
        request: TriviumSearchHybridWithContextRequest,
    ): Promise<TriviumSearchHybridWithContextResponse> {
        return await this.core.searchHybridWithContextTrivium(dbPath, request);
    }

    async tqlPage(dbPath: string, request: TriviumTqlRequest): Promise<TriviumTqlResponse> {
        return await this.core.tqlTriviumPage(dbPath, request);
    }

    async tqlMut(dbPath: string, request: TriviumTqlMutRequest): Promise<TriviumTqlMutResponse> {
        return await this.core.tqlMutTrivium(dbPath, request);
    }

    async createIndex(dbPath: string, request: TriviumCreateIndexRequest): Promise<void> {
        await this.core.createIndexTrivium(dbPath, request);
    }

    async dropIndex(dbPath: string, request: TriviumDropIndexRequest): Promise<void> {
        await this.core.dropIndexTrivium(dbPath, request);
    }

    async flush(dbPath: string, request: TriviumFlushRequest = {}): Promise<void> {
        await this.core.flushTrivium(dbPath, request);
    }

    async stat(dbPath: string, request: TriviumStatRequest = {}): Promise<TriviumStatResponse> {
        return await this.core.statTrivium(dbPath, request);
    }

    private getDatabaseDirectory(user: UserContext, extensionId: string): string {
        const paths = getUserAuthorityPaths(user);
        return path.join(paths.triviumPrivateDir, sanitizeFileSegment(extensionId));
    }
}

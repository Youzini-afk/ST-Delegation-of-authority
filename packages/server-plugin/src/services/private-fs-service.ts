import fs from 'node:fs';
import path from 'node:path';
import type {
    ControlPrivateFileOpenReadResponse,
    PrivateFileDeleteRequest,
    PrivateFileEntry,
    PrivateFileMkdirRequest,
    PrivateFileReadDirRequest,
    PrivateFileReadRequest,
    PrivateFileReadResponse,
    PrivateFileStatRequest,
    PrivateFileUsageSummary,
    PrivateFileWriteRequest,
} from '@stdo/shared-types';
import { getUserAuthorityPaths } from '../store/authority-paths.js';
import type { UserContext } from '../types.js';
import { resolveContainedPath, sanitizeFileSegment } from '../utils.js';
import { CoreService } from './core-service.js';

export class PrivateFsService {
    constructor(private readonly core: CoreService) {}

    async mkdir(user: UserContext, extensionId: string, request: PrivateFileMkdirRequest): Promise<PrivateFileEntry> {
        return await this.core.mkdirPrivateFile({
            rootDir: this.getRootDir(user, extensionId),
            ...request,
        });
    }

    async readDir(user: UserContext, extensionId: string, request: PrivateFileReadDirRequest): Promise<PrivateFileEntry[]> {
        const rootDir = this.getRootDir(user, extensionId);
        if (isRootPath(request.path) && !fs.existsSync(rootDir)) {
            return [];
        }

        return await this.core.readPrivateDir({
            rootDir,
            ...request,
        });
    }

    async writeFile(user: UserContext, extensionId: string, request: PrivateFileWriteRequest): Promise<PrivateFileEntry> {
        return await this.core.writePrivateFile({
            rootDir: this.getRootDir(user, extensionId),
            ...request,
        });
    }

    async writeFileFromSource(user: UserContext, extensionId: string, request: Omit<PrivateFileWriteRequest, 'content' | 'encoding'> & { sourcePath: string }): Promise<PrivateFileEntry> {
        return await this.core.writePrivateFile({
            rootDir: this.getRootDir(user, extensionId),
            path: request.path,
            content: '',
            sourcePath: request.sourcePath,
            ...(request.createParents === undefined ? {} : { createParents: request.createParents }),
        });
    }

    async readFile(user: UserContext, extensionId: string, request: PrivateFileReadRequest): Promise<PrivateFileReadResponse> {
        return await this.core.readPrivateFile({
            rootDir: this.getRootDir(user, extensionId),
            ...request,
        });
    }

    async openRead(user: UserContext, extensionId: string, request: PrivateFileReadRequest): Promise<ControlPrivateFileOpenReadResponse> {
        return await this.core.openPrivateFileRead({
            rootDir: this.getRootDir(user, extensionId),
            ...request,
        });
    }

    async delete(user: UserContext, extensionId: string, request: PrivateFileDeleteRequest): Promise<void> {
        await this.core.deletePrivateFile({
            rootDir: this.getRootDir(user, extensionId),
            ...request,
        });
    }

    async stat(user: UserContext, extensionId: string, request: PrivateFileStatRequest): Promise<PrivateFileEntry> {
        return await this.core.statPrivateFile({
            rootDir: this.getRootDir(user, extensionId),
            ...request,
        });
    }

    async getUsageSummary(user: UserContext, extensionId: string): Promise<PrivateFileUsageSummary> {
        const rootDir = this.getRootDir(user, extensionId);
        if (!fs.existsSync(rootDir)) {
            return emptyUsageSummary();
        }

        try {
            const rootStats = fs.lstatSync(rootDir);
            if (rootStats.isSymbolicLink() || !rootStats.isDirectory()) {
                return emptyUsageSummary();
            }
        } catch {
            return emptyUsageSummary();
        }

        let fileCount = 0;
        let directoryCount = 0;
        let totalSizeBytes = 0;
        let latestUpdatedAtMs = 0;
        const stack = [rootDir];

        while (stack.length > 0) {
            const currentDir = stack.pop() as string;
            let entries: fs.Dirent[];
            try {
                entries = fs.readdirSync(currentDir, { withFileTypes: true });
            } catch {
                continue;
            }

            for (const entry of entries) {
                const fullPath = path.join(currentDir, entry.name);
                let stats: fs.Stats;
                try {
                    stats = fs.lstatSync(fullPath);
                } catch {
                    continue;
                }
                if (stats.isSymbolicLink()) {
                    continue;
                }
                latestUpdatedAtMs = Math.max(latestUpdatedAtMs, stats.mtimeMs);

                if (entry.isDirectory()) {
                    directoryCount += 1;
                    stack.push(fullPath);
                    continue;
                }

                if (entry.isFile()) {
                    fileCount += 1;
                    totalSizeBytes += stats.size;
                }
            }
        }

        return {
            fileCount,
            directoryCount,
            totalSizeBytes,
            latestUpdatedAt: latestUpdatedAtMs > 0 ? new Date(latestUpdatedAtMs).toISOString() : null,
        };
    }

    private getRootDir(user: UserContext, extensionId: string): string {
        const paths = getUserAuthorityPaths(user);
        return resolveContainedPath(paths.filesDir, sanitizeFileSegment(extensionId));
    }
}

function isRootPath(value: string): boolean {
    const trimmed = value.trim();
    return trimmed === '' || trimmed === '/' || trimmed === '.';
}

function emptyUsageSummary(): PrivateFileUsageSummary {
    return {
        fileCount: 0,
        directoryCount: 0,
        totalSizeBytes: 0,
        latestUpdatedAt: null,
    };
}

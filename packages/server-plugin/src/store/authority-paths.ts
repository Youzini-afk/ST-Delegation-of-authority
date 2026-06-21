import path from 'node:path';
import { AUTHORITY_DATA_FOLDER } from '../constants.js';
import type { UserContext } from '../types.js';
import { resolveContainedPath, resolveRuntimePath, sanitizeFileSegment } from '../utils.js';

export interface UserAuthorityPaths {
    sqlPrivateDir: string;
    triviumPrivateDir: string;
    kvDir: string;
    blobDir: string;
    filesDir: string;
    controlDbFile: string;
}

export interface GlobalAuthorityPaths {
    controlDbFile: string;
}

export function getUserAuthorityPaths(user: UserContext): UserAuthorityPaths {
    const baseDir = path.join(user.rootDir, AUTHORITY_DATA_FOLDER);
    const stateDir = path.join(baseDir, 'state');
    const storageDir = path.join(baseDir, 'storage');
    const sqlDir = path.join(baseDir, 'sql');
    const triviumDir = path.join(storageDir, 'trivium');

    return {
        sqlPrivateDir: path.join(sqlDir, 'private'),
        triviumPrivateDir: path.join(triviumDir, 'private'),
        kvDir: path.join(storageDir, 'kv'),
        blobDir: path.join(storageDir, 'blobs'),
        filesDir: path.join(storageDir, 'files'),
        controlDbFile: path.join(stateDir, 'control.sqlite'),
    };
}

/**
 * Resolve the directory that holds a given extension's private SQLite
 * database files. The directory is rooted under the user's
 * `sqlPrivateDir` and scoped to the supplied extension id so two
 * extensions cannot read or write each other's databases.
 *
 * Used by both the SQL routes (`/sql/*`) and the Phase A companion
 * `ctx.sql` capability wrapper so the wrapper never accepts a raw
 * filesystem path from companion code: it always derives the dbPath
 * from the companion module's owner extension id.
 */
export function resolvePrivateSqlDatabaseDir(user: UserContext, extensionId: string): string {
    return resolveContainedPath(getUserAuthorityPaths(user).sqlPrivateDir, sanitizeFileSegment(extensionId));
}

/**
 * Resolve the absolute filesystem path to a private SQLite database
 * owned by `extensionId`. The database name is sanitized to a safe
 * filename segment and the resulting path is verified to stay inside
 * the extension's private SQL directory, preventing traversal outside
 * the per-extension sandbox.
 */
export function resolvePrivateSqlDatabasePath(user: UserContext, extensionId: string, databaseName: string): string {
    return resolveContainedPath(
        resolvePrivateSqlDatabaseDir(user, extensionId),
        `${sanitizeFileSegment(databaseName)}.sqlite`,
    );
}

export function getGlobalAuthorityPaths(): GlobalAuthorityPaths {
    const globalState = globalThis as typeof globalThis & { DATA_ROOT?: string };
    const configuredDataRoot = typeof globalState.DATA_ROOT === 'string' && globalState.DATA_ROOT.trim()
        ? globalState.DATA_ROOT
        : 'data';
    const dataRoot = resolveRuntimePath(configuredDataRoot);
    const baseDir = path.join(dataRoot, '_authority-global', 'authority');
    const stateDir = path.join(baseDir, 'state');
    return {
        controlDbFile: path.join(stateDir, 'control.sqlite'),
    };
}

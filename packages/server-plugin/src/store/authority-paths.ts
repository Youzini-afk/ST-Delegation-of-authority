import path from 'node:path';
import { AUTHORITY_DATA_FOLDER } from '../constants.js';
import type { UserContext } from '../types.js';
import { resolveRuntimePath } from '../utils.js';

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

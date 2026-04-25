import path from 'node:path';
import { AUTHORITY_DATA_FOLDER } from '../constants.js';
import type { UserContext } from '../types.js';

export interface UserAuthorityPaths {
    baseDir: string;
    stateDir: string;
    auditDir: string;
    storageDir: string;
    sqlDir: string;
    sqlPrivateDir: string;
    kvDir: string;
    blobDir: string;
    jobsDir: string;
    extensionsFile: string;
    permissionsFile: string;
    policiesFile: string;
    jobsFile: string;
    controlDbFile: string;
    permissionsAuditFile: string;
    usageAuditFile: string;
    errorsAuditFile: string;
}

export interface GlobalAuthorityPaths {
    baseDir: string;
    stateDir: string;
    controlDbFile: string;
    policiesFile: string;
}

export function getUserAuthorityPaths(user: UserContext): UserAuthorityPaths {
    const baseDir = path.join(user.rootDir, AUTHORITY_DATA_FOLDER);
    const stateDir = path.join(baseDir, 'state');
    const auditDir = path.join(baseDir, 'audit');
    const storageDir = path.join(baseDir, 'storage');
    const sqlDir = path.join(baseDir, 'sql');
    const jobsDir = path.join(baseDir, 'jobs');

    return {
        baseDir,
        stateDir,
        auditDir,
        storageDir,
        sqlDir,
        sqlPrivateDir: path.join(sqlDir, 'private'),
        kvDir: path.join(storageDir, 'kv'),
        blobDir: path.join(storageDir, 'blobs'),
        jobsDir,
        extensionsFile: path.join(stateDir, 'extensions.json'),
        permissionsFile: path.join(stateDir, 'permissions.json'),
        policiesFile: path.join(stateDir, 'policies.json'),
        jobsFile: path.join(jobsDir, 'jobs.json'),
        controlDbFile: path.join(stateDir, 'control.sqlite'),
        permissionsAuditFile: path.join(auditDir, 'permissions.jsonl'),
        usageAuditFile: path.join(auditDir, 'usage.jsonl'),
        errorsAuditFile: path.join(auditDir, 'errors.jsonl'),
    };
}

export function getGlobalAuthorityPaths(): GlobalAuthorityPaths {
    const globalState = globalThis as typeof globalThis & { DATA_ROOT?: string };
    const dataRoot = String(globalState.DATA_ROOT ?? process.cwd());
    const baseDir = path.join(dataRoot, '_authority-global', 'authority');
    const stateDir = path.join(baseDir, 'state');
    return {
        baseDir,
        stateDir,
        controlDbFile: path.join(stateDir, 'control.sqlite'),
        policiesFile: path.join(stateDir, 'policies.json'),
    };
}

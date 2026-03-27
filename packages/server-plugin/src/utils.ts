import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import type { PermissionResource } from '@stdo/shared-types';
import { RESOURCE_RISK, SESSION_HEADER, SESSION_QUERY, SUPPORTED_RESOURCES } from './constants.js';
import type { AuthorityRequest, PermissionDescriptor, UserContext } from './types.js';

export function nowIso(): string {
    return new Date().toISOString();
}

export function randomToken(): string {
    return crypto.randomUUID();
}

export function safeJsonParse<T>(value: string, fallback: T): T {
    try {
        return JSON.parse(value) as T;
    } catch {
        return fallback;
    }
}

export function ensureDir(dirPath: string): void {
    fs.mkdirSync(dirPath, { recursive: true });
}

export function atomicWriteJson(filePath: string, value: unknown): void {
    ensureDir(path.dirname(filePath));
    const tempPath = `${filePath}.${crypto.randomUUID()}.tmp`;
    fs.writeFileSync(tempPath, JSON.stringify(value, null, 2), 'utf8');
    fs.renameSync(tempPath, filePath);
}

export function readJsonFile<T>(filePath: string, fallback: T): T {
    if (!fs.existsSync(filePath)) {
        return fallback;
    }

    return safeJsonParse(fs.readFileSync(filePath, 'utf8'), fallback);
}

export function appendJsonl(filePath: string, value: unknown): void {
    ensureDir(path.dirname(filePath));
    fs.appendFileSync(filePath, `${JSON.stringify(value)}\n`, 'utf8');
}

export function tailJsonl<T>(filePath: string, limit: number): T[] {
    if (!fs.existsSync(filePath)) {
        return [];
    }

    const lines = fs.readFileSync(filePath, 'utf8')
        .split(/\r?\n/)
        .filter(Boolean)
        .slice(-limit);

    return lines.map(line => safeJsonParse<T | null>(line, null)).filter(Boolean) as T[];
}

export function sanitizeFileSegment(input: string): string {
    return input.replace(/[^a-zA-Z0-9._-]/g, '_');
}

export function getUserContext(request: AuthorityRequest): UserContext {
    if (!request.user) {
        throw new Error('Unauthorized');
    }

    return {
        handle: request.user.profile.handle,
        isAdmin: Boolean(request.user.profile.admin),
        rootDir: request.user.directories.root,
    };
}

export function getSessionToken(request: AuthorityRequest): string | null {
    const headerValue = request.headers[SESSION_HEADER];
    if (typeof headerValue === 'string' && headerValue.trim()) {
        return headerValue.trim();
    }

    const queryValue = request.query?.[SESSION_QUERY];
    if (typeof queryValue === 'string' && queryValue.trim()) {
        return queryValue.trim();
    }

    return null;
}

export function normalizeHostname(input: string): string {
    const url = new URL(input);
    return url.hostname.toLowerCase();
}

export function buildPermissionDescriptor(resource: PermissionResource, target?: string): PermissionDescriptor {
    if (!SUPPORTED_RESOURCES.includes(resource)) {
        throw new Error(`Unsupported resource: ${resource}`);
    }

    const normalizedTarget = target && target.trim() ? target.trim() : '*';
    return {
        key: `${resource}:${normalizedTarget}`,
        resource,
        target: normalizedTarget,
        riskLevel: RESOURCE_RISK[resource],
    };
}

export function asErrorMessage(error: unknown): string {
    if (error instanceof Error) {
        return error.message;
    }

    return String(error);
}


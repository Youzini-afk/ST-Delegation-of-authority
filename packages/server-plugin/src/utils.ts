import crypto from 'node:crypto';
import fs from 'node:fs';
import net from 'node:net';
import path from 'node:path';
import type { AuthorityErrorCategory, AuthorityErrorCode, AuthorityErrorPayload, PermissionResource } from '@stdo/shared-types';
import { RESOURCE_RISK, SESSION_HEADER, SESSION_QUERY, SUPPORTED_RESOURCES } from './constants.js';
import type { AuthorityRequest, PermissionDescriptor, RequestUser, UserContext } from './types.js';

export class AuthorityServiceError extends Error {
    constructor(
        message: string,
        public readonly status: number,
        public readonly code: AuthorityErrorCode,
        public readonly category: AuthorityErrorCategory,
        public readonly details?: AuthorityErrorPayload['details'],
    ) {
        super(message);
        this.name = 'AuthorityServiceError';
    }

    toPayload(): AuthorityErrorPayload {
        return {
            error: this.message,
            code: this.code,
            category: this.category,
            ...(this.details === undefined ? {} : { details: this.details }),
        };
    }
}

export function isAuthorityServiceError(error: unknown): error is AuthorityServiceError {
    return error instanceof AuthorityServiceError;
}

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

export function sanitizeFileSegment(input: string): string {
    return input.replace(/[^a-zA-Z0-9._-]/g, '_');
}

export function resolveRuntimePath(value: string, baseDir = process.cwd()): string {
    return path.isAbsolute(value)
        ? path.normalize(value)
        : path.resolve(baseDir, value);
}

export function getUserContext(request: AuthorityRequest): UserContext {
    if (!request.user) {
        throw new AuthorityServiceError('Unauthorized', 401, 'unauthorized', 'auth');
    }

    const directories = resolveUserDirectories(request.user.directories);
    return {
        handle: request.user.profile.handle,
        isAdmin: Boolean(request.user.profile.admin),
        rootDir: directories.root,
        directories,
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
    return stripTrailingDot(url.hostname.toLowerCase());
}

export function normalizeHttpFetchTarget(input: string): string {
    const trimmed = input.trim();
    if (!trimmed) {
        return '*';
    }
    if (looksLikeAbsoluteUrl(trimmed)) {
        return normalizeHostname(trimmed);
    }
    return stripTrailingDot(trimmed.toLowerCase());
}

export function normalizePermissionTarget(resource: PermissionResource, target?: string): string {
    const trimmedTarget = typeof target === 'string' ? target.trim() : '';
    switch (resource) {
        case 'storage.kv':
        case 'storage.blob':
        case 'fs.private':
            return '*';
        case 'sql.private':
        case 'trivium.private':
            return trimmedTarget || 'default';
        case 'http.fetch':
            return normalizeHttpFetchTarget(trimmedTarget);
        case 'jobs.background':
        case 'events.stream':
            return trimmedTarget || '*';
        default:
            return trimmedTarget || '*';
    }
}

export function getHttpFetchNetworkClass(target: string): 'hostname' | 'public' | 'localhost' | 'loopback' | 'private' | 'link-local' | 'unspecified' | 'multicast' {
    const normalized = normalizeHttpFetchTarget(target);
    if (normalized === '*' || !normalized) {
        return 'hostname';
    }
    if (normalized === 'localhost' || normalized.endsWith('.localhost')) {
        return 'localhost';
    }

    const ipVersion = net.isIP(normalized);
    if (ipVersion === 4) {
        const octets = normalized.split('.').map(segment => Number(segment));
        const first = octets[0] ?? -1;
        const second = octets[1] ?? -1;
        if (first === 0) {
            return 'unspecified';
        }
        if (first === 127) {
            return 'loopback';
        }
        if (first === 10 || (first === 172 && second >= 16 && second <= 31) || (first === 192 && second === 168)) {
            return 'private';
        }
        if (first === 169 && second === 254) {
            return 'link-local';
        }
        if (first >= 224 && first <= 239) {
            return 'multicast';
        }
        return 'public';
    }

    if (ipVersion === 6) {
        const lowered = normalized.toLowerCase();
        if (lowered === '::') {
            return 'unspecified';
        }
        if (lowered === '::1') {
            return 'loopback';
        }
        if (lowered.startsWith('fe8:') || lowered.startsWith('fe9:') || lowered.startsWith('fea:') || lowered.startsWith('feb:')) {
            return 'link-local';
        }
        if (lowered.startsWith('fc') || lowered.startsWith('fd')) {
            return 'private';
        }
        if (lowered.startsWith('ff')) {
            return 'multicast';
        }
        return 'public';
    }

    return 'hostname';
}

export function isRestrictedHttpFetchTarget(target: string): boolean {
    return getHttpFetchNetworkClass(target) !== 'hostname' && getHttpFetchNetworkClass(target) !== 'public';
}

export function buildPermissionDescriptor(resource: PermissionResource, target?: string): PermissionDescriptor {
    if (!SUPPORTED_RESOURCES.includes(resource)) {
        throw new Error(`Unsupported resource: ${resource}`);
    }

    const normalizedTarget = normalizePermissionTarget(resource, target);
    return {
        key: `${resource}:${normalizedTarget}`,
        resource,
        target: normalizedTarget,
        riskLevel: resource === 'http.fetch' && isRestrictedHttpFetchTarget(normalizedTarget)
            ? 'high'
            : RESOURCE_RISK[resource],
    };
}

export function asErrorMessage(error: unknown): string {
    if (error instanceof Error) {
        return error.message;
    }

    return String(error);
}

function stripTrailingDot(value: string): string {
    return value.replace(/\.+$/, '');
}

function looksLikeAbsoluteUrl(value: string): boolean {
    return /^[a-zA-Z][a-zA-Z\d+.-]*:/.test(value);
}

function resolveUserDirectories(directories: RequestUser['directories']): RequestUser['directories'] {
    const resolved: RequestUser['directories'] = {
        root: resolveRuntimePath(directories.root),
    };

    for (const [key, value] of Object.entries(directories)) {
        if (key === 'root') {
            continue;
        }
        if (typeof value === 'string' && value.trim()) {
            resolved[key] = resolveRuntimePath(value);
        }
    }

    return resolved;
}

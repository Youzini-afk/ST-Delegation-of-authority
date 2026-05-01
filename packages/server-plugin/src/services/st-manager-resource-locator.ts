import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { AuthorityServiceError, ensureDir } from '../utils.js';
import type { UserContext } from '../types.js';

export const ST_MANAGER_RESOURCE_TYPES = ['characters', 'chats', 'worlds', 'presets', 'regex', 'quick_replies'] as const;
export type StManagerResourceType = typeof ST_MANAGER_RESOURCE_TYPES[number];

export interface StManagerResourceRoot {
    path: string;
    source: string;
    exists: boolean;
}

export interface StManagerManifestFile {
    relative_path: string;
    kind: 'file' | 'settings-regex-bundle';
    source: string;
    size: number;
    mtime: number;
    sha256: string;
}

export interface StManagerResourceManifest {
    resource_type: StManagerResourceType;
    root: string | null;
    files: StManagerManifestFile[];
}

export interface StManagerResourceRead {
    buffer: Buffer;
    size: number;
    mtime: number;
    sha256: string;
    source: string;
    kind: StManagerManifestFile['kind'];
}

const SETTINGS_REGEX_BUNDLE_PATH = 'settings.regex.json';
const REGEX_SETTINGS_KEYS = ['regex', 'regex_presets', 'character_allowed_regex', 'preset_allowed_regex'];

function sha256(buffer: Buffer): string {
    return crypto.createHash('sha256').update(buffer).digest('hex');
}

function isPathInside(base: string, candidate: string): boolean {
    const relative = path.relative(base, candidate);
    return relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative));
}

function normalizeResourcePath(relativePath: string): string {
    const value = String(relativePath || '').trim();
    if (!value || value.includes('\\') || path.isAbsolute(value) || path.win32.isAbsolute(value) || /^[a-zA-Z]:[\\/]/.test(value)) {
        throw new AuthorityServiceError('Invalid resource path', 400, 'validation_error', 'validation');
    }

    const normalized = path.posix.normalize(value.replace(/\/+/g, '/'));
    if (!normalized || normalized === '.' || normalized.startsWith('../') || normalized === '..') {
        throw new AuthorityServiceError('Invalid resource path', 400, 'validation_error', 'validation');
    }
    if (normalized.split('/').includes('..')) {
        throw new AuthorityServiceError('Invalid resource path', 400, 'validation_error', 'validation');
    }
    return normalized;
}

function sortedDirEntries(dirPath: string): fs.Dirent[] {
    if (!fs.existsSync(dirPath)) {
        return [];
    }
    return fs.readdirSync(dirPath, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name));
}

function readJsonObject(filePath: string): Record<string, unknown> | null {
    try {
        const raw = JSON.parse(fs.readFileSync(filePath, 'utf8'));
        return raw && typeof raw === 'object' && !Array.isArray(raw) ? raw as Record<string, unknown> : null;
    } catch {
        return null;
    }
}

function atomicWriteBuffer(filePath: string, buffer: Buffer): void {
    ensureDir(path.dirname(filePath));
    const tempPath = `${filePath}.${crypto.randomUUID()}.tmp`;
    fs.writeFileSync(tempPath, buffer);
    fs.renameSync(tempPath, filePath);
}

function atomicWriteJson(filePath: string, value: unknown): void {
    atomicWriteBuffer(filePath, Buffer.from(JSON.stringify(value, null, 2), 'utf8'));
}

export class StManagerResourceLocator {
    resolveResourceRoot(user: UserContext, resourceType: StManagerResourceType): StManagerResourceRoot | null {
        const directories = user.directories ?? { root: user.rootDir };
        const rootDir = directories.root || user.rootDir;

        const candidates: Array<{ path: string | undefined; source: string }> = [];
        switch (resourceType) {
            case 'characters':
                candidates.push({ path: directories.characters, source: 'request.user.directories.characters' });
                candidates.push({ path: path.join(rootDir, 'characters'), source: 'root/characters' });
                break;
            case 'chats':
                candidates.push({ path: directories.chats, source: 'request.user.directories.chats' });
                candidates.push({ path: path.join(rootDir, 'chats'), source: 'root/chats' });
                break;
            case 'worlds':
                candidates.push({ path: directories.worlds, source: 'request.user.directories.worlds' });
                candidates.push({ path: path.join(rootDir, 'worlds'), source: 'root/worlds' });
                break;
            case 'presets':
                candidates.push({ path: directories.openAI_Settings, source: 'request.user.directories.openAI_Settings' });
                candidates.push({ path: path.join(rootDir, 'OpenAI Settings'), source: 'root/OpenAI Settings' });
                candidates.push({ path: path.join(rootDir, 'presets'), source: 'root/presets' });
                break;
            case 'quick_replies':
                candidates.push({ path: directories.quickreplies, source: 'request.user.directories.quickreplies' });
                candidates.push({ path: path.join(rootDir, 'QuickReplies'), source: 'root/QuickReplies' });
                break;
            case 'regex':
                candidates.push({ path: path.join(rootDir, 'regex'), source: 'root/regex' });
                break;
        }

        for (const candidate of candidates) {
            if (!candidate.path) {
                continue;
            }
            const normalized = path.normalize(candidate.path);
            if (fs.existsSync(normalized) && fs.statSync(normalized).isDirectory()) {
                return { path: normalized, source: candidate.source, exists: true };
            }
        }

        const fallback = candidates.find(candidate => candidate.path);
        return fallback?.path ? { path: path.normalize(fallback.path), source: fallback.source, exists: false } : null;
    }

    resolveSettingsPath(user: UserContext): string {
        const directories = user.directories ?? { root: user.rootDir };
        return path.normalize(directories.settings || path.join(directories.root || user.rootDir, 'settings.json'));
    }

    buildManifest(user: UserContext, resourceType: StManagerResourceType): StManagerResourceManifest {
        this.assertResourceType(resourceType);
        const root = this.resolveResourceRoot(user, resourceType);
        const files: StManagerManifestFile[] = [];

        if (resourceType === 'regex') {
            if (root?.exists) {
                for (const entry of sortedDirEntries(root.path)) {
                    if (entry.isFile() && entry.name.toLowerCase().endsWith('.json')) {
                        files.push(this.fileManifestItem(root.path, entry.name, 'root/regex'));
                    }
                }
            }
            const bundle = this.buildRegexSettingsBundle(user);
            if (bundle) {
                files.push(this.bufferManifestItem(SETTINGS_REGEX_BUNDLE_PATH, bundle, 'settings.json', 'settings-regex-bundle'));
            }
            return { resource_type: resourceType, root: root?.path ?? null, files };
        }

        if (!root?.exists) {
            return { resource_type: resourceType, root: root?.path ?? null, files: [] };
        }

        switch (resourceType) {
            case 'characters':
                for (const entry of sortedDirEntries(root.path)) {
                    const lower = entry.name.toLowerCase();
                    if (entry.isFile() && (lower.endsWith('.png') || lower.endsWith('.json'))) {
                        files.push(this.fileManifestItem(root.path, entry.name, root.source));
                    }
                }
                break;
            case 'chats':
                for (const relPath of this.walkFiles(root.path, file => file.toLowerCase().endsWith('.jsonl'))) {
                    files.push(this.fileManifestItem(root.path, relPath, root.source));
                }
                break;
            case 'worlds':
                for (const relPath of this.walkFiles(root.path, file => {
                    const lower = file.toLowerCase();
                    return (file.split('/').length === 1 && lower.endsWith('.json')) || lower.endsWith('/world_info.json');
                })) {
                    files.push(this.fileManifestItem(root.path, relPath, root.source));
                }
                break;
            case 'presets':
            case 'quick_replies':
                for (const entry of sortedDirEntries(root.path)) {
                    if (entry.isFile() && entry.name.toLowerCase().endsWith('.json')) {
                        files.push(this.fileManifestItem(root.path, entry.name, root.source));
                    }
                }
                break;
        }

        return { resource_type: resourceType, root: root.path, files };
    }

    readResourceFile(user: UserContext, resourceType: StManagerResourceType, relativePath: string): StManagerResourceRead {
        this.assertResourceType(resourceType);
        const normalized = normalizeResourcePath(relativePath);
        if (resourceType === 'regex' && normalized === SETTINGS_REGEX_BUNDLE_PATH) {
            const bundle = this.buildRegexSettingsBundle(user);
            if (!bundle) {
                throw new AuthorityServiceError('Resource not found', 404, 'validation_error', 'validation');
            }
            const buffer = Buffer.from(JSON.stringify(bundle, null, 2), 'utf8');
            const settingsPath = this.resolveSettingsPath(user);
            const mtime = fs.existsSync(settingsPath) ? fs.statSync(settingsPath).mtimeMs : Date.now();
            return { buffer, size: buffer.length, mtime, sha256: sha256(buffer), source: 'settings.json', kind: 'settings-regex-bundle' };
        }

        const root = this.requireExistingRoot(user, resourceType);
        const filePath = this.resolveExistingPath(root.path, normalized);
        const stat = fs.statSync(filePath);
        if (!stat.isFile()) {
            throw new AuthorityServiceError('Resource not found', 404, 'validation_error', 'validation');
        }
        const buffer = fs.readFileSync(filePath);
        return { buffer, size: stat.size, mtime: stat.mtimeMs, sha256: sha256(buffer), source: root.source, kind: 'file' };
    }

    resolveWritePath(user: UserContext, resourceType: StManagerResourceType, relativePath: string): string {
        this.assertResourceType(resourceType);
        const normalized = normalizeResourcePath(relativePath);
        if (resourceType === 'regex' && normalized === SETTINGS_REGEX_BUNDLE_PATH) {
            return this.resolveSettingsPath(user);
        }
        const root = this.resolveResourceRoot(user, resourceType);
        if (!root) {
            throw new AuthorityServiceError('Resource root unavailable', 404, 'validation_error', 'validation');
        }
        return this.resolveWritablePath(root.path, normalized);
    }

    writeResourceFile(user: UserContext, resourceType: StManagerResourceType, relativePath: string, buffer: Buffer, overwriteMode = 'skip'): { path: string; skipped: boolean } {
        const normalized = normalizeResourcePath(relativePath);
        if (resourceType === 'regex' && normalized === SETTINGS_REGEX_BUNDLE_PATH) {
            const settingsPath = this.resolveSettingsPath(user);
            if (fs.existsSync(settingsPath) && overwriteMode === 'skip') {
                return { path: settingsPath, skipped: true };
            }
            this.patchRegexSettings(settingsPath, JSON.parse(buffer.toString('utf8')));
            return { path: settingsPath, skipped: false };
        }

        const filePath = this.resolveWritePath(user, resourceType, normalized);
        if (fs.existsSync(filePath) && overwriteMode === 'skip') {
            return { path: filePath, skipped: true };
        }
        atomicWriteBuffer(filePath, buffer);
        return { path: filePath, skipped: false };
    }

    private assertResourceType(resourceType: StManagerResourceType): void {
        if (!ST_MANAGER_RESOURCE_TYPES.includes(resourceType)) {
            throw new AuthorityServiceError('Unsupported resource type', 400, 'validation_error', 'validation');
        }
    }

    private requireExistingRoot(user: UserContext, resourceType: StManagerResourceType): StManagerResourceRoot {
        const root = this.resolveResourceRoot(user, resourceType);
        if (!root?.exists) {
            throw new AuthorityServiceError('Resource root unavailable', 404, 'validation_error', 'validation');
        }
        return root;
    }

    private resolveExistingPath(rootPath: string, relativePath: string): string {
        const rootReal = fs.realpathSync(rootPath);
        const candidate = path.resolve(rootReal, relativePath.split('/').join(path.sep));
        const candidateReal = fs.realpathSync(candidate);
        if (!isPathInside(rootReal, candidateReal)) {
            throw new AuthorityServiceError('Invalid resource path', 400, 'validation_error', 'validation');
        }
        return candidateReal;
    }

    private resolveWritablePath(rootPath: string, relativePath: string): string {
        ensureDir(rootPath);
        const rootReal = fs.realpathSync(rootPath);
        const candidate = path.resolve(rootReal, relativePath.split('/').join(path.sep));
        ensureDir(path.dirname(candidate));
        const parentReal = fs.realpathSync(path.dirname(candidate));
        if (!isPathInside(rootReal, parentReal)) {
            throw new AuthorityServiceError('Invalid resource path', 400, 'validation_error', 'validation');
        }
        return path.join(parentReal, path.basename(candidate));
    }

    private fileManifestItem(rootPath: string, relativePath: string, source: string): StManagerManifestFile {
        const normalized = normalizeResourcePath(relativePath);
        const filePath = this.resolveExistingPath(rootPath, normalized);
        const stat = fs.statSync(filePath);
        const buffer = fs.readFileSync(filePath);
        return {
            relative_path: normalized,
            kind: 'file',
            source,
            size: stat.size,
            mtime: stat.mtimeMs,
            sha256: sha256(buffer),
        };
    }

    private bufferManifestItem(relativePath: string, payload: unknown, source: string, kind: StManagerManifestFile['kind']): StManagerManifestFile {
        const settingsPath = this.resolveSettingsPathFromPayloadSource(source);
        const buffer = Buffer.from(JSON.stringify(payload, null, 2), 'utf8');
        const mtime = settingsPath && fs.existsSync(settingsPath) ? fs.statSync(settingsPath).mtimeMs : Date.now();
        return {
            relative_path: relativePath,
            kind,
            source,
            size: buffer.length,
            mtime,
            sha256: sha256(buffer),
        };
    }

    private resolveSettingsPathFromPayloadSource(_source: string): string {
        return '';
    }

    private walkFiles(rootPath: string, accepts: (relativePath: string) => boolean): string[] {
        const results: string[] = [];
        const visit = (current: string, prefix = '') => {
            for (const entry of sortedDirEntries(current)) {
                if (entry.name.startsWith('.') || entry.isSymbolicLink()) {
                    continue;
                }
                const relPath = prefix ? `${prefix}/${entry.name}` : entry.name;
                const fullPath = path.join(current, entry.name);
                if (entry.isDirectory()) {
                    visit(fullPath, relPath);
                    continue;
                }
                if (entry.isFile() && accepts(relPath)) {
                    results.push(relPath);
                }
            }
        };
        visit(rootPath);
        return results.sort((a, b) => a.localeCompare(b));
    }

    private buildRegexSettingsBundle(user: UserContext): Record<string, unknown> | null {
        const settingsPath = this.resolveSettingsPath(user);
        if (!fs.existsSync(settingsPath)) {
            return null;
        }
        const settings = readJsonObject(settingsPath);
        const extensionSettings = settings?.extension_settings;
        if (!extensionSettings || typeof extensionSettings !== 'object' || Array.isArray(extensionSettings)) {
            return null;
        }

        const picked: Record<string, unknown> = {};
        for (const key of REGEX_SETTINGS_KEYS) {
            if (Object.prototype.hasOwnProperty.call(extensionSettings, key)) {
                picked[key] = (extensionSettings as Record<string, unknown>)[key];
            }
        }
        if (Object.keys(picked).length === 0) {
            return null;
        }
        return { extension_settings: picked };
    }

    private patchRegexSettings(settingsPath: string, bundle: unknown): void {
        if (!bundle || typeof bundle !== 'object' || Array.isArray(bundle)) {
            throw new AuthorityServiceError('Invalid regex settings bundle', 400, 'validation_error', 'validation');
        }
        const extensionSettings = (bundle as Record<string, unknown>).extension_settings;
        if (!extensionSettings || typeof extensionSettings !== 'object' || Array.isArray(extensionSettings)) {
            throw new AuthorityServiceError('Invalid regex settings bundle', 400, 'validation_error', 'validation');
        }

        const settings = readJsonObject(settingsPath) ?? {};
        const currentExtensionSettings = settings.extension_settings;
        const nextExtensionSettings = currentExtensionSettings && typeof currentExtensionSettings === 'object' && !Array.isArray(currentExtensionSettings)
            ? { ...(currentExtensionSettings as Record<string, unknown>) }
            : {};

        for (const key of REGEX_SETTINGS_KEYS) {
            if (Object.prototype.hasOwnProperty.call(extensionSettings, key)) {
                nextExtensionSettings[key] = (extensionSettings as Record<string, unknown>)[key];
            }
        }
        settings.extension_settings = nextExtensionSettings;
        atomicWriteJson(settingsPath, settings);
    }
}

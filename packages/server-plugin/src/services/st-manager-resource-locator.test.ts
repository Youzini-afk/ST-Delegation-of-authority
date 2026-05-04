import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { StManagerResourceLocator } from './st-manager-resource-locator.js';
import type { UserContext } from '../types.js';

describe('StManagerResourceLocator', () => {
    let tempDir = '';
    let userRoot = '';

    beforeEach(() => {
        tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'authority-st-manager-'));
        userRoot = path.join(tempDir, 'data', 'alice');
        fs.mkdirSync(userRoot, { recursive: true });
    });

    afterEach(() => {
        fs.rmSync(tempDir, { recursive: true, force: true });
    });

    function user(partialDirectories: Record<string, string> = {}): UserContext {
        return {
            handle: 'alice',
            isAdmin: true,
            rootDir: userRoot,
            directories: {
                root: userRoot,
                ...partialDirectories,
            },
        };
    }

    it('uses ST directory fields first and falls back from root for resource roots', () => {
        const explicitCharacters = path.join(tempDir, 'custom-characters');
        const fallbackPresets = path.join(userRoot, 'OpenAI Settings');
        fs.mkdirSync(explicitCharacters, { recursive: true });
        fs.mkdirSync(fallbackPresets, { recursive: true });
        fs.writeFileSync(path.join(explicitCharacters, 'Ava.png'), Buffer.from('png-card'));
        fs.writeFileSync(path.join(fallbackPresets, 'Chat.json'), '{"name":"Chat"}');

        const locator = new StManagerResourceLocator();

        expect(locator.resolveResourceRoot(user({ characters: explicitCharacters }), 'characters')?.path).toBe(explicitCharacters);
        expect(locator.resolveResourceRoot(user(), 'presets')?.path).toBe(fallbackPresets);
    });

    it('builds manifests with exact relative paths for folder world books and chat files', () => {
        const worlds = path.join(userRoot, 'worlds');
        const chats = path.join(userRoot, 'chats');
        fs.mkdirSync(path.join(worlds, 'nested'), { recursive: true });
        fs.mkdirSync(path.join(chats, 'Ava'), { recursive: true });
        fs.writeFileSync(path.join(worlds, 'main.json'), '{"entries":{}}');
        fs.writeFileSync(path.join(worlds, 'nested', 'world_info.json'), '{"entries":{}}');
        fs.writeFileSync(path.join(chats, 'Ava', 'first.jsonl'), '{"user_name":"User"}\n');

        const locator = new StManagerResourceLocator();

        const worldPaths = locator.buildManifest(user(), 'worlds').files.map(file => file.relative_path).sort();
        const chatPaths = locator.buildManifest(user(), 'chats').files.map(file => file.relative_path);

        expect(worldPaths).toEqual(['main.json', 'nested/world_info.json']);
        expect(chatPaths).toEqual(['Ava/first.jsonl']);
    });

    it('backs up legacy regex files and a settings regex bundle without replacing the whole settings file', () => {
        const regexDir = path.join(userRoot, 'regex');
        fs.mkdirSync(regexDir, { recursive: true });
        fs.writeFileSync(path.join(regexDir, 'legacy.json'), '{"scriptName":"legacy","findRegex":"foo"}');
        fs.writeFileSync(path.join(userRoot, 'settings.json'), JSON.stringify({
            extension_settings: {
                regex: [{ scriptName: 'global', findRegex: 'bar' }],
                regex_presets: [{ id: 'p1', name: 'Preset' }],
                character_allowed_regex: ['Ava.png'],
                preset_allowed_regex: { openai: ['Chat'] },
                unrelated: true,
            },
            theme: 'dark',
        }));

        const locator = new StManagerResourceLocator();
        const manifest = locator.buildManifest(user(), 'regex');
        const paths = manifest.files.map(file => file.relative_path).sort();

        expect(paths).toEqual(['legacy.json', 'settings.regex.json']);
        const bundle = JSON.parse(locator.readResourceFile(user(), 'regex', 'settings.regex.json').buffer.toString('utf8'));
        expect(bundle).toEqual({
            extension_settings: {
                regex: [{ scriptName: 'global', findRegex: 'bar' }],
                regex_presets: [{ id: 'p1', name: 'Preset' }],
                character_allowed_regex: ['Ava.png'],
                preset_allowed_regex: { openai: ['Chat'] },
            },
        });
    });

    it('rejects paths that escape the resolved resource root', () => {
        fs.mkdirSync(path.join(userRoot, 'characters'), { recursive: true });
        const locator = new StManagerResourceLocator();

        expect(() => locator.readResourceFile(user(), 'characters', '../settings.json')).toThrow(/Invalid resource path/);
        expect(() => locator.resolveWritePath(user(), 'characters', 'C:/escape.png')).toThrow(/Invalid resource path/);
    });

    it('reuses manifest hashes while size and mtime stay unchanged', () => {
        const characters = path.join(userRoot, 'characters');
        const cardPath = path.join(characters, 'Ava.png');
        fs.mkdirSync(characters, { recursive: true });
        fs.writeFileSync(cardPath, Buffer.from('png-card'));
        const originalReadFileSync = fs.readFileSync;
        const readCalls: string[] = [];
        const locator = new StManagerResourceLocator();

        const spy = vi.spyOn(fs, 'readFileSync').mockImplementation((file: fs.PathOrFileDescriptor, ...args: unknown[]) => {
            readCalls.push(String(file));
            return originalReadFileSync(file, ...(args as []));
        });
        try {
            const first = locator.buildManifest(user(), 'characters').files[0]!;
            const second = locator.buildManifest(user(), 'characters').files[0]!;

            expect(second.sha256).toBe(first.sha256);
            expect(readCalls.filter(file => file === cardPath)).toHaveLength(1);
        } finally {
            spy.mockRestore();
        }
    });
});

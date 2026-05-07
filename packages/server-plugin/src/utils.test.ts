import { describe, expect, it } from 'vitest';
import path from 'node:path';
import { isPathInside, resolveContainedPath, sanitizeFileSegment } from './utils.js';

describe('sanitizeFileSegment', () => {
    it('never returns traversal-significant path segments', () => {
        expect(sanitizeFileSegment('')).toBe('_');
        expect(sanitizeFileSegment('.')).toBe('_');
        expect(sanitizeFileSegment('..')).toBe('__');
        expect(sanitizeFileSegment('../secret')).toBe('___secret');
        expect(sanitizeFileSegment('secret/..')).toBe('secret___');
        expect(sanitizeFileSegment('foo..bar')).toBe('foo__bar');
        expect(sanitizeFileSegment('...')).toBe('___');
        expect(sanitizeFileSegment('foo.bar..baz')).toBe('foo.bar__baz');
        expect(sanitizeFileSegment('foo..bar')).not.toContain('..');
        expect(sanitizeFileSegment('..')).not.toContain('..');
    });

    it('preserves safe file segment characters and replaces separators', () => {
        expect(sanitizeFileSegment('storage.blob')).toBe('storage.blob');
        expect(sanitizeFileSegment('third-party/ext-a')).toBe('third-party_ext-a');
    });
});

describe('resolveContainedPath', () => {
    it('resolves paths under their base directory', () => {
        const base = path.join('/tmp', 'authority-base');

        expect(resolveContainedPath(base, 'ext-a', 'state.sqlite')).toBe(path.join(base, 'ext-a', 'state.sqlite'));
        expect(isPathInside(base, path.join(base, 'nested', 'file.txt'))).toBe(true);
    });

    it('rejects paths that escape their base directory', () => {
        const base = path.join('/tmp', 'authority-base');

        expect(isPathInside(base, path.join('/tmp', 'authority-base-evil', 'file.txt'))).toBe(false);
        expect(() => resolveContainedPath(base, '..', 'escape.sqlite')).toThrow(/escapes base directory/);
    });
});

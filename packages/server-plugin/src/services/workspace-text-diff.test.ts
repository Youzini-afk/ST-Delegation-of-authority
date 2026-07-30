import { describe, expect, it } from 'vitest';
import { createWorkspaceTextDiff } from './workspace-text-diff.js';

describe('createWorkspaceTextDiff', () => {
    it('returns line-numbered insertion and replacement hunks with bounded context', () => {
        const result = createWorkspaceTextDiff(
            Buffer.from('alpha\nbeta\ngamma\ndelta\nepsilon\n'),
            Buffer.from('alpha\ninserted\nbeta changed\ngamma\ndelta\nepsilon\n'),
        );

        expect(result.kind).toBe('text');
        expect(result.hunks).toHaveLength(1);
        expect(result.hunks[0]!.lines).toEqual([
            { kind: 'context', beforeLine: 1, afterLine: 1, text: 'alpha' },
            { kind: 'deleted', beforeLine: 2, afterLine: null, text: 'beta' },
            { kind: 'added', beforeLine: null, afterLine: 2, text: 'inserted' },
            { kind: 'added', beforeLine: null, afterLine: 3, text: 'beta changed' },
            { kind: 'context', beforeLine: 3, afterLine: 4, text: 'gamma' },
            { kind: 'context', beforeLine: 4, afterLine: 5, text: 'delta' },
            { kind: 'context', beforeLine: 5, afterLine: 6, text: 'epsilon' },
        ]);
    });

    it('normalizes line endings without losing Unicode text', () => {
        const result = createWorkspaceTextDiff(
            Buffer.from('第一行\r\n旧内容\r\n'),
            Buffer.from('第一行\n新内容\n'),
        );

        expect(result.kind).toBe('text');
        expect(result.hunks[0]!.lines).toEqual([
            { kind: 'context', beforeLine: 1, afterLine: 1, text: '第一行' },
            { kind: 'deleted', beforeLine: 2, afterLine: null, text: '旧内容' },
            { kind: 'added', beforeLine: null, afterLine: 2, text: '新内容' },
        ]);
    });

    it('reports line-ending and final-newline changes even when line contents are equal', () => {
        const lineEnding = createWorkspaceTextDiff(Buffer.from('same\r\n'), Buffer.from('same\n'));
        expect(lineEnding).toMatchObject({
            kind: 'text',
            hunks: [],
            textMetadata: {
                before: { lineEnding: 'crlf', endsWithNewline: true },
                after: { lineEnding: 'lf', endsWithNewline: true },
            },
        });

        const finalNewline = createWorkspaceTextDiff(Buffer.from('same\n'), Buffer.from('same'));
        expect(finalNewline).toMatchObject({
            kind: 'text',
            hunks: [],
            textMetadata: {
                before: { lineEnding: 'lf', endsWithNewline: true },
                after: { lineEnding: 'none', endsWithNewline: false },
            },
        });
    });

    it('produces a valid edit script for every short repeated-line sequence', () => {
        const sequences: string[][] = [[]];
        for (let length = 1; length <= 4; length += 1) {
            for (let bits = 0; bits < 2 ** length; bits += 1) {
                sequences.push(Array.from({ length }, (_, index) => ((bits >> index) & 1) ? 'a' : 'b'));
            }
        }

        for (const before of sequences) {
            for (const after of sequences) {
                const result = createWorkspaceTextDiff(
                    Buffer.from(before.join('\n')),
                    Buffer.from(after.join('\n')),
                );
                expect(result.kind).toBe('text');
                const lines = result.hunks.flatMap(hunk => hunk.lines);
                if (before.join('\n') === after.join('\n')) {
                    expect(lines).toEqual([]);
                } else {
                    expect(lines.filter(line => line.kind !== 'added').map(line => line.text)).toEqual(before);
                    expect(lines.filter(line => line.kind !== 'deleted').map(line => line.text)).toEqual(after);
                }
            }
        }
    });

    it('classifies binary, oversized, and excessively complex inputs without returning content', () => {
        expect(createWorkspaceTextDiff(Buffer.from([0, 1, 2]), Buffer.from('text'))).toEqual({
            kind: 'binary',
            hunks: [],
            truncated: false,
        });

        const tooManyLines = `${Array.from({ length: 20_001 }, (_, index) => index).join('\n')}\n`;
        expect(createWorkspaceTextDiff(Buffer.from(tooManyLines), Buffer.alloc(0))).toEqual({
            kind: 'unavailable',
            reason: 'diff_too_complex',
            hunks: [],
            truncated: false,
        });

        const before = `${Array.from({ length: 513 }, (_, index) => `before-${index}`).join('\n')}\n`;
        const after = `${Array.from({ length: 513 }, (_, index) => `after-${index}`).join('\n')}\n`;
        expect(createWorkspaceTextDiff(Buffer.from(before), Buffer.from(after))).toEqual({
            kind: 'unavailable',
            reason: 'diff_too_complex',
            hunks: [],
            truncated: false,
        });
    });
});

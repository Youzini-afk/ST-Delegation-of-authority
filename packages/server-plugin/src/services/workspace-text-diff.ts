import type {
    WorkspaceFileDiffHunk,
    WorkspaceFileDiffLine,
    WorkspaceFileDiffResponse,
    WorkspaceFileDiffTextMetadata,
    WorkspaceTextMetadata,
} from '@stdo/shared-types';

const MAX_COMBINED_LINES = 20_000;
const MAX_EDIT_DISTANCE = 512;
const MAX_OUTPUT_LINES = 4_000;
const CONTEXT_LINES = 3;

type TextDiffResult = Pick<WorkspaceFileDiffResponse, 'kind' | 'reason' | 'textMetadata' | 'hunks' | 'truncated'>;
type EditKind = 'equal' | 'added' | 'deleted';

interface Edit {
    kind: EditKind;
    text: string;
}

export function createWorkspaceTextDiff(before: Buffer, after: Buffer): TextDiffResult {
    const beforeText = decodeWorkspaceText(before);
    const afterText = decodeWorkspaceText(after);
    if (beforeText === null || afterText === null) {
        return { kind: 'binary', hunks: [], truncated: false };
    }
    const textMetadata: WorkspaceFileDiffTextMetadata = {
        before: analyzeText(beforeText),
        after: analyzeText(afterText),
    };

    const beforeLines = splitLines(beforeText);
    const afterLines = splitLines(afterText);
    if (beforeLines.length + afterLines.length > MAX_COMBINED_LINES) {
        return { kind: 'unavailable', reason: 'diff_too_complex', hunks: [], truncated: false };
    }
    const edits = createLineEdits(beforeLines, afterLines);
    if (!edits) {
        return { kind: 'unavailable', reason: 'diff_too_complex', hunks: [], truncated: false };
    }
    return { ...buildHunks(edits), textMetadata };
}

function analyzeText(value: string): WorkspaceTextMetadata {
    const endings = new Set(value.match(/\r\n|\r|\n/g) ?? []);
    const lineEnding = endings.size === 0 ? 'none'
        : endings.size > 1 ? 'mixed'
            : endings.has('\r\n') ? 'crlf'
                : endings.has('\r') ? 'cr'
                    : 'lf';
    return {
        lineEnding,
        endsWithNewline: /(?:\r\n|\r|\n)$/.test(value),
    };
}

function decodeWorkspaceText(content: Buffer): string | null {
    if (content.includes(0)) return null;
    let value: string;
    try {
        value = new TextDecoder('utf-8', { fatal: true }).decode(content);
    } catch {
        return null;
    }
    let controls = 0;
    for (const character of value) {
        const code = character.charCodeAt(0);
        if (code < 32 && code !== 9 && code !== 10 && code !== 12 && code !== 13) controls += 1;
    }
    return controls > Math.max(8, Math.floor(value.length / 20)) ? null : value;
}

function splitLines(value: string): string[] {
    const normalized = value.replace(/\r\n/g, '\n').replace(/\r/g, '\n');
    if (!normalized) return [];
    const lines = normalized.split('\n');
    if (normalized.endsWith('\n')) lines.pop();
    return lines;
}

function createLineEdits(before: string[], after: string[]): Edit[] | null {
    const maximum = before.length + after.length;
    let frontier = new Map<number, number>([[1, 0]]);
    const trace: Array<Map<number, number>> = [];
    for (let distance = 0; distance <= Math.min(maximum, MAX_EDIT_DISTANCE); distance += 1) {
        trace.push(new Map(frontier));
        for (let diagonal = -distance; diagonal <= distance; diagonal += 2) {
            const down = frontier.get(diagonal + 1) ?? Number.NEGATIVE_INFINITY;
            const right = (frontier.get(diagonal - 1) ?? Number.NEGATIVE_INFINITY) + 1;
            let beforeIndex = diagonal === -distance || (diagonal !== distance && right < down)
                ? down
                : right;
            if (!Number.isFinite(beforeIndex)) beforeIndex = 0;
            let afterIndex = beforeIndex - diagonal;
            while (beforeIndex < before.length && afterIndex < after.length && before[beforeIndex] === after[afterIndex]) {
                beforeIndex += 1;
                afterIndex += 1;
            }
            frontier.set(diagonal, beforeIndex);
            if (beforeIndex >= before.length && afterIndex >= after.length) {
                return backtrackLineEdits(trace, before, after, distance);
            }
        }
    }
    return null;
}

function backtrackLineEdits(
    trace: Array<Map<number, number>>,
    before: string[],
    after: string[],
    maximumDistance: number,
): Edit[] {
    const edits: Edit[] = [];
    let beforeIndex = before.length;
    let afterIndex = after.length;
    for (let distance = maximumDistance; distance >= 0; distance -= 1) {
        const frontier = trace[distance]!;
        const diagonal = beforeIndex - afterIndex;
        const left = frontier.get(diagonal - 1) ?? Number.NEGATIVE_INFINITY;
        const down = frontier.get(diagonal + 1) ?? Number.NEGATIVE_INFINITY;
        const previousDiagonal = diagonal === -distance || (diagonal !== distance && left < down)
            ? diagonal + 1
            : diagonal - 1;
        const previousBefore = frontier.get(previousDiagonal) ?? 0;
        const previousAfter = previousBefore - previousDiagonal;
        while (beforeIndex > previousBefore && afterIndex > previousAfter) {
            edits.push({ kind: 'equal', text: before[beforeIndex - 1]! });
            beforeIndex -= 1;
            afterIndex -= 1;
        }
        if (distance === 0) break;
        if (beforeIndex === previousBefore) {
            edits.push({ kind: 'added', text: after[afterIndex - 1]! });
            afterIndex -= 1;
        } else {
            edits.push({ kind: 'deleted', text: before[beforeIndex - 1]! });
            beforeIndex -= 1;
        }
    }
    return edits.reverse();
}

function buildHunks(edits: Edit[]): TextDiffResult {
    const lines: WorkspaceFileDiffLine[] = [];
    let beforeLine = 1;
    let afterLine = 1;
    for (const edit of edits) {
        if (edit.kind === 'equal') {
            lines.push({ kind: 'context', beforeLine, afterLine, text: edit.text });
            beforeLine += 1;
            afterLine += 1;
        } else if (edit.kind === 'deleted') {
            lines.push({ kind: 'deleted', beforeLine, afterLine: null, text: edit.text });
            beforeLine += 1;
        } else {
            lines.push({ kind: 'added', beforeLine: null, afterLine, text: edit.text });
            afterLine += 1;
        }
    }

    const ranges: Array<{ start: number; end: number }> = [];
    for (let index = 0; index < lines.length; index += 1) {
        if (lines[index]!.kind === 'context') continue;
        const start = Math.max(0, index - CONTEXT_LINES);
        const end = Math.min(lines.length, index + CONTEXT_LINES + 1);
        const current = ranges.at(-1);
        if (current && start <= current.end) {
            current.end = Math.max(current.end, end);
        } else {
            ranges.push({ start, end });
        }
    }

    const hunks: WorkspaceFileDiffHunk[] = [];
    let remaining = MAX_OUTPUT_LINES;
    let truncated = false;
    for (const range of ranges) {
        if (remaining === 0) {
            truncated = true;
            break;
        }
        const available = range.end - range.start;
        const taken = Math.min(available, remaining);
        hunks.push({ lines: lines.slice(range.start, range.start + taken) });
        remaining -= taken;
        if (taken < available) {
            truncated = true;
            break;
        }
    }
    return { kind: 'text', hunks, truncated };
}

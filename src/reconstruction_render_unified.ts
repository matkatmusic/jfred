// Splits the webapp diff text and git-apply patch emitter from reconstruction_render.ts; pure functions over FileRevision[].

import type { FileRevision } from "./reconstruction_engine.ts";
import { EventKind } from "./structures/vocabulary.ts";
import { currentText, computeDiffBlockHeader } from "./reconstruction_render.ts";
import { runGitUnifiedDiff, DEFAULT_DIFF_CONTEXT_LINES, FULL_FILE_CONTEXT_LINES } from "./render_git_diff.ts";


const DIFF_CONTEXT_LINE_COUNT = 3;

// One aligned line in a revision-vs-previous diff: sign plus 1-based line number on each side, 0 if absent.
type AlignedDiffLine = { sign: " " | "-" | "+"; text: string; oldLineNumber: number; newLineNumber: number };

function isRenameRevision(revision: FileRevision): boolean {
    if (revision.kind === EventKind.rename) {
        if (revision.rename !== undefined) {
            return true;
        }
    }
    return false;
}

// Aligns a revision's lines against the previous one so unified-diff renderers can find changes.
function computeAlignedDiffLines(
    previous: FileRevision | undefined,
    revision: FileRevision,
): AlignedDiffLine[] {
    const previousLines = previous === undefined ? [] : previous.lines;
    const alignedLines: AlignedDiffLine[] = [];
    let oldCursor = 0;
    let pendingAdditions: AlignedDiffLine[] = [];
    const flushChangeRegion = (stopOldIndex: number) => {
        while (oldCursor < stopOldIndex) {
            alignedLines.push({ sign: "-", text: currentText(previousLines[oldCursor]!), oldLineNumber: oldCursor + 1, newLineNumber: 0 });
            oldCursor++;
        }
        alignedLines.push(...pendingAdditions);
        pendingAdditions = [];
    };
    revision.lines.forEach((entry, newIndex) => {
        if (entry.oldLineNum >= 0) {
            flushChangeRegion(entry.oldLineNum);
            alignedLines.push({ sign: " ", text: currentText(entry), oldLineNumber: entry.oldLineNum + 1, newLineNumber: newIndex + 1 });
            oldCursor = entry.oldLineNum + 1;
            return;
        }
        pendingAdditions.push({ sign: "+", text: currentText(entry), oldLineNumber: 0, newLineNumber: newIndex + 1 });
    });
    flushChangeRegion(previousLines.length);
    return alignedLines;
}

// Expands each changed line into a context window and merges overlapping or adjacent windows into one hunk range.
function mergeOrAppendHunkRange(
    ranges: Array<{ start: number; end: number }>,
    alignedLines: AlignedDiffLine[],
    line: AlignedDiffLine,
    index: number,
): void {
    if (line.sign === " ") {
        return;
    }
    const start = Math.max(0, index - DIFF_CONTEXT_LINE_COUNT);
    const end = Math.min(alignedLines.length - 1, index + DIFF_CONTEXT_LINE_COUNT);
    const lastRange = ranges[ranges.length - 1];
    if (lastRange !== undefined) {
        if (start <= lastRange.end + 1) {
            lastRange.end = Math.max(lastRange.end, end);
            return;
        }
    }
    ranges.push({ start, end });
}

// Which aligned-line index ranges become hunks: each change expanded by the context window, overlapping or adjacent windows merged.
function computeHunkRanges(alignedLines: AlignedDiffLine[]): Array<{ start: number; end: number }> {
    const ranges: Array<{ start: number; end: number }> = [];
    alignedLines.forEach((line, index) => {
        mergeOrAppendHunkRange(ranges, alignedLines, line, index);
    });
    return ranges;
}

// One hunk: the standard @@ header (1-based, 0,0 if absent) followed by its sign-prefixed lines.
function renderHunk(hunkLines: AlignedDiffLine[]): string {
    const oldSidedLines = hunkLines.filter((line) => line.oldLineNumber > 0);
    const newSidedLines = hunkLines.filter((line) => line.newLineNumber > 0);
    const oldStart = oldSidedLines.length === 0 ? 0 : oldSidedLines[0]!.oldLineNumber;
    const newStart = newSidedLines.length === 0 ? 0 : newSidedLines[0]!.newLineNumber;
    const header = `@@ -${oldStart},${oldSidedLines.length} +${newStart},${newSidedLines.length} @@`;
    const body = hunkLines.map((line) => line.sign + line.text);
    return [header, ...body].join("\n");
}

// Git-diffs the previous revision's text against this one and appends the result when non-empty.
function appendGitHunksForRevision(
    blockLines: string[],
    previous: FileRevision | undefined,
    revision: FileRevision,
    contextLines: number,
): void {
    // item 51: pure-TS hunk generation, replaced by real git below (function context).
    const beforeLines = previous === undefined ? [] : previous.lines.map(currentText);
    const afterLines = revision.lines.map(currentText);
    const hunks = runGitUnifiedDiff(beforeLines, afterLines, contextLines);
    if (hunks !== "") {
        blockLines.push(hunks);
    }
}

// Webapp diff text: like renderDiff's headers, but with unified hunks and context lines for the client to render gutters.
export function renderDiffWithContext(revisions: FileRevision[], fullContext: boolean = false): string {
    // item 75: "Show full contents" widens context to the whole file; default keeps the ±3-line window.
    const contextLines = fullContext ? FULL_FILE_CONTEXT_LINES : DEFAULT_DIFF_CONTEXT_LINES;
    const blocks: string[] = [];
    let previous: FileRevision | undefined;
    for (const revision of revisions) {
        const blockLines = [computeDiffBlockHeader(previous, revision)];
        if (!isRenameRevision(revision)) {
            appendGitHunksForRevision(blockLines, previous, revision, contextLines);
        }
        blocks.push(blockLines.join("\n"));
        previous = revision;
    }
    return blocks.join("\n");
}


// Splits text into lines and tracks trailing newline, since git needs the no-newline marker for byte-exact output.
function splitPatchLines(text: string): { lines: string[]; endsWithNewline: boolean } {
    if (text === "") {
        return { lines: [], endsWithNewline: true };
    }
    const endsWithNewline = text.endsWith("\n");
    const lines = text.split("\n");
    if (endsWithNewline) {
        lines.pop();
    }
    return { lines, endsWithNewline };
}

// One hunk side's lines prefixed with its sign, plus git's no-newline marker when needed.
function renderHunkSide(sign: string, text: string): string[] {
    const { lines, endsWithNewline } = splitPatchLines(text);
    const rendered = lines.map((line) => sign + line);
    if (!endsWithNewline) {
        rendered.push("\\ No newline at end of file");
    }
    return rendered;
}

// Whole-file replacement hunk valid for `git apply`; undefined marks creation/deletion. ponytail: add LCS hunks only if size matters.
export function renderGitFileDiff(
    relativePath: string,
    beforeText: string | undefined,
    afterText: string | undefined,
): string {
    const headerLines = [`diff --git a/${relativePath} b/${relativePath}`];
    if (beforeText === undefined) {
        headerLines.push("new file mode 100644");
    }
    if (afterText === undefined) {
        headerLines.push("deleted file mode 100644");
    }
    const beforeCount = splitPatchLines(beforeText ?? "").lines.length;
    const afterCount = splitPatchLines(afterText ?? "").lines.length;
    if (beforeCount === 0 && afterCount === 0) {
        // Empty creation/deletion: the mode line alone is the whole (valid) block.
        return headerLines.join("\n") + "\n";
    }
    const oldPath = beforeText === undefined ? "/dev/null" : `a/${relativePath}`;
    const newPath = afterText === undefined ? "/dev/null" : `b/${relativePath}`;
    const hunkHeader = `@@ -${beforeCount === 0 ? 0 : 1},${beforeCount} +${afterCount === 0 ? 0 : 1},${afterCount} @@`;
    return [
        ...headerLines,
        `--- ${oldPath}`,
        `+++ ${newPath}`,
        hunkHeader,
        ...renderHunkSide("-", beforeText ?? ""),
        ...renderHunkSide("+", afterText ?? ""),
    ].join("\n") + "\n";
}

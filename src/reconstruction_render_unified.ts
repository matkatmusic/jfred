// Unified-diff renderers split from reconstruction_render.ts: the webapp's context
// diff text (renderDiffWithContext) and the git-apply-able whole-file patch emitter
// (renderGitFileDiff). Pure functions over FileRevision[]; no IO.

import type { FileRevision } from "./reconstruction_engine.ts";
import { EventKind } from "./structures/vocabulary.ts";
import { currentText, computeDiffBlockHeader } from "./reconstruction_render.ts";
import { runGitUnifiedDiff, DEFAULT_DIFF_CONTEXT_LINES, FULL_FILE_CONTEXT_LINES } from "./render_git_diff.ts";

// --- Context diff (the webapp's diff text): unified hunks with line numbers ---

const DIFF_CONTEXT_LINE_COUNT = 3;

// One aligned line in a revision-vs-previous comparison: its unified-diff sign plus the
// 1-based line number it holds on each side (0 = absent on that side).
type AlignedDiffLine = { sign: " " | "-" | "+"; text: string; oldLineNumber: number; newLineNumber: number };

function isRenameRevision(revision: FileRevision): boolean {
    if (revision.kind === EventKind.rename) {
        if (revision.rename !== undefined) {
            return true;
        }
    }
    return false;
}

// Walk a revision's back-pointers against the previous revision: kept entries are context,
// born entries additions, unreferenced previous indices removals. Within a change region the
// removals come first (unified-diff order). Sound because the engine carries kept lines
// forward unchanged (reconstruction_replay_edit.ts) — a changed line is always kill + born.
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

// Which aligned-line index ranges become hunks: each change expanded by the context window,
// overlapping or adjacent windows merged.
function computeHunkRanges(alignedLines: AlignedDiffLine[]): Array<{ start: number; end: number }> {
    const ranges: Array<{ start: number; end: number }> = [];
    alignedLines.forEach((line, index) => {
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
    });
    return ranges;
}

// One hunk: the standard "@@ -oldStart,oldCount +newStart,newCount @@" header (1-based;
// 0,0 for an absent side) followed by its sign-prefixed lines.
function renderHunk(hunkLines: AlignedDiffLine[]): string {
    const oldSidedLines = hunkLines.filter((line) => line.oldLineNumber > 0);
    const newSidedLines = hunkLines.filter((line) => line.newLineNumber > 0);
    const oldStart = oldSidedLines.length === 0 ? 0 : oldSidedLines[0]!.oldLineNumber;
    const newStart = newSidedLines.length === 0 ? 0 : newSidedLines[0]!.newLineNumber;
    const header = `@@ -${oldStart},${oldSidedLines.length} +${newStart},${newSidedLines.length} @@`;
    const body = hunkLines.map((line) => line.sign + line.text);
    return [header, ...body].join("\n");
}

// The webapp's diff text: renderDiff's per-revision kind headers, but each block carries
// standard unified hunks with context lines around every change — enough for the client to
// render surrounding lines and line-number gutters. renderDiff (the CLI's human-oriented
// changes-only view) is untouched.
export function renderDiffWithContext(revisions: FileRevision[], fullContext: boolean = false): string {
    // item 75: "Show full contents" widens git's context to the whole file so every
    // unchanged line renders as context; default keeps the ±3-line hunk window.
    const contextLines = fullContext ? FULL_FILE_CONTEXT_LINES : DEFAULT_DIFF_CONTEXT_LINES;
    const blocks: string[] = [];
    let previous: FileRevision | undefined;
    for (const revision of revisions) {
        const blockLines = [computeDiffBlockHeader(previous, revision)];
        if (!isRenameRevision(revision)) {
            // item 51: pure-TS hunk generation, replaced by real git below (function context).
            // const alignedLines = computeAlignedDiffLines(previous, revision);
            // for (const range of computeHunkRanges(alignedLines)) {
            //     blockLines.push(renderHunk(alignedLines.slice(range.start, range.end + 1)));
            // }
            const beforeLines = previous === undefined ? [] : previous.lines.map(currentText);
            const afterLines = revision.lines.map(currentText);
            const hunks = runGitUnifiedDiff(beforeLines, afterLines, contextLines);
            if (hunks !== "") {
                blockLines.push(hunks);
            }
        }
        blocks.push(blockLines.join("\n"));
        previous = revision;
    }
    return blocks.join("\n");
}

// --- Standard unified diff (git-apply-able) — separate from renderDiff's human-oriented blocks ---

// Split patchable text into lines, tracking whether it ends with a newline (git needs the
// `\ No newline at end of file` marker to reproduce byte-exact content). "" is zero lines.
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

// One file's git-format diff block as a whole-file replacement hunk (every old line removed,
// every new line added) — a valid unified diff that `git apply` accepts; renderDiff's custom
// headers are not apply-compatible, hence this separate emitter. `undefined` text marks absence:
// creation when before is absent, deletion when after is.
// ponytail: whole-file hunks and unquoted paths — add an LCS hunk builder / git-style quoting
// only if patch size or paths-with-spaces ever matter.
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

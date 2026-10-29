// Webapp diff text renderer over FileRevision[]; the git-apply patch emitter lives in reconstruction_render_git_patch.ts.

import type { FileRevision } from "./reconstruction_events.ts";
import { EventKind } from "./structures/vocabulary.ts";
import { getCurrentText } from "./reconstruction_render.ts";
import { computeDiffBlockHeader } from "./reconstruction_render_diff.ts";
import { getGitUnifiedDiff,DEFAULT_DIFF_CONTEXT_LINES, FULL_FILE_CONTEXT_LINES } from "./render_git_diff.ts";

// const DIFF_CONTEXT_LINE_COUNT = 3;

// One aligned line in a revision-vs-previous diff: sign plus 1-based line number on each side, 0 if absent.
// type AlignedDiffLine = { sign: " " | "-" | "+"; text: string; oldLineNumber: number; newLineNumber: number };

function isRenameRevision(revision: FileRevision): boolean {
  if (revision.kind === EventKind.rename) {
    if (revision.rename !== undefined) {
      return true;
    }
  }
  return false;
}

// Dead since item 51 (real git builds the hunks): disabled, not removed.
// function computeAlignedDiffLines(
//   previous: FileRevision | undefined,
//   revision: FileRevision,
// ): AlignedDiffLine[] {
//   const previousLines = previous === undefined ? [] : previous.lines;
//   const alignedLines: AlignedDiffLine[] = [];
//   let oldCursor = 0;
//   let pendingAdditions: AlignedDiffLine[] = [];
//   const flushChangeRegion = (stopOldIndex: number) => {
//     while (oldCursor < stopOldIndex) {
//       alignedLines.push({ sign: "-", text: getCurrentText(previousLines[oldCursor]!), oldLineNumber: oldCursor + 1, newLineNumber: 0 });
//       oldCursor++;
//     }
//     alignedLines.push(...pendingAdditions);
//     pendingAdditions = [];
//   };
//   revision.lines.forEach((entry, newIndex) => {
//     if (entry.oldLineNum >= 0) {
//       flushChangeRegion(entry.oldLineNum);
//       alignedLines.push({ sign: " ", text: getCurrentText(entry), oldLineNumber: entry.oldLineNum + 1, newLineNumber: newIndex + 1 });
//       oldCursor = entry.oldLineNum + 1;
//       return;
//     }
//     pendingAdditions.push({ sign: "+", text: getCurrentText(entry), oldLineNumber: 0, newLineNumber: newIndex + 1 });
//   });
//   flushChangeRegion(previousLines.length);
//   return alignedLines;
// }
//
// function mergeOrAppendHunkRange(
//   ranges: Array<{ start: number; end: number }>,
//   alignedLines: AlignedDiffLine[],
//   line: AlignedDiffLine,
//   index: number,
// ): void {
//   if (line.sign === " ") {
//     return;
//   }
//   const start = Math.max(0, index - DIFF_CONTEXT_LINE_COUNT);
//   const end = Math.min(alignedLines.length - 1, index + DIFF_CONTEXT_LINE_COUNT);
//   const lastRange = ranges[ranges.length - 1];
//   if (lastRange !== undefined) {
//     if (start <= lastRange.end + 1) {
//       lastRange.end = Math.max(lastRange.end, end);
//       return;
//     }
//   }
//   ranges.push({ start, end });
// }
//
// function computeHunkRanges(alignedLines: AlignedDiffLine[]): Array<{ start: number; end: number }> {
//   const ranges: Array<{ start: number; end: number }> = [];
//   alignedLines.forEach((line, index) => {
//     mergeOrAppendHunkRange(ranges, alignedLines, line, index);
//   });
//   return ranges;
// }
//
// function renderHunk(hunkLines: AlignedDiffLine[]): string {
//   const oldSidedLines = hunkLines.filter((line) => line.oldLineNumber > 0);
//   const newSidedLines = hunkLines.filter((line) => line.newLineNumber > 0);
//   const oldStart = oldSidedLines.length === 0 ? 0 : oldSidedLines[0]!.oldLineNumber;
//   const newStart = newSidedLines.length === 0 ? 0 : newSidedLines[0]!.newLineNumber;
//   const header = `@@ -${oldStart},${oldSidedLines.length} +${newStart},${newSidedLines.length} @@`;
//   const body = hunkLines.map((line) => line.sign + line.text);
//   return [header, ...body].join("\n");
// }

// The current text of each line in a revision; no revision means no lines.
function collectLineTexts(revision: FileRevision | undefined): string[] {
  const texts: string[] = [];
  if (revision === undefined) {
    return texts;
  }
  for (const entry of revision.lines) {
    texts.push(getCurrentText(entry));
  }
  return texts;
}

// Git-diffs the previous revision's text against this one and appends the result when non-empty.
function appendGitHunksForRevision(
  blockLines: string[],
  previous: FileRevision | undefined,
  revision: FileRevision,
  contextLines: number,
): void {
  const beforeLines = collectLineTexts(previous);
  const afterLines = collectLineTexts(revision);
  const hunks = getGitUnifiedDiff(beforeLines, afterLines, contextLines);
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
    const isRename = isRenameRevision(revision);
    if (!isRename) {
      appendGitHunksForRevision(blockLines, previous, revision, contextLines);
    }
    blocks.push(blockLines.join("\n"));
    previous = revision;
  }
  return blocks.join("\n");
}

// Replay line primitives and the Edit splice; never imports reconstruction_replay.ts, which keeps the graph acyclic.

import type { StructuredPatchHunk } from "./structures/tool-result-shapes.ts";
import { EventKind } from "./structures/vocabulary.ts";
import { DOES_NOT_EXIST_YET } from "./structures/line-model.ts";
import type {
  EditEvent,
  FileRevision,
  LineEntry,
} from "./reconstruction_events.ts";
import {
  editRevision,
  keepSurvivingLines,
  removedOldIndicesOf,
  unapplyHunkAgainstAfter,
} from "./reconstruction_replay_edit_hunks.ts";

// Split file content into lines; a single trailing newline is not a phantom line.
export function splitLines(content: string): string[] {
  const parts = content.split("\n");
  const hasParts = parts.length > 0;
  const endsWithNewline = parts[parts.length - 1] === "";
  if (hasParts && endsWithNewline) {
    parts.pop();
  }
  return parts;
}

// A genesis line: born at this revision (no predecessor), one authored value.
export function createGenesisLine(line: string, timestamp: Date): LineEntry {
  return { oldLineNum: DOES_NOT_EXIST_YET, values: [{ line, timestamp }] };
}

export function createGenesisLines(texts: string[], timestamp: Date): LineEntry[] {
  const entries: LineEntry[] = [];
  for (const text of texts) {
    entries.push(createGenesisLine(text, timestamp));
  }
  return entries;
}

// The file is present when the latest revision exists and is not a deletion.
export function isFilePresent(revisions: FileRevision[]): boolean {
  const last = revisions[revisions.length - 1];
  return last !== undefined && last.kind !== EventKind.delete;
}

// The lines of the latest revision, or [] when there is none yet.
export function getLastLines(revisions: FileRevision[]): LineEntry[] {
  const last = revisions[revisions.length - 1];
  return last ? last.lines : [];
}

// Copy a working line forward unchanged, recording its current index as oldLineNum.
export function copyLineAt(entry: LineEntry, index: number): LineEntry {
  return { oldLineNum: index, values: entry.values };
}

export function copyLinesForward(lines: LineEntry[]): LineEntry[] {
  const copied: LineEntry[] = [];
  for (let index = 0; index < lines.length; index++) {
    copied.push(copyLineAt(lines[index]!, index));
  }
  return copied;
}

// One context line: copy the working line, or make a genesis line when the base is empty.
function getContextLine(
  workingLines: LineEntry[],
  workingIndex: number,
  text: string,
  timestamp: Date,
): { entry: LineEntry; born: boolean } {
  const carried = workingLines[workingIndex];
  if (carried === undefined) {
    return { entry: createGenesisLine(text, timestamp), born: true };
  }
  return { entry: copyLineAt(carried, workingIndex), born: false };
}

// Insert the hunk's '+' lines among the post-removal working lines; context lines carry over.
function insertHunkAdditions(
  workingLines: LineEntry[],
  hunk: StructuredPatchHunk,
  timestamp: Date,
): { lines: LineEntry[]; added: boolean } {
  const result = copyLinesForward(workingLines.slice(0, hunk.oldStart - 1));
  let workingIndex = hunk.oldStart - 1;
  let added = false;
  for (const line of hunk.lines) {
    const isRemoval = line.startsWith("-");
    if (isRemoval) {
      continue;
    }
    const isAddition = line.startsWith("+");
    if (isAddition) {
      result.push(createGenesisLine(line.slice(1), timestamp));
      added = true;
      continue;
    }
    const context = getContextLine(workingLines, workingIndex, line.slice(1), timestamp);
    result.push(context.entry);
    added = added || context.born;
    workingIndex += 1;
  }
  for (let index = workingIndex; index < workingLines.length; index++) {
    result.push({ oldLineNum: index, values: workingLines[index]!.values });
  }
  return { lines: result, added };
}

// Splice one Edit's hunks: '-' emits a removal revision, '+' an addition revision, same changeId.
export function applyEdit(event: EditEvent, revisions: FileRevision[]): void {
  for (const hunk of event.hunks) {
    const previousLines = getLastLines(revisions);
    const removed = removedOldIndicesOf(hunk);
    if (removed.size > 0) {
      const removalLines = keepSurvivingLines(previousLines, removed);
      revisions.push(editRevision(event, removalLines));
    }
    const additionLines = insertHunkAdditions(getLastLines(revisions), hunk, event.timestamp);
    if (additionLines.added) {
      revisions.push(editRevision(event, additionLines.lines));
    }
  }
}

// Recover pre-edit lines by un-applying all hunks, latest first; undefined when any hunk fails to match.
export function reverseEditFromAfter(afterLines: string[], event: EditEvent): string[] | undefined {
  let lines = afterLines;
  for (let index = event.hunks.length - 1; index >= 0; index -= 1) {
    const reversed = unapplyHunkAgainstAfter(lines, event.hunks[index]!);
    if (reversed === undefined) {
      return undefined;
    }
    lines = reversed;
  }
  return lines;
}

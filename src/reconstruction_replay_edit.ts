// Replay line primitives and the Edit splice; never imports reconstruction_replay.ts, which keeps the graph acyclic.

import type { StructuredPatchHunk } from "./structures/tool-result-shapes.ts";
import { EventKind } from "./structures/vocabulary.ts";
import { DOES_NOT_EXIST_YET } from "./structures/line-model.ts";
import type {
  AppendEvent,
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
  if (parts.length > 0 && parts[parts.length - 1] === "") {
    parts.pop();
  }
  return parts;
}

// A genesis line: born at this revision (no predecessor), one authored value.
export function genesisLine(line: string, timestamp: Date): LineEntry {
  return { oldLineNum: DOES_NOT_EXIST_YET, values: [{ line, timestamp }] };
}

// The file is present when the latest revision exists and is not a deletion.
export function fileIsPresent(revisions: FileRevision[]): boolean {
  const last = revisions[revisions.length - 1];
  return last !== undefined && last.kind !== EventKind.delete;
}

// The lines of the latest revision, or [] when there is none yet.
export function lastLinesOf(revisions: FileRevision[]): LineEntry[] {
  const last = revisions[revisions.length - 1];
  return last ? last.lines : [];
}

// Carry a working line forward unchanged, recording its current index as oldLineNum.
export function carryAt(entry: LineEntry, index: number): LineEntry {
  return { oldLineNum: index, values: entry.values };
}

// One context line: carry the working line, or make a genesis line when the base is empty (spec 39).
function resolveContextLine(
  workingLines: LineEntry[],
  workingIndex: number,
  text: string,
  timestamp: Date,
): { entry: LineEntry; born: boolean } {
  const carried = workingLines[workingIndex];
  if (carried === undefined) {
    return { entry: genesisLine(text, timestamp), born: true };
  }
  return { entry: carryAt(carried, workingIndex), born: false };
}

// Insert the hunk's '+' lines among the post-removal working lines; context lines carry over, '+' lines are born.
function insertHunkAdditions(
  workingLines: LineEntry[],
  hunk: StructuredPatchHunk,
  timestamp: Date,
): { lines: LineEntry[]; added: boolean } {
  const result: LineEntry[] = workingLines.slice(0, hunk.oldStart - 1).map(carryAt);
  let workingIndex = hunk.oldStart - 1;
  let added = false;
  for (const line of hunk.lines) {
    if (line.startsWith("-")) {
      continue;
    }
    if (line.startsWith("+")) {
      result.push(genesisLine(line.slice(1), timestamp));
      added = true;
      continue;
    }
    const context = resolveContextLine(workingLines, workingIndex, line.slice(1), timestamp);
    result.push(context.entry);
    added = added || context.born;
    workingIndex += 1;
  }
  for (let index = workingIndex; index < workingLines.length; index++) {
    result.push({ oldLineNum: index, values: workingLines[index]!.values });
  }
  return { lines: result, added };
}

// A `>>` append: carry the present file's lines forward unchanged (identity back-pointers) and add the redirect's new tail lines as genesis. When the file is absent the append creates it — every line genesis, kind write — mirroring how a write-to-absent is a create not an overwrite (locked decision 2).
export function appendRevision(
  event: AppendEvent,
  revisions: FileRevision[],
  present: boolean,
): FileRevision {
  const newLines = splitLines(event.content);
  if (!present) {
    return {
      kind: EventKind.write,
      changeId: event.changeId,
      timestamp: event.timestamp,
      lines: newLines.map((line) => genesisLine(line, event.timestamp)),
    };
  }
  const carried = lastLinesOf(revisions).map(carryAt);
  const appendedNewLines = newLines.slice(carried.length);
  const appended = appendedNewLines.map((line) => genesisLine(line, event.timestamp));
  return {
    kind: EventKind.append,
    changeId: event.changeId,
    timestamp: event.timestamp,
    lines: [...carried, ...appended],
  };
}

// Splice one Edit's hunks against the latest revision. A hunk with any '-' emits a removal revision; a hunk with any '+' emits an addition revision; both carry the Edit's changeId. Context lines keep identity; inserted lines are born (-1).
export function applyEdit(event: EditEvent, revisions: FileRevision[]): void {
  for (const hunk of event.hunks) {
    const previousLines = lastLinesOf(revisions);
    const removed = removedOldIndicesOf(hunk);
    if (removed.size > 0) {
      const removalLines = keepSurvivingLines(previousLines, removed);
      revisions.push(editRevision(event, removalLines));
    }
    const additionLines = insertHunkAdditions(lastLinesOf(revisions), hunk, event.timestamp);
    if (additionLines.added) {
      revisions.push(editRevision(event, additionLines.lines));
    }
  }
}

// The pre-edit lines recovered by un-applying ALL of `event`'s hunks against post-edit `afterLines`, latest hunk first so earlier hunks' indices stay valid. undefined when any hunk fails to match (the after content is the wrong blob — recover nothing rather than fabricate).
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


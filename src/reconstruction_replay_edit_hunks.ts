// Hunk-level helpers for reconstruction_replay_edit.ts.

import type { StructuredPatchHunk } from "./structures/tool-result-shapes.ts";
import { EventKind } from "./structures/vocabulary.ts";
import type { EditEvent, FileRevision, LineEntry } from "./reconstruction_events.ts";

export function editRevision(event: EditEvent, lines: LineEntry[]): FileRevision {
  return {
    kind: EventKind.edit,
    changeId: event.changeId,
    timestamp: event.timestamp,
    lines,
  };
}

// The old-line indices this hunk deletes: ' ' and '-' consume an old line, '-' deletes it.
export function removedOldIndicesOf(hunk: StructuredPatchHunk): Set<number> {
  const removed = new Set<number>();
  let oldIndex = hunk.oldStart - 1;
  for (const line of hunk.lines) {
    if (line.startsWith("-")) {
      removed.add(oldIndex);
      oldIndex += 1;
    }
    else if (line.startsWith("+")) {
      // an inserted line consumes no old line
    }
    else {
      oldIndex += 1;
    }
  }
  return removed;
}

// Previous lines minus the removed indices; each survivor keeps its previous index as its oldLineNum back-pointer.
export function keepSurvivingLines(
  previousLines: LineEntry[],
  removed: Set<number>,
): LineEntry[] {
  const survivors: LineEntry[] = [];
  for (let index = 0; index < previousLines.length; index++) {
    if (removed.has(index)) {
      continue;
    }
    survivors.push({ oldLineNum: index, values: previousLines[index]!.values });
  }
  return survivors;
}

// Un-apply one hunk against post-edit lines; undefined when they do not match the hunk, never fabricate.
export function unapplyHunkAgainstAfter(afterLines: string[], hunk: StructuredPatchHunk): string[] | undefined {
  const head = afterLines.slice(0, hunk.newStart - 1);
  const preEditRegion: string[] = [];
  let afterIndex = hunk.newStart - 1;
  for (const line of hunk.lines) {
    const text = line.slice(1);
    if (line.startsWith("-")) {
      preEditRegion.push(text); // removed by the edit, so present pre-edit; absent from after
      continue;
    }
    // ' ' and '+' lines must match the after line, else the backup is the wrong blob.
    if (afterLines[afterIndex] !== text) {
      return undefined;
    }
    afterIndex += 1;
    if (!line.startsWith("+")) {
      preEditRegion.push(text); // a context line survives into the pre-edit region too
    }
  }
  return [...head, ...preEditRegion, ...afterLines.slice(afterIndex)];
}

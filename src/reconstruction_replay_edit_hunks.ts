// Hunk-level helpers for reconstruction_replay_edit.ts.

import type { StructuredPatchHunk } from "./structures/tool-result-shapes.ts";
import { EventKind } from "./structures/vocabulary.ts";
import type { EditEvent, FileRevision, LineEntry } from "./reconstruction_events.ts";

export function createEditRevision(event: EditEvent, lines: LineEntry[]): FileRevision {
  return {
    kind: EventKind.edit,
    changeId: event.changeId,
    timestamp: event.timestamp,
    lines,
  };
}

// The old-line indices this hunk deletes: ' ' and '-' consume an old line, '-' deletes it.
export function collectRemovedOldIndices(hunk: StructuredPatchHunk): Set<number> {
  const removed = new Set<number>();
  let oldIndex = hunk.oldStart - 1;
  for (const line of hunk.lines) {
    const isRemoval = line.startsWith("-");
    const isAddition = line.startsWith("+");
    if (isRemoval) {
      removed.add(oldIndex);
      oldIndex += 1;
    }
    else if (isAddition) {
      // an inserted line consumes no old line
    }
    else {
      oldIndex += 1;
    }
  }
  return removed;
}

// Previous lines minus the removed indices; each survivor keeps its previous index as its oldLineNum back-pointer.
export function collectSurvivingLines(
  previousLines: LineEntry[],
  removed: Set<number>,
): LineEntry[] {
  const survivors: LineEntry[] = [];
  for (let index = 0; index < previousLines.length; index++) {
    const isRemoved = removed.has(index);
    if (isRemoved) {
      continue;
    }
    survivors.push({ oldLineNum: index, values: previousLines[index]!.values });
  }
  return survivors;
}

// Un-apply one hunk against post-edit lines; undefined when they do not match the hunk, never fabricate.
export function getHunkPreEditLines(afterLines: string[], hunk: StructuredPatchHunk): string[] | undefined {
  const head = afterLines.slice(0, hunk.newStart - 1);
  const preEditRegion: string[] = [];
  let afterIndex = hunk.newStart - 1;
  for (const line of hunk.lines) {
    const text = line.slice(1);
    const isRemoval = line.startsWith("-");
    const isAddition = line.startsWith("+");
    if (isRemoval) {
      preEditRegion.push(text); // removed by the edit, so present pre-edit; absent from after
      continue;
    }
    // ' ' and '+' lines must match the after line, else the backup is the wrong blob.
    if (afterLines[afterIndex] !== text) {
      return undefined;
    }
    afterIndex += 1;
    if (!isAddition) {
      preEditRegion.push(text); // a context line survives into the pre-edit region too
    }
  }
  return [...head, ...preEditRegion, ...afterLines.slice(afterIndex)];
}

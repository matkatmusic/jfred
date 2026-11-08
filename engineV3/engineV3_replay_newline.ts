// Reads the "\ No newline at end of file" marker rows of an Edit's structuredPatch hunks.

import type { StructuredPatchHunk } from "../src/structures/tool-result-shapes.ts";

const MARKER_PREFIX = "\\";
const ADDED_PREFIX = "+";
const REMOVED_PREFIX = "-";
const CONTEXT_PREFIX = " ";

// Copies of the hunks without marker rows; the line's own data is not changed.
export function stripNewlineMarkerRows(hunks: StructuredPatchHunk[]): StructuredPatchHunk[] {
  const strippedHunks: StructuredPatchHunk[] = [];
  for (const hunk of hunks) {
    const rows: string[] = [];
    for (const row of hunk.lines) {
      const isMarker = row.startsWith(MARKER_PREFIX);
      if (!isMarker) {
        rows.push(row);
      }
    }
    strippedHunks.push({ ...hunk, lines: rows });
  }
  return strippedHunks;
}

// A marker after "+" or " " means no final newline; after "-" means one.
export function decideFinalNewline(hunks: StructuredPatchHunk[], originalHasFinalNewline: boolean): boolean {
  let markerFollowsKeptRow = false;
  let markerFollowsRemovedRow = false;
  for (const hunk of hunks) {
    for (let index = 1; index < hunk.lines.length; index++) {
      const row = hunk.lines[index] as string;
      const isMarker = row.startsWith(MARKER_PREFIX);
      if (!isMarker) {
        continue;
      }
      const previousRow = hunk.lines[index - 1] as string;
      if (previousRow.startsWith(ADDED_PREFIX)) {
        markerFollowsKeptRow = true;
      }
      if (previousRow.startsWith(CONTEXT_PREFIX)) {
        markerFollowsKeptRow = true;
      }
      if (previousRow.startsWith(REMOVED_PREFIX)) {
        markerFollowsRemovedRow = true;
      }
    }
  }
  if (markerFollowsKeptRow) {
    return false;
  }
  if (markerFollowsRemovedRow) {
    return true;
  }
  return originalHasFinalNewline;
}

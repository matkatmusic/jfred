// Task 355: string hunk helpers for Edit replay: does a hunk match, and apply hunks.

import type { StructuredPatchHunk } from "./structures/tool-result-shapes.ts";

// A hunk matches when every context and removed row equals the base line at its position.
export function isHunkMatchingBase(base: string[], hunk: StructuredPatchHunk): boolean {
  let cursor = hunk.oldStart - 1;
  for (const row of hunk.lines) {
    const isOldSide = !row.startsWith("+");
    if (!isOldSide) {
      continue;
    }
    const rowText = row.slice(1);
    if (base[cursor] !== rowText) {
      return false;
    }
    cursor += 1;
  }
  return true;
}

// Best effort when the hunk disagrees with the base: positions decide, the base keeps its own text.
export function applyHunksToLines(base: string[], hunks: StructuredPatchHunk[]): string[] {
  const result: string[] = [];
  let cursor = 0;
  for (const hunk of hunks) {
    const hunkStart = hunk.oldStart - 1;
    result.push(...base.slice(cursor, hunkStart));
    cursor = hunkStart;
    for (const row of hunk.lines) {
      const isAddedRow = row.startsWith("+");
      if (isAddedRow) {
        result.push(row.slice(1));
        continue;
      }
      const isContextRow = row.startsWith(" ");
      if (isContextRow) {
        result.push(base[cursor]!);
      }
      cursor += 1;
    }
  }
  result.push(...base.slice(cursor));
  return result;
}

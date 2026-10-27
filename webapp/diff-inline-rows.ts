// Inline diff view model: unified diff text to numbered rows in original order.

import { NUMERIC_HUNK_HEADER, computeFullRowLineClass } from "./diff-vs-base-model.ts";

// Number fields are set only when a numeric hunk header seeded that side (item 40).
export type InlineRow = { text: string; lineClass: string; oldLineNumber?: number; newLineNumber?: number };

// Numbers a context line on each seeded side and returns the advanced counters.
function applyContextLineNumbers(row: InlineRow, oldLineCounter: number | undefined, newLineCounter: number | undefined): { oldLineCounter: number | undefined; newLineCounter: number | undefined } {
  if (oldLineCounter !== undefined) {
    row.oldLineNumber = oldLineCounter++;
  }
  if (newLineCounter !== undefined) {
    row.newLineNumber = newLineCounter++;
  }
  return { oldLineCounter, newLineCounter };
}

// Inline rows keep raw prefixes: "-" advances old, "+" advances new, hunk context advances both.
export function computeInlineRows(diffText: string): InlineRow[] {
  const rows: InlineRow[] = [];
  let insideHunk = false;
  let oldLineCounter: number | undefined = undefined;
  let newLineCounter: number | undefined = undefined;
  for (const line of diffText.split("\n")) {
    const isHunkHeader = line.startsWith("@@");
    if (isHunkHeader) {
      insideHunk = true;
      const numericHeader = NUMERIC_HUNK_HEADER.exec(line);
      oldLineCounter = numericHeader === null ? undefined : Number(numericHeader[1]);
      newLineCounter = numericHeader === null ? undefined : Number(numericHeader[2]);
      rows.push({ text: line, lineClass: "diff-line-hunk" });
      continue;
    }
    const row: InlineRow = { text: line, lineClass: computeFullRowLineClass(line) };
    const isDeletion = line.startsWith("-");
    const isAddition = line.startsWith("+");
    const isHunkDeletion = insideHunk && isDeletion;
    const isHunkAddition = insideHunk && isAddition;
    const isHunkContext = insideHunk && !isDeletion && !isAddition;
    if (isHunkDeletion) {
      if (oldLineCounter !== undefined) {
        row.oldLineNumber = oldLineCounter++;
      }
    }
    if (isHunkAddition) {
      if (newLineCounter !== undefined) {
        row.newLineNumber = newLineCounter++;
      }
    }
    if (isHunkContext) {
      const advancedCounters = applyContextLineNumbers(row, oldLineCounter, newLineCounter);
      oldLineCounter = advancedCounters.oldLineCounter;
      newLineCounter = advancedCounters.newLineCounter;
    }
    rows.push(row);
  }
  return rows;
}

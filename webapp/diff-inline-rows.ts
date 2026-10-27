// View model for the inline diff view: unified diff text -> numbered rows in original line order. Pure — no DOM.

import { NUMERIC_HUNK_HEADER, computeFullRowLineClass } from "./diff-vs-base-model.ts";

// One rendered inline-view line; number fields are set only when a numeric hunk header has seeded that side's counter (item 40).
export type InlineRow = { text: string; lineClass: string; oldLineNumber?: number; newLineNumber?: number };

// Assigns both gutter numbers to a context line inside a hunk (each side only when its counter is seeded) and returns the advanced counters.
function applyContextLineNumbers(row: InlineRow, oldLineCounter: number | undefined, newLineCounter: number | undefined): { oldLineCounter: number | undefined; newLineCounter: number | undefined } {
  if (oldLineCounter !== undefined) {
    row.oldLineNumber = oldLineCounter++;
  }
  if (newLineCounter !== undefined) {
    row.newLineNumber = newLineCounter++;
  }
  return { oldLineCounter, newLineCounter };
}

// Unified diff text -> inline rows in original line order, raw prefixes kept. "@@ -a,b +c,d @@" headers seed the per-side counters; "-" advances old only, "+" advances new only, context inside a hunk advances both; preamble lines and headers carry no numbers.
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

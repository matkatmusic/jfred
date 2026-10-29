// Raw-lines view: buildRawLinesViewModel filters per-line verdicts by mode and substring.

import { test } from "node:test";
import assert from "node:assert/strict";
import { buildRawLinesViewModel } from "../webapp/views/raw-lines.ts";

const RAW_LINES = ["alpha one", "beta change-1 two", "gamma three"];
const DOCUMENT = {
  filesTouched: [{ revisions: [{ changeId: "change-1" }] }],
  lineVerdicts: [
    { line: 0, verdict: "ignore" },
    { line: 1, verdict: "edit" },
    { line: 2, verdict: "read" },
  ],
};

function listFilteredLines(mode: string, substring: string): number[] {
  const viewModel = buildRawLinesViewModel(DOCUMENT, RAW_LINES, mode, substring);
  const lines: number[] = [];
  for (const entry of viewModel.entries)
    lines.push(entry.line);
  return lines;
}

test("all mode keeps every line", () => {
  assert.deepEqual(listFilteredLines("all", ""), [0, 1, 2]);
});

test("file mode drops ignored lines", () => {
  assert.deepEqual(listFilteredLines("file", ""), [1, 2]);
});

test("edits mode keeps only lines carrying a revision changeId", () => {
  assert.deepEqual(listFilteredLines("edits", ""), [1]);
});

test("substring filter is case-insensitive", () => {
  assert.deepEqual(listFilteredLines("all", "GAMMA"), [2]);
});

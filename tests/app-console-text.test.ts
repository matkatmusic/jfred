// Tests for webapp/app-console-text.ts: timestamp, tinting, and scrollback reads over a fake xterm buffer.

import { test } from "node:test";
import assert from "node:assert/strict";
import type { Terminal as XtermTerminal } from "@xterm/xterm";
import { collectBufferText, findLastNonEmptyBufferLine, formatConsoleTime, formatTintedSourceToken } from "../webapp/app-console-text.ts";

function createFakeTerminal(lines: string[]): XtermTerminal {
  const buffer = { length: lines.length, getLine: (index: number) => ({ translateToString: () => lines[index]! }) };
  return { buffer: { active: buffer } } as unknown as XtermTerminal;
}

test("test_formatConsoleTime_returns_padded_hh_mm_ss_mmm", () => {
  assert.match(formatConsoleTime(), /^\d{2}:\d{2}:\d{2}\.\d{3}$/);
});

test("test_formatTintedSourceToken_wraps_only_the_source_token_in_cyan", () => {
  const tinted = formatTintedSourceToken("run [foo.jsonl:7] done");
  assert.equal(tinted, "run \x1b[36m[foo.jsonl:7]\x1b[0m done");
});

test("test_formatTintedSourceToken_leaves_a_line_without_token_unchanged", () => {
  assert.equal(formatTintedSourceToken("parsing records"), "parsing records");
});

test("test_collectBufferText_joins_lines_and_trims_trailing_blanks", () => {
  const terminal = createFakeTerminal(["a", "b", "", ""]);
  assert.equal(collectBufferText(terminal), "a\nb");
});

test("test_findLastNonEmptyBufferLine_skips_trailing_blank_lines", () => {
  const terminal = createFakeTerminal(["first", "  last  ", "", "   "]);
  assert.equal(findLastNonEmptyBufferLine(terminal), "last");
});

test("test_findLastNonEmptyBufferLine_returns_empty_string_for_blank_buffer", () => {
  assert.equal(findLastNonEmptyBufferLine(createFakeTerminal(["", " "])), "");
});

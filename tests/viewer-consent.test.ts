// Tests for the consent dialog's pure helpers (webapp/app.ts — DOM-free functions):
// script grouping, preview overflow, inline-interpreter splitting, header selection
// navigation, and the script source token.

import { test } from "node:test";
import assert from "node:assert/strict";
import { checkConsentScriptOverflowsPreview, clampConsentSelectionStep, ConsentBlockKind, findDefaultConsentSelectionIndex, formatConsentSourceToken, groupConsentScriptsIntoBlocks, splitInlineInterpreterCode } from "../webapp/app-consent-model.ts";

// -------------------- consent dialog display blocks (item 69) --------------------

// A minimal wire consent script for grouping tests; index makes each row distinguishable.
function makeConsentScript(index: number, readOnly: boolean): { timestamp: string; code: string; readOnly?: boolean } {
    return { timestamp: `2026-01-01T00:00:0${index}Z`, code: `print(${index})`, readOnly };
}

test("test_groupConsentScriptsIntoBlocks_collapses_contiguous_read_only_runs", () => {
    // Scenario: [ro, ro, mod, ro] yields [read-only run of 2, modifying, read-only run of 1],
    // preserving chronological order.
    const scripts = [makeConsentScript(1, true), makeConsentScript(2, true), makeConsentScript(3, false), makeConsentScript(4, true)];
    const blocks = groupConsentScriptsIntoBlocks(scripts);
    assert.equal(blocks.length, 3);
    assert.equal(blocks[0]!.kind, ConsentBlockKind.readOnlyRun);
    assert.equal(blocks[0]!.kind === ConsentBlockKind.readOnlyRun ? blocks[0]!.scripts.length : 0, 2);
    assert.equal(blocks[1]!.kind, ConsentBlockKind.modifying);
    assert.equal(blocks[2]!.kind, ConsentBlockKind.readOnlyRun);
});

test("test_groupConsentScriptsIntoBlocks_treats_missing_flag_as_modifying", () => {
    // Scenario: a script with no readOnly field (older server) renders as a full modifying
    // row — the dialog degrades to today's behavior, never hides anything untagged.
    const scripts = [{ timestamp: "2026-01-01T00:00:01Z", code: "x" }];
    const blocks = groupConsentScriptsIntoBlocks(scripts);
    assert.equal(blocks.length, 1);
    assert.equal(blocks[0]!.kind, ConsentBlockKind.modifying);
});

test("test_groupConsentScriptsIntoBlocks_returns_no_blocks_for_no_scripts", () => {
    // Scenario: an empty script list yields an empty block list (no phantom summary line).
    assert.equal(groupConsentScriptsIntoBlocks([]).length, 0);
});

test("test_checkConsentScriptOverflowsPreview_returns_false_for_short_script", () => {
    // Scenario: a script that fits inside the 200px preview needs no Expand button.
    // Steps:
    // build a script whose line count is exactly the preview capacity (12 lines).
    const code = Array.from({ length: 12 }, (_, index) => `line ${index}`).join("\n");
    // the overflow check must say the preview does NOT overflow.
    assert.equal(checkConsentScriptOverflowsPreview(code), false);
});

test("test_checkConsentScriptOverflowsPreview_returns_true_for_script_longer_than_preview", () => {
    // Scenario: a script one line taller than the preview capacity gets an Expand button.
    // Steps:
    // build a script whose line count is one over the preview capacity (13 lines).
    const code = Array.from({ length: 13 }, (_, index) => `line ${index}`).join("\n");
    // the overflow check must say the preview DOES overflow.
    assert.equal(checkConsentScriptOverflowsPreview(code), true);
});

test("test_splitInlineInterpreterCode_splits_python_dash_c_wrapper_from_inline_body", () => {
    // Scenario: a recorded run stored as a full shell line (`python3 -c "…" 2>&1`) is split
    // into wrapper + inline Python so the body can be highlighted in its real language.
    // Steps:
    // build a shell line whose quoted body is real Python (single quotes inside are fine).
    const body = "\nimport json\npath = '/tmp/x.jsonl'\nprint(f'{path}')\n";
    const code = `python3 -c "${body}" 2>&1`;
    const split = splitInlineInterpreterCode(code);
    // the splitter must recognize the wrapper and hand back all three segments.
    assert.ok(split !== undefined);
    assert.equal(split.prefix, 'python3 -c "');
    assert.equal(split.body, body);
    assert.equal(split.suffix, '" 2>&1');
    // a python interpreter highlights the body as Python.
    assert.equal(split.languagePath, "__script__.py");
});

test("test_splitInlineInterpreterCode_returns_undefined_for_plain_python_script", () => {
    // Scenario: a normal recorded run is pure Python source, not a shell wrapper — the
    // splitter must decline so the whole preview keeps highlighting as Python.
    const code = "import json\nprint(json.dumps({'a': 1}))\n";
    assert.equal(splitInlineInterpreterCode(code), undefined);
});

// -------------------- consent header script navigation (item 73) --------------------

test("test_findDefaultConsentSelectionIndex_picks_first_modifying_script", () => {
    // Scenario: the consent header's default selection is the first modifying script.
    // Steps:
    // a script list holds two read-only scripts followed by a modifying one.
    const scripts = [makeConsentScript(1, true), makeConsentScript(2, true), makeConsentScript(3, false)];
    // the default selection index is the modifying script's position in the full list.
    assert.equal(findDefaultConsentSelectionIndex(scripts), 2);
});

test("test_findDefaultConsentSelectionIndex_treats_missing_flag_as_modifying", () => {
    // Scenario: a script without a readOnly flag counts as modifying (same rule as
    // groupConsentScriptsIntoBlocks).
    // Steps:
    // a script list holds one read-only script followed by one with no flag at all.
    const scripts = [makeConsentScript(1, true), { timestamp: "2026-01-01T00:00:02Z", code: "print(2)" }];
    // the unflagged script is the default selection.
    assert.equal(findDefaultConsentSelectionIndex(scripts), 1);
});

test("test_findDefaultConsentSelectionIndex_returns_undefined_when_all_read_only", () => {
    // Scenario: with no modifying script there is no default selection — every row starts
    // hidden inside a closed read-only <details> block, so nothing is selectable on load.
    // Steps:
    // a script list holds only read-only scripts.
    const scripts = [makeConsentScript(1, true), makeConsentScript(2, true)];
    // no index is returned.
    assert.equal(findDefaultConsentSelectionIndex(scripts), undefined);
});

test("test_clampConsentSelectionStep_advances_within_bounds", () => {
    // Scenario: stepping forward from the middle of three visible scripts selects the next one.
    assert.equal(clampConsentSelectionStep(1, 1, 3), 2);
});

test("test_clampConsentSelectionStep_clamps_at_last_script", () => {
    // Scenario: stepping forward from the last visible script stays on the last script (no wrap).
    assert.equal(clampConsentSelectionStep(2, 1, 3), 2);
});

test("test_clampConsentSelectionStep_clamps_at_first_script", () => {
    // Scenario: stepping backward from the first visible script stays on the first script (no wrap).
    assert.equal(clampConsentSelectionStep(0, -1, 3), 0);
});

test("test_clampConsentSelectionStep_enters_list_from_no_selection", () => {
    // Scenario: with no current selection (index -1, e.g. every row was hidden until a
    // read-only block opened), stepping forward lands on the first visible script.
    assert.equal(clampConsentSelectionStep(-1, 1, 3), 0);
});

// -------------------- consent script source token (task 97) --------------------

test("test_formatConsentSourceToken_formats_basename_and_line", () => {
    // Scenario: a script extracted from a known JSONL file + line renders as the same
    // " [file.jsonl:123]" token the server's formatRecordSourceToken emits for console labels.
    // Steps:
    // a source records the full transcript path and its 1-based line number.
    const source = { filePath: "/Users/x/.claude/projects/p/session.jsonl", lineNumber: 42 };
    // the token holds only the basename, with a leading space and brackets.
    assert.equal(formatConsentSourceToken(source), " [session.jsonl:42]");
});

test("test_formatConsentSourceToken_returns_empty_string_without_source", () => {
    // Scenario: a script whose record source was never captured contributes nothing to the
    // muted header line — no empty brackets, no stray space.
    assert.equal(formatConsentSourceToken(undefined), "");
});

test("test_formatConsentSourceToken_keeps_bare_filename_unchanged", () => {
    // Scenario: a path with no directory separators is already a basename — extraction must
    // pass it through untouched.
    assert.equal(formatConsentSourceToken({ filePath: "session.jsonl", lineNumber: 7 }), " [session.jsonl:7]");
});

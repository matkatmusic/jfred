import { test } from "node:test";
import assert from "node:assert/strict";
import { renderDiffWithContext } from "../src/reconstruction_render_unified.ts";
import type { FileRevision } from "../src/reconstruction_engine.ts";
import { EventKind } from "../src/structures/vocabulary.ts";
import { Uuid } from "../src/structures/domain.ts";
import {
    born,
    carried,
    createThenDelete,
    createThenAppendRevs,
    createRenameEdit,
} from "./reconstruction_render-test-helpers.ts";

// --- renderDiffWithContext: the webapp diff text (unified hunks + context) ----

// A 10-line create, then an edit replacing only line 5 — enough surrounding lines
// that the 3-line context window excludes the file's head and tail.
function createLongFileThenEditMiddle(): FileRevision[] {
    const t0 = new Date("2026-01-01T00:00:00Z");
    const t1 = new Date("2026-01-01T00:01:00Z");
    const originalLines = Array.from({ length: 10 }, (_, index) => `line ${index + 1}`);
    const create: FileRevision = {
        kind: EventKind.write,
        changeId: new Uuid("w1"),
        timestamp: t0,
        lines: originalLines.map((line) => born(line, t0)),
    };
    const editedLines = [
        ...originalLines.slice(0, 4).map((line, index) => carried(index, line, t0)),
        born("line 5 REPLACED", t1),
        ...originalLines.slice(5).map((line, index) => carried(index + 5, line, t0)),
    ];
    const edit: FileRevision = { kind: EventKind.edit, changeId: new Uuid("e1"), timestamp: t1, lines: editedLines };
    return [create, edit];
}

test("test_context_diff_keeps_revision_kind_header_per_block", () => {
    // Scenario: each revision still opens with its human-oriented kind header (the client's
    // per-revision block delimiter), before any numeric hunks.
    const out = renderDiffWithContext(createLongFileThenEditMiddle());
    assert.ok(out.includes("@@ created @ 2026-01-01T00:00:00.000Z @@"));
    assert.ok(out.includes("@@ changed @ 2026-01-01T00:01:00.000Z @@"));
});

test("test_context_diff_surrounds_a_middle_change_with_three_context_lines", () => {
    // Scenario: a change in the middle of a 10-line file gets a standard unified hunk with
    // 3 unchanged lines above and below, 1-based line numbers in the header.
    const out = renderDiffWithContext(createLongFileThenEditMiddle());
    // the hunk spans old lines 2-8 (context 2,3,4 + change at 5 + context 6,7,8).
    assert.ok(out.includes("@@ -2,7 +2,7 @@"));
    // context lines carry a leading space.
    assert.ok(out.includes(" line 4"));
    assert.ok(out.includes(" line 6"));
    // the change itself: deletion before addition.
    assert.ok(out.indexOf("-line 5") < out.indexOf("+line 5 REPLACED"));
    // lines beyond the context window are absent from the changed block.
    const changedBlock = out.slice(out.indexOf("@@ changed"));
    // assert.ok(!changedBlock.includes("line 1\n"));  // item 51: git's hunk header now carries "line 1" as function context
    assert.ok(!changedBlock.includes("\n line 1\n"), "line 1 is not a context body line");
    assert.ok(!changedBlock.includes(" line 10"));
});

test("test_context_diff_full_context_shows_lines_the_default_omits", () => {
    // Scenario: the same middle-of-a-10-line-file edit, rendered with fullContext=true.
    // Full context widens the hunk to the whole file, so the head (line 1) and tail
    // (line 10) the default ±3 window drops are now present as context body lines.
    const defaultText = renderDiffWithContext(createLongFileThenEditMiddle());
    const fullText = renderDiffWithContext(createLongFileThenEditMiddle(), true);
    // The default block drops the distant head/tail.
    const defaultChanged = defaultText.slice(defaultText.indexOf("@@ changed"));
    assert.ok(!defaultChanged.includes("\n line 1\n"));
    assert.ok(!defaultChanged.includes(" line 10"));
    // Full context carries every unchanged line as a context body line.
    const fullChanged = fullText.slice(fullText.indexOf("@@ changed"));
    assert.ok(fullChanged.includes("\n line 1\n"));
    assert.ok(fullChanged.includes(" line 10"));
    // The change itself is still a colored deletion-before-addition pair.
    assert.ok(fullChanged.indexOf("-line 5") < fullChanged.indexOf("+line 5 REPLACED"));
});

test("test_context_diff_renders_a_creation_as_one_all_addition_hunk", () => {
    // Scenario: a created file has no old side: hunk header -0,0 and every line a "+".
    const out = renderDiffWithContext(createThenAppendRevs());
    // assert.ok(out.includes("@@ -0,0 +1,1 @@"));  // item 51: git omits ",count" when a side's count is 1
    assert.ok(out.includes("@@ -0,0 +1 @@"));
    assert.ok(out.includes("+line one"));
});

test("test_context_diff_splits_far_apart_changes_into_separate_hunks", () => {
    // Scenario: two changes more than 2*3 lines apart in a 20-line file produce two numeric
    // hunks under one revision header.
    const t0 = new Date("2026-01-01T00:00:00Z");
    const t1 = new Date("2026-01-01T00:01:00Z");
    const originalLines = Array.from({ length: 20 }, (_, index) => `row ${index + 1}`);
    const create: FileRevision = {
        kind: EventKind.write,
        changeId: new Uuid("w1"),
        timestamp: t0,
        lines: originalLines.map((line) => born(line, t0)),
    };
    // replace row 2 (old index 1) and row 19 (old index 18).
    const editedLines = originalLines.map((line, index) => carried(index, line, t0));
    editedLines[1] = born("row 2 REPLACED", t1);
    editedLines[18] = born("row 19 REPLACED", t1);
    const edit: FileRevision = { kind: EventKind.edit, changeId: new Uuid("e1"), timestamp: t1, lines: editedLines };
    const out = renderDiffWithContext([create, edit]);
    const changedBlock = out.slice(out.indexOf("@@ changed"));
    const hunkHeaderCount = changedBlock.split("\n").filter((line) => line.startsWith("@@ -")).length;
    assert.equal(hunkHeaderCount, 2);
    // the middle of the file (far from both changes) appears in neither hunk.
    assert.ok(!changedBlock.includes(" row 10"));
});

test("test_context_diff_renders_a_rename_as_header_only", () => {
    // Scenario: a rename churns no lines: its block is the rename header with no numeric hunk.
    const [create, rename] = createRenameEdit();
    const out = renderDiffWithContext([create!, rename!]);
    const renameBlock = out.slice(out.indexOf("@@ renamed"));
    assert.ok(!renameBlock.includes("@@ -"));
});

test("test_context_diff_renders_a_deletion_as_one_all_removal_hunk", () => {
    // Scenario: a deleted file has no new side: hunk header +0,0 and every line a "-".
    const out = renderDiffWithContext(createThenDelete());
    const deletedBlock = out.slice(out.indexOf("@@ deleted"));
    assert.ok(deletedBlock.includes("@@ -1,2 +0,0 @@"));
    assert.ok(deletedBlock.includes("-def hello():"));
});

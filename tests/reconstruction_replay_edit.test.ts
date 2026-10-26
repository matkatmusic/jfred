import { test } from "node:test";
import assert from "node:assert/strict";
import { applyEdit, reverseEditFromAfter } from "../src/reconstruction_replay_edit.ts";
import { EventKind } from "../src/structures/vocabulary.ts";
import { DOES_NOT_EXIST_YET } from "../src/structures/line-model.ts";
import { Path, Uuid } from "../src/structures/domain.ts";
import type { EditEvent, FileRevision } from "../src/reconstruction_events.ts";
import type { StructuredPatchHunk } from "../src/structures/tool-result-shapes.ts";

// An Edit with one context line and one added line, replayed against an empty base (S12).
function buildContextThenAddEdit(): EditEvent {
    const hunk: StructuredPatchHunk = {
        oldStart: 1, oldLines: 1, newStart: 1, newLines: 2,
        lines: [" def add(a, b):", "+def multiply(a, b):"],
    };
    return {
        kind: EventKind.edit, changeId: new Uuid("toolu_edit"),
        target: new Path("/work/dir/scenario12.py"), hunks: [hunk],
        timestamp: new Date("2026-01-01T16:10:31Z"),
    };
}

// applyEdit on an empty base must not throw and must emit both lines as genesis.
test("test_apply_edit_on_empty_base_materialises_context_lines_as_genesis", () => {
    const revisions: FileRevision[] = [];
    // Replaying against the empty base must not throw.
    assert.doesNotThrow(() => applyEdit(buildContextThenAddEdit(), revisions));
    // Exactly one revision results (the addition; there was no removal).
    assert.equal(revisions.length, 1);
    assert.equal(revisions[0]!.kind, EventKind.edit);
    // Both the carried-context line and the added line are present, materialised as genesis (-1).
    assert.equal(revisions[0]!.lines.length, 2);
    assert.equal(revisions[0]!.lines[0]!.values[0]!.line, "def add(a, b):");
    assert.equal(revisions[0]!.lines[0]!.oldLineNum, DOES_NOT_EXIST_YET);
    assert.equal(revisions[0]!.lines[1]!.values[0]!.line, "def multiply(a, b):");
    assert.equal(revisions[0]!.lines[1]!.oldLineNum, DOES_NOT_EXIST_YET);
});

// An Edit carrying a single hunk, for the reverse-patch tests.
function buildEditWithHunk(hunk: StructuredPatchHunk): EditEvent {
    return {
        kind: EventKind.edit, changeId: new Uuid("toolu_reverse"),
        target: new Path("/work/dir/catalog_view.py"), hunks: [hunk],
        timestamp: new Date("2026-01-01T16:10:31Z"),
    };
}

// Reversing an addition hunk drops the added line from the post-edit lines (s28).
test("test_reverseEditFromAfter_removes_an_addition_hunk", () => {
    const hunk: StructuredPatchHunk = {
        oldStart: 1, oldLines: 2, newStart: 1, newLines: 3,
        lines: [" a", "+NEW", " b"],
    };
    const reversed = reverseEditFromAfter(["a", "NEW", "b"], buildEditWithHunk(hunk));
    assert.deepEqual(reversed, ["a", "b"]);
});

// Reversing a removal hunk puts the deleted line back at its old index.
test("test_reverseEditFromAfter_restores_a_removed_line", () => {
    const hunk: StructuredPatchHunk = {
        oldStart: 1, oldLines: 3, newStart: 1, newLines: 2,
        lines: [" a", "-b", " c"],
    };
    const reversed = reverseEditFromAfter(["a", "c"], buildEditWithHunk(hunk));
    assert.deepEqual(reversed, ["a", "b", "c"]);
});

// Reversal returns undefined when the after lines do not match the hunk.
test("test_reverseEditFromAfter_returns_undefined_when_after_content_mismatches", () => {
    const hunk: StructuredPatchHunk = {
        oldStart: 1, oldLines: 2, newStart: 1, newLines: 3,
        lines: [" a", "+NEW", " b"],
    };
    assert.equal(reverseEditFromAfter(["a", "WRONG", "b"], buildEditWithHunk(hunk)), undefined);
});


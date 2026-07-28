import { test } from "node:test";
import assert from "node:assert/strict";
import { applyEdit, reverseEditFromAfter } from "../src/reconstruction_replay_edit.ts";
import { EventKind } from "../src/structures/vocabulary.ts";
import { DOES_NOT_EXIST_YET } from "../src/structures/line-model.ts";
import { Path, Uuid } from "../src/structures/domain.ts";
import type { EditEvent, FileRevision } from "../src/reconstruction_engine.ts";
import type { StructuredPatchHunk } from "../src/structures/tool-results.ts";

// An Edit whose hunk carries a single context line (' ') and a single addition ('+'). Replaying it against an EMPTY base is the conversation-only-rewind-then-edit case (S12): the creating Write lives on an abandoned branch, so the surviving branch's first event for the file is this Edit.
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

// Scenario: applyEdit must not crash when the base is empty — a context line that has no working line to carry is materialised as a genesis line (born here) rather than indexing past the empty base.  Steps: - Build an Edit whose hunk has one context line then one added line.  - Apply it against an empty revisions array (no prior Write on this branch).  - It must not throw (the pre-fix engine threw reading `undefined.values`).  - One addition revision is emitted holding both the context line and the added line, each genesis.
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

// Scenario: un-applying an addition hunk against post-edit content drops the added line, recovering the pre-edit lines (s28 recovers the renamed-no-preview file by reversing the preview Edit off its after-backup).  Steps: - Post-edit lines carry "NEW" inserted between "a" and "b".  - The hunk added "NEW" (a single '+').  - reverseEditFromAfter returns the lines WITHOUT "NEW".
test("test_reverseEditFromAfter_removes_an_addition_hunk", () => {
    const hunk: StructuredPatchHunk = {
        oldStart: 1, oldLines: 2, newStart: 1, newLines: 3,
        lines: [" a", "+NEW", " b"],
    };
    const reversed = reverseEditFromAfter(["a", "NEW", "b"], buildEditWithHunk(hunk));
    assert.deepEqual(reversed, ["a", "b"]);
});

// Scenario: un-applying a removal hunk re-inserts the line the edit deleted, at the right index.  Steps: - Post-edit lines lack "b" (the edit removed it).  - The hunk removed "b" (a single '-') between context "a" and "c".  - reverseEditFromAfter restores "b" between "a" and "c".
test("test_reverseEditFromAfter_restores_a_removed_line", () => {
    const hunk: StructuredPatchHunk = {
        oldStart: 1, oldLines: 3, newStart: 1, newLines: 2,
        lines: [" a", "-b", " c"],
    };
    const reversed = reverseEditFromAfter(["a", "c"], buildEditWithHunk(hunk));
    assert.deepEqual(reversed, ["a", "b", "c"]);
});

// Scenario: when the after content does not carry the hunk's ' '/'+' lines where newStart says, the after-backup is the wrong blob — reverseEditFromAfter returns undefined rather than fabricate.  Steps: - The hunk says "NEW" was added at line 2, but the after lines hold "WRONG" there.  - reverseEditFromAfter returns undefined.
test("test_reverseEditFromAfter_returns_undefined_when_after_content_mismatches", () => {
    const hunk: StructuredPatchHunk = {
        oldStart: 1, oldLines: 2, newStart: 1, newLines: 3,
        lines: [" a", "+NEW", " b"],
    };
    assert.equal(reverseEditFromAfter(["a", "WRONG", "b"], buildEditWithHunk(hunk)), undefined);
});


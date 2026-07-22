import { test } from "node:test";
import assert from "node:assert/strict";
import {
    reconstructFile,
    reconstructAll,
    type CopyEvent,
    type FileRevision,
} from "../src/reconstruction_engine.ts";
import { findDeletedTarget } from "../src/reconstruction_branch.ts";
import { extractFileEvents } from "../src/reconstruction_extract.ts";
import { EventKind } from "../src/structures/vocabulary.ts";
import type { FileEvent } from "../src/reconstruction_engine.ts";
import type { ScriptExecutionEvent } from "../src/reconstruction_script_execution.ts";
import { DOES_NOT_EXIST_YET } from "../src/structures/line-model.ts";
import { Uuid } from "../src/structures/domain.ts";
import { Path } from "../src/structures/domain.ts";
import { loadRecords } from "./utilities.ts";
import { S1_JSONL, S2_JSONL, S3_JSONL } from "./fixtures.ts";
import type { TranscriptRecord } from "../src/structures/envelope.ts";

// Reconstruct a transcript's deleted file end-to-end (the s1 shape): detect the
// rm target, then reconstruct that file generically.
function reconstructDeleted(file: string): FileRevision[] {
    const records = loadRecords(file);
    return reconstructFile(records, findDeletedTarget(records)!);
}

// Extraction specs live in reconstruction_extract.test.ts.

// C1 — a ScriptExecutionEvent literal type-checks as a FileEvent and discriminates on its kind, so
// the engine's event union admits the script-execution evidence kind.
test("test_script_execution_event_is_a_member_of_the_file_event_union", () => {
    const event: FileEvent = {
        kind: EventKind.scriptExecution,
        changeId: new Uuid("toolu_script_exec"),
        target: new Path("ledger.py"),
        content: "def record_entry():\n    pass",
        timestamp: new Date("2026-06-26T10:29:42.415Z"),
    } satisfies ScriptExecutionEvent;
    assert.equal(event.kind, EventKind.scriptExecution);
});

// Spec 2 + 3 — target auto-detection yields exactly two revisions for that file
// (the sibling tests/test_s1_delete.py write is excluded).
test("test_finds_deleted_target_and_reconstructs_two_revisions", () => {
    const records = loadRecords(S1_JSONL);
    // the target is auto-detected as the rm'd file.
    const target = findDeletedTarget(records);
    assert.ok(target?.toString().endsWith("s1_delete.py"));
    const revisions = reconstructFile(records, target!);
    assert.equal(revisions.length, 2);
    // the create revision carries s1_delete.py's 2 lines, not the test's 7.
    assert.equal(revisions[0]!.lines.length, 2);
});

// reconstructAll accounts for EVERY touched file, not just the deleted one:
// s1_delete.py (create + delete) and tests/test_s1_delete.py (create + delete).
test("test_reconstruct_all_accounts_for_every_touched_file", () => {
    const histories = reconstructAll(loadRecords(S1_JSONL));
    assert.equal(histories.length, 2);
    const source = histories.find((h) => h.target.toString().endsWith("/s1_delete.py"));
    const testFile = histories.find((h) => h.target.toString().includes("test_s1_delete.py"));
    // both files are created then deleted by the same rm command.
    assert.equal(source?.revisions.length, 2);
    assert.equal(testFile?.revisions.length, 2);
    assert.equal(testFile?.revisions[0]!.lines[0]!.values[0]!.line, "from s1_delete import hello");
});

// Spec 4 — the create revision's genesis lines, content, and timestamp.
test("test_create_revision_has_genesis_lines", () => {
    const events = extractFileEvents(loadRecords(S1_JSONL));
    const write = events.find((event) => event.kind === EventKind.write)!;
    const create = reconstructDeleted(S1_JSONL)[0]!;
    // the create revision records that a write produced it.
    assert.equal(create.kind, EventKind.write);
    assert.equal(create.lines[0]!.values[0]!.line, "def hello():");
    assert.equal(create.lines[1]!.values[0]!.line, '    print("hello")');
    assert.equal(create.timestamp.getTime(), write.timestamp.getTime());
    for (const entry of create.lines) {
        assert.equal(entry.oldLineNum, DOES_NOT_EXIST_YET);
        assert.equal(entry.values.length, 1);
    }
});

// Spec 5 — the delete revision is empty, stamped at the rm time.
test("test_delete_revision_is_empty_at_rm_time", () => {
    const events = extractFileEvents(loadRecords(S1_JSONL));
    const rm = events.find((event) => event.kind === EventKind.delete)!;
    const del = reconstructDeleted(S1_JSONL)[1]!;
    assert.equal(del.lines.length, 0);
    assert.equal(del.timestamp.getTime(), rm.timestamp.getTime());
});

// Spec 6 — both revisions carry a Uuid changeId, distinct across operations.
test("test_revisions_carry_distinct_change_ids", () => {
    const [create, del] = reconstructDeleted(S1_JSONL);
    assert.ok(create!.changeId instanceof Uuid);
    assert.ok(del!.changeId instanceof Uuid);
    assert.ok(!create!.changeId.equals(del!.changeId));
});

// Spec 7 (trailing newline) lives in reconstruction_replay.test.ts with splitLines.

// --- s2-move-file: Edit splice (no rename involved) --------------------------

// The absolute path the transcript edits in tests/ (no rename touches it).
function s2TestFilePath(records: TranscriptRecord[]): Path {
    const edits = extractFileEvents(records).filter(
        (event) => event.kind === EventKind.edit,
    );
    return edits.find((event) =>
        event.target.toString().includes("test_s2_original.py"),
    )!.target;
}

// One Edit becomes a removal revision then an addition revision; both share the
// Edit's changeId; inserted lines are born (-1) and survivors keep back-pointers.
test("test_edit_splices_into_paired_removal_and_addition_revisions", () => {
    const records = loadRecords(S2_JSONL);
    const revisions = reconstructFile(records, s2TestFilePath(records));
    // Three entries: the create, then the removal, then the addition.
    assert.equal(revisions.length, 3);
    // Entry 1 is the removal: the old import line (index 0) is gone, leaving 5 lines.
    assert.equal(revisions[1]!.kind, EventKind.edit);
    assert.equal(revisions[1]!.lines.length, 5);
    assert.equal(revisions[1]!.lines[0]!.oldLineNum, 1);
    // Entry 2 is the addition: the new import is born at index 0, total back to 6 lines.
    assert.equal(revisions[2]!.lines.length, 6);
    assert.equal(revisions[2]!.lines[0]!.oldLineNum, DOES_NOT_EXIST_YET);
    assert.equal(revisions[2]!.lines[0]!.values[0]!.line, "from s2_moved import hello");
    // The removal and addition came from one Edit, so they share a changeId.
    assert.ok(revisions[1]!.changeId.equals(revisions[2]!.changeId));
});

// --- s2-move-file: rename lineage --------------------------------------------

// Reconstructing by the final path spans create -> rename -> edit, with the
// rename carrying the prior lines forward unchanged.
test("test_moved_file_history_spans_create_rename_edit", () => {
    const records = loadRecords(S2_JSONL);
    const finalPath = extractFileEvents(records).find(
        (event) => event.kind === EventKind.rename,
    )!.to;
    const revisions = reconstructFile(records, finalPath);
    // Create (as s2_original.py), the rename, then the goodbye() edit.
    assert.equal(revisions.length, 3);
    assert.equal(revisions[0]!.kind, EventKind.write);
    assert.equal(revisions[1]!.kind, EventKind.rename);
    assert.equal(revisions[2]!.kind, EventKind.edit);
    // The rename carries the 2 prior lines forward unchanged.
    assert.equal(revisions[1]!.lines.length, 2);
    assert.equal(revisions[1]!.lines[1]!.values[0]!.line, '    print("hello")');
    // The edit adds goodbye(), ending at 6 lines with the new lines born.
    assert.equal(revisions[2]!.lines.length, 6);
    assert.equal(revisions[2]!.lines[4]!.values[0]!.line, "def goodbye():");
    assert.equal(revisions[2]!.lines[4]!.oldLineNum, DOES_NOT_EXIST_YET);
});

// reconstructAll returns exactly two lineages: the test file and the moved file
// (keyed by its final path s2_moved.py, never s2_original.py).
test("test_reconstruct_all_returns_two_s2_lineages", () => {
    const histories = reconstructAll(loadRecords(S2_JSONL));
    assert.equal(histories.length, 2);
    // The moved file is keyed by its final path, with create -> rename -> edit.
    const moved = histories.find((h) => h.target.toString().endsWith("/s2_moved.py"))!;
    assert.equal(moved.revisions.length, 3);
    assert.equal(moved.revisions[0]!.kind, EventKind.write);
    assert.equal(moved.revisions[1]!.kind, EventKind.rename);
    assert.equal(moved.revisions[2]!.kind, EventKind.edit);
    // No history is keyed by the pre-rename path.
    assert.ok(!histories.some((h) => h.target.toString().endsWith("/s2_original.py")));
    // The test file's two edit revisions came from one Edit, so share a changeId.
    const testFile = histories.find((h) =>
        h.target.toString().includes("test_s2_original.py"),
    )!;
    assert.equal(testFile.revisions.length, 3);
    assert.ok(testFile.revisions[1]!.changeId.equals(testFile.revisions[2]!.changeId));
});

// --- s3-copy-file: copy lineage ----------------------------------------------

// The destination path of the single cp in the S3 transcript.
function s3CopyTargetPath(records: TranscriptRecord[]): Path {
    const copy = extractFileEvents(records).find(
        (event) => event.kind === EventKind.copy,
    );
    return (copy as CopyEvent).to;
}

// Reconstructing the copied file spans copy -> edit removal -> edit addition;
// the copy is seeded from the source's state as of the copy time, and the two
// edit revisions share one changeId.
test("test_copied_file_history_spans_copy_then_paired_edit", () => {
    // Load S3 and reconstruct the copied file by its destination path.
    const records = loadRecords(S3_JSONL);
    const revisions = reconstructFile(records, s3CopyTargetPath(records));
    // Three entries: the copy, then the edit removal, then the edit addition.
    assert.equal(revisions.length, 3);
    // Entry 0 is the copy, seeded with the source's two lines at copy time.
    assert.equal(revisions[0]!.kind, EventKind.copy);
    assert.equal(revisions[0]!.lines.length, 2);
    assert.equal(revisions[0]!.lines[0]!.values[0]!.line, "def hello():");
    assert.equal(revisions[0]!.lines[0]!.oldLineNum, DOES_NOT_EXIST_YET);
    assert.ok(revisions[0]!.copy!.from.toString().endsWith("/s3_source.py"));
    // Entry 1 is the edit removal: def hello() dropped, leaving 1 line.
    assert.equal(revisions[1]!.kind, EventKind.edit);
    assert.equal(revisions[1]!.lines.length, 1);
    assert.equal(revisions[1]!.lines[0]!.oldLineNum, 1);
    // Entry 2 is the edit addition: def greet() born at index 0, back to 2 lines.
    assert.equal(revisions[2]!.lines.length, 2);
    assert.equal(revisions[2]!.lines[0]!.oldLineNum, DOES_NOT_EXIST_YET);
    assert.equal(revisions[2]!.lines[0]!.values[0]!.line, "def greet():");
    // The removal and addition came from one Edit, so they share a changeId.
    assert.ok(revisions[1]!.changeId.equals(revisions[2]!.changeId));
});

// reconstructAll returns three independent histories for S3: the copy does not
// collapse the source (the opposite of a rename).
test("test_reconstruct_all_returns_three_s3_histories", () => {
    // Reconstruct every file the S3 transcript touches.
    const histories = reconstructAll(loadRecords(S3_JSONL));
    // At least the three core files exist — source, its test, and the copy (asserted by name below). The
    // exact total isn't pinned: a re-run may capture extra sibling files, but the copy must never collapse
    // the source into it.
    assert.ok(histories.length >= 3);
    // The source survives the copy as its own one-revision history.
    const source = histories.find((history) =>
        history.target.toString().endsWith("/s3_source.py"),
    )!;
    assert.equal(source.revisions.length, 1);
    assert.equal(source.revisions[0]!.kind, EventKind.write);
    // The copied file's history is copy -> edit -> edit.
    const copy = histories.find((history) =>
        history.target.toString().endsWith("/s3_copy.py"),
    )!;
    assert.equal(copy.revisions.length, 3);
    assert.equal(copy.revisions[0]!.kind, EventKind.copy);
    // The test file is untouched after creation.
    const test = histories.find((history) =>
        history.target.toString().endsWith("/test_s3_source.py"),
    )!;
    assert.equal(test.revisions.length, 1);
});

// s4-overwrite-file engine specs live in reconstruction_engine_s4.test.ts (split
// out to keep this file under the 250-line module cap).

// Rendering specs live in reconstruction_render.test.ts; CLI specs in
// reconstruction_cli.test.ts.


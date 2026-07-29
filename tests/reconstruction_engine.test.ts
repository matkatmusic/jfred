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

function reconstructDeleted(file: string): FileRevision[] {
    const records = loadRecords(file);
    return reconstructFile(records, findDeletedTarget(records)!);
}

// Extraction specs live in reconstruction_extract.test.ts.

// C1 — the engine's event union must admit the script-execution evidence kind.
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

// Spec 2 + 3 — the sibling tests/test_s1_delete.py write must be excluded.
test("test_finds_deleted_target_and_reconstructs_two_revisions", () => {
    const records = loadRecords(S1_JSONL);
    const target = findDeletedTarget(records);
    assert.ok(target?.toString().endsWith("s1_delete.py"));
    const revisions = reconstructFile(records, target!);
    assert.equal(revisions.length, 2);
    // 2 lines is s1_delete.py's own content, not the test file's 7.
    assert.equal(revisions[0]!.lines.length, 2);
});

// reconstructAll accounts for EVERY touched file, not just the deleted one.
test("test_reconstruct_all_accounts_for_every_touched_file", () => {
    const histories = reconstructAll(loadRecords(S1_JSONL));
    assert.equal(histories.length, 2);
    const source = histories.find((h) => h.target.toString().endsWith("/s1_delete.py"));
    const testFile = histories.find((h) => h.target.toString().includes("test_s1_delete.py"));
    // Both files are created then deleted by the same rm command.
    assert.equal(source?.revisions.length, 2);
    assert.equal(testFile?.revisions.length, 2);
    assert.equal(testFile?.revisions[0]!.lines[0]!.values[0]!.line, "from s1_delete import hello");
});

// Spec 4 — the create revision's genesis lines, content, and timestamp.
test("test_create_revision_has_genesis_lines", () => {
    const events = extractFileEvents(loadRecords(S1_JSONL));
    const write = events.find((event) => event.kind === EventKind.write)!;
    const create = reconstructDeleted(S1_JSONL)[0]!;
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

// The one path in tests/ that no rename touches.
function s2TestFilePath(records: TranscriptRecord[]): Path {
    const edits = extractFileEvents(records).filter(
        (event) => event.kind === EventKind.edit,
    );
    return edits.find((event) =>
        event.target.toString().includes("test_s2_original.py"),
    )!.target;
}

// One Edit splices into a removal revision then an addition revision sharing its changeId.
test("test_edit_splices_into_paired_removal_and_addition_revisions", () => {
    const records = loadRecords(S2_JSONL);
    const revisions = reconstructFile(records, s2TestFilePath(records));
    assert.equal(revisions.length, 3);
    assert.equal(revisions[1]!.kind, EventKind.edit);
    assert.equal(revisions[1]!.lines.length, 5);
    assert.equal(revisions[1]!.lines[0]!.oldLineNum, 1);
    assert.equal(revisions[2]!.lines.length, 6);
    assert.equal(revisions[2]!.lines[0]!.oldLineNum, DOES_NOT_EXIST_YET);
    assert.equal(revisions[2]!.lines[0]!.values[0]!.line, "from s2_moved import hello");
    assert.ok(revisions[1]!.changeId.equals(revisions[2]!.changeId));
});

// Reconstructing by the FINAL path must still span the pre-rename create.
test("test_moved_file_history_spans_create_rename_edit", () => {
    const records = loadRecords(S2_JSONL);
    const finalPath = extractFileEvents(records).find(
        (event) => event.kind === EventKind.rename,
    )!.to;
    const revisions = reconstructFile(records, finalPath);
    assert.equal(revisions.length, 3);
    assert.equal(revisions[0]!.kind, EventKind.write);
    assert.equal(revisions[1]!.kind, EventKind.rename);
    assert.equal(revisions[2]!.kind, EventKind.edit);
    assert.equal(revisions[1]!.lines.length, 2);
    assert.equal(revisions[1]!.lines[1]!.values[0]!.line, '    print("hello")');
    assert.equal(revisions[2]!.lines.length, 6);
    assert.equal(revisions[2]!.lines[4]!.values[0]!.line, "def goodbye():");
    assert.equal(revisions[2]!.lines[4]!.oldLineNum, DOES_NOT_EXIST_YET);
});

// A moved file is keyed by its FINAL path, never the pre-rename one.
test("test_reconstruct_all_returns_two_s2_lineages", () => {
    const histories = reconstructAll(loadRecords(S2_JSONL));
    assert.equal(histories.length, 2);
    const moved = histories.find((h) => h.target.toString().endsWith("/s2_moved.py"))!;
    assert.equal(moved.revisions.length, 3);
    assert.equal(moved.revisions[0]!.kind, EventKind.write);
    assert.equal(moved.revisions[1]!.kind, EventKind.rename);
    assert.equal(moved.revisions[2]!.kind, EventKind.edit);
    assert.ok(!histories.some((h) => h.target.toString().endsWith("/s2_original.py")));
    const testFile = histories.find((h) =>
        h.target.toString().includes("test_s2_original.py"),
    )!;
    assert.equal(testFile.revisions.length, 3);
    assert.ok(testFile.revisions[1]!.changeId.equals(testFile.revisions[2]!.changeId));
});

function s3CopyTargetPath(records: TranscriptRecord[]): Path {
    const copy = extractFileEvents(records).find(
        (event) => event.kind === EventKind.copy,
    );
    return (copy as CopyEvent).to;
}

// The copy revision is seeded from the source's state as of the COPY TIME.
test("test_copied_file_history_spans_copy_then_paired_edit", () => {
    const records = loadRecords(S3_JSONL);
    const revisions = reconstructFile(records, s3CopyTargetPath(records));
    assert.equal(revisions.length, 3);
    assert.equal(revisions[0]!.kind, EventKind.copy);
    assert.equal(revisions[0]!.lines.length, 2);
    assert.equal(revisions[0]!.lines[0]!.values[0]!.line, "def hello():");
    assert.equal(revisions[0]!.lines[0]!.oldLineNum, DOES_NOT_EXIST_YET);
    assert.ok(revisions[0]!.copy!.from.toString().endsWith("/s3_source.py"));
    assert.equal(revisions[1]!.kind, EventKind.edit);
    assert.equal(revisions[1]!.lines.length, 1);
    assert.equal(revisions[1]!.lines[0]!.oldLineNum, 1);
    assert.equal(revisions[2]!.lines.length, 2);
    assert.equal(revisions[2]!.lines[0]!.oldLineNum, DOES_NOT_EXIST_YET);
    assert.equal(revisions[2]!.lines[0]!.values[0]!.line, "def greet():");
    // One Edit produced both revisions, so they share a changeId.
    assert.ok(revisions[1]!.changeId.equals(revisions[2]!.changeId));
});

// Unlike a rename, a copy must not collapse the source into the destination.
test("test_reconstruct_all_returns_three_s3_histories", () => {
    const histories = reconstructAll(loadRecords(S3_JSONL));
    // The exact total is not pinned — a re-run may capture extra sibling files.
    assert.ok(histories.length >= 3);
    const source = histories.find((history) =>
        history.target.toString().endsWith("/s3_source.py"),
    )!;
    assert.equal(source.revisions.length, 1);
    assert.equal(source.revisions[0]!.kind, EventKind.write);
    const copy = histories.find((history) =>
        history.target.toString().endsWith("/s3_copy.py"),
    )!;
    assert.equal(copy.revisions.length, 3);
    assert.equal(copy.revisions[0]!.kind, EventKind.copy);
    const test = histories.find((history) =>
        history.target.toString().endsWith("/test_s3_source.py"),
    )!;
    assert.equal(test.revisions.length, 1);
});

// s4-overwrite-file engine specs live in reconstruction_engine_s4.test.ts (split out to keep this file under the 250-line module cap).

// Rendering specs live in reconstruction_render.test.ts; CLI specs in reconstruction_cli.test.ts.


import { test } from "node:test";
import assert from "node:assert/strict";
import { replayEvents } from "../src/reconstruction_replay.ts";
// The shared replay helpers now live in their own module (Task 1 split).
import { splitLines } from "../src/reconstruction_replay_edit.ts";
import { DOES_NOT_EXIST_YET } from "../src/structures/line-model.ts";
import type { CopyEvent, FileEvent } from "../src/reconstruction_engine.ts";
import { EventKind } from "../src/structures/vocabulary.ts";
import { Path, Uuid } from "../src/structures/domain.ts";

// splitLines drops a single trailing newline, so "a\nb\n" is two lines, not three.
test("test_split_lines_module_is_importable_and_drops_trailing_newline", () => {
    assert.deepEqual(splitLines("a\nb\n"), ["a", "b"]);
});

// The genesis sentinel is a named constant standing in for the old bare -1.
test("test_genesis_sentinel_constant_is_defined", () => {
    assert.equal(DOES_NOT_EXIST_YET, -1);
});

// A trailing newline does not add a phantom empty line (was engine spec 7).
test("test_trailing_newline_does_not_add_phantom_line", () => {
    assert.deepEqual(splitLines("a\nb\n"), ["a", "b"]);
    assert.deepEqual(splitLines("a\nb"), ["a", "b"]);
    assert.deepEqual(splitLines(""), []);
});

// A single write event replays into one create revision with genesis lines.
test("test_replay_of_a_write_event_yields_one_genesis_revision", () => {
    const timestamp = new Date("2026-01-01T00:00:00Z");
    const events: FileEvent[] = [
        {
            kind: EventKind.write,
            changeId: new Uuid("write-id"),
            target: new Path("/a/b.py"),
            content: "x\ny\n",
            timestamp,
        },
    ];
    const revisions = replayEvents(events);
    // One revision, of write kind, with the two content lines born here.
    assert.equal(revisions.length, 1);
    assert.equal(revisions[0]!.kind, EventKind.write);
    assert.equal(revisions[0]!.lines.length, 2);
    assert.equal(revisions[0]!.lines[0]!.oldLineNum, DOES_NOT_EXIST_YET);
    assert.equal(revisions[0]!.lines[1]!.values[0]!.line, "y");
});

// Two writes to the same path: a create then a full-content overwrite.
test("test_second_write_to_a_present_file_is_an_overwrite", () => {
    // Two write events to one path, version1 then version2.
    const t0 = new Date("2026-01-01T00:00:00Z");
    const t1 = new Date("2026-01-01T00:01:00Z");
    const target = new Path("/a/s4_overwrite.py");
    const events: FileEvent[] = [
        { kind: EventKind.write, changeId: new Uuid("w1"), target, content: "def version1():\n    return 1\n", timestamp: t0 },
        { kind: EventKind.write, changeId: new Uuid("w2"), target, content: "def version2():\n    return 2\n", timestamp: t1 },
    ];
    const revisions = replayEvents(events);
    // Two revisions: the create, then the overwrite.
    assert.equal(revisions.length, 2);
    // The first write is a create (the file was absent before it).
    assert.equal(revisions[0]!.kind, EventKind.write);
    // The second write is an overwrite (the file was present), carrying version2 as genesis.
    assert.equal(revisions[1]!.kind, EventKind.overwrite);
    assert.equal(revisions[1]!.lines.length, 2);
    assert.equal(revisions[1]!.lines[0]!.oldLineNum, DOES_NOT_EXIST_YET);
    assert.equal(revisions[1]!.lines[0]!.values[0]!.line, "def version2():");
    // The two revisions come from different writes, so their change ids differ.
    assert.ok(!revisions[0]!.changeId.equals(revisions[1]!.changeId));
});

// A write then a `>>` append to the same path: create then a content-preserving append.
test("test_append_event_carries_prior_lines_and_adds_a_genesis_tail", () => {
    // A create of one line, then an append whose full content is both lines.
    const t0 = new Date("2026-01-01T00:00:00Z");
    const t1 = new Date("2026-01-01T00:01:00Z");
    const target = new Path("/a/s5_redirect.txt");
    const events: FileEvent[] = [
        { kind: EventKind.write, changeId: new Uuid("w1"), target, content: "line one\n", timestamp: t0 },
        { kind: EventKind.append, changeId: new Uuid("a1"), target, content: "line one\nline two\n", timestamp: t1 },
    ];
    const revisions = replayEvents(events);
    // Two revisions: the create, then the append.
    assert.equal(revisions.length, 2);
    assert.equal(revisions[0]!.kind, EventKind.write);
    // The append is its own kind, two lines long.
    assert.equal(revisions[1]!.kind, EventKind.append);
    assert.equal(revisions[1]!.lines.length, 2);
    // Line 0 is carried from the create (a back-pointer to old index 0, not genesis).
    assert.equal(revisions[1]!.lines[0]!.oldLineNum, 0);
    assert.equal(revisions[1]!.lines[0]!.values[0]!.line, "line one");
    // Line 1 is the appended tail, born here.
    assert.equal(revisions[1]!.lines[1]!.oldLineNum, DOES_NOT_EXIST_YET);
    assert.equal(revisions[1]!.lines[1]!.values[0]!.line, "line two");
});

// A `>` overwrite event against a present file is a full-content overwrite (S4 reuse).
test("test_overwrite_event_against_present_file_is_an_overwrite", () => {
    const t0 = new Date("2026-01-01T00:00:00Z");
    const t1 = new Date("2026-01-01T00:01:00Z");
    const target = new Path("/a/s5_redirect.txt");
    const events: FileEvent[] = [
        { kind: EventKind.write, changeId: new Uuid("w1"), target, content: "line one\n", timestamp: t0 },
        { kind: EventKind.overwrite, changeId: new Uuid("o1"), target, content: "replaced content\n", timestamp: t1 },
    ];
    const revisions = replayEvents(events);
    // The second revision is an overwrite, all genesis (a wholesale replace).
    assert.equal(revisions[1]!.kind, EventKind.overwrite);
    assert.ok(revisions[1]!.lines.every((entry) => entry.oldLineNum === DOES_NOT_EXIST_YET));
    assert.equal(revisions[1]!.lines[0]!.values[0]!.line, "replaced content");
});

// A copy event with known seed lines replays into one genesis revision.
test("test_replay_appends_copy_genesis_revision_from_seed_lines", () => {
    // A copy event seeded with the source's two lines at copy time.
    const copy: CopyEvent = {
        kind: EventKind.copy,
        changeId: new Uuid("toolu_cp"),
        from: new Path("/x/s3_source.py"),
        to: new Path("/x/s3_copy.py"),
        seedLines: ["def hello():", '    print("hello")'],
        timestamp: new Date("2026-06-18T16:16:27.224Z"),
    };
    // Replaying just the copy yields one revision.
    const revisions = replayEvents([copy]);
    assert.equal(revisions.length, 1);
    // It is a copy revision carrying the from/to provenance.
    assert.equal(revisions[0]!.kind, EventKind.copy);
    assert.ok(revisions[0]!.copy!.from.equals(new Path("/x/s3_source.py")));
    assert.ok(revisions[0]!.copy!.to.equals(new Path("/x/s3_copy.py")));
    // Its lines are the seed content, every line born here (genesis).
    assert.equal(revisions[0]!.lines.length, 2);
    assert.equal(revisions[0]!.lines[0]!.values[0]!.line, "def hello():");
    assert.equal(revisions[0]!.lines[0]!.oldLineNum, DOES_NOT_EXIST_YET);
    // The genesis lines are stamped at the copy time.
    assert.equal(
        revisions[0]!.lines[0]!.values[0]!.timestamp.toISOString(),
        "2026-06-18T16:16:27.224Z",
    );
});


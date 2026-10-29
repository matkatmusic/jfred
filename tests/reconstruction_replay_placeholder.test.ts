import { test } from "node:test";
import assert from "node:assert/strict";
import { collectRevisions } from "../src/reconstruction_replay.ts";
import type { FileEvent } from "../src/reconstruction_events.ts";
import { EventKind } from "../src/structures/vocabulary.ts";
import { Path, Uuid } from "../src/structures/domain.ts";

// An unsupported event kind becomes an unrecoverable placeholder revision, not a crash.
test("test_collectRevisions_emits_unrecoverable_placeholder_when_an_event_kind_is_unsupported", () => {
    const t0 = new Date("2026-01-01T00:00:00Z");
    const t1 = new Date("2026-01-01T00:01:00Z");
    const target = new Path("/a/partial.py");
    const events: FileEvent[] = [
        { kind: EventKind.write, changeId: new Uuid("w1"), target, content: "x\ny\n", timestamp: t0 },
        { kind: "bogus-kind", changeId: new Uuid("b1"), timestamp: t1 } as unknown as FileEvent,
    ];
    const revisions = collectRevisions(events);
    // Two revisions: the create, then the placeholder for the event that could not replay.
    assert.equal(revisions.length, 2);
    assert.equal(revisions[0]!.unrecoverable, undefined);
    // The placeholder is flagged with a reason naming the unsupported kind.
    assert.ok(revisions[1]!.unrecoverable!.reason.includes("bogus-kind"));
    assert.equal(revisions[1]!.timestamp, t1);
});

// The placeholder carries the previous lines forward, so a later valid event still replays.
test("test_unrecoverable_placeholder_carries_previous_lines_forward", () => {
    const t0 = new Date("2026-01-01T00:00:00Z");
    const t1 = new Date("2026-01-01T00:01:00Z");
    const t2 = new Date("2026-01-01T00:02:00Z");
    const target = new Path("/a/partial.py");
    const events: FileEvent[] = [
        { kind: EventKind.write, changeId: new Uuid("w1"), target, content: "x\ny\n", timestamp: t0 },
        { kind: "bogus-kind", changeId: new Uuid("b1"), timestamp: t1 } as unknown as FileEvent,
        {
            kind: EventKind.edit,
            changeId: new Uuid("e1"),
            target,
            hunks: [{ oldStart: 3, oldLines: 0, newStart: 3, newLines: 1, lines: ["+z"] }],
            timestamp: t2,
        },
    ];
    const revisions = collectRevisions(events);
    // Create, placeholder, then the edit's addition — three revisions.
    assert.equal(revisions.length, 3);
    // The placeholder's line text is the write's content carried forward.
    const placeholderText = revisions[1]!.lines.map(
        (entry) => entry.values[entry.values.length - 1]!.line,
    );
    assert.deepEqual(placeholderText, ["x", "y"]);
    // The later valid edit still applies on top of the carried state, unflagged.
    assert.equal(revisions[2]!.unrecoverable, undefined);
    assert.equal(revisions[2]!.kind, EventKind.edit);
    const editedText = revisions[2]!.lines.map(
        (entry) => entry.values[entry.values.length - 1]!.line,
    );
    assert.deepEqual(editedText, ["x", "y", "z"]);
});

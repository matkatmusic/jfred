import { test } from "node:test";
import assert from "node:assert/strict";
import type { FileEvent, FileRevision } from "../src/reconstruction_events.ts";
import { EventKind } from "../src/structures/vocabulary.ts";
import { Path, Uuid } from "../src/structures/domain.ts";

test("test_file_event_union_narrows_on_kind", () => {
    const event: FileEvent = {
        kind: EventKind.rename,
        changeId: new Uuid("c1"),
        from: new Path("/w/a.py"),
        to: new Path("/w/b.py"),
        timestamp: new Date("2026-01-01T00:00:00.000Z"),
    };
    assert.equal(event.kind, EventKind.rename);
    assert.equal(event.kind === EventKind.rename ? event.to.toString() : "", "/w/b.py");
});

test("test_file_revision_carries_rename_info", () => {
    const revision: FileRevision = {
        kind: EventKind.rename,
        changeId: new Uuid("c2"),
        timestamp: new Date("2026-01-01T00:00:00.000Z"),
        lines: [],
        rename: { from: new Path("/w/a.py"), to: new Path("/w/b.py") },
    };
    assert.equal(revision.rename?.from.toString(), "/w/a.py");
});

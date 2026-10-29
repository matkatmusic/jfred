// Tests for entry-time display paths across a rename (webapp/views/timeline-changes.ts).

import { test } from "node:test";
import assert from "node:assert/strict";
import { computeFileChanges, buildRevisionIndex } from "../webapp/views/timeline-changes.ts";
import type { WireTimelineDocument } from "../webapp/views/timeline-wire-types.ts";

// The minimal shape reproducing the s87 "pre-rename entry shows core_inventory.py" bug (task 127).
const renamedFileDocument: WireTimelineDocument = {
    filesTouched: [{
        target: "/repo/core_inventory.py",
        revisions: [
            { kind: "edit", changeId: "c1", timestamp: "2026-07-20T10:00:00Z" },
            { kind: "rename", changeId: "c2", timestamp: "2026-07-20T10:05:00Z", rename: { from: "/repo/inventory.py", to: "/repo/core_inventory.py" } },
        ],
    }],
    rewoundFilesTouched: [],
    messages: [],
    steps: [],
    commitMarkers: [],
};

test("test_indexRevisionsByChangeId_stamps_entry_time_display_paths", () => {
    // A revision before a rename shows the old name; its lookup path stays the final target.
    const index = buildRevisionIndex(renamedFileDocument);
    assert.equal(index.get("c1")!.displayPath, "/repo/inventory.py");
    assert.equal(index.get("c1")!.path, "/repo/core_inventory.py");
    assert.equal(index.get("c2")!.displayPath, "/repo/core_inventory.py");
});

test("test_deriveFileChanges_copies_the_entry_time_display_path_onto_the_chip", () => {
    // A chip from a pre-rename revision shows the entry-time name but keeps the final path as its lookup key.
    const index = buildRevisionIndex(renamedFileDocument);
    const step = { index: 0, when: "2026-07-20T10:00:00Z", changeIds: ["c1"], changedPaths: [] };
    const changes = computeFileChanges(step, index);
    assert.equal(changes.length, 1);
    assert.equal(changes[0]!.displayPath, "/repo/inventory.py");
    assert.equal(changes[0]!.path, "/repo/core_inventory.py");
});

test("test_deriveFileChanges_fallback_chips_display_their_own_path", () => {
    // A changedPaths-hint chip resolves through no revision, so its display name is its path.
    const index = buildRevisionIndex(renamedFileDocument);
    const step = { index: 0, when: "2026-07-20T10:00:00Z", changeIds: [], changedPaths: ["/repo/orders.py"] };
    const changes = computeFileChanges(step, index);
    assert.equal(changes.length, 1);
    assert.equal(changes[0]!.displayPath, "/repo/orders.py");
    assert.equal(changes[0]!.path, "/repo/orders.py");
});

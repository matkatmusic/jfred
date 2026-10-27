// Tests for webapp/inspector-links.ts: link maps, jump targets, and snapshot history anchors.

import { test } from "node:test";
import assert from "node:assert/strict";
import { computeLinkMaps, computeSnapshotHistoryAnchor, findJumpTarget } from "../webapp/inspector-links.ts";

const RAW_LINES = [
    JSON.stringify({ uuid: "u-0", type: "assistant", message: { content: [{ type: "tool_use", id: "toolu_a" }] } }),
    "not json but mentions toolu_a",
    JSON.stringify({ uuid: "u-2", type: "user", message: { content: [{ type: "tool_result", tool_use_id: "toolu_a" }] } }),
];

test("test_computeLinkMaps_maps_uuids_and_tool_ids_to_lines", () => {
    // Scenario: uuids map to their line; a tool id maps to every line that names it, once each.
    const maps = computeLinkMaps(RAW_LINES);
    assert.equal(maps.uuidToLine.get("u-2"), 2);
    assert.deepEqual(maps.toolIdToLines.get("toolu_a"), [0, 1, 2]);
    assert.equal(computeLinkMaps(RAW_LINES), maps);
});

test("test_findJumpTarget_skips_the_current_line", () => {
    // Scenario: a link never points at the line being shown.
    const maps = computeLinkMaps(RAW_LINES);
    assert.equal(findJumpTarget("toolu_a", 0, maps), 1);
    assert.equal(findJumpTarget("u-0", 0, maps), undefined);
    assert.equal(findJumpTarget("u-2", 0, maps), 2);
    assert.equal(findJumpTarget("missing", 0, maps), undefined);
});

test("test_computeSnapshotHistoryAnchor_picks_the_last_revision_at_or_before_backup_time", () => {
    // Scenario: the anchor names the newest revision not later than the backup time.
    const filesTouched = [{
        target: "/repo/a.py",
        revisions: [
            { changeId: "c1", timestamp: "2026-01-01T00:00:01.000Z" },
            { changeId: "c2", timestamp: "2026-01-01T00:00:05.000Z" },
        ],
    }];
    assert.deepEqual(computeSnapshotHistoryAnchor(filesTouched, "a.py", "2026-01-01T00:00:03.000Z"), { target: "/repo/a.py", revisionNumber: 1 });
    assert.deepEqual(computeSnapshotHistoryAnchor(filesTouched, "a.py", undefined), { target: "/repo/a.py", revisionNumber: undefined });
    assert.equal(computeSnapshotHistoryAnchor(filesTouched, "b.py", undefined), undefined);
});

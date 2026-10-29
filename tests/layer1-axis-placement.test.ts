import { test } from "node:test";
import assert from "node:assert/strict";
import { setBranchesAxisPx, setDiskOrphanAxisPx, setNodeAxisPx, setNodesAxisPx, setPairAxisPx } from "../webapp/layer1-axis-placement.ts";
import { T0, T1, T2, T3 } from "./layer1-filter-test-helpers.ts";

test("test_set_node_axis_px_keeps_the_other_fields", () => {
    const placed = setNodeAxisPx({ hash: "aa", instant: T0, axisPx: 1 }, 40);
    assert.deepEqual(placed, { hash: "aa", instant: T0, axisPx: 40 });
});

test("test_set_nodes_axis_px_matches_offsets_by_position", () => {
    const placed = setNodesAxisPx([{ instant: T0, axisPx: 0 }, { instant: T1, axisPx: 0 }], [10, 20]);
    assert.deepEqual(placed.map((node) => node.axisPx), [10, 20]);
    assert.deepEqual(setNodesAxisPx(undefined, []), []);
});

test("test_set_pair_axis_px_places_commits_then_on_disk_then_snapshots", () => {
    const pair = {
        path: "a.ts",
        commits: [{ hash: "aa", instant: T0, axisPx: 0 }, { hash: "ab", instant: T1, axisPx: 0 }],
        onDisk: { instant: T2, axisPx: 0 },
        snapshots: [{ instant: T3, axisPx: 0, version: 1, sessionId: "s", sessionFile: "f" }],
    };
    const placed = setPairAxisPx(pair, [10, 20, 30, 40]);
    assert.deepEqual(placed.commits.map((commit) => commit.axisPx), [10, 20]);
    assert.equal(placed.onDisk.axisPx, 30);
    assert.equal(placed.snapshots![0]!.axisPx, 40);
    assert.equal("created" in placed, false);
});

test("test_set_pair_axis_px_gives_created_the_first_offset", () => {
    const pair = {
        path: "a.ts",
        created: { instant: T0, axisPx: 0 },
        commits: [{ hash: "aa", instant: T1, axisPx: 0 }],
        onDisk: { instant: T2, axisPx: 0 },
    };
    const placed = setPairAxisPx(pair, [5, 15, 25]);
    assert.equal(placed.created!.axisPx, 5);
    assert.equal(placed.commits[0]!.axisPx, 15);
    assert.equal(placed.onDisk.axisPx, 25);
});

test("test_set_disk_orphan_axis_px_stacks_snapshots_below_the_orphan", () => {
    const orphan = { path: "x.ts", instant: T0, axisPx: 0, snapshots: [{ instant: T1, axisPx: 0, version: 1, sessionId: "s", sessionFile: "f" }] };
    const placed = setDiskOrphanAxisPx(orphan, [7, 9]);
    assert.equal(placed.axisPx, 7);
    assert.equal(placed.snapshots![0]!.axisPx, 9);
});

test("test_set_branches_axis_px_with_no_branches_returns_empty", () => {
    assert.deepEqual(setBranchesAxisPx([], [T0], [1]), []);
});

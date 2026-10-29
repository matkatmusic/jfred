// Task 312 (spec S19): snapshot placements keyed by project-relative path, with per-session progress.

import { test } from "node:test";
import assert from "node:assert/strict";
import { Path } from "../src/structures/domain.ts";
import {
    LAYER1_PROGRESS_LABEL_READING_SNAPSHOTS,
    collectViewSnapshotsByRelativePath,
    convertToProjectRelativePath,
} from "../src/layer1_snapshot_wire.ts";
import { createTempDir } from "./overrides-test-helpers.ts";
import { makeFixtureDiskFolder } from "./layer1-view-test-helpers.ts";
import {
    SESSION_ONE,
    SESSION_TWO,
    SNAPSHOT_ONLY_INSTANT,
    buildSessionCwdRecord,
    buildSnapshotRecord,
    writeSessionTranscript,
} from "./layer1-snapshot-wire-test-helpers.ts";

test("test_convertToProjectRelativePath_requires_the_separator_so_a_sibling_folder_cannot_pass", () => {
    // Without the "/", "/tmp/ab/x.ts" would read as project-relative "b/x.ts" under "/tmp/a".
    assert.equal(convertToProjectRelativePath(new Path("/tmp/a"), "/tmp/a/src/x.ts"), "src/x.ts");
    assert.equal(convertToProjectRelativePath(new Path("/tmp/a"), "/tmp/ab/x.ts"), undefined);
});

test("test_collectViewSnapshotsByRelativePath_keys_by_project_relative_path_and_counts_each_session", () => {
    const diskDir = makeFixtureDiskFolder();
    const treeRoot = createTempDir();
    const first = writeSessionTranscript(treeRoot, SESSION_ONE, [
        buildSessionCwdRecord(diskDir, SESSION_ONE),
        buildSnapshotRecord("shared.txt", "aaa111@v2", 2, "2026-07-01T17:00:00.000Z"),
    ]);
    // Passed SECOND but instant-EARLIER, so a missing cross-session sort shows up as reversed order.
    const second = writeSessionTranscript(treeRoot, SESSION_TWO, [
        buildSessionCwdRecord(diskDir, SESSION_TWO),
        buildSnapshotRecord("shared.txt", "ccc333@v1", 1, "2026-07-01T11:00:00.000Z"),
    ]);
    const labels: string[] = [];
    const byPath = collectViewSnapshotsByRelativePath(new Path(diskDir), [first, second], (event) => {
        labels.push(`${event.label} ${event.current}/${event.total}`);
    });
    const placements = byPath.get("shared.txt");
    assert.ok(placements, "no placements keyed by the project-relative path");
    assert.deepEqual(placements.map((placement) => placement.instant.toISOString()), [
        "2026-07-01T11:00:00.000Z",
        "2026-07-01T17:00:00.000Z",
    ]);
    assert.deepEqual(labels, [
        `${LAYER1_PROGRESS_LABEL_READING_SNAPSHOTS} 1/2`,
        `${LAYER1_PROGRESS_LABEL_READING_SNAPSHOTS} 2/2`,
    ]);
});

test("test_collectViewSnapshotsByRelativePath_drops_a_session_that_wrote_outside_the_project_folder", () => {
    const diskDir = makeFixtureDiskFolder();
    const treeRoot = createTempDir();
    const elsewhere = writeSessionTranscript(treeRoot, SESSION_ONE, [
        buildSessionCwdRecord("/somewhere/else", SESSION_ONE),
        buildSnapshotRecord("shared.txt", "aaa111@v1", 1, SNAPSHOT_ONLY_INSTANT),
    ]);
    assert.equal(collectViewSnapshotsByRelativePath(new Path(diskDir), [elsewhere]).size, 0);
});

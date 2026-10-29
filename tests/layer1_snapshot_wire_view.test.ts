// Task 312: snapshot nodes in the built Layer 1 view, the shared ruler, and the client mirror.

import { test } from "node:test";
import assert from "node:assert/strict";
import { Path } from "../src/structures/domain.ts";
import { buildLayer1View } from "../src/viewer_api_layer1.ts";
import { RULER_NODE_ROW_PIXELS } from "../webapp/layer1-ruler-axis.ts";
import { relayOutLayer1View } from "../webapp/layer1-filter.ts";
import {
    SHARED_FILE_MTIME,
    createFixtureDiskFolder,
    createFixtureRepo,
} from "./layer1-view-test-helpers.ts";
import {
    SESSION_ONE,
    SNAPSHOT_ONLY_INSTANT,
    writeFixtureSessions,
} from "./layer1-snapshot-wire-test-helpers.ts";

test("test_buildLayer1View_gives_a_snapshot_only_instant_its_own_ruler_entry", () => {
    const diskDir = createFixtureDiskFolder();
    const view = buildLayer1View(new Path(diskDir), new Path(createFixtureRepo()), "HEAD",
        undefined, undefined, writeFixtureSessions(diskDir));
    const tick = view.ruler.find((entry) => entry.instant.toISOString() === SNAPSHOT_ONLY_INSTANT);
    assert.ok(tick, "the snapshot-only instant is missing from the ruler");
    assert.equal(tick.eventCount, 1);
});

test("test_buildLayer1View_counts_a_snapshot_alongside_the_node_it_shares_an_instant_with", () => {
    const diskDir = createFixtureDiskFolder();
    const view = buildLayer1View(new Path(diskDir), new Path(createFixtureRepo()), "HEAD",
        undefined, undefined, writeFixtureSessions(diskDir));
    const pair = view.pairs.find((candidate) => candidate.path.toString() === "shared.txt")!;
    const mtimeMs = new Date(SHARED_FILE_MTIME).getTime();
    const tick = view.ruler.find((entry) => entry.instant.getTime() === mtimeMs)!;
    // The on-disk node and the snapshot both draw here, so the tick stands for two events.
    assert.equal(tick.eventCount, 2);
    assert.equal(pair.onDisk.axisPx, tick.axisPx);
    const tied = pair.snapshots!.find((snapshot) => snapshot.instant.getTime() === mtimeMs)!;
    // Snapshots are APPENDED to the ladder, so the tied one takes the row BELOW the on-disk node.
    assert.equal(tied.axisPx, tick.axisPx + RULER_NODE_ROW_PIXELS);
    assert.equal(tied.version, 2);
    assert.equal(tied.sessionId.toString(), SESSION_ONE);
});

test("test_buildLayer1View_carries_snapshots_on_a_disk_orphan", () => {
    const diskDir = createFixtureDiskFolder();
    const view = buildLayer1View(new Path(diskDir), new Path(createFixtureRepo()), "HEAD",
        undefined, undefined, writeFixtureSessions(diskDir));
    const orphan = view.diskOrphans.find((candidate) => candidate.path.toString() === "disk-only.txt")!;
    assert.equal(orphan.snapshots?.length, 1);
    assert.equal(orphan.snapshots![0]!.axisPx, orphan.axisPx + RULER_NODE_ROW_PIXELS);
});

test("test_buildLayer1View_omits_snapshots_entirely_when_no_session_is_supplied", () => {
    const diskDir = createFixtureDiskFolder();
    const repoDir = createFixtureRepo();
    const withSessions = buildLayer1View(new Path(diskDir), new Path(repoDir), "HEAD",
        undefined, undefined, writeFixtureSessions(diskDir));
    const without = buildLayer1View(new Path(diskDir), new Path(repoDir), "HEAD");
    // A snapshot-free build carries no `snapshots` KEY at all: an absent key differs from [] under deep equality.
    assert.ok(without.pairs.every((pair) => !("snapshots" in pair)));
    assert.ok(without.diskOrphans.every((orphan) => !("snapshots" in orphan)));
    // README of the difference: only the snapshot-bearing build gained ruler entries.
    assert.ok(withSessions.ruler.length > without.ruler.length);
});

test("test_relayOutLayer1View_reproduces_the_servers_offsets_for_a_snapshot_bearing_view", () => {
    const diskDir = createFixtureDiskFolder();
    const served = JSON.parse(JSON.stringify(buildLayer1View(
        new Path(diskDir), new Path(createFixtureRepo()), "HEAD", undefined, undefined, writeFixtureSessions(diskDir),
    )));
    // The client mirrors the server's ladder; if it added snapshots differently the offsets would disagree.
    assert.deepEqual(relayOutLayer1View(served), served);
});

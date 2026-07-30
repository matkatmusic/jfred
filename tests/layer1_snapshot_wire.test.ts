// Task 312 (spec S19): snapshot nodes on the Layer 1 wire, the shared ruler, and the client mirror.  Every transcript is a temp file loaded through loadTranscript, so the live ~/.claude/file-history is never reached.

import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { Path } from "../src/structures/domain.ts";
import { RecordType } from "../src/structures/vocabulary.ts";
import { buildLayer1View } from "../src/viewer_api_layer1.ts";
import {
    LAYER1_PROGRESS_LABEL_READING_SNAPSHOTS,
    collectViewSnapshotsByRelativePath,
    relativizeToProjectFolder,
} from "../src/layer1_snapshot_wire.ts";
import { RULER_NODE_ROW_PIXELS } from "../webapp/layer1-ruler-axis.ts";
import { relayOutLayer1View } from "../webapp/layer1-filter.ts";
import { makeTempDir } from "./overrides-test-helpers.ts";
import {
    DISK_ONLY_FILE_MTIME,
    SHARED_FILE_MTIME,
    makeFixtureDiskFolder,
    makeFixtureRepo,
} from "./layer1-view-test-helpers.ts";

const SESSION_ONE = "b21d84c5-0000-0000-0000-000000000001";
const SESSION_TWO = "d4a06b8f-0000-0000-0000-000000000002";

// An instant no commit and no mtime occupies, so a ruler entry there can only be the snapshot's.
const SNAPSHOT_ONLY_INSTANT = "2026-07-01T16:00:00.000Z";

function buildSessionCwdRecord(cwd: string, sessionId: string): object {
    return { type: RecordType.user, cwd, sessionId, message: { role: "user", content: "hi" } };
}

function buildSnapshotRecord(path: string, backupFileName: string, version: number, backupTime: string): object {
    return {
        type: RecordType.fileHistorySnapshot,
        messageId: `m-${path}-${backupTime}`,
        isSnapshotUpdate: false,
        snapshot: {
            messageId: `m-${path}-${backupTime}`,
            timestamp: backupTime,
            trackedFileBackups: { [path]: { backupFileName, version, backupTime } },
        },
    };
}

function writeSessionTranscript(treeRoot: string, sessionId: string, records: object[]): Path {
    const projectDir = join(treeRoot, "projects", "-demo");
    mkdirSync(projectDir, { recursive: true });
    const jsonlPath = join(projectDir, `${sessionId}.jsonl`);
    writeFileSync(jsonlPath, records.map((record) => JSON.stringify(record)).join("\n") + "\n");
    return new Path(jsonlPath);
}

// One session snapshotting shared.txt twice — once where nothing else sits, once ON its mtime — and disk-only.txt on ITS mtime.
function writeFixtureSessions(diskDir: string): Path[] {
    const treeRoot = makeTempDir();
    return [
        writeSessionTranscript(treeRoot, SESSION_ONE, [
            buildSessionCwdRecord(diskDir, SESSION_ONE),
            buildSnapshotRecord("shared.txt", "aaa111@v1", 1, SNAPSHOT_ONLY_INSTANT),
            buildSnapshotRecord("shared.txt", "aaa111@v2", 2, new Date(SHARED_FILE_MTIME).toISOString()),
            buildSnapshotRecord("disk-only.txt", "bbb222@v1", 1, new Date(DISK_ONLY_FILE_MTIME).toISOString()),
        ]),
    ];
}

test("test_relativizeToProjectFolder_requires_the_separator_so_a_sibling_folder_cannot_pass", () => {
    // Without the "/", "/tmp/ab/x.ts" would read as project-relative "b/x.ts" under "/tmp/a".
    assert.equal(relativizeToProjectFolder(new Path("/tmp/a"), "/tmp/a/src/x.ts"), "src/x.ts");
    assert.equal(relativizeToProjectFolder(new Path("/tmp/a"), "/tmp/ab/x.ts"), undefined);
});

test("test_collectViewSnapshotsByRelativePath_keys_by_project_relative_path_and_counts_each_session", () => {
    const diskDir = makeFixtureDiskFolder();
    const treeRoot = makeTempDir();
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
    const treeRoot = makeTempDir();
    const elsewhere = writeSessionTranscript(treeRoot, SESSION_ONE, [
        buildSessionCwdRecord("/somewhere/else", SESSION_ONE),
        buildSnapshotRecord("shared.txt", "aaa111@v1", 1, SNAPSHOT_ONLY_INSTANT),
    ]);
    assert.equal(collectViewSnapshotsByRelativePath(new Path(diskDir), [elsewhere]).size, 0);
});

test("test_buildLayer1View_gives_a_snapshot_only_instant_its_own_ruler_entry", () => {
    const diskDir = makeFixtureDiskFolder();
    const view = buildLayer1View(new Path(diskDir), new Path(makeFixtureRepo()), "HEAD",
        undefined, undefined, writeFixtureSessions(diskDir));
    const tick = view.ruler.find((entry) => entry.instant.toISOString() === SNAPSHOT_ONLY_INSTANT);
    assert.ok(tick, "the snapshot-only instant is missing from the ruler");
    assert.equal(tick.eventCount, 1);
});

test("test_buildLayer1View_counts_a_snapshot_alongside_the_node_it_shares_an_instant_with", () => {
    const diskDir = makeFixtureDiskFolder();
    const view = buildLayer1View(new Path(diskDir), new Path(makeFixtureRepo()), "HEAD",
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
    const diskDir = makeFixtureDiskFolder();
    const view = buildLayer1View(new Path(diskDir), new Path(makeFixtureRepo()), "HEAD",
        undefined, undefined, writeFixtureSessions(diskDir));
    const orphan = view.diskOrphans.find((candidate) => candidate.path.toString() === "disk-only.txt")!;
    assert.equal(orphan.snapshots?.length, 1);
    assert.equal(orphan.snapshots![0]!.axisPx, orphan.axisPx + RULER_NODE_ROW_PIXELS);
});

test("test_buildLayer1View_omits_snapshots_entirely_when_no_session_is_supplied", () => {
    const diskDir = makeFixtureDiskFolder();
    const repoDir = makeFixtureRepo();
    const withSessions = buildLayer1View(new Path(diskDir), new Path(repoDir), "HEAD",
        undefined, undefined, writeFixtureSessions(diskDir));
    const without = buildLayer1View(new Path(diskDir), new Path(repoDir), "HEAD");
    // A snapshot-free build carries no `snapshots` KEY at all — an absent key differs from [] under deep equality.
    assert.ok(without.pairs.every((pair) => !("snapshots" in pair)));
    assert.ok(without.diskOrphans.every((orphan) => !("snapshots" in orphan)));
    // README of the difference: only the snapshot-bearing build gained ruler entries.
    assert.ok(withSessions.ruler.length > without.ruler.length);
});

test("test_relayOutLayer1View_reproduces_the_servers_offsets_for_a_snapshot_bearing_view", () => {
    const diskDir = makeFixtureDiskFolder();
    const served = JSON.parse(JSON.stringify(buildLayer1View(
        new Path(diskDir), new Path(makeFixtureRepo()), "HEAD", undefined, undefined, writeFixtureSessions(diskDir),
    )));
    // The client mirrors the server's ladder; if it added snapshots differently the offsets would disagree.
    assert.deepEqual(relayOutLayer1View(served), served);
});

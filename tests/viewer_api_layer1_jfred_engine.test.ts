// Task 361 gap 605: unknown files at the mark, from fake histories and beacons.

import assert from "node:assert/strict";
import { test } from "node:test";
import { BeaconSource, type BeaconCandidate } from "../src/layer1_beacon_candidates.ts";
import type { FileHistory, FileRevision } from "../src/reconstruction_events.ts";
import { Path, Uuid } from "../src/structures/domain.ts";
import { EventKind } from "../src/structures/vocabulary.ts";
import { buildCommitPathOverrides, listUnrebuiltFilesAt } from "../src/viewer_api_layer1_jfred_engine.ts";

const PROJECT_DIR = new Path("/proj");
const REASON = "Error: hunk does not fit";
const T2 = "2026-07-01T12:00:00.000Z";
const T3 = "2026-07-01T13:00:00.000Z";
const T4 = "2026-07-01T14:00:00.000Z";
const MARK = "2026-07-01T15:00:00.000Z";
const T6 = "2026-07-01T16:00:00.000Z";
const T7 = "2026-07-01T17:00:00.000Z";

function buildRevision(kind: EventKind, iso: string, isFailed: boolean = false): FileRevision {
    const timestamp = new Date(iso);
    const revision: FileRevision = { kind, changeId: new Uuid(`${kind}-${iso}`), timestamp, lines: [{ oldLineNum: 0, values: [{ line: "text", timestamp }] }] };
    if (isFailed) {
        revision.unrecoverable = { reason: REASON };
    }
    return revision;
}

function buildHistory(target: string, revisions: FileRevision[]): FileHistory {
    return { target: new Path(target), revisions };
}

function buildBeacon(iso: string): BeaconCandidate {
    return { source: BeaconSource.commit, instant: new Date(iso), content: "beacon text" };
}

function listBeaconsAt(...instants: string[]): (target: Path) => BeaconCandidate[] {
    return (): BeaconCandidate[] => instants.map(buildBeacon);
}

function listFor(histories: FileHistory[], listBeacons: (target: Path) => BeaconCandidate[]) {
    return listUnrebuiltFilesAt(PROJECT_DIR, histories, new Date(MARK), listBeacons);
}

test("test_failure_at_the_mark_returns_unrebuilt_with_the_next_beacon", () => {
    // A failed edit sits exactly at the mark; a Write after the mark is the next beacon.
    const history = buildHistory("/proj/a.txt", [buildRevision(EventKind.write, T2), buildRevision(EventKind.edit, MARK, true), buildRevision(EventKind.write, T7)]);
    const files = listFor([history], listBeaconsAt());
    assert.deepEqual(files, [{ relativePath: "a.txt", reason: REASON, nextInstant: new Date(T7) }]);
});

test("test_older_failure_without_a_later_beacon_returns_unrebuilt", () => {
    // The failure is older than the mark; only an edit follows it, and edits never count.
    const history = buildHistory("/proj/a.txt", [buildRevision(EventKind.write, T2), buildRevision(EventKind.edit, T3, true), buildRevision(EventKind.edit, T4), buildRevision(EventKind.write, T7)]);
    const files = listFor([history], listBeaconsAt());
    assert.deepEqual(files, [{ relativePath: "a.txt", reason: REASON, nextInstant: new Date(T7) }]);
});

test("test_beacon_after_the_failure_lets_the_commit_go_on_by_a_later_revision", () => {
    // A Write between the failure and the mark makes the text known again.
    const history = buildHistory("/proj/a.txt", [buildRevision(EventKind.write, T2), buildRevision(EventKind.edit, T3, true), buildRevision(EventKind.write, T4)]);
    assert.deepEqual(listFor([history], listBeaconsAt()), []);
});

test("test_beacon_after_the_failure_lets_the_commit_go_on_by_a_listed_beacon", () => {
    // A listed beacon between the failure and the mark makes the text known again.
    const history = buildHistory("/proj/a.txt", [buildRevision(EventKind.write, T2), buildRevision(EventKind.edit, T3, true)]);
    assert.deepEqual(listFor([history], listBeaconsAt(T4)), []);
});

test("test_unknown_file_with_no_later_beacon_has_no_next_instant", () => {
    // Nothing known follows the failure, so the file has no next beacon.
    const history = buildHistory("/proj/a.txt", [buildRevision(EventKind.write, T2), buildRevision(EventKind.edit, T3, true), buildRevision(EventKind.edit, T4)]);
    assert.deepEqual(listFor([history], listBeaconsAt()), [{ relativePath: "a.txt", reason: REASON, nextInstant: undefined }]);
});

test("test_file_outside_the_folder_never_blocks_the_commit", () => {
    // A failed file outside the page folder is not part of the repo.
    const history = buildHistory("/elsewhere/a.txt", [buildRevision(EventKind.write, T2), buildRevision(EventKind.edit, T3, true)]);
    assert.deepEqual(listFor([history], listBeaconsAt()), []);
});

test("test_buildCommitPathOverrides_gives_one_source_per_projects_folder", () => {
    // Chats from two log folders give two sources and no shared history root.
    const sessionFiles = [new Path("/a/projects/p1/x.jsonl"), new Path("/a/projects/p1/y.jsonl"), new Path("/b/projects/p2/z.jsonl")];
    const overrides = buildCommitPathOverrides(PROJECT_DIR, new Path("/repo"), sessionFiles);
    assert.deepEqual(overrides.sources!.map((source) => source.projectsDir.toString()), ["/a/projects", "/b/projects"]);
    assert.equal(overrides.fileHistoryRoot, undefined);
});

test("test_buildCommitPathOverrides_gives_one_source_for_flat_and_subagent_logs_of_one_claude_data", () => {
    // A flat log and a subagent log of the same claude-data share one projects folder.
    const sessionFiles = [new Path("/a/projects/p1/sid.jsonl"), new Path("/a/projects/p1/sid/subagents/agent-x.jsonl")];
    const overrides = buildCommitPathOverrides(PROJECT_DIR, new Path("/repo"), sessionFiles);
    assert.deepEqual(overrides.sources!.map((source) => source.projectsDir.toString()), ["/a/projects"]);
});

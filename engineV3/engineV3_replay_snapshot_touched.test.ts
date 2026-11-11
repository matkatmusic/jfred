import { test, type TestContext } from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { Path } from "../src/structures/domain.ts";
import { TimelineEventKind, type CommitHash, type TimelineEvent } from "./engineV3.ts";
import { loadMergedJSONLLines } from "./engineV3_jsonl_lines.ts";
import { collectBashCallResults } from "./engineV3_replay_bash_results.ts";
import { collectWriteEditResultLines } from "./engineV3_replay_tool_results.ts";
import { executeReplay } from "./engineV3_replay.ts";
import { createSnapshotLoop, writeSnapshotAfterEvent } from "./engineV3_replay_snapshot_loop.ts";
import { applyEventSnapshots } from "./engineV3_replay_snapshot_restore.ts";
import { createSnapshotLoopAtEvent } from "./engineV3_replay_snapshot_start_at.ts";
import { makeTempFolder } from "./engineV3_replay_snapshot_testing.ts";
import { writeEventSnapshot } from "./engineV3_replay_snapshot_write.ts";
import { clearTouchedPaths, listTouchedAbsolutePaths, listTouchedPaths, recordTouchedPath } from "./engineV3_replay_touched.ts";

const START_AT_EVENT = 3;
// file name and content: events 1 to 5 each write one file
const WRITES: [string, string][] = [["a.txt", "a1"], ["b.txt", "b1"], ["a.txt", "a2"], ["c.txt", "c1"], ["d.txt", "d1"]];

function createCommitEvent(commit: string): TimelineEvent {
  return { type: TimelineEventKind.GitCommit, commit: commit as unknown as CommitHash, timestamp: 0 };
}

function readEventFile(store: Path, eventFileName: string): any {
  return JSON.parse(readFileSync(join(store.toString(), "events", eventFileName), "utf8"));
}

function createWriteLine(state: Path, index: number): string {
  const [fileName, content] = WRITES[index]!;
  const timestamp = new Date(Date.UTC(2026, 9, 27, 0, 0, index + 1)).toISOString();
  const toolUseResult = { type: "create", filePath: join(state.toString(), fileName), content, structuredPatch: [], originalFile: null, userModified: false };
  return JSON.stringify({ type: "user", uuid: `u-${index}`, timestamp, toolUseResult });
}

test("test_writeSnapshotAfterEvent_stores_only_the_paths_first_touched_during_that_event", (t) => {
  // Scenario: each event file lists only the paths the replay touched for the first time during that event.
  clearTouchedPaths();
  const store = makeTempFolder(t, "touched-store-");
  const folder = makeTempFolder(t, "touched-work-");
  // a path is touched before the loop starts
  recordTouchedPath("/work/before.txt");
  const snapshotLoop = createSnapshotLoop(store, [folder]);
  // event 1 touches first.txt and touches before.txt again
  recordTouchedPath("/work/first.txt");
  recordTouchedPath("/work/before.txt");
  writeSnapshotAfterEvent(snapshotLoop, createCommitEvent("aaa"), "2026-11-10T00:00:00.000Z one", folder, new Map());
  // event 2 touches second.txt
  recordTouchedPath("/work/second.txt");
  writeSnapshotAfterEvent(snapshotLoop, createCommitEvent("bbb"), "2026-11-10T00:00:01.000Z two", folder, new Map());
  // each event file lists only its own new path
  assert.deepEqual(readEventFile(store, "000001_commit_aaa.json").touched, ["/work/first.txt"]);
  assert.deepEqual(readEventFile(store, "000002_commit_bbb.json").touched, ["/work/second.txt"]);
});

test("test_applyEventSnapshots_records_the_touched_paths_of_the_applied_events", (t) => {
  // Scenario: restoring events 0 and 1 records their touched paths, and not the paths of event 2.
  clearTouchedPaths();
  const store = makeTempFolder(t, "touched-store-");
  // the store holds events 0 to 2, each with one touched path
  for (const [eventNumber, touchedPath] of ["/work/a.txt", "/work/b.txt", "/work/c.txt"].entries()) {
    writeEventSnapshot(store, `00000${eventNumber}_x_${eventNumber}.json`, { event: eventNumber, eventText: "text", previousEvent: null, touched: [touchedPath], changes: [] });
  }
  // restore with start event 2
  applyEventSnapshots(store, 2);
  // only the paths of events 0 and 1 are recorded
  assert.deepEqual(listTouchedAbsolutePaths(), ["/work/a.txt", "/work/b.txt"]);
});

test("test_applyEventSnapshots_throws_on_an_event_file_with_no_touched_list", (t) => {
  // Scenario: an event file from an older store has no touched field, so the restore cannot be complete.
  clearTouchedPaths();
  const store = makeTempFolder(t, "touched-store-");
  // write event 0 without a touched field
  mkdirSync(join(store.toString(), "events"));
  writeFileSync(join(store.toString(), "events", "000000_x_0.json"), JSON.stringify({ event: 0, eventText: "text", previousEvent: null, changes: [] }));
  // the restore throws and names the file
  assert.throws(() => applyEventSnapshots(store, 1), /applyEventSnapshots: 000000_x_0\.json has no touched list; make the store again with a full run from event 0/);
});

function emptyFolder(folder: Path): void {
  for (const entry of readdirSync(folder.toString())) {
    rmSync(join(folder.toString(), entry), { recursive: true });
  }
}

function writeJsonlFolder(t: TestContext, state: Path): Path {
  const jsonlFolder = makeTempFolder(t, "touched-jsonl-");
  const lineTexts: string[] = [];
  for (const index of WRITES.keys()) {
    lineTexts.push(createWriteLine(state, index));
  }
  writeFileSync(join(jsonlFolder.toString(), "s1.jsonl"), lineTexts.join("\n") + "\n");
  return jsonlFolder;
}

test("test_executeReplay_started_at_event_M_ends_with_the_same_touched_paths_as_a_full_run", (t) => {
  // Scenario: a replay started at event 3 ends with the touched paths of the full replay.
  const state = makeTempFolder(t, "touched-state-");
  const store = makeTempFolder(t, "touched-store-");
  const jsonlFolder = writeJsonlFolder(t, state);
  const lines = loadMergedJSONLLines([jsonlFolder.toString()]).jsonlLines;
  const context = { bashCallResults: collectBashCallResults(lines), writeEditResultLines: collectWriteEditResultLines(lines), sourceRepo: undefined };
  // full run with a snapshot loop
  clearTouchedPaths();
  executeReplay(state, undefined, [jsonlFolder], [], context, createSnapshotLoop(store, [state]));
  const fullRunTouchedPaths = listTouchedPaths(state);
  // clear the touched paths and empty the state folder, then start at event 3
  clearTouchedPaths();
  emptyFolder(state);
  const snapshotLoop = createSnapshotLoopAtEvent(store, state, [], START_AT_EVENT);
  executeReplay(state, undefined, [jsonlFolder], [], context, snapshotLoop, undefined, START_AT_EVENT);
  // the touched paths equal the full run's list
  assert.deepEqual(listTouchedPaths(state), fullRunTouchedPaths);
});

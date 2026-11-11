import { test, type TestContext } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { Path } from "../src/structures/domain.ts";
import { loadMergedJSONLLines } from "./engineV3_jsonl_lines.ts";
import { collectBashCallResults } from "./engineV3_replay_bash_results.ts";
import { collectWriteEditResultLines } from "./engineV3_replay_tool_results.ts";
import { executeReplay } from "./engineV3_replay.ts";
import type { ScriptReplayContext } from "./engineV3_replay_script.ts";
import { createSnapshotLoop } from "./engineV3_replay_snapshot_loop.ts";
import { writeEventSnapshot } from "./engineV3_replay_snapshot_write.ts";
import { makeTempFolder } from "./engineV3_replay_snapshot_testing.ts";
import { assertEventTextMatchesStore, createSnapshotLoopAtEvent } from "./engineV3_replay_snapshot_start_at.ts";

type FullRun = { state: Path; store: Path; jsonlFolder: Path; context: ScriptReplayContext };

const START_AT_EVENT = 3;
// file name and content: events 1 to 5 each write one file
const WRITES: [string, string][] = [["a.txt", "a1"], ["b.txt", "b1"], ["a.txt", "a2"], ["c.txt", "c1"], ["d.txt", "d1"]];

function createWriteLine(state: Path, index: number): string {
  const [fileName, content] = WRITES[index]!;
  const timestamp = new Date(Date.UTC(2026, 9, 27, 0, 0, index + 1)).toISOString();
  const toolUseResult = { type: "create", filePath: join(state.toString(), fileName), content, structuredPatch: [], originalFile: null, userModified: false };
  return JSON.stringify({ type: "user", uuid: `u-${index}`, timestamp, toolUseResult });
}

function runFullReplay(t: TestContext): FullRun {
  const state = makeTempFolder(t, "start-at-state-");
  const store = makeTempFolder(t, "start-at-store-");
  const jsonlFolder = makeTempFolder(t, "start-at-jsonl-");
  const lineTexts: string[] = [];
  for (const index of WRITES.keys()) {
    lineTexts.push(createWriteLine(state, index));
  }
  writeFileSync(join(jsonlFolder.toString(), "s1.jsonl"), lineTexts.join("\n") + "\n");
  const lines = loadMergedJSONLLines([jsonlFolder.toString()]).jsonlLines;
  const context = { bashCallResults: collectBashCallResults(lines), writeEditResultLines: collectWriteEditResultLines(lines), sourceRepo: undefined };
  executeReplay(state, undefined, [jsonlFolder], [], context, createSnapshotLoop(store, [state]));
  return { state, store, jsonlFolder, context };
}

function readEventFiles(store: Path): Map<string, any> {
  const eventFiles = new Map<string, any>();
  for (const eventFileName of readdirSync(join(store.toString(), "events")).sort()) {
    eventFiles.set(eventFileName, JSON.parse(readFileSync(join(store.toString(), "events", eventFileName), "utf8")));
  }
  return eventFiles;
}

function readStateFiles(state: Path): Map<string, string> {
  const stateFiles = new Map<string, string>();
  for (const fileName of readdirSync(state.toString())) {
    stateFiles.set(fileName, readFileSync(join(state.toString(), fileName), "utf8"));
  }
  return stateFiles;
}

function emptyFolder(folder: Path): void {
  for (const entry of readdirSync(folder.toString())) {
    rmSync(join(folder.toString(), entry), { recursive: true });
  }
}

function restoreAndReplayFromStartAt(fullRun: FullRun): void {
  emptyFolder(fullRun.state);
  const snapshotLoop = createSnapshotLoopAtEvent(fullRun.store, fullRun.state, [], START_AT_EVENT);
  executeReplay(fullRun.state, undefined, [fullRun.jsonlFolder], [], fullRun.context, snapshotLoop, undefined, START_AT_EVENT);
}

function writeStoredEvent(store: Path, eventText: string): void {
  writeEventSnapshot(store, "000003_s1_3.json", { event: 3, eventText, previousEvent: null, touched: [], changes: [] });
}

test("test_assertEventTextMatchesStore_throws_when_the_event_text_before_the_start_differs", (t) => {
  // Scenario: the stored event text and the replayed event text differ, so the timeline changed.
  // the store holds event 3 with the text "next event: a"
  const store = makeTempFolder(t, "start-at-store-");
  writeStoredEvent(store, "next event: a");
  // the replay sees "next event: b" for that event; the error names the change and both texts
  assert.throws(() => assertEventTextMatchesStore(store, "000003_s1_3.json", "2026-11-10T00:00:00.000Z next event: b"), /timeline changed[\s\S]*next event: a[\s\S]*next event: b/);
});

test("test_assertEventTextMatchesStore_passes_when_only_the_time_stamp_differs", (t) => {
  // Scenario: the same event text with another time stamp is not a timeline change.
  // the store holds event 3 with the text "next event: a"
  const store = makeTempFolder(t, "start-at-store-");
  writeStoredEvent(store, "next event: a");
  // the replay sees the same text with a time stamp in front; nothing throws
  assertEventTextMatchesStore(store, "000003_s1_3.json", "2026-11-10T00:00:00.000Z next event: a");
});

test("test_createSnapshotLoopAtEvent_rebuilds_the_files_and_continues_the_event_numbers", (t) => {
  // Scenario: starting at event 3 rebuilds the files after event 2 and numbers the next event 3.
  const fullRun = runFullReplay(t);
  emptyFolder(fullRun.state);
  // make the loop at event 3
  const snapshotLoop = createSnapshotLoopAtEvent(fullRun.store, fullRun.state, [], START_AT_EVENT);
  // the files are as they were after event 2
  assert.deepEqual(readStateFiles(fullRun.state), new Map([["a.txt", "a1"], ["b.txt", "b1"]]));
  // the loop continues after event 2, and the events from 3 on are out of the events folder
  assert.equal(snapshotLoop.eventNumber, 2);
  assert.match(snapshotLoop.previousEventFileName, /^000002_/);
  assert.equal(readEventFiles(fullRun.store).size, 3);
});

test("test_executeReplay_started_at_event_M_writes_the_same_changes_as_a_full_run", (t) => {
  // Scenario: a replay started at event 3 writes the same event files and files as the full replay.
  const fullRun = runFullReplay(t);
  const fullEventFiles = readEventFiles(fullRun.store);
  const fullStateFiles = readStateFiles(fullRun.state);
  // empty the state folder, then restore and replay from event 3
  restoreAndReplayFromStartAt(fullRun);
  // the event files from event 3 on have the same event, eventText, previousEvent and changes
  const startedEventFiles = readEventFiles(fullRun.store);
  assert.deepEqual([...startedEventFiles.keys()], [...fullEventFiles.keys()]);
  for (const [eventFileName, fullEventFile] of fullEventFiles) {
    const { event, eventText, previousEvent, changes } = startedEventFiles.get(eventFileName);
    assert.deepEqual({ event, eventText, previousEvent, changes }, { event: fullEventFile.event, eventText: fullEventFile.eventText, previousEvent: fullEventFile.previousEvent, changes: fullEventFile.changes });
  }
  // the state folder holds the same files as after the full replay
  assert.deepEqual(readStateFiles(fullRun.state), fullStateFiles);
});

test("test_executeReplay_throws_when_the_stored_event_text_before_the_start_differs", (t) => {
  // Scenario: the stored text of event 2 differs from the replayed text, so the timeline changed.
  const fullRun = runFullReplay(t);
  // rewrite the stored text of event 2
  const eventFileName = "000002_s1_2.json";
  writeEventSnapshot(fullRun.store, eventFileName, { ...readEventFiles(fullRun.store).get(eventFileName), eventText: "next event: other" });
  // a replay started at event 3 throws
  assert.throws(() => restoreAndReplayFromStartAt(fullRun), /timeline changed/);
});

test("test_executeReplay_started_at_event_M_does_not_apply_events_before_M", (t) => {
  // Scenario: events 1 and 2 write b.txt and a.txt, but a replay started at event 3 must not run them again.
  const fullRun = runFullReplay(t);
  emptyFolder(fullRun.state);
  const snapshotLoop = createSnapshotLoopAtEvent(fullRun.store, fullRun.state, [], START_AT_EVENT);
  // put another text in b.txt after the restore
  writeFileSync(join(fullRun.state.toString(), "b.txt"), "marker");
  executeReplay(fullRun.state, undefined, [fullRun.jsonlFolder], [], fullRun.context, snapshotLoop, undefined, START_AT_EVENT);
  // b.txt keeps the marker, because event 2 was skipped; the events from 3 on were applied
  assert.deepEqual(readStateFiles(fullRun.state), new Map([["a.txt", "a2"], ["b.txt", "marker"], ["c.txt", "c1"], ["d.txt", "d1"]]));
  assert.equal(snapshotLoop.eventNumber, 5);
});

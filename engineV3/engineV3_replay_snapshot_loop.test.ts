import assert from "node:assert/strict";
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { test, type TestContext } from "node:test";
import { Path } from "../src/structures/domain.ts";
import { loadMergedJSONLLines } from "./engineV3_jsonl_lines.ts";
import { collectBashCallResults } from "./engineV3_replay_bash_results.ts";
import { collectWriteEditResultLines } from "./engineV3_replay_tool_results.ts";
import { executeReplay } from "./engineV3_replay.ts";
import { createStartState } from "./engineV3_replay_no_git.ts";
import { createSnapshotLoop, createSnapshotLoopIfRequested, moveExistingEventsToOld } from "./engineV3_replay_snapshot_loop.ts";

const SCENARIO_FOLDER = join(dirname(fileURLToPath(import.meta.url)), "..", "scenarios", "executed", "s5-bash-redirect");
const FILE_HISTORY_FOLDER = join(dirname(fileURLToPath(import.meta.url)), "..", "scenarios", "file-history");
const SESSION_ID = "1efc63be-c793-4f89-8401-e1c717f3d6e9";
const RECORDED_CWD = "/private/var/folders/fy/wg2tzrv957sg2vqjcvdkdzvm0000gn/T/run-scenario.xbhhfeky";
const S5_EVENT_COUNT = 75;

type ReplayedS5 = { store: string; stateFolder: string; eventFileNames: string[] };

function makeTempFolder(t: TestContext, prefix: string): string {
  const folder = realpathSync(mkdtempSync(join(tmpdir(), prefix)));
  t.after(() => rmSync(folder, { recursive: true, force: true }));
  return folder;
}

function readEventFile(store: string, eventFileName: string): any {
  return JSON.parse(readFileSync(join(store, "events", eventFileName), "utf8"));
}

function replayS5WithSnapshots(t: TestContext): ReplayedS5 {
  const stateFolder = makeTempFolder(t, "snap-loop-state-");
  const store = makeTempFolder(t, "snap-loop-store-");
  const jsonlFolder = makeTempFolder(t, "snap-loop-jsonl-");
  const recordedText = readFileSync(join(SCENARIO_FOLDER, `${SESSION_ID}.jsonl`), "utf8");
  writeFileSync(join(jsonlFolder, `${SESSION_ID}.jsonl`), recordedText.split(RECORDED_CWD).join(stateFolder));
  const startFolder = makeTempFolder(t, "snap-loop-start-");
  mkdirSync(join(startFolder, "tests"));
  cpSync(join(SCENARIO_FOLDER, "tests", "conftest.py"), join(startFolder, "tests", "conftest.py"));
  createStartState(undefined, new Path(startFolder), new Path(stateFolder));
  const snapshotLoop = createSnapshotLoop(new Path(store), [new Path(stateFolder)]);
  const lines = loadMergedJSONLLines([jsonlFolder]).jsonlLines;
  const context = { bashCallResults: collectBashCallResults(lines), writeEditResultLines: collectWriteEditResultLines(lines), sourceRepo: undefined, fileHistoryPath: new Path(FILE_HISTORY_FOLDER) };
  executeReplay(new Path(stateFolder), undefined, [new Path(jsonlFolder)], [], context, snapshotLoop);
  return { store, stateFolder, eventFileNames: readdirSync(join(store, "events")).sort() };
}

test("test_moveExistingEventsToOld_moves_the_event_files_into_old_and_keeps_the_blobs", (t) => {
  // Step 1: make a store with 1 event file and 1 blob.
  const store = makeTempFolder(t, "snap-loop-store-");
  mkdirSync(join(store, "events"));
  mkdirSync(join(store, "blobs"));
  writeFileSync(join(store, "events", "000000_start.json"), "{}");
  writeFileSync(join(store, "blobs", "abc"), "blob");
  // Step 2: move the existing events.
  moveExistingEventsToOld(new Path(store));
  // Step 3: events is gone, the file sits in old/<ISO time>/events, and the blob stays.
  assert.equal(existsSync(join(store, "events")), false);
  const oldRunFolders = readdirSync(join(store, "old"));
  assert.equal(oldRunFolders.length, 1);
  assert.match(oldRunFolders[0]!, /^\d{4}-\d\d-\d\dT/);
  assert.equal(readFileSync(join(store, "old", oldRunFolders[0]!, "events", "000000_start.json"), "utf8"), "{}");
  assert.equal(readFileSync(join(store, "blobs", "abc"), "utf8"), "blob");
});

test("test_moveExistingEventsToOld_does_nothing_when_the_events_folder_is_empty", (t) => {
  // Step 1: make a store with an empty events folder.
  const store = makeTempFolder(t, "snap-loop-store-");
  mkdirSync(join(store, "events"));
  // Step 2: move the existing events.
  moveExistingEventsToOld(new Path(store));
  // Step 3: no old folder is made.
  assert.equal(existsSync(join(store, "old")), false);
});

test("test_moveExistingEventsToOld_does_nothing_when_the_store_is_new", (t) => {
  // Step 1: use a store with no events folder.
  const store = makeTempFolder(t, "snap-loop-store-");
  // Step 2: move the existing events.
  moveExistingEventsToOld(new Path(store));
  // Step 3: the store stays empty.
  assert.deepEqual(readdirSync(store), []);
});

test("test_createSnapshotLoopIfRequested_returns_undefined_and_writes_nothing_without_a_snapshots_path", (t) => {
  // Step 1: ask for a loop with no snapshots path. Step 2: no loop comes back.
  const snapshotLoop = createSnapshotLoopIfRequested(undefined, new Path(makeTempFolder(t, "snap-loop-state-")), []);
  assert.equal(snapshotLoop, undefined);
});

test("test_createSnapshotLoop_writes_000000_start_with_every_file_added", (t) => {
  // Step 1: make a state folder with 2 files and a store.
  const stateFolder = makeTempFolder(t, "snap-loop-state-");
  const store = makeTempFolder(t, "snap-loop-store-");
  writeFileSync(join(stateFolder, "a.txt"), "a");
  writeFileSync(join(stateFolder, "b.txt"), "b");
  // Step 2: create the loop.
  createSnapshotLoop(new Path(store), [new Path(stateFolder)]);
  // Step 3: the start file lists both files as added, and has no previous event.
  const startFile = readEventFile(store, "000000_start.json");
  assert.deepEqual([startFile.event, startFile.previousEvent], [0, null]);
  assert.deepEqual(startFile.changes.map((change: any) => [change.path, change.change]), [[join(stateFolder, "a.txt"), "added"], [join(stateFolder, "b.txt"), "added"]]);
});

test("test_executeReplay_writes_one_event_file_per_event_in_order_with_the_previousEvent_chain", (t) => {
  // Step 1: replay s5 with snapshots on.
  const { store, eventFileNames } = replayS5WithSnapshots(t);
  // Step 2: there is the start file plus one file per event, numbered in order.
  assert.equal(eventFileNames.length, S5_EVENT_COUNT + 1);
  assert.equal(eventFileNames[0], "000000_start.json");
  // Step 3: each file names the file before it as its previousEvent, and holds its own event number.
  for (const [index, eventFileName] of eventFileNames.entries()) {
    assert.match(eventFileName, new RegExp(`^${String(index).padStart(6, "0")}_`));
    const eventFile = readEventFile(store, eventFileName);
    assert.equal(eventFile.event, index);
    assert.equal(eventFile.previousEvent, index === 0 ? null : eventFileNames[index - 1]);
  }
});

test("test_executeReplay_lists_s5_redirect_txt_as_added_in_the_event_for_line_33", (t) => {
  // Step 1: replay s5 with snapshots on.
  const { store, stateFolder, eventFileNames } = replayS5WithSnapshots(t);
  // Step 2: find the event file of line 33, the Write call line that the replay applies early.
  const line33FileNames = eventFileNames.filter((eventFileName) => eventFileName.endsWith(`${SESSION_ID}_33.json`));
  assert.equal(line33FileNames.length, 1);
  // Step 3: it lists s5_redirect.txt as added.
  const redirectChange = readEventFile(store, line33FileNames[0]!).changes.find((change: any) => change.path === join(stateFolder, "s5_redirect.txt"));
  assert.equal(redirectChange.change, "added");
  assert.match(redirectChange.contentHash, /^sha256:/);
});

test("test_executeReplay_writes_empty_changes_for_the_s5_write_result_line_34", (t) => {
  // Step 1: replay s5 with snapshots on.
  const { store, eventFileNames } = replayS5WithSnapshots(t);
  // Step 2: the event file of line 34, the Write result line, has no changes: line 33 already applied the Write.
  const line34FileName = eventFileNames.find((eventFileName) => eventFileName.endsWith(`${SESSION_ID}_34.json`))!;
  assert.deepEqual(readEventFile(store, line34FileName).changes, []);
});

test("test_executeReplay_writes_empty_changes_for_a_line_that_replays_nothing", (t) => {
  // Step 1: replay s5 with snapshots on.
  const { store, eventFileNames } = replayS5WithSnapshots(t);
  // Step 2: the event file of line 1 has an eventText with no time stamp and no changes.
  const line1FileName = eventFileNames.find((eventFileName) => eventFileName.endsWith(`${SESSION_ID}_1.json`))!;
  const eventFile = readEventFile(store, line1FileName);
  assert.match(eventFile.eventText, /^next event: source:.* line:1$/);
  assert.deepEqual(eventFile.changes, []);
});

import { test } from "node:test";
import assert from "node:assert/strict";
import { chmodSync, lstatSync, mkdirSync, readFileSync, readdirSync, readlinkSync, rmSync, statSync, symlinkSync } from "node:fs";
import { join } from "node:path";
import type { Path } from "../src/structures/domain.ts";

import { listChangesSinceLastScan } from "./engineV3_replay_snapshot.ts";
import { scanWatchedFolders, type FileStamp } from "./engineV3_replay_snapshot_scan.ts";
import { formatEventNumber, writeEventSnapshot } from "./engineV3_replay_snapshot_write.ts";
import { applyEventSnapshots, moveLaterEventsToOld, readEventSnapshotText } from "./engineV3_replay_snapshot_restore.ts";
import { makeTempFolder, writeFileIn } from "./engineV3_replay_snapshot_testing.ts";

type Recorder = { store: Path; folder: Path; previousScan: Map<string, FileStamp> };

function createEventFileName(eventNumber: number): string {
  return `${formatEventNumber(eventNumber)}_x_${eventNumber}.json`;
}

function recordEvent(recorder: Recorder, eventNumber: number): void {
  const currentScan = scanWatchedFolders([recorder.folder], [recorder.store], new Map());
  const changes = listChangesSinceLastScan(recorder.previousScan, currentScan);
  const snapshot = { event: eventNumber, eventText: `text ${eventNumber}`, previousEvent: null, touched: [], changes };
  writeEventSnapshot(recorder.store, createEventFileName(eventNumber), snapshot);
  recorder.previousScan = currentScan;
}

function listFileNames(folder: string): string[] {
  return readdirSync(folder).sort();
}

test("test_applyEventSnapshots_rebuilds_the_files_of_event_3_from_events_0_to_3", (t) => {
  // Scenario: restoring with start event 4 gives the files as they were after event 3, not event 4.
  const recorder: Recorder = { store: makeTempFolder(t, "snap-store-"), folder: makeTempFolder(t, "snap-work-"), previousScan: new Map() };
  // event 0 to 4 change files; event 4 must not be applied
  writeFileIn(recorder.folder, "a.txt", "a0");
  recordEvent(recorder, 0);
  writeFileIn(recorder.folder, "b.txt", "b1");
  writeFileIn(recorder.folder, "sub/c.txt", "c1");
  recordEvent(recorder, 1);
  writeFileIn(recorder.folder, "a.txt", "a2");
  recordEvent(recorder, 2);
  writeFileIn(recorder.folder, "d.txt", "d3");
  recordEvent(recorder, 3);
  writeFileIn(recorder.folder, "d.txt", "d4");
  recordEvent(recorder, 4);
  // empty the folder, then apply the events before event 4
  rmSync(recorder.folder.toString(), { recursive: true });
  const lastEventFileName = applyEventSnapshots(recorder.store, 4);
  // the files have the content of event 3 and the last applied file is event 3
  const folder = recorder.folder.toString();
  assert.equal(readFileSync(join(folder, "a.txt"), "utf8"), "a2");
  assert.equal(readFileSync(join(folder, "b.txt"), "utf8"), "b1");
  assert.equal(readFileSync(join(folder, "sub/c.txt"), "utf8"), "c1");
  assert.equal(readFileSync(join(folder, "d.txt"), "utf8"), "d3");
  assert.equal(lastEventFileName, createEventFileName(3));
});

test("test_applyEventSnapshots_removes_a_file_deleted_in_event_2", (t) => {
  // Scenario: a file that event 2 deleted is absent after restoring events 0 to 2.
  const recorder: Recorder = { store: makeTempFolder(t, "snap-store-"), folder: makeTempFolder(t, "snap-work-"), previousScan: new Map() };
  // event 0 adds 2 files, event 1 changes one, event 2 deletes the other
  writeFileIn(recorder.folder, "gone.txt", "g");
  writeFileIn(recorder.folder, "stays.txt", "s0");
  recordEvent(recorder, 0);
  writeFileIn(recorder.folder, "stays.txt", "s1");
  recordEvent(recorder, 1);
  rmSync(join(recorder.folder.toString(), "gone.txt"));
  recordEvent(recorder, 2);
  // put the deleted file back on disk, so the restore must remove it
  writeFileIn(recorder.folder, "gone.txt", "g");
  applyEventSnapshots(recorder.store, 3);
  // the deleted file is absent and the other file has its last content
  assert.deepEqual(listFileNames(recorder.folder.toString()), ["stays.txt"]);
  assert.equal(readFileSync(join(recorder.folder.toString(), "stays.txt"), "utf8"), "s1");
});

test("test_applyEventSnapshots_restores_a_symlink_and_a_file_mode", (t) => {
  // Scenario: a symlink keeps its target and an executable file keeps mode 755.
  const recorder: Recorder = { store: makeTempFolder(t, "snap-store-"), folder: makeTempFolder(t, "snap-work-"), previousScan: new Map() };
  // event 0 has an executable file and a symlink to it
  const folder = recorder.folder.toString();
  chmodSync(writeFileIn(recorder.folder, "run.sh", "echo"), 0o755);
  symlinkSync("run.sh", join(folder, "link"));
  recordEvent(recorder, 0);
  // empty the folder, then restore
  rmSync(folder, { recursive: true });
  mkdirSync(folder);
  applyEventSnapshots(recorder.store, 1);
  // the link points to the same target and the file mode is 755
  assert.equal(lstatSync(join(folder, "link")).isSymbolicLink(), true);
  assert.equal(readlinkSync(join(folder, "link")), "run.sh");
  assert.equal(statSync(join(folder, "run.sh")).mode & 0o777, 0o755);
});

test("test_applyEventSnapshots_throws_when_the_store_does_not_reach_the_event_before_the_start", (t) => {
  // Scenario: a store with events 0 and 1 cannot restore with start event 5.
  const recorder: Recorder = { store: makeTempFolder(t, "snap-store-"), folder: makeTempFolder(t, "snap-work-"), previousScan: new Map() };
  // write events 0 and 1
  writeFileIn(recorder.folder, "a.txt", "a");
  recordEvent(recorder, 0);
  recordEvent(recorder, 1);
  // apply with start event 5: event 4 does not exist, so it throws
  assert.throws(() => applyEventSnapshots(recorder.store, 5));
});

function writeEmptyEvents(store: Path, lastEventNumber: number): void {
  for (let eventNumber = 0; eventNumber <= lastEventNumber; eventNumber++) {
    const snapshot = { event: eventNumber, eventText: `text ${eventNumber}`, previousEvent: null, touched: [], changes: [] };
    writeEventSnapshot(store, createEventFileName(eventNumber), snapshot);
  }
}

test("test_moveLaterEventsToOld_moves_event_files_from_the_start_event_on_into_old", (t) => {
  // Scenario: events 2 and 3 move to old/<time>/events when the start event is 2.
  const store = makeTempFolder(t, "snap-store-");
  // write events 0 to 3, then move the events from 2 on
  writeEmptyEvents(store, 3);
  moveLaterEventsToOld(store, 2);
  // old holds one time folder with the events 2 and 3
  const oldFolder = join(store.toString(), "old");
  const timeFolders = listFileNames(oldFolder);
  assert.equal(timeFolders.length, 1);
  assert.deepEqual(listFileNames(join(oldFolder, timeFolders[0]!, "events")), [createEventFileName(2), createEventFileName(3)]);
});

test("test_moveLaterEventsToOld_keeps_event_files_before_the_start_event", (t) => {
  // Scenario: events 0 and 1 stay in events when the start event is 2.
  const store = makeTempFolder(t, "snap-store-");
  // write events 0 to 3, then move the events from 2 on
  writeEmptyEvents(store, 3);
  moveLaterEventsToOld(store, 2);
  // events holds only 0 and 1, and the event text can still be read
  const eventsFolder = join(store.toString(), "events");
  assert.deepEqual(listFileNames(eventsFolder), [createEventFileName(0), createEventFileName(1)]);
  assert.equal(readEventSnapshotText(store, createEventFileName(1)), "text 1");
});

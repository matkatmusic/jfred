import { test } from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

import { ChangeKind, listChangesSinceLastScan } from "./engineV3_replay_snapshot.ts";
import { scanWatchedFolders } from "./engineV3_replay_snapshot_scan.ts";
import { formatJsonlEventFileName, writeEventSnapshot } from "./engineV3_replay_snapshot_write.ts";
import { makeTempFolder, writeFileIn } from "./engineV3_replay_snapshot_testing.ts";

const JSONL_FILE_NAME = "9789f2d0-5506-4633-9117-f64471817355.jsonl";

test("test_writeEventSnapshot_writes_a_blob_once_for_two_files_with_the_same_content", (t) => {
  // Scenario: two added files with equal content share one blob named by the hash.
  const folder = makeTempFolder(t, "snap-write-");
  const store = makeTempFolder(t, "snap-store-");
  // write two files with the same content and scan them as added
  const firstPath = writeFileIn(folder, "a.txt", "same");
  writeFileIn(folder, "b.txt", "same");
  const changes = listChangesSinceLastScan(new Map(), scanWatchedFolders([folder], [store], new Map()));
  // write the event snapshot
  writeEventSnapshot(store, "000001_x_1.json", { event: 1, eventText: "text", previousEvent: null, touched: [], changes });
  // the blobs folder holds one file, named by the hash, with the content
  const blobNames = readdirSync(join(store.toString(), "blobs"));
  assert.equal(blobNames.length, 1);
  assert.equal("sha256:" + blobNames[0]!, changes[0]!.contentHash);
  assert.equal(readFileSync(join(store.toString(), "blobs", blobNames[0]!), "utf8"), "same");
  assert.equal(changes[0]!.path, firstPath);
});

test("test_writeEventSnapshot_names_the_file_with_the_event_number_jsonl_name_and_line", (t) => {
  // Scenario: event 1034 at line 575 of a JSONL file is stored as events/001034_<jsonl name>_575.json.
  const store = makeTempFolder(t, "snap-store-");
  // build the file name, then write the event with one deleted path
  const fileName = formatJsonlEventFileName(1034, JSONL_FILE_NAME, 575);
  const changes = [{ path: "/work/old.ts", change: ChangeKind.Deleted }];
  writeEventSnapshot(store, fileName, { event: 1034, eventText: "next event", previousEvent: "001033_x_9.json", touched: [], changes });
  // the name has the event number, the JSONL name without .jsonl, and the line
  assert.equal(fileName, "001034_9789f2d0-5506-4633-9117-f64471817355_575.json");
  // the file holds the event fields
  const written = JSON.parse(readFileSync(join(store.toString(), "events", fileName), "utf8"));
  assert.equal(written.event, 1034);
  assert.equal(written.eventText, "next event");
  assert.equal(written.previousEvent, "001033_x_9.json");
  assert.deepEqual(written.changes, changes);
  assert.equal(typeof written.replayedAt, "string");
});

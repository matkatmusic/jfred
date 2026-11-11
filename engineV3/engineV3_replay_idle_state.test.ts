import { test, type TestContext } from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { Path } from "../src/structures/domain.ts";
import { TimelineEventKind, type JSONLLine, type TimelineEvent } from "./engineV3.ts";
import { loadMergedJSONLLines } from "./engineV3_jsonl_lines.ts";
import { applyIdleStateCopyToState, listIdleStateCopies } from "./engineV3_replay_idle_state.ts";
import { formatEventText } from "./engineV3_replay.ts";
import { TERMINAL_EVENT, getNextEvent } from "./engineV3_replay_timeline.ts";

type Folders = { macPlate: string; state: string; jsonl: string; macIdleFolder: string };

const IDLE_FILE_SECONDS = 10;

function makeTempFolder(t: TestContext, prefix: string): string {
  const folder = mkdtempSync(join(tmpdir(), prefix));
  t.after(() => rmSync(folder, { recursive: true, force: true }));
  return folder;
}

// The Mac idle-state folder sits under the plate folder at the state folder's absolute path, like the docker mount.
function makeFolders(t: TestContext): Folders {
  const macPlate = makeTempFolder(t, "idle-mac-plate-");
  const state = makeTempFolder(t, "idle-state-");
  const jsonl = makeTempFolder(t, "idle-jsonl-");
  const macIdleFolder = join(macPlate, state, ".idleState");
  mkdirSync(macIdleFolder, { recursive: true });
  return { macPlate, state, jsonl, macIdleFolder };
}

function makeTimestamp(secondsPastMidnight: number): string {
  return new Date(Date.UTC(2026, 9, 27, 0, 0, secondsPastMidnight)).toISOString();
}

function makeWriteCallRow(callId: string, filePath: string, second: number): object {
  const block = { type: "tool_use", id: callId, name: "Write", input: { file_path: filePath, content: "x" } };
  return { type: "assistant", uuid: `call-${callId}`, timestamp: makeTimestamp(second), message: { role: "assistant", content: [block] } };
}

function loadRows(folders: Folders, rows: object[]): JSONLLine[] {
  writeFileSync(join(folders.jsonl, "s1.jsonl"), rows.map((row) => JSON.stringify(row)).join("\n") + "\n");
  return loadMergedJSONLLines([folders.jsonl]).jsonlLines;
}

function writeMacIdleFile(folders: Folders, name: string, content: string, second: number): void {
  const file = join(folders.macIdleFolder, name);
  writeFileSync(file, content);
  const time = new Date(Date.UTC(2026, 9, 27, 0, 0, second));
  utimesSync(file, time, time);
}

test("test_listIdleStateCopies_lists_a_mac_file_with_its_mtime_and_state_path", (t) => {
  // Scenario: one idle-state file on the Mac, no recorded Write: one copy at the file's mtime.
  const folders = makeFolders(t);
  writeMacIdleFile(folders, "a.json", "{}", IDLE_FILE_SECONDS);
  const lines = loadRows(folders, [makeWriteCallRow("c1", join(folders.state, "other.txt"), 5)]);
  const copies = listIdleStateCopies(new Path(folders.macPlate), lines);
  assert.equal(copies.length, 1);
  assert.equal(copies[0]!.targetPath.toString(), join(folders.state, ".idleState", "a.json"));
  assert.equal(copies[0]!.timeMs, Date.UTC(2026, 9, 27, 0, 0, IDLE_FILE_SECONDS));
});

test("test_listIdleStateCopies_skips_a_file_that_a_recorded_write_creates", (t) => {
  // Scenario: a.json has a recorded Write, b.json has none: only b.json is copied.
  const folders = makeFolders(t);
  writeMacIdleFile(folders, "a.json", "{}", IDLE_FILE_SECONDS);
  writeMacIdleFile(folders, "b.json", "{}", IDLE_FILE_SECONDS);
  const lines = loadRows(folders, [makeWriteCallRow("c1", join(folders.state, ".idleState", "a.json"), 5)]);
  const copies = listIdleStateCopies(new Path(folders.macPlate), lines);
  assert.deepEqual(copies.map((copy) => copy.targetPath.toString()), [join(folders.state, ".idleState", "b.json")]);
});

test("test_getNextEvent_puts_the_idle_state_copy_between_the_lines_before_and_after_its_mtime", (t) => {
  // Scenario: lines at 5s and 15s, idle-state file at 10s: line, copy, line.
  const folders = makeFolders(t);
  writeMacIdleFile(folders, "a.json", "{}", IDLE_FILE_SECONDS);
  loadRows(folders, [makeWriteCallRow("c1", join(folders.state, "x.txt"), 5), makeWriteCallRow("c2", join(folders.state, "y.txt"), 15)]);
  const kinds: TimelineEventKind[] = [];
  let lastEvent: TimelineEvent | null = null;
  while (true) {
    const event = getNextEvent(undefined, [new Path(folders.jsonl)], lastEvent, new Path(folders.macPlate));
    if (event === TERMINAL_EVENT) {
      break;
    }
    kinds.push(event.type);
    lastEvent = event;
  }
  assert.deepEqual(kinds, [TimelineEventKind.JSONLLine, TimelineEventKind.IdleStateCopy, TimelineEventKind.JSONLLine]);
});

test("test_applyIdleStateCopyToState_writes_the_mac_bytes_into_the_state", (t) => {
  // Scenario: applying the copy puts the Mac file's bytes at the state path.
  const folders = makeFolders(t);
  writeMacIdleFile(folders, "a.json", "{\"id\":1}", IDLE_FILE_SECONDS);
  const lines = loadRows(folders, [makeWriteCallRow("c1", join(folders.state, "x.txt"), 5)]);
  const copy = listIdleStateCopies(new Path(folders.macPlate), lines)[0]!;
  applyIdleStateCopyToState(new Path(folders.state), copy);
  assert.equal(readFileSync(join(folders.state, ".idleState", "a.json"), "utf8"), "{\"id\":1}");
});

test("test_formatEventText_says_the_idle_state_file_was_copied_from_the_mac_at_its_mtime", (t) => {
  // Scenario: the log line names the target path and the Mac mtime.
  const folders = makeFolders(t);
  writeMacIdleFile(folders, "a.json", "{}", IDLE_FILE_SECONDS);
  const lines = loadRows(folders, [makeWriteCallRow("c1", join(folders.state, "x.txt"), 5)]);
  const copy = listIdleStateCopies(new Path(folders.macPlate), lines)[0]!;
  const text = formatEventText({ type: TimelineEventKind.IdleStateCopy, copy, timestamp: copy.timeMs }, undefined);
  assert.ok(text.endsWith(`idle-state file ${join(folders.state, ".idleState", "a.json")} copied from the Mac at 2026-10-27T00:00:10.000Z`));
});

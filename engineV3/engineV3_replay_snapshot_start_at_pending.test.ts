import { test, type TestContext } from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { Path } from "../src/structures/domain.ts";
import { loadMergedJSONLLines } from "./engineV3_jsonl_lines.ts";
import { clearSeenBackups } from "./engineV3_replay_backups.ts";
import { collectBashCallResults } from "./engineV3_replay_bash_results.ts";
import { clearPendingWrites, findPendingBeforeContent } from "./engineV3_replay_pending_writes.ts";
import { collectWriteEditResultLines } from "./engineV3_replay_tool_results.ts";
import { executeReplay } from "./engineV3_replay.ts";
import { recordPendingWritesOfSkippedLine } from "./engineV3_replay_apply.ts";
import type { JSONLLine } from "./engineV3.ts";
import type { ScriptReplayContext } from "./engineV3_replay_script.ts";
import { createSnapshotLoop } from "./engineV3_replay_snapshot_loop.ts";
import { createSnapshotLoopAtEvent } from "./engineV3_replay_snapshot_start_at.ts";
import { makeTempFolder } from "./engineV3_replay_snapshot_testing.ts";

type FullRun = { state: Path; store: Path; jsonlFolder: Path; context: ScriptReplayContext; filePath: string };

const SESSION_ID = "11111111-2222-3333-4444-555555555555";
// event 1 is the Write call line, event 2 is the snapshot line, event 3 is the result line
const START_AT_EVENT = 2;

function createTimestamp(secondsPastMidnight: number): string {
  return new Date(Date.UTC(2026, 0, 1, 0, 0, secondsPastMidnight)).toISOString();
}

function createRows(filePath: string): object[] {
  const writeBlock = { type: "tool_use", id: "c1", name: "Write", input: { file_path: filePath, content: "new text\n" } };
  const callRow = { type: "assistant", uuid: "call-c1", timestamp: createTimestamp(1), message: { role: "assistant", content: [writeBlock] } };
  const namedBackup = { "f.txt": { backupFileName: "abc@v2", version: 2, backupTime: createTimestamp(2) } };
  const snapshotRow = { type: "file-history-snapshot", messageId: "m1", snapshot: { messageId: "m1", trackedFileBackups: namedBackup, timestamp: createTimestamp(2) }, isSnapshotUpdate: true };
  const toolUseResult = { type: "update", filePath, content: "new text\n", structuredPatch: [], originalFile: "old text\n", userModified: false };
  const resultBlock = { type: "tool_result", tool_use_id: "c1", content: "ok" };
  const resultRow = { type: "user", uuid: "result-c1", timestamp: createTimestamp(3), message: { role: "user", content: [resultBlock] }, toolUseResult };
  return [callRow, snapshotRow, resultRow];
}

function runFullReplay(t: TestContext): FullRun {
  clearPendingWrites();
  clearSeenBackups();
  const state = makeTempFolder(t, "pending-state-");
  const store = makeTempFolder(t, "pending-store-");
  const jsonlFolder = makeTempFolder(t, "pending-jsonl-");
  const historyFolder = makeTempFolder(t, "pending-history-");
  const filePath = join(state.toString(), "f.txt");
  writeFileSync(filePath, "old text\n");
  mkdirSync(join(historyFolder.toString(), SESSION_ID));
  writeFileSync(join(historyFolder.toString(), SESSION_ID, "abc@v2"), "old text\n");
  let jsonlText = "";
  for (const row of createRows(filePath)) {
    jsonlText += JSON.stringify(row) + "\n";
  }
  writeFileSync(join(jsonlFolder.toString(), `${SESSION_ID}.jsonl`), jsonlText);
  const lines = loadMergedJSONLLines([jsonlFolder.toString()]).jsonlLines;
  const context = { bashCallResults: collectBashCallResults(lines), writeEditResultLines: collectWriteEditResultLines(lines), sourceRepo: undefined, fileHistoryPath: historyFolder };
  executeReplay(state, undefined, [jsonlFolder], [], context, createSnapshotLoop(store, [state]));
  return { state, store, jsonlFolder, context, filePath };
}

function emptyFolder(folder: Path): void {
  for (const entry of readdirSync(folder.toString())) {
    rmSync(join(folder.toString(), entry), { recursive: true });
  }
}

function loadWriteCallAndResultLines(t: TestContext): { state: Path; filePath: string; lines: JSONLLine[]; context: ScriptReplayContext } {
  clearPendingWrites();
  const state = makeTempFolder(t, "pending-state-");
  const jsonlFolder = makeTempFolder(t, "pending-jsonl-");
  const filePath = join(state.toString(), "f.txt");
  writeFileSync(filePath, "old text\n");
  const [callRow, , resultRow] = createRows(filePath);
  writeFileSync(join(jsonlFolder.toString(), `${SESSION_ID}.jsonl`), JSON.stringify(callRow) + "\n" + JSON.stringify(resultRow) + "\n");
  const lines = loadMergedJSONLLines([jsonlFolder.toString()]).jsonlLines;
  const context = { bashCallResults: new Map(), writeEditResultLines: collectWriteEditResultLines(lines), sourceRepo: undefined };
  return { state, filePath, lines, context };
}

test("test_recordPendingWritesOfSkippedLine_adds_a_pending_write_for_a_skipped_call_line", (t) => {
  // Scenario: a skipped Write call line makes the pending write that its result line later removes.
  const { state, filePath, lines, context } = loadWriteCallAndResultLines(t);
  // no pending write before the call line
  assert.equal(findPendingBeforeContent(filePath), undefined);
  // record the skipped call line (lines[0])
  recordPendingWritesOfSkippedLine(state, lines[0]!, context);
  // the pending write holds the text from before the write
  assert.equal(findPendingBeforeContent(filePath)?.toString(), "old text\n");
});

test("test_recordPendingWritesOfSkippedLine_removes_the_pending_write_at_a_skipped_result_line", (t) => {
  // Scenario: a skipped result line ends the pending write that the skipped call line began.
  const { state, filePath, lines, context } = loadWriteCallAndResultLines(t);
  recordPendingWritesOfSkippedLine(state, lines[0]!, context);
  // record the skipped result line (lines[1])
  recordPendingWritesOfSkippedLine(state, lines[1]!, context);
  // no pending write is left
  assert.equal(findPendingBeforeContent(filePath), undefined);
});

test("test_executeReplay_started_between_a_call_line_and_its_result_line_keeps_the_written_file", (t) => {
  // Scenario: the start event is the snapshot line between a Write call line and its result line.
  const fullRun = runFullReplay(t);
  const fullText = readFileSync(fullRun.filePath, "utf8");
  // empty the state folder; a new process has no memory of the pending writes or the seen backups
  emptyFolder(fullRun.state);
  clearPendingWrites();
  clearSeenBackups();
  // restore and replay from event 2: the call line (event 1) is skipped
  const snapshotLoop = createSnapshotLoopAtEvent(fullRun.store, fullRun.state, [], START_AT_EVENT);
  executeReplay(fullRun.state, undefined, [fullRun.jsonlFolder], [], fullRun.context, snapshotLoop, undefined, START_AT_EVENT);
  // the file holds the text of the full run, and no pending write is left
  assert.equal(readFileSync(fullRun.filePath, "utf8"), fullText);
  assert.equal(findPendingBeforeContent(fullRun.filePath), undefined);
});

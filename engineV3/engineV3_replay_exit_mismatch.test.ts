import { test, type TestContext } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { Path, Uuid } from "../src/structures/domain.ts";
import { getRecordSource, loadTranscript } from "../src/parse/loadTranscript.ts";
import { TimelineEventKind, type CommitHash, type JSONLLine, type TimelineEvent } from "./engineV3.ts";
import { executeScriptInState, type ScriptReplayContext } from "./engineV3_replay_script.ts";
import { addPendingExitMismatches, settleExitMismatches } from "./engineV3_replay_exit_mismatch.ts";
import { listChangesSinceLastScan, ChangeKind, type FileChange } from "./engineV3_replay_snapshot.ts";
import { scanWatchedFolders } from "./engineV3_replay_snapshot_scan.ts";
import { createSnapshotLoop, writeSnapshotAfterEvent } from "./engineV3_replay_snapshot_loop.ts";
import { executeReplay } from "./engineV3_replay.ts";
import { loadMergedJSONLLines } from "./engineV3_jsonl_lines.ts";
import { collectBashCallResults } from "./engineV3_replay_bash_results.ts";
import { collectWriteEditResultLines } from "./engineV3_replay_tool_results.ts";

const TOOL_USE_ID = "toolu_01ExitMismatch";
const CTX_EXECUTE_TOOL_NAME = "mcp__plugin_context-mode_context-mode__ctx_execute";

function makeTempFolder(t: TestContext, prefix: string): string {
  const folder = mkdtempSync(join(tmpdir(), prefix));
  t.after(() => rmSync(folder, { recursive: true, force: true }));
  return folder;
}

// The replay writes its own files into tmpdir(), so a test points TMPDIR at an empty folder it can scan.
// Call it after the test made its other temp folders, so they are not inside the scanned folder.
function pointTmpdirAt(t: TestContext, folder: string): void {
  const previousTmpdir = process.env.TMPDIR;
  process.env.TMPDIR = folder;
  t.after(() => {
    process.env.TMPDIR = previousTmpdir;
  });
}

function makeContext(isError: boolean, resultText: string = ""): ScriptReplayContext {
  const result = { toolUseId: new Uuid(TOOL_USE_ID), startMs: 0, endMs: 1, isError, resultText, command: "" };
  return { bashCallResults: new Map([[TOOL_USE_ID, result]]), writeEditResultLines: new Map(), sourceRepo: new Path("/nonexistent") };
}

function loadLineWithBlock(t: TestContext, block: object, cwd: string): JSONLLine {
  const callLine = { type: "assistant", uuid: "4b836cc7-2357-412e-9f53-b23191b3c68a", parentUuid: null, cwd, timestamp: "2026-10-27T17:24:20.837Z", sessionId: "7d31cfda-fb91-4f61-ba61-7031cb5484e2", message: { role: "assistant", content: [block] } };
  const jsonlFile = join(makeTempFolder(t, "engine-v3-mismatch-jsonl-"), "session.jsonl");
  writeFileSync(jsonlFile, JSON.stringify(callLine) + "\n");
  return loadTranscript(jsonlFile).records[0] as JSONLLine;
}

function loadBashCallLine(t: TestContext, command: string, cwd: string): JSONLLine {
  return loadLineWithBlock(t, { type: "tool_use", id: TOOL_USE_ID, name: "Bash", input: { command, description: "test" }, caller: { type: "direct" } }, cwd);
}

function listChangesOfFolders(folders: string[]): FileChange[] {
  const scan = scanWatchedFolders(folders.map((folder) => new Path(folder)), [], new Map());
  return listChangesSinceLastScan(new Map(), scan);
}

function captureLoggedLines(t: TestContext): string[] {
  const loggedLines: string[] = [];
  t.mock.method(console, "log", (text: string) => {
    loggedLines.push(text);
  });
  return loggedLines;
}

test("test_executeScriptInState_returns_the_exit_mismatch_instead_of_throwing", (t) => {
  // Scenario: a command exits 3 but the record says it passed; the run reports the mismatch as a value.
  // the state folder is the record's cwd
  const state = new Path(makeTempFolder(t, "engine-v3-mismatch-state-"));
  // the call line exits 3, and the recorded result is not an error
  const line = loadBashCallLine(t, "exit 3", state.toString());
  // the run returns one mismatch and does not throw
  const mismatches = executeScriptInState(state, line, makeContext(false));
  assert.equal(mismatches.length, 1);
  // the mismatch names the tool use id, the recorded result and the replayed exit code
  assert.equal(mismatches[0]!.toolUseId, TOOL_USE_ID);
  assert.equal(mismatches[0]!.recordedIsError, false);
  assert.equal(mismatches[0]!.replayedExitCode, 3);
});

test("test_executeScriptInState_returns_no_mismatch_when_the_exit_matches_the_record", (t) => {
  // Scenario: a recorded error that exits 1 matches, so there is nothing to settle.
  // the state folder is the record's cwd
  const state = new Path(makeTempFolder(t, "engine-v3-mismatch-state-"));
  // the call line exits 1, and the recorded result is an error
  const line = loadBashCallLine(t, "exit 1", state.toString());
  // the run returns no mismatch
  assert.deepEqual(executeScriptInState(state, line, makeContext(true)), []);
});

test("test_settleExitMismatches_logs_one_line_and_continues_when_no_file_changed", (t) => {
  // Scenario: a mismatching exit with no file change never stops the replay.
  // the state folder is the record's cwd
  const state = new Path(makeTempFolder(t, "engine-v3-mismatch-state-"));
  // the call line exits 3, and the recorded result is not an error
  const line = loadBashCallLine(t, "exit 3", state.toString());
  addPendingExitMismatches(executeScriptInState(state, line, makeContext(false)));
  // the event has no file changes
  const loggedLines = captureLoggedLines(t);
  assert.doesNotThrow(() => settleExitMismatches([]));
  // exactly one line is logged, with the JSONL file, line number, tool use id, recorded result and replayed exit code
  const source = getRecordSource(line)!;
  assert.deepEqual(loggedLines, [`exit mismatch ignored (no file change): ${source.filePath} line ${source.lineNumber} ${TOOL_USE_ID}: recorded ok, replayed exit 3`]);
});

test("test_settleExitMismatches_logs_recorded_error_when_a_recorded_error_exits_0", (t) => {
  // Scenario: a command recorded as an error that exits 0 logs "recorded error".
  // the state folder is the record's cwd
  const state = new Path(makeTempFolder(t, "engine-v3-mismatch-state-"));
  // the call line exits 0, and the recorded result is an error
  // merge: `touch` changes a file, so the replay does not skip it as a read-only call (Attune rule)
  const line = loadBashCallLine(t, "touch marker.txt", state.toString());
  addPendingExitMismatches(executeScriptInState(state, line, makeContext(true)));
  // the event has no file changes
  const loggedLines = captureLoggedLines(t);
  settleExitMismatches([]);
  // the logged line says recorded error, replayed exit 0
  assert.match(loggedLines[0]!, /: recorded error, replayed exit 0$/);
});

test("test_settleExitMismatches_throws_the_command_failure_when_a_file_changed", (t) => {
  // Scenario: a mismatching exit that wrote a file stops the replay with the full failure.
  // the state folder is the record's cwd
  const state = new Path(makeTempFolder(t, "engine-v3-mismatch-state-"));
  // the call line writes out.txt, prints to stderr and exits 3, and the recorded result is not an error
  const line = loadBashCallLine(t, "echo data > out.txt; echo boom 1>&2; exit 3", state.toString());
  addPendingExitMismatches(executeScriptInState(state, line, makeContext(false)));
  // the event changes are the state folder's files
  const changes = listChangesOfFolders([state.toString()]);
  // settling throws the failure with the command, the exit code and the stderr
  assert.throws(() => settleExitMismatches(changes), (error: Error) => {
    assert.match(error.message, /executeScriptCommand: command failed with exit code 3/);
    assert.match(error.message, /boom/);
    return true;
  });
});

test("test_settleExitMismatches_throws_when_the_event_changes_are_unknown", (t) => {
  // Scenario: a replay without a snapshot loop cannot prove that no file changed, so the mismatch stops it.
  // the state folder is the record's cwd
  const state = new Path(makeTempFolder(t, "engine-v3-mismatch-state-"));
  // the call line exits 3, and the recorded result is not an error
  const line = loadBashCallLine(t, "exit 3", state.toString());
  addPendingExitMismatches(executeScriptInState(state, line, makeContext(false)));
  // settling with no changes list throws
  assert.throws(() => settleExitMismatches(undefined), /command failed with exit code 3/);
});

test("test_settleExitMismatches_counts_a_write_into_the_claude_scratchpad", (t) => {
  // Scenario: a file in the scratchpad is a file change like any other.
  // the state folder is the record's cwd
  const state = new Path(makeTempFolder(t, "engine-v3-mismatch-state-"));
  // the call line exits 3, and the recorded result is not an error
  const line = loadBashCallLine(t, "exit 3", state.toString());
  addPendingExitMismatches(executeScriptInState(state, line, makeContext(false)));
  // the event wrote one file into a scratchpad folder
  const scratchpadChange: FileChange = { path: "/private/tmp/claude-501/-proj/7d31cfda-fb91-4f61-ba61-7031cb5484e2/scratchpad/notes.txt", change: ChangeKind.Added };
  // settling throws
  assert.throws(() => settleExitMismatches([scratchpadChange]), /command failed with exit code 3/);
});

test("test_settleExitMismatches_ignores_the_script_txt_folder_and_file_the_replay_writes", (t) => {
  // Scenario: the replay writes script.txt into a new temp folder for each command; those two entries are not file changes.
  // the temp folder is empty and watched
  const tempFolder = makeTempFolder(t, "engine-v3-mismatch-tmp-");
  // the state folder is the record's cwd
  const state = new Path(makeTempFolder(t, "engine-v3-mismatch-state-"));
  // the call line exits 3, and the recorded result is not an error
  const line = loadBashCallLine(t, "exit 3", state.toString());
  pointTmpdirAt(t, tempFolder);
  addPendingExitMismatches(executeScriptInState(state, line, makeContext(false)));
  // the event changes are exactly the script folder and its script.txt
  const changes = listChangesOfFolders([tempFolder]);
  assert.equal(changes.length, 2);
  // settling does not throw
  const loggedLines = captureLoggedLines(t);
  assert.doesNotThrow(() => settleExitMismatches(changes));
  assert.equal(loggedLines.length, 1);
});

test("test_settleExitMismatches_ignores_the_own_temp_folder_of_a_python_ctx_execute_run", (t) => {
  // Scenario: a python ctx_execute run starts in an empty temp folder that the replay makes.
  // the temp folder is empty and watched
  const tempFolder = makeTempFolder(t, "engine-v3-mismatch-tmp-");
  // the state folder is the record's cwd
  const state = new Path(makeTempFolder(t, "engine-v3-mismatch-state-"));
  // the call line is a python run that exits 3, and the recorded result is not an error
  const line = loadLineWithBlock(t, { type: "tool_use", id: TOOL_USE_ID, name: CTX_EXECUTE_TOOL_NAME, input: { language: "python", code: "import sys; sys.exit(3)" }, caller: { type: "direct" } }, state.toString());
  pointTmpdirAt(t, tempFolder);
  addPendingExitMismatches(executeScriptInState(state, line, makeContext(false)));
  // the event changes are exactly the python temp folder
  const changes = listChangesOfFolders([tempFolder]);
  assert.equal(changes.length, 1);
  // settling does not throw
  captureLoggedLines(t);
  assert.doesNotThrow(() => settleExitMismatches(changes));
});

test("test_settleExitMismatches_ignores_the_background_output_file_the_replay_writes", (t) => {
  // Scenario: a background call in the same event makes the replay write the recorded output file and its folder.
  // the temp folder is empty and watched, and the recorded output path is inside it, in a folder that does not exist yet
  const tempFolder = makeTempFolder(t, "engine-v3-mismatch-tmp-");
  const outputPath = join(tempFolder, "claude-501", "tasks", "bg1.output");
  const state = new Path(makeTempFolder(t, "engine-v3-mismatch-state-"));
  // the line holds a background call that prints a line, then a call that exits 3 although the record says it passed
  const callLine = { type: "assistant", uuid: "4b836cc7-2357-412e-9f53-b23191b3c68a", parentUuid: null, cwd: state.toString(), timestamp: "2026-10-27T17:24:20.837Z", sessionId: "7d31cfda-fb91-4f61-ba61-7031cb5484e2", message: { role: "assistant", content: [
    { type: "tool_use", id: "toolu_01Background", name: "Bash", input: { command: "touch started.txt", description: "test", run_in_background: true }, caller: { type: "direct" } },
    { type: "tool_use", id: TOOL_USE_ID, name: "Bash", input: { command: "exit 3", description: "test" }, caller: { type: "direct" } },
  ] } };
  const jsonlFile = join(makeTempFolder(t, "engine-v3-mismatch-jsonl-"), "session.jsonl");
  writeFileSync(jsonlFile, JSON.stringify(callLine) + "\n");
  const line = loadTranscript(jsonlFile).records[0] as JSONLLine;
  const context = makeContext(false);
  context.bashCallResults.set("toolu_01Background", { toolUseId: new Uuid("toolu_01Background"), startMs: 0, endMs: 1, isError: false, resultText: `Command running in background. Output is being written to: ${outputPath}.`, command: "" });
  pointTmpdirAt(t, tempFolder);
  addPendingExitMismatches(executeScriptInState(state, line, context));
  // the event changes are the output folders, the output file, the script folder and its script.txt, per call
  const changes = listChangesOfFolders([tempFolder]);
  assert.ok(changes.some((change) => change.path === outputPath));
  // settling does not throw
  captureLoggedLines(t);
  assert.doesNotThrow(() => settleExitMismatches(changes));
});

test("test_settleExitMismatches_clears_the_pending_mismatches_after_settling", (t) => {
  // Scenario: a settled mismatch does not come back in the next event.
  // the state folder is the record's cwd
  const state = new Path(makeTempFolder(t, "engine-v3-mismatch-state-"));
  // the call line exits 3, and the recorded result is not an error
  const line = loadBashCallLine(t, "exit 3", state.toString());
  addPendingExitMismatches(executeScriptInState(state, line, makeContext(false)));
  // the first settle logs it
  const loggedLines = captureLoggedLines(t);
  settleExitMismatches([]);
  // the second settle logs nothing and does not throw, even with unknown changes
  settleExitMismatches(undefined);
  assert.equal(loggedLines.length, 1);
});

// A folder with one session file: a Bash call line, then its result line.
function makeBashSessionFolder(t: TestContext, command: string, cwd: string): Path {
  const callLine = { type: "assistant", uuid: "4b836cc7-2357-412e-9f53-b23191b3c68a", parentUuid: null, cwd, timestamp: "2026-10-27T17:24:20.837Z", sessionId: "7d31cfda-fb91-4f61-ba61-7031cb5484e2", message: { role: "assistant", content: [{ type: "tool_use", id: TOOL_USE_ID, name: "Bash", input: { command, description: "test" }, caller: { type: "direct" } }] } };
  const resultLine = { type: "user", uuid: "fb4f2aa6-3410-4aaa-85d8-a8675096b95c", parentUuid: "4b836cc7-2357-412e-9f53-b23191b3c68a", cwd, timestamp: "2026-10-27T17:25:01.039Z", sessionId: "7d31cfda-fb91-4f61-ba61-7031cb5484e2", message: { role: "user", content: [{ type: "tool_result", tool_use_id: TOOL_USE_ID, content: "" }] }, toolUseResult: { stdout: "", stderr: "", interrupted: false, isImage: false, noOutputExpected: false } };
  const folder = makeTempFolder(t, "engine-v3-mismatch-session-");
  writeFileSync(join(folder, "session.jsonl"), [callLine, resultLine].map((fixtureLine) => JSON.stringify(fixtureLine)).join("\n") + "\n");
  return new Path(folder);
}

function replaySessionWithSnapshotLoop(t: TestContext, command: string): void {
  const state = new Path(makeTempFolder(t, "engine-v3-mismatch-state-"));
  const sessionFolder = makeBashSessionFolder(t, command, state.toString());
  const store = new Path(makeTempFolder(t, "engine-v3-mismatch-store-"));
  const snapshotLoop = createSnapshotLoop(store, [state]);
  const lines = loadMergedJSONLLines([sessionFolder.toString()]).jsonlLines;
  const context: ScriptReplayContext = { bashCallResults: collectBashCallResults(lines), writeEditResultLines: collectWriteEditResultLines(lines), sourceRepo: undefined };
  executeReplay(state, undefined, [sessionFolder], [], context, snapshotLoop);
}

test("test_executeReplay_logs_the_mismatch_and_goes_on_when_the_command_changes_no_file", (t) => {
  // Scenario: through the whole replay loop, a failing command that touches no file does not stop the replay.
  // the recorded result says the command passed, but it exits 3 and writes nothing
  const loggedLines = captureLoggedLines(t);
  // the replay finishes
  assert.doesNotThrow(() => replaySessionWithSnapshotLoop(t, "exit 3"));
  // one ignored-mismatch line is logged
  assert.equal(loggedLines.filter((text) => text.startsWith("exit mismatch ignored (no file change): ")).length, 1);
});

test("test_executeReplay_throws_when_a_mismatching_command_changes_a_file", (t) => {
  // Scenario: through the whole replay loop, a failing command that writes a file stops the replay.
  // the recorded result says the command passed, but it writes out.txt and exits 3
  captureLoggedLines(t);
  // the replay throws the command failure
  assert.throws(() => replaySessionWithSnapshotLoop(t, "echo data > out.txt; exit 3"), /command failed with exit code 3/);
});

test("test_writeSnapshotAfterEvent_returns_the_changes_it_wrote_for_the_event", (t) => {
  // Scenario: the replay loop needs the event's changes to settle exit mismatches.
  // the snapshot loop watches one folder
  const watched = makeTempFolder(t, "engine-v3-mismatch-watched-");
  const store = new Path(makeTempFolder(t, "engine-v3-mismatch-store-"));
  const snapshotLoop = createSnapshotLoop(store, [new Path(watched)]);
  // the event adds one file
  writeFileSync(join(watched, "new.txt"), "x");
  const event: TimelineEvent = { type: TimelineEventKind.GitCommit, commit: "aaa" as unknown as CommitHash, timestamp: 0 };
  const changes = writeSnapshotAfterEvent(snapshotLoop, event, "2026-11-10T00:00:00.000Z one", new Path(watched), new Map());
  // the returned changes name the new file
  assert.deepEqual(changes!.map((change) => change.path), [join(watched, "new.txt")]);
  // a replay with no snapshot loop returns no changes list
  assert.equal(writeSnapshotAfterEvent(undefined, event, "x", new Path(watched), new Map()), undefined);
});

import { test, type TestContext } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { Path, Uuid } from "../src/structures/domain.ts";
import { loadTranscript } from "../src/parse/loadTranscript.ts";
import type { JSONLLine } from "./engineV3.ts";
import { executeScriptInState, type ScriptReplayContext } from "./engineV3_replay_script.ts";

const ERROR_TOOL_USE_ID = "toolu_01ErrorBashCall";

function makeTempFolder(t: TestContext, prefix: string): string {
  const folder = mkdtempSync(join(tmpdir(), prefix));
  t.after(() => rmSync(folder, { recursive: true, force: true }));
  return folder;
}

// The recorded result of the call: isError says whether the recorded command failed.
function makeContext(isError: boolean): ScriptReplayContext {
  const result = { toolUseId: new Uuid(ERROR_TOOL_USE_ID), startMs: 0, endMs: 1, isError, resultText: "", command: "" };
  return { bashCallResults: new Map([[ERROR_TOOL_USE_ID, result]]), writeEditResultLines: new Map(), sourceRepo: new Path("/nonexistent") };
}

function loadBashCallLine(t: TestContext, toolUseId: string, command: string, cwd: string): JSONLLine {
  const block = { type: "tool_use", id: toolUseId, name: "Bash", input: { command, description: "test" }, caller: { type: "direct" } };
  const callLine = { type: "assistant", uuid: "4b836cc7-2357-412e-9f53-b23191b3c68a", parentUuid: null, cwd, timestamp: "2026-10-27T17:24:20.837Z", sessionId: "7d31cfda-fb91-4f61-ba61-7031cb5484e2", message: { role: "assistant", content: [block] } };
  const jsonlFile = join(makeTempFolder(t, "engine-v3-script-jsonl-"), "session.jsonl");
  writeFileSync(jsonlFile, JSON.stringify(callLine) + "\n");
  return loadTranscript(jsonlFile).records[0] as JSONLLine;
}

// The allow list is off, so there is no entry count to check.
// test("test_SCRIPT_ALLOWLIST_has_56_entries_and_9_expect_an_error", () => {
//   assert.equal(SCRIPT_ALLOWLIST.length, 56);
// });

test("test_executeScriptInState_does_not_throw_when_a_recorded_error_exits_1", (t) => {
  // Scenario: a recorded failure is expected, so the replay goes on.
  // the state folder is the record's cwd
  const state = new Path(makeTempFolder(t, "engine-v3-script-state-"));
  // the call line has a command that exits 1 and a recorded result with isError true
  const line = loadBashCallLine(t, ERROR_TOOL_USE_ID, "exit 1", state.toString());
  // the run does not throw
  assert.doesNotThrow(() => executeScriptInState(state, line, makeContext(true)));
});

test("test_executeScriptInState_failure_message_shows_the_tail_of_stdout", (t) => {
  // Scenario: a command that fails by surprise prints its stdout into the stop message.
  // the state folder is the record's cwd
  const state = new Path(makeTempFolder(t, "engine-v3-script-state-"));
  // the call line prints 5000 zeros and then exits 3, but the record says it passed
  const line = loadBashCallLine(t, ERROR_TOOL_USE_ID, "printf '%05000d' 0; exit 3", state.toString());
  // the error has exactly the last 4000 zeros
  assert.throws(() => executeScriptInState(state, line, makeContext(false)), (error: Error) => {
    assert.match(error.message, /0{4000}/);
    assert.doesNotMatch(error.message, /0{4001}/);
    return true;
  });
});

test("test_executeScriptInState_throws_when_a_recorded_error_exits_0", (t) => {
  // Scenario: a command that was recorded as failing must fail again.
  // the state folder is the record's cwd
  const state = new Path(makeTempFolder(t, "engine-v3-script-state-"));
  // the call line has a command that exits 0 and a recorded result with isError true
  const line = loadBashCallLine(t, ERROR_TOOL_USE_ID, "true", state.toString());
  // the error names the command and says it was expected to fail
  assert.throws(() => executeScriptInState(state, line, makeContext(true)), (error: Error) => {
    assert.match(error.message, /command: true/);
    assert.match(error.message, /expected to fail/);
    return true;
  });
});

test("test_executeScriptInState_throws_when_a_recorded_error_is_killed_by_a_signal", (t) => {
  // Scenario: a signal always throws, even when an error is expected.
  // the state folder is the record's cwd
  const state = new Path(makeTempFolder(t, "engine-v3-script-state-"));
  // the call line has a command that kills itself and a recorded result with isError true
  const line = loadBashCallLine(t, ERROR_TOOL_USE_ID, "kill -9 $$", state.toString());
  // the run throws and names the signal
  assert.throws(() => executeScriptInState(state, line, makeContext(true)), /signal SIGKILL/);
});

test("test_executeScriptInState_throws_when_the_call_has_no_recorded_result", (t) => {
  // Scenario: a Bash call with no result entry is an error, not a skip.
  // the state folder is the record's cwd
  const state = new Path(makeTempFolder(t, "engine-v3-script-state-"));
  // the call line has an id that the results map does not hold
  const line = loadBashCallLine(t, "toolu_01NoResult", "true", state.toString());
  // the run throws and names the id
  assert.throws(() => executeScriptInState(state, line, makeContext(false)), /no recorded result for Bash call toolu_01NoResult/);
});

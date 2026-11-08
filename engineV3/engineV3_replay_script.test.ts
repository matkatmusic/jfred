import { test, type TestContext } from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { Path } from "../src/structures/domain.ts";
import { loadTranscript } from "../src/parse/loadTranscript.ts";
import { getJSONLLineKind, JSONLLineKind, type JSONLLine } from "./engineV3.ts";
import { applyJSONLLineToState } from "./engineV3_replay_apply.ts";
import { executeScriptInState } from "./engineV3_replay_script.ts";

const ALLOWED_TOOL_USE_ID = "toolu_015g1bMDjc15AW4kwTpRjKvK";
const OTHER_TOOL_USE_ID = "toolu_01OtherBashCallNotAllowed";
const BASH_RESULT = { stdout: "", stderr: "", interrupted: false, isImage: false, noOutputExpected: false };

function makeTempFolder(t: TestContext, prefix: string): string {
  const folder = mkdtempSync(join(tmpdir(), prefix));
  t.after(() => rmSync(folder, { recursive: true, force: true }));
  return folder;
}

function makeBashCallLine(toolUseId: string, command: string, cwd: string): object {
  const block = { type: "tool_use", id: toolUseId, name: "Bash", input: { command, description: "test" }, caller: { type: "direct" } };
  return { type: "assistant", uuid: "4b836cc7-2357-412e-9f53-b23191b3c68a", parentUuid: null, cwd, timestamp: "2026-10-27T17:24:20.837Z", sessionId: "7d31cfda-fb91-4f61-ba61-7031cb5484e2", message: { role: "assistant", content: [block] } };
}

function makeBashResultLine(toolUseId: string, cwd: string): object {
  const block = { type: "tool_result", tool_use_id: toolUseId, content: "" };
  return { type: "user", uuid: "fb4f2aa6-3410-4aaa-85d8-a8675096b95c", parentUuid: "4b836cc7-2357-412e-9f53-b23191b3c68a", cwd, timestamp: "2026-10-27T17:25:01.039Z", sessionId: "7d31cfda-fb91-4f61-ba61-7031cb5484e2", message: { role: "user", content: [block] }, toolUseResult: BASH_RESULT };
}

// Writes the call and result lines to a JSONL file and loads them; index 0 is the call, index 1 is the result.
function loadBashLines(t: TestContext, toolUseId: string, command: string, cwd: string): JSONLLine[] {
  const jsonlFile = join(makeTempFolder(t, "engine-v3-script-jsonl-"), "session.jsonl");
  const fixtureLines = [makeBashCallLine(toolUseId, command, cwd), makeBashResultLine(toolUseId, cwd)];
  writeFileSync(jsonlFile, fixtureLines.map((fixtureLine) => JSON.stringify(fixtureLine)).join("\n") + "\n");
  return loadTranscript(jsonlFile).records;
}

test("test_getJSONLLineKind_is_Script_for_the_assistant_Bash_call_with_an_allowed_tool_use_id", (t) => {
  // Scenario: the one allowed Bash call gets its assistant line marked as a script.
  // the state folder is the record's cwd
  const state = new Path(makeTempFolder(t, "engine-v3-script-state-"));
  // the file has the allowed Bash call, then its result
  const lines = loadBashLines(t, ALLOWED_TOOL_USE_ID, "true", state.toString());
  // the call line is a Script
  assert.equal(getJSONLLineKind(lines[0] as JSONLLine, state), JSONLLineKind.Script);
});

test("test_getJSONLLineKind_is_Skip_for_the_result_line_of_the_allowed_Bash_call", (t) => {
  // Scenario: the result line repeats the allowed id but does not run.
  // the state folder is the record's cwd
  const state = new Path(makeTempFolder(t, "engine-v3-script-state-"));
  // the file has the allowed Bash call, then its result
  const lines = loadBashLines(t, ALLOWED_TOOL_USE_ID, "true", state.toString());
  // the result line is Skip
  assert.equal(getJSONLLineKind(lines[1] as JSONLLine, state), JSONLLineKind.Skip);
});

test("test_getJSONLLineKind_is_Skip_for_a_Bash_call_with_a_tool_use_id_that_is_not_allowed", (t) => {
  // Scenario: every other Bash call stays Skip.
  // the state folder is the record's cwd
  const state = new Path(makeTempFolder(t, "engine-v3-script-state-"));
  // the file has a Bash call with another id, then its result
  const lines = loadBashLines(t, OTHER_TOOL_USE_ID, "true", state.toString());
  // the call line is Skip
  assert.equal(getJSONLLineKind(lines[0] as JSONLLine, state), JSONLLineKind.Skip);
});

test("test_getJSONLLineKind_is_Skip_for_an_api_request_blob_line_with_the_allowed_id", (t) => {
  // Scenario: the blob line repeats the allowed id with a cd prefix but must not run.
  // the state folder is the record's cwd
  const state = new Path(makeTempFolder(t, "engine-v3-script-state-"));
  // the blob has the assistant line's shape, but its type is api-request-blob and it has no timestamp
  const blobFixture = { ...makeBashCallLine(ALLOWED_TOOL_USE_ID, `cd ${state.toString()} && true`, state.toString()), type: "api-request-blob", timestamp: undefined };
  const blobLine = JSON.parse(JSON.stringify(blobFixture)) as JSONLLine;
  // the blob is Skip
  assert.equal(getJSONLLineKind(blobLine, state), JSONLLineKind.Skip);
});

test("test_executeScriptInState_runs_the_recorded_command_in_the_record_cwd", (t) => {
  // Scenario: the command from the assistant record writes a file in the cwd.
  // the state folder is the record's cwd
  const state = new Path(makeTempFolder(t, "engine-v3-script-state-"));
  // the file has an allowed Bash call that writes ran.txt
  const lines = loadBashLines(t, ALLOWED_TOOL_USE_ID, "echo ran > ran.txt", state.toString());
  // run the script
  executeScriptInState(state, lines[0] as JSONLLine);
  // ran.txt is in the state folder
  assert.equal(readFileSync(join(state.toString(), "ran.txt"), "utf8"), "ran\n");
});

test("test_executeScriptInState_runs_in_a_folder_inside_the_state", (t) => {
  // Scenario: a cwd below the state folder is allowed.
  // the state folder has a sub folder
  const state = new Path(makeTempFolder(t, "engine-v3-script-state-"));
  const subFolder = join(state.toString(), "sub");
  mkdirSync(subFolder);
  // the file has an allowed Bash call that writes ran.txt with the sub folder as cwd
  const lines = loadBashLines(t, ALLOWED_TOOL_USE_ID, "echo ran > ran.txt", subFolder);
  // run the script
  executeScriptInState(state, lines[0] as JSONLLine);
  // ran.txt is in the sub folder
  assert.equal(existsSync(join(subFolder, "ran.txt")), true);
});

test("test_executeScriptInState_throws_when_the_cwd_is_outside_the_state", (t) => {
  // Scenario: a cwd outside the state folder must not run.
  // the state folder and another folder are separate
  const state = new Path(makeTempFolder(t, "engine-v3-script-state-"));
  const outsideFolder = makeTempFolder(t, "engine-v3-script-outside-");
  // the file has an allowed Bash call that writes ran.txt with the outside cwd
  const lines = loadBashLines(t, ALLOWED_TOOL_USE_ID, "echo ran > ran.txt", outsideFolder);
  // the run throws
  assert.throws(() => executeScriptInState(state, lines[0] as JSONLLine), /outside/);
  // and nothing ran
  assert.equal(existsSync(join(outsideFolder, "ran.txt")), false);
});

test("test_executeScriptInState_throws_with_command_exit_code_and_stderr_on_a_non_zero_exit", (t) => {
  // Scenario: a failing command stops the replay with the full failure.
  // the state folder is the record's cwd
  const state = new Path(makeTempFolder(t, "engine-v3-script-state-"));
  // the file has an allowed Bash call that prints to stderr and exits 3
  const lines = loadBashLines(t, ALLOWED_TOOL_USE_ID, "echo boom 1>&2; exit 3", state.toString());
  // the error names the command, the exit code and the stderr
  assert.throws(() => executeScriptInState(state, lines[0] as JSONLLine), (error: Error) => {
    assert.match(error.message, /echo boom 1>&2; exit 3/);
    assert.match(error.message, /exit code 3/);
    assert.match(error.message, /boom/);
    return true;
  });
});

test("test_applyJSONLLineToState_runs_the_script_for_a_Script_line", (t) => {
  // Scenario: the docker replay entry point runs the allowed call.
  // the state folder is the record's cwd
  const state = new Path(makeTempFolder(t, "engine-v3-script-state-"));
  // the file has an allowed Bash call that writes ran.txt
  const lines = loadBashLines(t, ALLOWED_TOOL_USE_ID, "echo ran > ran.txt", state.toString());
  // replay the call line
  applyJSONLLineToState(state, lines[0] as JSONLLine, []);
  // ran.txt is in the state folder
  assert.equal(existsSync(join(state.toString(), "ran.txt")), true);
});

import { test, type TestContext } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { Path, Uuid } from "../src/structures/domain.ts";
import { loadTranscript } from "../src/parse/loadTranscript.ts";
import { getJSONLLineKind, JSONLLineKind, type JSONLLine } from "./engineV3.ts";
import { applyJSONLLineToState } from "./engineV3_replay_apply.ts";
import { executeScriptInState, SCRIPT_TIMEOUT_MILLISECONDS, type ScriptReplayContext } from "./engineV3_replay_script.ts";

function makeContext(toolUseId: string): ScriptReplayContext {
  const result = { toolUseId: new Uuid(toolUseId), startMs: 0, endMs: 1, isError: false, resultText: "", command: "" };
  return { bashCallResults: new Map([[toolUseId, result]]), writeEditResultLines: new Map(), sourceRepo: new Path("/nonexistent") };
}

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

const NEW_ALLOWED_TOOL_USE_IDS = ["toolu_01VBAyMPNnP1Mk4huzvaggVT", "toolu_019suXsjCfrijR4SbdPQCYJQ", "toolu_01KZsQLCubvTSwvFRypZFTgN"];

for (const newToolUseId of NEW_ALLOWED_TOOL_USE_IDS) {
  test(`test_getJSONLLineKind_is_Script_for_the_assistant_Bash_call_with_allowed_id_${newToolUseId}`, (t) => {
    // Scenario: each added allowed Bash call gets its assistant line marked as a script.
    const state = new Path(makeTempFolder(t, "engine-v3-script-state-"));
    // the file has the Bash call, then its result
    const lines = loadBashLines(t, newToolUseId, "true", state.toString());
    // the call line is a Script
    assert.equal(getJSONLLineKind(lines[0] as JSONLLine, state), JSONLLineKind.Script);
  });
}

test("test_getJSONLLineKind_is_Skip_for_the_result_line_of_the_allowed_Bash_call", (t) => {
  // Scenario: the result line repeats the allowed id but does not run.
  // the state folder is the record's cwd
  const state = new Path(makeTempFolder(t, "engine-v3-script-state-"));
  // the file has the allowed Bash call, then its result
  const lines = loadBashLines(t, ALLOWED_TOOL_USE_ID, "true", state.toString());
  // the result line is Skip
  assert.equal(getJSONLLineKind(lines[1] as JSONLLine, state), JSONLLineKind.Skip);
});

// The allow list is off, so a Bash call with any id is now a Script.
// test("test_getJSONLLineKind_is_Skip_for_a_Bash_call_with_a_tool_use_id_that_is_not_allowed", (t) => {
//   const state = new Path(makeTempFolder(t, "engine-v3-script-state-"));
//   const lines = loadBashLines(t, OTHER_TOOL_USE_ID, "true", state.toString());
//   assert.equal(getJSONLLineKind(lines[0] as JSONLLine, state), JSONLLineKind.Script);
// });

test("test_getJSONLLineKind_is_Script_for_a_Bash_call_with_any_tool_use_id", (t) => {
  // Scenario: every Bash call is a Script now.
  // the state folder is the record's cwd
  const state = new Path(makeTempFolder(t, "engine-v3-script-state-"));
  // the file has a Bash call with an id that was never on the allow list, then its result
  const lines = loadBashLines(t, OTHER_TOOL_USE_ID, "true", state.toString());
  // the call line is a Script
  assert.equal(getJSONLLineKind(lines[0] as JSONLLine, state), JSONLLineKind.Script);
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
  executeScriptInState(state, lines[0] as JSONLLine, makeContext(ALLOWED_TOOL_USE_ID));
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
  executeScriptInState(state, lines[0] as JSONLLine, makeContext(ALLOWED_TOOL_USE_ID));
  // ran.txt is in the sub folder
  assert.equal(existsSync(join(subFolder, "ran.txt")), true);
});

test("test_executeScriptInState_creates_a_missing_cwd_outside_the_state_and_runs_there", (t) => {
  // Scenario: a call may have run in /private/tmp or another folder that does not exist yet.
  // the state folder and a folder outside it that does not exist yet
  const state = new Path(makeTempFolder(t, "engine-v3-script-state-"));
  const outsideFolder = join(makeTempFolder(t, "engine-v3-script-outside-"), "missing", "deeper");
  // the file has a Bash call that writes ran.txt with the outside cwd
  const lines = loadBashLines(t, ALLOWED_TOOL_USE_ID, "echo ran > ran.txt", outsideFolder);
  // run the script
  executeScriptInState(state, lines[0] as JSONLLine, makeContext(ALLOWED_TOOL_USE_ID));
  // ran.txt is in the outside folder
  assert.equal(existsSync(join(outsideFolder, "ran.txt")), true);
});

// The cwd-outside-the-state check is off: calls run in any cwd.
// test("test_executeScriptInState_throws_when_the_cwd_is_outside_the_state", (t) => {
//   const state = new Path(makeTempFolder(t, "engine-v3-script-state-"));
//   const outsideFolder = makeTempFolder(t, "engine-v3-script-outside-");
//   const lines = loadBashLines(t, ALLOWED_TOOL_USE_ID, "echo ran > ran.txt", outsideFolder);
//   assert.throws(() => executeScriptInState(state, lines[0] as JSONLLine), /outside/);
//   assert.equal(existsSync(join(outsideFolder, "ran.txt")), false);
// });

test("test_executeScriptInState_throws_with_command_exit_code_and_stderr_on_a_non_zero_exit", (t) => {
  // Scenario: a failing command stops the replay with the full failure.
  // the state folder is the record's cwd
  const state = new Path(makeTempFolder(t, "engine-v3-script-state-"));
  // the file has an allowed Bash call that prints to stderr and exits 3
  const lines = loadBashLines(t, ALLOWED_TOOL_USE_ID, "echo boom 1>&2; exit 3", state.toString());
  // the error names the command, the exit code and the stderr
  assert.throws(() => executeScriptInState(state, lines[0] as JSONLLine, makeContext(ALLOWED_TOOL_USE_ID)), (error: Error) => {
    assert.match(error.message, /echo boom 1>&2; exit 3/);
    assert.match(error.message, /exit code 3/);
    assert.match(error.message, /boom/);
    return true;
  });
});

// One assistant line that holds several tool_use blocks; each block is { id, name, input }.
function loadLineWithBlocks(t: TestContext, blocks: object[], cwd: string): JSONLLine {
  const line = { type: "assistant", uuid: "4b836cc7-2357-412e-9f53-b23191b3c68a", parentUuid: null, cwd, timestamp: "2026-10-27T17:24:20.837Z", sessionId: "7d31cfda-fb91-4f61-ba61-7031cb5484e2", message: { role: "assistant", content: blocks } };
  const jsonlFile = join(makeTempFolder(t, "engine-v3-script-jsonl-"), "session.jsonl");
  writeFileSync(jsonlFile, JSON.stringify(line) + "\n");
  return loadTranscript(jsonlFile).records[0] as JSONLLine;
}

function makeBashBlock(id: string, command: string): object {
  return { type: "tool_use", id, name: "Bash", input: { command, description: "test" }, caller: { type: "direct" } };
}

test("test_executeScriptInState_runs_every_Bash_call_of_a_line_in_order", (t) => {
  // Scenario: one line with two Bash calls runs both, first call first.
  // the state folder is the record's cwd
  const state = new Path(makeTempFolder(t, "engine-v3-script-state-"));
  // the line holds a call that appends a and a call that appends b
  const line = loadLineWithBlocks(t, [makeBashBlock("toolu_01A", "echo a >> order.txt"), makeBashBlock("toolu_01B", "echo b >> order.txt")], state.toString());
  const bashCallResults = new Map([...makeContext("toolu_01A").bashCallResults, ...makeContext("toolu_01B").bashCallResults]);
  // run the line
  executeScriptInState(state, line, { bashCallResults, writeEditResultLines: new Map(), sourceRepo: new Path("/nonexistent") });
  // the file holds a then b
  assert.equal(readFileSync(join(state.toString(), "order.txt"), "utf8"), "a\nb\n");
});

test("test_executeScriptInState_runs_the_call_with_HOME_set_to_the_Mac_home_folder", (t) => {
  // Scenario: recorded commands that use ~ or $HOME see the Mac home folder.
  // the state folder is the record's cwd
  const state = new Path(makeTempFolder(t, "engine-v3-script-state-"));
  // the file has a Bash call that writes $HOME to home.txt
  const lines = loadBashLines(t, ALLOWED_TOOL_USE_ID, "echo $HOME > home.txt", state.toString());
  // run the line
  executeScriptInState(state, lines[0] as JSONLLine, makeContext(ALLOWED_TOOL_USE_ID));
  // home.txt holds the Mac home folder
  assert.equal(readFileSync(join(state.toString(), "home.txt"), "utf8"), "/Users/matkatmusicllc\n");
});

test("test_executeScriptInState_runs_the_call_with_zsh_so_echo_triple_equals_fails", (t) => {
  // Scenario: the recorded call ran in zsh, where `echo === shapes` fails with "== not found"; bash would exit 0.
  // the state folder is the record's cwd
  const state = new Path(makeTempFolder(t, "engine-v3-script-state-"));
  // the file has a Bash call whose recorded result is an error
  const lines = loadBashLines(t, ALLOWED_TOOL_USE_ID, "echo === shapes", state.toString());
  const errorResult = { toolUseId: new Uuid(ALLOWED_TOOL_USE_ID), startMs: 0, endMs: 1, isError: true, resultText: "", command: "" };
  const errorContext = { bashCallResults: new Map([[ALLOWED_TOOL_USE_ID, errorResult]]), writeEditResultLines: new Map(), sourceRepo: new Path("/nonexistent") };
  // running the line does not throw, because the call exits non-zero as recorded
  assert.doesNotThrow(() => executeScriptInState(state, lines[0] as JSONLLine, errorContext));
});

test("test_getJSONLLineKind_is_Script_for_a_ctx_execute_shell_run", (t) => {
  // Scenario: a ctx_execute shell run moves files for real, so the replay runs it.
  // the state folder is the record's cwd
  const state = new Path(makeTempFolder(t, "engine-v3-script-state-"));
  // the line holds one ctx_execute call with language shell
  const block = { type: "tool_use", id: "toolu_01Ctx", name: "mcp__plugin_context-mode_context-mode__ctx_execute", input: { language: "shell", code: "true" } };
  const line = loadLineWithBlocks(t, [block], state.toString());
  // the line is a Script
  assert.equal(getJSONLLineKind(line, state), JSONLLineKind.Script);
});

test("test_getJSONLLineKind_is_Skip_for_a_ctx_execute_javascript_run", (t) => {
  // Scenario: only python and shell ctx_execute runs are replayed.
  // the state folder is the record's cwd
  const state = new Path(makeTempFolder(t, "engine-v3-script-state-"));
  // the line holds one ctx_execute call with language javascript
  const line = loadLineWithBlocks(t, [makeCtxExecuteBlock("toolu_01CtxJs", "javascript", "1")], state.toString());
  // the line is Skip
  assert.equal(getJSONLLineKind(line, state), JSONLLineKind.Skip);
});

test("test_executeScriptInState_runs_a_ctx_execute_shell_run", (t) => {
  // Scenario: the shell code renames a file inside the state folder.
  // the state folder holds one.py
  const state = new Path(makeTempFolder(t, "engine-v3-script-state-"));
  writeFileSync(join(state.toString(), "one.py"), "x");
  // the line holds a ctx_execute shell call that renames one.py to core_one.py
  const line = loadLineWithBlocks(t, [makeCtxExecuteBlock("toolu_01CtxSh", "shell", "mv one.py core_one.py")], state.toString());
  // run the line
  executeScriptInState(state, line, makeContext("toolu_01CtxSh"));
  // core_one.py exists and one.py does not
  assert.equal(existsSync(join(state.toString(), "core_one.py")), true);
  assert.equal(existsSync(join(state.toString(), "one.py")), false);
});

function makeCtxExecuteBlock(id: string, language: string, code: string): object {
  return { type: "tool_use", id, name: "mcp__plugin_context-mode_context-mode__ctx_execute", input: { language, code }, caller: { type: "direct" } };
}

test("test_getJSONLLineKind_is_Script_for_a_ctx_execute_python_run", (t) => {
  // Scenario: a ctx_execute python run moves files for real, so the replay runs it.
  // the state folder is the record's cwd
  const state = new Path(makeTempFolder(t, "engine-v3-script-state-"));
  // the line holds one ctx_execute call with language python
  const line = loadLineWithBlocks(t, [makeCtxExecuteBlock("toolu_01CtxPy", "python", "pass")], state.toString());
  // the line is a Script
  assert.equal(getJSONLLineKind(line, state), JSONLLineKind.Script);
});

test("test_executeScriptInState_runs_a_ctx_execute_python_run", (t) => {
  // Scenario: the python code renames a file inside the state folder.
  // the state folder holds one.py
  const state = new Path(makeTempFolder(t, "engine-v3-script-state-"));
  writeFileSync(join(state.toString(), "one.py"), "x");
  // the line holds a ctx_execute python call that renames one.py to core_one.py by absolute path (a python run starts in its own temp folder)
  const line = loadLineWithBlocks(t, [makeCtxExecuteBlock("toolu_01CtxPy", "python", `import shutil\nshutil.move('${state.toString()}/one.py', '${state.toString()}/core_one.py')`)], state.toString());
  // run the line
  executeScriptInState(state, line, makeContext("toolu_01CtxPy"));
  // core_one.py exists and one.py does not
  assert.equal(existsSync(join(state.toString(), "core_one.py")), true);
  assert.equal(existsSync(join(state.toString(), "one.py")), false);
});

test("test_executeScriptInState_runs_the_debt_report_call_as_the_fix_script", (t) => {
  // Scenario: a recorded call of debt-ratchet-report.ts reformats the tracked files, and the replay does it with the fix script.
  // the state is a git repo with one tracked file in 4-space layout
  const state = new Path(makeTempFolder(t, "engine-v3-script-debt-"));
  execFileSync("git", ["init", "-q"], { cwd: state.toString() });
  writeFileSync(join(state.toString(), "one.ts"), "export function getOne(): number {\n    return 1;\n}\n");
  execFileSync("git", ["add", "."], { cwd: state.toString() });
  // the line holds a Bash call of a report script that does not exist, so only the fix script can reformat the file
  const line = loadBashLines(t, ALLOWED_TOOL_USE_ID, "node /nonexistent/debt-ratchet/debt-ratchet-report.ts", state.toString())[0] as JSONLLine;
  // run the line
  executeScriptInState(state, line, makeContext(ALLOWED_TOOL_USE_ID));
  // the file is in the 2-space layout
  assert.equal(readFileSync(join(state.toString(), "one.ts"), "utf8"), "export function getOne(): number {\n  return 1;\n}\n");
});

test("test_script_timeout_allows_the_debt_report_to_finish_in_the_container", () => {
  // Scenario: the style debt report (eslint --fix on every tracked file) takes 60 seconds alone in the container and more than 120 seconds under load.
  // the script timeout is at least 5 minutes
  assert.equal(SCRIPT_TIMEOUT_MILLISECONDS >= 300000, true);
});

test("test_applyJSONLLineToState_runs_the_script_for_a_Script_line", (t) => {
  // Scenario: the docker replay entry point runs the allowed call.
  // the state folder is the record's cwd
  const state = new Path(makeTempFolder(t, "engine-v3-script-state-"));
  // the file has an allowed Bash call that writes ran.txt
  const lines = loadBashLines(t, ALLOWED_TOOL_USE_ID, "echo ran > ran.txt", state.toString());
  // replay the call line
  applyJSONLLineToState(state, lines[0] as JSONLLine, [], makeContext(ALLOWED_TOOL_USE_ID));
  // ran.txt is in the state folder
  assert.equal(existsSync(join(state.toString(), "ran.txt")), true);
});

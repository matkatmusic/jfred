import { test, type TestContext } from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

import { Path, Uuid } from "../src/structures/domain.ts";
import { loadTranscript } from "../src/parse/loadTranscript.ts";
import { TimelineEventKind, type JSONLLine } from "./engineV3.ts";
import { doSomethingWithEvent } from "./engineV3_replay.ts";
import { createSessionScratchpadFolder } from "./engineV3_replay_scratchpad.ts";
import type { ScriptReplayContext } from "./engineV3_replay_script.ts";

const SESSION_ID = "3fb58926-1522-4812-bab6-cdd6e5391f9a";
const PROJECT_FOLDER_NAME = "-Users-test-Programming-Project";
const TOOL_USE_ID = "toolu_01Ryoc6e5izHVcbZWzWys4hK";
const BASH_RESULT = { stdout: "", stderr: "", interrupted: false, isImage: false, noOutputExpected: false };

function makeTempFolder(t: TestContext, prefix: string): string {
  const folder = mkdtempSync(join(tmpdir(), prefix));
  t.after(() => rmSync(folder, { recursive: true, force: true }));
  return folder;
}

function makeBashCallLine(command: string, cwd: string): object {
  const block = { type: "tool_use", id: TOOL_USE_ID, name: "Bash", input: { command, description: "test" }, caller: { type: "direct" } };
  return { type: "assistant", uuid: "d7f8e7be-8ed2-4846-82fa-8ccbfa2896ae", parentUuid: null, cwd, timestamp: "2026-10-04T17:10:04.694Z", sessionId: SESSION_ID, message: { role: "assistant", content: [block] } };
}

function makeBashResultLine(cwd: string): object {
  const block = { type: "tool_result", tool_use_id: TOOL_USE_ID, content: "" };
  return { type: "user", uuid: "876d4a58-36cc-4d5f-bbf1-686114b019cb", parentUuid: "d7f8e7be-8ed2-4846-82fa-8ccbfa2896ae", cwd, timestamp: "2026-10-04T17:10:14.523Z", sessionId: SESSION_ID, message: { role: "user", content: [block] }, toolUseResult: BASH_RESULT };
}

// Writes the call and result lines to a JSONL file at the given place under the project folder and loads the call line.
function loadBashCallLine(t: TestContext, pathUnderProjectFolder: string, command: string, cwd: string): JSONLLine {
  const jsonlFile = join(makeTempFolder(t, "engine-v3-scratchpad-jsonl-"), PROJECT_FOLDER_NAME, pathUnderProjectFolder);
  mkdirSync(dirname(jsonlFile), { recursive: true });
  const fixtureLines = [makeBashCallLine(command, cwd), makeBashResultLine(cwd)];
  writeFileSync(jsonlFile, fixtureLines.map((fixtureLine) => JSON.stringify(fixtureLine)).join("\n") + "\n");
  return loadTranscript(jsonlFile).records[0] as JSONLLine;
}

function makeContext(claudeTempFolder: Path): ScriptReplayContext {
  const result = { toolUseId: new Uuid(TOOL_USE_ID), startMs: 0, endMs: 1, isError: false, resultText: "" };
  return { bashCallResults: new Map([[TOOL_USE_ID, result]]), writeEditResultLines: new Map(), sourceRepo: undefined, claudeTempFolder };
}

const SUBAGENT_LOG = join(SESSION_ID, "subagents", "agent-aa90aa7ea089428e8.jsonl");
const LOG_LAYOUTS = [`${SESSION_ID}.jsonl`, SUBAGENT_LOG, join(SESSION_ID, "subagents", "workflows", "wf_008ab9c3-4d1", "agent-a1.jsonl")];

for (const logLayout of LOG_LAYOUTS) {
  test(`test_createSessionScratchpadFolder_makes_the_scratchpad_of_the_line_session_for_log_${logLayout}`, (t) => {
    // Scenario: Claude Code makes <temp folder>/<project folder name>/<session id>/scratchpad when a session starts, for each place a log can sit.
    const claudeTempFolder = new Path(makeTempFolder(t, "engine-v3-scratchpad-claude-temp-"));
    // a line of the session sits in a log at this place under the project folder
    const line = loadBashCallLine(t, logLayout, "true", "/tmp");
    // the replay makes the session scratchpad for the line
    createSessionScratchpadFolder(claudeTempFolder, line);
    // the scratchpad folder exists under the project folder name and the session id
    assert.equal(existsSync(join(claudeTempFolder.toString(), PROJECT_FOLDER_NAME, SESSION_ID, "scratchpad")), true);
  });
}

test("test_doSomethingWithEvent_lets_a_Bash_call_write_into_the_session_scratchpad_without_making_it", (t) => {
  // Scenario: subagent line 37 of 3fb58926 writes head.md into its session scratchpad, then copies it over the spec; no recorded call makes that folder.
  const claudeTempFolder = new Path(makeTempFolder(t, "engine-v3-scratchpad-claude-temp-"));
  const state = makeTempFolder(t, "engine-v3-scratchpad-state-");
  writeFileSync(join(state, "spec.md"), "old\n");
  // the command fails at the redirect when the folder is missing, and the last command still exits 0
  const headFile = join(claudeTempFolder.toString(), PROJECT_FOLDER_NAME, SESSION_ID, "scratchpad", "head.md");
  const command = `printf 'new\\n' > ${headFile} && cp ${headFile} spec.md; true`;
  const line = loadBashCallLine(t, SUBAGENT_LOG, command, state);
  // the replay applies the Bash line
  doSomethingWithEvent(new Path(state), { type: TimelineEventKind.JSONLLine, line, timestamp: 0 }, undefined, [], [], makeContext(claudeTempFolder));
  // the spec holds the new text, as on the Mac
  assert.equal(readFileSync(join(state, "spec.md"), "utf8"), "new\n");
});

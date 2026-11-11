import { test, type TestContext } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Path, Uuid } from "../src/structures/domain.ts";
import { loadTranscript } from "../src/parse/loadTranscript.ts";
import type { JSONLLine } from "./engineV3.ts";
import { executeScriptInState, type ScriptReplayContext } from "./engineV3_replay_script.ts";
const RECORDED_TOOL_USE_ID = "toolu_01ClaudeCodeEnvBashCall";
function makeContext(toolUseId: string): ScriptReplayContext {
  const result = { toolUseId: new Uuid(toolUseId), startMs: 0, endMs: 1, isError: false, resultText: "", command: "" };
  return { bashCallResults: new Map([[toolUseId, result]]), writeEditResultLines: new Map(), sourceRepo: new Path("/nonexistent") };
}
function makeTempFolder(t: TestContext, prefix: string): string {
  const folder = mkdtempSync(join(tmpdir(), prefix));
  t.after(() => rmSync(folder, { recursive: true, force: true }));
  return folder;
}
function loadBashLine(t: TestContext, command: string, cwd: string): JSONLLine {
  const jsonlFile = join(makeTempFolder(t, "engine-v3-claudecode-jsonl-"), "session.jsonl");
  const block = { type: "tool_use", id: RECORDED_TOOL_USE_ID, name: "Bash", input: { command }, caller: { type: "direct" } };
  const callLine = { type: "assistant", uuid: "4b836cc7-2357-412e-9f53-b23191b3c68a", parentUuid: null, cwd, timestamp: "2026-10-27T17:24:20.837Z", sessionId: "7d31cfda-fb91-4f61-ba61-7031cb5484e2", message: { role: "assistant", content: [block] } };
  writeFileSync(jsonlFile, JSON.stringify(callLine) + "\n");
  return loadTranscript(jsonlFile).records[0] as JSONLLine;
}
test("test_executeScriptInState_sets_CLAUDECODE_to_1_like_the_Mac_Bash_tool", (t) => {
  // Scenario: bun test hides passing test names when CLAUDECODE is set, and Claude Code sets it for every Bash call, so the replay must set it too.
  // the state folder is the record's cwd
  const state = new Path(makeTempFolder(t, "engine-v3-claudecode-state-"));
  // the line holds a command that writes the CLAUDECODE variable to a file
  const line = loadBashLine(t, 'printf %s "$CLAUDECODE" > claudecode.txt', state.toString());
  // run the line
  executeScriptInState(state, line, makeContext(RECORDED_TOOL_USE_ID));
  // the file holds 1
  assert.equal(readFileSync(join(state.toString(), "claudecode.txt"), "utf8"), "1");
});

import { test, type TestContext } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Path, Uuid } from "../src/structures/domain.ts";
import { loadTranscript } from "../src/parse/loadTranscript.ts";
import type { JSONLLine } from "./engineV3.ts";
import { executeScriptInState, type ScriptReplayContext } from "./engineV3_replay_script.ts";
const RECORDED_TOOL_USE_ID = "toolu_01RecordedAtBashCall";
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
  const jsonlFile = join(makeTempFolder(t, "engine-v3-recorded-at-jsonl-"), "session.jsonl");
  const block = { type: "tool_use", id: RECORDED_TOOL_USE_ID, name: "Bash", input: { command }, caller: { type: "direct" } };
  const callLine = { type: "assistant", uuid: "4b836cc7-2357-412e-9f53-b23191b3c68a", parentUuid: null, cwd, timestamp: "2026-10-27T17:24:20.837Z", sessionId: "7d31cfda-fb91-4f61-ba61-7031cb5484e2", message: { role: "assistant", content: [block] } };
  writeFileSync(jsonlFile, JSON.stringify(callLine) + "\n");
  return loadTranscript(jsonlFile).records[0] as JSONLLine;
}
test("test_executeScriptInState_gives_the_command_its_recorded_time_in_epoch_seconds", (t) => {
  // Scenario: a recorded bun add must resolve the package versions that existed when it was recorded, so the shell needs the recorded time.
  // the state folder is the record's cwd
  const state = new Path(makeTempFolder(t, "engine-v3-recorded-at-state-"));
  // the line holds a command that writes the recorded time variable to a file; the record time is 2026-10-27T17:24:20.837Z
  const line = loadBashLine(t, "echo $REPLAY_RECORDED_AT_EPOCH_SECONDS > recorded.txt", state.toString());
  // run the line
  executeScriptInState(state, line, makeContext(RECORDED_TOOL_USE_ID));
  // the file holds 1793121860, the record time in whole seconds
  assert.equal(readFileSync(join(state.toString(), "recorded.txt"), "utf8").trim(), "1793121860");
});

import { test, type TestContext } from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Path, Uuid } from "../src/structures/domain.ts";
import { loadTranscript } from "../src/parse/loadTranscript.ts";
import type { JSONLLine } from "./engineV3.ts";
import { executeScriptInState, type ScriptReplayContext } from "./engineV3_replay_script.ts";
const BACKGROUND_TOOL_USE_ID = "toolu_01BackgroundBashCall";
function makeContext(toolUseId: string): ScriptReplayContext {
  const result = { toolUseId: new Uuid(toolUseId), startMs: 0, endMs: 1, isError: false, resultText: "Command running in background with ID: bg1.", command: "" };
  return { bashCallResults: new Map([[toolUseId, result]]), writeEditResultLines: new Map(), sourceRepo: new Path("/nonexistent") };
}
function makeTempFolder(t: TestContext, prefix: string): string {
  const folder = mkdtempSync(join(tmpdir(), prefix));
  t.after(() => rmSync(folder, { recursive: true, force: true }));
  return folder;
}
function loadBackgroundBashLine(t: TestContext, command: string, cwd: string): JSONLLine {
  const jsonlFile = join(makeTempFolder(t, "engine-v3-background-jsonl-"), "session.jsonl");
  const block = { type: "tool_use", id: BACKGROUND_TOOL_USE_ID, name: "Bash", input: { command, run_in_background: true }, caller: { type: "direct" } };
  const callLine = { type: "assistant", uuid: "4b836cc7-2357-412e-9f53-b23191b3c68a", parentUuid: null, cwd, timestamp: "2026-10-27T17:24:20.837Z", sessionId: "7d31cfda-fb91-4f61-ba61-7031cb5484e2", message: { role: "assistant", content: [block] } };
  writeFileSync(jsonlFile, JSON.stringify(callLine) + "\n");
  return loadTranscript(jsonlFile).records[0] as JSONLLine;
}
test("test_executeScriptInState_does_not_wait_for_a_run_in_background_command_to_finish", (t) => {
  // Scenario: a dev server recorded with run_in_background never exits, so the replay must start it and move on.
  // the state folder is the record's cwd
  const state = new Path(makeTempFolder(t, "engine-v3-background-state-"));
  // the line holds a background Bash call that prints, writes a file, then runs for 30 seconds
  const line = loadBackgroundBashLine(t, "echo started; echo ran > ran.txt; sleep 30", state.toString());
  // run the line and time it
  const startMs = Date.now();
  executeScriptInState(state, line, makeContext(BACKGROUND_TOOL_USE_ID));
  const elapsedMs = Date.now() - startMs;
  // the replay moved on within 10 seconds
  assert.equal(elapsedMs < 10000, true);
  // the command did start
  assert.equal(existsSync(join(state.toString(), "ran.txt")), true);
});

import { test, type TestContext } from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Path, Uuid } from "../src/structures/domain.ts";
import { loadTranscript } from "../src/parse/loadTranscript.ts";
import type { JSONLLine } from "./engineV3.ts";
import { executeScriptInState, type ScriptReplayContext } from "./engineV3_replay_script.ts";
const PKILL_TOOL_USE_ID = "toolu_01PkillBashCall";
function makeContext(toolUseId: string): ScriptReplayContext {
  const result = { toolUseId: new Uuid(toolUseId), startMs: 0, endMs: 1, isError: false, resultText: "" };
  return { bashCallResults: new Map([[toolUseId, result]]), writeEditResultLines: new Map(), sourceRepo: new Path("/nonexistent") };
}
function makeTempFolder(t: TestContext, prefix: string): string {
  const folder = mkdtempSync(join(tmpdir(), prefix));
  t.after(() => rmSync(folder, { recursive: true, force: true }));
  return folder;
}
function loadBashLine(t: TestContext, command: string, cwd: string): JSONLLine {
  const jsonlFile = join(makeTempFolder(t, "engine-v3-pkill-jsonl-"), "session.jsonl");
  const block = { type: "tool_use", id: PKILL_TOOL_USE_ID, name: "Bash", input: { command }, caller: { type: "direct" } };
  const callLine = { type: "assistant", uuid: "4b836cc7-2357-412e-9f53-b23191b3c68a", parentUuid: null, cwd, timestamp: "2026-10-27T17:24:20.837Z", sessionId: "7d31cfda-fb91-4f61-ba61-7031cb5484e2", message: { role: "assistant", content: [block] } };
  writeFileSync(jsonlFile, JSON.stringify(callLine) + "\n");
  return loadTranscript(jsonlFile).records[0] as JSONLLine;
}
test("test_executeScriptInState_does_not_kill_its_own_shell_when_the_command_runs_pkill_f_on_its_own_text", (t) => {
  // Scenario: on the Mac the Bash tool shell has the command text in no process argument, so `pkill -f <text>` kills only other processes.
  // the state folder is the record's cwd
  const state = new Path(makeTempFolder(t, "engine-v3-pkill-state-"));
  // the line holds a command that runs pkill -f on a pattern its own text contains, then writes a file
  const line = loadBashLine(t, "pkill -f 'pkill-self-marker-8431'; echo survived > survived.txt", state.toString());
  // run the line
  executeScriptInState(state, line, makeContext(PKILL_TOOL_USE_ID));
  // the shell lived to write the file
  assert.equal(existsSync(join(state.toString(), "survived.txt")), true);
});

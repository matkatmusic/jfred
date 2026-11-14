import { test, type TestContext } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Path, Uuid } from "../src/structures/domain.ts";
import { loadTranscript } from "../src/parse/loadTranscript.ts";
import type { JSONLLine } from "./engineV3.ts";
import { executeScriptInState, type ScriptReplayContext } from "./engineV3_replay_script.ts";
const RECORDED_TOOL_USE_ID = "toolu_01StdinBashCall";
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
  const jsonlFile = join(makeTempFolder(t, "engine-v3-stdin-jsonl-"), "session.jsonl");
  const block = { type: "tool_use", id: RECORDED_TOOL_USE_ID, name: "Bash", input: { command }, caller: { type: "direct" } };
  const callLine = { type: "assistant", uuid: "4b836cc7-2357-412e-9f53-b23191b3c68a", parentUuid: null, cwd, timestamp: "2026-10-27T17:24:20.837Z", sessionId: "7d31cfda-fb91-4f61-ba61-7031cb5484e2", message: { role: "assistant", content: [block] } };
  writeFileSync(jsonlFile, JSON.stringify(callLine) + "\n");
  return loadTranscript(jsonlFile).records[0] as JSONLLine;
}
test("test_executeScriptInState_gives_the_command_no_stdin_so_rg_with_no_path_searches_the_folder", (t) => {
  // Scenario: rg with no path searches stdin when stdin is a pipe, so the replay must give the command no stdin, like the Mac Bash tool.
  // the state folder holds a .ts file that names the needle
  const state = new Path(makeTempFolder(t, "engine-v3-stdin-state-"));
  writeFileSync(join(state.toString(), "found.ts"), "const needle = 1;\n");
  // the line holds an rg command with no path that writes its matches to a file
  const line = loadBashLine(t, "rg -n needle --glob '*.ts' > matches.txt", state.toString());
  // run the line
  executeScriptInState(state, line, makeContext(RECORDED_TOOL_USE_ID));
  // the file holds the match from found.ts
  assert.equal(readFileSync(join(state.toString(), "matches.txt"), "utf8"), "found.ts:1:const needle = 1;\n");
});

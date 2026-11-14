import { test, type TestContext } from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Path, Uuid } from "../src/structures/domain.ts";
import { loadTranscript } from "../src/parse/loadTranscript.ts";
import type { JSONLLine } from "./engineV3.ts";
import { executeScriptInState, type ScriptReplayContext } from "./engineV3_replay_script.ts";
const SCRIPT_TOOL_USE_ID = "toolu_01MacOnlyScriptCall";
const CHROME_LAUNCH_LINE = "const chromeProgram = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'\nconsole.log('no display here', chromeProgram.length > 0)\n";
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
  const jsonlFile = join(makeTempFolder(t, "engine-v3-mac-only-jsonl-"), "session.jsonl");
  const block = { type: "tool_use", id: SCRIPT_TOOL_USE_ID, name: "Bash", input: { command }, caller: { type: "direct" } };
  const callLine = { type: "assistant", uuid: "4b836cc7-2357-412e-9f53-b23191b3c68a", parentUuid: null, cwd, timestamp: "2026-10-27T17:24:20.837Z", sessionId: "7d31cfda-fb91-4f61-ba61-7031cb5484e2", message: { role: "assistant", content: [block] } };
  writeFileSync(jsonlFile, JSON.stringify(callLine) + "\n");
  return loadTranscript(jsonlFile).records[0] as JSONLLine;
}
test("test_executeScriptInState_skips_a_bun_script_that_launches_the_Mac_only_Chrome", (t) => {
  // Scenario: a recorded `cd pup && bun dbl.ts | rg display` drove Google Chrome on the Mac; the container has no Chrome, so running it would exit 1.
  // the state folder has pup/dbl.ts, which launches the Mac Chrome program
  const state = new Path(makeTempFolder(t, "engine-v3-mac-only-state-"));
  mkdirSync(join(state.toString(), "pup"));
  writeFileSync(join(state.toString(), "pup", "dbl.ts"), CHROME_LAUNCH_LINE);
  // the line runs that script through rg, which exits 1 when no printed line matches
  const line = loadBashLine(t, `cd ${state.toString()}/pup && bun dbl.ts 2>&1 | rg "NEVER_PRINTED_TEXT"`, state.toString());
  // replaying the line does not throw
  assert.doesNotThrow(() => executeScriptInState(state, line, makeContext(SCRIPT_TOOL_USE_ID)));
});
test("test_executeScriptInState_runs_a_bun_script_that_does_not_launch_Chrome", (t) => {
  // Scenario: the skip is only for scripts that name the Mac Chrome program.
  // the state folder has pup/plain.ts, which writes a file
  const state = new Path(makeTempFolder(t, "engine-v3-mac-only-state-"));
  mkdirSync(join(state.toString(), "pup"));
  writeFileSync(join(state.toString(), "pup", "plain.ts"), 'import { writeFileSync } from "node:fs";\nwriteFileSync("ran.txt", "ran");\n');
  // the line runs that script
  const line = loadBashLine(t, `cd ${state.toString()}/pup && bun plain.ts`, state.toString());
  // replay the line
  executeScriptInState(state, line, makeContext(SCRIPT_TOOL_USE_ID));
  // the script ran
  assert.equal(existsSync(join(state.toString(), "pup", "ran.txt")), true);
});

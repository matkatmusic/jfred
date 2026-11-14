import { test, type TestContext } from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Path, Uuid } from "../src/structures/domain.ts";
import { loadTranscript } from "../src/parse/loadTranscript.ts";
import type { JSONLLine } from "./engineV3.ts";
import { executeScriptInState, type ScriptReplayContext } from "./engineV3_replay_script.ts";
const SCRATCHPAD_TOOL_USE_ID = "toolu_01ScratchpadBashCall";
const TEST_CLAUDE_TMP_FOLDER = "/private/tmp/claude-99999";
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
  const jsonlFile = join(makeTempFolder(t, "engine-v3-scratchpad-jsonl-"), "session.jsonl");
  const block = { type: "tool_use", id: SCRATCHPAD_TOOL_USE_ID, name: "Bash", input: { command }, caller: { type: "direct" } };
  const callLine = { type: "assistant", uuid: "4b836cc7-2357-412e-9f53-b23191b3c68a", parentUuid: null, cwd, timestamp: "2026-10-27T17:24:20.837Z", sessionId: "7d31cfda-fb91-4f61-ba61-7031cb5484e2", message: { role: "assistant", content: [block] } };
  writeFileSync(jsonlFile, JSON.stringify(callLine) + "\n");
  return loadTranscript(jsonlFile).records[0] as JSONLLine;
}
test("test_executeScriptInState_creates_the_session_scratchpad_folder_the_command_names", (t) => {
  // Scenario: Claude Code makes the session scratchpad folder at session start, so a recorded `cd $S && ...` works on the Mac; the replay must make it too.
  // the state folder is the record's cwd
  const state = new Path(makeTempFolder(t, "engine-v3-scratchpad-state-"));
  // the scratchpad folder of a fake session does not exist yet
  t.after(() => rmSync(TEST_CLAUDE_TMP_FOLDER, { recursive: true, force: true }));
  const scratchpad = `${TEST_CLAUDE_TMP_FOLDER}/-Users-test-project/2fa36f95-01f4-42c5-936b-6abbce7a78a9/scratchpad`;
  assert.equal(existsSync(scratchpad), false);
  // the line cd's into the scratchpad with `&&`, writes a marker there, and ends with `true` so a failed cd would not change the exit code
  const line = loadBashLine(t, `S=${scratchpad}; cd $S && echo ran > $S/marker.txt; true`, state.toString());
  // run the line
  executeScriptInState(state, line, makeContext(SCRATCHPAD_TOOL_USE_ID));
  // the marker is in the scratchpad
  assert.equal(existsSync(join(scratchpad, "marker.txt")), true);
});

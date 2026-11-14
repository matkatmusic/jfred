import { test, type TestContext } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Path, Uuid } from "../src/structures/domain.ts";
import { loadTranscript } from "../src/parse/loadTranscript.ts";
import type { JSONLLine } from "./engineV3.ts";
import { executeScriptInState, type ScriptReplayContext } from "./engineV3_replay_script.ts";
const BACKGROUND_TOOL_USE_ID = "toolu_01BackgroundOutputBashCall";
const EXIT_LINE_TIMEOUT_MILLISECONDS = 10000;
function makeContext(toolUseId: string, outputPath: string): ScriptReplayContext {
  const resultText = `Command running in background with ID: bfisnv02h. Output is being written to: ${outputPath}. You will be notified when it completes — do not poll that file or sleep while waiting.`;
  const result = { toolUseId: new Uuid(toolUseId), startMs: 0, endMs: 1, isError: false, resultText, command: "" };
  return { bashCallResults: new Map([[toolUseId, result]]), writeEditResultLines: new Map(), sourceRepo: new Path("/nonexistent") };
}
function makeTempFolder(t: TestContext, prefix: string): string {
  const folder = mkdtempSync(join(tmpdir(), prefix));
  t.after(() => rmSync(folder, { recursive: true, force: true }));
  return folder;
}
function loadBackgroundBashLine(t: TestContext, command: string, cwd: string): JSONLLine {
  const jsonlFile = join(makeTempFolder(t, "engine-v3-background-output-jsonl-"), "session.jsonl");
  const block = { type: "tool_use", id: BACKGROUND_TOOL_USE_ID, name: "Bash", input: { command, run_in_background: true }, caller: { type: "direct" } };
  const callLine = { type: "assistant", uuid: "4b836cc7-2357-412e-9f53-b23191b3c68a", parentUuid: null, cwd, timestamp: "2026-10-27T17:24:20.837Z", sessionId: "7d31cfda-fb91-4f61-ba61-7031cb5484e2", message: { role: "assistant", content: [block] } };
  writeFileSync(jsonlFile, JSON.stringify(callLine) + "\n");
  return loadTranscript(jsonlFile).records[0] as JSONLLine;
}
function readOutputFileAfterExitLine(outputPath: string): string {
  const deadlineMs = Date.now() + EXIT_LINE_TIMEOUT_MILLISECONDS;
  let content = readFileSync(outputPath, "utf8");
  while (!content.includes("[exited with code")) {
    assert.equal(Date.now() < deadlineMs, true, `no exit line in ${outputPath}; content: ${content}`);
    Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 50);
    content = readFileSync(outputPath, "utf8");
  }
  return content;
}
test("test_executeScriptInState_writes_the_background_output_at_the_path_in_the_recorded_result_with_the_exit_line", (t) => {
  // Scenario: Claude Code writes a background command's output to the path in "Output is being written to: <path>." and adds "\n[exited with code N]" when the command exits.
  // the state folder is the record's cwd
  const state = new Path(makeTempFolder(t, "engine-v3-background-output-state-"));
  // the recorded result names an output file inside a folder that does not exist yet
  const outputPath = join(makeTempFolder(t, "engine-v3-background-output-root-"), "tasks", "bfisnv02h.output");
  // the line holds a background Bash call that prints 200 and exits 0
  // merge: `touch` changes a file, so the replay does not skip the call as a read-only call (Attune rule)
  const line = loadBackgroundBashLine(t, "touch marker.txt; echo 200", state.toString());
  // run the line
  executeScriptInState(state, line, makeContext(BACKGROUND_TOOL_USE_ID, outputPath));
  // the file at the recorded path holds the printed text, a blank line, and the exit line
  assert.equal(readOutputFileAfterExitLine(outputPath), "200\n\n[exited with code 0]");
});
test("test_executeScriptInState_writes_the_nonzero_exit_code_in_the_background_exit_line", (t) => {
  // Scenario: the exit line carries the command's real exit code.
  // the state folder is the record's cwd
  const state = new Path(makeTempFolder(t, "engine-v3-background-output-state-"));
  // the recorded result names an output file
  const outputPath = join(makeTempFolder(t, "engine-v3-background-output-root-"), "bg.output");
  // the line holds a background Bash call that prints boom to stderr and exits 3
  const line = loadBackgroundBashLine(t, "echo boom >&2; exit 3", state.toString());
  // run the line
  executeScriptInState(state, line, makeContext(BACKGROUND_TOOL_USE_ID, outputPath));
  // the file holds the stderr text and the exit line with code 3
  assert.equal(readOutputFileAfterExitLine(outputPath), "boom\n\n[exited with code 3]");
});

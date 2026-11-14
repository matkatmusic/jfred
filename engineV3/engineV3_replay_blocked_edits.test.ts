import { test, type TestContext } from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { Path } from "../src/structures/domain.ts";
import { loadTranscript } from "../src/parse/loadTranscript.ts";
import type { JSONLLine } from "./engineV3.ts";
import { applyJSONLLineToState } from "./engineV3_replay_apply.ts";
import type { ScriptReplayContext } from "./engineV3_replay_script.ts";

const SESSION_ID = "79872fd4-40ad-40af-875a-46b3527317a2";
const CALL_UUID = "7d3a2d2c-df18-463b-8deb-28f3855e4064";
const RESULT_UUID = "4cb75c64-29c0-49fe-9ac1-4243f895a735";

function makeTempFolder(t: TestContext, prefix: string): string {
  const folder = mkdtempSync(join(tmpdir(), prefix));
  t.after(() => rmSync(folder, { recursive: true, force: true }));
  return folder;
}

function makeCallLine(callId: string, toolName: string, input: object, wireToolInputs: object | undefined): object {
  const block = { type: "tool_use", id: callId, name: toolName, input, caller: { type: "direct" } };
  const line: Record<string, unknown> = { type: "assistant", uuid: CALL_UUID, parentUuid: null, cwd: "/tmp", timestamp: "2026-10-06T18:38:02.830Z", sessionId: SESSION_ID, message: { role: "assistant", content: [block] } };
  if (wireToolInputs !== undefined) {
    line.wireToolInputs = { [callId]: wireToolInputs };
  }
  return line;
}

function makeBlockedResultLine(callId: string, toolName: string, savedPath: string): object {
  const denialText = `PreToolUse:${toolName} hook error: Parent session must not edit files. Delegate the edit to the \`edit-worker\` agent. Your blocked tool call is saved at ${savedPath} (JSON of the tool input). Tell the subagent to read that file and apply it.`;
  const block = { type: "tool_result", content: denialText, is_error: true, tool_use_id: callId };
  return { type: "user", uuid: RESULT_UUID, parentUuid: CALL_UUID, cwd: "/tmp", timestamp: "2026-10-06T18:38:03.077Z", sessionId: SESSION_ID, message: { role: "user", content: [block] }, toolUseResult: `Error: ${denialText}`, sourceToolAssistantUUID: CALL_UUID };
}

function loadLines(t: TestContext, fixtureLines: object[]): JSONLLine[] {
  const jsonlFile = join(makeTempFolder(t, "engine-v3-blocked-edits-jsonl-"), `${SESSION_ID}.jsonl`);
  writeFileSync(jsonlFile, fixtureLines.map((fixtureLine) => JSON.stringify(fixtureLine)).join("\n") + "\n");
  // The engine loads lines with unmodeled keys (wireToolInputs) allowed, as loadFileRecords does.
  return loadTranscript(jsonlFile, undefined, true).records as JSONLLine[];
}

function makeContext(callId: string, resultLine: JSONLLine): ScriptReplayContext {
  return { bashCallResults: new Map(), writeEditResultLines: new Map([[callId, resultLine]]), sourceRepo: new Path("/nonexistent") };
}

test("test_blocked_write_result_makes_the_saved_file_with_the_recorded_input", (t) => {
  // Scenario: the parent's Write is blocked by the block-parent-edits hook, which saved the tool input at a temp path.
  // Steps:
  // the state folder holds the project; the saved path sits in another temp folder.
  const stateFolder = makeTempFolder(t, "engine-v3-blocked-edits-state-");
  const savedPath = join(makeTempFolder(t, "engine-v3-blocked-edits-temp-"), "claude-blocked-edits", `${SESSION_ID}-1791311883056.json`);
  const callId = "toolu_01DCKrQfA8BTbwMm1c4tLy29";
  const recordedInput = { file_path: join(stateFolder, "demo", "tutorialMockup.html"), content: "<!doctype html>\n<html>\n" };
  const [callLine, resultLine] = loadLines(t, [makeCallLine(callId, "Write", recordedInput, recordedInput), makeBlockedResultLine(callId, "Write", savedPath)]);
  // the replay reaches the call line, then the result line, as the timeline orders them.
  const context = makeContext(callId, resultLine!);
  applyJSONLLineToState(new Path(stateFolder), callLine!, [], context);
  applyJSONLLineToState(new Path(stateFolder), resultLine!, [], context);
  // the saved file holds the recorded input, written like the hook's JSON.stringify(tool_input, null, 2).
  assert.equal(readFileSync(savedPath, "utf8"), JSON.stringify(recordedInput, null, 2));
  // the blocked Write itself changed nothing in the project.
  assert.equal(existsSync(recordedInput.file_path), false);
});

test("test_blocked_edit_saved_file_keeps_wire_key_order_with_parsed_values", (t) => {
  // Scenario: the hook got the parsed Edit input: the wire keys in wire order, then replace_all that the parse added.
  // Steps:
  // the recorded input has replace_all first; the wire input has no replace_all.
  const stateFolder = makeTempFolder(t, "engine-v3-blocked-edits-state-");
  const savedPath = join(makeTempFolder(t, "engine-v3-blocked-edits-temp-"), "claude-blocked-edits", `${SESSION_ID}-1791311883057.json`);
  const callId = "toolu_01EditBlockedCall000000001";
  const filePath = join(stateFolder, "parsePage.ts");
  const wireInput = { file_path: filePath, old_string: "function a(", new_string: "export function a(" };
  const recordedInput = { replace_all: false, file_path: filePath, old_string: "function a(", new_string: "export function a(" };
  const [callLine, resultLine] = loadLines(t, [makeCallLine(callId, "Edit", recordedInput, wireInput), makeBlockedResultLine(callId, "Edit", savedPath)]);
  const context = makeContext(callId, resultLine!);
  applyJSONLLineToState(new Path(stateFolder), callLine!, [], context);
  applyJSONLLineToState(new Path(stateFolder), resultLine!, [], context);
  // the saved file lists file_path, old_string, new_string, then replace_all, like the Read results in the history show.
  const expectedInput = { file_path: filePath, old_string: "function a(", new_string: "export function a(", replace_all: false };
  assert.equal(readFileSync(savedPath, "utf8"), JSON.stringify(expectedInput, null, 2));
});

test("test_blocked_result_without_its_tool_use_throws", (t) => {
  // Scenario: a result names a saved path, but no replayed line holds the matching tool_use.
  // Steps:
  // only the result line is replayed.
  const stateFolder = makeTempFolder(t, "engine-v3-blocked-edits-state-");
  const savedPath = join(makeTempFolder(t, "engine-v3-blocked-edits-temp-"), "claude-blocked-edits", `${SESSION_ID}-1791311883058.json`);
  const callId = "toolu_01MissingBlockedCall0000001";
  const [resultLine] = loadLines(t, [makeBlockedResultLine(callId, "Write", savedPath)]);
  // the replay throws and names the missing call; no saved file is written.
  assert.throws(() => applyJSONLLineToState(new Path(stateFolder), resultLine!, [], makeContext(callId, resultLine!)), /toolu_01MissingBlockedCall0000001/);
  assert.equal(existsSync(savedPath), false);
});

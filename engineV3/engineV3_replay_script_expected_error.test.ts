import { test, type TestContext } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { Path } from "../src/structures/domain.ts";
import { loadTranscript } from "../src/parse/loadTranscript.ts";
import type { JSONLLine } from "./engineV3.ts";
import { executeScriptInState, SCRIPT_ALLOWLIST } from "./engineV3_replay_script.ts";

function makeTempFolder(t: TestContext, prefix: string): string {
  const folder = mkdtempSync(join(tmpdir(), prefix));
  t.after(() => rmSync(folder, { recursive: true, force: true }));
  return folder;
}

function findToolUseIdByExpectsError(expectsError: boolean): string {
  for (const entry of SCRIPT_ALLOWLIST) {
    if (entry.expectsError === expectsError) {
      return entry.toolUseId.toString();
    }
  }
  throw new Error("findToolUseIdByExpectsError: no entry matches");
}

function loadBashCallLine(t: TestContext, toolUseId: string, command: string, cwd: string): JSONLLine {
  const block = { type: "tool_use", id: toolUseId, name: "Bash", input: { command, description: "test" }, caller: { type: "direct" } };
  const callLine = { type: "assistant", uuid: "4b836cc7-2357-412e-9f53-b23191b3c68a", parentUuid: null, cwd, timestamp: "2026-10-27T17:24:20.837Z", sessionId: "7d31cfda-fb91-4f61-ba61-7031cb5484e2", message: { role: "assistant", content: [block] } };
  const jsonlFile = join(makeTempFolder(t, "engine-v3-script-jsonl-"), "session.jsonl");
  writeFileSync(jsonlFile, JSON.stringify(callLine) + "\n");
  return loadTranscript(jsonlFile).records[0] as JSONLLine;
}

test("test_SCRIPT_ALLOWLIST_has_56_entries_and_9_expect_an_error", () => {
  // Scenario: the allow list file holds the 4 old ids and the 52 easy ids.
  // count all entries and the entries that expect an error
  let expectsErrorCount = 0;
  for (const entry of SCRIPT_ALLOWLIST) {
    if (entry.expectsError) {
      expectsErrorCount += 1;
    }
  }
  // 56 entries, 9 of them expect an error
  assert.equal(SCRIPT_ALLOWLIST.length, 56);
  assert.equal(expectsErrorCount, 9);
});

test("test_executeScriptInState_does_not_throw_when_an_expectsError_entry_exits_1", (t) => {
  // Scenario: a recorded failure is expected, so the replay goes on.
  // the state folder is the record's cwd
  const state = new Path(makeTempFolder(t, "engine-v3-script-state-"));
  // the call line has an id with expectsError true and a command that exits 1
  const line = loadBashCallLine(t, findToolUseIdByExpectsError(true), "exit 1", state.toString());
  // the run does not throw
  assert.doesNotThrow(() => executeScriptInState(state, line));
});

test("test_executeScriptInState_throws_when_an_expectsError_entry_exits_0", (t) => {
  // Scenario: a command that was recorded as failing must fail again.
  // the state folder is the record's cwd
  const state = new Path(makeTempFolder(t, "engine-v3-script-state-"));
  // the call line has an id with expectsError true and a command that exits 0
  const line = loadBashCallLine(t, findToolUseIdByExpectsError(true), "true", state.toString());
  // the error names the command and says it was expected to fail
  assert.throws(() => executeScriptInState(state, line), (error: Error) => {
    assert.match(error.message, /command: true/);
    assert.match(error.message, /expected to fail/);
    return true;
  });
});

test("test_executeScriptInState_throws_when_an_expectsError_entry_is_killed_by_a_signal", (t) => {
  // Scenario: a signal always throws, even when an error is expected.
  // the state folder is the record's cwd
  const state = new Path(makeTempFolder(t, "engine-v3-script-state-"));
  // the call line has an id with expectsError true and a command that kills itself
  const line = loadBashCallLine(t, findToolUseIdByExpectsError(true), "kill -9 $$", state.toString());
  // the run throws and names the signal
  assert.throws(() => executeScriptInState(state, line), /signal SIGKILL/);
});

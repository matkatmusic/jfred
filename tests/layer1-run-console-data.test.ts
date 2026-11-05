// Per-file test for webapp/layer1-run-console-data.ts: the verbatim state tables and the pure pick rules.

import { test } from "node:test";
import assert from "node:assert/strict";
import {
  RUN_CONSOLE_CANCEL_STATES, RUN_CONSOLE_OUTPUT_NOT_SAVED, RUN_CONSOLE_TERMINAL_STATES, findRunConsoleCancelState,
  findRunConsoleTerminalState, listRunConsoleNotes, selectRunConsoleCancelKey, selectRunConsoleTerminalKey,
} from "../webapp/layer1-run-console-data.ts";
import { WireConfidence } from "../webapp/layer1-wire-edits.ts";
import { WireRunOutcome, type WireScriptResult } from "../webapp/layer1-wire-script-results.ts";

function buildResult(overrides: Partial<WireScriptResult> = {}): WireScriptResult {
  return { kind: "script-result", toolUseId: "toolu_1", outcome: WireRunOutcome.replayed, files: [], stdout: "", stderr: "", timedOut: false, isOutputSaved: true, ...overrides };
}

test("test_RUN_CONSOLE_TERMINAL_STATES_keeps_the_four_blocks_verbatim", () => {
  // Verify: key, class and title of each block, in order.
  const rows = RUN_CONSOLE_TERMINAL_STATES.map((state) => [state.key, state.className, state.label]);
  assert.deepEqual(rows, [
    ["cancelled", "term-cancelled", "Cancelled"],
    ["verified", "term-verified", "Verified"],
    ["mismatch", "term-mismatch", "Mismatch"],
    ["original-failed", "term-original-failed", "Original run failed"],
  ]);
});

test("test_RUN_CONSOLE_CANCEL_STATES_holds_idle_live_and_cancelled", () => {
  // Verify: the three button looks the one real button picks from.
  const rows = RUN_CONSOLE_CANCEL_STATES.map((state) => [state.key, state.className, state.disabled]);
  assert.deepEqual(rows, [["idle", "btn-idle", true], ["running-cancelable", "btn-live", false], ["cancelled", "btn-cancelled", true]]);
});

test("test_find_functions_return_the_matching_state", () => {
  // Verify: a cancel key finds its state and an unknown key throws; a terminal key finds or returns undefined.
  assert.equal(findRunConsoleCancelState("running-cancelable").className, "btn-live");
  assert.throws(() => findRunConsoleCancelState("nope"), /no run console cancel state: nope/);
  assert.equal(findRunConsoleTerminalState("mismatch")!.className, "term-mismatch");
  assert.equal(findRunConsoleTerminalState("injected-unverified"), undefined);
  assert.equal(findRunConsoleTerminalState(undefined), undefined);
});

test("test_selectRunConsoleCancelKey_cancelled_wins_then_running_then_idle", () => {
  // Verify: the three keys.
  assert.equal(selectRunConsoleCancelKey(true, true), "cancelled");
  assert.equal(selectRunConsoleCancelKey(false, true), "running-cancelable");
  assert.equal(selectRunConsoleCancelKey(false, false), "idle");
});

test("test_selectRunConsoleTerminalKey_follows_cancel_then_outcome_then_confidence", () => {
  // Verify: a page cancel wins; replayed reads confidence; failed and skipped replays have none.
  assert.equal(selectRunConsoleTerminalKey(true, buildResult()), "cancelled");
  assert.equal(selectRunConsoleTerminalKey(false, undefined), undefined);
  assert.equal(selectRunConsoleTerminalKey(false, buildResult({ outcome: WireRunOutcome.originalFailed })), "original-failed");
  assert.equal(selectRunConsoleTerminalKey(false, buildResult({ confidence: WireConfidence.verified })), "verified");
  assert.equal(selectRunConsoleTerminalKey(false, buildResult({ outcome: WireRunOutcome.replayFailed })), undefined);
  assert.equal(selectRunConsoleTerminalKey(false, buildResult({ outcome: WireRunOutcome.notReplayed })), undefined);
});

test("test_listRunConsoleNotes_gives_the_reason_and_the_unsaved_note", () => {
  // Verify: no result gives none; a failed replay gives its reason; an unsaved output adds the note.
  assert.deepEqual(listRunConsoleNotes(undefined), []);
  assert.deepEqual(listRunConsoleNotes(buildResult()), []);
  assert.deepEqual(listRunConsoleNotes(buildResult({ outcome: WireRunOutcome.replayFailed, reason: "exit 1" })), ["exit 1"]);
  assert.deepEqual(listRunConsoleNotes(buildResult({ outcome: WireRunOutcome.notReplayed, isOutputSaved: false, reason: "bash" })), ["bash", RUN_CONSOLE_OUTPUT_NOT_SAVED]);
});

test("test_an_injected_unverified_replay_gets_the_no_proof_note_and_no_terminal_block", () => {
  // Verify: user ruling: exact note text; the terminal key stays undefined.
  const result = buildResult({ confidence: WireConfidence.injectedUnverified });
  assert.deepEqual(listRunConsoleNotes(result), ["Replayed. No proof file was found to compare with."]);
  assert.equal(selectRunConsoleTerminalKey(false, result), undefined);
});

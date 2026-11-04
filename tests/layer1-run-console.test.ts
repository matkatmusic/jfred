// Per-file test for webapp/layer1-run-console.ts: the live popup, its one cancel button, and its one terminal block.

import { test } from "node:test";
import assert from "node:assert/strict";
import { buildRunConsoleTrigger, openRunConsole, refreshRunConsole } from "../webapp/layer1-run-console.ts";
import { appendRunOutput, markRunCancelled, markRunStarted, resetRunResults, storeRunResult } from "../webapp/layer1-run-results.ts";
import { WireConfidence } from "../webapp/layer1-wire-edits.ts";
import { WireRunOutcome, type WireScriptResult } from "../webapp/layer1-wire-script-results.ts";
import type { WireLayer1View } from "../webapp/layer1-wire.ts";
import { initLayer1Dom } from "./webapp-dom-test-helpers.ts";

const ID = "toolu_1";
const EMPTY_VIEW: WireLayer1View = { pairs: [], gitOrphans: [], diskOrphans: [], ruler: [] };

function buildResult(overrides: Partial<WireScriptResult> = {}): WireScriptResult {
  return { kind: "script-result", toolUseId: ID, outcome: WireRunOutcome.replayed, files: [], stdout: "", stderr: "", timedOut: false, isOutputSaved: true, ...overrides };
}

function startConsole(cancelRun: (id: string) => void = () => undefined): HTMLElement {
  initLayer1Dom();
  resetRunResults();
  markRunStarted(ID);
  openRunConsole(ID, cancelRun);
  return document.getElementById("run-console") as HTMLElement;
}

function listTerminalClasses(): string[] {
  return [...document.querySelectorAll("#run-console .terminal-block")].map((block) => block.className);
}

function readCancelButton(): HTMLButtonElement {
  return document.querySelector<HTMLButtonElement>("#run-console button.cancel-btn")!;
}

test("test_openRunConsole_while_running_shows_streamed_text_and_a_live_cancel_button", () => {
  // Verify: stored text shows, the one button is btn-live and enabled, and no terminal block shows.
  initLayer1Dom();
  resetRunResults();
  markRunStarted(ID);
  appendRunOutput(ID, "step 1\n");
  openRunConsole(ID, () => undefined);
  assert.equal(document.querySelector("#run-console .console-pre")!.textContent, "step 1\n");
  assert.equal(document.querySelectorAll("#run-console button.cancel-btn").length, 1);
  assert.equal(readCancelButton().className, "cancel-btn btn-live");
  assert.equal(readCancelButton().disabled, false);
  assert.deepEqual(listTerminalClasses(), []);
  appendRunOutput(ID, "step 2\n");
  refreshRunConsole(ID);
  assert.equal(document.querySelector("#run-console .console-pre")!.textContent, "step 1\nstep 2\n");
});

test("test_the_cancel_button_calls_the_passed_function_and_then_reads_cancelled", () => {
  // Verify: the click passes the id; once the run is marked cancelled the button and block say so.
  const cancelled: string[] = [];
  startConsole((id) => { cancelled.push(id); markRunCancelled(id); });
  readCancelButton().click();
  assert.deepEqual(cancelled, [ID]);
  assert.equal(readCancelButton().className, "cancel-btn btn-cancelled");
  assert.equal(readCancelButton().disabled, true);
  assert.deepEqual(listTerminalClasses(), ["terminal-block term-cancelled"]);
});

test("test_after_a_result_only_the_matching_terminal_block_shows_and_the_button_is_idle", () => {
  // Verify: verified, mismatch and original-failed each show one block with the data file's title.
  const cases = [
    { overrides: { confidence: WireConfidence.verified }, expected: "term-verified" },
    { overrides: { confidence: WireConfidence.mismatch }, expected: "term-mismatch" },
    { overrides: { outcome: WireRunOutcome.originalFailed }, expected: "term-original-failed" },
  ];
  for (const { overrides, expected } of cases) {
    startConsole();
    storeRunResult(EMPTY_VIEW, buildResult(overrides));
    refreshRunConsole(ID);
    assert.deepEqual(listTerminalClasses(), [`terminal-block ${expected}`]);
    assert.equal(readCancelButton().className, "cancel-btn btn-idle");
    assert.equal(readCancelButton().disabled, true);
  }
});

test("test_stdout_is_plain_text_and_stderr_sits_in_a_stderr_span", () => {
  // Verify: the final text comes from the result, with stderr marked.
  startConsole();
  storeRunResult(EMPTY_VIEW, buildResult({ stdout: "out\n", stderr: "oops\n" }));
  refreshRunConsole(ID);
  assert.equal(document.querySelector("#run-console .console-pre")!.textContent, "out\noops\n");
  assert.equal(document.querySelector("#run-console .console-pre .stderr")!.textContent, "oops\n");
});

test("test_an_unsaved_output_shows_the_note", () => {
  // Verify: isOutputSaved false shows the exact note.
  startConsole();
  storeRunResult(EMPTY_VIEW, buildResult({ isOutputSaved: false }));
  refreshRunConsole(ID);
  const notes = [...document.querySelectorAll("#run-console .run-console-note")].map((note) => note.textContent);
  assert.deepEqual(notes, ["Output was not saved for this run. Clear saved results to run it again."]);
});

test("test_an_injected_unverified_replay_shows_the_no_proof_note_and_no_terminal_block", () => {
  // Verify: the exact note shows in .run-console-note and no block shows.
  startConsole();
  storeRunResult(EMPTY_VIEW, buildResult({ confidence: WireConfidence.injectedUnverified }));
  refreshRunConsole(ID);
  assert.equal(document.querySelector("#run-console .run-console-note")!.textContent, "Replayed. No proof file was found to compare with.");
  assert.deepEqual(listTerminalClasses(), []);
});

test("test_replay_failed_and_not_replayed_show_the_reason_and_no_terminal_block", () => {
  // Verify: the reason is plain text in a note.
  for (const outcome of [WireRunOutcome.replayFailed, WireRunOutcome.notReplayed]) {
    startConsole();
    storeRunResult(EMPTY_VIEW, buildResult({ outcome, reason: `why ${outcome}` }));
    refreshRunConsole(ID);
    assert.equal(document.querySelector("#run-console .run-console-note")!.textContent, `why ${outcome}`);
    assert.deepEqual(listTerminalClasses(), []);
  }
});

test("test_openRunConsole_twice_leaves_one_popup_and_Close_hides_it_and_the_trigger_opens_it_again", () => {
  // Verify: one popup inside #stagewrap; the trigger button opens it with the id it was given.
  const popup = startConsole();
  openRunConsole(ID, () => undefined);
  assert.equal(document.querySelectorAll("#run-console").length, 1);
  assert.equal(popup.parentElement!.id, "stagewrap");
  popup.querySelector<HTMLButtonElement>("button.run-console-close")!.click();
  assert.equal(popup.hidden, true);
  const openButton = buildRunConsoleTrigger(ID, () => undefined).querySelector<HTMLButtonElement>("button.run-console-open")!;
  assert.equal(openButton.textContent, "Open run console");
  openButton.click();
  assert.equal(popup.hidden, false);
});

test("test_the_console_never_calls_fetch", () => {
  // Verify: opening, repainting and closing make no request.
  const fetchCalls: unknown[] = [];
  startConsole();
  Object.assign(globalThis, { fetch: (...args: unknown[]) => { fetchCalls.push(args); throw new Error("the run console must not fetch"); } });
  refreshRunConsole(ID);
  document.querySelector<HTMLButtonElement>("#run-console button.run-console-close")!.click();
  assert.equal(fetchCalls.length, 0);
});

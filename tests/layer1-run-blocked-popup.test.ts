// Per-file test for webapp/layer1-run-blocked-popup.ts: text per state, buttons, close memory, one popup, no native dialog.

import { test } from "node:test";
import assert from "node:assert/strict";
import { closeBlockedPopup, renderBlockedPopup } from "../webapp/layer1-run-blocked-popup.ts";
import { BlockerState, type Blocker } from "../webapp/layer1-run-order.ts";
import { initLayer1Dom } from "./webapp-dom-test-helpers.ts";

function buildBlocker(state: BlockerState): Blocker {
  return { toolUseId: "toolu_e", sessionFile: "/logs/s1.jsonl", line: 4, instant: "2026-07-01T10:00:00.000Z", state };
}

function listPopups(): Element[] {
  return [...document.querySelectorAll("#run-blocked-popup")];
}

function clickButton(className: string): void {
  document.querySelector<HTMLButtonElement>(`#run-blocked-popup .${className}`)!.click();
}

test("test_renderBlockedPopup_names_the_first_needed_run_and_its_state", () => {
  // Verify: the second line reads the state text for each of the three states; the first line is fixed.
  const expected = { unreplayed: "not run yet", crashed: "crashed or timed out", cancelled: "cancelled" };
  for (const state of Object.values(BlockerState)) {
    initLayer1Dom();
    renderBlockedPopup(`state-${state}`, buildBlocker(state), () => undefined);
    const lines = [...document.querySelectorAll("#run-blocked-popup .blocked-text")].map((line) => line.textContent);
    assert.deepEqual(lines, ["The earlier script dots must run first.", `toolu_e: ${expected[state]}`]);
    assert.equal(document.getElementById("run-blocked-popup")!.parentElement!.id, "stagewrap");
  }
});

test("test_renderBlockedPopup_has_exactly_the_two_buttons", () => {
  // Verify: exact button texts, in order.
  initLayer1Dom();
  renderBlockedPopup("buttons", buildBlocker(BlockerState.unreplayed), () => undefined);
  const texts = [...document.querySelectorAll("#run-blocked-popup button")].map((button) => button.textContent);
  assert.deepEqual(texts, ["close", "Go to first unreplayed script node"]);
});

test("test_renderBlockedPopup_close_removes_it_and_the_same_dot_stays_quiet", () => {
  // Verify: the debounce case shows nothing for a closed dot; another dot still shows.
  initLayer1Dom();
  renderBlockedPopup("closed-dot", buildBlocker(BlockerState.unreplayed), () => undefined);
  clickButton("blocked-close");
  assert.equal(listPopups().length, 0);
  renderBlockedPopup("closed-dot", buildBlocker(BlockerState.unreplayed), () => undefined);
  assert.equal(listPopups().length, 0);
  renderBlockedPopup("other-dot", buildBlocker(BlockerState.unreplayed), () => undefined);
  assert.equal(listPopups().length, 1);
});

test("test_renderBlockedPopup_a_second_popup_replaces_the_first", () => {
  // Verify: one element in the DOM, and it shows the newer blocker; closeBlockedPopup removes it.
  initLayer1Dom();
  renderBlockedPopup("first", buildBlocker(BlockerState.unreplayed), () => undefined);
  renderBlockedPopup("second", buildBlocker(BlockerState.cancelled), () => undefined);
  assert.equal(listPopups().length, 1);
  assert.match(listPopups()[0]!.textContent!, /cancelled/);
  closeBlockedPopup();
  assert.equal(listPopups().length, 0);
});

test("test_renderBlockedPopup_go_button_calls_the_callback_once_and_removes_the_popup", () => {
  // Verify: one call, popup gone.
  initLayer1Dom();
  let calls = 0;
  renderBlockedPopup("go-dot", buildBlocker(BlockerState.crashed), () => { calls += 1; });
  clickButton("blocked-go");
  assert.equal(calls, 1);
  assert.equal(listPopups().length, 0);
});

test("test_renderBlockedPopup_opens_no_native_dialog", () => {
  // Verify: alert and confirm are never called.
  initLayer1Dom();
  const dialogCalls: string[] = [];
  Object.assign(window, { alert: () => dialogCalls.push("alert"), confirm: () => dialogCalls.push("confirm") });
  renderBlockedPopup("dialog-dot", buildBlocker(BlockerState.unreplayed), () => undefined);
  clickButton("blocked-go");
  renderBlockedPopup("dialog-dot-2", buildBlocker(BlockerState.unreplayed), () => undefined);
  clickButton("blocked-close");
  assert.deepEqual(dialogCalls, []);
});

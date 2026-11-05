// Per-file test for webapp/layer1-run-blocked-popup.ts: text per state, buttons, close memory, one popup, no native dialog, placement beside the dot.

import { test } from "node:test";
import assert from "node:assert/strict";
import { closeBlockedPopup, renderBlockedPopup } from "../webapp/layer1-run-blocked-popup.ts";
import { BlockerState, type Blocker } from "../webapp/layer1-run-order.ts";
import { applyZoom } from "../webapp/layer1-zoom.ts";
import { appendBlockedDot, buildRect } from "./layer1-blocked-dot-test-helpers.ts";
import { initLayer1Dom } from "./webapp-dom-test-helpers.ts";

function buildBlocker(state: BlockerState): Blocker {
  return { toolUseId: "toolu_e", sessionFile: "/logs/s1.jsonl", line: 4, instant: "2026-07-01T10:00:00.000Z", state };
}

function resetPage(): void {
  initLayer1Dom();
  appendBlockedDot("toolu_run");
}

function showPopup(dotKey: string, state: BlockerState, onGoToFirst: () => void = () => undefined): void {
  renderBlockedPopup(dotKey, "toolu_run", buildBlocker(state), "module_20.tsx", onGoToFirst);
}

function listPopups(): Element[] {
  return [...document.querySelectorAll("#run-blocked-popup")];
}

function clickButton(className: string): void {
  document.querySelector<HTMLButtonElement>(`#run-blocked-popup .${className}`)!.click();
}

function readPopupPlace(): { left: string; top: string } {
  const style = document.getElementById("run-blocked-popup")!.style;
  return { left: style.left, top: style.top };
}

test("test_renderBlockedPopup_names_the_first_needed_run_and_its_state", () => {
  // Verify: line two shows the file name and state text for each state; line one is fixed.
  const expected = { unreplayed: "not run yet", crashed: "crashed or timed out", cancelled: "cancelled" };
  for (const state of Object.values(BlockerState)) {
    resetPage();
    showPopup(`state-${state}`, state);
    const lines = [...document.querySelectorAll("#run-blocked-popup .blocked-text")].map((line) => line.textContent);
    assert.deepEqual(lines, ["The earlier script dots must run first.", `module_20.tsx: ${expected[state]}`]);
    assert.equal(document.getElementById("run-blocked-popup")!.parentElement!.className, "canvas");
  }
});

test("test_renderBlockedPopup_has_exactly_the_two_buttons", () => {
  // Verify: exact button texts, in order.
  resetPage();
  showPopup("buttons", BlockerState.unreplayed);
  const texts = [...document.querySelectorAll("#run-blocked-popup button")].map((button) => button.textContent);
  assert.deepEqual(texts, ["close", "Go to first unreplayed script node"]);
});

test("test_renderBlockedPopup_close_removes_it_and_the_same_dot_stays_quiet", () => {
  // Verify: the debounce case shows nothing for a closed dot; another dot still shows.
  resetPage();
  showPopup("closed-dot", BlockerState.unreplayed);
  clickButton("blocked-close");
  assert.equal(listPopups().length, 0);
  showPopup("closed-dot", BlockerState.unreplayed);
  assert.equal(listPopups().length, 0);
  showPopup("other-dot", BlockerState.unreplayed);
  assert.equal(listPopups().length, 1);
});

test("test_renderBlockedPopup_a_second_popup_replaces_the_first", () => {
  // Verify: one element in the DOM, and it shows the newer blocker; closeBlockedPopup removes it.
  resetPage();
  showPopup("first", BlockerState.unreplayed);
  showPopup("second", BlockerState.cancelled);
  assert.equal(listPopups().length, 1);
  assert.match(listPopups()[0]!.textContent!, /cancelled/);
  closeBlockedPopup();
  assert.equal(listPopups().length, 0);
});

test("test_renderBlockedPopup_go_button_calls_the_callback_once_and_removes_the_popup", () => {
  // Verify: one call, popup gone.
  resetPage();
  let calls = 0;
  showPopup("go-dot", BlockerState.crashed, () => { calls += 1; });
  clickButton("blocked-go");
  assert.equal(calls, 1);
  assert.equal(listPopups().length, 0);
});

test("test_renderBlockedPopup_opens_no_native_dialog", () => {
  // Verify: alert and confirm are never called.
  resetPage();
  const dialogCalls: string[] = [];
  Object.assign(window, { alert: () => dialogCalls.push("alert"), confirm: () => dialogCalls.push("confirm") });
  showPopup("dialog-dot", BlockerState.unreplayed);
  clickButton("blocked-go");
  showPopup("dialog-dot-2", BlockerState.unreplayed);
  clickButton("blocked-close");
  assert.deepEqual(dialogCalls, []);
});

test("test_renderBlockedPopup_sits_8px_right_of_the_dot_top_aligned_in_canvas_units", () => {
  // Verify: left = 208+8+100 = 316; top = 100+50 = 150.
  resetPage();
  showPopup("right-dot", BlockerState.unreplayed);
  assert.deepEqual(readPopupPlace(), { left: "316px", top: "150px" });
});

test("test_renderBlockedPopup_flips_to_8px_left_of_the_dot_when_the_right_side_passes_the_pane", () => {
  // Verify: no room right of 900; left = 900 - 368 + 100 = 632.
  initLayer1Dom();
  appendBlockedDot("toolu_run", buildRect(900, 100, 8, 8));
  showPopup("flip-dot", BlockerState.unreplayed);
  assert.deepEqual(readPopupPlace(), { left: "632px", top: "150px" });
});

test("test_renderBlockedPopup_divides_the_screen_offsets_by_the_zoom", () => {
  // Verify: zoom 2; left = 332 / 2 = 166; top = 150 / 2 = 75.
  initLayer1Dom();
  applyZoom(2);
  try {
    appendBlockedDot("toolu_run", buildRect(200, 100, 16, 16));
    showPopup("zoom-dot", BlockerState.unreplayed);
    assert.deepEqual(readPopupPlace(), { left: "166px", top: "75px" });
  } finally {
    applyZoom(1);
  }
});

test("test_renderBlockedPopup_draws_no_popup_when_no_dot_of_the_run_is_on_screen", () => {
  // Verify: a dot outside the pane does not count, so the call draws no popup and does not throw.
  initLayer1Dom();
  appendBlockedDot("toolu_run", buildRect(5000, 100, 8, 8));
  assert.doesNotThrow(() => showPopup("off-dot", BlockerState.unreplayed));
  assert.equal(listPopups().length, 0);
});

// Test for webapp/layer1-jfred-strip.ts: the strip follows Commit mode, survives Delete and shows message popups.

import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { initLayer1Dom, waitForAsyncWork } from "./webapp-dom-test-helpers.ts";
import type { WireRulerTick } from "../webapp/layer1-wire.ts";

// layer1-page.ts boots at MODULE SCOPE, so absorb that first boot here against a throwaway DOM.
initLayer1Dom();
const { refreshJfredStrip, renderJfredStrip } = await import("../webapp/layer1-components/commits-column/layer1-jfred-strip.ts");
const { loadJfredBranch, setArmed } = await import("../webapp/layer1-components/commits-column/layer1-jfred-state.ts");

const TICKS: WireRulerTick[] = [
  { instant: "2026-06-01T09:00:00.000Z", axisPx: 100, eventCount: 1 },
  { instant: "2026-06-01T09:05:00.000Z", axisPx: 160, eventCount: 1 },
];
const LONG_MESSAGE = "jfred: reconstruct to this point and keep going until the very last change is included in full";
const CANNED_VIEW = {
  pairs: [],
  gitOrphans: [],
  diskOrphans: [],
  ruler: [],
  jfredCommits: {
    isCanned: true as const,
    base: { instant: TICKS[0]!.instant, shortHash: "a1b2c3d4" },
    commits: [{ instant: TICKS[1]!.instant, shortHash: "c0ffee01", parentShortHash: "a1b2c3d4", message: LONG_MESSAGE }],
  },
};

beforeEach(() => {
  initLayer1Dom();
  loadJfredBranch(CANNED_VIEW);
  setArmed(false);
});

function hoverEntry(selector: string): void {
  const target = document.querySelector<HTMLElement>(selector)!;
  target.dispatchEvent(new window.MouseEvent("mouseover", { bubbles: true }));
}

test("test_commit_mode_off_draws_no_strip", () => {
  // Verify: base and commits exist but Commit mode is off, so there is no strip.
  renderJfredStrip(TICKS);
  assert.equal(document.getElementById("jfred-strip"), null);
});

test("test_refresh_draws_the_strip_from_the_last_ticks_when_commit_mode_turns_on", () => {
  // Verify: the toggle needs no new ticks.
  renderJfredStrip(TICKS);
  setArmed(true);
  refreshJfredStrip();
  assert.equal(document.querySelectorAll("#jfred-strip .jnode").length, 2);
});

test("test_refresh_removes_the_strip_when_commit_mode_turns_off", () => {
  // Verify: off removes the strip.
  setArmed(true);
  renderJfredStrip(TICKS);
  setArmed(false);
  refreshJfredStrip();
  assert.equal(document.getElementById("jfred-strip"), null);
});

test("test_armed_with_no_base_keeps_the_head_and_the_delete_button", async () => {
  // Verify: Delete clears the base, yet the head stays across the next stage render.
  setArmed(true);
  renderJfredStrip(TICKS);
  document.querySelector<HTMLElement>("#jfred-strip .jdelete")!.click();
  document.querySelector<HTMLElement>("#yesno-row .yesno-yes")!.click();
  await waitForAsyncWork();
  renderJfredStrip(TICKS);
  assert.equal(document.querySelectorAll("#jfred-strip .jhead").length, 1);
  assert.equal(document.querySelectorAll("#jfred-strip .jdelete").length, 1);
  assert.equal(document.querySelectorAll("#jfred-strip .jnode").length, 0);
});

test("test_hover_on_a_commit_node_shows_the_message_wrapped_at_50", () => {
  // Verify: the popup lines are the message, none longer than 50 characters.
  setArmed(true);
  renderJfredStrip(TICKS);
  hoverEntry('#jfred-strip .jnode[data-short-hash="c0ffee01"]');
  const lines = [...document.querySelectorAll("#hover-popup .hp-line")].map((line) => line.textContent!);
  assert.equal(lines.join(" "), LONG_MESSAGE);
  assert.ok(lines.length > 1);
  assert.ok(lines.every((line) => line.length <= 50));
});

test("test_hover_on_a_commit_label_shows_the_message_too", () => {
  // Verify: the delegated popup works from the hash label.
  setArmed(true);
  renderJfredStrip(TICKS);
  hoverEntry('#jfred-strip .jlabel[data-short-hash="c0ffee01"]');
  assert.equal(document.getElementById("hover-popup")!.hidden, false);
});

test("test_hover_on_the_base_shows_no_popup", () => {
  // Verify: the base has no message.
  setArmed(true);
  renderJfredStrip(TICKS);
  hoverEntry("#jfred-strip .jnode.j-base");
  assert.equal(document.getElementById("hover-popup"), null);
});

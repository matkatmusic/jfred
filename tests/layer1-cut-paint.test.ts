// Test for webapp/layer1-cut-paint.ts: the cut-mark classes and refusal titles painted on the ruler ticks.

import { test } from "node:test";
import assert from "node:assert/strict";
import { initLayer1Dom } from "./webapp-dom-test-helpers.ts";

// layer1-page.ts boots at MODULE SCOPE, so absorb that first boot here against a throwaway DOM.
initLayer1Dom();
const { repaintCutMarks } = await import("../webapp/layer1-cut-paint.ts");
const { CUT_REFUSAL_TEXT, CutRefusal } = await import("../webapp/layer1-cut-rules.ts");
const { deleteJfredBranch, setArmed, setBase, setPending, loadJfredBranch } = await import("../webapp/layer1-jfred-state.ts");
const { storeRow } = await import("../webapp/layer1-tick-events.ts");

const BASE_MS = Date.parse("2026-06-01T00:00:00Z");
const HOUR_MS = 3600_000;
const TICK_SPACING_PX = 50;
const EMPTY_VIEW = { pairs: [], gitOrphans: [], diskOrphans: [], ruler: [] };

function buildInstant(hour: number): string {
  return new Date(BASE_MS + hour * HOUR_MS).toISOString();
}

// Adds a tick and a bubble at that hour, with one node per class string.
function addTick(hour: number, nodeClasses: string[]): HTMLElement {
  const axisPx = hour * TICK_SPACING_PX;
  const tick = document.createElement("div");
  tick.className = "tick";
  document.getElementById("ruler")!.append(tick);
  storeRow(tick, { axisPx, text: "t", axisPxList: [axisPx], instants: [buildInstant(hour)] });
  const bubble = document.createElement("div");
  bubble.className = "filebox";
  bubble.style.setProperty("--axis-px", String(axisPx));
  for (const nodeClass of nodeClasses) {
    const node = document.createElement("i");
    node.className = nodeClass;
    node.style.setProperty("--axis-px", "0");
    bubble.append(node);
  }
  document.getElementById("stage")!.append(bubble);
  return tick;
}

// Fresh page and empty branch; hour 1 is a commit, hour 2 a created-only tick, hour 3 a snapshot.
function buildPage(): { commit: HTMLElement; created: HTMLElement; snap: HTMLElement } {
  initLayer1Dom();
  loadJfredBranch(EMPTY_VIEW);
  setArmed(false);
  return { commit: addTick(1, ["node n-commit"]), created: addTick(2, ["node n-disk n-created"]), snap: addTick(3, ["node n-snap"]) };
}

test("test_armed_ticks_get_ok_or_no_with_the_refusal_text_as_title", () => {
  // Verify: ok for a later snapshot; no, with the refusal text, for the rest.
  const { commit, created, snap } = buildPage();
  setBase({ instant: buildInstant(1), shortHash: "a1b2c3d4" });
  setArmed(true);
  repaintCutMarks();
  assert.equal(snap.classList.contains("cut-ok"), true);
  assert.equal(snap.title, "");
  assert.equal(created.classList.contains("cut-no"), true);
  assert.equal(created.title, CUT_REFUSAL_TEXT[CutRefusal.noVerifiedNode]);
  assert.equal(commit.classList.contains("cut-no"), true);
  assert.equal(commit.title, CUT_REFUSAL_TEXT[CutRefusal.notForward]);
});

test("test_with_no_base_a_non_commit_beacon_says_the_base_needs_a_commit", () => {
  // Verify: the title comes from findCutRefusal, so it matches the toast text.
  const { commit, snap } = buildPage();
  setArmed(true);
  repaintCutMarks();
  assert.equal(snap.title, CUT_REFUSAL_TEXT[CutRefusal.baseNeedsCommit]);
  assert.equal(commit.classList.contains("cut-ok"), true);
});

test("test_disarming_removes_the_classes_and_titles", () => {
  // Verify: no cut class and no title is left on any tick.
  const { commit, created, snap } = buildPage();
  setArmed(true);
  repaintCutMarks();
  setArmed(false);
  repaintCutMarks();
  for (const tick of [commit, created, snap]) {
    assert.equal(tick.className, "tick");
    assert.equal(tick.hasAttribute("title"), false);
  }
});

test("test_base_set_and_pending_classes_show_when_not_armed", () => {
  // Verify: the base tick, a committed tick and the pending tick keep their classes with the mode off.
  const { commit, created, snap } = buildPage();
  loadJfredBranch({
    ...EMPTY_VIEW,
    jfredCommits: {
      base: { instant: buildInstant(1), shortHash: "a1b2c3d4" },
      commits: [{ instant: buildInstant(2), shortHash: "c0ffee01", parentShortHash: "a1b2c3d4", message: "m" }],
    },
  });
  setPending({ instant: buildInstant(3), message: "m" });
  repaintCutMarks();
  assert.equal(commit.classList.contains("cut-base"), true);
  assert.equal(created.classList.contains("cut-set"), true);
  assert.equal(snap.classList.contains("cut-pending"), true);
  assert.equal(snap.classList.contains("cut-ok"), false);
});

test("test_a_second_paint_after_the_branch_is_deleted_clears_the_state_classes", () => {
  // Verify: delete empties base, commits and pending, so no state class remains.
  const { commit } = buildPage();
  setBase({ instant: buildInstant(1), shortHash: "a1b2c3d4" });
  repaintCutMarks();
  assert.equal(commit.classList.contains("cut-base"), true);
  deleteJfredBranch();
  repaintCutMarks();
  assert.equal(commit.className, "tick");
});

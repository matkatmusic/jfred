// Test for webapp/layer1-jfred-mode.ts: the Commit mode button and the once-per-page load, through renderLayer1View.

import { test } from "node:test";
import assert from "node:assert/strict";
import { initLayer1Dom } from "./webapp-dom-test-helpers.ts";

// layer1-page.ts boots at MODULE SCOPE, so absorb that first boot here against a throwaway DOM.
initLayer1Dom();
const { renderLayer1View } = await import("../webapp/layer1-view-render.ts");
const { commitPending, deleteJfredBranch, readJfredBranch, setArmed, setPending } = await import("../webapp/layer1-components/commits-column/layer1-jfred-state.ts");

const REAL_VIEW = { pairs: [], gitOrphans: [], diskOrphans: [], ruler: [] };
const CANNED_VIEW = {
  ...REAL_VIEW,
  jfredCommits: {
    base: { instant: "2026-06-01T09:00:00.000Z", shortHash: "a1b2c3d4" },
    commits: [
      { instant: "2026-06-01T09:05:00.000Z", shortHash: "c0ffee01", parentShortHash: "a1b2c3d4", message: "one" },
      { instant: "2026-06-03T10:30:00.000Z", shortHash: "c0ffee02", parentShortHash: "c0ffee01", message: "two" },
    ],
  },
};

function getButton(): HTMLButtonElement {
  return document.getElementById("commit-mode") as HTMLButtonElement;
}

test("test_real_data_leaves_the_button_hidden_and_draws_no_strip", async () => {
  // Verify: no jfredCommits field means no button, no strip and no listener.
  initLayer1Dom();
  await renderLayer1View(REAL_VIEW as never);
  assert.equal(getButton().hidden, true);
  assert.equal(document.getElementById("jfred-strip"), null);
  assert.equal(getButton().onclick, null);
});

test("test_fixture_data_shows_the_button_and_no_strip_until_commit_mode_is_on", async () => {
  // Verify: the button shows with its text; the strip needs Commit mode.
  initLayer1Dom();
  setArmed(false);
  await renderLayer1View(CANNED_VIEW as never);
  assert.equal(getButton().hidden, false);
  assert.equal(getButton().textContent, "Commit mode");
  assert.equal(document.getElementById("jfred-strip"), null);
});

test("test_the_click_draws_the_strip_and_a_second_click_removes_it", async () => {
  // Verify: Commit mode on shows the canned entries; off hides the column.
  initLayer1Dom();
  setArmed(false);
  await renderLayer1View(CANNED_VIEW as never);
  getButton().click();
  assert.equal(document.querySelectorAll("#jfred-strip .jnode").length, 3);
  getButton().click();
  assert.equal(document.getElementById("jfred-strip"), null);
});

test("test_the_button_toggles_current_and_the_armed_state", async () => {
  // Verify: one click arms and marks the button current; a second click undoes both.
  initLayer1Dom();
  setArmed(false);
  await renderLayer1View(CANNED_VIEW as never);
  getButton().click();
  assert.equal(readJfredBranch().isArmed, true);
  assert.equal(getButton().classList.contains("current"), true);
  getButton().click();
  assert.equal(readJfredBranch().isArmed, false);
  assert.equal(getButton().classList.contains("current"), false);
});

test("test_a_second_render_keeps_the_fake_commits", async () => {
  // Verify: a later render with the same wire view must not reload the canned branch.
  initLayer1Dom();
  setPending({ instant: "2026-06-03T18:20:00.000Z", message: "three" });
  commitPending();
  setArmed(true);
  await renderLayer1View(CANNED_VIEW as never);
  assert.equal(readJfredBranch().commits.length, 3);
  assert.equal(document.querySelectorAll("#jfred-strip .jnode").length, 4);
});

test("test_a_second_render_keeps_the_delete", async () => {
  // Verify: Delete stays done after another render; only a page reload brings the canned data back.
  initLayer1Dom();
  deleteJfredBranch();
  setArmed(false);
  await renderLayer1View(CANNED_VIEW as never);
  assert.equal(readJfredBranch().base, undefined);
  assert.equal(document.getElementById("jfred-strip"), null);
  assert.equal(getButton().hidden, false);
});

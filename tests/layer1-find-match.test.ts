// Find-box matching: a term lists matching bubbles and repeat submits cycle through them.

import { test } from "node:test";
import assert from "node:assert/strict";
import { getRequiredElementById } from "../webapp/app-dom.ts";
import { initLayer1Dom } from "./webapp-dom-test-helpers.ts";

initLayer1Dom();
const { listNameElements, reportFindStatus, resetFindCycle, selectMatchAtStep } = await import("../webapp/layer1-find-match.ts");

function fillStageWithBubbles(paths: string[]): void {
  getRequiredElementById("stage").innerHTML = paths
    .map((path) => `<div class="filebox"><span class="fname" data-path="${path}">${path.split("/").pop()}</span></div>`)
    .join("");
}

function readFindStatus(): string {
  return getRequiredElementById("find-status").textContent;
}

function readLandedPath(bubble: HTMLElement | undefined): string | undefined {
  return bubble?.querySelector<HTMLElement>(".fname")?.dataset.path;
}

test("test_list_name_elements_returns_every_stage_name", () => {
  initLayer1Dom();
  fillStageWithBubbles(["src/a.ts", "src/b.ts"]);
  assert.equal(listNameElements().length, 2);
});

test("test_report_find_status_writes_the_message", () => {
  initLayer1Dom();
  reportFindStatus("hello");
  assert.equal(readFindStatus(), "hello");
});

test("test_select_match_at_step_with_no_match_reports_and_returns_undefined", () => {
  initLayer1Dom();
  fillStageWithBubbles(["src/a.ts"]);
  assert.equal(selectMatchAtStep("zzz", 1), undefined);
  assert.equal(readFindStatus(), 'find "zzz": no bubble matches');
});

test("test_select_match_at_step_matches_the_full_path_case_insensitively", () => {
  initLayer1Dom();
  fillStageWithBubbles(["src/Alpha.ts", "lib/beta.ts"]);
  resetFindCycle();
  assert.equal(readLandedPath(selectMatchAtStep("SRC/alpha", 1)), "src/Alpha.ts");
});

test("test_repeat_submits_cycle_and_wrap_in_both_directions", () => {
  initLayer1Dom();
  fillStageWithBubbles(["a/one.ts", "a/two.ts", "a/three.ts"]);
  resetFindCycle();
  assert.equal(readLandedPath(selectMatchAtStep("a/", 1)), "a/one.ts");
  assert.equal(readLandedPath(selectMatchAtStep("a/", 1)), "a/two.ts");
  assert.equal(readLandedPath(selectMatchAtStep("a/", -1)), "a/one.ts");
  assert.equal(readLandedPath(selectMatchAtStep("a/", -1)), "a/three.ts");
  assert.equal(readFindStatus(), 'find "a/": 3 of 3 · a/three.ts');
});

test("test_reset_find_cycle_restarts_at_the_first_match", () => {
  initLayer1Dom();
  fillStageWithBubbles(["a/one.ts", "a/two.ts"]);
  resetFindCycle();
  selectMatchAtStep("a/", 1);
  selectMatchAtStep("a/", 1);
  resetFindCycle();
  assert.equal(readLandedPath(selectMatchAtStep("a/", 1)), "a/one.ts");
});

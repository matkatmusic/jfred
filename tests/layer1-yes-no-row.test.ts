// Test for webapp/layer1-components/popups/layer1-yes-no-row.ts: the in-page Yes/No question row.

import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { initLayer1Dom } from "./webapp-dom-test-helpers.ts";
import { openYesNoQuestion } from "../webapp/layer1-components/popups/layer1-yes-no-row.ts";

beforeEach(() => {
  initLayer1Dom();
});

function findRow(): HTMLElement | null {
  return document.getElementById("yesno-row");
}

test("test_clicking_yes_resolves_true_and_removes_the_row", async () => {
  // Verify: the row shows the question and both labels, and Yes answers true and removes the row.
  const answer = openYesNoQuestion("Move the mark?", "Yes, move it", "No");
  assert.equal(findRow()!.querySelector("span")!.textContent, "Move the mark?");
  assert.equal(document.querySelector(".yesno-yes")!.textContent, "Yes, move it");
  assert.equal(document.querySelector(".yesno-no")!.textContent, "No");
  document.querySelector<HTMLElement>(".yesno-yes")!.click();
  assert.equal(await answer, true);
  assert.equal(findRow(), null);
});

test("test_clicking_no_resolves_false_and_removes_the_row", async () => {
  // Verify: No answers false and removes the row.
  const answer = openYesNoQuestion("Move the mark?", "Yes, move it", "No");
  document.querySelector<HTMLElement>(".yesno-no")!.click();
  assert.equal(await answer, false);
  assert.equal(findRow(), null);
});

test("test_a_second_question_while_one_is_open_throws", async () => {
  // Verify: a second question throws and leaves the first row open until it is answered.
  const answer = openYesNoQuestion("First?", "Yes", "No");
  assert.throws(() => openYesNoQuestion("Second?", "Yes", "No"), /already open/);
  assert.equal(document.querySelectorAll("#yesno-row").length, 1);
  assert.equal(findRow()!.querySelector("span")!.textContent, "First?");
  document.querySelector<HTMLElement>(".yesno-no")!.click();
  assert.equal(await answer, false);
});

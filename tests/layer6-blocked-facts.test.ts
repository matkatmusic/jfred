// Tests for layer6-blocked-facts.ts: each pure judge gets one passing and one failing input, plus the reader.

import { strict as assert } from "node:assert";
import { test } from "node:test";
import {
  BLOCKED_BUTTON_TEXTS, isBlockedBesideDot, isBlockedClearOfDrawer, isBlockedPopupRight, isBlockerNamed, readBlockedFacts, type BlockedFacts,
} from "../scripts/visual/layer6-blocked-facts.ts";
import { createFakePage } from "./layer6-fake-page.ts";

const GOOD_FACTS: BlockedFacts = {
  count: 1, buttons: ["close", "Go to first unreplayed script node"], text: "The earlier script dots must run first.toolu_x: not run yet closeGo",
  insideStagewrap: true, popupRect: [10, 10, 100, 60], dotRect: [0, 20, 2, 28], drawerRect: [120, 0, 400, 500], drawerOpen: true,
};

test("the button texts are exactly close and Go to first unreplayed script node", () => {
  assert.deepEqual(BLOCKED_BUTTON_TEXTS, ["close", "Go to first unreplayed script node"]);
});

test("isBlockedPopupRight passes one popup with both buttons and fails other buttons or two popups", () => {
  assert.equal(isBlockedPopupRight(GOOD_FACTS), true);
  assert.equal(isBlockedPopupRight({ ...GOOD_FACTS, buttons: ["close"] }), false);
  assert.equal(isBlockedPopupRight({ ...GOOD_FACTS, buttons: ["Close", "Go to first unreplayed script node"] }), false);
  assert.equal(isBlockedPopupRight({ ...GOOD_FACTS, count: 2 }), false);
  assert.equal(isBlockedPopupRight({ ...GOOD_FACTS, insideStagewrap: false }), false);
});

test("isBlockedClearOfDrawer passes a popup left of the open drawer and fails an overlap or a closed drawer", () => {
  assert.equal(isBlockedClearOfDrawer(GOOD_FACTS), true);
  assert.equal(isBlockedClearOfDrawer({ ...GOOD_FACTS, popupRect: [10, 10, 200, 60] }), false);
  assert.equal(isBlockedClearOfDrawer({ ...GOOD_FACTS, drawerOpen: false }), false);
});

test("isBlockedBesideDot passes a popup within 12 px of the dot that overlaps it down and fails a far, a high or an unmeasured popup", () => {
  assert.equal(isBlockedBesideDot(GOOD_FACTS), true);
  assert.equal(isBlockedBesideDot({ ...GOOD_FACTS, dotRect: [-20, 20, -10, 28] }), false);
  assert.equal(isBlockedBesideDot({ ...GOOD_FACTS, dotRect: [0, 200, 2, 208] }), false);
  assert.equal(isBlockedBesideDot({ ...GOOD_FACTS, dotRect: [] }), false);
  assert.equal(isBlockedBesideDot({ ...GOOD_FACTS, count: 0 }), false);
});

test("isBlockerNamed finds the id with its state text and fails another state", () => {
  assert.equal(isBlockerNamed(GOOD_FACTS, "toolu_x", "not run yet"), true);
  assert.equal(isBlockerNamed(GOOD_FACTS, "toolu_x", "crashed or timed out"), false);
  assert.equal(isBlockerNamed(GOOD_FACTS, "toolu_y", "not run yet"), false);
});

test("readBlockedFacts sends one expression about the popup and returns the answer", async () => {
  const fake = createFakePage(() => GOOD_FACTS);
  assert.deepEqual(await readBlockedFacts(fake.page), GOOD_FACTS);
  assert.equal(fake.evaluated.length, 1);
  assert.ok(fake.evaluated[0]!.includes("run-blocked-popup"));
  assert.doesNotThrow(() => new Function(`return (${fake.evaluated[0]!});`));
});

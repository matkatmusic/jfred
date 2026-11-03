// Layer 6 popup judges: each pure function gets one passing and one failing input.

import { test } from "node:test";
import assert from "node:assert/strict";
import {
  isCancelButtonsRight, isEventColoursSame, isTerminalBlocksRight, isPopupClearOfDrawer,
  isPopupContentRight, isPopupShown, listNewResources,
} from "../scripts/visual/layer6-popup-facts.ts";
import { MISMATCH_ID, ORIGINAL_FAILED_ID, VERIFIED_ID, type NodeFacts, type PopupFacts } from "../scripts/visual/layer6-probes.ts";

const GOOD_POPUP: PopupFacts = {
  hidden: false, width: 300, height: 200, popupRect: [0, 0, 100, 50], stageRect: [0, 0, 500, 500], drawerRect: [120, 0, 400, 500],
  insideDrawer: false, drawerOpen: true, position: "absolute", insideStagewrap: true, overlapsTimelines: true,
  preCount: 1, preWhiteSpace: "pre", captionCount: 1, captionStyle: "italic", stateCaptionCount: 1,
  idleDisabled: true, liveDisabled: false, cancelledDisabled: true,
  liveBorderColor: "red", cancelledDecoration: "line-through", cancelButtons: 3,
  terminalClasses: ["term-cancelled", "term-verified", "term-mismatch", "term-original-failed"],
  terminalColours: ["a", "b", "c", "d"],
};

function buildNode(id: string, borderColor: string, outlineColor: string): NodeFacts {
  return {
    id, classes: "", width: 1, height: 1, borderStyle: "", borderColor, borderWidth: "",
    outlineStyle: "", outlineColor, outlineWidth: "", backgroundImage: "",
  };
}

const TITLES = { mismatch: "red", verified: "green", originalFailed: "grey" };

function buildGoodNodes(): NodeFacts[] {
  return [
    buildNode(MISMATCH_ID, "red", ""),
    buildNode(VERIFIED_ID, "", "green"),
    buildNode(ORIGINAL_FAILED_ID, "", "grey"),
  ];
}

test("isPopupShown passes a visible popup and fails a hidden one", () => {
  assert.equal(isPopupShown(GOOD_POPUP), true);
  assert.equal(isPopupShown({ ...GOOD_POPUP, hidden: true }), false);
});

test("isPopupContentRight passes the expected content and fails a missing caption", () => {
  assert.equal(isPopupContentRight(GOOD_POPUP), true);
  assert.equal(isPopupContentRight({ ...GOOD_POPUP, captionCount: 0 }), false);
});

test("isCancelButtonsRight passes matching colour and fails a different colour", () => {
  assert.equal(isCancelButtonsRight(GOOD_POPUP, "red"), true);
  assert.equal(isCancelButtonsRight(GOOD_POPUP, "blue"), false);
});

test("isTerminalBlocksRight passes four ordered distinct blocks and fails repeated colours", () => {
  assert.equal(isTerminalBlocksRight(GOOD_POPUP), true);
  assert.equal(isTerminalBlocksRight({ ...GOOD_POPUP, terminalColours: ["a", "a", "c", "d"] }), false);
});

test("isEventColoursSame passes matching colours and fails a different title colour", () => {
  assert.equal(isEventColoursSame(buildGoodNodes(), TITLES), true);
  assert.equal(isEventColoursSame(buildGoodNodes(), { ...TITLES, verified: "blue" }), false);
});

test("isPopupClearOfDrawer passes a popup left of the drawer and fails an overlapping one", () => {
  assert.equal(isPopupClearOfDrawer(GOOD_POPUP), true);
  assert.equal(isPopupClearOfDrawer({ ...GOOD_POPUP, popupRect: [0, 0, 200, 50] }), false);
});

test("listNewResources returns only the new entries and returns none when nothing is new", () => {
  assert.deepEqual(listNewResources(["a"], ["a", "b", "c"]), ["b", "c"]);
  assert.deepEqual(listNewResources(["a"], ["a"]), []);
});

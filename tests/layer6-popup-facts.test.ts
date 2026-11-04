// Layer 6 popup judges: each pure function gets one passing and one failing input.

import { test } from "node:test";
import assert from "node:assert/strict";
import {
  CancelKind, OUTCOME_CASES, countOutputLines, isCancelButtonRight, isConsentTextRight, isEventColoursSame, isOutcomeRight, isOutputStopped,
  isOutputStreaming, isPopupClearOfDrawer, isPopupContentRight, isPopupShown, isTerminalBlockRight, listNewResources,
} from "../scripts/visual/layer6-popup-facts.ts";
import { MISMATCH_ID, ORIGINAL_FAILED_ID, VERIFIED_ID, type NodeFacts, type PopupFacts } from "../scripts/visual/layer6-probes.ts";

const GOOD_POPUP: PopupFacts = {
  hidden: false, width: 300, height: 200, popupRect: [0, 0, 100, 50], stageRect: [0, 0, 500, 500], drawerRect: [120, 0, 400, 500],
  insideDrawer: false, drawerOpen: true, position: "absolute", insideStagewrap: true, overlapsTimelines: true,
  preCount: 1, preWhiteSpace: "pre", preText: "a\nb", noteTexts: [],
  cancelButtons: 1, cancelClass: "cancel-btn btn-idle", cancelDisabled: true, cancelBorderColor: "grey", cancelDecoration: "none",
  terminalClasses: ["term-verified"], terminalColours: ["green"],
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

test("isConsentTextRight needs every phrase and no full access", () => {
  const good = "Docker container: copied files only, no network. Docker must be on.";
  assert.equal(isConsentTextRight(good), true);
  assert.equal(isConsentTextRight(`${good} It has full access.`), false);
  assert.equal(isConsentTextRight("Docker container: copied files only. Docker must be on."), false);
});

test("isPopupShown passes a visible popup and fails a hidden one", () => {
  assert.equal(isPopupShown(GOOD_POPUP), true);
  assert.equal(isPopupShown({ ...GOOD_POPUP, hidden: true }), false);
});

test("isPopupContentRight passes the expected output and fails other text or a second pre", () => {
  assert.equal(isPopupContentRight(GOOD_POPUP, "a\nb"), true);
  assert.equal(isPopupContentRight(GOOD_POPUP, "other"), false);
  assert.equal(isPopupContentRight({ ...GOOD_POPUP, preCount: 2 }, "a\nb"), false);
});

test("isCancelButtonRight judges the idle, live and cancelled buttons", () => {
  assert.equal(isCancelButtonRight(GOOD_POPUP, CancelKind.idle, "red"), true);
  assert.equal(isCancelButtonRight({ ...GOOD_POPUP, cancelDisabled: false }, CancelKind.idle, "red"), false);
  const live = { ...GOOD_POPUP, cancelClass: "cancel-btn btn-live", cancelDisabled: false, cancelBorderColor: "red" };
  assert.equal(isCancelButtonRight(live, CancelKind.live, "red"), true);
  assert.equal(isCancelButtonRight(live, CancelKind.live, "blue"), false);
  const cancelled = { ...GOOD_POPUP, cancelClass: "cancel-btn btn-cancelled", cancelDecoration: "line-through" };
  assert.equal(isCancelButtonRight(cancelled, CancelKind.cancelled, undefined), true);
  assert.equal(isCancelButtonRight({ ...cancelled, cancelDecoration: "none" }, CancelKind.cancelled, undefined), false);
});

test("isTerminalBlockRight passes one named block or none, and fails a different block", () => {
  assert.equal(isTerminalBlockRight(GOOD_POPUP, "term-verified"), true);
  assert.equal(isTerminalBlockRight(GOOD_POPUP, "term-mismatch"), false);
  assert.equal(isTerminalBlockRight({ ...GOOD_POPUP, terminalClasses: [] }, undefined), true);
  assert.equal(isTerminalBlockRight(GOOD_POPUP, undefined), false);
});

test("isOutcomeRight judges block, node state and note together", () => {
  const injected = OUTCOME_CASES.find((outcome) => outcome.stateClass === "run-state-injected-unverified")!;
  const popup = { ...GOOD_POPUP, terminalClasses: [], noteTexts: ["Replayed. No proof file was found to compare with."] };
  assert.equal(isOutcomeRight(popup, "node n-script run-state-injected-unverified", injected), true);
  assert.equal(isOutcomeRight({ ...popup, noteTexts: [] }, "node n-script run-state-injected-unverified", injected), false);
  assert.equal(isOutcomeRight(popup, "node n-script", injected), false);
  assert.equal(isOutcomeRight(GOOD_POPUP, "node n-script run-state-injected-unverified", injected), false);
});

test("a crashed run has no node state, so a state class on its dot fails", () => {
  const crashed = OUTCOME_CASES.find((outcome) => outcome.note?.includes("crashed"))!;
  const popup = { ...GOOD_POPUP, terminalClasses: [], noteTexts: ["the script crashed with exit code 1"] };
  assert.equal(isOutcomeRight(popup, "node n-script", crashed), true);
  assert.equal(isOutcomeRight(popup, "node n-script run-state-verified", crashed), false);
});

test("isEventColoursSame passes matching colours and fails a different title colour", () => {
  assert.equal(isEventColoursSame(buildGoodNodes(), TITLES), true);
  assert.equal(isEventColoursSame(buildGoodNodes(), { ...TITLES, verified: "blue" }), false);
});

test("isPopupClearOfDrawer passes a popup left of the drawer and fails an overlapping one", () => {
  assert.equal(isPopupClearOfDrawer(GOOD_POPUP), true);
  assert.equal(isPopupClearOfDrawer({ ...GOOD_POPUP, popupRect: [0, 0, 200, 50] }), false);
});

test("the output judges count step lines, so streaming grows and a stopped run does not", () => {
  assert.equal(countOutputLines("step 1 of 6step 2 of 6"), 2);
  assert.equal(isOutputStreaming("step 1 of 6", "step 1 of 6step 2 of 6step 3 of 6"), true);
  assert.equal(isOutputStreaming("step 1 of 6", "step 1 of 6"), false);
  assert.equal(isOutputStreaming("step 1 of 6", "step 1 of 6step 2 of 6step 3 of 6step 4 of 6step 5 of 6step 6 of 6"), false);
  assert.equal(isOutputStopped("step 1 of 6", "step 1 of 6"), true);
  assert.equal(isOutputStopped("step 1 of 6", "step 1 of 6step 2 of 6"), false);
});

test("listNewResources returns only the new entries and returns none when nothing is new", () => {
  assert.deepEqual(listNewResources(["a"], ["a", "b", "c"]), ["b", "c"]);
  assert.deepEqual(listNewResources(["a"], ["a"]), []);
});

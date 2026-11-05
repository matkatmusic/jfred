// Tests for validateLayer6 in layer6-checks.ts: a fake page walks the whole flow and answers each probe with good data.

import { strict as assert } from "node:assert";
import { test } from "node:test";
import { validateLayer6 } from "../scripts/visual/layer6-checks.ts";
import {
  BUTTON_FACTS, CLICK_CLOSE, CLICK_OPEN_BUTTON, CLOSE_LABEL, CONSENT_FACTS, COUNT_CONSOLES, COUNT_CONSOLE_BUTTONS, COUNT_CONSENT_DIALOGS, NEVER_PROVABLE_ID, PENDING_ID, POPUP_FACTS,
  POPUP_TEXT, README_NODE_FACTS, READ_DIALOG_COUNT, READ_FETCH_LOG, RESOURCE_NAMES, SHOW_BOX_KINDS, type PopupFacts,
} from "../scripts/visual/layer6-probes.ts";
import { COUNT_SCRIPT_DOTS } from "../scripts/visual/layer4-probes.ts";
import { collectLines, createFakePage, findLine } from "./layer6-fake-page.ts";

const SCREENSHOTS = ["mockup-12-layer6-node-states.png", "mockup-13-layer6-popup.png"];
const POPUP: PopupFacts = {
  hidden: false, width: 300, height: 200, popupRect: [0, 0, 100, 50], stageRect: [0, 0, 500, 500], drawerRect: [120, 0, 400, 500],
  insideDrawer: false, drawerOpen: true, position: "absolute", insideStagewrap: true, overlapsTimelines: true,
  preCount: 1, preWhiteSpace: "pre", preText: "reading README.md\nwriting README.md\ndone", noteTexts: [],
  cancelButtons: 1, cancelClass: "cancel-btn btn-idle", cancelDisabled: true, cancelBorderColor: "grey", cancelDecoration: "none",
  terminalClasses: ["term-verified"], terminalColours: ["green"],
};
const CONSENT = { count: 1, text: "Docker container: copied files only, no network. Docker must be on.", insideVizRoot: true };
const BLOCKED = {
  count: 1, buttons: ["close", "Go to first unreplayed script node"], text: "", insideStagewrap: true,
  popupRect: [0, 0, 1, 1], drawerRect: [5, 0, 9, 9], drawerOpen: true,
};

interface Knobs { dotTotal: number; consent: typeof CONSENT; openedIds: string[] }

function buildAnswers(knobs: Knobs): (expression: string) => unknown {
  const exact = new Map<string, unknown>([
    [COUNT_SCRIPT_DOTS, knobs.dotTotal], [README_NODE_FACTS, []], [SHOW_BOX_KINDS, []], [CONSENT_FACTS, knobs.consent],
    [BUTTON_FACTS, { count: 1, text: "Open run console", insideDrawer: true }], [POPUP_TEXT, "run console"],
    [CLOSE_LABEL, "Close"], [COUNT_CONSOLES, 1], [COUNT_CONSOLE_BUTTONS, 0], [COUNT_CONSENT_DIALOGS, 0], [READ_FETCH_LOG, []],
    [READ_DIALOG_COUNT, 0], [RESOURCE_NAMES, []],
  ]);
  let isPopupHidden = false;
  return (expression: string): unknown => {
    if (expression === CLICK_CLOSE) isPopupHidden = true;
    if (expression === CLICK_OPEN_BUTTON) isPopupHidden = false;
    if (expression === POPUP_FACTS) return { ...POPUP, hidden: isPopupHidden };
    if (exact.has(expression)) return exact.get(expression);
    if (expression.includes("replaceChildren") && expression.includes(".click()"))
      knobs.openedIds.push(/data-tool-use-id="([^"]+)"/.exec(expression)![1]!);
    if (expression.includes("confirmHidden")) return { confirmHidden: false, buttonHidden: true };
    if (expression.includes("run-blocked-popup") && expression.includes("buttons")) return BLOCKED;
    if (expression.endsWith(".className")) return "node n-script";
    if (expression.includes("reply.needs")) return [];
    if (expression.includes("closest('.filebox')")) return ["a.ts", "b.ts"];
    return undefined;
  };
}

async function runLayer6(knobs: Knobs) {
  const fake = createFakePage(buildAnswers(knobs));
  const lines = await collectLines(() => validateLayer6(fake.page, "http://page.test/"), SCREENSHOTS);
  return { lines, navigations: fake.navigations };
}

const GOOD: () => Knobs = () => ({ dotTotal: 20, consent: CONSENT, openedIds: [] });

test("validateLayer6 opens four fresh pages, opens the pending and bash drawers first and runs every group", async () => {
  const knobs = GOOD();
  const { lines, navigations } = await runLayer6(knobs);
  assert.equal(navigations.length, 4);
  assert.deepEqual(navigations, Array(4).fill("http://page.test/"));
  assert.deepEqual(knobs.openedIds.slice(0, 2), [PENDING_ID, NEVER_PROVABLE_ID]);
  assert.ok(knobs.openedIds.includes(PENDING_ID));
  for (const name of ["L6 the page draws 20 script nodes", "L6 the consent dialog is open once", "L6 the dialog names copied files only",
    "L6 the started pending run shows one Open run console button", "L6 Close hides the popup", "L6 Open run console again shows the same single popup"])
    assert.ok(findLine(lines, name).startsWith("PASS"), name);
  assert.ok(lines.some((line) => line.includes("L6 the blocked dot shows")));
  assert.ok(lines.some((line) => line.includes("L6 the clear button asks first")));
});

test("validateLayer6 fails the dot-total check for another count and the consent check for a second dialog", async () => {
  const { lines } = await runLayer6({ ...GOOD(), dotTotal: 10, consent: { ...CONSENT, count: 2 } });
  assert.ok(findLine(lines, "L6 the page draws 20 script nodes").startsWith("FAIL"));
  assert.ok(findLine(lines, "L6 the consent dialog is open once").startsWith("FAIL"));
  assert.ok(findLine(lines, "L6 the dialog names copied files only").startsWith("PASS"));
});

test("validateLayer6 fails the consent text check when the dialog says full access", async () => {
  const { lines } = await runLayer6({ ...GOOD(), consent: { ...CONSENT, text: `${CONSENT.text} full access` } });
  assert.ok(findLine(lines, "L6 the dialog names copied files only").startsWith("FAIL"));
});

// Tests for validatePopup in layer6-popup-checks.ts, using a fake page with canned answers.

import { strict as assert } from "node:assert";
import { test } from "node:test";
import { validatePopup } from "../scripts/visual/layer6-popup-checks.ts";
import {
  CLICK_CANCEL, CLICK_OPEN_BUTTON, POPUP_FACTS, POPUP_TEXT, RESOURCE_NAMES, type NodeFacts, type PopupFacts,
} from "../scripts/visual/layer6-probes.ts";
import { collectLines, createFakePage } from "./layer6-fake-page.ts";

const goodPopup: PopupFacts = {
  hidden: false, width: 300, height: 200, popupRect: [100, 100, 400, 300], stageRect: [0, 0, 1000, 800], drawerRect: [500, 0, 1000, 800],
  insideDrawer: false, drawerOpen: true, position: "absolute", insideStagewrap: true, overlapsTimelines: true,
  preCount: 1, preWhiteSpace: "pre", preText: "reading README.md\nwriting README.md\ndone", noteTexts: [],
  cancelButtons: 1, cancelClass: "cancel-btn btn-idle", cancelDisabled: true, cancelBorderColor: "grey", cancelDecoration: "none",
  terminalClasses: ["term-verified"], terminalColours: ["green"],
};

interface Scenario { popup: PopupFacts; texts: string[]; leaksOnOpen: boolean }
const goodScenario: Scenario = { popup: goodPopup, texts: ["run console"], leaksOnOpen: false };

async function runScenario(scenario: Scenario): Promise<{ lines: string[]; title: string }> {
  const resources = ["page.js"];
  let textReads = 0;
  const answers = new Map<string, () => unknown>([
    [RESOURCE_NAMES, () => [...resources]],
    [CLICK_OPEN_BUTTON, () => { if (scenario.leaksOnOpen) resources.push("leak.js"); return undefined; }],
    [POPUP_FACTS, () => scenario.popup],
    [POPUP_TEXT, () => scenario.texts[Math.min(textReads++, scenario.texts.length - 1)]],
    [CLICK_CANCEL, () => undefined],
  ]);
  const fake = createFakePage((expression) => answers.get(expression)!());
  let title = "";
  const lines = await collectLines(async () => { title = await validatePopup(fake.page, [] as NodeFacts[]); }, ["mockup-13-layer6-popup.png"]);
  return { lines, title };
}

const listFailedChecks = (lines: string[]): string[] => lines.filter((line) => line.startsWith("FAIL")).map((line) => line.split("  ")[1] ?? "");

test("a good popup passes all nine checks and returns the verified title colour", async () => {
  const { lines, title } = await runScenario(goodScenario);
  assert.equal(lines.filter((line) => line.startsWith("PASS")).length, 9);
  assert.deepEqual(listFailedChecks(lines), []);
  assert.equal(title, "green");
});

test("a request made by opening the popup fails only the request check", async () => {
  const { lines } = await runScenario({ ...goodScenario, leaksOnOpen: true });
  assert.deepEqual(listFailedChecks(lines), ["L6 opening the popup makes no request"]);
  assert.ok(lines.some((line) => line.includes("leak.js")));
});

test("consent wording fails only the consent check", async () => {
  const { lines } = await runScenario({ ...goodScenario, texts: ["Please allow this run"] });
  assert.deepEqual(listFailedChecks(lines), ["L6 the popup has no consent wording"]);
});

test("text that changes while waiting fails only the stillness check", async () => {
  const { lines } = await runScenario({ ...goodScenario, texts: ["first", "second", "first"] });
  assert.deepEqual(listFailedChecks(lines), ["L6 the popup text does not change over 1 second"]);
});

test("a cancel click that changes the text fails only the cancel check", async () => {
  const { lines } = await runScenario({ ...goodScenario, texts: ["same", "same", "changed"] });
  assert.deepEqual(listFailedChecks(lines), ["L6 the disabled Cancel of a finished run does nothing: no request and the same popup text"]);
});

test("a popup inside the drawer, a live Cancel and a wrong block fail their own checks", async () => {
  const popup = { ...goodPopup, insideDrawer: true, cancelClass: "cancel-btn btn-live", terminalClasses: ["term-mismatch"] };
  const { lines } = await runScenario({ ...goodScenario, popup });
  assert.equal(listFailedChecks(lines).length, 3);
  assert.ok(lines.some((line) => line.startsWith("FAIL  L6 Open run console shows a visible popup")));
  assert.ok(lines.some((line) => line.startsWith("FAIL  L6 a finished run shows 1 Cancel button")));
  assert.ok(lines.some((line) => line.startsWith("FAIL  L6 a verified run shows 1 terminal block")));
});

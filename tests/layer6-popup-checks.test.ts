// Tests for validatePopup in layer6-popup-checks.ts, using a fake page with canned answers.

import { strict as assert } from "node:assert";
import { existsSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { type HeadlessPage } from "../scripts/visual/cdp.ts";
import { failures } from "../scripts/visual/mockup-checks.ts";
import { validatePopup } from "../scripts/visual/layer6-popup-checks.ts";
import {
  CLICK_CANCEL, CLICK_OPEN_BUTTON, MISMATCH_ID, ORIGINAL_FAILED_ID, POPUP_FACTS, POPUP_TEXT, RESOURCE_NAMES, VERIFIED_ID, buildTitleColour,
  type NodeFacts, type PopupFacts,
} from "../scripts/visual/layer6-probes.ts";

const SCREENSHOT_FILE = join(dirname(fileURLToPath(import.meta.url)), "..", "scripts", "visual", "out", "mockup-13-layer6-popup.png");

const goodPopup: PopupFacts = {
  hidden: false, width: 300, height: 200, popupRect: [100, 100, 400, 300], stageRect: [0, 0, 1000, 800], drawerRect: [500, 0, 1000, 800],
  insideDrawer: false, drawerOpen: true, position: "absolute", insideStagewrap: true, overlapsTimelines: true,
  preCount: 1, preWhiteSpace: "pre", captionCount: 1, captionStyle: "italic", stateCaptionCount: 1,
  idleDisabled: true, liveDisabled: false, cancelledDisabled: true, liveBorderColor: "red", cancelledDecoration: "line-through", cancelButtons: 3,
  terminalClasses: ["term-cancelled", "term-verified", "term-mismatch", "term-original-failed"], terminalColours: ["a", "b", "c", "d"],
};

const buildNode = (id: string, borderColor: string, outlineColor: string): NodeFacts => ({
  id, classes: "", width: 10, height: 10, borderStyle: "solid", borderColor, borderWidth: "1px",
  outlineStyle: "solid", outlineColor, outlineWidth: "1px", backgroundImage: "none",
});
const goodNodes = [buildNode(MISMATCH_ID, "red", ""), buildNode(VERIFIED_ID, "", "green"), buildNode(ORIGINAL_FAILED_ID, "", "orange")];
const goodTitles: Record<string, string> = { "term-mismatch": "red", "term-verified": "green", "term-original-failed": "orange" };

interface Scenario { popup: PopupFacts; texts: string[]; leaksOnOpen: boolean; titles: Record<string, string> }
const goodScenario: Scenario = { popup: goodPopup, texts: ["run console"], leaksOnOpen: false, titles: goodTitles };

async function runScenario(scenario: Scenario): Promise<string[]> {
  const resources = ["page.js"];
  let textReads = 0;
  const answers = new Map<string, () => unknown>([
    [RESOURCE_NAMES, () => [...resources]],
    [CLICK_OPEN_BUTTON, () => { if (scenario.leaksOnOpen) resources.push("leak.js"); return undefined; }],
    [POPUP_FACTS, () => scenario.popup],
    [POPUP_TEXT, () => scenario.texts[Math.min(textReads++, scenario.texts.length - 1)]],
    [CLICK_CANCEL, () => undefined],
    ...Object.keys(scenario.titles).map((termClass): [string, () => unknown] => [buildTitleColour(termClass), () => scenario.titles[termClass]]),
  ]);
  const page: HeadlessPage = {
    evaluate: async <T>(expression: string) => answers.get(expression)!() as T,
    waitFor: async () => {},
    navigate: async () => {},
    screenshot: async () => "",
    close: async () => {},
  };
  const savedScreenshot = existsSync(SCREENSHOT_FILE) ? readFileSync(SCREENSHOT_FILE) : undefined;
  const failuresBefore = failures.length;
  const log = console.log;
  const lines: string[] = [];
  console.log = (line: string) => { lines.push(line); };
  try {
    await validatePopup(page, goodNodes);
  } finally {
    console.log = log;
    failures.length = failuresBefore;
    if (savedScreenshot === undefined) rmSync(SCREENSHOT_FILE, { force: true });
    else writeFileSync(SCREENSHOT_FILE, savedScreenshot);
  }
  return lines;
}

const listFailedChecks = (lines: string[]): string[] => lines.filter((line) => line.startsWith("FAIL")).map((line) => line.split("  ")[1] ?? "");

test("a good popup passes all ten checks", async () => {
  const lines = await runScenario(goodScenario);
  assert.equal(lines.filter((line) => line.startsWith("PASS")).length, 10);
  assert.deepEqual(listFailedChecks(lines), []);
});

test("a request made by opening the popup fails only the request check", async () => {
  const lines = await runScenario({ ...goodScenario, leaksOnOpen: true });
  assert.deepEqual(listFailedChecks(lines), ["L6 opening the popup makes no request"]);
  assert.ok(lines.some((line) => line.includes("leak.js")));
});

test("consent wording fails only the consent check", async () => {
  const lines = await runScenario({ ...goodScenario, texts: ["Please allow this run"] });
  assert.deepEqual(listFailedChecks(lines), ["L6 the popup has no consent wording"]);
});

test("text that changes while waiting fails only the stillness check", async () => {
  const lines = await runScenario({ ...goodScenario, texts: ["first", "second", "first"] });
  assert.deepEqual(listFailedChecks(lines), ["L6 the popup text does not change over 1 second"]);
});

test("a cancel click that changes the text fails only the cancel check", async () => {
  const lines = await runScenario({ ...goodScenario, texts: ["same", "same", "changed"] });
  assert.deepEqual(listFailedChecks(lines), ["L6 cancel does nothing: no request and the same popup text"]);
});

test("a popup inside the drawer and a wrong title colour fail their own checks", async () => {
  const scenario = { ...goodScenario, popup: { ...goodPopup, insideDrawer: true }, titles: { ...goodTitles, "term-verified": "blue" } };
  const lines = await runScenario(scenario);
  assert.equal(listFailedChecks(lines).length, 2);
  assert.ok(lines.some((line) => line.startsWith("FAIL  L6 Open run console shows a visible popup")));
  assert.ok(lines.some((line) => line.startsWith("FAIL  L6 node and console read as one event")));
});

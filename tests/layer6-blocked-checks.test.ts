// Tests for validateBlocked in layer6-blocked-checks.ts, using a fake page that follows the clicks and scrolls.

import { strict as assert } from "node:assert";
import { test } from "node:test";
import { validateBlocked } from "../scripts/visual/layer6-blocked-checks.ts";
import {
  CLICK_BLOCKED_CLOSE, CLICK_BLOCKED_GO, type BlockedFacts,
} from "../scripts/visual/layer6-blocked-facts.ts";
import {
  BLOCKED_ID, BLOCKER_ID, CLICK_RUN_SCRIPTS, PAGE_SPY_INSTALL, READ_DIALOG_COUNT, READ_FETCH_LOG, buildScrollToDot,
} from "../scripts/visual/layer6-probes.ts";
import { type FetchEntry } from "../scripts/visual/layer6-steps.ts";
import { collectLines, createFakePage, findLine } from "./layer6-fake-page.ts";

const GOOD_FACTS: BlockedFacts = {
  count: 1, buttons: ["close", "Go to first unreplayed script node"], text: "toolu_x: not run yet",
  insideStagewrap: true, popupRect: [10, 10, 100, 60], dotRect: [0, 20, 2, 28], drawerRect: [120, 0, 400, 500], drawerOpen: true,
};

interface Knobs { leaksBlockedPost: boolean; dialogCount: number; isDotFar?: boolean }

function buildAnswers(knobs: Knobs): (expression: string) => unknown {
  let log: FetchEntry[] = [];
  let isClosed = false;
  let goCount = 0;
  const post = (id: string) => log.push({ path: "/api/layer1-script-run", body: JSON.stringify({ toolUseId: id }) });
  return (expression: string): unknown => {
    if (expression === PAGE_SPY_INSTALL) { log = []; isClosed = false; }
    if (expression === CLICK_BLOCKED_CLOSE) isClosed = true;
    if (expression === CLICK_RUN_SCRIPTS) post(BLOCKER_ID);
    if (expression === CLICK_BLOCKED_GO) { goCount += 1; if (goCount === 2) post(BLOCKER_ID); }
    if (expression === buildScrollToDot(BLOCKED_ID)) {
      if (goCount === 2) post(BLOCKED_ID);
      if (knobs.leaksBlockedPost && goCount === 0) post(BLOCKED_ID);
    }
    if (expression === READ_FETCH_LOG) return [...log];
    if (expression === READ_DIALOG_COUNT) return knobs.dialogCount;
    if (expression.includes("run-blocked-popup") && expression.includes("buttons")) return { ...GOOD_FACTS, count: isClosed ? 0 : 1, dotRect: knobs.isDotFar ? [500, 20, 510, 28] : GOOD_FACTS.dotRect };
    if (expression.endsWith(".className")) return "node n-script";
    if (expression.includes("closest('.filebox')")) return ["a.ts", "b.ts"];
    return undefined;
  };
}

async function runBlocked(knobs: Knobs): Promise<{ lines: string[]; navigations: string[] }> {
  const fake = createFakePage(buildAnswers(knobs));
  const lines = await collectLines(() => validateBlocked(fake.page, "http://page.test/"));
  return { lines, navigations: fake.navigations };
}

const listFailedChecks = (lines: string[]): string[] => lines.filter((line) => line.startsWith("FAIL")).map((line) => line.split("  ")[1] ?? "");

test("validateBlocked opens two fresh pages and passes all twelve checks on a good page", async () => {
  const { lines, navigations } = await runBlocked({ leaksBlockedPost: false, dialogCount: 0 });
  assert.deepEqual(navigations, ["http://page.test/", "http://page.test/"]);
  assert.equal(lines.filter((line) => line.startsWith("PASS")).length, 12);
  assert.ok(findLine(lines, "the blocked popup sits beside the blocked dot").startsWith("PASS"));
  assert.deepEqual(listFailedChecks(lines), []);
});

test("a run request for the blocked dot fails the popup check and the alone check", async () => {
  const { lines } = await runBlocked({ leaksBlockedPost: true, dialogCount: 0 });
  assert.ok(findLine(lines, "sends no run request").startsWith("FAIL"));
  assert.ok(findLine(lines, "the blocker runs alone").startsWith("FAIL"));
  assert.ok(findLine(lines, "after 400 ms").startsWith("PASS"));
});

test("a popup far from the blocked dot fails only the beside-the-dot check", async () => {
  const { lines } = await runBlocked({ leaksBlockedPost: false, dialogCount: 0, isDotFar: true });
  assert.deepEqual(listFailedChecks(lines), ["L6 the blocked popup sits beside the blocked dot"]);
});

test("a native dialog fails the no-dialog check on both pages", async () => {
  const { lines } = await runBlocked({ leaksBlockedPost: false, dialogCount: 1 });
  const failed = listFailedChecks(lines);
  assert.deepEqual(failed, ["L6 no native dialog is opened on this page", "L6 no native dialog is opened on this page"]);
});

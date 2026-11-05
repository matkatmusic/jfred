// Tests for validateClear in layer6-clear-checks.ts, using a fake page that follows the clear click.

import { strict as assert } from "node:assert";
import { test } from "node:test";
import { type BlockedFacts } from "../scripts/visual/layer6-blocked-facts.ts";
import { validateClear } from "../scripts/visual/layer6-clear-checks.ts";
import { CRASH_BLOCKER_ID, READ_FETCH_LOG } from "../scripts/visual/layer6-probes.ts";
import { type FetchEntry } from "../scripts/visual/layer6-steps.ts";
import { collectLines, createFakePage } from "./layer6-fake-page.ts";

const FACTS: BlockedFacts = {
  count: 1, buttons: ["close", "Go to first unreplayed script node"], text: "",
  insideStagewrap: true, popupRect: [0, 0, 1, 1], dotRect: [],drawerRect: [5, 0, 9, 9], drawerOpen: false,
};

interface Knobs { isHollow: boolean; pendingPosts: number; isStillCrashed: boolean; isAskingNothing: boolean }

function buildAnswers(knobs: Knobs): (expression: string) => unknown {
  const log: FetchEntry[] = [];
  let isCleared = false;
  return (expression: string): unknown => {
    if (expression.includes("clear-results-yes")) {
      isCleared = true;
      log.push({ path: "/api/layer1-clear-results", body: "{}" });
    }
    if (expression === READ_FETCH_LOG) return [...log];
    if (expression.includes("confirmHidden")) return { confirmHidden: knobs.isAskingNothing, buttonHidden: true };
    if (expression === "window.__hollowSeen") return knobs.isHollow;
    if (expression.includes("layer1-script-run") && expression.includes("length")) return knobs.pendingPosts;
    if (expression.includes("run-blocked-popup") && expression.includes("buttons")) {
      const state = isCleared && !knobs.isStillCrashed ? "not run yet" : "crashed or timed out";
      return { ...FACTS, text: `${CRASH_BLOCKER_ID}: ${state}` };
    }
    return undefined;
  };
}

const GOOD: Knobs = { isHollow: true, pendingPosts: 2, isStillCrashed: false, isAskingNothing: false };

async function runClear(knobs: Knobs): Promise<string[]> {
  const fake = createFakePage(buildAnswers(knobs));
  return collectLines(() => validateClear(fake.page));
}

const listFailedChecks = (lines: string[]): string[] => lines.filter((line) => line.startsWith("FAIL")).map((line) => line.split("  ")[1] ?? "");

test("validateClear passes all five checks on a good page", async () => {
  const lines = await runClear(GOOD);
  assert.equal(lines.filter((line) => line.startsWith("PASS")).length, 5);
  assert.deepEqual(listFailedChecks(lines), []);
});

test("a clear that draws no hollow dot fails only the cleared check", async () => {
  const lines = await runClear({ ...GOOD, isHollow: false });
  assert.deepEqual(listFailedChecks(lines), ["L6 Yes sends one clear request and the run dots are drawn again as hollow rings"]);
});

test("a pending run that does not start again fails only the starts-again check", async () => {
  const lines = await runClear({ ...GOOD, pendingPosts: 1 });
  assert.deepEqual(listFailedChecks(lines), ["L6 after the clear the pending run starts again: the page and the server forgot it"]);
});

test("a popup that stays crashed after the clear fails only the reset check", async () => {
  const lines = await runClear({ ...GOOD, isStillCrashed: true });
  assert.deepEqual(listFailedChecks(lines), ["L6 after the clear the later dot names its blocker as not run yet, no longer crashed"]);
});

test("a clear button that does not hide itself fails only the asks-first check", async () => {
  const lines = await runClear({ ...GOOD, isAskingNothing: true });
  assert.deepEqual(listFailedChecks(lines), ["L6 the clear button asks first: the confirmation shows and no request is sent yet"]);
});

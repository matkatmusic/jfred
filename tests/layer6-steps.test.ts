// Tests for layer6-steps.ts: the fetch log readers and the page steps, using a fake page.

import { strict as assert } from "node:assert";
import { test } from "node:test";
import {
  CLICK_OPEN_BUTTON, CONSOLE_FINISHED, OPEN_BUTTON_PRESENT, PAGE_SPY_INSTALL, READ_FETCH_LOG, buildNodeExpression, buildRunPostProbe, buildScrollToDot,
} from "../scripts/visual/layer6-probes.ts";
import {
  countClearPosts, listRunPostIds, openFreshPage, openRunConsole, openScriptLayer, readClearPostCount, readRunPostIds, moveToDot,
  waitForRunFinished, waitForRunPost, type FetchEntry,
} from "../scripts/visual/layer6-steps.ts";
import { createFakePage } from "./layer6-fake-page.ts";

const LOG: FetchEntry[] = [
  { path: "/api/layer1-view", body: "" },
  { path: "/api/layer1-script-run", body: JSON.stringify({ toolUseId: "toolu_a", allowScripts: true }) },
  { path: "/api/layer1-script-runs", body: "" },
  { path: "/api/layer1-script-run", body: JSON.stringify({ toolUseId: "toolu_b" }) },
  { path: "/api/layer1-clear-results", body: "{}" },
];

test("listRunPostIds reads the ids of run posts only, in order", () => {
  assert.deepEqual(listRunPostIds(LOG), ["toolu_a", "toolu_b"]);
  assert.deepEqual(listRunPostIds([]), []);
});

test("countClearPosts counts only the clear route", () => {
  assert.equal(countClearPosts(LOG), 1);
  assert.equal(countClearPosts([]), 0);
});

test("the readers send the fetch log expression and return the parsed answer", async () => {
  const fake = createFakePage(() => LOG);
  assert.deepEqual(await readRunPostIds(fake.page), ["toolu_a", "toolu_b"]);
  assert.equal(await readClearPostCount(fake.page), 1);
  assert.deepEqual(fake.evaluated, [READ_FETCH_LOG, READ_FETCH_LOG]);
});

test("openFreshPage navigates, waits for the bubbles and then installs the spy", async () => {
  const fake = createFakePage(() => undefined);
  await openFreshPage(fake.page, "http://page.test/");
  assert.deepEqual(fake.navigations, ["http://page.test/"]);
  assert.equal(fake.waited.length, 1);
  assert.deepEqual(fake.evaluated, [PAGE_SPY_INSTALL]);
});

test("openScriptLayer clicks the layer 4 button and waits for dots", async () => {
  const fake = createFakePage(() => undefined);
  await openScriptLayer(fake.page);
  assert.ok(fake.evaluated[0]!.includes("layer-4"));
  assert.ok(fake.waited[0]!.includes("n-script"));
});

test("moveToDot and the two waits use the probes for the given id", async () => {
  const fake = createFakePage(() => undefined);
  await moveToDot(fake.page, "toolu_a");
  await waitForRunPost(fake.page, "toolu_a");
  await waitForRunFinished(fake.page);
  assert.deepEqual(fake.evaluated, [buildScrollToDot("toolu_a")]);
  assert.deepEqual(fake.waited, [buildRunPostProbe("toolu_a"), CONSOLE_FINISHED]);
});

test("openRunConsole resets the drawer, clicks the dot, waits for the button and clicks it", async () => {
  const fake = createFakePage(() => undefined);
  await openRunConsole(fake.page, "toolu_a");
  assert.equal(fake.evaluated.length, 2);
  assert.ok(fake.evaluated[0]!.includes(`${buildNodeExpression("toolu_a")}.click()`));
  assert.ok(fake.evaluated[0]!.includes("classList.remove('open')"));
  assert.deepEqual(fake.waited, [OPEN_BUTTON_PRESENT]);
  assert.equal(fake.evaluated[1], CLICK_OPEN_BUTTON);
});

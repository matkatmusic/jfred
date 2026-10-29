// The before-tick check of the Layer 4 real-data run, driven by a stub page instead of a browser.

import { test } from "node:test";
import assert from "node:assert/strict";
import type { HeadlessPage } from "../scripts/visual/cdp.ts";
import { failures } from "../scripts/visual/mockup-checks.ts";
import { validateBeforeTick } from "../scripts/visual/layer4-real-checks.ts";

function createStubPage(count: number): HeadlessPage {
  return { evaluate: () => Promise.resolve(count) } as unknown as HeadlessPage;
}

async function collectFailuresFor(count: number): Promise<string[]> {
  failures.length = 0;
  await validateBeforeTick(createStubPage(count));
  return failures.splice(0);
}

test("passes both before-tick checks when nothing is drawn and nothing was requested", async () => {
  assert.deepEqual(await collectFailuresFor(0), []);
});

test("fails both before-tick checks when a node or request already exists", async () => {
  assert.equal((await collectFailuresFor(1)).length, 2);
});

// Tests for the multi-file drawer checks in mockup-checks-multi-drawer.ts, using a fake page with queued answers.

import { strict as assert } from "node:assert";
import { test } from "node:test";
import { type HeadlessPage } from "../scripts/visual/cdp.ts";
import { failures } from "../scripts/visual/mockup-checks.ts";
import { validateMultiFileDrawer } from "../scripts/visual/mockup-checks-multi-drawer.ts";

function buildFakePage(answers: unknown[]): HeadlessPage {
  const queue = [...answers];
  return {
    evaluate: async <T>() => queue.shift() as T,
    waitFor: async () => {},
    navigate: async () => {},
    screenshot: async () => "",
    close: async () => {},
  };
}

async function collectFailures(run: () => Promise<void>): Promise<string[]> {
  const before = failures.length;
  const log = console.log;
  console.log = () => {};
  try {
    await run();
  }
  finally {
    console.log = log;
  }
  const added = failures.slice(before);
  failures.length = before;
  return added;
}

const FILES = ["a.ts", "b.ts"];
const DRAWER_ANSWERS = [
  undefined, FILES, undefined, undefined, FILES, true,
  true, true, true, true, undefined,
  true, undefined, true, undefined, true, undefined,
  true, undefined, undefined, "src", FILES, undefined, FILES, undefined, undefined,
];

test("validateMultiFileDrawer passes when every section check holds", async () => {
  const page = buildFakePage(DRAWER_ANSWERS);
  assert.deepEqual(await collectFailures(() => validateMultiFileDrawer(page)), []);
});

test("validateMultiFileDrawer fails the stacking check when sections sit side by side", async () => {
  const page = buildFakePage([...DRAWER_ANSWERS.slice(0, 6), false, ...DRAWER_ANSWERS.slice(7)]);
  assert.deepEqual(await collectFailures(() => validateMultiFileDrawer(page)),
    ["#328 sections stack vertically, never side by side"]);
});

// Tests for the File Nav checks in mockup-checks-nav.ts, using a fake page with queued answers.

import { strict as assert } from "node:assert";
import { test } from "node:test";
import { type HeadlessPage } from "../scripts/visual/cdp.ts";
import { failures } from "../scripts/visual/mockup-checks.ts";
import { validateBubbleFlash, validateSessionSearch } from "../scripts/visual/mockup-checks-nav.ts";

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

const FLASH_ANSWERS = ["src/a.ts", ["s1.jsonl", "s2.jsonl"], ["s2.jsonl", "s1.jsonl"], 0, "s1.jsonl", "s1.jsonl", undefined, "s2.jsonl", "s2.jsonl"];
const SEARCH_ANSWERS = [3, 5, "seed", ["a.jsonl"], ["a.jsonl"], 3, [], 1, undefined, 5];

test("validateBubbleFlash passes when the flash and both leads match", async () => {
  const page = buildFakePage(FLASH_ANSWERS);
  assert.deepEqual(await collectFailures(() => validateBubbleFlash(page)), []);
});

test("validateBubbleFlash fails when a click selects a session", async () => {
  const page = buildFakePage([...FLASH_ANSWERS.slice(0, 3), 1, ...FLASH_ANSWERS.slice(4)]);
  assert.deepEqual(await collectFailures(() => validateBubbleFlash(page)),
    ["#308 highlighting is not selecting — no session is filtered by the click"]);
});

test("validateSessionSearch passes when the list filters and the timeline stays", async () => {
  const page = buildFakePage(SEARCH_ANSWERS);
  assert.deepEqual(await collectFailures(() => validateSessionSearch(page)), []);
});

test("validateSessionSearch fails when the search also filters the timeline", async () => {
  const page = buildFakePage([...SEARCH_ANSWERS.slice(0, 5), 2, ...SEARCH_ANSWERS.slice(6)]);
  assert.deepEqual(await collectFailures(() => validateSessionSearch(page)),
    ["#309 filtering the LIST does not filter the TIMELINE"]);
});

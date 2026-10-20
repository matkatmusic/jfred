// Tests for the browser checks in mockup-checks.ts, using a fake page with canned answers.

import { strict as assert } from "node:assert";
import { test } from "node:test";
import { type HeadlessPage } from "../scripts/visual/cdp.ts";
import { FADE_WAIT_MS, failures, validateOrdering, validateScale } from "../scripts/visual/mockup-checks.ts";

const fakePage = (answerFor: (expression: string) => unknown): HeadlessPage => ({
    evaluate: async <T>(expression: string) => answerFor(expression) as T,
    waitFor: async () => {},
    navigate: async () => {},
    screenshot: async () => "",
    close: async () => {},
});

const runCollectingFailures = async (run: () => Promise<void>): Promise<string[]> => {
    const before = failures.length;
    const log = console.log;
    console.log = () => {};
    try {
        await run();
    } finally {
        console.log = log;
    }
    const added = failures.slice(before);
    failures.length = before;
    return added;
};

test("the fade wait outlasts the mockup's 2600 ms flash", () => {
    assert.ok(FADE_WAIT_MS > 2600);
});

test("validateScale passes for a big fixture on a page that scrolls both ways", async () => {
    const page = fakePage(expression =>
        expression.includes("__fixture") ? { snaps: 60, files: 80 } : { w: 4000, h: 4000, vw: 1000, vh: 1000 });
    assert.deepEqual(await runCollectingFailures(() => validateScale(page)), []);
});

test("validateScale fails a small fixture and a stage that does not scroll", async () => {
    const page = fakePage(expression =>
        expression.includes("__fixture") ? { snaps: 5, files: 5 } : { w: 1000, h: 1000, vw: 1000, vh: 1000 });
    assert.equal((await runCollectingFailures(() => validateScale(page))).length, 3);
});

test("validateOrdering fails when snapshots pre-date born and too few share an instant", async () => {
    const page = fakePage(expression =>
        expression.includes("__fixture") ? { born: ["a.ts@v1"], mtime: [], coTimed: 0 } : 0);
    const added = await runCollectingFailures(() => validateOrdering(page));
    assert.equal(added.length, 3);
    assert.ok(added[0]?.includes("pre-dates"));
});

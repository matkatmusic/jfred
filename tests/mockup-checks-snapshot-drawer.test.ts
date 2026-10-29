// Capture-free test of the snapshot drawer checks; the fake page's screenshot refuses, so no file is written.

import { strict as assert } from "node:assert";
import { test } from "node:test";
import type { HeadlessPage } from "../scripts/visual/cdp.ts";
import { failures } from "../scripts/visual/mockup-checks.ts";
import { validateDrawer } from "../scripts/visual/mockup-checks-snapshot-drawer.ts";

function fakePage(answers: unknown[]): HeadlessPage {
    const queue = [...answers];
    const refuse = async () => { throw new Error("the fake page does not do this"); };
    return {
        evaluate: async <T>() => queue.shift() as T,
        waitFor: async () => {},
        navigate: refuse,
        screenshot: refuse,
        close: refuse,
    };
}

async function collectFailuresBeforeScreenshot(page: HeadlessPage): Promise<string[]> {
    const before = failures.length;
    await assert.rejects(validateDrawer(page), /the fake page does not do this/);
    const added = failures.slice(before);
    failures.length = before;
    return added;
}

const EARLY = { head: "util.ts Snapshot - dispatch through one table", meta: "b21d84c5.jsonl", body: "early bytes" };
const LATE = { head: "util.ts Snapshot - cover the error branch, take notes", meta: "d4a06b8f.jsonl", body: "late bytes" };

test("validateDrawer passes every check when both drawers name their own session", async () => {
    const page = fakePage([undefined, EARLY, undefined, LATE, "d4a06b8f.jsonl"]);
    assert.deepEqual(await collectFailuresBeforeScreenshot(page), []);
});

test("validateDrawer fails the bytes check when both snapshots hold the same body", async () => {
    const page = fakePage([undefined, EARLY, undefined, { ...LATE, body: EARLY.body }, "d4a06b8f.jsonl"]);
    assert.deepEqual(await collectFailuresBeforeScreenshot(page),
        ["#300 two same-named @v2 snapshots hold DIFFERENT bytes"]);
});

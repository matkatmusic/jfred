// Capture-free tests for the snapshot checks. No Chrome, no server: a fake page returns canned answers in call order.

import { strict as assert } from "node:assert";
import { test } from "node:test";
import type { HeadlessPage } from "../scripts/visual/cdp.ts";
import { failures } from "../scripts/visual/mockup-checks.ts";
import { validateRulerRow, validateSnapshotNodes } from "../scripts/visual/mockup-checks-snapshots.ts";

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

async function failuresAddedBy(run: () => Promise<void>): Promise<string[]> {
    const before = failures.length;
    const added = await run().then(() => failures.slice(before));
    failures.length = before;
    return added;
}

test("validateSnapshotNodes passes when every snapshot has a versioned label", async () => {
    const page = fakePage([["@v1 📸", "@v2 📸"], 2, true, true, 1, "2026-06-01", true]);
    assert.deepEqual(await failuresAddedBy(() => validateSnapshotNodes(page, "2026-06-01")), []);
});

test("validateSnapshotNodes fails the label check when a label is not '@vN 📸'", async () => {
    const page = fakePage([["@v1 📸", "snap 📸"], 2, true, true, 1, "2026-06-01", true]);
    assert.deepEqual(await failuresAddedBy(() => validateSnapshotNodes(page, "2026-06-01")),
        ["#301 one '@vN 📸' label per snapshot in the fixture"]);
});

test("validateSnapshotNodes fails the anchor check when the bubble anchor moved", async () => {
    const page = fakePage([["@v1 📸"], 1, true, true, 1, "2026-06-02", true]);
    assert.deepEqual(await failuresAddedBy(() => validateSnapshotNodes(page, "2026-06-01")),
        ["#301 the bubble anchor stays on `created at`"]);
});

test("validateRulerRow stops after one failed check when no tick holds the snapshot instant", async () => {
    const page = fakePage([-1]);
    assert.deepEqual(await failuresAddedBy(() => validateRulerRow(page)),
        ["#302 the snapshot's instant has its own expandable tick"]);
});

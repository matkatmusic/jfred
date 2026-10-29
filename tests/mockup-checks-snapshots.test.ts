// Capture-free tests for the snapshot checks. No Chrome, no server: a fake page returns canned answers in call order.

import { strict as assert } from "node:assert";
import { test } from "node:test";
import type { HeadlessPage } from "../scripts/visual/cdp.ts";
import { failures } from "../scripts/visual/mockup-checks.ts";
import { validateRulerRow, validateSnapshotNodes, validateSnapshotToggle } from "../scripts/visual/mockup-checks-snapshots.ts";

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
    const page = fakePage([["@v1 📸", "@v2 📸"], 2, { count: 2, total: 2, unclickable: 0 }, true, 1, true]);
    assert.deepEqual(await failuresAddedBy(() => validateSnapshotNodes(page)), []);
});

test("validateSnapshotNodes fails the label check when a label is not '@vN 📸'", async () => {
    const page = fakePage([["@v1 📸", "snap 📸"], 2, { count: 2, total: 2, unclickable: 0 }, true, 1, true]);
    assert.deepEqual(await failuresAddedBy(() => validateSnapshotNodes(page)),
        ["#301 one '@vN 📸' label per snapshot in the fixture"]);
});

test("validateSnapshotNodes fails the order check when the pre-commit snapshot is misplaced", async () => {
    const page = fakePage([["@v1 📸"], 1, { count: 1, total: 1, unclickable: 0 }, true, 1, false]);
    assert.deepEqual(await failuresAddedBy(() => validateSnapshotNodes(page)),
        ["#301 the pre-commit snapshot sits between `created at` and the first commit"]);
});

const TOGGLE_BEFORE = "100:abc12345/on disk";

test("validateSnapshotToggle passes when the toggle hides and restores snapshots without re-laying-out", async () => {
    const page = fakePage([TOGGLE_BEFORE, undefined, TOGGLE_BEFORE, [true, true], undefined, TOGGLE_BEFORE,
        [false, false], "abc12345/on disk", 0, true]);
    assert.deepEqual(await failuresAddedBy(() => validateSnapshotToggle(page)), []);
});

test("validateSnapshotToggle fails only the first check when the unticked probe differs from before", async () => {
    const page = fakePage([TOGGLE_BEFORE, undefined, "250:abc12345/on disk", [true, true], undefined, TOGGLE_BEFORE,
        [false, false], "abc12345/on disk", 0, true]);
    assert.deepEqual(await failuresAddedBy(() => validateSnapshotToggle(page)),
        ["#304 unticking snapshots leaves a snapshot-free file exactly as it was"]);
});

test("validateRulerRow stops after one failed check when no tick holds the snapshot instant", async () => {
    const page = fakePage([-1]);
    assert.deepEqual(await failuresAddedBy(() => validateRulerRow(page)),
        ["#302 the snapshot's instant has its own expandable tick"]);
});

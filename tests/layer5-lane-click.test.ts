// Capture-free tests for the lane node click checks. A fake page returns canned answers in call order.

import { strict as assert } from "node:assert";
import { test } from "node:test";
import type { HeadlessPage } from "../scripts/visual/cdp.ts";
import { failures } from "../scripts/visual/mockup-checks.ts";
import { buildDotProbe, validateLaneNodeClicks } from "../scripts/visual/layer5-lane-click.ts";

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

const GOOD_FACTS = {
    head: "src/a.ts @v1", meta: "branch revision · session", rows: 2, changedText: 5,
    instant: "2026-01-01T00:00:00.000Z", isShown: true, isInsidePane: true, touchesDrawer: false, drawerOpen: true,
};

test("buildDotProbe filters to the bubble of the given path and picks the dot at the index", () => {
    const probe = buildDotProbe({ path: "src/a.ts", max: 1 }, 3);
    assert.ok(probe.includes(JSON.stringify("src/a.ts")));
    assert.ok(probe.includes("dots[3]"));
});

test("buildDotProbe accepts every bubble when no path is given", () => {
    assert.ok(buildDotProbe({ max: 1 }, 0).includes(".filter((box) => true)"));
});

test("validateLaneNodeClicks passes when each clicked lane node opens a branch revision drawer", async () => {
    const page = fakePage([1, undefined, GOOD_FACTS, -1, undefined]);
    assert.deepEqual(await failuresAddedBy(() => validateLaneNodeClicks(page, "T", { max: 2 })), []);
});

test("validateLaneNodeClicks fails when the node touches the drawer", async () => {
    const page = fakePage([1, undefined, { ...GOOD_FACTS, touchesDrawer: true }, -1, undefined]);
    assert.deepEqual(await failuresAddedBy(() => validateLaneNodeClicks(page, "T", { max: 2 })),
        ["T T lane node 1/1: the node is shown, inside the pane and clear of the drawer"]);
});

test("validateLaneNodeClicks fails when no lane node exists to click", async () => {
    const page = fakePage([-1, undefined]);
    assert.deepEqual(await failuresAddedBy(() => validateLaneNodeClicks(page, "T", { max: 2 })),
        ["T at least one lane node was clicked"]);
});

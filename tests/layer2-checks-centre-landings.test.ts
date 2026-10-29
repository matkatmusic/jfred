// Capture-free tests for the arrow landing centring check. A fake page returns canned answers in call order.

import { strict as assert } from "node:assert";
import { test } from "node:test";
import type { HeadlessPage } from "../scripts/visual/cdp.ts";
import type { CentredView } from "../scripts/visual/layer2-centre-probes.ts";
import { failures } from "../scripts/visual/mockup-checks.ts";
import { isCentredOnFreeAxes, isFree, validateArrowLandings } from "../scripts/visual/layer2-checks-centre-landings.ts";

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

const VIEW: CentredView = {
    node: [150, 150, 250, 250], area: [0, 0, 400, 400], pane: [0, 0, 400, 400], drawer: [400, 0, 600, 400],
    scroll: [100, 100], maxScroll: [500, 500], offset: [0, 0], isInside: true, touchesDrawer: false,
};

test("isFree is true only when the scroll sits away from both ends of the axis", () => {
    assert.equal(isFree(VIEW, 0), true);
    assert.equal(isFree({ ...VIEW, scroll: [0, 100] }, 0), false);
    assert.equal(isFree({ ...VIEW, scroll: [500, 100] }, 0), false);
});

test("isCentredOnFreeAxes ignores a pinned axis but rejects an off-centre free axis", () => {
    assert.equal(isCentredOnFreeAxes(VIEW), true);
    assert.equal(isCentredOnFreeAxes({ ...VIEW, offset: [30, 0] }), false);
    assert.equal(isCentredOnFreeAxes({ ...VIEW, scroll: [0, 100], offset: [30, 0] }), true);
});

test("validateArrowLandings passes when one landing is centred on both free axes", async () => {
    const page = fakePage([undefined, false, undefined, VIEW, true]);
    assert.deepEqual(await failuresAddedBy(() => validateArrowLandings(page)), []);
});

test("validateArrowLandings fails the landed and free-axis checks when the arrow is disabled at once", async () => {
    const page = fakePage([undefined, true]);
    assert.deepEqual(await failuresAddedBy(() => validateArrowLandings(page)), [
        "#drawer-centre the arrow landed at least once",
        "#drawer-centre at least one arrow landing was free on both axes (a true centring, not a clamp)",
    ]);
});

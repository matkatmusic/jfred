// Capture-free test for the Layer 2 centring checks. A fake page returns canned answers in call order.

import { strict as assert } from "node:assert";
import { test } from "node:test";
import type { HeadlessPage } from "../scripts/visual/cdp.ts";
import type { CentredView } from "../scripts/visual/layer2-centre-probes.ts";
import { failures } from "../scripts/visual/mockup-checks.ts";
import { validateCentring } from "../scripts/visual/layer2-checks-centre.ts";

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

test("validateCentring passes the interior and drawer checks and fails the missing edge node and arrow landings", async () => {
    const page = fakePage([true, undefined, VIEW, false, VIEW, undefined, true, undefined]);
    assert.deepEqual(await failuresAddedBy(() => validateCentring(page)), [
        "#drawer-centre a node exists whose centred scroll target is outside the scroll range",
        "#drawer-centre the arrow landed at least once",
        "#drawer-centre at least one arrow landing was free on both axes (a true centring, not a clamp)",
    ]);
});

test("validateCentring fails the drawer check when the uncovered area is not the pane", async () => {
    const overlapped: CentredView = { ...VIEW, area: [0, 0, 300, 400] };
    const page = fakePage([true, undefined, VIEW, false, overlapped, undefined, true, undefined]);
    const added = await failuresAddedBy(() => validateCentring(page));
    assert.ok(added.includes("#drawer-centre the drawer is a flex sibling: it never covers #timelines, so the uncovered area is the pane"));
});

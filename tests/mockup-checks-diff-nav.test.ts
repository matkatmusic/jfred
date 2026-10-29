// Capture-free tests for the nav checks: a fake page answers null, so no nodes exist.

import { strict as assert } from "node:assert";
import { test } from "node:test";
import type { HeadlessPage } from "../scripts/visual/cdp.ts";
import { failures } from "../scripts/visual/mockup-checks.ts";
import { validateCrossBubbleRefusal, validateNavOpensDiskNode } from "../scripts/visual/mockup-checks-diff-nav.ts";

function fakePage(): HeadlessPage {
    const refuse = async () => { throw new Error("the fake page does not do this"); };
    return {
        evaluate: async <T>() => null as T,
        waitFor: refuse,
        navigate: refuse,
        screenshot: refuse,
        close: refuse,
    };
}

test("validateNavOpensDiskNode reports a failure when no file has a created-at node", async () => {
    const before = failures.length;
    await validateNavOpensDiskNode(fakePage());
    const added = failures.slice(before);
    failures.length = before;
    assert.deepEqual(added, ["#325 the fixture has a file with a created-at node to test against"]);
});

test("validateCrossBubbleRefusal skips quietly when there is no second bubble", async () => {
    const before = failures.length;
    await validateCrossBubbleRefusal(fakePage());
    assert.equal(failures.length, before);
});

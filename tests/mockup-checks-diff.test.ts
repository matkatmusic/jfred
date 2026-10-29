// Capture-free tests for the pair checks: a fake page answers null, so no rich bubble exists.

import { strict as assert } from "node:assert";
import { test } from "node:test";
import type { HeadlessPage } from "../scripts/visual/cdp.ts";
import { failures } from "../scripts/visual/mockup-checks.ts";
import { validateDiffPair, validateDiffTools, validatePairArrows } from "../scripts/visual/mockup-checks-diff.ts";

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

test("validateDiffPair reports a failure when no bubble has enough nodes", async () => {
    const before = failures.length;
    await validateDiffPair(fakePage());
    const added = failures.slice(before);
    failures.length = before;
    assert.deepEqual(added, ["#324 the fixture has a bubble with enough nodes to step a pair through"]);
});

test("validatePairArrows and validateDiffTools skip quietly when no bubble is rich", async () => {
    const before = failures.length;
    await validatePairArrows(fakePage());
    await validateDiffTools(fakePage());
    assert.equal(failures.length, before);
});

// Tests for the pure expression builder in scripts/visual/layer3-checks.ts.

import { strict as assert } from "node:assert";
import { test } from "node:test";
import { buildDotFinder } from "../scripts/visual/layer3-checks.ts";

test("buildDotFinder scopes the search to the path's bubble and the dot class", () => {
    const expression = buildDotFinder("src/util.ts", "n-edit");
    assert.ok(expression.includes(`.fname[data-path="src/util.ts"]`));
    assert.ok(expression.includes("i.node.n-edit"));
    assert.ok(expression.includes(".find(d => true)"));
});

test("buildDotFinder carries the caller's filter into find", () => {
    assert.ok(buildDotFinder("a.ts", "n-read", "d.dataset.confidence === 'derived'")
        .includes(".find(d => d.dataset.confidence === 'derived')"));
});

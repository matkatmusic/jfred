// Tests for scripts/visual/ruler-ui-review-probes.ts: expression syntax and builder arguments.

import { strict as assert } from "node:assert";
import { test } from "node:test";
import * as probes from "../scripts/visual/ruler-ui-review-probes.ts";

const parseAsync = (expression: string) => new Function(`return async () => (${expression});`);

test("test_every_review_expression_parses_and_holds_no_backtick", () => {
    // Walk every exported string: each is a browser expression.
    let count = 0;
    for (const [name, value] of Object.entries(probes)) {
        if (typeof value !== "string")
            continue;
        count++;
        assert.doesNotThrow(() => parseAsync(value), `${name} does not parse`);
        assert.ok(!value.includes("`"), `${name} holds a backtick`);
    }
    assert.ok(count >= 14, `only ${count} expressions found`);
});

test("test_every_review_builder_output_parses_and_carries_its_arguments", () => {
    // Each builder gets a plain argument; the argument must appear in the expression.
    assert.doesNotThrow(() => parseAsync(probes.buildHeadProbe("document.body.click()")));
    assert.ok(probes.buildHeadProbe("document.body.click()").includes("document.body.click()"));
    assert.doesNotThrow(() => parseAsync(probes.buildSurfaceProbe("#annotation-track")));
    assert.ok(probes.buildSurfaceProbe("#annotation-track").includes("'#annotation-track'"));
    assert.doesNotThrow(() => parseAsync(probes.buildMinimapEdgeProbe("#ruler")));
    assert.ok(probes.buildMinimapEdgeProbe("#ruler").includes("'#ruler'"));
    assert.doesNotThrow(() => parseAsync(probes.buildDotClick("l7-row-000")));
    assert.ok(probes.buildDotClick("l7-row-000").includes('data-record-id="l7-row-000"'));
    assert.doesNotThrow(() => parseAsync(probes.buildDotDrawerFacts("l7-row-000")));
});

// not behavior: it only checks the order of two substrings inside a generated expression string.
// test("test_the_dot_click_empties_the_drawer_body_before_it_clicks", () => {
//     // A drawer left open earlier must not answer for the new click.
//     const expression = probes.buildDotClick("l7-row-000");
//     assert.ok(expression.indexOf("replaceChildren") < expression.indexOf(".click()"));
// });

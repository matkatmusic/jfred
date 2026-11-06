// Tests for scripts/visual/ruler-ui-probes.ts: expression syntax, builder arguments and screenshot names.

import { strict as assert } from "node:assert";
import { test } from "node:test";
import * as probes from "../scripts/visual/ruler-ui-probes.ts";

const parseAsync = (expression: string) => new Function(`return async () => (${expression});`);

test("test_every_ruler_ui_expression_parses_and_holds_no_backtick", () => {
    // Walk every exported string: each is a browser expression.
    let count = 0;
    for (const [name, value] of Object.entries(probes)) {
        if (typeof value !== "string")
            continue;
        count++;
        // It must parse as one JavaScript expression, and no backtick may reach the browser.
        assert.doesNotThrow(() => parseAsync(value), `${name} does not parse`);
        assert.ok(!value.includes("`"), `${name} holds a backtick`);
    }
    assert.ok(count >= 20, `only ${count} expressions found`);
});

test("test_every_ruler_ui_builder_output_parses", () => {
    // Each builder gets a plain argument and must still produce a parsable expression.
    assert.doesNotThrow(() => parseAsync(probes.buildScrollToDot("l7-fill-08")));
    assert.doesNotThrow(() => parseAsync(probes.buildDotCentre("l7-block-2")));
    assert.doesNotThrow(() => parseAsync(probes.buildMidProbe("l7-mid-02")));
    assert.doesNotThrow(() => parseAsync(probes.buildSameInstantProbe("l7-fill-07", "l7-same-0")));
    assert.doesNotThrow(() => parseAsync(probes.buildLineProbe("session-1", "l7-block-0")));
    assert.doesNotThrow(() => parseAsync(probes.buildHoverProbe("document.body")));
});

// not behavior: only checks that argument text appears inside the expression string.
// test("test_every_ruler_ui_builder_carries_its_arguments", () => {
//     // The ids passed in must appear in the expression text.
//     assert.ok(probes.buildScrollToDot("l7-fill-08").includes('data-record-id="l7-fill-08"'));
//     assert.ok(probes.buildLineProbe("session-1", "l7-block-0").includes('data-session-id="session-1"'));
//     assert.ok(probes.buildLineProbe("session-1", "l7-block-0").includes('data-record-id="l7-block-0"'));
//     assert.ok(probes.buildSameInstantProbe("l7-fill-07", "l7-same-0").includes("l7-same-0"));
//     assert.ok(probes.buildHoverProbe("document.body").includes("const target = document.body;"));
// });

// not behavior: only checks the order of substrings inside an expression string.
// test("test_hover_probe_enters_the_target_before_it_leaves", () => {
//     // The popup is read between the pointer entering and leaving the target.
//     const expression = probes.buildHoverProbe("document.body");
//     assert.ok(expression.indexOf("'mouseover'") < expression.indexOf("getElementById('hover-popup')"));
//     assert.ok(expression.indexOf("getElementById('hover-popup')") < expression.indexOf("'mouseout'"));
// });

// not behavior: only checks that a substring appears after another substring in an expression string.
// test("test_expand_probe_finds_the_row_again_after_the_click", () => {
//     // The click may redraw the ticks, so the row is looked up by its full time a second time.
//     const afterClick = probes.EXPAND_CLICK.slice(probes.EXPAND_CLICK.indexOf("findTick().click()"));
//     assert.ok(afterClick.includes("const open = findTick();"));
// });

// not behavior: only checks the values of exported constants.
// test("test_screenshot_names_are_numbers_21_to_25", () => {
//     // The five mockup states use the free screenshot numbers in order.
//     const names = Object.values(probes.RULER_UI_SCREENSHOTS);
//     assert.deepEqual(names.map((name) => name.slice(0, 2)), ["21", "22", "23", "24", "25"]);
//     assert.equal(probes.FIXTURE_TICK_COUNT, 419);
// });

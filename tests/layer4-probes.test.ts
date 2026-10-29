// Tests for the Layer 4 browser expressions in layer4-probes.ts.

import { strict as assert } from "node:assert";
import { test } from "node:test";
import {
    PYTHON_RUN_ID, SCRIPT_DOTS, COUNT_SCRIPT_DOTS, buildBubblePathExpression, buildRulerMatchProbe, buildToggleProbe,
} from "../scripts/visual/layer4-probes.ts";

test("COUNT_SCRIPT_DOTS counts the script dots selector", () => {
    assert.equal(COUNT_SCRIPT_DOTS, `${SCRIPT_DOTS}.length`);
});

test("buildBubblePathExpression reads the data-path of the dot's bubble", () => {
    const expression = buildBubblePathExpression("d");
    assert.ok(expression.startsWith("d.closest('.filebox')"));
    assert.ok(expression.endsWith("dataset.path"));
});

test("buildRulerMatchProbe passes the dot expression to the probe", () => {
    assert.ok(buildRulerMatchProbe("someDot").endsWith("})(someDot)"));
});

test("buildToggleProbe clicks the script box four times", () => {
    assert.equal(buildToggleProbe().split("box.click()").length - 1, 4);
});

test("PYTHON_RUN_ID is the fixture python run", () => {
    assert.equal(PYTHON_RUN_ID, "toolu_fixture_py_rewrite");
});

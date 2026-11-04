// Task 382: the dashed bracket that joins the two nodes of one tool call.

import { test } from "node:test";
import assert from "node:assert/strict";
import { initLayer1Dom } from "./webapp-dom-test-helpers.ts";

initLayer1Dom();
const { buildPairBracket } = await import("../webapp/layer1-annotation-bracket.ts");

function buildNodeAt(axisPx: number): HTMLElement {
    const node = document.createElement("i");
    node.style.setProperty("--axis-px", String(axisPx));
    return node;
}

test("test_the_bracket_starts_at_the_first_node_and_spans_to_the_second", () => {
    // Scenario: nodes at 40 and 130 give a bracket that starts at 40 and is 90 long.
    const bracket = buildPairBracket(buildNodeAt(40), buildNodeAt(130), "abracket");
    assert.equal(bracket.style.getPropertyValue("--axis-px"), "40");
    assert.equal(bracket.style.getPropertyValue("--span-px"), "90");
});

test("test_the_bracket_takes_the_class_name_it_is_given", () => {
    assert.equal(buildPairBracket(buildNodeAt(1), buildNodeAt(2), "abracket").className, "abracket");
    assert.equal(buildPairBracket(buildNodeAt(1), buildNodeAt(2), "tbracket").className, "tbracket");
});

test("test_the_span_is_never_negative", () => {
    // Scenario: the nodes come in reverse order; the bracket still starts at the upper node.
    const bracket = buildPairBracket(buildNodeAt(130), buildNodeAt(40), "abracket");
    assert.equal(bracket.style.getPropertyValue("--axis-px"), "40");
    assert.equal(bracket.style.getPropertyValue("--span-px"), "90");
});

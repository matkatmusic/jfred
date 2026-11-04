// Tests for scripts/visual/layer7-probes.ts: builder output and browser-expression syntax.

import { strict as assert } from "node:assert";
import { test } from "node:test";
import * as probes from "../scripts/visual/layer7-probes.ts";

const parseExpression = (expression: string) => new Function(`return (${expression});`);

test("buildRecordDot puts the record id inside the node selector", () => {
    const expression = probes.buildRecordDot("l7-block-3");
    assert.ok(expression.includes('i[data-record-id="l7-block-3"]'));
    assert.notEqual(expression, probes.buildRecordDot("l7-block-4"));
});

test("buildScrollTo puts both offsets in the scroll statements", () => {
    const expression = probes.buildScrollTo(120, 400);
    assert.ok(expression.includes("pane.scrollTop = 120"));
    assert.ok(expression.includes("pane.scrollLeft = 400"));
    assert.equal(probes.SCROLL_HOME, probes.buildScrollTo(0, 0));
});

test("buildSetHideIgnored and buildHideSettled carry the wanted state", () => {
    assert.ok(probes.buildSetHideIgnored(false).includes("box.checked !== false"));
    assert.ok(probes.buildSetHideIgnored(true).includes("box.checked !== true"));
    assert.ok(probes.buildHideSettled(true).endsWith("=== true"));
    assert.ok(probes.buildHideSettled(false).endsWith("=== false"));
});

test("buildBracketProbe puts the root and the selector in the query", () => {
    const expression = probes.buildBracketProbe("document", ".abracket[data-pair-id=\"x\"]");
    assert.ok(expression.includes("document.querySelectorAll("));
    assert.ok(expression.includes("data-pair-id"));
});

test("buildKindBoxStates skips the named kind", () => {
    assert.ok(probes.buildKindBoxStates("tool").includes("!== 'tool'"));
    assert.notEqual(probes.buildKindBoxStates("tool"), probes.buildKindBoxStates(""));
});

test("every expression string parses as JavaScript", () => {
    const expressionNames: string[] = [];
    for (const [name, value] of Object.entries(probes)) {
        const isString = typeof value === "string";
        const isId = name.endsWith("_ID");
        if (isString && !isId) {
            expressionNames.push(name);
            assert.doesNotThrow(() => parseExpression(value), `${name} does not parse`);
        }
    }
    assert.ok(expressionNames.length >= 12, `only ${expressionNames.length} expressions found`);
});

test("builder output parses as JavaScript", () => {
    assert.doesNotThrow(() => parseExpression(probes.buildRecordDot("l7-block-0")));
    assert.doesNotThrow(() => parseExpression(probes.buildScrollTo(0, 400)));
    assert.doesNotThrow(() => parseExpression(probes.buildSetHideIgnored(false)));
    assert.doesNotThrow(() => parseExpression(probes.buildBracketProbe(probes.DISPATCHER_BUBBLE, ".tbracket")));
    assert.doesNotThrow(() => parseExpression(probes.buildKindBoxStates("tool")));
});

test("a broken expression is caught by the parse check", () => {
    assert.throws(() => parseExpression("document.querySelector("));
});

test("the two pair ids are distinct toolu_fixture_l7 strings", () => {
    assert.match(probes.COLUMN_PAIR_ID, /^toolu_fixture_l7_/);
    assert.match(probes.BUBBLE_PAIR_ID, /^toolu_fixture_l7_/);
    assert.notEqual(probes.COLUMN_PAIR_ID, probes.BUBBLE_PAIR_ID);
});

test("the margin number reaches the window probe and no probe holds a backtick", () => {
    assert.ok(probes.WINDOW_FACTS.includes("(300 + laneY)"));
    for (const [name, value] of Object.entries(probes)) {
        if (typeof value === "string")
            assert.ok(!value.includes("`"), `${name} holds a backtick`);
    }
});

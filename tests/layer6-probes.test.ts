// Tests for scripts/visual/layer6-probes.ts: builder output and browser-expression syntax.

import { strict as assert } from "node:assert";
import { test } from "node:test";
import * as probes from "../scripts/visual/layer6-probes.ts";

const parseExpression = (expression: string) => new Function(`return (${expression});`);

test("buildNodeExpression puts the tool use id inside the node selector", () => {
    const expression = probes.buildNodeExpression("toolu_abc123");
    assert.ok(expression.includes('data-tool-use-id="toolu_abc123"'));
    assert.ok(expression.startsWith("document.querySelector("));
    assert.notEqual(expression, probes.buildNodeExpression("toolu_other"));
});

test("buildTitleColour puts the terminal class inside the title selector", () => {
    const expression = probes.buildTitleColour("term-ok");
    assert.ok(expression.includes(".term-ok .terminal-title"));
    assert.ok(expression.includes("getComputedStyle"));
    assert.notEqual(expression, probes.buildTitleColour("term-bad"));
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
    assert.ok(expressionNames.length >= 10, `only ${expressionNames.length} expressions found`);
});

test("builder output parses as JavaScript", () => {
    assert.doesNotThrow(() => parseExpression(probes.buildNodeExpression(probes.PENDING_ID)));
    assert.doesNotThrow(() => parseExpression(probes.buildTitleColour("term-ok")));
});

test("a broken expression is caught by the parse check", () => {
    assert.throws(() => parseExpression("document.querySelector("));
});

test("every fixture id is a distinct toolu_fixture_l6 string", () => {
    const ids = new Set<string>();
    let idCount = 0;
    for (const [name, value] of Object.entries(probes)) {
        if (name.endsWith("_ID")) {
            idCount += 1;
            ids.add(String(value));
            assert.match(String(value), /^toolu_fixture_l6_/);
        }
    }
    assert.equal(idCount, 7);
    assert.equal(ids.size, idCount);
});

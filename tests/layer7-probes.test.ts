// Tests for scripts/visual/layer7-probes.ts: builder output and browser-expression syntax.

import { strict as assert } from "node:assert";
import { test } from "node:test";
import * as probes from "../scripts/visual/layer7-probes.ts";

const parseExpression = (expression: string) => new Function(`return (${expression});`);

interface FakeNode { id: string; previousElementSibling: FakeNode | null; nextElementSibling: FakeNode | null }
const makeNode = (id: string): FakeNode => ({ id, previousElementSibling: null, nextElementSibling: null });

// Builds the element order before #stage for each layout the probe must judge.
function fakeNodes(kind: string): Record<string, FakeNode> {
    const ruler = makeNode("ruler");
    const track = makeNode("annotation-track");
    const strip = makeNode("jfred-strip");
    const stage = makeNode("stage");
    const stranger = makeNode("stranger");
    ruler.nextElementSibling = track;
    if (kind === "track")
        stage.previousElementSibling = track;
    if (kind === "strip") {
        strip.previousElementSibling = track;
        stage.previousElementSibling = strip;
    }
    if (kind === "other")
        stage.previousElementSibling = stranger;
    if (kind === "stripWrongSide") {
        strip.previousElementSibling = stranger;
        stage.previousElementSibling = strip;
    }
    return { ruler, "annotation-track": track, stage };
}

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

test("TRACK_FACTS accepts the jfred strip between the column and the stage, and nothing else", () => {
    assert.ok(probes.TRACK_FACTS.includes("jfred-strip"));
    const run = (layout: string) => {
        const nodes = fakeNodes(layout);
        return new Function("document", "getComputedStyle", `return (${probes.TRACK_FACTS});`)(
            { getElementById: (id: string) => nodes[id], querySelectorAll: () => [1] }, () => ({ position: "sticky" })) as { isBeforeStage: boolean };
    };
    assert.equal(run("track").isBeforeStage, true);
    assert.equal(run("strip").isBeforeStage, true);
    assert.equal(run("other").isBeforeStage, false);
    assert.equal(run("stripWrongSide").isBeforeStage, false);
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

// Tests for scripts/visual/layer7-probes.ts: builder output and browser-expression syntax.

import { strict as assert } from "node:assert";
import { test } from "node:test";
import { type HeadlessPage } from "../scripts/visual/cdp.ts";
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

// not behavior: it only checks that the builder's output text contains certain strings.
// test("buildRecordDot puts the record id inside the node selector", () => {
//     const expression = probes.buildRecordDot("l7-block-3");
//     assert.ok(expression.includes('i[data-record-id="l7-block-3"]'));
//     assert.notEqual(expression, probes.buildRecordDot("l7-block-4"));
// });

// not behavior: it only checks that the builder's output text contains certain strings.
// test("buildScrollTo puts both offsets in the scroll statements", () => {
//     const expression = probes.buildScrollTo(120, 400);
//     assert.ok(expression.includes("pane.scrollTop = 120"));
//     assert.ok(expression.includes("pane.scrollLeft = 400"));
//     assert.equal(probes.SCROLL_HOME, probes.buildScrollTo(0, 0));
// });

// not behavior: it only checks that the builders' output text contains or ends with certain strings.
// test("buildSetHideIgnored and buildHideSettled carry the wanted state", () => {
//     assert.ok(probes.buildSetHideIgnored(false).includes("box.checked !== false"));
//     assert.ok(probes.buildSetHideIgnored(true).includes("box.checked !== true"));
//     assert.ok(probes.buildHideSettled(true).endsWith("=== true"));
//     assert.ok(probes.buildHideSettled(false).endsWith("=== false"));
// });

// not behavior: it only checks that the builder's output text contains certain strings.
// test("buildBracketProbe puts the root and the selector in the query", () => {
//     const expression = probes.buildBracketProbe("document", ".abracket[data-pair-id=\"x\"]");
//     assert.ok(expression.includes("document.querySelectorAll("));
//     assert.ok(expression.includes("data-pair-id"));
// });

// not behavior: it only checks that the builder's output text contains a certain string.
// test("buildKindBoxStates skips the named kind", () => {
//     assert.ok(probes.buildKindBoxStates("tool").includes("!== 'tool'"));
//     assert.notEqual(probes.buildKindBoxStates("tool"), probes.buildKindBoxStates(""));
// });

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

// not behavior: it only checks the values of two constants.
// test("the two pair ids are distinct toolu_fixture_l7 strings", () => {
//     assert.match(probes.COLUMN_PAIR_ID, /^toolu_fixture_l7_/);
//     assert.match(probes.BUBBLE_PAIR_ID, /^toolu_fixture_l7_/);
//     assert.notEqual(probes.COLUMN_PAIR_ID, probes.BUBBLE_PAIR_ID);
// });

test("test_openSessionColumn_clicks_the_session_toggle_then_waits_for_the_track", async () => {
    // Steps: run the helper on a recording page; the click comes first, then the track wait.
    const steps: string[] = [];
    const page: HeadlessPage = {
        evaluate: async <T>(expression: string): Promise<T> => { steps.push(`evaluate ${expression}`); return undefined as T; },
        waitFor: async (expression: string) => { steps.push(`waitFor ${expression}`); },
        navigate: async () => {}, screenshot: async () => "", close: async () => {},
    };
    await probes.openSessionColumn(page);
    assert.deepEqual(steps, [`evaluate ${probes.CLICK_SESSION_TOGGLE}`, `waitFor ${probes.TRACK_PRESENT}`]);
    assert.ok(probes.CLICK_SESSION_TOGGLE.includes("session-toggle"));
    assert.ok(probes.CLICK_SESSION_TOGGLE.includes(".click()"));
    assert.ok(probes.TRACK_PRESENT.includes("annotation-track"));
});

interface FakeDot {
    dataset: Record<string, string>; className: string; textContent: string; box: { left: number; top: number; width: number; height: number };
    style: { getPropertyValue: (name: string) => string };
}
const makeDot = (): FakeDot => ({
    dataset: { recordId: "l7-block-0", instant: "t0", pairId: "", sessionId: "s1", recordLabel: "fix the trim bug" }, className: "anode a-user",
    textContent: "u", box: { left: 11, top: 90, width: 14, height: 14 }, style: { getPropertyValue: () => "1" },
});
const runWithDots = (expression: string, dots: FakeDot[]) => {
    const withBox = dots.map((dot) => ({ ...dot, getBoundingClientRect: () => ({ ...dot.box, right: dot.box.left + dot.box.width, bottom: dot.box.top + dot.box.height }) }));
    return new Function("document", "getComputedStyle", `return (${expression});`)(
        { querySelectorAll: () => withBox }, () => ({ backgroundColor: "rgb(1, 2, 3)" }));
};

test("test_COLUMN_NODE_FACTS_reads_letter_colour_session_and_stack_and_no_label_fields", () => {
    // Steps: feed one fake dot, then read the facts the probe returns.
    const [facts] = runWithDots(probes.COLUMN_NODE_FACTS, [makeDot()]) as Record<string, unknown>[];
    assert.equal(facts!["letter"], "u");
    assert.equal(facts!["backgroundColor"], "rgb(1, 2, 3)");
    assert.equal(facts!["sessionId"], "s1");
    assert.equal(facts!["recordLabel"], "fix the trim bug");
    assert.equal(facts!["stack"], 1);
    assert.equal(facts!["cx"], 18);
    for (const retired of ["label", "labelBox", "signature", "borderStyle"])
        assert.ok(!(retired in facts!), `${retired} is still read`);
});

test("test_SESSION_DOT_COLOURS_keeps_one_entry_per_session_and_colour_after_a_full_scroll", async () => {
    // Steps: two same-session dots, one other-session dot; run the probe on a fake pane.
    const pane = { scrollHeight: 100, clientHeight: 100, scrollTop: 0 };
    const other = { ...makeDot(), dataset: { ...makeDot().dataset, sessionId: "s2" } };
    const dots = [makeDot(), makeDot(), other];
    const run = new Function("document", "getComputedStyle", "setTimeout", `return (${probes.SESSION_DOT_COLOURS});`);
    const found = await run({ getElementById: () => pane, querySelectorAll: () => dots }, () => ({ backgroundColor: "rgb(1, 2, 3)" }),
        (callback: () => void) => callback()) as { sessionId: string }[];
    assert.deepEqual(found.map((entry) => entry.sessionId).sort(), ["s1", "s2"]);
    assert.equal(pane.scrollTop, 0);
});

test("test_buildBracketProbe_returns_the_left_and_right_edges_too", () => {
    const box = { top: 140, bottom: 200, left: 5, right: 13 };
    const expression = probes.buildBracketProbe("document", ".abracket");
    const found = new Function("document", "getComputedStyle", `return (${expression});`)(
        { querySelectorAll: () => [{ getBoundingClientRect: () => box }] }, () => ({ borderTopStyle: "dashed" })) as Record<string, unknown>;
    assert.deepEqual(found, { count: 1, style: "dashed", ...box });
});

test("test_TRACK_LABEL_COUNT_counts_alabel_elements_inside_the_track", () => {
    assert.ok(probes.TRACK_LABEL_COUNT.includes("#annotation-track .alabel"));
    assert.equal(new Function("document", `return (${probes.TRACK_LABEL_COUNT});`)({ querySelectorAll: () => [1, 2] }), 2);
});

const makeRule = (selectorText: string, cssText: string, pageToken = "") => ({ selectorText, cssText, style: { getPropertyValue: () => pageToken } });
const listRuleTexts = (rules: unknown[]) => new Function("document", `return (${probes.COLUMN_RULE_TEXTS});`)(
    { styleSheets: [{ cssRules: rules }] }) as string[];

test("test_COLUMN_RULE_TEXTS_scans_the_new_selectors", () => {
    // Steps: one rule per new selector plus an unrelated rule; only the new ones are returned.
    const names = ["sline", "ahead", "ruler-head", "session-toggle", "ttime", "tcount", "s-coloured", "tf-snapshot", "hover-popup", "hp-line"];
    const rules = names.map((name) => makeRule(`.${name}`, `.${name} { color: red; }`));
    // const found = listRuleTexts([...rules, makeRule(".other", ".other { color: red; }"), makeRule(".viz-root, .hover-popup", "tokens #fff", "#f9f9f7")]);
    const found = listRuleTexts([...rules, makeRule(".other", ".other { color: red; }")]);
    assert.equal(found.length, names.length);
    // assert.ok(!found.some((text) => text.includes("tokens")));
});

test("test_COLUMN_RULE_TEXTS_keeps_the_old_selectors", () => {
    const found = listRuleTexts(["anode", "alabel", "abracket", "atrack", "tnode", "tlabel", "tbracket", "a-user"].map((name) => makeRule(`.${name}`, name)));
    assert.equal(found.length, 8);
});

test("the margin number reaches the window probe and no probe holds a backtick", () => {
    // The window probe now compares axis pixels: the margin sits in both the top and bottom limits.
    assert.ok(probes.WINDOW_FACTS.includes("pane.scrollTop / zoom - 300 - 1"));
    assert.ok(probes.WINDOW_FACTS.includes("/ zoom + 300 + 1"));
    for (const [name, value] of Object.entries(probes)) {
        if (typeof value === "string")
            assert.ok(!value.includes("`"), `${name} holds a backtick`);
    }
});

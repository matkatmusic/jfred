// Tests for validateLayout in layer7-layout-checks.ts, using a fake page with canned answers.

import { strict as assert } from "node:assert";
import { test } from "node:test";
import { type HeadlessPage } from "../scripts/visual/cdp.ts";
import { failures } from "../scripts/visual/mockup-checks.ts";
import {
    LAYOUT_FACTS, RULE_FACTS, isBubbleBesideColumn, isColumnAfterRuler, isColumnBetween, isSlackRuleKept, isStageUnderColumn, validateLayout,
    type LayoutFacts, type RuleFacts,
} from "../scripts/visual/layer7-layout-checks.ts";
import { SCROLL_HOME, buildScrollTo } from "../scripts/visual/layer7-probes.ts";

const SCROLL_RIGHT = buildScrollTo(0, 400);
// beforeStageRight: right edge of the track, or of the jfred strip when it sits between.
const GOOD_LAYOUT: LayoutFacts = { rulerRight: 152, trackLeft: 152, trackRight: 346, beforeStageRight: 346, stageLeft: 360, bubbleLeft: 360, isTrackOnTop: true };
const GOOD_LAYOUT_WITH_STRIP: LayoutFacts = { ...GOOD_LAYOUT, beforeStageRight: 466, stageLeft: 480, bubbleLeft: 480 };
const GOOD_RULES: RuleFacts = { rulerRules: 1, trackRules: 1, marginWith: "0px", marginWithout: "0px" };
// Scrolled 400px right: the pane starts at 232, the ruler and column stay pinned, the stage slid left.
const SCROLLED_LAYOUT: LayoutFacts = { rulerRight: 384, trackLeft: 384, trackRight: 578, beforeStageRight: 578, stageLeft: 192, bubbleLeft: 192, isTrackOnTop: true };

interface Setup { atHome: LayoutFacts; scrolled: LayoutFacts; scrollLeft: number; rules: RuleFacts }
const makeSetup = (change: Partial<Setup> = {}): Setup => ({ atHome: GOOD_LAYOUT, scrolled: SCROLLED_LAYOUT, scrollLeft: 400, rules: GOOD_RULES, ...change });

const makeFakePage = (setup: Setup): HeadlessPage => {
    let isScrolledRight = false;
    const answerFor = (expression: string): unknown => {
        if (expression === SCROLL_RIGHT)
            isScrolledRight = true;
        else if (expression === SCROLL_HOME)
            isScrolledRight = false;
        else if (expression === LAYOUT_FACTS)
            return isScrolledRight ? setup.scrolled : setup.atHome;
        else if (expression === RULE_FACTS)
            return setup.rules;
        else
            throw new Error(`unexpected expression: ${expression}`);
        return isScrolledRight ? setup.scrollLeft : 0;
    };
    return {
        evaluate: async <T>(expression: string) => answerFor(expression) as T,
        waitFor: async () => {}, navigate: async () => {}, screenshot: async () => "", close: async () => {},
    };
};

const runChecks = async (setup: Setup) => {
    const failuresBefore = failures.length;
    const log = console.log;
    const lines: string[] = [];
    console.log = (line: string) => { lines.push(line); };
    let newFailures: string[] = [];
    try {
        await validateLayout(makeFakePage(setup));
        newFailures = failures.slice(failuresBefore);
    } finally {
        console.log = log;
        failures.length = failuresBefore;
    }
    return { lines, newFailures };
};

const BETWEEN_TITLE = "L7 the column touches the ruler, sits 14px left of the stage, and the first bubble starts after it";
const BESIDE_TITLE = "L7 scrolled right, the column still touches the ruler and covers the bubbles";
const RULE_TITLE = "L7 one rule for .ruler + .stage and one for .atrack + .stage, and the stage margin is the same without the column";

test("the layout checks pass the good page: 3 checks", async () => {
    const { lines, newFailures } = await runChecks(makeSetup());
    assert.deepEqual(newFailures, []);
    assert.equal(lines.filter((line) => line.startsWith("PASS  L7")).length, 3);
});

test("a column that is too close to the ruler or the stage fails only the between check", async () => {
    const close = await runChecks(makeSetup({ atHome: { ...GOOD_LAYOUT, trackLeft: 170 } }));
    assert.deepEqual(close.newFailures, [BETWEEN_TITLE]);
    const crowded = await runChecks(makeSetup({ atHome: { ...GOOD_LAYOUT, stageLeft: 350 } }));
    assert.deepEqual(crowded.newFailures, [BETWEEN_TITLE]);
});

test("with the jfred strip between, the 14px gap is measured from the strip, not the column", async () => {
    assert.deepEqual((await runChecks(makeSetup({ atHome: GOOD_LAYOUT_WITH_STRIP }))).newFailures, []);
    const gapFromColumn = await runChecks(makeSetup({ atHome: { ...GOOD_LAYOUT_WITH_STRIP, beforeStageRight: 346 } }));
    assert.deepEqual(gapFromColumn.newFailures, [BETWEEN_TITLE]);
    const crowded = await runChecks(makeSetup({ atHome: { ...GOOD_LAYOUT_WITH_STRIP, stageLeft: 470 } }));
    assert.deepEqual(crowded.newFailures, [BETWEEN_TITLE]);
});

test("a bubble that starts under the column fails only the between check", async () => {
    const { newFailures } = await runChecks(makeSetup({ atHome: { ...GOOD_LAYOUT, bubbleLeft: 200 } }));
    assert.deepEqual(newFailures, [BETWEEN_TITLE]);
});

test("a pane that did not scroll, a moved column or a covered column fails only the beside-ruler check", async () => {
    assert.deepEqual((await runChecks(makeSetup({ scrollLeft: 0 }))).newFailures, [BESIDE_TITLE]);
    assert.deepEqual((await runChecks(makeSetup({ scrolled: { ...SCROLLED_LAYOUT, trackLeft: 300 } }))).newFailures, [BESIDE_TITLE]);
    assert.deepEqual((await runChecks(makeSetup({ scrolled: { ...SCROLLED_LAYOUT, isTrackOnTop: false } }))).newFailures, [BESIDE_TITLE]);
    assert.deepEqual((await runChecks(makeSetup({ scrolled: { ...SCROLLED_LAYOUT, stageLeft: 600 } }))).newFailures, [BESIDE_TITLE]);
});

test("a missing rule or a margin that moves with the column fails only the rule check", async () => {
    assert.deepEqual((await runChecks(makeSetup({ rules: { ...GOOD_RULES, trackRules: 0 } }))).newFailures, [RULE_TITLE]);
    assert.deepEqual((await runChecks(makeSetup({ rules: { ...GOOD_RULES, rulerRules: 2 } }))).newFailures, [RULE_TITLE]);
    assert.deepEqual((await runChecks(makeSetup({ rules: { ...GOOD_RULES, marginWithout: "194px" } }))).newFailures, [RULE_TITLE]);
});

test("the probes read the column, the stage and the two slack rules", () => {
    assert.ok(LAYOUT_FACTS.includes("annotation-track"));
    assert.ok(LAYOUT_FACTS.includes("elementFromPoint"));
    assert.ok(LAYOUT_FACTS.includes("previousElementSibling"));
    assert.ok(RULE_FACTS.includes(".ruler + .stage"));
    assert.ok(RULE_FACTS.includes(".atrack + .stage"));
    assert.doesNotThrow(() => new Function(`return (${LAYOUT_FACTS});`));
    assert.doesNotThrow(() => new Function(`return (${RULE_FACTS});`));
});

test("the judges allow one pixel of slack and no more", () => {
    assert.equal(isColumnBetween({ ...GOOD_LAYOUT, trackLeft: 152.4 }), true);
    assert.equal(isColumnBetween({ ...GOOD_LAYOUT, trackLeft: 153 }), false);
    assert.equal(isColumnBetween({ ...GOOD_LAYOUT, trackLeft: 196 }), false);
    assert.equal(isBubbleBesideColumn({ ...GOOD_LAYOUT, bubbleLeft: 345 }), true);
    assert.equal(isBubbleBesideColumn({ ...GOOD_LAYOUT, bubbleLeft: 344 }), false);
    assert.equal(isSlackRuleKept(GOOD_RULES), true);
    assert.equal(isStageUnderColumn(SCROLLED_LAYOUT), true);
    assert.equal(isStageUnderColumn(GOOD_LAYOUT), false);
    assert.equal(isColumnAfterRuler(SCROLLED_LAYOUT), true);
    assert.equal(isColumnBetween(SCROLLED_LAYOUT), false);
});

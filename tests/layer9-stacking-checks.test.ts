// Tests for layer9-stacking-checks.ts: the line-behind-dot judge and its check, with a fake page of canned facts.

import { strict as assert } from "node:assert";
import { test } from "node:test";
import { STACKING_FACTS, isLineBehindDot, validateLineBehindDot, type StackingFacts } from "../scripts/visual/layer9-stacking-checks.ts";
import { makeScriptedPage, runCheck } from "./layer9-fake-page.ts";

const GOOD: StackingFacts = {
    trackZ: 8, stripZ: 7, dotBackground: "rgb(80, 160, 230)", isBarOnTop: true,
    line: { left: 385, right: 507, top: 300, bottom: 301 }, dot: { left: 392, right: 403, top: 294, bottom: 306 },
};
const TITLE = "L9 the dashed line runs behind the dots: column above the strip, opaque dot, line crosses a dot, bar still on top";

const runPage = async (facts: StackingFacts) => (await runCheck(() => validateLineBehindDot(makeScriptedPage(new Map([[STACKING_FACTS, [facts]]]))))).newFailures;

test("the judge passes the good facts", () => {
    assert.equal(isLineBehindDot(GOOD), true);
});

test("test_line_behind_dot_needs_column_above_strip_opaque_dot_crossing_line_and_bar_on_top", () => {
    // Setup: track z 8, strip z 7, opaque dot crossed by the line, bar on top.
    assert.equal(isLineBehindDot({ ...GOOD, trackZ: 7 }), false);
    assert.equal(isLineBehindDot({ ...GOOD, trackZ: Number.NaN }), false);
    // A clear or empty dot background fails.
    assert.equal(isLineBehindDot({ ...GOOD, dotBackground: "rgba(0, 0, 0, 0)" }), false);
    assert.equal(isLineBehindDot({ ...GOOD, dotBackground: "" }), false);
    // A line that misses the dot rectangle, or no line or dot at all, fails.
    assert.equal(isLineBehindDot({ ...GOOD, line: { left: 385, right: 507, top: 320, bottom: 321 } }), false);
    assert.equal(isLineBehindDot({ ...GOOD, line: null }), false);
    assert.equal(isLineBehindDot({ ...GOOD, dot: null }), false);
    // A bar that something covers fails.
    assert.equal(isLineBehindDot({ ...GOOD, isBarOnTop: false }), false);
});

test("the probe reads the dots of the track, not the old labels, and keeps the bar hit test", () => {
    assert.ok(STACKING_FACTS.includes("#annotation-track i.anode"));
    assert.ok(!STACKING_FACTS.includes("alabel"));
    assert.ok(STACKING_FACTS.includes("elementFromPoint"));
});

test("the check passes the good page and fails the old stacking", async () => {
    assert.deepEqual(await runPage(GOOD), []);
    assert.deepEqual(await runPage({ ...GOOD, trackZ: 7, dotBackground: "rgba(0, 0, 0, 0)" }), [TITLE]);
});

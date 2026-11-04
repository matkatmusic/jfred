// Tests for layer9-stacking-checks.ts: the line-behind-text judge and its check, with a fake page of canned facts.

import { strict as assert } from "node:assert";
import { test } from "node:test";
import { STACKING_FACTS, isLineBehindText, validateLineBehindText, type StackingFacts } from "../scripts/visual/layer9-stacking-checks.ts";
import { makeScriptedPage, runCheck } from "./layer9-fake-page.ts";

const GOOD: StackingFacts = {
    trackZ: 8, stripZ: 7, labelBackground: "rgb(255, 255, 255)", isBarOnTop: true,
    line: { left: 384, right: 596, top: 300, bottom: 301 }, label: { left: 478, right: 560, top: 294, bottom: 306 },
};
const TITLE = "L9 the dashed line runs behind the session text: column above the strip, opaque label, line crosses it, bar still on top";

const runPage = async (facts: StackingFacts) => (await runCheck(() => validateLineBehindText(makeScriptedPage(new Map([[STACKING_FACTS, [facts]]]))))).newFailures;

test("the judge passes the good facts", () => {
    assert.equal(isLineBehindText(GOOD), true);
});

test("a column at or below the strip, a clear label, a missed line or a covered bar each fail the judge", () => {
    assert.equal(isLineBehindText({ ...GOOD, trackZ: 7 }), false);
    assert.equal(isLineBehindText({ ...GOOD, trackZ: Number.NaN }), false);
    assert.equal(isLineBehindText({ ...GOOD, labelBackground: "rgba(0, 0, 0, 0)" }), false);
    assert.equal(isLineBehindText({ ...GOOD, labelBackground: "" }), false);
    assert.equal(isLineBehindText({ ...GOOD, line: { left: 384, right: 596, top: 320, bottom: 321 } }), false);
    assert.equal(isLineBehindText({ ...GOOD, line: null }), false);
    assert.equal(isLineBehindText({ ...GOOD, isBarOnTop: false }), false);
});

test("the check passes the good page and fails the old stacking", async () => {
    assert.deepEqual(await runPage(GOOD), []);
    assert.deepEqual(await runPage({ ...GOOD, trackZ: 7, labelBackground: "rgba(0, 0, 0, 0)" }), [TITLE]);
});

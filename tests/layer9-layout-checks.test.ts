// Tests for layer9-layout-checks.ts: the strip layout and no-overlap judges, with a fake page of canned facts.

import { strict as assert } from "node:assert";
import { test } from "node:test";
import {
    isEntryLevelWithTick, isLabelClear, isLineRight, isStripBesideColumn, isStripContentInside, isStripPinned, validateSlack, validateStripLayout,
    validateStripOverlaps, validateTokens, type OverlapFacts, type SlackFacts, type StripLayoutFacts,
} from "../scripts/visual/layer9-layout-checks.ts";
import { SCROLL_HOME, buildScrollTo } from "../scripts/visual/layer7-probes.ts";
import { CUT_RULE_TEXTS, ENTRY_FACTS, OVERLAP_FACTS, SLACK_FACTS, STRIP_LAYOUT_FACTS, type EntryFacts } from "../scripts/visual/layer9-probes.ts";
import { makeScriptedPage, runCheck, type Answers } from "./layer9-fake-page.ts";

const HOME: StripLayoutFacts = { stripLeft: 578, stripRight: 698, trackLeft: 384, trackRight: 578, rulerRight: 384, paneLeft: 232, position: "sticky", firstBoxLeft: 712 };
// Scrolled 400px right: the strip stays put and the first bubble slides under it.
const SCROLLED: StripLayoutFacts = { ...HOME, firstBoxLeft: 312 };
const makeEntry = (kind: string, cy: number, tickCy: number): EntryFacts => ({ kind, shortHash: "c0ffee01", parentHash: null, instant: "2026-06-01T09:00:00.000Z", cx: 650, cy, tickCy });
const HOME_ENTRIES = [makeEntry("base", 300, 300), makeEntry("commit", 400, 400)];
const SCROLLED_ENTRIES = [makeEntry("base", -300, -300), makeEntry("commit", -200, -200)];
const GOOD_OVERLAP: OverlapFacts = {
    strip: { left: 578, right: 698, top: 100, bottom: 9000 }, track: { left: 384, right: 578, top: 100, bottom: 9000 },
    labels: [{ left: 608, right: 680, top: 290, bottom: 302 }, { left: 608, right: 660, top: 390, bottom: 402 }],
    button: { left: 580, right: 650, top: 110, bottom: 135, isClipped: false },
    lines: [{ left: 384, right: 596, top: 300, bottom: 301, nodeCx: 596 }, { left: 384, right: 596, top: 400, bottom: 401, nodeCx: 596.5 }],
};

interface Setup { home: StripLayoutFacts; scrolled: StripLayoutFacts; scrollLeft: number; homeEntries: EntryFacts[]; scrolledEntries: EntryFacts[] }
const makeSetup = (change: Partial<Setup> = {}): Setup => ({ home: HOME, scrolled: SCROLLED, scrollLeft: 400, homeEntries: HOME_ENTRIES, scrolledEntries: SCROLLED_ENTRIES, ...change });
const buildAnswers = (setup: Setup): Answers => new Map<string, unknown[]>([
    [STRIP_LAYOUT_FACTS, [setup.home, setup.scrolled]], [buildScrollTo(0, 400), [setup.scrollLeft]],
    [ENTRY_FACTS, [setup.homeEntries, setup.scrolledEntries]], [SCROLL_HOME, [0]],
]);

const SIDE_TITLE = "L9 the strip touches the session column, the column touches the ruler, and the strip is sticky";
const PINNED_TITLE = "L9 scrolled right, the strip stays pinned beside the column and the bubbles slide under it";
const LEVEL_TITLE = "L9 scrolled down 600px, every strip node still shares a centre line with its ruler tick";
const CLEAR_TITLE = "L9 no two strip labels overlap, and no label reaches into the session column";
const INSIDE_TITLE = "L9 every strip label and the Delete button lie inside the strip, and the button text is not clipped";
const LINE_TITLE = "L9 each dashed line is thin, starts at the column's left edge and ends at its node";

test("the layout checks pass the good page: 3 checks", async () => {
    const { newFailures, lines } = await runCheck(() => validateStripLayout(makeScriptedPage(buildAnswers(makeSetup()))));
    assert.deepEqual(newFailures, []);
    assert.equal(lines.filter((line) => line.startsWith("PASS  L9")).length, 3);
});

test("a gap, a ruler gap or a non-sticky strip fails only the beside-column check", async () => {
    const run = async (change: Partial<StripLayoutFacts>) => (await runCheck(() => validateStripLayout(makeScriptedPage(buildAnswers(makeSetup({
        home: { ...HOME, ...change }, scrolled: { ...SCROLLED, ...change } })))))).newFailures;
    assert.deepEqual(await run({ stripLeft: 580 }), [SIDE_TITLE]);
    assert.deepEqual(await run({ rulerRight: 380 }), [SIDE_TITLE]);
    assert.deepEqual(await run({ position: "static" }), [SIDE_TITLE]);
});

test("a pane that did not scroll, a moved strip or a bubble still beside it fails only the pinned check", async () => {
    const run = async (change: Partial<Setup>) => (await runCheck(() => validateStripLayout(makeScriptedPage(buildAnswers(makeSetup(change)))))).newFailures;
    assert.deepEqual(await run({ scrollLeft: 0 }), [PINNED_TITLE]);
    assert.deepEqual(await run({ scrolled: { ...SCROLLED, stripLeft: 800 } }), [PINNED_TITLE]);
    assert.deepEqual(await run({ scrolled: { ...SCROLLED, firstBoxLeft: 720 } }), [PINNED_TITLE]);
});

test("a node off its tick, or entries that did not scroll with the ruler, fail only the level check", async () => {
    const run = async (change: Partial<Setup>) => (await runCheck(() => validateStripLayout(makeScriptedPage(buildAnswers(makeSetup(change)))))).newFailures;
    assert.deepEqual(await run({ scrolledEntries: [makeEntry("base", -300, -296), makeEntry("commit", -200, -200)] }), [LEVEL_TITLE]);
    assert.deepEqual(await run({ scrolledEntries: HOME_ENTRIES }), [LEVEL_TITLE]);
    assert.deepEqual(await run({ scrolledEntries: [] }), [LEVEL_TITLE]);
});

test("the level judge allows one pixel and needs a matching tick", () => {
    assert.equal(isEntryLevelWithTick([makeEntry("base", 300, 300.9)]), true);
    assert.equal(isEntryLevelWithTick([makeEntry("base", 300, 302)]), false);
    assert.equal(isEntryLevelWithTick([makeEntry("base", 300, -1)]), false);
    assert.equal(isEntryLevelWithTick([]), false);
});

test("the strip judges take half a pixel and no more", () => {
    assert.equal(isStripBesideColumn({ ...HOME, stripLeft: 578.4 }), true);
    assert.equal(isStripBesideColumn({ ...HOME, stripLeft: 579 }), false);
    assert.equal(isStripPinned(HOME, SCROLLED, 400), true);
    assert.equal(isStripPinned(HOME, { ...SCROLLED, stripLeft: 577 }, 400), false);
});

const runOverlaps = async (facts: OverlapFacts) => (await runCheck(() => validateStripOverlaps(makeScriptedPage(new Map([[OVERLAP_FACTS, [facts]], [SCROLL_HOME, [0]]]))))).newFailures;

test("the overlap checks pass the good page", async () => {
    assert.deepEqual(await runOverlaps(GOOD_OVERLAP), []);
});

test("two labels that intersect, or a label inside the column, fail only the clear check", async () => {
    const overlapping = [GOOD_OVERLAP.labels[0]!, { left: 640, right: 690, top: 295, bottom: 307 }];
    assert.deepEqual(await runOverlaps({ ...GOOD_OVERLAP, labels: overlapping }), [CLEAR_TITLE]);
    const inColumn = await runOverlaps({ ...GOOD_OVERLAP, labels: [{ left: 570, right: 640, top: 290, bottom: 302 }] });
    assert.deepEqual(inColumn, [CLEAR_TITLE, INSIDE_TITLE]);
});

test("a label past the strip, a button past the strip or a clipped button fails only the inside check", async () => {
    assert.deepEqual(await runOverlaps({ ...GOOD_OVERLAP, labels: [{ left: 608, right: 720, top: 290, bottom: 302 }] }), [INSIDE_TITLE]);
    assert.deepEqual(await runOverlaps({ ...GOOD_OVERLAP, button: { ...GOOD_OVERLAP.button, right: 702 } }), [INSIDE_TITLE]);
    assert.deepEqual(await runOverlaps({ ...GOOD_OVERLAP, button: { ...GOOD_OVERLAP.button, isClipped: true } }), [INSIDE_TITLE]);
});

test("a thick line, a line that starts inside the column, or one that misses its node fails only the line check", async () => {
    const line = GOOD_OVERLAP.lines[0]!;
    assert.deepEqual(await runOverlaps({ ...GOOD_OVERLAP, lines: [{ ...line, bottom: 304 }] }), [LINE_TITLE]);
    assert.deepEqual(await runOverlaps({ ...GOOD_OVERLAP, lines: [{ ...line, left: 400 }] }), [LINE_TITLE]);
    assert.deepEqual(await runOverlaps({ ...GOOD_OVERLAP, lines: [{ ...line, nodeCx: 610 }] }), [LINE_TITLE]);
    assert.deepEqual(await runOverlaps({ ...GOOD_OVERLAP, lines: [] }), [LINE_TITLE]);
});

test("validateSlack needs one strip rule and an unchanged stage margin", async () => {
    const run = (facts: SlackFacts) => runCheck(() => validateSlack(makeScriptedPage(new Map([[SLACK_FACTS, [facts]]])))).then((result) => result.newFailures);
    const good = { stripRules: 1, marginWith: "0px", marginWithout: "0px" };
    assert.deepEqual(await run(good), []);
    assert.equal((await run({ ...good, stripRules: 0 })).length, 1);
    assert.equal((await run({ ...good, marginWithout: "120px" })).length, 1);
});

test("validateTokens fails on a colour literal or on no rules at all", async () => {
    const run = (texts: string[]) => runCheck(() => validateTokens(makeScriptedPage(new Map([[CUT_RULE_TEXTS, [texts]]])))).then((result) => result.newFailures);
    assert.deepEqual(await run(["color: var(--ink);"]), []);
    assert.equal((await run(["color: #fff;"])).length, 1);
    assert.equal((await run(["background: rgb(0, 0, 0);"])).length, 1);
    assert.equal((await run([])).length, 1);
});

test("the pure overlap judges agree with the checks", () => {
    assert.equal(isLabelClear(GOOD_OVERLAP), true);
    assert.equal(isStripContentInside(GOOD_OVERLAP), true);
    assert.equal(isLineRight(GOOD_OVERLAP), true);
    assert.equal(isLabelClear({ ...GOOD_OVERLAP, labels: [] }), false);
});

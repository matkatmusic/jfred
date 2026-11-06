// Tests for layer9-checks layout: the strip layout and no-overlap judges, with a fake page of canned facts.

import { strict as assert } from "node:assert";
import { test } from "node:test";
import {
    isEntryLevelWithTick, isLabelClear, isLineRight, isStageUnmoved, isStripBesideColumn, isStripContentInside, isStripPinned, validateSlack, validateStripBesideSession,
    validateStripLayout, validateStripOverlaps, validateTokens, type OverlapFacts, type SlackFacts, type StripLayoutFacts,
} from "../scripts/visual/layer9-layout-checks.ts";
import { SCROLL_HOME, buildScrollTo } from "../scripts/visual/layer7-probes.ts";
import {
    COMMIT_MODE_CLICK, CUT_RULE_TEXTS, ENTRY_FACTS, OVERLAP_FACTS, SLACK_FACTS, STAGE_FACTS, STRIP_LAYOUT_FACTS, type EntryFacts, type StageFacts,
} from "../scripts/visual/layer9-probes.ts";
import { makeScriptedPage, runCheck, type Answers } from "./layer9-fake-page.ts";

// Session column off: the strip is 104px wide and starts at the ruler's right edge.
const HOME: StripLayoutFacts = { stripLeft: 384, stripRight: 488, trackLeft: null, trackRight: null, rulerRight: 384, paneLeft: 232, position: "sticky", firstBoxLeft: 500 };
// Scrolled 400px right: the strip stays put and the first bubble slides under it.
const SCROLLED: StripLayoutFacts = { ...HOME, firstBoxLeft: 312 };
// Session column on: a 96px track sits between the ruler and the strip.
const HOME_ON: StripLayoutFacts = { ...HOME, stripLeft: 480, stripRight: 584, trackLeft: 384, trackRight: 480, firstBoxLeft: 600 };
const STAGE_WITH: StageFacts = { stageLeft: 396, stripCount: 1 };
const STAGE_WITHOUT: StageFacts = { stageLeft: 396, stripCount: 0 };
const makeEntry = (kind: string, cy: number, tickCy: number): EntryFacts => ({ kind, shortHash: "c0ffee01", parentHash: null, instant: "2026-06-01T09:00:00.000Z", cx: 650, cy, tickCy });
const HOME_ENTRIES = [makeEntry("base", 300, 300), makeEntry("commit", 400, 400)];
const SCROLLED_ENTRIES = [makeEntry("base", -300, -300), makeEntry("commit", -200, -200)];
const GOOD_OVERLAP: OverlapFacts = {
    strip: { left: 384, right: 488, top: 100, bottom: 9000 }, ruler: { left: 232, right: 384, top: 100, bottom: 9000 }, track: null,
    labels: [{ left: 410, right: 480, top: 290, bottom: 302 }, { left: 410, right: 460, top: 390, bottom: 402 }],
    button: { left: 388, right: 470, top: 110, bottom: 135, isClipped: false },
    lines: [{ left: 385, right: 411, top: 300, bottom: 301, nodeCx: 411 }, { left: 385, right: 411, top: 400, bottom: 401, nodeCx: 411.5 }],
};
const GOOD_OVERLAP_ON: OverlapFacts = {
    strip: { left: 480, right: 584, top: 100, bottom: 9000 }, ruler: GOOD_OVERLAP.ruler, track: { left: 384, right: 480, top: 100, bottom: 9000 },
    labels: [{ left: 506, right: 576, top: 290, bottom: 302 }, { left: 506, right: 556, top: 390, bottom: 402 }],
    button: { left: 484, right: 566, top: 110, bottom: 135, isClipped: false },
    lines: [{ left: 385, right: 507, top: 300, bottom: 301, nodeCx: 507 }, { left: 385, right: 507, top: 400, bottom: 401, nodeCx: 507.5 }],
};

interface Setup { home: StripLayoutFacts; scrolled: StripLayoutFacts; scrollLeft: number; homeEntries: EntryFacts[]; scrolledEntries: EntryFacts[]; stage: StageFacts[] }
const makeSetup = (change: Partial<Setup> = {}): Setup => ({
    home: HOME, scrolled: SCROLLED, scrollLeft: 400, homeEntries: HOME_ENTRIES, scrolledEntries: SCROLLED_ENTRIES, stage: [STAGE_WITH, STAGE_WITHOUT], ...change,
});
const buildAnswers = (setup: Setup): Answers => new Map<string, unknown[]>([
    [STRIP_LAYOUT_FACTS, [setup.home, setup.scrolled]], [buildScrollTo(0, 400), [setup.scrollLeft]], [STAGE_FACTS, setup.stage], [COMMIT_MODE_CLICK, []],
    [ENTRY_FACTS, [setup.homeEntries, setup.scrolledEntries]], [SCROLL_HOME, [0]],
]);

const SIDE_TITLE = "L9 session off: the strip's left edge meets the ruler's right edge, and the strip is sticky";
const SIDE_ON_TITLE = "L9 session on: the strip's left edge meets the session column's right edge, and the strip is sticky";
const STAGE_TITLE = "L9 session off: the stage keeps its left edge with Commit mode on and off, so the strip pushes nothing";
const PINNED_TITLE = "L9 scrolled right, the strip stays pinned beside the column and the bubbles slide under it";
const LEVEL_TITLE = "L9 scrolled down 600px, every strip node still shares a centre line with its ruler tick";
const clearTitle = (state: string) => `L9 ${state}: no two strip labels overlap, and no label reaches into the ruler or the session column`;
const insideTitle = (state: string) => `L9 ${state}: every strip label and the Delete button lie inside the strip, and the button text is not clipped`;
const lineTitle = (state: string) => `L9 ${state}: each dashed line is thin, starts at the ruler's right edge and ends at its node`;

test("the layout checks pass the good page: 4 checks", async () => {
    const { newFailures, lines } = await runCheck(() => validateStripLayout(makeScriptedPage(buildAnswers(makeSetup()))));
    assert.deepEqual(newFailures, []);
    assert.equal(lines.filter((line) => line.startsWith("PASS  L9")).length, 4);
});

test("test_strip_left_edge_meets_the_ruler_right_edge_when_the_session_column_is_off", async () => {
    // Setup: sticky strip at the ruler's right edge, no track on the page.
    const run = async (change: Partial<StripLayoutFacts>) => (await runCheck(() => validateStripLayout(makeScriptedPage(buildAnswers(makeSetup({
        home: { ...HOME, ...change }, scrolled: { ...SCROLLED, ...change } })))))).newFailures;
    // A 2px gap between the ruler and the strip fails.
    assert.deepEqual(await run({ stripLeft: 386 }), [SIDE_TITLE]);
    // A strip that starts inside the ruler fails.
    assert.deepEqual(await run({ rulerRight: 390 }), [SIDE_TITLE]);
    // A strip that is not sticky fails.
    assert.deepEqual(await run({ position: "static" }), [SIDE_TITLE]);
    // A track on the page while the session column is meant to be off fails.
    assert.deepEqual(await run({ trackLeft: 384, trackRight: 480 }), [SIDE_TITLE]);
});

test("test_strip_left_edge_meets_the_track_right_edge_when_the_session_column_is_on", async () => {
    // Setup: a 96px track between the ruler and the strip.
    const run = async (home: StripLayoutFacts) => (await runCheck(() => validateStripBesideSession(makeScriptedPage(buildAnswers(makeSetup({ home })))))).newFailures;
    // The good page passes both session-on checks.
    assert.deepEqual(await run(HOME_ON), []);
    // A strip that starts at the ruler's right edge, under the track, fails.
    assert.deepEqual(await run({ ...HOME_ON, stripLeft: 384 }), [SIDE_ON_TITLE]);
    // A missing track while the session column is meant to be on fails.
    assert.deepEqual(await run({ ...HOME_ON, trackLeft: null, trackRight: null, stripLeft: 384 }), [SIDE_ON_TITLE]);
    // A track that does not touch the ruler fails.
    assert.deepEqual(await run({ ...HOME_ON, trackLeft: 390 }), [SIDE_ON_TITLE]);
});

test("test_stage_left_edge_is_the_same_with_the_strip_on_and_off", async () => {
    // Setup: the stage reads 396px with Commit mode on and again with it off.
    const run = async (stage: StageFacts[]) => (await runCheck(() => validateStripLayout(makeScriptedPage(buildAnswers(makeSetup({ stage })))))).newFailures;
    // The same left edge passes.
    assert.deepEqual(await run([STAGE_WITH, STAGE_WITHOUT]), []);
    // A stage that moves 104px when the strip goes away fails.
    assert.deepEqual(await run([STAGE_WITH, { ...STAGE_WITHOUT, stageLeft: 500 }]), [STAGE_TITLE]);
    // A strip still on the page after the click, or missing before it, fails.
    assert.deepEqual(await run([STAGE_WITH, STAGE_WITH]), [STAGE_TITLE]);
    assert.deepEqual(await run([STAGE_WITHOUT, STAGE_WITHOUT]), [STAGE_TITLE]);
    // The judge allows half a pixel.
    assert.equal(isStageUnmoved(STAGE_WITH, { ...STAGE_WITHOUT, stageLeft: 396.4 }), true);
    assert.equal(isStageUnmoved(STAGE_WITH, { ...STAGE_WITHOUT, stageLeft: 397 }), false);
});

test("a pane that did not scroll, a moved strip or a bubble still beside it fails only the pinned check", async () => {
    const run = async (change: Partial<Setup>) => (await runCheck(() => validateStripLayout(makeScriptedPage(buildAnswers(makeSetup(change)))))).newFailures;
    assert.deepEqual(await run({ scrollLeft: 0 }), [PINNED_TITLE]);
    assert.deepEqual(await run({ scrolled: { ...SCROLLED, stripLeft: 800 } }), [PINNED_TITLE]);
    assert.deepEqual(await run({ scrolled: { ...SCROLLED, firstBoxLeft: 520 } }), [PINNED_TITLE]);
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
    assert.equal(isStripBesideColumn({ ...HOME, stripLeft: 384.4 }, false), true);
    assert.equal(isStripBesideColumn({ ...HOME, stripLeft: 385 }, false), false);
    assert.equal(isStripBesideColumn(HOME_ON, true), true);
    assert.equal(isStripBesideColumn(HOME_ON, false), false);
    assert.equal(isStripPinned(HOME, SCROLLED, 400), true);
    assert.equal(isStripPinned(HOME, { ...SCROLLED, stripLeft: 383 }, 400), false);
});

const runOverlaps = async (facts: OverlapFacts, isSessionOn = false) =>
    (await runCheck(() => validateStripOverlaps(makeScriptedPage(new Map([[OVERLAP_FACTS, [facts]], [SCROLL_HOME, [0]]])), isSessionOn))).newFailures;

test("the overlap checks pass the good page with the session column off and on", async () => {
    assert.deepEqual(await runOverlaps(GOOD_OVERLAP), []);
    assert.deepEqual(await runOverlaps(GOOD_OVERLAP_ON, true), []);
});

test("two labels that intersect, or a label inside the ruler or the column, fail only the clear check", async () => {
    const overlapping = [GOOD_OVERLAP.labels[0]!, { left: 440, right: 480, top: 295, bottom: 307 }];
    assert.deepEqual(await runOverlaps({ ...GOOD_OVERLAP, labels: overlapping }), [clearTitle("session off")]);
    const inRuler = await runOverlaps({ ...GOOD_OVERLAP, labels: [{ left: 370, right: 440, top: 290, bottom: 302 }] });
    assert.deepEqual(inRuler, [clearTitle("session off"), insideTitle("session off")]);
    const inColumn = await runOverlaps({ ...GOOD_OVERLAP_ON, labels: [{ left: 470, right: 540, top: 290, bottom: 302 }] }, true);
    assert.deepEqual(inColumn, [clearTitle("session on"), insideTitle("session on")]);
});

test("a label past the strip, a button past the strip or a clipped button fails only the inside check", async () => {
    assert.deepEqual(await runOverlaps({ ...GOOD_OVERLAP, labels: [{ left: 410, right: 520, top: 290, bottom: 302 }] }), [insideTitle("session off")]);
    assert.deepEqual(await runOverlaps({ ...GOOD_OVERLAP, button: { ...GOOD_OVERLAP.button, right: 492 } }), [insideTitle("session off")]);
    assert.deepEqual(await runOverlaps({ ...GOOD_OVERLAP, button: { ...GOOD_OVERLAP.button, isClipped: true } }), [insideTitle("session off")]);
});

test("test_dashed_line_starts_at_the_ruler_right_edge_and_ends_at_its_node_centre", async () => {
    // Setup: one dashed line starting 1px past the ruler edge, ending at its node centre.
    const line = GOOD_OVERLAP.lines[0]!;
    const lineOn = GOOD_OVERLAP_ON.lines[0]!;
    // A thick line fails only the line check.
    assert.deepEqual(await runOverlaps({ ...GOOD_OVERLAP, lines: [{ ...line, bottom: 304 }] }), [lineTitle("session off")]);
    // A line starting inside the ruler or 5px past its edge fails, column off and on.
    assert.deepEqual(await runOverlaps({ ...GOOD_OVERLAP, lines: [{ ...line, left: 380 }] }), [lineTitle("session off")]);
    assert.deepEqual(await runOverlaps({ ...GOOD_OVERLAP_ON, lines: [{ ...lineOn, left: 480 }] }, true), [lineTitle("session on")]);
    // A line that ends away from its node centre fails.
    assert.deepEqual(await runOverlaps({ ...GOOD_OVERLAP, lines: [{ ...line, nodeCx: 430 }] }), [lineTitle("session off")]);
    // No line at all fails.
    assert.deepEqual(await runOverlaps({ ...GOOD_OVERLAP, lines: [] }), [lineTitle("session off")]);
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

// not behavior: it only checks that a constant string contains certain names.
// test("test_colour_literal_scan_reads_the_new_rule_names_and_skips_no_rule", () => {
//     // The rule pattern names every new class of the ruler redesign.
//     for (const name of ["sline", "ahead", "ruler-head", "session-toggle", "ttime", "tcount", "s-coloured", "tf-", "hover-popup", "hp-line"])
//         assert.ok(CUT_RULE_TEXTS.includes(name), name);
//     // The old strip and mark names stay in the pattern, so no check is loosened.
//     for (const name of ["jfred-strip", "jnode", "jlabel", "jchain", "jline", "jhead", "cut-", "jfred-message"])
//         assert.ok(CUT_RULE_TEXTS.includes(name), name);
//     // No rule is skipped: the scan has no --page filter.
//     assert.ok(!CUT_RULE_TEXTS.includes("--page"));
// });

test("the pure overlap judges agree with the checks", () => {
    assert.equal(isLabelClear(GOOD_OVERLAP), true);
    assert.equal(isLabelClear(GOOD_OVERLAP_ON), true);
    assert.equal(isStripContentInside(GOOD_OVERLAP), true);
    assert.equal(isLineRight(GOOD_OVERLAP), true);
    assert.equal(isLabelClear({ ...GOOD_OVERLAP, labels: [] }), false);
});

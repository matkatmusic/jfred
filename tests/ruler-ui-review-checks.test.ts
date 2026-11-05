// Tests for scripts/visual/ruler-ui-review-checks.ts: the judges, then validateRulerReview on a fake page with canned answers.

import { strict as assert } from "node:assert";
import { test } from "node:test";
import { listFillerIds } from "../src/viewer_api_layer7_fixture_data.ts";
import { FIXTURE_LOG_SESSIONS } from "../src/viewer_api_layer7_fixture_sessions.ts";
import { type HeadlessPage } from "../scripts/visual/cdp.ts";
import { SCROLL_HOME, buildSetHideIgnored } from "../scripts/visual/layer7-probes.ts";
import { COMMIT_MODE_CLICK } from "../scripts/visual/layer9-probes.ts";
import { failures } from "../scripts/visual/mockup-checks.ts";
import { ESCAPE_CLOSE, SESSION_TOGGLE_CLICK, buildScrollToDot } from "../scripts/visual/ruler-ui-probes.ts";
import * as review from "../scripts/visual/ruler-ui-review-checks.ts";
import * as probes from "../scripts/visual/ruler-ui-review-probes.ts";
import { FIRST_ID } from "../scripts/visual/ruler-ui-session-checks.ts";

const FILL_8 = String(listFillerIds()[8]);
const SURFACE = { borderRightWidth: "1px", borderRightStyle: "solid", background: "rgb(1, 2, 3)", filenavBackground: "rgb(1, 2, 3)" };
const HEAD_OK = { headTop: 127.5, paneTop: 127.5 };
const TITLES = {
    atRest: "RULER review: the session head top equals the pane top at rest",
    scrolled: "RULER review: the session head top equals the pane top when scrolled 600px",
    font: "RULER review: the dot letter font is 11px",
    rows: "RULER review: every ruler row in view has a dot at its own axis height",
    track: "RULER review: the track has a 1px solid right border and the File Nav background",
    minimapRuler: "RULER review: with both columns off the minimap left edge is at the ruler right edge",
    minimapStrip: "RULER review: the minimap left edge is at the strip right edge",
    bracket: "RULER review: a bracket sits at least 2px right of the track left edge",
    laneGap: "RULER review: dots in neighbouring lanes have a gap of 2px to 4px between their edges",
    dotDrawer: "RULER review: a click on a dot opens the drawer with the session title and the dot label in the JSON",
    snapshot: "RULER review: on a snapshot node the button reads { } and one click shows the JSON",
};

const makeGoodTable = (): Map<string, unknown> => new Map<string, unknown>([
    [SCROLL_HOME, 0], [ESCAPE_CLOSE, 0], [buildSetHideIgnored(false), undefined], [buildSetHideIgnored(true), undefined], [SESSION_TOGGLE_CLICK, 0], [COMMIT_MODE_CLICK, 0], [buildScrollToDot(FILL_8), true],
    [probes.HEAD_AT_REST, HEAD_OK], [probes.HEAD_SCROLLED, HEAD_OK], [probes.HEAD_AFTER_ROW_CLICK, HEAD_OK],
    [probes.buildMinimapEdgeProbe("#ruler"), { minimapLeft: 384, neighbourRight: 384 }],
    [probes.buildMinimapEdgeProbe("#annotation-track"), { minimapLeft: 458, neighbourRight: 458.4 }],
    [probes.buildMinimapEdgeProbe("#jfred-strip"), { minimapLeft: 562, neighbourRight: 562 }],
    [probes.DOT_FONT_SIZE, "11px"], [probes.ROW_DOT_FACTS, { rowCount: 40, unmatchedCount: 0 }],
    [probes.buildSurfaceProbe("#annotation-track"), SURFACE], [probes.buildSurfaceProbe("#jfred-strip"), SURFACE],
    [probes.BRACKET_INSET_FACTS, { count: 1, minInset: 3 }], [probes.LANE_GAPS, [3, 3]],
    [probes.buildDotClick(FIRST_ID), undefined], [probes.CLOSE_DRAWER, undefined],
    [probes.buildDotDrawerFacts(FIRST_ID), { title: FIXTURE_LOG_SESSIONS[0]!.title, label: "Made-up chat line", json: '{"content": "Made-up chat line"}' }],
    [probes.SNAPSHOT_CLICK, undefined], [probes.SNAPSHOT_TOGGLE_CLICK, undefined],
    [probes.SNAPSHOT_DRAWER_FACTS, { buttonTexts: ["{ }"], isJsonShown: true, json: "{}" }],
]);

const makeFakePage = (table: Map<string, unknown>): HeadlessPage => ({
    evaluate: async <T>(expression: string) => {
        if (!table.has(expression))
            throw new Error(`unexpected expression: ${expression}`);
        return table.get(expression) as T;
    },
    waitFor: async () => {}, navigate: async () => {}, screenshot: async () => "", close: async () => {},
});

const runReview = async (change: [string, unknown][] = []) => {
    const table = makeGoodTable();
    for (const [expression, answer] of change)
        table.set(expression, answer);
    const failuresBefore = failures.length;
    const log = console.log;
    const lines: string[] = [];
    console.log = (line: string) => { lines.push(line); };
    try {
        await review.validateRulerReview(makeFakePage(table));
        await review.validateSnapshotJson(makeFakePage(table));
    } finally {
        console.log = log;
    }
    const newFailures = failures.slice(failuresBefore);
    failures.length = failuresBefore;
    return { lines, newFailures };
};

test("test_the_good_fake_page_passes_all_14_review_checks", async () => {
    const { lines, newFailures } = await runReview();
    assert.deepEqual(newFailures, []);
    assert.equal(lines.filter((line) => line.startsWith("PASS  RULER review")).length, 14);
});

test("test_a_head_that_is_2px_below_the_pane_top_fails_only_the_scrolled_check", async () => {
    const { newFailures } = await runReview([[probes.HEAD_SCROLLED, { headTop: 129.5, paneTop: 127.5 }]]);
    assert.deepEqual(newFailures, [TITLES.scrolled]);
});

test("test_a_head_1px_below_the_pane_top_passes_and_a_head_above_it_by_2px_fails_the_rest_check", async () => {
    assert.deepEqual((await runReview([[probes.HEAD_AT_REST, { headTop: 128.5, paneTop: 127.5 }]])).newFailures, []);
    assert.deepEqual((await runReview([[probes.HEAD_AT_REST, { headTop: 125.5, paneTop: 127.5 }]])).newFailures, [TITLES.atRest]);
});

test("test_a_12px_dot_font_fails_only_the_font_check", async () => {
    assert.deepEqual((await runReview([[probes.DOT_FONT_SIZE, "12px"]])).newFailures, [TITLES.font]);
});

test("test_a_row_without_a_dot_or_no_rows_in_view_fails_only_the_row_check", async () => {
    assert.deepEqual((await runReview([[probes.ROW_DOT_FACTS, { rowCount: 40, unmatchedCount: 1 }]])).newFailures, [TITLES.rows]);
    assert.deepEqual((await runReview([[probes.ROW_DOT_FACTS, { rowCount: 0, unmatchedCount: 0 }]])).newFailures, [TITLES.rows]);
});

test("test_a_track_without_a_solid_1px_right_border_or_with_another_background_fails_only_the_track_check", async () => {
    const track = probes.buildSurfaceProbe("#annotation-track");
    assert.deepEqual((await runReview([[track, { ...SURFACE, borderRightStyle: "dashed" }]])).newFailures, [TITLES.track]);
    assert.deepEqual((await runReview([[track, { ...SURFACE, borderRightWidth: "2px" }]])).newFailures, [TITLES.track]);
    assert.deepEqual((await runReview([[track, { ...SURFACE, background: "rgb(9, 9, 9)" }]])).newFailures, [TITLES.track]);
});

test("test_a_strip_with_another_background_fails_only_the_strip_surface_check", async () => {
    const strip = probes.buildSurfaceProbe("#jfred-strip");
    const { newFailures } = await runReview([[strip, { ...SURFACE, background: "rgb(9, 9, 9)" }]]);
    assert.deepEqual(newFailures, ["RULER review: the commit strip has the File Nav background"]);
});

test("test_a_minimap_2px_off_the_ruler_or_the_strip_fails_only_its_own_check", async () => {
    const ruler = probes.buildMinimapEdgeProbe("#ruler");
    assert.deepEqual((await runReview([[ruler, { minimapLeft: 386, neighbourRight: 384 }]])).newFailures, [TITLES.minimapRuler]);
    const strip = probes.buildMinimapEdgeProbe("#jfred-strip");
    assert.deepEqual((await runReview([[strip, { minimapLeft: 560, neighbourRight: 562 }]])).newFailures, [TITLES.minimapStrip]);
});

test("test_a_minimap_off_the_track_edge_fails_only_the_track_minimap_check", async () => {
    const track = probes.buildMinimapEdgeProbe("#annotation-track");
    const { newFailures } = await runReview([[track, { minimapLeft: 470, neighbourRight: 458 }]]);
    assert.deepEqual(newFailures, ["RULER review: the minimap left edge is at the track right edge"]);
});

test("test_lane_gaps_outside_2px_to_4px_or_no_lane_pair_fail_only_the_lane_gap_check", async () => {
    assert.deepEqual((await runReview([[probes.LANE_GAPS, [3, 1]]])).newFailures, [TITLES.laneGap]);
    assert.deepEqual((await runReview([[probes.LANE_GAPS, [5]]])).newFailures, [TITLES.laneGap]);
    assert.deepEqual((await runReview([[probes.LANE_GAPS, []]])).newFailures, [TITLES.laneGap]);
});

test("test_a_bracket_1px_from_the_track_edge_or_no_bracket_fails_only_the_bracket_check", async () => {
    assert.deepEqual((await runReview([[probes.BRACKET_INSET_FACTS, { count: 1, minInset: 1 }]])).newFailures, [TITLES.bracket]);
    assert.deepEqual((await runReview([[probes.BRACKET_INSET_FACTS, { count: 0, minInset: Infinity }]])).newFailures, [TITLES.bracket]);
});

test("test_a_drawer_with_another_title_or_without_the_dot_label_in_its_json_fails_only_the_dot_drawer_check", async () => {
    const facts = probes.buildDotDrawerFacts(FIRST_ID);
    const good = { title: FIXTURE_LOG_SESSIONS[0]!.title, label: "Made-up chat line", json: "Made-up chat line" };
    assert.deepEqual((await runReview([[facts, { ...good, title: "other" }]])).newFailures, [TITLES.dotDrawer]);
    assert.deepEqual((await runReview([[facts, { ...good, json: "{}" }]])).newFailures, [TITLES.dotDrawer]);
});

test("test_a_snapshot_button_that_reads_json_or_a_click_with_empty_json_fails_only_the_snapshot_check", async () => {
    const good = { buttonTexts: ["{ }"], isJsonShown: true, json: "{}" };
    assert.deepEqual((await runReview([[probes.SNAPSHOT_DRAWER_FACTS, { ...good, buttonTexts: ["{}"] }]])).newFailures, [TITLES.snapshot]);
    assert.deepEqual((await runReview([[probes.SNAPSHOT_DRAWER_FACTS, { ...good, json: "" }]])).newFailures, [TITLES.snapshot]);
    assert.deepEqual((await runReview([[probes.SNAPSHOT_DRAWER_FACTS, { ...good, isJsonShown: false }]])).newFailures, [TITLES.snapshot]);
});

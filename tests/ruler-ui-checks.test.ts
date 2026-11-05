// Tests for scripts/visual/ruler-ui-checks.ts: the judges for the default and expanded states, and reportFacts.

import { strict as assert } from "node:assert";
import { test } from "node:test";
import * as checks from "../scripts/visual/ruler-ui-checks.ts";
import { makeScriptedPage, runCheck } from "./layer9-fake-page.ts";

const BOX_TIME = { left: 10, right: 110, top: 0, bottom: 12 };
const HEAD: checks.HeadFacts = { isFirstChild: true, headButtons: 1, headText: "session", hasJfredButton: false, trackCount: 0, stripCount: 0 };
const HEAD_AT = { height: 44, offset: 0, borderStyle: "dotted", tickTop: 100 };
const makeTick = (n: number) => ({ time: "06-01-2026:09:00", count: "(2)", fullTime: `06-01 09:00:00.${String(n).padStart(3, "0")}`, title: `06-01 09:00:00.${String(n).padStart(3, "0")}` });
const makeTicks = (count: number) => Array.from({ length: count }, (_, n) => makeTick(n % 1000));
const EXPANDED: checks.ExpandFacts = {
    isExpanded: true, countDisplay: "none", expectedCount: 2, time: BOX_TIME, dashes: { left: 116, right: 144, top: 2, bottom: 10 },
    dashColors: { snapshot: "rgb(1, 2, 3)", edit: "rgb(4, 5, 6)" }, ink: "rgb(9, 9, 9)", listHeight: 26, nextBefore: 100, nextAfter: 126,
    buttons: [{ text: "a.py  abcd1234", kind: "tf-edit", color: "rgb(4, 5, 6)" }, { text: "b.py  @v2 📸", kind: "tf-snapshot", color: "rgb(1, 2, 3)" }],
};

test("test_head_with_one_session_button_passes", () => {
    // Step: the head is first, holds only the session button, and no column exists.
    assert.equal(checks.isHeadRight(HEAD), true);
});

test("test_head_fails_for_a_jfred_button_a_second_button_a_track_or_a_strip", () => {
    // Step: break one fact at a time; each must fail the judge.
    for (const change of [{ hasJfredButton: true }, { headButtons: 2 }, { trackCount: 1 }, { stripCount: 1 }, { isFirstChild: false }, { headText: "jfred" }])
        assert.equal(checks.isHeadRight({ ...HEAD, ...change }), false, JSON.stringify(change));
});

test("test_rows_are_plain_only_with_no_color_class_and_no_color_property", () => {
    // Step: the plain page passes, and either leftover fails.
    assert.equal(checks.isRowsPlain({ coloured: 0, withProperty: 0 }), true);
    assert.equal(checks.isRowsPlain({ coloured: 1, withProperty: 0 }), false);
    assert.equal(checks.isRowsPlain({ coloured: 0, withProperty: 1 }), false);
});

test("test_head_stays_put_while_the_ticks_scroll", () => {
    // Step: same height and offset at both scroll positions, and the first tick moved.
    const scrolled = { ...HEAD_AT, tickTop: -700 };
    assert.equal(checks.isHeadFixed({ home: HEAD_AT, scrolled }), true);
    // Step: a head that moved, a tick that did not, a wrong height, or a solid border each fail.
    assert.equal(checks.isHeadFixed({ home: HEAD_AT, scrolled: { ...scrolled, offset: -40 } }), false);
    assert.equal(checks.isHeadFixed({ home: HEAD_AT, scrolled: { ...HEAD_AT } }), false);
    assert.equal(checks.isHeadFixed({ home: { ...HEAD_AT, height: 40 }, scrolled }), false);
    assert.equal(checks.isHeadFixed({ home: HEAD_AT, scrolled: { ...scrolled, borderStyle: "solid" } }), false);
});

test("test_row_text_needs_time_count_full_time_and_equal_title", () => {
    // Step: a good tick passes.
    assert.equal(checks.isRowTextRight({ leaders: 1, ticks: [makeTick(1)] }), true);
    // Step: the old format, a missing count, a bad full time or a different title each fail.
    for (const change of [{ time: "06-01 09:00:00.000 (2)" }, { count: "" }, { fullTime: "06-01 09:00" }, { title: "other" }])
        assert.equal(checks.isRowTextRight({ leaders: 1, ticks: [{ ...makeTick(1), ...change }] }), false, JSON.stringify(change));
});

test("test_row_count_equals_leaders_and_419_and_full_times_are_unique", () => {
    // Step: 419 unique ticks with 419 leaders pass.
    assert.equal(checks.isRowCountRight({ leaders: 419, ticks: makeTicks(419) }), true);
    // Step: a missing leader, a short list and a repeated full time each fail.
    assert.equal(checks.isRowCountRight({ leaders: 420, ticks: makeTicks(419) }), false);
    assert.equal(checks.isRowCountRight({ leaders: 418, ticks: makeTicks(418) }), false);
    assert.equal(checks.isRowCountRight({ leaders: 419, ticks: [...makeTicks(418), makeTick(0)] }), false);
});

test("test_dashes_sit_below_the_time_inside_its_width_and_the_time_sits_on_the_axis", () => {
    // Step: dashes under the time, inside its width, with the time centred on the axis, pass.
    const good = { time: BOX_TIME, dashes: { left: 20, right: 48, top: 12, bottom: 16 }, axisY: 6 };
    assert.equal(checks.isEveryDashBelowTime([good]), true);
    // Step: dashes above, outside the width, or a time off its axis each fail.
    assert.equal(checks.isEveryDashBelowTime([{ ...good, dashes: { ...good.dashes, top: 0, bottom: 4 } }]), false);
    assert.equal(checks.isEveryDashBelowTime([{ ...good, dashes: { ...good.dashes, left: 100, right: 130 } }]), false);
    assert.equal(checks.isEveryDashBelowTime([{ ...good, axisY: 20 }]), false);
    assert.equal(checks.isEveryDashBelowTime([]), false);
});

test("test_layout_needs_a_152px_ruler_the_stage_next_to_it_and_the_slack_gap", () => {
    // Step: the real-page values pass; a wrong width, a stranger before the stage or another gap fail.
    const good = { rulerWidth: 152, isBeforeStage: true, gap: 14, expectedGap: 14 };
    assert.equal(checks.isLayoutRight(good), true);
    assert.equal(checks.isLayoutRight({ ...good, rulerWidth: 194 }), false);
    assert.equal(checks.isLayoutRight({ ...good, isBeforeStage: false }), false);
    assert.equal(checks.isLayoutRight({ ...good, gap: 28 }), false);
});

test("test_expanded_row_hides_the_count_moves_dashes_right_and_lists_every_event", () => {
    // Step: the open row passes.
    assert.equal(checks.isExpandedRight(EXPANDED), true);
    // Step: a shown count, dashes left of the time, a drifted band or a short list each fail.
    assert.equal(checks.isExpandedRight({ ...EXPANDED, countDisplay: "inline-block" }), false);
    assert.equal(checks.isExpandedRight({ ...EXPANDED, dashes: { left: 20, right: 48, top: 12, bottom: 16 } }), false);
    assert.equal(checks.isExpandedRight({ ...EXPANDED, dashes: { left: 116, right: 144, top: 20, bottom: 28 } }), false);
    assert.equal(checks.isExpandedRight({ ...EXPANDED, expectedCount: 3 }), false);
});

test("test_file_lines_read_name_then_hash_or_version_with_camera", () => {
    // Step: both forms of the spec pass; a short hash, a bare version and a one-space gap fail.
    assert.equal(checks.isEveryFileTextRight(EXPANDED), true);
    assert.equal(checks.isEveryFileTextRight({ ...EXPANDED, buttons: [{ text: "module_04.sh  created at", kind: "tf-created", color: "" }] }), true);
    for (const text of ["a.py  abcd123", "a.py  @v2", "a.py abcd1234", "a.py  created"])
        assert.equal(checks.isEveryFileTextRight({ ...EXPANDED, buttons: [{ text, kind: "tf-edit", color: "" }] }), false, text);
});

test("test_file_line_color_equals_its_dash_color_and_tool_lines_equal_ink", () => {
    // Step: each line matches the dash of its kind.
    assert.equal(checks.isEveryFileColourRight(EXPANDED), true);
    // Step: tool lines use ink; other colors and kinds without a dash fail.
    const tool = (color: string) => ({ ...EXPANDED, buttons: [{ text: "x", kind: "tf-tool", color }] });
    assert.equal(checks.isEveryFileColourRight(tool("rgb(9, 9, 9)")), true);
    assert.equal(checks.isEveryFileColourRight(tool("rgb(0, 0, 0)")), false);
    assert.equal(checks.isEveryFileColourRight({ ...EXPANDED, buttons: [{ text: "x", kind: "tf-branch", color: "rgb(1, 1, 1)" }] }), false);
});

test("test_next_row_moves_down_by_the_list_height_and_escape_and_single_click_judges", () => {
    // Step: the next row moved by the list height or more.
    assert.equal(checks.isNextRowMovedDown(EXPANDED), true);
    assert.equal(checks.isNextRowMovedDown({ ...EXPANDED, nextAfter: 110 }), false);
    // Step: a closed row, a one-event click and a quiet page.
    assert.equal(checks.isRowClosed({ expanded: 0, tickFiles: 0 }), true);
    assert.equal(checks.isRowClosed({ expanded: 1, tickFiles: 0 }), false);
    assert.equal(checks.isSingleClickRight({ tickFiles: 0, found: 2, foundBoxes: 1 }), true);
    assert.equal(checks.isSingleClickRight({ tickFiles: 1, found: 2, foundBoxes: 1 }), false);
    assert.equal(checks.isSingleClickRight({ tickFiles: 0, found: 1, foundBoxes: 1 }), false);
    assert.equal(checks.isSingleClickRight({ tickFiles: 0, found: 2, foundBoxes: 2 }), false);
    assert.equal(checks.isQuiet({ errors: 0, isIdle: true }), true);
    assert.equal(checks.isQuiet({ errors: -1, isIdle: true }), false);
});

test("test_report_facts_prints_the_facts_of_a_failed_judge", async () => {
    // Step: a scripted page answers one expression with plain-row facts.
    const page = makeScriptedPage(new Map([["EXPR", [{ coloured: 2, withProperty: 0 }]]]));
    // Step: the judge fails, so one failure with the title is recorded and the facts print.
    const { newFailures, lines } = await runCheck(async () => {
        await checks.reportFacts(page, "EXPR", "RULER title", checks.isRowsPlain);
    });
    assert.deepEqual(newFailures, ["RULER title"]);
    assert.ok(lines[0]!.includes('"coloured":2'));
});

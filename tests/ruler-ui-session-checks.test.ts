// Tests for scripts/visual/ruler-ui-session-checks.ts: the judges for the session column state.

import { strict as assert } from "node:assert";
import { test } from "node:test";
import { FIXTURE_LOG_SESSIONS } from "../src/viewer_api_layer7_fixture_sessions.ts";
import * as session from "../scripts/visual/ruler-ui-session-checks.ts";

const SESSION: session.SessionFacts = {
    isCurrent: true, background: "rgb(60, 180, 90)", trackLeft: 152, trackWidth: 74, rulerRight: 152, stageLeft: 240, laneXs: ["18px", "35px", "52px"],
};
const makeTick = (n: number) => ({ computed: `rgb(${n}, 1, 1)`, expected: `rgb(${n}, 1, 1)` });
const SCAN: session.ScanFacts = {
    letters: ["u", "a", "t", "?"], titled: 0, alabels: 0, colours: [["c1"], ["c2"], ["c3"], ["c4"]], coloured: Array.from({ length: 418 }, (_, n) => makeTick(n)),
};
const DOT = { left: 200, right: 214, top: 100, bottom: 114 };
const SAME: session.SameFacts = { first: DOT, second: { ...DOT, left: 228, right: 242 }, tickClasses: "tick multi", tickColor: "rgb(5, 5, 5)", plainColor: "rgb(5, 5, 5)" };
const POPUP = {
    isVisible: true, box: { left: 222, right: 400, top: 90, bottom: 120 }, background: "rgb(1, 2, 3)", targetBackground: "rgb(1, 2, 3)", target: DOT,
    lines: [FIXTURE_LOG_SESSIONS[0]!.title, "Bash: npm test"], hasTitle: false, isHiddenAfter: true,
};

test("test_toggle_is_current_and_green", () => {
    // Step: a current button with a strong green channel passes.
    assert.equal(session.isToggleGreen(SESSION), true);
    // Step: a button that is not current, or has red or blue on top, fails.
    assert.equal(session.isToggleGreen({ ...SESSION, isCurrent: false }), false);
    assert.equal(session.isToggleGreen({ ...SESSION, background: "rgb(200, 100, 90)" }), false);
    assert.equal(session.isToggleGreen({ ...SESSION, background: "rgba(0, 0, 0, 0)" }), false);
});

test("test_track_touches_the_ruler_and_is_74px_for_three_lanes", () => {
    // Step: three lanes at 74px, touching the ruler, pass.
    assert.equal(session.isTrackPlaced(SESSION), true);
    // Step: the old 96px width, a gap to the ruler, or two lanes each fail.
    assert.equal(session.isTrackPlaced({ ...SESSION, trackWidth: 96 }), false);
    assert.equal(session.isTrackPlaced({ ...SESSION, trackLeft: 160 }), false);
    assert.equal(session.isTrackPlaced({ ...SESSION, laneXs: ["18px", "35px"] }), false);
});

test("test_stage_moves_right_by_exactly_the_track_width", () => {
    // Step: 166 before and 240 after, with a 74px track, passes; a stage that moved less fails.
    assert.equal(session.isStageShifted(166, SESSION), true);
    assert.equal(session.isStageShifted(200, SESSION), false);
});

test("test_dots_read_one_listed_letter_with_no_title_and_no_old_label", () => {
    // Step: letters from the list pass.
    assert.equal(session.isEveryDotLetterRight(SCAN), true);
    // Step: bracketed letters, a title, an old label or no dot at all fail.
    assert.equal(session.isEveryDotLetterRight({ ...SCAN, letters: ["[u]"] }), false);
    assert.equal(session.isEveryDotLetterRight({ ...SCAN, titled: 1 }), false);
    assert.equal(session.isEveryDotLetterRight({ ...SCAN, alabels: 1 }), false);
    assert.equal(session.isEveryDotLetterRight({ ...SCAN, letters: [] }), false);
});

test("test_four_sessions_have_four_colors_and_418_rows_take_them", () => {
    // Step: 4 sessions with one color each and 418 matching rows pass.
    assert.equal(session.isEverySessionColourRight(SCAN), true);
    // Step: a shared color, two colors in one session, 417 rows or a mismatched row each fail.
    assert.equal(session.isEverySessionColourRight({ ...SCAN, colours: [["c1"], ["c1"], ["c3"], ["c4"]] }), false);
    assert.equal(session.isEverySessionColourRight({ ...SCAN, colours: [["c1", "c2"], ["c3"], ["c4"], ["c5"]] }), false);
    assert.equal(session.isEverySessionColourRight({ ...SCAN, coloured: SCAN.coloured.slice(1) }), false);
    assert.equal(session.isEverySessionColourRight({ ...SCAN, coloured: [...SCAN.coloured.slice(1), { computed: "a", expected: "b" }] }), false);
});

test("test_between_dot_is_more_than_2px_from_every_tick_and_between_two", () => {
    // Step: more than 2px from the nearest tick and between two ticks passes.
    assert.equal(session.isBetweenTicks({ minGap: 6, isBetween: true }), true);
    // Step: a dot on a tick or a dot outside the ticks fails.
    assert.equal(session.isBetweenTicks({ minGap: 1, isBetween: true }), false);
    assert.equal(session.isBetweenTicks({ minGap: 6, isBetween: false }), false);
});

test("test_session_line_starts_and_ends_at_its_dot_centres", () => {
    // Step: the line top equals the first dot centre; the line bottom equals the last dot centre.
    const line = { laneX: "18px", top: 100, bottom: 500, dotCy: 100.5 };
    assert.equal(session.isLineStartAt(line), true);
    assert.equal(session.isLineEndAt({ ...line, dotCy: 499.5 }), true);
    // Step: a dot 5px off fails both.
    assert.equal(session.isLineStartAt({ ...line, dotCy: 105 }), false);
    assert.equal(session.isLineEndAt({ ...line, dotCy: 505 }), false);
});

test("test_same_instant_dots_sit_side_by_side_and_the_row_stays_plain", () => {
    // Step: level dots 28px apart on a plain row pass.
    assert.equal(session.isSameInstantRight(SAME), true);
    // Step: a colored row, a different color, overlapping dots or unlevel dots each fail.
    assert.equal(session.isSameInstantRight({ ...SAME, tickClasses: "tick s-coloured" }), false);
    assert.equal(session.isSameInstantRight({ ...SAME, tickColor: "rgb(9, 9, 9)" }), false);
    assert.equal(session.isSameInstantRight({ ...SAME, second: { ...DOT, left: 205, right: 219 } }), false);
    assert.equal(session.isSameInstantRight({ ...SAME, second: { ...SAME.second, top: 120, bottom: 134 } }), false);
});

test("test_popup_shows_title_then_line_in_the_dot_color_right_of_the_dot", () => {
    // Step: the full popup passes.
    assert.equal(session.isPopupRight(POPUP), true);
    // Step: a wrong title, color, position, native title or stuck popup fails.
    assert.equal(session.isPopupRight({ ...POPUP, lines: ["other", "Bash: npm test"] }), false);
    assert.equal(session.isPopupRight({ ...POPUP, background: "rgb(9, 9, 9)" }), false);
    assert.equal(session.isPopupRight({ ...POPUP, box: { ...POPUP.box, left: 100 } }), false);
    assert.equal(session.isPopupRight({ ...POPUP, hasTitle: true }), false);
    assert.equal(session.isPopupRight({ ...POPUP, isHiddenAfter: false }), false);
});

test("test_session_off_needs_no_track_a_zero_width_and_the_first_stage_left", () => {
    // Step: no track, 0px and the first stage left pass.
    const off = { trackCount: 0, trackWidth: "0px", stageLeft: 166 };
    assert.equal(session.isSessionOff(off, 166), true);
    // Step: a track left over, a width left over, or a stage that did not return fail.
    assert.equal(session.isSessionOff({ ...off, trackCount: 1 }, 166), false);
    assert.equal(session.isSessionOff({ ...off, trackWidth: "96px" }, 166), false);
    assert.equal(session.isSessionOff({ ...off, stageLeft: 262 }, 166), false);
});

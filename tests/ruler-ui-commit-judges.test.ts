// Tests for scripts/visual/ruler-ui-commit-judges.ts: the judges for Commit mode, the hide-ignored box and the strip.

import { strict as assert } from "node:assert";
import { test } from "node:test";
import * as commit from "../scripts/visual/ruler-ui-commit-judges.ts";

const makeEntry = (kind: string, shortHash: string, cy: number) => ({ kind, shortHash, cx: 650, cy, tickCy: cy });
const makeLine = (nodeCx: number) => ({ left: 152, right: nodeCx, top: 300, bottom: 301, style: "dashed", nodeCx });
const STRIP: commit.StripFacts = {
    strip: { left: 152, right: 256, top: 0, bottom: 9000 }, rulerRight: 152, stageLeft: 166, headText: "commits", deleteCount: 1, chains: 2, isCovering: true,
    entries: [makeEntry("base", "a1b2c3d4", 300), makeEntry("commit", "c0ffee01", 400), makeEntry("commit", "c0ffee02", 500)],
    lines: [makeLine(170), makeLine(170), makeLine(170)], untitledNo: 0, marks: { "cut-base": 1, "cut-set": 2, "cut-ok": 5, "cut-no": 9 },
};
const BOTH: commit.BothFacts = {
    strip: { left: 248, right: 352, top: 0, bottom: 9000 }, track: { left: 152, right: 248, top: 0, bottom: 9000 }, stageLeft: 262, trackZ: 8, stripZ: 7,
    isEveryLineCrossing: true, overlaps: 0, crossings: 2, isEveryDotOnTop: true,
};
const dot = (display: string, opacity: number, cy: number) => ({ display, opacity, cy });
const LINE = { laneX: "18px", top: 100, bottom: 900, dotCy: 100 };
const POPUP = {
    isVisible: true, box: null, background: "", target: { left: 0, right: 1, top: 0, bottom: 1 }, targetBackground: "", hasTitle: false, isHiddenAfter: true,
    lines: ["jfred: reconstruct to c0ffee02", "", "includes 2 unmarked changes"],
};

test("test_commit_mode_off_has_no_strip_and_no_cut_mark", () => {
    // Step: no strip and no cut class passes; either one left over fails.
    assert.equal(commit.isCommitOff({ stripCount: 0, cutTicks: 0 }), true);
    assert.equal(commit.isCommitOff({ stripCount: 1, cutTicks: 0 }), false);
    assert.equal(commit.isCommitOff({ stripCount: 0, cutTicks: 3 }), false);
});

test("test_strip_touches_the_ruler_is_104px_covers_bubbles_and_keeps_the_stage_still", () => {
    // Step: the good strip passes.
    assert.equal(commit.isStripPlaced(STRIP, 166), true);
    // Step: a 120px width, moved stage, ruler gap or uncovered bubble fails.
    assert.equal(commit.isStripPlaced({ ...STRIP, strip: { ...STRIP.strip, right: 272 } }, 166), false);
    assert.equal(commit.isStripPlaced({ ...STRIP, stageLeft: 270 }, 166), false);
    assert.equal(commit.isStripPlaced({ ...STRIP, rulerRight: 140 }, 166), false);
    assert.equal(commit.isStripPlaced({ ...STRIP, isCovering: false }, 166), false);
});

test("test_strip_head_holds_commits_and_one_delete_button", () => {
    // Step: head text and one button pass; a missing button or title fails.
    assert.equal(commit.isStripHeadRight(STRIP), true);
    assert.equal(commit.isStripHeadRight({ ...STRIP, deleteCount: 0 }), false);
    assert.equal(commit.isStripHeadRight({ ...STRIP, headText: "" }), false);
});

test("test_base_and_two_commits_share_one_line_level_with_their_ticks", () => {
    // Step: the canned column passes.
    assert.equal(commit.isEntryColumnRight(STRIP), true);
    // Step: a node off its tick or line, a wrong hash or one chain fails.
    const moved = [STRIP.entries[0]!, { ...STRIP.entries[1]!, tickCy: 420 }, STRIP.entries[2]!];
    assert.equal(commit.isEntryColumnRight({ ...STRIP, entries: moved }), false);
    assert.equal(commit.isEntryColumnRight({ ...STRIP, entries: [STRIP.entries[0]!, { ...STRIP.entries[1]!, cx: 680 }, STRIP.entries[2]!] }), false);
    assert.equal(commit.isEntryColumnRight({ ...STRIP, entries: [STRIP.entries[0]!, makeEntry("commit", "deadbeef", 400), STRIP.entries[2]!] }), false);
    assert.equal(commit.isEntryColumnRight({ ...STRIP, chains: 1 }), false);
});

test("test_three_dashed_lines_run_from_the_ruler_edge_to_their_nodes", () => {
    // Step: three dashed lines from the ruler edge to the node centre pass.
    assert.equal(commit.isEveryLineRight(STRIP), true);
    assert.equal(commit.isEveryLineRight({ ...STRIP, lines: [{ ...makeLine(170), left: 153 }, makeLine(170), makeLine(170)] }), true);
    // Step: a solid line, a line that starts late, a line that stops short, or only two lines fail.
    assert.equal(commit.isEveryLineRight({ ...STRIP, lines: [{ ...makeLine(170), style: "solid" }, makeLine(170), makeLine(170)] }), false);
    assert.equal(commit.isEveryLineRight({ ...STRIP, lines: [{ ...makeLine(170), left: 160 }, makeLine(170), makeLine(170)] }), false);
    assert.equal(commit.isEveryLineRight({ ...STRIP, lines: [{ ...makeLine(170), right: 150 }, makeLine(170), makeLine(170)] }), false);
    assert.equal(commit.isEveryLineRight({ ...STRIP, lines: [makeLine(170), makeLine(170)] }), false);
});

test("test_ticks_show_one_base_two_set_marks_and_titled_dim_ticks", () => {
    // Step: the good counts pass.
    assert.equal(commit.isEveryMarkRight(STRIP), true);
    // Step: no base, a third set mark, no dim tick or an untitled dim tick each fail.
    assert.equal(commit.isEveryMarkRight({ ...STRIP, marks: { ...STRIP.marks, "cut-base": 0 } }), false);
    assert.equal(commit.isEveryMarkRight({ ...STRIP, marks: { ...STRIP.marks, "cut-set": 3 } }), false);
    assert.equal(commit.isEveryMarkRight({ ...STRIP, marks: { ...STRIP.marks, "cut-no": 0 } }), false);
    assert.equal(commit.isEveryMarkRight({ ...STRIP, untitledNo: 1 }), false);
});

test("test_commit_popup_starts_with_jfred_line_has_the_skipped_line_and_wraps_at_50", () => {
    // Step: the visible popup with the two lines passes.
    assert.equal(commit.isCommitPopupRight(POPUP), true);
    // Step: a hidden popup, a long line, a missing skipped line or a stuck popup each fail.
    assert.equal(commit.isCommitPopupRight({ ...POPUP, isVisible: false }), false);
    assert.equal(commit.isCommitPopupRight({ ...POPUP, lines: [...POPUP.lines, "x".repeat(51)] }), false);
    assert.equal(commit.isCommitPopupRight({ ...POPUP, lines: [POPUP.lines[0]!] }), false);
    assert.equal(commit.isCommitPopupRight({ ...POPUP, isHiddenAfter: false }), false);
    assert.equal(commit.isNoPopup({ ...POPUP, isVisible: false }), true);
    assert.equal(commit.isNoPopup(POPUP), false);
});

test("test_drawer_is_open_with_the_commit_message", () => {
    // Step: an open drawer with the message passes; a closed one or another text fails.
    assert.equal(commit.isDrawerRight({ isOpen: true, text: "jfred: reconstruct to c0ffee02", hasButton: false }), true);
    assert.equal(commit.isDrawerRight({ isOpen: false, text: "jfred: reconstruct to c0ffee02", hasButton: false }), false);
    assert.equal(commit.isDrawerRight({ isOpen: true, text: "other", hasButton: false }), false);
});

test("test_both_on_moves_the_stage_by_the_track_only_and_draws_dots_above_the_lines", () => {
    // Step: strip at the track edge, stage moved by the 96px track, track above strip, dots on top, passes.
    assert.equal(commit.isBothRight(BOTH, 166), true);
    // Step: a stage moved by the strip, low track, overlap or covered dot fails.
    assert.equal(commit.isBothRight({ ...BOTH, stageLeft: 270 }, 166), false);
    assert.equal(commit.isBothRight({ ...BOTH, trackZ: 7 }, 166), false);
    assert.equal(commit.isBothRight({ ...BOTH, overlaps: 1 }, 166), false);
    assert.equal(commit.isBothRight({ ...BOTH, isEveryDotOnTop: false }, 166), false);
    assert.equal(commit.isBothRight({ ...BOTH, crossings: 0 }, 166), false);
});

test("test_ignored_dots_hide_when_ticked_and_show_dimmed_inside_the_line_when_unticked", () => {
    // Step: ticked dots are display none; unticked dots show at .38 inside the same line.
    const hidden = { dots: [dot("none", 0.38, 200), dot("none", 0.38, 300)], line: LINE };
    const shown = { dots: [dot("block", 0.38, 200), dot("block", 0.38, 300)], line: LINE };
    assert.equal(commit.isIgnoredToggleRight(hidden, shown), true);
    // Step: a shown, full-opacity or out-of-line dot, or a shorter line, fails.
    assert.equal(commit.isIgnoredToggleRight({ ...hidden, dots: [dot("block", 0.38, 200), dot("none", 0.38, 300)] }, shown), false);
    assert.equal(commit.isIgnoredToggleRight(hidden, { ...shown, dots: [dot("block", 1, 200), dot("block", 0.38, 300)] }), false);
    assert.equal(commit.isIgnoredToggleRight(hidden, { ...shown, dots: [dot("block", 0.38, 50), dot("block", 0.38, 300)] }), false);
    assert.equal(commit.isIgnoredToggleRight({ ...hidden, line: { ...LINE, bottom: 500 } }, shown), false);
});

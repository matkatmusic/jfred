import assert from "node:assert/strict";
import { test } from "node:test";
import { renderBarsCutStrip, type BarsCutStripHandlers } from "../webapp/layer1-components/bars-view/layer1-bars-cut-strip.ts";
import { BarsViewMode, setBarsViewMode } from "../webapp/layer1-components/bars-view/layer1-bars-mode.ts";
import { buildBarFileModels } from "../webapp/layer1-components/bars-view/layer1-bars-model.ts";
import { findRealRulerTickAtRowIndex, listRealRulerRows } from "../webapp/layer1-components/bars-view/layer1-bars-ruler.ts";
import { getBarsViewState } from "../webapp/layer1-components/bars-view/layer1-bars-state.ts";
import type { InverseCommitWire } from "../webapp/layer1-components/bars-view/layer1-bars-wire.ts";
import { appendCommit, deleteJfredBranch, setArmed, setBase, setPending } from "../webapp/layer1-components/commits-column/layer1-jfred-state.ts";
import type { RulerRow } from "../webapp/layer1-components/ruler/layer1-ruler-rows.ts";
import { storeRow } from "../webapp/layer1-components/ruler/layer1-tick-events.ts";
import { buildInverseCommit, buildInverseFile, initBarsDom } from "./layer1-bars-test-helpers.ts";

const DAY_START_MS = Date.parse("2026-11-13T00:00:00.000Z");
const HOUR_MS = 3600_000;
const NO_HANDLERS: BarsCutStripHandlers = { commitPendingMark: () => {}, askDeleteBranch: () => {} };

function buildInstant(hour: number): string {
    return new Date(DAY_START_MS + hour * HOUR_MS).toISOString();
}

function buildCommit(hour: number): InverseCommitWire {
    return buildInverseCommit({ instant: buildInstant(hour), eventType: "GitCommit", treeHash: `t${hour}` });
}

function buildRow(hours: number[]): RulerRow {
    const instants = hours.map(buildInstant);
    return { axisPx: 0, text: "r", eventCount: instants.length, axisPxList: instants.map(() => 0), instants };
}

function fillRulerWithRows(rowsNewestFirst: number[][]): void {
    const ruler = document.getElementById("timelineRulerComponent")!;
    ruler.replaceChildren();
    for (const hours of [...rowsNewestFirst].reverse()) {
        const tick = document.createElement("div");
        tick.className = "tick";
        ruler.appendChild(tick);
        storeRow(tick, buildRow(hours));
    }
}

// Five rows, newest first: h12 h10 h8 h6 h4 (row percents 0 25 50 75 100). One file A changes on every row.
// The branch: base at h4 (row 4), one jfred commit at h8 (row 2, the tip). Commit Mode is on, the Bars view is on.
function buildBranchWithCommitStrip(): void {
    initBarsDom();
    const appWindow = document.createElement("div");
    appWindow.id = "appWindow";
    document.body.appendChild(appWindow);
    const ruler = document.createElement("div");
    ruler.id = "timelineRulerComponent";
    document.body.appendChild(ruler);
    fillRulerWithRows([[12], [10], [8], [6], [4]]);
    getBarsViewState().isHistoryLoading = false;
    getBarsViewState().models = buildBarFileModels([buildInverseFile("A", [12, 10, 8, 6, 4].map(buildCommit))], listRealRulerRows());
    deleteJfredBranch();
    setBase({ instant: buildInstant(4), shortHash: "base0001" });
    appendCommit({ instant: buildInstant(8), shortHash: "tip00001", parentShortHash: "base0001", message: "first" });
    setArmed(true);
    setBarsViewMode(BarsViewMode.bars);
}

function readStrip(): HTMLElement {
    return document.getElementById("barsCutStrip")!;
}

function listScissors(): HTMLElement[] {
    return Array.from(document.querySelectorAll<HTMLElement>("#barsCutStrip .barsCutScissors"));
}

test("test_the_strip_is_not_drawn_when_commit_mode_is_off", () => {
    // Step: the Bars view is on and the branch exists, but Commit Mode is off.
    buildBranchWithCommitStrip();
    setArmed(false);
    // Step: draw. There is no strip.
    renderBarsCutStrip(NO_HANDLERS);
    assert.equal(document.getElementById("barsCutStrip"), null);
});

test("test_the_strip_is_not_drawn_in_bubbles_view", () => {
    // Step: Commit Mode is on, the Bars view is off.
    buildBranchWithCommitStrip();
    setBarsViewMode(BarsViewMode.bubbles);
    // Step: draw. There is no strip.
    renderBarsCutStrip(NO_HANDLERS);
    assert.equal(document.getElementById("barsCutStrip"), null);
});

test("test_the_strip_is_the_last_child_of_the_sticky_header", () => {
    // Step: draw the strip.
    buildBranchWithCommitStrip();
    renderBarsCutStrip(NO_HANDLERS);
    // Step: the strip is the last child of the sticky header.
    assert.equal(document.getElementById("barsStickyHeader")!.lastElementChild!.id, "barsCutStrip");
});

test("test_the_strip_has_the_delete_label_and_the_branch_label", () => {
    // Step: draw the strip.
    buildBranchWithCommitStrip();
    renderBarsCutStrip(NO_HANDLERS);
    // Step: the left column says "Delete jfred branch" and the right column says "jfred branch".
    assert.equal(readStrip().querySelector(".barsCutDeleteBranch")!.textContent, "Delete jfred branch");
    assert.equal(readStrip().querySelector(".barsCutBranchLabel")!.textContent, "jfred branch");
});

test("test_the_branch_line_runs_from_the_tip_row_percent_to_the_base_row_percent", () => {
    // Step: the tip is on row 2 (50 percent) and the base on row 4 (100 percent).
    buildBranchWithCommitStrip();
    renderBarsCutStrip(NO_HANDLERS);
    // Step: the line starts at 50 percent and is 50 percent wide.
    const line = readStrip().querySelector<HTMLElement>(".barsCutBranchLine")!;
    assert.equal(line.style.left, "50%");
    assert.equal(line.style.width, "50%");
});

test("test_the_tip_and_the_base_hash_labels_sit_at_their_row_percent", () => {
    // Step: draw the strip.
    buildBranchWithCommitStrip();
    renderBarsCutStrip(NO_HANDLERS);
    // Step: the base label is at 100 percent and the tip label at 50 percent.
    const labels = Array.from(readStrip().querySelectorAll<HTMLElement>(".barsCutHashLabel"));
    assert.deepEqual(labels.map((label) => [label.textContent, label.style.left]).sort(), [["base0001", "100%"], ["tip00001", "50%"]]);
});

test("test_a_cap_sits_at_the_base_and_at_each_jfred_commit_row", () => {
    // Step: the branch has the base (row 4) and one commit (row 2).
    buildBranchWithCommitStrip();
    renderBarsCutStrip(NO_HANDLERS);
    // Step: two caps, at 50 percent and 100 percent.
    const caps = Array.from(readStrip().querySelectorAll<HTMLElement>(".barsCutCap"));
    assert.deepEqual(caps.map((cap) => cap.style.left).sort(), ["100%", "50%"]);
});

test("test_with_no_base_the_strip_draws_no_branch_line", () => {
    // Step: the branch has no base.
    buildBranchWithCommitStrip();
    deleteJfredBranch();
    // Step: draw. The strip shows, but it has no branch line, cap or hash label.
    renderBarsCutStrip(NO_HANDLERS);
    assert.notEqual(readStrip(), null);
    assert.equal(readStrip().querySelector(".barsCutBranchLine"), null);
    assert.equal(readStrip().querySelector(".barsCutCap"), null);
    assert.equal(readStrip().querySelector(".barsCutHashLabel"), null);
});

test("test_a_scissors_sits_at_each_markable_row_newer_than_the_tip", () => {
    // Step: the tip is on row 2. File A changes on rows 0 and 1.
    buildBranchWithCommitStrip();
    renderBarsCutStrip(NO_HANDLERS);
    // Step: one scissors for each of rows 0 and 1, at 0 and 25 percent.
    assert.deepEqual(listScissors().map((scissors) => [scissors.dataset.rowIndex, scissors.style.left, scissors.textContent]), [["0", "0%", "✂"], ["1", "25%", "✂"]]);
});

test("test_with_a_pending_mark_the_mark_scissors_is_coloured_and_the_newer_ones_are_dim", () => {
    // Step: the mark is on row 1 (h10).
    buildBranchWithCommitStrip();
    setPending({ instant: buildInstant(10), message: "m" });
    renderBarsCutStrip(NO_HANDLERS);
    // Step: the row 1 scissors is the mark, the row 0 scissors (newer) is excluded.
    const [newerScissors, markScissors] = listScissors();
    assert.equal(markScissors!.classList.contains("scissorsMark"), true);
    assert.equal(markScissors!.classList.contains("scissorsExcluded"), false);
    assert.equal(newerScissors!.classList.contains("scissorsExcluded"), true);
    assert.equal(newerScissors!.classList.contains("scissorsMark"), false);
});

test("test_with_no_pending_mark_every_scissors_has_no_extra_class", () => {
    // Step: no pending mark.
    buildBranchWithCommitStrip();
    renderBarsCutStrip(NO_HANDLERS);
    // Step: every scissors has only its own class.
    assert.deepEqual(listScissors().map((scissors) => scissors.className), ["barsCutScissors", "barsCutScissors"]);
});

test("test_after_a_new_jfred_commit_the_strip_drops_the_scissors_of_rows_that_no_longer_differ", () => {
    // Step: draw. Scissors on rows 0 and 1.
    buildBranchWithCommitStrip();
    renderBarsCutStrip(NO_HANDLERS);
    assert.equal(listScissors().length, 2);
    // Step: a new jfred commit lands on row 1 (h10) and the strip is drawn again.
    appendCommit({ instant: buildInstant(10), shortHash: "tip00002", parentShortHash: "tip00001", message: "second" });
    renderBarsCutStrip(NO_HANDLERS);
    // Step: only row 0 keeps a scissors.
    assert.deepEqual(listScissors().map((scissors) => scissors.dataset.rowIndex), ["0"]);
});

test("test_with_a_pending_mark_a_dotted_line_runs_from_the_mark_row_to_the_tip_row", () => {
    // Step: the mark is on row 1 (25 percent). The tip is on row 2 (50 percent).
    buildBranchWithCommitStrip();
    setPending({ instant: buildInstant(10), message: "m" });
    renderBarsCutStrip(NO_HANDLERS);
    // Step: the dotted line starts at 25 percent and is 25 percent wide.
    const line = readStrip().querySelector<HTMLElement>(".barsCutDottedLine")!;
    assert.equal(line.style.left, "25%");
    assert.equal(line.style.width, "25%");
});

test("test_with_a_pending_mark_the_commit_button_shows", () => {
    // Step: a pending mark and a recording handler.
    buildBranchWithCommitStrip();
    setPending({ instant: buildInstant(10), message: "m" });
    let commitClickCount = 0;
    renderBarsCutStrip({ commitPendingMark: () => { commitClickCount += 1; }, askDeleteBranch: () => {} });
    // Step: the button reads "Commit" and its click calls the handler once.
    const button = document.getElementById("barsCutCommitButton")!;
    assert.equal(button.textContent, "Commit");
    button.click();
    assert.equal(commitClickCount, 1);
});

test("test_with_no_pending_mark_the_commit_button_does_not_show", () => {
    // Step: no pending mark.
    buildBranchWithCommitStrip();
    renderBarsCutStrip(NO_HANDLERS);
    // Step: no Commit button.
    assert.equal(document.getElementById("barsCutCommitButton"), null);
});

test("test_with_no_pending_mark_the_hint_reads_click_scissors_to_mark", () => {
    // Step: no pending mark.
    buildBranchWithCommitStrip();
    renderBarsCutStrip(NO_HANDLERS);
    // Step: the hint shows.
    assert.equal(readStrip().querySelector(".barsCutHint")!.textContent, "click scissors to mark");
});

test("test_a_click_on_a_scissors_clicks_the_real_tick_of_that_row_once", () => {
    // Step: draw the strip and put a recording listener on the real tick of row 1.
    buildBranchWithCommitStrip();
    renderBarsCutStrip(NO_HANDLERS);
    const tick = findRealRulerTickAtRowIndex(1);
    let tickClickCount = 0;
    tick.addEventListener("click", () => { tickClickCount += 1; });
    // Step: click the row 1 scissors.
    listScissors()[1]!.click();
    // Step: the real tick got one click.
    assert.equal(tickClickCount, 1);
});

test("test_a_click_on_a_scissors_scrolls_the_real_ruler_row_into_view", () => {
    // Step: draw the strip and record the scroll call of the real tick of row 1.
    buildBranchWithCommitStrip();
    renderBarsCutStrip(NO_HANDLERS);
    const scrollOptionsList: unknown[] = [];
    findRealRulerTickAtRowIndex(1).scrollIntoView = (options?: unknown) => { scrollOptionsList.push(options); };
    // Step: click the row 1 scissors.
    listScissors()[1]!.click();
    // Step: the tick was scrolled to the centre once.
    assert.deepEqual(scrollOptionsList, [{ block: "center" }]);
});

test("test_while_the_history_loads_the_strip_has_no_middle_content", () => {
    // Step: the history is loading.
    buildBranchWithCommitStrip();
    getBarsViewState().isHistoryLoading = true;
    renderBarsCutStrip(NO_HANDLERS);
    // Step: the strip has its left and right columns, and an empty middle column.
    assert.equal(readStrip().querySelector(".barsCutDeleteBranch")!.textContent, "Delete jfred branch");
    assert.equal(readStrip().querySelector(".barsCutBranchLabel")!.textContent, "jfred branch");
    assert.equal(readStrip().querySelector(".barsCutStripMiddle")!.children.length, 0);
    getBarsViewState().isHistoryLoading = false;
});

test("test_a_second_draw_replaces_the_content_and_keeps_one_strip", () => {
    // Step: draw twice.
    buildBranchWithCommitStrip();
    renderBarsCutStrip(NO_HANDLERS);
    renderBarsCutStrip(NO_HANDLERS);
    // Step: one strip, one set of scissors, one branch line.
    assert.equal(document.querySelectorAll("#barsCutStrip").length, 1);
    assert.equal(listScissors().length, 2);
    assert.equal(readStrip().querySelectorAll(".barsCutBranchLine").length, 1);
});

test("test_scissors_are_right_after_a_ruler_redraw", () => {
    // Step: draw with the five rows.
    buildBranchWithCommitStrip();
    renderBarsCutStrip(NO_HANDLERS);
    // Step: redraw the real ruler with a newer row on top: h14 h12 h10 h8 h4. The Bars state keeps its old rows.
    fillRulerWithRows([[14], [12], [10], [8], [4]]);
    renderBarsCutStrip(NO_HANDLERS);
    // Step: the tip (h8) is now row 3 and the base row 4. File A changes on rows 1 and 2. Nothing throws.
    assert.deepEqual(listScissors().map((scissors) => [scissors.dataset.rowIndex, scissors.style.left]), [["1", "25%"], ["2", "50%"]]);
    const line = readStrip().querySelector<HTMLElement>(".barsCutBranchLine")!;
    assert.equal(line.style.left, "75%");
    assert.equal(line.style.width, "25%");
});

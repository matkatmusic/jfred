import assert from "node:assert/strict";
import { test } from "node:test";
import { BarsViewMode, setBarsViewMode } from "../webapp/layer1-components/bars-view/layer1-bars-mode.ts";
import { buildBarFileModels } from "../webapp/layer1-components/bars-view/layer1-bars-model.ts";
import { findRealRulerTickAtRowIndex, findRulerRowIndexForInstant, listRealRulerRows } from "../webapp/layer1-components/bars-view/layer1-bars-ruler.ts";
import {
    isCommitAChangeOfFile,
    isFileContentChanged,
    isRowChangedSinceTip,
    listChangedRowIndexesSinceTip,
    readTickIsChangedSinceTip,
    readTreeHashAtInstant,
    selectInverseCommitAtInstant,
} from "../webapp/layer1-components/bars-view/layer1-bars-scissors.ts";
import { getBarsViewState } from "../webapp/layer1-components/bars-view/layer1-bars-state.ts";
import { InverseMoment, type InverseCommitWire } from "../webapp/layer1-components/bars-view/layer1-bars-wire.ts";
import { deleteJfredBranch, setBase } from "../webapp/layer1-components/commits-column/layer1-jfred-state.ts";
import type { RulerRow } from "../webapp/layer1-components/ruler/layer1-ruler-rows.ts";
import { storeRow } from "../webapp/layer1-components/ruler/layer1-tick-events.ts";
import { buildDiskNowCommit, buildInverseCommit, buildInverseFile, initBarsDom } from "./layer1-bars-test-helpers.ts";

const DAY_START_MS = Date.parse("2026-11-13T00:00:00.000Z");
const HOUR_MS = 3600_000;

function buildInstant(hour: number): string {
    return new Date(DAY_START_MS + hour * HOUR_MS).toISOString();
}

function buildHourMs(hour: number): number {
    return DAY_START_MS + hour * HOUR_MS;
}

function buildCommit(hour: number, treeHash: string, moment: string = InverseMoment.atEvent): InverseCommitWire {
    return buildInverseCommit({ instant: buildInstant(hour), treeHash, moment });
}

function buildRow(hours: number[]): RulerRow {
    const instants = hours.map(buildInstant);
    return { axisPx: 0, text: "r", eventCount: instants.length, axisPxList: instants.map(() => 0), instants };
}

// rowsNewestFirst: each row is its list of hours. Ticks sit in the page oldest first, so they are stored in reverse.
function buildRulerWithRows(rowsNewestFirst: number[][]): RulerRow[] {
    initBarsDom();
    const appWindow = document.createElement("div");
    appWindow.id = "appWindow";
    document.body.appendChild(appWindow);
    const ruler = document.createElement("div");
    ruler.id = "timelineRulerComponent";
    document.body.appendChild(ruler);
    for (const hours of [...rowsNewestFirst].reverse()) {
        const tick = document.createElement("div");
        tick.className = "tick";
        ruler.appendChild(tick);
        storeRow(tick, buildRow(hours));
    }
    deleteJfredBranch();
    return listRealRulerRows();
}

function putFiles(files: Array<[string, InverseCommitWire[]]>): void {
    const state = getBarsViewState();
    state.models = buildBarFileModels(files.map(([file, commits]) => buildInverseFile(file, commits)), listRealRulerRows());
}

test("test_content_at_an_instant_is_the_at_event_commit_at_or_before_it", () => {
    // Step: two at-event commits, newest first.
    const commits = [buildCommit(10, "t10"), buildCommit(5, "t5")];
    // Step: an instant between them picks the older one.
    assert.equal(selectInverseCommitAtInstant(commits, buildHourMs(7))?.treeHash, "t5");
    // Step: an instant equal to the newer commit picks the newer one.
    assert.equal(selectInverseCommitAtInstant(commits, buildHourMs(10))?.treeHash, "t10");
});

test("test_content_at_an_instant_before_the_oldest_commit_is_unknown", () => {
    // Step: an instant older than every commit gives no commit.
    const commits = [buildCommit(10, "t10"), buildCommit(5, "t5")];
    assert.equal(selectInverseCommitAtInstant(commits, buildHourMs(3)), undefined);
    assert.equal(readTreeHashAtInstant(commits, buildHourMs(3)), undefined);
});

test("test_content_at_an_instant_uses_the_before_event_commit_when_it_is_the_newer_neighbour", () => {
    // Step: the commit at or before the instant is before-event and the newer neighbour is before-event too.
    const commits = [buildCommit(10, "tb10", InverseMoment.beforeEvent), buildCommit(5, "tb5", InverseMoment.beforeEvent)];
    // Step: the newer neighbour holds the state.
    assert.equal(readTreeHashAtInstant(commits, buildHourMs(7)), "tb10");
});

test("test_content_at_an_instant_is_unknown_when_a_before_event_commit_has_no_before_event_newer_neighbour", () => {
    // Step: the newer neighbour is at-event.
    const withAtEventNeighbour = [buildCommit(10, "t10"), buildCommit(5, "tb5", InverseMoment.beforeEvent)];
    assert.equal(readTreeHashAtInstant(withAtEventNeighbour, buildHourMs(7)), undefined);
    // Step: there is no newer neighbour.
    const withNoNeighbour = [buildCommit(5, "tb5", InverseMoment.beforeEvent)];
    assert.equal(readTreeHashAtInstant(withNoNeighbour, buildHourMs(7)), undefined);
});

test("test_a_commit_with_no_instant_is_skipped_when_reading_content", () => {
    // Step: a DiskNow commit with a null instant sits first.
    const commits = [buildDiskNowCommit({ treeHash: "now" }), buildCommit(5, "t5")];
    // Step: the walk skips it.
    assert.equal(readTreeHashAtInstant(commits, buildHourMs(7)), "t5");
});

test("test_text_to_other_text_is_a_change", () => {
    assert.equal(isFileContentChanged("a", "b"), true);
});

test("test_text_to_the_same_text_is_no_change", () => {
    assert.equal(isFileContentChanged("a", "a"), false);
});

test("test_text_to_absent_is_a_change", () => {
    assert.equal(isFileContentChanged("a", "empty"), true);
});

test("test_absent_to_text_is_a_change", () => {
    assert.equal(isFileContentChanged("empty", "a"), true);
});

test("test_absent_to_absent_is_no_change", () => {
    assert.equal(isFileContentChanged("empty", "empty"), false);
});

test("test_unknown_on_the_row_is_no_change", () => {
    assert.equal(isFileContentChanged("a", undefined), false);
    assert.equal(isFileContentChanged(undefined, undefined), false);
});

test("test_unknown_at_the_tip_and_text_on_the_row_is_a_change", () => {
    assert.equal(isFileContentChanged(undefined, "a"), true);
});

test("test_unknown_at_the_tip_and_absent_on_the_row_is_a_change", () => {
    assert.equal(isFileContentChanged(undefined, "empty"), true);
});

test("test_a_commit_with_the_same_hash_as_its_next_older_commit_is_not_a_change", () => {
    // Step: a full read repeats the bytes of the older commit.
    const commits = [buildCommit(10, "a"), buildCommit(5, "a")];
    assert.equal(isCommitAChangeOfFile(commits, 0), false);
});

test("test_a_commit_with_a_different_hash_from_its_next_older_commit_is_a_change", () => {
    // Step: text to other text.
    assert.equal(isCommitAChangeOfFile([buildCommit(10, "b"), buildCommit(5, "a")], 0), true);
    // Step: text to absent.
    assert.equal(isCommitAChangeOfFile([buildCommit(10, "empty"), buildCommit(5, "a")], 0), true);
    // Step: absent to text.
    assert.equal(isCommitAChangeOfFile([buildCommit(10, "a"), buildCommit(5, "empty")], 0), true);
});

test("test_a_commit_with_no_older_commit_is_a_change", () => {
    assert.equal(isCommitAChangeOfFile([buildCommit(10, "a")], 0), true);
});

test("test_a_commit_whose_older_commit_is_not_at_event_is_a_change", () => {
    // Step: the older commit holds the state before its event, so the state after it is unknown, even with equal hashes.
    const commits = [buildCommit(10, "a"), buildCommit(5, "a", InverseMoment.beforeEvent)];
    assert.equal(isCommitAChangeOfFile(commits, 0), true);
});

test("test_a_commit_with_no_instant_is_a_change_on_row_zero_when_its_hash_differs", () => {
    // Step: rows h12 (row 0), h10 (row 1), h8 (row 2).
    const rows = buildRulerWithRows([[12], [10], [8]]);
    // Step: the file has a DiskNow commit (null instant) that differs from the older commit.
    putFiles([["A", [buildDiskNowCommit({ treeHash: "now" }), buildCommit(4, "old")]]]);
    const commits = getBarsViewState().models[0]!.commits;
    // Step: the DiskNow commit is a change and its row is row 0.
    assert.equal(isCommitAChangeOfFile(commits, 0), true);
    assert.equal(findRulerRowIndexForInstant(rows, commits[0]!.instant), 0);
    // Step: with the same hash as the older commit it is no change.
    assert.equal(isCommitAChangeOfFile([buildDiskNowCommit({ treeHash: "old" }), buildCommit(4, "old")], 0), false);
});

test("test_a_row_with_a_change_of_a_file_that_equals_the_tip_is_not_changed", () => {
    // Step: rows h12, h10, h8, h4. The tip is h6.
    const rows = buildRulerWithRows([[12], [10], [8], [4]]);
    // Step: A is x at the tip, y at h8, and x again at h10.
    putFiles([["A", [buildCommit(10, "x"), buildCommit(8, "y"), buildCommit(4, "x")]]]);
    // Step: the h10 row changed A back to the tip content, so it is not changed. The h8 row is.
    assert.equal(isRowChangedSinceTip(rows, 1, buildHourMs(6)), false);
    assert.equal(isRowChangedSinceTip(rows, 2, buildHourMs(6)), true);
});

test("test_a_row_with_no_change_of_a_differing_file_is_not_changed", () => {
    // Step: rows h12, h10, h8, h4. The tip is h6.
    const rows = buildRulerWithRows([[12], [10], [8], [4]]);
    // Step: A is a at the tip and b from h8 on. Only the h8 row holds a commit.
    putFiles([["A", [buildCommit(8, "b"), buildCommit(4, "a")]]]);
    // Step: rows h12 and h10 differ from the tip but hold no change.
    assert.equal(isRowChangedSinceTip(rows, 0, buildHourMs(6)), false);
    assert.equal(isRowChangedSinceTip(rows, 1, buildHourMs(6)), false);
    assert.equal(isRowChangedSinceTip(rows, 2, buildHourMs(6)), true);
});

test("test_the_row_time_is_the_newest_instant_of_a_merged_row", () => {
    // Step: rows h12, then a merged row h9 and h10, then h4. The tip is h6.
    const rows = buildRulerWithRows([[12], [9, 10], [4]]);
    // Step: A is x at the tip, y at h9, x again at h10 (both changes sit in the merged row).
    putFiles([["A", [buildCommit(10, "x"), buildCommit(9, "y"), buildCommit(4, "x")]]]);
    // Step: the row content is the later change, equal to the tip, so the row is not changed.
    assert.equal(isRowChangedSinceTip(rows, 1, buildHourMs(6)), false);
});

test("test_a_row_with_only_a_same_bytes_commit_of_a_file_gives_no_scissors", () => {
    // Step: rows h12, h10, h8, h4. The tip is h6.
    const rows = buildRulerWithRows([[12], [10], [8], [4]]);
    // Step: A differs from the tip since h8, and its only commit on the h10 row repeats the bytes of the h8 commit.
    putFiles([["A", [buildCommit(10, "b"), buildCommit(8, "b"), buildCommit(4, "a")]]]);
    // Step: the h10 row has no scissors, the h8 row has one.
    assert.equal(isRowChangedSinceTip(rows, 1, buildHourMs(6)), false);
    assert.equal(isRowChangedSinceTip(rows, 2, buildHourMs(6)), true);
});

test("test_a_row_where_f_equals_the_commit_and_only_f_changed_has_no_scissors_after_the_commit", () => {
    // Step: rows h12, h10, h8, h4. The tip is h6.
    const rows = buildRulerWithRows([[12], [10], [8], [4]]);
    // Step: F at the tip is F@c. F on the h10 row repeats F@c from the h8 row.
    putFiles([["F", [buildCommit(10, "F@c"), buildCommit(8, "F@c"), buildCommit(4, "F@c")]]]);
    // Step: the h10 row has no scissors.
    assert.equal(isRowChangedSinceTip(rows, 1, buildHourMs(6)), false);
});

test("test_a_row_where_f_equals_the_commit_but_a_also_changed_keeps_its_scissors_after_the_commit", () => {
    // Step: the same state, and A also changes on the h10 row.
    const rows = buildRulerWithRows([[12], [10], [8], [4]]);
    putFiles([
        ["F", [buildCommit(10, "F@c"), buildCommit(8, "F@c"), buildCommit(4, "F@c")]],
        ["A", [buildCommit(10, "A@10"), buildCommit(4, "A@4")]],
    ]);
    // Step: the h10 row keeps its scissors through A.
    assert.equal(isRowChangedSinceTip(rows, 1, buildHourMs(6)), true);
});

test("test_the_user_example_after_marking_r4_keeps_the_scissors_of_r5_to_r11", () => {
    // Step: the base row is h5. Row rK is hour 10 + K, so r1 is h11 and r11 is h21. Rows are listed newest first: index 0 is r11, index 10 is r1, index 11 is the base row.
    const rowsNewestFirst: number[][] = [];
    for (let rowNumber = 11; rowNumber >= 1; rowNumber--) {
        rowsNewestFirst.push([10 + rowNumber]);
    }
    rowsNewestFirst.push([5]);
    const rows = buildRulerWithRows(rowsNewestFirst);
    // Step: the files that change on each row.
    const filesByRow: Record<number, string[]> = {
        1: ["A", "B", "D", "E"], 2: ["F"], 3: ["C", "F"], 4: ["E"], 5: ["A"], 6: ["C", "A", "D"],
        7: ["A"], 8: ["C", "A"], 9: ["F", "A"], 10: ["B"], 11: ["A"],
    };
    // Step: each change has the tree hash <file>@r<row>, except F on r9 which repeats F@r3. Every file has an at-event base commit <file>@base.
    const commitsByFile = new Map<string, InverseCommitWire[]>();
    for (const file of ["A", "B", "C", "D", "E", "F"]) {
        const commits: InverseCommitWire[] = [];
        for (let rowNumber = 11; rowNumber >= 1; rowNumber--) {
            if (filesByRow[rowNumber]!.includes(file)) {
                const treeHash = file === "F" && rowNumber === 9 ? "F@r3" : `${file}@r${rowNumber}`;
                commits.push(buildCommit(10 + rowNumber, treeHash));
            }
        }
        commits.push(buildCommit(5, `${file}@base`));
        commitsByFile.set(file, commits);
    }
    putFiles([...commitsByFile.entries()]);
    // Step: before the commit the tip is the base (h5) and every row r1 to r11 is changed.
    assert.deepEqual(listChangedRowIndexesSinceTip(rows, buildHourMs(5)), [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
    // Step: after the commit the tip is the newest instant of r4 (h14). Rows r1 to r4 are not newer. Rows r5 to r11 are all changed.
    assert.deepEqual(listChangedRowIndexesSinceTip(rows, buildHourMs(14)), [0, 1, 2, 3, 4, 5, 6]);
});

test("test_a_new_tip_moves_the_changed_rows", () => {
    // Step: rows h12, h10, h8, h4. A changes on h8 and h12.
    const rows = buildRulerWithRows([[12], [10], [8], [4]]);
    putFiles([["A", [buildCommit(12, "c"), buildCommit(8, "b"), buildCommit(4, "a")]]]);
    // Step: the tip h6 gives the rows h12 and h8.
    assert.deepEqual(listChangedRowIndexesSinceTip(rows, buildHourMs(6)), [0, 2]);
    // Step: the tip h9 gives only the row h12.
    assert.deepEqual(listChangedRowIndexesSinceTip(rows, buildHourMs(9)), [0]);
});

test("test_tick_changed_since_tip_is_false_when_the_branch_has_no_tip", () => {
    // Step: a changed row but no base on the branch.
    buildRulerWithRows([[12], [4]]);
    putFiles([["A", [buildCommit(12, "b"), buildCommit(4, "a")]]]);
    // Step: the tick says false.
    assert.equal(readTickIsChangedSinceTip(findRealRulerTickAtRowIndex(0)), false);
});

test("test_tick_changed_since_tip_is_false_for_a_row_not_newer_than_the_tip", () => {
    // Step: rows h12 and h4. A changes on both. The tip is the base at h12.
    buildRulerWithRows([[12], [4]]);
    putFiles([["A", [buildCommit(12, "b"), buildCommit(4, "a")]]]);
    setBase({ instant: buildInstant(12), shortHash: "abc1234" });
    // Step: the h12 row is not newer than the tip.
    assert.equal(readTickIsChangedSinceTip(findRealRulerTickAtRowIndex(0)), false);
});

test("test_tick_changed_since_tip_gives_the_same_answer_in_bars_view_and_in_bubbles_view", () => {
    // Step: rows h12 and h4. A changes on h12. The tip is h6.
    buildRulerWithRows([[12], [4]]);
    putFiles([["A", [buildCommit(12, "b"), buildCommit(4, "a")]]]);
    setBase({ instant: buildInstant(6), shortHash: "abc1234" });
    const tick = findRealRulerTickAtRowIndex(0);
    // Step: the Bars view answers true.
    setBarsViewMode(BarsViewMode.bars);
    assert.equal(readTickIsChangedSinceTip(tick), true);
    // Step: the Bubbles view gives the same answer.
    setBarsViewMode(BarsViewMode.bubbles);
    assert.equal(readTickIsChangedSinceTip(tick), true);
});

test("test_scissors_are_right_after_a_ruler_redraw", () => {
    // Step: rows h12 and h4. A changes on h12. The tip is h6.
    buildRulerWithRows([[12], [4]]);
    const files: Array<[string, InverseCommitWire[]]> = [["A", [buildCommit(12, "b"), buildCommit(4, "a")]]];
    putFiles(files);
    setBase({ instant: buildInstant(6), shortHash: "abc1234" });
    assert.deepEqual(listChangedRowIndexesSinceTip(listRealRulerRows(), buildHourMs(6)), [0]);
    // Step: redraw the real ruler with other rows (h14, h12, h4) and leave state.rulerRows alone.
    const ruler = document.getElementById("timelineRulerComponent")!;
    ruler.replaceChildren();
    for (const hours of [[4], [12], [14]]) {
        const tick = document.createElement("div");
        tick.className = "tick";
        ruler.appendChild(tick);
        storeRow(tick, buildRow(hours));
    }
    // Step: the new row 0 (h14) holds no commit, the new row 1 (h12) holds the change. Nothing throws.
    assert.equal(readTickIsChangedSinceTip(findRealRulerTickAtRowIndex(0)), false);
    assert.equal(readTickIsChangedSinceTip(findRealRulerTickAtRowIndex(1)), true);
    assert.deepEqual(listChangedRowIndexesSinceTip(listRealRulerRows(), buildHourMs(6)), [1]);
});

test("test_an_empty_ruler_with_no_models_gives_no_scissors_and_no_throw", () => {
    // Step: a real ruler with no rows and no file models (empty project, or a filter hides every event).
    getBarsViewState().models = [];
    // Step: the list of changed rows is empty and nothing throws.
    assert.deepEqual(listChangedRowIndexesSinceTip([], buildHourMs(6)), []);
});

test("test_a_row_index_with_no_row_throws", () => {
    // Step: two rows.
    const rows = buildRulerWithRows([[12], [4]]);
    putFiles([["A", [buildCommit(12, "b"), buildCommit(4, "a")]]]);
    // Step: row index 5 does not exist.
    assert.throws(() => isRowChangedSinceTip(rows, 5, buildHourMs(6)), /no ruler row at the index/);
});

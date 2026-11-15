import assert from "node:assert/strict";
import { test } from "node:test";
import { rememberDrawnView } from "../webapp/layer1-components/bubbles/layer1-diff-wash.ts";
import {
    listBarsMarkableRowIndexes,
    listBarsSnapLines,
    readBarsBaseCommitHash,
    readBarsTickBeaconFacts,
} from "../webapp/layer1-components/bars-view/layer1-bars-cut-facts.ts";
import { buildBarFileModels } from "../webapp/layer1-components/bars-view/layer1-bars-model.ts";
import { findRealRulerTickAtRowIndex, listRealRulerRows } from "../webapp/layer1-components/bars-view/layer1-bars-ruler.ts";
import { getBarsViewState } from "../webapp/layer1-components/bars-view/layer1-bars-state.ts";
import type { InverseCommitWire } from "../webapp/layer1-components/bars-view/layer1-bars-wire.ts";
import { deleteJfredBranch, setBase } from "../webapp/layer1-components/commits-column/layer1-jfred-state.ts";
import type { RulerRow } from "../webapp/layer1-components/ruler/layer1-ruler-rows.ts";
import { storeRow } from "../webapp/layer1-components/ruler/layer1-tick-events.ts";
import type { WireLayer1View } from "../webapp/layer1-wire.ts";
import { buildDiskNowCommit, buildInverseCommit, buildInverseFile, initBarsDom } from "./layer1-bars-test-helpers.ts";

const DAY_START_MS = Date.parse("2026-11-13T00:00:00.000Z");
const HOUR_MS = 3600_000;

function buildInstant(hour: number): string {
    return new Date(DAY_START_MS + hour * HOUR_MS).toISOString();
}

function buildHourMs(hour: number): number {
    return DAY_START_MS + hour * HOUR_MS;
}

function buildCommit(hour: number, eventType: string = "GitCommit", treeHash: string = `t${hour}`): InverseCommitWire {
    return buildInverseCommit({ instant: buildInstant(hour), eventType, treeHash });
}

function buildRow(hours: number[]): RulerRow {
    const instants = hours.map(buildInstant);
    return { axisPx: 0, text: "r", eventCount: instants.length, axisPxList: instants.map(() => 0), instants };
}

// rowsNewestFirst: each row is its list of hours. Ticks sit in the page oldest first, so they are stored in reverse.
function buildRulerWithRows(rowsNewestFirst: number[][]): void {
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
}

function putFiles(files: Array<[string, InverseCommitWire[]]>): void {
    const state = getBarsViewState();
    state.models = buildBarFileModels(files.map(([file, commits]) => buildInverseFile(file, commits)), listRealRulerRows());
}

function buildDrawnView(commits: Array<{ instant: string; hash: string }>): WireLayer1View {
    return {
        pairs: [{ path: "a.ts", commits: commits.map((commit) => ({ ...commit, axisPx: 0 })), onDisk: { instant: buildInstant(13), axisPx: 0 } }],
        gitOrphans: [],
        diskOrphans: [],
        ruler: [],
    };
}

test("test_a_row_with_a_commit_dot_is_a_beacon_row_and_a_commit_row", () => {
    // Step: three rows. One file has a commit event at h8.
    buildRulerWithRows([[12], [8], [4]]);
    putFiles([["a.ts", [buildCommit(8)]]]);
    // Step: the h8 row is a beacon row and a commit row.
    const facts = readBarsTickBeaconFacts(findRealRulerTickAtRowIndex(1));
    assert.equal(facts.isBeacon, true);
    assert.equal(facts.isCommit, true);
});

test("test_a_row_with_only_a_created_dot_is_not_a_beacon_row", () => {
    // Step: a file is written at h12 and was created (absent) at h4.
    buildRulerWithRows([[12], [8], [4]]);
    putFiles([["a.ts", [buildCommit(12, "WriteRow"), buildInverseCommit({ instant: buildInstant(4), eventType: "WriteRow", isFileAbsent: true, treeHash: "empty" })]]]);
    // Step: the h4 row holds only the created dot, so it is no beacon row.
    assert.equal(readBarsTickBeaconFacts(findRealRulerTickAtRowIndex(2)).isBeacon, false);
});

test("test_a_row_with_only_a_script_dot_is_not_a_beacon_row", () => {
    // Step: the only dot of the file is a script run at h8.
    buildRulerWithRows([[12], [8], [4]]);
    putFiles([["a.ts", [buildCommit(8, "ScriptReadOnly")]]]);
    // Step: the h8 row is no beacon row (P2 = A).
    assert.equal(readBarsTickBeaconFacts(findRealRulerTickAtRowIndex(1)).isBeacon, false);
});

test("test_a_row_with_no_dot_is_not_a_beacon_row", () => {
    // Step: the file has dots at h12 and h4 only.
    buildRulerWithRows([[12], [8], [4]]);
    putFiles([["a.ts", [buildCommit(12), buildCommit(4)]]]);
    // Step: the h8 row has no dot, so it is neither beacon nor commit.
    const facts = readBarsTickBeaconFacts(findRealRulerTickAtRowIndex(1));
    assert.equal(facts.isBeacon, false);
    assert.equal(facts.isCommit, false);
});

test("test_the_newest_row_is_a_beacon_row_because_a_file_on_disk_has_a_disk_dot", () => {
    // Step: the file is on disk now (DiskNow commit, no instant) and has a commit at h4.
    buildRulerWithRows([[12], [4]]);
    putFiles([["a.ts", [buildDiskNowCommit({ treeHash: "now" }), buildCommit(4)]]]);
    // Step: the newest row is a beacon row but not a commit row.
    const facts = readBarsTickBeaconFacts(findRealRulerTickAtRowIndex(0));
    assert.equal(facts.isBeacon, true);
    assert.equal(facts.isCommit, false);
});

test("test_a_file_gone_now_has_no_disk_dot_so_it_makes_the_newest_row_no_beacon_row", () => {
    // Step: one file, gone now: DiskNow absent, removed at h8, present at h4.
    buildRulerWithRows([[12], [8], [4]]);
    putFiles([["a.ts", [
        buildDiskNowCommit({ isFileAbsent: true, treeHash: "empty" }),
        buildInverseCommit({ instant: buildInstant(8), eventType: "WriteRow", isFileAbsent: true, isRemoved: true, treeHash: "empty" }),
        buildCommit(4),
    ]]]);
    // Step: the newest row holds no dot of the file.
    assert.equal(readBarsTickBeaconFacts(findRealRulerTickAtRowIndex(0)).isBeacon, false);
});

test("test_a_row_with_only_a_deleted_dot_is_not_a_beacon_row", () => {
    // Step: the same gone file. Its deleted dot sits on the h8 row.
    buildRulerWithRows([[12], [8], [4]]);
    putFiles([["a.ts", [
        buildDiskNowCommit({ isFileAbsent: true, treeHash: "empty" }),
        buildInverseCommit({ instant: buildInstant(8), eventType: "WriteRow", isFileAbsent: true, isRemoved: true, treeHash: "empty" }),
        buildCommit(4),
    ]]]);
    // Step: the h8 row holds only the deleted dot (P2 = A).
    assert.equal(readBarsTickBeaconFacts(findRealRulerTickAtRowIndex(1)).isBeacon, false);
});

test("test_the_facts_carry_the_newest_instant_of_a_merged_row_as_milliseconds", () => {
    // Step: the top row merges h11 and h12.
    buildRulerWithRows([[11, 12], [4]]);
    putFiles([["a.ts", [buildCommit(4)]]]);
    // Step: the facts time is h12, not h11.
    assert.equal(readBarsTickBeaconFacts(findRealRulerTickAtRowIndex(0)).instantMs, buildHourMs(12));
});

test("test_the_facts_carry_the_changed_since_tip_answer_of_the_row", () => {
    // Step: A changes at h12 (not at h4). The tip is h6.
    buildRulerWithRows([[12], [4]]);
    putFiles([["a.ts", [buildCommit(12), buildCommit(4)]]]);
    setBase({ instant: buildInstant(6), shortHash: "abc1234" });
    // Step: the h12 row says changed. The h4 row is not newer than the tip, so it says not changed.
    assert.equal(readBarsTickBeaconFacts(findRealRulerTickAtRowIndex(0)).isChangedSinceTip, true);
    assert.equal(readBarsTickBeaconFacts(findRealRulerTickAtRowIndex(1)).isChangedSinceTip, false);
});

test("test_scissors_are_right_after_a_ruler_redraw", () => {
    // Step: rows h12 and h4. A changes at h12. The tip is h6.
    buildRulerWithRows([[12], [4]]);
    putFiles([["a.ts", [buildCommit(12), buildCommit(4)]]]);
    setBase({ instant: buildInstant(6), shortHash: "abc1234" });
    assert.deepEqual(listBarsMarkableRowIndexes(buildHourMs(6)), [0]);
    // Step: redraw the real ruler with rows h14, h12, h4 and leave state.rulerRows alone.
    const ruler = document.getElementById("timelineRulerComponent")!;
    ruler.replaceChildren();
    for (const hours of [[4], [12], [14]]) {
        const tick = document.createElement("div");
        tick.className = "tick";
        ruler.appendChild(tick);
        storeRow(tick, buildRow(hours));
    }
    // Step: the markable row follows the new rows (h12 is row 1 now) and nothing throws.
    assert.deepEqual(listBarsMarkableRowIndexes(buildHourMs(6)), [1]);
    // Step: the facts of the new tick at row 1 follow the new rows too.
    const facts = readBarsTickBeaconFacts(findRealRulerTickAtRowIndex(1));
    assert.equal(facts.isBeacon, true);
    assert.equal(facts.isChangedSinceTip, true);
    assert.equal(facts.instantMs, buildHourMs(12));
});

test("test_facts_before_the_load_ends_find_no_beacon", () => {
    // Step: rows but no file models yet.
    buildRulerWithRows([[12], [4]]);
    getBarsViewState().models = [];
    // Step: no beacon, no commit.
    const facts = readBarsTickBeaconFacts(findRealRulerTickAtRowIndex(0));
    assert.equal(facts.isBeacon, false);
    assert.equal(facts.isCommit, false);
});

test("test_markable_rows_with_a_tip_are_the_changed_rows_newer_than_the_tip", () => {
    // Step: rows h12, h10, h8, h4. A changes at h12, h8 and h4. The tip is h6.
    buildRulerWithRows([[12], [10], [8], [4]]);
    putFiles([["a.ts", [buildCommit(12), buildCommit(8), buildCommit(4)]]]);
    // Step: h12 and h8 are markable. h10 changed nothing and h4 is not newer than the tip.
    assert.deepEqual(listBarsMarkableRowIndexes(buildHourMs(6)), [0, 2]);
});

test("test_markable_rows_with_no_tip_are_the_commit_rows_only", () => {
    // Step: rows h12, h8, h4. The file has a write at h12, a commit at h8 and a snapshot at h4.
    buildRulerWithRows([[12], [8], [4]]);
    putFiles([["a.ts", [buildCommit(12, "WriteRow"), buildCommit(8), buildCommit(4, "BackupSnapshot")]]]);
    // Step: with no tip only the commit row is markable.
    assert.deepEqual(listBarsMarkableRowIndexes(undefined), [1]);
});

test("test_a_snap_line_reads_path_dot_kind_label_and_iso_time", () => {
    // Step: a file with an edit at h12, a snapshot at h8 and a commit at h4. The mark is h8.
    buildRulerWithRows([[12], [8], [4]]);
    putFiles([["src/a.ts", [buildCommit(12, "EditRow"), buildCommit(8, "BackupSnapshot"), buildCommit(4)]]]);
    // Step: the line comes from the first beacon dot at or older than the mark row.
    assert.deepEqual(listBarsSnapLines(buildHourMs(8)), [`src/a.ts: snapshot at ${buildInstant(8)}`]);
});

test("test_the_snap_line_of_a_disk_dot_says_now", () => {
    // Step: the file is on disk now and has a commit at h4. The mark is h12 (the newest row).
    buildRulerWithRows([[12], [4]]);
    putFiles([["src/a.ts", [buildDiskNowCommit({ treeHash: "now" }), buildCommit(4)]]]);
    // Step: the disk dot has no instant, so the line says now.
    assert.deepEqual(listBarsSnapLines(buildHourMs(12)), ["src/a.ts: disk now at now"]);
});

test("test_snap_lines_skip_a_file_with_no_beacon_dot_before_the_mark", () => {
    // Step: file X has only a script dot at h4. File Y has a commit at h4. The mark is h8.
    buildRulerWithRows([[12], [8], [4]]);
    putFiles([
        ["x.ts", [buildCommit(4, "ScriptReadOnly")]],
        ["y.ts", [buildCommit(4)]],
    ]);
    // Step: only Y gets a line.
    assert.deepEqual(listBarsSnapLines(buildHourMs(8)), [`y.ts: commit at ${buildInstant(4)}`]);
});

test("test_snap_lines_skip_a_file_that_is_gone_at_the_mark", () => {
    // Step: a file removed at h8 (gone now) that has a commit at h4.
    buildRulerWithRows([[12], [8], [4]]);
    putFiles([["a.ts", [
        buildDiskNowCommit({ isFileAbsent: true, treeHash: "empty" }),
        buildInverseCommit({ instant: buildInstant(8), eventType: "WriteRow", isFileAbsent: true, isRemoved: true, treeHash: "empty" }),
        buildCommit(4),
    ]]]);
    // Step: the mark h12 is newer than the removal, so the file is gone there and gets no line.
    assert.deepEqual(listBarsSnapLines(buildHourMs(12)), []);
    // Step: the mark h4 is older than the removal, so the file exists there and gets a line.
    assert.deepEqual(listBarsSnapLines(buildHourMs(4)), [`a.ts: commit at ${buildInstant(4)}`]);
});

// Runs before every test that calls rememberDrawnView: the drawn view is module state and starts undefined.
test("test_base_hash_throws_when_there_is_no_drawn_view", () => {
    // Step: rows exist but the stage never drew a view.
    buildRulerWithRows([[12], [8], [4]]);
    // Step: the read throws.
    assert.throws(() => readBarsBaseCommitHash(findRealRulerTickAtRowIndex(1)), /no drawn view/);
});

test("test_base_hash_is_the_full_hash_of_the_drawn_view_commit_on_the_row", () => {
    // Step: a drawn view with a project commit at h8.
    buildRulerWithRows([[12], [8], [4]]);
    const fullHash = "0123456789abcdef0123456789abcdef01234567";
    rememberDrawnView(buildDrawnView([{ instant: buildInstant(8), hash: fullHash }]));
    // Step: the h8 row gives the full hash.
    assert.equal(readBarsBaseCommitHash(findRealRulerTickAtRowIndex(1)), fullHash);
});

test("test_base_hash_of_a_commit_inside_a_merged_row_is_found_by_the_ruler_row_rule", () => {
    // Step: the middle row merges h7 and h9. The project commit is at h8.
    buildRulerWithRows([[12], [7, 9], [4]]);
    rememberDrawnView(buildDrawnView([{ instant: buildInstant(8), hash: "inside" }]));
    // Step: the commit lands on the merged row.
    assert.equal(readBarsBaseCommitHash(findRealRulerTickAtRowIndex(1)), "inside");
});

test("test_base_hash_takes_the_newest_commit_when_several_land_on_the_row", () => {
    // Step: the middle row merges h7 and h9. Two project commits land on it (oldest first).
    buildRulerWithRows([[12], [7, 9], [4]]);
    rememberDrawnView(buildDrawnView([{ instant: buildInstant(8), hash: "older" }, { instant: buildInstant(9), hash: "newer" }]));
    // Step: the newest commit wins.
    assert.equal(readBarsBaseCommitHash(findRealRulerTickAtRowIndex(1)), "newer");
});

test("test_base_hash_throws_when_no_commit_is_found_for_the_row", () => {
    // Step: the only project commit is at h8 (row 1).
    buildRulerWithRows([[12], [8], [4]]);
    rememberDrawnView(buildDrawnView([{ instant: buildInstant(8), hash: "only" }]));
    // Step: the newest row holds no project commit.
    assert.throws(() => readBarsBaseCommitHash(findRealRulerTickAtRowIndex(0)), /no project commit on the ruler row/);
});

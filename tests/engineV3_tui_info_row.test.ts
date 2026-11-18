import assert from "node:assert/strict";
import { test } from "node:test";
import { FileWalkStatus } from "../src/structures/vocabulary.ts";
import { buildInfoBoxLines, type InfoRowInput } from "../engineV3/tui/engineV3_tui_info_row.tsx";
import type { FooterEntry } from "../engineV3/tui/engineV3_tui_footer.tsx";

const BOX_COLUMNS = 100;
// the box takes 2 border columns and 2 padding columns
const INNER_WIDTH = 96;

function makeInput(fileName: string, counts: [number, number, number, number, number] | undefined): InfoRowInput {
    let barInfo: InfoRowInput["barInfo"];
    if (counts !== undefined) {
        barInfo = { commitCount: counts[0], modifyingEventCount: counts[1], snapshotCount: counts[2], scriptCount: counts[3], failedReplayCount: counts[4], stateText: "ok", errorText: undefined };
    }
    return { fileName, barInfo, runState: { status: FileWalkStatus.Idle, reasonText: undefined, failedReplayCount: 0 }, ownTime: undefined, isTimeSpanned: true, scriptRefusalText: undefined };
}

// The text a box draws for one line: each entry is "label: value", and entries are 2 columns apart.
function drawLineText(line: FooterEntry[]): string {
    return line.map((entry) => `${entry.label}: ${entry.value}`).join("  ");
}

test("test_the_info_box_has_exactly_three_lines_with_or_without_facts", () => {
    // Scenario: one input with counts and one input with nothing to show.
    const withCounts = buildInfoBoxLines(makeInput("a.txt", [1, 2, 3, 4, 5]), BOX_COLUMNS);
    const withoutCounts = buildInfoBoxLines(makeInput("a.txt", undefined), BOX_COLUMNS);
    // Both give 3 lines.
    assert.equal(withCounts.length, 3);
    assert.equal(withoutCounts.length, 3);
});

test("test_line_one_has_the_file_at_the_left_and_the_state_at_the_right_edge", () => {
    // Scenario: file a.txt with state "ok" in a box of 100 columns.
    const lineOneText = drawLineText(buildInfoBoxLines(makeInput("a.txt", [1, 2, 3, 4, 5]), BOX_COLUMNS)[0]!);
    // The line starts with the file, ends with the state, and fills the inner width.
    assert.ok(lineOneText.startsWith("file: a.txt"));
    assert.ok(lineOneText.endsWith("state: ok"));
    assert.equal(lineOneText.length, INNER_WIDTH);
});

test("test_a_long_file_name_is_cut_with_an_ellipsis_and_the_state_stays_at_the_right_edge", () => {
    // Scenario: a file name of 200 characters.
    const lineOneText = drawLineText(buildInfoBoxLines(makeInput("x".repeat(200), [1, 2, 3, 4, 5]), BOX_COLUMNS)[0]!);
    // The name is cut with an ellipsis, the state is at the right edge, and the line is not wider than the box.
    assert.ok(lineOneText.includes("…"));
    assert.ok(lineOneText.endsWith("state: ok"));
    assert.equal(lineOneText.length, INNER_WIDTH);
});

test("test_line_two_shows_the_five_counts", () => {
    // Scenario: counts 1, 2, 3, 4, 5.
    const lineTwo = buildInfoBoxLines(makeInput("a.txt", [1, 2, 3, 4, 5]), BOX_COLUMNS)[1]!;
    // Each count has its label and its number.
    assert.deepEqual(lineTwo.map((entry) => [entry.label, entry.value.trim()]), [
        ["commits", "1"],
        ["modifying events in the log", "2"],
        ["snapshots", "3"],
        ["scripts", "4"],
        ["failed replays", "5"],
    ]);
});

test("test_the_count_labels_stay_at_the_same_columns_when_the_counts_and_the_file_change", () => {
    // Scenario: two files with very different counts and names.
    const lineTwoOfFirst = drawLineText(buildInfoBoxLines(makeInput("a.txt", [1, 2, 3, 4, 5]), BOX_COLUMNS)[1]!);
    const lineTwoOfSecond = drawLineText(buildInfoBoxLines(makeInput("a_much_longer_name.txt", [1000, 20, 300, 4000, 50]), BOX_COLUMNS)[1]!);
    // Every label starts in the same column in both lines.
    for (const label of ["commits:", "modifying events in the log:", "snapshots:", "scripts:", "failed replays:"]) {
        assert.equal(lineTwoOfFirst.indexOf(label), lineTwoOfSecond.indexOf(label), label);
    }
});

test("test_the_count_labels_stay_at_the_same_columns_when_the_file_has_no_counts_yet", () => {
    // Scenario: one file with counts and one file without bar info.
    const lineTwoWithCounts = drawLineText(buildInfoBoxLines(makeInput("a.txt", [1, 2, 3, 4, 5]), BOX_COLUMNS)[1]!);
    const lineTwoWithoutCounts = drawLineText(buildInfoBoxLines(makeInput("a.txt", undefined), BOX_COLUMNS)[1]!);
    // The labels are in the same columns and the numbers are blank.
    assert.equal(lineTwoWithoutCounts.indexOf("failed replays:"), lineTwoWithCounts.indexOf("failed replays:"));
    assert.equal(lineTwoWithoutCounts.trim().endsWith("failed replays:"), true);
});

test("test_line_three_shows_the_reason_the_script_text_the_own_time_and_the_walk_text", () => {
    // Scenario: a file with a reason, a script refusal text, an own time and no walk to this time.
    const input: InfoRowInput = { ...makeInput("a.txt", [1, 2, 3, 4, 5]), runState: { status: FileWalkStatus.Crashed, reasonText: "boom", failedReplayCount: 0 }, scriptRefusalText: "no scripts", ownTime: new Date("2026-01-02T03:04:05.000Z"), isTimeSpanned: false };
    const lineThree = buildInfoBoxLines(input, BOX_COLUMNS)[2]!;
    // Line 3 shows the four facts in that order.
    assert.deepEqual(lineThree, [
        { label: "reason", value: "boom" },
        { label: "script", value: "no scripts" },
        { label: "own time", value: "2026-01-02T03:04:05.000Z" },
        { label: "walk", value: "not walked to this time" },
    ]);
});

test("test_line_three_is_empty_when_there_is_no_fact_for_it", () => {
    // Scenario: a file with counts and nothing else.
    const lineThree = buildInfoBoxLines(makeInput("a.txt", [1, 2, 3, 4, 5]), BOX_COLUMNS)[2]!;
    // Line 3 has no entry.
    assert.deepEqual(lineThree, []);
});

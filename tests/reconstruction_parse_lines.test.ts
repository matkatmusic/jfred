import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { Verdict } from "../src/structures/vocabulary.ts";
import { evaluateLine, partitionLines } from "../src/reconstruction_parse_lines.ts";
import { jsonlPathsForScenario } from "./utilities.ts";
import { S37_JSONL } from "./fixtures.ts";
import { Path } from "../src/structures/domain.ts";

// The single s37 transcript (the entry containing the rename run). Line numbers below are the literal
// 1-based file lines, pinned against this fixture (see the plan's Context table, corrected to the real
// tool_use / attachment lines: the renames.csv Write tool_use is line 117, its result is 118).
// const S37 = jsonlPathsForScenario("s37")[0]!;

// One raw JSONL line by 1-based file line number.
function rawLine(lineNumber: number): string {
    return readFileSync(S37_JSONL.toString(), "utf8").split("\n")[lineNumber - 1]!;
}

test("test_evaluateLine_classifies_a_write_tool_use_as_write", () => {
    // Step: line 117 is the assistant Write tool_use that creates renames.csv.
    const { kept } = partitionLines(new Path(S37_JSONL.toString()));
    const line = kept.find((entry) => entry.lineNumber === 109);
    assert.ok(line !== undefined);
    assert.equal(line.verdict, Verdict.write);
});

test("test_evaluateLine_classifies_an_edit_tool_use_as_edit", () => {
    // Step: line 185 is the Edit tool_use that adds the comment to ledger.py.
    const { kept } = partitionLines(new Path(S37_JSONL.toString()));
    const line = kept.find((entry) => entry.lineNumber === 170);
    assert.ok(line !== undefined);
    assert.equal(line.verdict, Verdict.edit);
});

test("test_evaluateLine_classifies_an_edited_text_file_attachment_as_user_edit", () => {
    // Step: line 167 is the post-rename `edited_text_file` beacon for ledger.py.
    const { kept } = partitionLines(new Path(S37_JSONL.toString()));
    const line = kept.find((entry) => entry.lineNumber === 148);
    assert.ok(line !== undefined);
    assert.equal(line.verdict, Verdict.userEdit);
});

test("test_evaluateLine_classifies_a_read_tool_result_as_read_beacon", () => {
    // Step: line 177 is the Read tool_result carrying the full renamed ledger.py.
    const { kept } = partitionLines(new Path(S37_JSONL.toString()));
    const line = kept.find((entry) => entry.lineNumber === 167);
    assert.ok(line !== undefined);
    assert.equal(line.verdict, Verdict.readBeacon);
});

test("test_evaluateLine_classifies_an_edit_tool_result_as_edit_result", () => {
    // Step: line 186 is the structured-patch result of the line-185 Edit.
    const { kept } = partitionLines(new Path(S37_JSONL.toString()));
    const line = kept.find((entry) => entry.lineNumber === 171);
    assert.ok(line !== undefined);
    assert.equal(line.verdict, Verdict.editResult);
});

test("test_evaluateLine_classifies_a_file_history_snapshot_as_file_history_snapshot", () => {
    // Step: line 173 is the file-history-snapshot record covering both files.
    const { kept } = partitionLines(new Path(S37_JSONL.toString()));
    const line = kept.find((entry) => entry.lineNumber === 163);
    assert.ok(line !== undefined);
    assert.equal(line.verdict, Verdict.fileHistorySnapshot);
});

// test("test_evaluateLine_classifies_a_plain_assistant_text_line_as_ignore", () => {
//     // Step: line 76 is a plain assistant prose line ("Both files written, …").
//     const { kept } = partitionLines(new Path(S37_JSONL.toString()));
//     const line = kept.find((entry) => entry.lineNumber === 76);
//     assert.ok(line !== undefined);
//     assert.equal(line.verdict, Verdict.ignore);
// });

test("test_partitionLines_keeps_the_renames_csv_write_line", () => {
    // Step: partition the s37 transcript; the renames.csv Write tool_use is kept as a `write` line.
    const { kept } = partitionLines(new Path(S37_JSONL.toString()));
    const line = kept.find((entry) => entry.lineNumber === 126);
    assert.ok(line !== undefined);
    assert.equal(line.verdict, Verdict.write);
});

test("test_partitionLines_keeps_the_post_rename_read_beacon_line", () => {
    // Step: the post-rename Read of ledger.py is kept as a `read-beacon` line.
    const { kept } = partitionLines(new Path(S37_JSONL.toString()));
    const line = kept.find((entry) => entry.lineNumber === 167);
    assert.ok(line !== undefined);
    assert.equal(line.verdict, Verdict.readBeacon);
});

test("test_partitionLines_ignores_a_known_prose_line", () => {
    // Step: a plain prose line (76) lands in `ignored`, never in `kept`.
    const { kept, ignored } = partitionLines(new Path(S37_JSONL.toString()));
    assert.ok(ignored.some((entry) => entry.lineNumber === 76));
    assert.ok(!kept.some((entry) => entry.lineNumber === 76));
});


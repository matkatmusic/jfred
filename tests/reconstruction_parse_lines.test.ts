import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { Verdict } from "../src/structures/vocabulary.ts";
import { getLineVerdict, splitTranscriptLines } from "../src/reconstruction_parse_lines.ts";
import { getScenarioJsonlPaths } from "./scenario-locator.ts";
import { S37_JSONL } from "./fixtures.ts";
import { Path } from "../src/structures/domain.ts";

// The single s37 transcript (the entry containing the rename run). Line numbers below are the literal
// 1-based file lines, pinned against this fixture (see the plan's Context table, corrected to the real
// tool_use / attachment lines: the renames.csv Write tool_use is line 117, its result is 118).
// const S37 = getScenarioJsonlPaths("s37")[0]!;

// One raw JSONL line by 1-based file line number.
function rawLine(lineNumber: number): string {
    return readFileSync(S37_JSONL.toString(), "utf8").split("\n")[lineNumber - 1]!;
}

test("test_getLineVerdict_classifies_a_write_tool_use_as_write", () => {
    // Step: line 117 is the assistant Write tool_use that creates renames.csv.
    const { kept } = splitTranscriptLines(new Path(S37_JSONL.toString()));
    const line = kept.find((entry) => entry.lineNumber === 109);
    assert.ok(line !== undefined);
    assert.equal(line.verdict, Verdict.write);
});

test("test_getLineVerdict_classifies_an_edit_tool_use_as_edit", () => {
    // Step: line 185 is the Edit tool_use that adds the comment to ledger.py.
    const { kept } = splitTranscriptLines(new Path(S37_JSONL.toString()));
    const line = kept.find((entry) => entry.lineNumber === 170);
    assert.ok(line !== undefined);
    assert.equal(line.verdict, Verdict.edit);
});

test("test_getLineVerdict_classifies_an_edited_text_file_attachment_as_user_edit", () => {
    // Step: line 167 is the post-rename `edited_text_file` beacon for ledger.py.
    const { kept } = splitTranscriptLines(new Path(S37_JSONL.toString()));
    const line = kept.find((entry) => entry.lineNumber === 148);
    assert.ok(line !== undefined);
    assert.equal(line.verdict, Verdict.userEdit);
});

test("test_getLineVerdict_classifies_a_read_tool_result_as_read_beacon", () => {
    // Step: line 177 is the Read tool_result carrying the full renamed ledger.py.
    const { kept } = splitTranscriptLines(new Path(S37_JSONL.toString()));
    const line = kept.find((entry) => entry.lineNumber === 167);
    assert.ok(line !== undefined);
    assert.equal(line.verdict, Verdict.readBeacon);
});

test("test_getLineVerdict_classifies_an_edit_tool_result_as_edit_result", () => {
    // Step: line 186 is the structured-patch result of the line-185 Edit.
    const { kept } = splitTranscriptLines(new Path(S37_JSONL.toString()));
    const line = kept.find((entry) => entry.lineNumber === 171);
    assert.ok(line !== undefined);
    assert.equal(line.verdict, Verdict.editResult);
});

test("test_getLineVerdict_classifies_a_file_history_snapshot_as_file_history_snapshot", () => {
    // Step: line 173 is the file-history-snapshot record covering both files.
    const { kept } = splitTranscriptLines(new Path(S37_JSONL.toString()));
    const line = kept.find((entry) => entry.lineNumber === 163);
    assert.ok(line !== undefined);
    assert.equal(line.verdict, Verdict.fileHistorySnapshot);
});

// test("test_getLineVerdict_classifies_a_plain_assistant_text_line_as_ignore", () => {
//     // Step: line 76 is a plain assistant prose line ("Both files written, …").
//     const { kept } = splitTranscriptLines(new Path(S37_JSONL.toString()));
//     const line = kept.find((entry) => entry.lineNumber === 76);
//     assert.ok(line !== undefined);
//     assert.equal(line.verdict, Verdict.ignore);
// });

test("test_splitTranscriptLines_keeps_the_renames_csv_write_line", () => {
    // Step: partition the s37 transcript; the renames.csv Write tool_use is kept as a `write` line.
    const { kept } = splitTranscriptLines(new Path(S37_JSONL.toString()));
    const line = kept.find((entry) => entry.lineNumber === 126);
    assert.ok(line !== undefined);
    assert.equal(line.verdict, Verdict.write);
});

test("test_splitTranscriptLines_keeps_the_post_rename_read_beacon_line", () => {
    // Step: the post-rename Read of ledger.py is kept as a `read-beacon` line.
    const { kept } = splitTranscriptLines(new Path(S37_JSONL.toString()));
    const line = kept.find((entry) => entry.lineNumber === 167);
    assert.ok(line !== undefined);
    assert.equal(line.verdict, Verdict.readBeacon);
});

test("test_splitTranscriptLines_ignores_a_known_prose_line", () => {
    // Step: a plain prose line (76) lands in `ignored`, never in `kept`.
    const { kept, ignored } = splitTranscriptLines(new Path(S37_JSONL.toString()));
    assert.ok(ignored.some((entry) => entry.lineNumber === 76));
    assert.ok(!kept.some((entry) => entry.lineNumber === 76));
});

// The raw JSONL text of an assistant record that holds one Bash tool_use.
function buildBashToolUseLine(command: string): string {
    return JSON.stringify({
        type: "assistant",
        uuid: "record-1",
        timestamp: "2026-01-01T00:00:00Z",
        message: { content: [{ type: "tool_use", id: "toolu_1", name: "Bash", input: { command } }] },
    });
}

test("test_a_bash_line_with_a_file_op_after_a_double_ampersand_is_kept", () => {
    // Step: build a Bash line whose second piece is an rm.
    const rawLine = buildBashToolUseLine("ls && rm a.py");
    // Step: the verdict says the line is a file op.
    assert.equal(getLineVerdict(rawLine), Verdict.bashFileOp);
});

test("test_a_bash_line_with_no_file_op_in_any_piece_is_ignored", () => {
    // Step: build a Bash line whose pieces are ls and echo.
    const rawLine = buildBashToolUseLine("ls && echo done");
    // Step: the verdict says ignore.
    assert.equal(getLineVerdict(rawLine), Verdict.ignore);
});

test("test_a_bash_line_that_is_one_rm_is_kept", () => {
    // Step: build a Bash line that is one rm.
    const rawLine = buildBashToolUseLine("rm a.py");
    // Step: the verdict says the line is a file op.
    assert.equal(getLineVerdict(rawLine), Verdict.bashFileOp);
});


// The line search lists, for each file name, the log lines that hold that name.
import assert from "node:assert/strict";
import { test } from "node:test";
import { listLineSpansByNeedleText } from "../engineV3/engineV3_jsonl_lines_naming_files.ts";

const CWD_LINE = '{"cwd":"/p"}';
const ERROR_LINE = '{"is_error":true}';

function listLineTextsByNeedleText(logLines: string[], needleTexts: string[]): Map<string, string[]> {
    const logText = logLines.join("\n");
    const lineTextsByNeedleText = new Map<string, string[]>();
    for (const [needleText, spans] of listLineSpansByNeedleText(Buffer.from(logText), needleTexts)) {
        lineTextsByNeedleText.set(needleText, spans.map((span) => logText.slice(span.start, span.end)));
    }
    return lineTextsByNeedleText;
}

test("test_line_with_one_name_is_found", () => {
    // Scenario: a log has one line that holds a.txt and one line that holds nothing.
    const lineTexts = listLineTextsByNeedleText(["read a.txt", "other"], ["a.txt"]);
    // The list of a.txt holds only the first line.
    assert.deepEqual(lineTexts.get("a.txt"), ["read a.txt"]);
});

test("test_line_with_two_names_is_found_for_both", () => {
    // Scenario: one line holds a.txt and b.txt.
    const lineTexts = listLineTextsByNeedleText(["read a.txt b.txt"], ["a.txt", "b.txt"]);
    // Both lists hold the line.
    assert.deepEqual(lineTexts.get("a.txt"), ["read a.txt b.txt"]);
    assert.deepEqual(lineTexts.get("b.txt"), ["read a.txt b.txt"]);
});

test("test_name_inside_a_longer_name_is_found", () => {
    // Scenario: the line holds data.txt; the names are ta.txt and data.txt. The name ta.txt is inside data.txt.
    const lineTexts = listLineTextsByNeedleText(["read data.txt"], ["ta.txt", "data.txt"]);
    // Both lists hold the line.
    assert.deepEqual(lineTexts.get("ta.txt"), ["read data.txt"]);
    assert.deepEqual(lineTexts.get("data.txt"), ["read data.txt"]);
});

test("test_name_that_starts_another_name_is_found_for_both", () => {
    // Scenario: the line holds a.md.bak; the names are a.md and a.md.bak.
    const lineTexts = listLineTextsByNeedleText(["read a.md.bak"], ["a.md", "a.md.bak"]);
    // Both lists hold the line.
    assert.deepEqual(lineTexts.get("a.md"), ["read a.md.bak"]);
    assert.deepEqual(lineTexts.get("a.md.bak"), ["read a.md.bak"]);
});

test("test_line_without_any_name_is_not_listed", () => {
    // Scenario: no line holds b.txt.
    const lineTexts = listLineTextsByNeedleText(["read a.txt"], ["a.txt", "b.txt"]);
    // The list of b.txt is empty.
    assert.deepEqual(lineTexts.get("b.txt"), []);
});

test("test_cwd_line_and_error_lines_are_added_only_to_non_empty_lists", () => {
    // Scenario: the log has a cwd line, a line with a.txt, and an error line; no line holds b.txt.
    const lineTexts = listLineTextsByNeedleText([CWD_LINE, "read a.txt", ERROR_LINE], ["a.txt", "b.txt"]);
    // The list of a.txt holds all three lines, in log order.
    assert.deepEqual(lineTexts.get("a.txt"), [CWD_LINE, "read a.txt", ERROR_LINE]);
    // The list of b.txt stays empty.
    assert.deepEqual(lineTexts.get("b.txt"), []);
});

// Pure view-model tests for the JSON inspector's formatted-text mode; records arrive as JSON.parse'd or raw JSONL lines.

import { test } from "node:test";
import assert from "node:assert/strict";
import { extractReadableText } from "../webapp/inspector-text.ts";

test("test_extract_readable_text_returns_string_message_content_verbatim", () => {
    // Scenario: a user record whose message.content is a plain string — the prompt text IS the readable content.
    const record = { type: "user", message: { role: "user", content: "fix the bug" } };
    assert.equal(extractReadableText(record), "fix the bug");
});

test("test_extract_readable_text_joins_text_blocks_with_blank_lines", () => {
    // Scenario: an assistant record with two text blocks reads as two paragraphs.
    const record = { type: "assistant", message: { content: [
        { type: "text", text: "first" },
        { type: "text", text: "second" },
    ] } };
    assert.equal(extractReadableText(record), "first\n\nsecond");
});

test("test_extract_readable_text_unwraps_tool_result_content", () => {
    // Scenario: a tool_result block's output reads as text in both string and nested text-block forms.
    const stringForm = { message: { content: [{ type: "tool_result", content: "line a\nline b" }] } };
    assert.equal(extractReadableText(stringForm), "line a\nline b");
    const nestedForm = { message: { content: [{ type: "tool_result", content: [{ type: "text", text: "inner" }] }] } };
    assert.equal(extractReadableText(nestedForm), "inner");
});

test("test_extract_readable_text_renders_tool_use_string_inputs_verbatim", () => {
    // Scenario: a tool_use block shows its string input fields with real newlines, not JSON-escaped.
    const record = { message: { content: [
        { type: "tool_use", name: "Write", input: { file_path: "a.py", content: "x = 1\ny = 2", count: 3 } },
    ] } };
    assert.equal(
        extractReadableText(record),
        "[tool_use: Write]\n--- file_path ---\na.py\n--- content ---\nx = 1\ny = 2",
    );
});

test("test_extract_readable_text_marks_unknown_blocks_instead_of_dropping_them", () => {
    // Scenario: a block kind the extractor does not model becomes a one-line placeholder so nothing silently vanishes.
    const record = { message: { content: [{ type: "thinking", thinking: "hmm" }] } };
    assert.equal(extractReadableText(record), "[thinking]");
});

test("test_extract_readable_text_returns_undefined_without_message_content", () => {
    // Scenario: a file-history snapshot record has no message — the inspector hides the formatted-text toggle for it.
    assert.equal(extractReadableText({ type: "file-history-snapshot", snapshot: {} }), undefined);
});

test("test_extract_readable_text_returns_non_json_lines_verbatim", () => {
    // Scenario: the inspector falls back to the raw string when JSON.parse fails; that string is already the readable content.
    assert.equal(extractReadableText("not json at all"), "not json at all");
});

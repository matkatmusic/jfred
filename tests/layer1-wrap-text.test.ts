// L9 redesign P5: popup text wraps at a column limit.

import { test } from "node:test";
import assert from "node:assert/strict";
import { wrapTextAtColumns } from "../webapp/layer1-wrap-text.ts";

test("test_no_line_is_over_50_characters", () => {
    const text = "word ".repeat(40).trim();
    const lines = wrapTextAtColumns(text, 50).split("\n");
    assert.ok(lines.length > 1);
    for (const line of lines) assert.ok(line.length <= 50);
});

test("test_blank_lines_are_kept", () => {
    assert.equal(wrapTextAtColumns("first\n\nsecond", 50), "first\n\nsecond");
});

test("test_a_120_character_word_breaks_at_50", () => {
    const lines = wrapTextAtColumns("a".repeat(120), 50).split("\n");
    assert.deepEqual(
        lines.map((line) => line.length),
        [50, 50, 20],
    );
});

test("test_text_of_50_characters_stays_one_line", () => {
    const text = "x".repeat(25) + " " + "y".repeat(24);
    assert.equal(text.length, 50);
    assert.equal(wrapTextAtColumns(text, 50), text);
});

test("test_each_source_line_wraps_on_its_own", () => {
    assert.equal(wrapTextAtColumns("aa bb\ncc dd", 5), "aa bb\ncc dd");
});

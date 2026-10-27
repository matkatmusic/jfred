// Tool-call summary trimming, session short labels, and row timestamps (timeline-labels.ts).

import { test } from "node:test";
import assert from "node:assert/strict";
import {
    computeSessionShortLabel,
    formatRowTimestamp,
    trimToolCallSummary,
} from "../webapp/views/timeline-labels.ts";

test("test_trimToolCallSummary_keeps_first_line_and_caps_length", () => {
    assert.equal(trimToolCallSummary("line one\nline two"), "line one");
    assert.equal(trimToolCallSummary("x".repeat(60)), `${"x".repeat(50)}…`);
});

test("test_computeSessionShortLabel_takes_first_eight_chars", () => {
    assert.equal(computeSessionShortLabel("abcdef0123456789"), "abcdef01");
});

test("test_formatRowTimestamp_blank_for_invalid_date", () => {
    assert.equal(formatRowTimestamp("not a date"), "");
});

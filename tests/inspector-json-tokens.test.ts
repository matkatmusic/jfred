// Tests for webapp/inspector-json-tokens.ts: token classification and the long-value threshold.

import { test } from "node:test";
import assert from "node:assert/strict";
import { getTokenClass, isValueLong, JSON_TOKEN_PATTERN } from "../webapp/inspector-json-tokens.ts";

test("test_getTokenClass_classifies_each_token_kind", () => {
    // Scenario: keys end with a colon, other strings are values, then bool, null, number.
    assert.equal(getTokenClass('"a":'), "json-key");
    assert.equal(getTokenClass('"a"'), "json-string");
    assert.equal(getTokenClass("true"), "json-bool");
    assert.equal(getTokenClass("false"), "json-bool");
    assert.equal(getTokenClass("null"), "json-null");
    assert.equal(getTokenClass("-1.5e3"), "json-number");
});

test("test_isValueLong_only_flags_long_strings", () => {
    // Scenario: only a string token past the limit gets the collapse toggle.
    assert.equal(isValueLong("json-string", "x".repeat(561)), true);
    assert.equal(isValueLong("json-string", "x".repeat(560)), false);
    assert.equal(isValueLong("json-number", "1".repeat(561)), false);
});

test("test_JSON_TOKEN_PATTERN_matches_tokens_and_skips_punctuation", () => {
    // Scenario: braces, commas and spaces between tokens are not matched.
    const tokens = [...'{"a": [1, true, null]}'.matchAll(JSON_TOKEN_PATTERN)].map((match) => match[0]);
    assert.deepEqual(tokens, ['"a":', "1", "true", "null"]);
});

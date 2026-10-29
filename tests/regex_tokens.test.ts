import { test } from "node:test";
import assert from "node:assert/strict";
import {
  globalFlag, matchAnyOf, matchNoneOf, matchOneOf, matchRepeatBetween, wrapCapture, wrapLookahead,
  wrapNegativeLookahead, wrapNegativeLookbehind, wrapOptionalGroup, zeroOrMoreWhitespace,
} from "../src/regex_tokens.ts";

test("test_wrap_helpers_build_group_sources", () => {
  assert.equal(wrapCapture("a"), "(a)");
  assert.equal(wrapOptionalGroup("a"), "(?:a)?");
  assert.equal(wrapLookahead("a"), "(?=a)");
  assert.equal(wrapNegativeLookahead("a"), "(?!a)");
  assert.equal(wrapNegativeLookbehind("a"), "(?<!a)");
});

test("test_match_helpers_build_class_sources", () => {
  assert.equal(matchAnyOf("a", "b"), "(?:a|b)");
  assert.equal(matchNoneOf("ab"), "[^ab]");
  assert.equal(matchOneOf("ab"), "[ab]");
  assert.equal(matchRepeatBetween(1, 4), "{1,4}");
});

test("test_exported_constants_have_expected_sources", () => {
  assert.equal(globalFlag, "g");
  assert.equal(zeroOrMoreWhitespace, "\\s*");
});

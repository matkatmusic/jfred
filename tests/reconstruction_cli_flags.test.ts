import { test } from "node:test";
import assert from "node:assert/strict";
import { computeGraphFlags, extractCommaListFlag, extractValueFlag } from "../src/reconstruction_cli_flags.ts";

test("test_extractCommaListFlag_splits_the_value_at_commas", () => {
    // Scenario: one flag holds a comma list.
    // The value "a,b" comes back as two values and the flag with its value leaves the rest.
    const result = extractCommaListFlag(["x", "--jsonls", "a,b", "y"], "--jsonls");
    assert.deepEqual(result.values, ["a", "b"]);
    assert.deepEqual(result.rest, ["x", "y"]);
});

test("test_extractCommaListFlag_returns_no_values_when_the_flag_is_absent", () => {
    // Scenario: the flag is not in the arguments.
    const argv = ["x", "y"];
    const result = extractCommaListFlag(argv, "--jsonls");
    // No value comes back and the arguments stay as they were.
    assert.deepEqual(result.values, []);
    assert.deepEqual(result.rest, ["x", "y"]);
});

test("test_extractCommaListFlag_throws_on_an_empty_part", () => {
    // Scenario: the comma list has an empty part.
    // A trailing comma and a double comma both throw.
    assert.throws(() => extractCommaListFlag(["--jsonls", "a,"], "--jsonls"));
    assert.throws(() => extractCommaListFlag(["--jsonls", "a,,b"], "--jsonls"));
});

test("test_extract_value_flag_removes_flag_and_value", () => {
    const result = extractValueFlag(["a", "--cwd", "/x", "b"], "--cwd");
    assert.equal(result.value, "/x");
    assert.deepEqual(result.rest, ["a", "b"]);
});

test("test_extract_value_flag_absent_returns_argv_unchanged", () => {
    const argv = ["a", "b"];
    const result = extractValueFlag(argv, "--cwd");
    assert.equal(result.value, undefined);
    assert.deepEqual(result.rest, ["a", "b"]);
});

test("test_compute_graph_flags_defaults_both_on", () => {
    assert.deepEqual(computeGraphFlags([], undefined, false, false, false, false), { convo: true, file: true });
});

test("test_compute_graph_flags_explicit_flag_wins", () => {
    assert.deepEqual(computeGraphFlags(["--graphFile"], undefined, true, false, false, false), { convo: false, file: true });
});

test("test_compute_graph_flags_other_intent_turns_both_off", () => {
    assert.deepEqual(computeGraphFlags([], undefined, false, false, true, false), { convo: false, file: false });
});

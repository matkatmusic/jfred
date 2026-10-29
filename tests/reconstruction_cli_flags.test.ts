import { test } from "node:test";
import assert from "node:assert/strict";
import { computeGraphFlags, extractValueFlag } from "../src/reconstruction_cli_flags.ts";

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

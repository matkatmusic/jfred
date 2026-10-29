// Tests for getGitUnifiedDiff: real-git hunks for identical sides, creations, function context, and no noise.
import { test } from "node:test";
import assert from "node:assert/strict";
import { getGitUnifiedDiff, FULL_FILE_CONTEXT_LINES } from "../src/render_git_diff.ts";

test("test_getGitUnifiedDiff_returns_empty_string_for_identical_sides", () => {
    // Scenario: both sides carry the same lines, so the diff is the empty string.
    const lines = ["def hello():", '    print("hello")'];
    assert.equal(getGitUnifiedDiff(lines, [...lines]), "");
});

test("test_getGitUnifiedDiff_renders_a_creation_as_one_hunk_from_zero", () => {
    // Scenario: an empty before side yields one all-addition hunk with old side "-0,0".
    const output = getGitUnifiedDiff([], ["line one", "line two"]);
    assert.ok(output.startsWith("@@ -0,0 +1,"), `creation hunk starts from zero, got: ${output.split("\n")[0]}`);
    assert.ok(output.includes("+line one"));
    assert.ok(output.includes("+line two"));
});

test("test_getGitUnifiedDiff_carries_function_context_in_the_hunk_header", () => {
    // Scenario: an edit inside a python function, far from its def line; the hunk header names the function.
    const before = [
        "def reorder():",
        "    a = 1",
        "    b = 2",
        "    c = 3",
        "    d = 4",
        "    e = 5",
        "    return a",
    ];
    const after = [...before];
    after[6] = "    return b";
    const output = getGitUnifiedDiff(before, after);
    const firstLine = output.split("\n")[0]!;
    assert.match(firstLine, /^@@ -\d+(,\d+)? \+\d+(,\d+)? @@ .*def reorder/);
});

test("test_getGitUnifiedDiff_with_full_context_includes_lines_far_from_the_change", () => {
    // Scenario: only the last line changes; default context omits top lines, full context includes all.
    const before = [
        "line 1", "line 2", "line 3", "line 4", "line 5",
        "line 6", "line 7", "line 8", "target",
    ];
    const after = [...before];
    after[8] = "target changed";
    // Default width omits the distant top line.
    assert.ok(!getGitUnifiedDiff(before, after).includes(" line 1"));
    // Full width carries every unchanged line as context.
    const full = getGitUnifiedDiff(before, after, FULL_FILE_CONTEXT_LINES);
    assert.ok(full.includes(" line 1"));
    assert.ok(full.includes(" line 8"));
    assert.ok(full.includes("-target"));
    assert.ok(full.includes("+target changed"));
});

test("test_getGitUnifiedDiff_emits_no_preamble_and_no_newline_markers", () => {
    // Scenario: output has no "No newline at end of file" marker and no "diff --git" header.
    const output = getGitUnifiedDiff(["old line"], ["new line"]);
    assert.ok(!output.includes("\\ No newline"));
    assert.ok(!output.includes("diff --git"));
    assert.ok(output.startsWith("@@ -"), "output starts at the first hunk header");
});


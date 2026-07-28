// Tests for runGitUnifiedDiff (item 51): real-git unified hunks between two in-memory line arrays — empty for identical sides, "-0,0" creations, function context in hunk headers, and no preamble/no-newline noise leaking into the webapp's row renderers.
import { test } from "node:test";
import assert from "node:assert/strict";
import { runGitUnifiedDiff, FULL_FILE_CONTEXT_LINES } from "../src/render_git_diff.ts";

test("test_runGitUnifiedDiff_returns_empty_string_for_identical_sides", () => {
    // Scenario: both sides carry the same lines — no hunks, so the diff is the empty string.
    const lines = ["def hello():", '    print("hello")'];
    assert.equal(runGitUnifiedDiff(lines, [...lines]), "");
});

test("test_runGitUnifiedDiff_renders_a_creation_as_one_hunk_from_zero", () => {
    // Scenario: an empty before side (a created file) yields a single all-addition hunk whose old side is "-0,0" (git may shorten the new side's ",count" when it is 1).
    const output = runGitUnifiedDiff([], ["line one", "line two"]);
    assert.ok(output.startsWith("@@ -0,0 +1,"), `creation hunk starts from zero, got: ${output.split("\n")[0]}`);
    assert.ok(output.includes("+line one"));
    assert.ok(output.includes("+line two"));
});

test("test_runGitUnifiedDiff_carries_function_context_in_the_hunk_header", () => {
    // Scenario: an edit INSIDE a python function body, with the def line more than 3 context lines above the change — git's hunk header names the enclosing function (the whole point of item 51; the pure-TS renderer could not produce this).
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
    const output = runGitUnifiedDiff(before, after);
    const firstLine = output.split("\n")[0]!;
    assert.match(firstLine, /^@@ -\d+(,\d+)? \+\d+(,\d+)? @@ .*def reorder/);
});

test("test_runGitUnifiedDiff_with_full_context_includes_lines_far_from_the_change", () => {
    // Scenario: a file whose ONLY change is on the last line, with >3 unchanged lines above it. Default context (3) omits the top lines; full context includes ALL of them as context rows (" " prefix), so the whole file is present in the hunk.
    const before = [
        "line 1", "line 2", "line 3", "line 4", "line 5",
        "line 6", "line 7", "line 8", "target",
    ];
    const after = [...before];
    after[8] = "target changed";
    // Default width omits the distant top line.
    assert.ok(!runGitUnifiedDiff(before, after).includes(" line 1"));
    // Full width carries every unchanged line as context.
    const full = runGitUnifiedDiff(before, after, FULL_FILE_CONTEXT_LINES);
    assert.ok(full.includes(" line 1"));
    assert.ok(full.includes(" line 8"));
    assert.ok(full.includes("-target"));
    assert.ok(full.includes("+target changed"));
});

test("test_runGitUnifiedDiff_emits_no_preamble_and_no_newline_markers", () => {
    // Scenario: sides are serialized newline-terminated and the git preamble is stripped, so the output never carries "\ No newline at end of file" or a "diff --git" header line.
    const output = runGitUnifiedDiff(["old line"], ["new line"]);
    assert.ok(!output.includes("\\ No newline"));
    assert.ok(!output.includes("diff --git"));
    assert.ok(output.startsWith("@@ -"), "output starts at the first hunk header");
});


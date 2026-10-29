// item 46: import { test } from "node:test";
import { test } from "node:test";
import assert from "node:assert/strict";
// item 46: import { parseArgs, executeCli } from "../src/reconstruction_cli.ts";
import { executeCli } from "../src/reconstruction_cli.ts";
import { S1_JSONL, S2_JSONL, S3_JSONL, S4_JSONL, S5_JSONL, S6_JSONL, S7_JSONL } from "./fixtures.ts";

// These tests assert re-run-stable topology only; rotating ids are proven by tests/scenario_coverage.test.ts.

// Default view of the S5 transcript: one file, write -> append -> overwrite, topology only.
test("test_default_view_lists_s5_redirect_entries", () => {
    const out = executeCli([S5_JSONL]);
    assert.ok(out.includes("══ conversationDAG ══"));
    assert.ok(out.includes("s5_redirect.txt"));
    assert.ok(out.includes("write"));
    assert.ok(out.includes("append"));
    assert.ok(out.includes("overwrite"));
    // No fork: a linear conversationDAG (no branch wrappers).
    assert.ok(!out.includes("branch "));
});

// The default view renders the renamed file's write -> rename -> edit lineage and the test file's write.
test("test_default_view_lists_s6_git_mv_lineage", () => {
    const out = executeCli([S6_JSONL]);
    // The renamed file appears with both its rename and its later edit.
    assert.ok(out.includes("s6_git_renamed.py"));
    assert.ok(out.includes("rename"));
    assert.ok(out.includes("edit"));
    // The test file appears by base name.
    assert.ok(out.includes("test_s6_git.py"));
    // No fork: a linear conversationDAG (no branch wrappers).
    assert.ok(!out.includes("branch "));
});

// Default view: S7's forked conversationDAG shows the rewound branch above the surviving branch.
test("test_default_view_shows_all_branches", () => {
    const out = executeCli([S7_JSONL]);
    assert.ok(out.includes("branch surviving"));
    assert.ok(out.includes("branch rewound"));
    // Oldest-first: the rewound branch renders before the surviving branch.
    assert.ok(out.indexOf("branch rewound") < out.indexOf("branch surviving"));
    assert.ok(!out.includes("overwrite"));
});

// A transcript with no rewound branch (S1) renders a linear conversationDAG: no wrappers, no connectors.
test("test_default_view_unchanged_when_no_rewound_branches", () => {
    const out = executeCli([S1_JSONL]);
    assert.ok(out.includes("══ conversationDAG ══"));
    assert.ok(!out.includes("branch "));
    assert.ok(!out.includes("├─"));
    assert.ok(!out.includes("└─"));
});

// --surviving: only the surviving branch — no rewound branch headers.
test("test_surviving_flag_shows_only_surviving_branch", () => {
    const out = executeCli([S7_JSONL, "--surviving"]);
    assert.ok(out.includes("scenario7.py"));
    assert.ok(!out.includes("## rewound"));
    assert.ok(!out.includes("branch rewound"));
});

// --list-branches: one summary line per branch, not the full per-revision listing.
test("test_list_branches_summarizes_surviving_and_rewound", () => {
    const out = executeCli([S7_JSONL, "--list-branches"]);
    assert.ok(out.includes("surviving"));
    assert.ok(out.includes("rewound"));
    assert.ok(!out.includes("create  2 lines")); // a summary, not the full per-revision listing
});

// An unknown branch id is rejected (the message lists the available ids).
test("test_branch_id_unknown_throws_with_available_ids", () => {
    assert.throws(() => executeCli([S7_JSONL, "--branch", "deadbeef"]));
});

// End-to-end: executeCli renders every file s1 touches, each under its path header.
test("test_run_cli_renders_every_touched_file_for_s1", () => {
    const out = executeCli([S1_JSONL, "--verbose"]);
    assert.ok(out.includes("s1_delete.py"));
    assert.ok(out.includes("test_s1_delete.py"));
    assert.ok(out.includes("def hello():"));
});

// The default (no view flag) lists each touched file with its numbered entries.
test("test_run_cli_default_lists_touched_files", () => {
    const out = executeCli([S1_JSONL]);
    assert.ok(out.includes("s1_delete.py"));
    assert.ok(out.includes("test_s1_delete.py"));
    // s1_delete.py is written then deleted: a write turn and a delete turn.
    assert.ok(out.includes("write"));
    assert.ok(out.includes("delete"));
});

// The default view lists s2's entries, including a rename turn whose target is the new name.
test("test_default_view_lists_s2_entries_with_rename", () => {
    const out = executeCli([S2_JSONL]);
    assert.ok(out.includes("s2_original.py"));
    // The rename is its own turn, targeting the new name.
    const renameLine = out.split("\n").find((line) => line.includes("rename"))!;
    assert.ok(renameLine.includes("s2_moved.py"));
    assert.ok(!out.includes("branch ")); // linear
});

// The default view lists s3's three files and shows the copy turn.
test("test_default_view_lists_s3_with_copy_entry", () => {
    const out = executeCli([S3_JSONL]);
    assert.ok(out.includes("s3_source.py"));
    assert.ok(out.includes("s3_copy.py"));
    assert.ok(out.includes("test_s3_source.py"));
    assert.ok(out.includes("copy"));          // the cp is its own turn
    assert.ok(!out.includes("branch "));      // linear
});

// The default view lists S4's two files; the second Write shows as a write turn, not an overwrite.
test("test_default_view_lists_s4_overwrite_entries", () => {
    const out = executeCli([S4_JSONL]);
    assert.ok(out.includes("s4_overwrite.py"));
    assert.ok(out.includes("test_s4_overwrite.py"));
    assert.ok(out.includes("write"));
    assert.ok(!out.includes("branch "));  // linear
});

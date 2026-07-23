// item 46: import { test } from "node:test";
import { test } from "node:test";
import assert from "node:assert/strict";
// item 46: import { parseArgs, runCli } from "../src/reconstruction_cli.ts";
import { runCli } from "../src/reconstruction_cli.ts";
import { S1_JSONL, S2_JSONL, S3_JSONL, S4_JSONL, S5_JSONL, S6_JSONL, S7_JSONL, S8_JSONL, S9_JSONL } from "./fixtures.ts";
import { join } from "node:path";
import { setPathOverrides } from "../src/reconstruction_overrides.ts";
import { SESSION_A, SESSION_B, buildWriteRecordPair, makeSourceTree, writeTranscriptFixture } from "./multi-source-test-helpers.ts";
import { branchRewoundHeader, rewoundMention } from "../src/regex_expressions.ts";

// These tests assert re-run-STABLE topology only — branch wrappers, file names, turn kinds, ordering, and
// linearity. They deliberately do NOT pin short change-ids / branch-tip ids / tmp paths: those rotate every
// time a scenario is re-executed, which is what made the old per-scenario suite brittle. Exact reconstructed
// CONTENT (the rotating ids included) is proven re-run-stably by tests/scenario_coverage.test.ts instead.

// The default view of the real S5 transcript renders the redirect lineage in both DAGs: one file,
// write -> append -> overwrite. Topology only — line counts live in the content views, not the graph.
test("test_default_view_lists_s5_redirect_entries", () => {
    const out = runCli([S5_JSONL]);
    assert.ok(out.includes("══ conversationDAG ══"));
    assert.ok(out.includes("s5_redirect.txt"));
    assert.ok(out.includes("write"));
    assert.ok(out.includes("append"));
    assert.ok(out.includes("overwrite"));
    // No fork: a linear conversationDAG (no branch wrappers).
    assert.ok(!out.includes("branch "));
});

// The default view renders the renamed file's write -> rename -> edit lineage and the test file's
// write in both DAGs.
test("test_default_view_lists_s6_git_mv_lineage", () => {
    const out = runCli([S6_JSONL]);
    // The renamed file appears with both its rename and its later edit.
    assert.ok(out.includes("s6_git_renamed.py"));
    assert.ok(out.includes("rename"));
    assert.ok(out.includes("edit"));
    // The test file appears by base name.
    assert.ok(out.includes("test_s6_git.py"));
    // No fork: a linear conversationDAG (no branch wrappers).
    assert.ok(!out.includes("branch "));
});

// Default (no flag): S7's forked conversationDAG shows the rewound branch ABOVE the surviving branch,
// oldest-first; the fileDAG stays linear.
test("test_default_view_shows_all_branches", () => {
    const out = runCli([S7_JSONL]);
    assert.ok(out.includes("branch surviving"));
    assert.ok(out.includes("branch rewound"));
    // Oldest-first: the rewound branch renders before the surviving branch.
    assert.ok(out.indexOf("branch rewound") < out.indexOf("branch surviving"));
    assert.ok(!out.includes("overwrite"));
});

// A transcript with no rewound branch (S1) renders a LINEAR conversationDAG: no branch wrappers, no
// connectors.
test("test_default_view_unchanged_when_no_rewound_branches", () => {
    const out = runCli([S1_JSONL]);
    assert.ok(out.includes("══ conversationDAG ══"));
    assert.ok(!out.includes("branch "));
    assert.ok(!out.includes("├─"));
    assert.ok(!out.includes("└─"));
});

// --surviving: only the surviving branch — no rewound branch headers.
test("test_surviving_flag_shows_only_surviving_branch", () => {
    const out = runCli([S7_JSONL, "--surviving"]);
    assert.ok(out.includes("scenario7.py"));
    assert.ok(!out.includes("## rewound"));
    assert.ok(!out.includes("branch rewound"));
});

// --list-branches: one summary line per branch, naming the surviving and rewound branches (a summary, not
// the full per-revision listing).
test("test_list_branches_summarizes_surviving_and_rewound", () => {
    const out = runCli([S7_JSONL, "--list-branches"]);
    assert.ok(out.includes("surviving"));
    assert.ok(out.includes("rewound"));
    assert.ok(!out.includes("create  2 lines")); // a summary, not the full per-revision listing
});

// An unknown branch id is rejected (the message lists the available ids).
test("test_branch_id_unknown_throws_with_available_ids", () => {
    assert.throws(() => runCli([S7_JSONL, "--branch", "deadbeef"]));
});

// End-to-end: runCli renders EVERY file s1 touches, each under its path header.
test("test_run_cli_renders_every_touched_file_for_s1", () => {
    const out = runCli([S1_JSONL, "--verbose"]);
    assert.ok(out.includes("s1_delete.py"));
    assert.ok(out.includes("test_s1_delete.py"));
    assert.ok(out.includes("def hello():"));
});

// The default (no view flag) lists each touched file with its numbered entries.
test("test_run_cli_default_lists_touched_files", () => {
    const out = runCli([S1_JSONL]);
    assert.ok(out.includes("s1_delete.py"));
    assert.ok(out.includes("test_s1_delete.py"));
    // s1_delete.py is written then deleted: a write turn and a delete turn.
    assert.ok(out.includes("write"));
    assert.ok(out.includes("delete"));
});

// The default view lists s2's entries, including a first-class rename turn (its target is the new name).
test("test_default_view_lists_s2_entries_with_rename", () => {
    const out = runCli([S2_JSONL]);
    assert.ok(out.includes("s2_original.py"));
    // The rename is its own turn, targeting the new name.
    const renameLine = out.split("\n").find((line) => line.includes("rename"))!;
    assert.ok(renameLine.includes("s2_moved.py"));
    assert.ok(!out.includes("branch ")); // linear
});

// The default view lists s3's three files and shows the copy turn.
test("test_default_view_lists_s3_with_copy_entry", () => {
    const out = runCli([S3_JSONL]);
    assert.ok(out.includes("s3_source.py"));
    assert.ok(out.includes("s3_copy.py"));
    assert.ok(out.includes("test_s3_source.py"));
    assert.ok(out.includes("copy"));          // the cp is its own turn
    assert.ok(!out.includes("branch "));      // linear
});

// The default view lists S4's two files, each written twice (the second Write is a `write` turn in
// the topology view — overwrite detection is a content-view concern).
test("test_default_view_lists_s4_overwrite_entries", () => {
    const out = runCli([S4_JSONL]);
    assert.ok(out.includes("s4_overwrite.py"));
    assert.ok(out.includes("test_s4_overwrite.py"));
    assert.ok(out.includes("write"));
    assert.ok(!out.includes("branch "));  // linear
});

// Default (no flag): S8's forked conversationDAG has TWO rewound branch wrappers above the surviving
// branch. The file-less head is not a branch.
test("test_default_view_shows_surviving_vc_plus_two_rewound", () => {
    const out = runCli([S8_JSONL]);
    assert.ok(out.includes("branch surviving"));
    assert.ok(!out.includes("no files touched"));
    assert.equal((out.match(branchRewoundHeader) ?? []).length, 2); // exactly two rewound wrappers
    assert.ok(!out.includes("overwrite"));
});

// --surviving: only the surviving branch — no rewound branch headers.
test("test_surviving_flag_shows_only_vc", () => {
    const out = runCli([S8_JSONL, "--surviving"]);
    assert.ok(!out.includes("## rewound"));
    assert.ok(!out.includes("branch rewound"));
});

// --list-branches: one surviving line and exactly two rewound summary lines.
test("test_list_branches_lists_surviving_vc_and_two_rewound", () => {
    const out = runCli([S8_JSONL, "--list-branches"]);
    assert.ok(out.includes("surviving"));
    assert.equal((out.match(rewoundMention) ?? []).length, 2);
});

// Default (no flag): S9 has one surviving branch and zero rewound branches, so its conversationDAG is
// LINEAR — no branch wrappers. Both restored files appear.
test("test_s9_default_view_is_a_plain_list_of_the_restored_files", () => {
    const out = runCli([S9_JSONL]);
    assert.ok(out.includes("scenario9.py"));
    assert.ok(out.includes("test_scenario9.py"));
    assert.ok(!out.includes("branch "));             // linear, no wrappers
    assert.ok(!out.includes("no files touched"));
});

// --list-branches: a single surviving line; no rewound line.
test("test_s9_list_branches_shows_only_the_surviving_restored_branch", () => {
    const out = runCli([S9_JSONL, "--list-branches"]);
    assert.ok(out.includes("surviving"));
    assert.ok(!out.includes("rewound"));
});

// --surviving: the two restored files, no headers.
test("test_s9_surviving_flag_shows_the_restored_files", () => {
    const out = runCli([S9_JSONL, "--surviving"]);
    assert.ok(out.includes("scenario9.py"));
    assert.ok(out.includes("tests/test_scenario9.py"));
    assert.ok(!out.includes("## "));
});


// Spec S4b: runCli merges multiple positional transcripts across two source trees into one
// document (distinct targets from both sources appear; the per-source sidecar chain applies).
test("test_run_cli_merges_two_transcripts_across_sources", () => {
    const treeA = makeSourceTree("-cli-proj-a");
    const treeB = makeSourceTree("-cli-proj-b");
    const rootA = join(treeA.treeRoot, "ws-a");
    const rootB = join(treeB.treeRoot, "ws-b");
    const pairA = buildWriteRecordPair(
        { sessionId: SESSION_A, cwd: rootA, timestamp: "2026-07-22T10:00:00.000Z", toolId: "toolu_cli_a", parentUuid: null },
        join(rootA, "alpha.py"),
        "alpha\n",
    );
    const pairB = buildWriteRecordPair(
        { sessionId: SESSION_B, cwd: rootB, timestamp: "2026-07-22T10:05:00.000Z", toolId: "toolu_cli_b", parentUuid: null },
        join(rootB, "beta.py"),
        "beta\n",
    );
    writeTranscriptFixture(treeA.projectDir, "a.jsonl", pairA.records);
    writeTranscriptFixture(treeB.projectDir, "b.jsonl", pairB.records);
    const out = runCli([join(treeA.projectDir, "a.jsonl"), join(treeB.projectDir, "b.jsonl"), "--json"]);
    // both sources' files are in the one merged document.
    assert.ok(out.includes("alpha.py"));
    assert.ok(out.includes("beta.py"));
    setPathOverrides({});
});

// Task 181: the existing --file flag (alias of --target) narrows the output to the named
// file's revision ladder end-to-end through the multi-source merge path — the other source's
// file is reconstructed but filtered out of the rendering.
test("test_file_flag_filters_ladder_on_multi_source_fixture", () => {
    const treeA = makeSourceTree("-cli-file-a");
    const treeB = makeSourceTree("-cli-file-b");
    const rootA = join(treeA.treeRoot, "ws-a");
    const rootB = join(treeB.treeRoot, "ws-b");
    const alphaPath = join(rootA, "alpha.py");
    const pairA = buildWriteRecordPair(
        { sessionId: SESSION_A, cwd: rootA, timestamp: "2026-07-22T10:00:00.000Z", toolId: "toolu_cli_fa", parentUuid: null },
        alphaPath,
        "alpha\n",
    );
    const pairB = buildWriteRecordPair(
        { sessionId: SESSION_B, cwd: rootB, timestamp: "2026-07-22T10:05:00.000Z", toolId: "toolu_cli_fb", parentUuid: null },
        join(rootB, "beta.py"),
        "beta\n",
    );
    writeTranscriptFixture(treeA.projectDir, "a.jsonl", pairA.records);
    writeTranscriptFixture(treeB.projectDir, "b.jsonl", pairB.records);
    const out = runCli([join(treeA.projectDir, "a.jsonl"), join(treeB.projectDir, "b.jsonl"), "--file", alphaPath, "--json"]);
    // Only the named file's ladder renders; the other source's file is filtered out.
    assert.ok(out.includes("alpha.py"));
    assert.ok(out.includes("revisions"));
    assert.ok(!out.includes("beta.py"));
    setPathOverrides({});
});

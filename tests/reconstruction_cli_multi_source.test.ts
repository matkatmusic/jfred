import { test } from "node:test";
import assert from "node:assert/strict";
import { executeCli } from "../src/reconstruction_cli.ts";
import { join } from "node:path";
import { setPathOverrides } from "../src/reconstruction_overrides.ts";
import { SESSION_A, SESSION_B, buildWriteRecordPair, makeSourceTree, writeTranscriptFixture } from "./multi-source-test-helpers.ts";

// Spec S4b: executeCli merges positional transcripts from two source trees into one document.
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
    const out = executeCli([join(treeA.projectDir, "a.jsonl"), join(treeB.projectDir, "b.jsonl"), "--json"]);
    // both sources' files are in the one merged document.
    assert.ok(out.includes("alpha.py"));
    assert.ok(out.includes("beta.py"));
    setPathOverrides({});
});

// Task 181: --file narrows the output to one file's ladder through the multi-source merge path.
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
    const out = executeCli([join(treeA.projectDir, "a.jsonl"), join(treeB.projectDir, "b.jsonl"), "--file", alphaPath, "--json"]);
    // Only the named file's ladder renders; the other source's file is filtered out.
    assert.ok(out.includes("alpha.py"));
    assert.ok(out.includes("revisions"));
    assert.ok(!out.includes("beta.py"));
    setPathOverrides({});
});

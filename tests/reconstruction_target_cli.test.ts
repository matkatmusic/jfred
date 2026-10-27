import { test } from "node:test";
import assert from "node:assert/strict";
import { join } from "node:path";
import { executeCli } from "../src/reconstruction_cli.ts";
import { setPathOverrides } from "../src/reconstruction_overrides.ts";
import {
    SESSION_A,
    SESSION_B,
    buildWriteRecordPair,
    makeSourceTree,
    writeTranscriptFixture,
} from "./multi-source-test-helpers.ts";

// The alpha/beta two-source CLI fixture shared by the JSON and text fast-path tests.
function buildTwoSourceCliFixture(suffix: string): { jsonlPaths: string[]; alphaPath: string } {
    const treeA = makeSourceTree(`-target-a${suffix}`);
    const treeB = makeSourceTree(`-target-b${suffix}`);
    const rootA = join(treeA.treeRoot, "ws-a");
    const rootB = join(treeB.treeRoot, "ws-b");
    const alphaPath = join(rootA, "alpha.py");
    const pairA = buildWriteRecordPair(
        { sessionId: SESSION_A, cwd: rootA, timestamp: "2026-07-22T10:00:00.000Z", toolId: "toolu_tgt_a", parentUuid: null },
        alphaPath,
        "alpha\n",
    );
    const pairB = buildWriteRecordPair(
        { sessionId: SESSION_B, cwd: rootB, timestamp: "2026-07-22T10:05:00.000Z", toolId: "toolu_tgt_b", parentUuid: null },
        join(rootB, "beta.py"),
        "beta\n",
    );
    writeTranscriptFixture(treeA.projectDir, "a.jsonl", pairA.records);
    writeTranscriptFixture(treeB.projectDir, "b.jsonl", pairB.records);
    return { jsonlPaths: [join(treeA.projectDir, "a.jsonl"), join(treeB.projectDir, "b.jsonl")], alphaPath };
}

test("test_targeted_cli_json_emits_one_element_history_array", () => {
    // Scenario: --branch surviving --json --file yields exactly [historyOfTarget], with the other source's file absent.
    const { jsonlPaths, alphaPath } = buildTwoSourceCliFixture("-json");
    const out = executeCli([...jsonlPaths, "--branch", "surviving", "--file", alphaPath, "--json"]);
    const parsed = JSON.parse(out) as { target: string; revisions: unknown[] }[];
    assert.equal(parsed.length, 1);
    assert.ok(parsed[0]!.target.endsWith("alpha.py"));
    assert.ok(parsed[0]!.revisions.length > 0);
    assert.ok(!out.includes("beta.py"));
    setPathOverrides({});
});

test("test_targeted_cli_text_mode_renders_only_target", () => {
    // Scenario: the same selection without --json renders only the target's list block.
    const { jsonlPaths, alphaPath } = buildTwoSourceCliFixture("-text");
    const out = executeCli([...jsonlPaths, "--branch", "surviving", "--file", alphaPath]);
    assert.ok(out.includes("alpha.py"));
    assert.ok(!out.includes("beta.py"));
    setPathOverrides({});
});

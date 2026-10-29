// task 193: bound rejections, sidechain prompts, and the CLI flag; split from reconstruction_bound.test.ts.

import { test } from "node:test";
import assert from "node:assert/strict";
import { join } from "node:path";
import { Path } from "../src/structures/domain.ts";
import { trimRecordsAtRevisionTurnEnd } from "../src/reconstruction_bound.ts";
import { executeCli } from "../src/reconstruction_cli.ts";
import { setPathOverrides } from "../src/reconstruction_overrides.ts";
import { createBoundFixture } from "./reconstruction_bound_fixture.ts";
import {
    SESSION_A,
    buildPromptRecord,
    createSourceTree,
    writeTranscriptFixture,
} from "./multi-source-test-helpers.ts";
import { buildWriteRecordPair } from "./tool-call-record-pair-builders.ts";

test("test_bound_rejects_out_of_range_ordinal", () => {
    // Scenario: an out-of-range ordinal fails loudly, and the message teaches the valid range.
    const { records, alphaPath } = createBoundFixture({ withFinalPrompt: true, withSidechainPrompt: false });
    assert.throws(
        () => trimRecordsAtRevisionTurnEnd(records, alphaPath, 9),
        (error: Error) => error.message.includes("1..3") && error.message.includes(alphaPath.toString()),
    );
});

test("test_bound_rejects_unknown_target", () => {
    // Scenario: a never-touched path has no revisions to bound at.
    const { records } = createBoundFixture({ withFinalPrompt: true, withSidechainPrompt: false });
    assert.throws(
        () => trimRecordsAtRevisionTurnEnd(records, new Path("/nowhere/ghost.py"), 1),
        (error: Error) => error.message.includes("no revisions"),
    );
});

// Task 193: --until-revision bounds the whole reconstruction at the turn end, unlike --file which filters after full reconstruction.
test("test_cli_until_revision_bounds_all_views", () => {
    const tree = createSourceTree("-cli-until-rev");
    const root = join(tree.treeRoot, "ws");
    const alphaPath = join(root, "alpha_until.py");
    const turnOneWrite = buildWriteRecordPair(
        { sessionId: SESSION_A, cwd: root, timestamp: "2026-07-23T10:01:00.000Z", toolId: "toolu_until_a", parentUuid: "prompt-1" },
        alphaPath,
        "alpha\n",
    );
    const turnTwoWrite = buildWriteRecordPair(
        { sessionId: SESSION_A, cwd: root, timestamp: "2026-07-23T10:06:00.000Z", toolId: "toolu_until_b", parentUuid: "prompt-2" },
        join(root, "beta_until.py"),
        "beta\n",
    );
    writeTranscriptFixture(tree.projectDir, "until.jsonl", [
        buildPromptRecord("prompt-1", null, "2026-07-23T10:00:00.000Z", root),
        ...turnOneWrite.records,
        buildPromptRecord("prompt-2", turnOneWrite.lastUuid, "2026-07-23T10:05:00.000Z", root),
        ...turnTwoWrite.records,
    ]);
    const jsonlPath = join(tree.projectDir, "until.jsonl");
    const fhsLoc = join(tree.treeRoot, "file-history");
    const bounded = executeCli([jsonlPath, "--until-revision", alphaPath, "--fhsLoc", fhsLoc, "--json"]);
    assert.ok(bounded.includes("alpha_until.py"));
    assert.ok(!bounded.includes("beta_until.py"));
    setPathOverrides({});
    const full = executeCli([jsonlPath, "--fhsLoc", fhsLoc, "--json"]);
    assert.ok(full.includes("alpha_until.py"));
    assert.ok(full.includes("beta_until.py"));
    setPathOverrides({});
});

test("test_bound_ignores_sidechain_prompts", () => {
    // Scenario: a subagent's opening prompt inside turn 1 is not a turn boundary; the cut still lands before prompt2.
    const { records, alphaPath } = createBoundFixture({ withFinalPrompt: true, withSidechainPrompt: true });
    const bound = trimRecordsAtRevisionTurnEnd(records, alphaPath, 1);
    assert.equal(bound.records.length, 6);
    assert.ok(bound.records.some((record) => record.uuid?.toString() === "toolu_bound_e1-result"));
});

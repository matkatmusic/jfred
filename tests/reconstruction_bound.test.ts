// task 193: bounded reconstruction truncates the record stream at the end of the turn containing the file's nth revision.

import { test } from "node:test";
import assert from "node:assert/strict";
import { join } from "node:path";
import { Path } from "../src/structures/domain.ts";
import { truncateRecordsAtRevisionTurnEnd } from "../src/reconstruction_bound.ts";
import { runCli } from "../src/reconstruction_cli.ts";
import { setPathOverrides } from "../src/reconstruction_overrides.ts";
import type { TranscriptRecord } from "../src/structures/envelope.ts";
import {
    SESSION_A,
    SESSION_B,
    buildEditRecordPair,
    buildPromptRecord,
    buildWriteRecordPair,
    makeSourceTree,
    writeTranscriptFixture,
} from "./multi-source-test-helpers.ts";

type BoundFixture = { records: TranscriptRecord[]; alphaPath: Path };

// Shared three-turn fixture; withSidechainPrompt injects a subagent's opening prompt inside turn 1, to test it is not a boundary.
function makeBoundFixture(options: { withFinalPrompt: boolean; withSidechainPrompt: boolean }): BoundFixture {
    const tree = makeSourceTree("-bound-project");
    const root = join(tree.treeRoot, "workspace");
    const alphaPath = join(root, "alpha_bound.py");
    const betaPath = join(root, "beta_bound.py");
    const writeAlpha = buildWriteRecordPair(
        { sessionId: SESSION_A, cwd: root, timestamp: "2026-07-23T10:01:00.000Z", toolId: "toolu_bound_w1", parentUuid: "prompt-1" },
        alphaPath,
        "line one\n",
    );
    const editAlpha = buildEditRecordPair(
        { sessionId: SESSION_A, cwd: root, timestamp: "2026-07-23T10:02:00.000Z", toolId: "toolu_bound_e1", parentUuid: writeAlpha.lastUuid },
        alphaPath,
        "line one\nline two\n",
        "line one\n",
        { oldStart: 1, oldLines: 1, newStart: 1, newLines: 2, lines: [" line one", "+line two"] },
    );
    const writeBeta = buildWriteRecordPair(
        { sessionId: SESSION_A, cwd: root, timestamp: "2026-07-23T10:06:00.000Z", toolId: "toolu_bound_w2", parentUuid: "prompt-2" },
        betaPath,
        "beta line\n",
    );
    const editAlphaAgain = buildEditRecordPair(
        { sessionId: SESSION_A, cwd: root, timestamp: "2026-07-23T10:07:00.000Z", toolId: "toolu_bound_e2", parentUuid: writeBeta.lastUuid },
        alphaPath,
        "line one\nline two\nline three\n",
        "line one\nline two\n",
        { oldStart: 2, oldLines: 1, newStart: 2, newLines: 2, lines: [" line two", "+line three"] },
    );
    const wireRecords: object[] = [buildPromptRecord("prompt-1", null, "2026-07-23T10:00:00.000Z", root)];
    wireRecords.push(...writeAlpha.records);
    if (options.withSidechainPrompt) {
        wireRecords.push(buildPromptRecord("sidechain-1", null, "2026-07-23T10:01:30.000Z", root, { isSidechain: true }));
    }
    wireRecords.push(...editAlpha.records);
    wireRecords.push(buildPromptRecord("prompt-2", editAlpha.lastUuid, "2026-07-23T10:05:00.000Z", root));
    wireRecords.push(...writeBeta.records, ...editAlphaAgain.records);
    if (options.withFinalPrompt) {
        wireRecords.push(buildPromptRecord("prompt-3", editAlphaAgain.lastUuid, "2026-07-23T10:10:00.000Z", root));
    }
    const records = writeTranscriptFixture(tree.projectDir, "bound.jsonl", wireRecords);
    return { records, alphaPath: new Path(alphaPath) };
}

test("test_bound_reports_total_revision_count", () => {
    // Scenario: the total revision count covers the FULL stream regardless of where the bound cuts.
    const { records, alphaPath } = makeBoundFixture({ withFinalPrompt: true, withSidechainPrompt: false });
    const bound = truncateRecordsAtRevisionTurnEnd(records, alphaPath, 1);
    assert.equal(bound.totalRevisions, 3);
});

test("test_bound_truncates_after_containing_turn_end", () => {
    // Scenario: the bound is the containing turn's end, not the revision instant; a same-turn later revision must stay in.
    const { records, alphaPath } = makeBoundFixture({ withFinalPrompt: true, withSidechainPrompt: false });
    const bound = truncateRecordsAtRevisionTurnEnd(records, alphaPath, 1);
    assert.equal(bound.records.length, 5);
    assert.ok(bound.records.some((record) => record.uuid?.toString() === "toolu_bound_e1-result"));
    assert.equal(bound.boundInstant?.toISOString(), "2026-07-23T10:05:00.000Z");
});

test("test_bound_instant_reports_turn_end_not_last_record", () => {
    // Task 192: boundInstant is the actual turn-end boundary used, not the last record's stamp; streams are grouped by file.
    const tree = makeSourceTree("-bound-instant");
    const root = join(tree.treeRoot, "workspace");
    const alphaPath = join(root, "alpha_bound.py");
    const writeAlpha = buildWriteRecordPair(
        { sessionId: SESSION_A, cwd: root, timestamp: "2026-07-23T10:01:00.000Z", toolId: "toolu_bi_w1", parentUuid: "prompt-a1" },
        alphaPath,
        "line one\n",
    );
    const writeBeta = buildWriteRecordPair(
        { sessionId: SESSION_B, cwd: root, timestamp: "2026-07-23T10:05:00.000Z", toolId: "toolu_bi_w2", parentUuid: "prompt-b1" },
        join(root, "beta_bound.py"),
        "beta\n",
    );
    const records = writeTranscriptFixture(tree.projectDir, "bound-instant.jsonl", [
        buildPromptRecord("prompt-a1", null, "2026-07-23T10:00:00.000Z", root),
        ...writeAlpha.records,
        buildPromptRecord("prompt-b1", null, "2026-07-23T10:03:00.000Z", root, { sessionId: SESSION_B }),
        ...writeBeta.records,
        buildPromptRecord("prompt-a2", writeAlpha.lastUuid, "2026-07-23T10:08:00.000Z", root),
    ]);
    const bound = truncateRecordsAtRevisionTurnEnd(records, new Path(alphaPath), 1);
    assert.equal(bound.boundInstant?.toISOString(), "2026-07-23T10:08:00.000Z");
});

test("test_bound_same_turn_ordinals_share_a_bound", () => {
    // Scenario: revisions 1 and 2 live in the same turn, so both ordinals cut at the same place.
    const { records, alphaPath } = makeBoundFixture({ withFinalPrompt: true, withSidechainPrompt: false });
    const first = truncateRecordsAtRevisionTurnEnd(records, alphaPath, 1);
    const second = truncateRecordsAtRevisionTurnEnd(records, alphaPath, 2);
    assert.equal(second.records.length, first.records.length);
});

test("test_bound_later_ordinal_truncates_before_next_prompt", () => {
    // Scenario: revision 3 lives in turn 2; the cut lands just before prompt3.
    const { records, alphaPath } = makeBoundFixture({ withFinalPrompt: true, withSidechainPrompt: false });
    const bound = truncateRecordsAtRevisionTurnEnd(records, alphaPath, 3);
    assert.equal(bound.records.length, records.length - 1);
});

test("test_bound_final_turn_revision_keeps_all_records", () => {
    // Scenario: the chosen revision sits in the final turn — nothing to cut, boundInstant undefined.
    const { records, alphaPath } = makeBoundFixture({ withFinalPrompt: false, withSidechainPrompt: false });
    const bound = truncateRecordsAtRevisionTurnEnd(records, alphaPath, 3);
    assert.equal(bound.records.length, records.length);
    assert.equal(bound.boundInstant, undefined);
});

test("test_bound_rejects_out_of_range_ordinal", () => {
    // Scenario: an out-of-range ordinal fails loudly, and the message teaches the valid range.
    const { records, alphaPath } = makeBoundFixture({ withFinalPrompt: true, withSidechainPrompt: false });
    assert.throws(
        () => truncateRecordsAtRevisionTurnEnd(records, alphaPath, 9),
        (error: Error) => error.message.includes("1..3") && error.message.includes(alphaPath.toString()),
    );
});

test("test_bound_rejects_unknown_target", () => {
    // Scenario: a never-touched path has no revisions to bound at.
    const { records } = makeBoundFixture({ withFinalPrompt: true, withSidechainPrompt: false });
    assert.throws(
        () => truncateRecordsAtRevisionTurnEnd(records, new Path("/nowhere/ghost.py"), 1),
        (error: Error) => error.message.includes("no revisions"),
    );
});

// Task 193: --until-revision bounds the whole reconstruction at the turn end, unlike --file which filters after full reconstruction.
test("test_cli_until_revision_bounds_all_views", () => {
    const tree = makeSourceTree("-cli-until-rev");
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
    const bounded = runCli([jsonlPath, "--until-revision", alphaPath, "--fhsLoc", fhsLoc, "--json"]);
    assert.ok(bounded.includes("alpha_until.py"));
    assert.ok(!bounded.includes("beta_until.py"));
    setPathOverrides({});
    const full = runCli([jsonlPath, "--fhsLoc", fhsLoc, "--json"]);
    assert.ok(full.includes("alpha_until.py"));
    assert.ok(full.includes("beta_until.py"));
    setPathOverrides({});
});

// test_bound_uses_owning_sessions_next_prompt_on_interleaved_streams: moved to tests/reconstruction_bound_sessions.test.ts (task 192 — this file crossed the 250-line cap).

test("test_bound_ignores_sidechain_prompts", () => {
    // Scenario: a subagent's opening prompt inside turn 1 is not a turn boundary; the cut still lands before prompt2.
    const { records, alphaPath } = makeBoundFixture({ withFinalPrompt: true, withSidechainPrompt: true });
    const bound = truncateRecordsAtRevisionTurnEnd(records, alphaPath, 1);
    assert.equal(bound.records.length, 6);
    assert.ok(bound.records.some((record) => record.uuid?.toString() === "toolu_bound_e1-result"));
});

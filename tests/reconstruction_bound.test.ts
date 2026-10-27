// task 193: bounded reconstruction truncates the record stream at the end of the turn containing the file's nth revision.

import { test } from "node:test";
import assert from "node:assert/strict";
import { join } from "node:path";
import { Path } from "../src/structures/domain.ts";
import { trimRecordsAtRevisionTurnEnd } from "../src/reconstruction_bound.ts";
import { createBoundFixture } from "./reconstruction_bound_fixture.ts";
import {
    SESSION_A,
    SESSION_B,
    buildPromptRecord,
    buildWriteRecordPair,
    makeSourceTree,
    writeTranscriptFixture,
} from "./multi-source-test-helpers.ts";

test("test_bound_reports_total_revision_count", () => {
    // Scenario: the total revision count covers the FULL stream regardless of where the bound cuts.
    const { records, alphaPath } = createBoundFixture({ withFinalPrompt: true, withSidechainPrompt: false });
    const bound = trimRecordsAtRevisionTurnEnd(records, alphaPath, 1);
    assert.equal(bound.totalRevisions, 3);
});

test("test_bound_truncates_after_containing_turn_end", () => {
    // Scenario: the bound is the containing turn's end, not the revision instant; a same-turn later revision must stay in.
    const { records, alphaPath } = createBoundFixture({ withFinalPrompt: true, withSidechainPrompt: false });
    const bound = trimRecordsAtRevisionTurnEnd(records, alphaPath, 1);
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
    const bound = trimRecordsAtRevisionTurnEnd(records, new Path(alphaPath), 1);
    assert.equal(bound.boundInstant?.toISOString(), "2026-07-23T10:08:00.000Z");
});

test("test_bound_same_turn_ordinals_share_a_bound", () => {
    // Scenario: revisions 1 and 2 live in the same turn, so both ordinals cut at the same place.
    const { records, alphaPath } = createBoundFixture({ withFinalPrompt: true, withSidechainPrompt: false });
    const first = trimRecordsAtRevisionTurnEnd(records, alphaPath, 1);
    const second = trimRecordsAtRevisionTurnEnd(records, alphaPath, 2);
    assert.equal(second.records.length, first.records.length);
});

test("test_bound_later_ordinal_truncates_before_next_prompt", () => {
    // Scenario: revision 3 lives in turn 2; the cut lands just before prompt3.
    const { records, alphaPath } = createBoundFixture({ withFinalPrompt: true, withSidechainPrompt: false });
    const bound = trimRecordsAtRevisionTurnEnd(records, alphaPath, 3);
    assert.equal(bound.records.length, records.length - 1);
});

test("test_bound_final_turn_revision_keeps_all_records", () => {
    // Scenario: the chosen revision sits in the final turn — nothing to cut, boundInstant undefined.
    const { records, alphaPath } = createBoundFixture({ withFinalPrompt: false, withSidechainPrompt: false });
    const bound = trimRecordsAtRevisionTurnEnd(records, alphaPath, 3);
    assert.equal(bound.records.length, records.length);
    assert.equal(bound.boundInstant, undefined);
});

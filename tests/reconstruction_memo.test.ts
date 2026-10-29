// Tests for the pass-dedup memos: same inputs return the same instances, and the exec-gate flip invalidates them.

import { test } from "node:test";
import assert from "node:assert/strict";
import { loadTranscript } from "../src/parse/loadTranscript.ts";
import { selectLiveBranch } from "../src/reconstruction_branch.ts";
import { selectBranchRecords } from "../src/reconstruction_branch_records.ts";
import { buildAllFileHistories } from "../src/reconstruction_engine.ts";
import type { BackupReader } from "../src/reconstruction_sidecar.ts";
import { RecordType } from "../src/structures/vocabulary.ts";
import { Uuid } from "../src/structures/domain.ts";
import type { TranscriptRecord } from "../src/structures/envelope.ts";
import {
    isImpureExecutionAllowed,
    setImpureExecutionAllowed,
} from "../src/reconstruction_exec_gate.ts";
import { S19_JSONL } from "./fixtures.ts";

function buildChainRecord(type: RecordType, uuid: string, parent: string | null): TranscriptRecord {
    return { type, uuid: new Uuid(uuid), parentUuid: parent === null ? null : new Uuid(parent) } as TranscriptRecord;
}

// A linear conversation where branch selection drops nothing; the last-prompt marker has no uuid.
function buildLinearTrunkRecords(): TranscriptRecord[] {
    return [
        buildChainRecord(RecordType.user, "A", null),
        buildChainRecord(RecordType.assistant, "B", "A"),
        buildChainRecord(RecordType.user, "C", "B"),
        { type: RecordType.lastPrompt, leafUuid: "C" } as unknown as TranscriptRecord,
    ];
}

test("test_selectLiveBranch_returns_the_input_array_when_nothing_is_dropped", () => {
    // Scenario: a trunk that covers every record returns the input array, keeping identity-keyed memos hot.
    const records = buildLinearTrunkRecords();
    assert.equal(selectLiveBranch(records), records);
});

test("test_selectBranchRecords_returns_the_input_array_when_the_tip_covers_every_record", () => {
    // Scenario: a tip whose ancestor chain spans the whole transcript returns the input array.
    const records = buildLinearTrunkRecords();
    assert.equal(selectBranchRecords(records, new Uuid("C")), records);
});

test("test_selectLiveBranch_still_filters_when_records_are_dropped", () => {
    // Scenario: a rewound session (S19) has abandoned-branch records, so the live selection is a strict subset.
    const { records } = loadTranscript(S19_JSONL);
    const live = selectLiveBranch(records);
    assert.notEqual(live, records);
    assert.ok(live.length < records.length);
});

test("test_selectLiveBranch_returns_the_same_array_instance_for_the_same_records", () => {
    // Scenario: branch selection is memoized per records-array identity.
    const { records } = loadTranscript(S19_JSONL);
    assert.equal(selectLiveBranch(records), selectLiveBranch(records));
});

test("test_buildAllFileHistories_reuses_memoized_histories_across_passes", () => {
    // Scenario: two buildAllFileHistories passes over the same records share the memoized per-file revisions.
    const { records } = loadTranscript(S19_JSONL);
    const first = buildAllFileHistories(records);
    const second = buildAllFileHistories(records);
    assert.ok(first.length > 0);
    for (const [index, history] of first.entries()) {
        assert.equal(second[index]!.revisions, history.revisions);
    }
});

test("test_reconstruction_memo_is_invalidated_when_the_exec_gate_flips", () => {
    // Scenario: histories built with the gate on are never served after it turns off.
    assert.equal(isImpureExecutionAllowed(), true);
    const { records } = loadTranscript(S19_JSONL);
    const gateOn = buildAllFileHistories(records);
    try {
        setImpureExecutionAllowed(false);
        const gateOff = buildAllFileHistories(records);
        assert.notEqual(gateOff[0]!.revisions, gateOn[0]!.revisions);
    } finally {
        setImpureExecutionAllowed(true);
    }
});

test("test_branch_selections_survive_an_exec_gate_flip", () => {
    // Scenario: branch selections depend on the records alone, so the exec gate must not invalidate them.
    const { records } = loadTranscript(S19_JSONL);
    const before = selectLiveBranch(records);
    try {
        setImpureExecutionAllowed(false);
        assert.equal(selectLiveBranch(records), before);
    } finally {
        setImpureExecutionAllowed(true);
    }
});

test("test_derived_caches_are_invalidated_when_the_reader_identity_changes", () => {
    // Scenario: two distinct reader closures never share memoized histories, since the cache keys on reader identity.
    const { records } = loadTranscript(S19_JSONL);
    const readerA: BackupReader = () => "";
    const readerB: BackupReader = () => "";
    const withReaderA = buildAllFileHistories(records, readerA);
    const withReaderB = buildAllFileHistories(records, readerB);
    assert.ok(withReaderA.length > 0);
    assert.notEqual(withReaderB[0]!.revisions, withReaderA[0]!.revisions);
});

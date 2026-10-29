import { test } from "node:test";
import assert from "node:assert/strict";
import { selectBranchRecords } from "../src/reconstruction_branch_records.ts";
import { RecordType } from "../src/structures/vocabulary.ts";
import { Uuid } from "../src/structures/domain.ts";
import type { TranscriptRecord } from "../src/structures/envelope.ts";
import { createRecord, createLastPromptRecord } from "./reconstruction-branch-test-helpers.ts";

// B = rewind checkpoint; C = abandoned child; D->E = surviving; plus a uuid-less meta record.
function buildRewindRecords(): TranscriptRecord[] {
    return [
        createRecord(RecordType.user, "B", null),
        createRecord(RecordType.assistant, "C", "B"),     // abandoned branch tip
        createLastPromptRecord("C"),                          // earlier head (abandoned)
        createRecord(RecordType.user, "D", "B"),
        createRecord(RecordType.assistant, "E", "D"),     // surviving branch tip
        { type: RecordType.mode } as TranscriptRecord, // uuid-less meta — always kept
        createLastPromptRecord("E"),                          // final head (surviving)
    ];
}

test("test_select_branch_records_keeps_tip_chain_and_meta", () => {
    const kept = selectBranchRecords(buildRewindRecords(), new Uuid("C"));
    const uuids = kept.filter((r) => r.uuid).map((r) => r.uuid!.toString()).sort();
    assert.deepEqual(uuids, ["B", "C"]);
    assert.ok(kept.some((r) => r.type === RecordType.mode));
});

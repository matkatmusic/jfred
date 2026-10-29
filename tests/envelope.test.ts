import { test } from "node:test";
import assert from "node:assert/strict";
import type { TranscriptRecord } from "../src/structures/envelope.ts";
import { KNOWN_RECORD_TYPES } from "../src/structures/vocabulary.ts";
import { loadRecords } from "./utilities.ts";
import { S1_JSONL } from "./fixtures.ts";

test("test_every_s1_record_has_a_known_record_type", () => {
    // Scenario: parsed s1 records satisfy the TranscriptRecord envelope contract.
    const records: TranscriptRecord[] = loadRecords(S1_JSONL);
    assert.ok(records.length > 0);
    for (const record of records) {
        assert.ok(KNOWN_RECORD_TYPES.includes(record.type));
    }
});

test("test_s1_envelope_timestamps_are_dates_when_present", () => {
    // Scenario: the timestamp envelope field is hydrated to a Date, not left as a string.
    const timestamps = loadRecords(S1_JSONL).map((record: TranscriptRecord) => record.timestamp).filter((timestamp) => timestamp !== undefined);
    assert.ok(timestamps.length > 0);
    for (const timestamp of timestamps) {
        assert.ok(timestamp instanceof Date);
    }
});

import { test } from "node:test";
import assert from "node:assert/strict";
import { parseRecord, UnknownRecordTypeError } from "../src/parse/parseRecord.ts";
import { KNOWN_RECORD_TYPES, RecordType } from "../src/structures/vocabulary.ts";
import { Path, Uuid } from "../src/structures/domain.ts";
import { readNonEmptyLines } from "./utilities.ts";
import { S1_JSONL } from "./fixtures.ts";

test("test_parseRecord_discriminates_every_record_type_in_s1", () => {
    // Scenario: every line of the s1 transcript parses into a record whose `type` is one of the 10 known s1 record types — none falls through.  Steps: read all non-empty records of the s1 JSONL.
    const lines = readNonEmptyLines(S1_JSONL);
    assert.ok(lines.length > 0);
    // every parsed record carries a `type` that is a known record type.
    const known = new Set<string>(KNOWN_RECORD_TYPES);
    for (const line of lines) {
        const record = parseRecord(line);
        assert.ok(
            known.has(record.type),
            `record type not recognized: ${record.type}`,
        );
    }
});

test("test_parseRecord_hydrates_envelope_domain_fields", () => {
    // Scenario: a conversational record's envelope fields are hydrated into domain objects — ids into Uuid, cwd into Path, timestamp into Date — so no envelope value is left as a primitive string.  Steps: find the first assistant record (carries the full envelope).
    const lines = readNonEmptyLines(S1_JSONL);
    const parsedRecords = lines.map(parseRecord);
    const assistant = parsedRecords.find((record) => record.type === RecordType.assistant);
    if (!assistant) {
        assert.fail("expected an assistant record in s1");
    }
    // its envelope ids, cwd, and timestamp are domain objects.
    assert.ok(assistant.uuid instanceof Uuid);
    assert.ok(assistant.sessionId instanceof Uuid);
    assert.ok(assistant.cwd instanceof Path);
    assert.ok(assistant.timestamp instanceof Date);
});

test("test_parseRecord_throws_on_unknown_record_type", () => {
    // Scenario: a record with a `type` outside the s1 vocabulary is rejected loudly, so a future fog-of-war violation cannot pass silently.  Steps: build a line whose type is not in the known set.
    const line = JSON.stringify({ type: "totally-not-a-real-type", uuid: "x" });
    // parsing it throws an UnknownRecordTypeError.
    assert.throws(() => parseRecord(line), UnknownRecordTypeError);
});


import { test } from "node:test";
import assert from "node:assert/strict";
import { userEditEventFrom } from "../src/reconstruction_user_edit.ts";
import { extractFileEvents } from "../src/reconstruction_extract.ts";
import { EventKind } from "../src/structures/vocabulary.ts";
import type { TranscriptRecord } from "../src/structures/envelope.ts";
import { loadRecords } from "./utilities.ts";
import { S15_JSONL } from "./fixtures.ts";

// The S15 user edit's full post-edit content (the snippet with its `<n>\t` line-number prefixes stripped).
const S15_USER_EDIT_CONTENT = '# user edit\ndef hello():\n    print("hello")';

// The single `edited_text_file` attachment record in a transcript, found by what it IS (it is the one record `userEditEventFrom` recognizes) rather than by a hard-coded uuid prefix that rotates on every re-run.
function editedTextFileRecord(records: TranscriptRecord[]): TranscriptRecord {
    return records.find((record) => userEditEventFrom(record) !== undefined)!;
}

// `userEditEventFrom` turns the `edited_text_file` attachment record into a user-edit file event whose content is the snippet with line-number prefixes stripped and whose changeId is the record's own uuid.
test("test_userEditEventFrom_reads_edited_text_file_attachment", () => {
    // Load the real S15 transcript and find its user-edit attachment record structurally.
    const records = loadRecords(S15_JSONL);
    const editRecord = editedTextFileRecord(records);
    // Convert it to a UserEditEvent.
    const event = userEditEventFrom(editRecord);
    // It is a user-edit event targeting scenario15.py, identified by the attachment record's own uuid.
    assert.ok(event !== undefined);
    assert.equal(event!.kind, EventKind.userEdit);
    assert.ok(event!.target.toString().endsWith("scenario15.py"));
    assert.equal(event!.changeId.toString(), editRecord.uuid!.toString());
    // Its content is the snippet's text with the `<n>\t` prefixes stripped (the full post-edit file).
    assert.equal(event!.content, S15_USER_EDIT_CONTENT);
});

// Across the whole transcript, exactly one record is an `edited_text_file` attachment — every other record (prompts, assistant turns, tool results) yields no user-edit event.
test("test_userEditEventFrom_ignores_other_records", () => {
    const records = loadRecords(S15_JSONL);
    const userEditRecords = records.filter((record) => userEditEventFrom(record) !== undefined);
    assert.equal(userEditRecords.length, 1);
});

// Extraction over the whole transcript surfaces exactly one user-edit event, ordered (by timestamp) after the two trunk write events.
test("test_extractFileEvents_includes_the_user_edit_for_S15", () => {
    // Extract every file event from the S15 transcript.
    const events = extractFileEvents(loadRecords(S15_JSONL));
    // Exactly one of them is a user-edit event.
    const userEdits = events.filter((event) => event.kind === EventKind.userEdit);
    assert.equal(userEdits.length, 1);
    // It is ordered after both trunk write events (the user edited the file after it was written).
    const writeCount = events.filter((event) => event.kind === EventKind.write).length;
    const userEditIndex = events.findIndex((event) => event.kind === EventKind.userEdit);
    assert.equal(writeCount, 2);
    assert.ok(userEditIndex >= writeCount);
});


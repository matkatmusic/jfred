import { test } from "node:test";
import assert from "node:assert/strict";
import { getBeaconSnippet, getUserEditEvent } from "../src/reconstruction_user_edit.ts";
import { extractFileEvents } from "../src/reconstruction_extract.ts";
import { EventKind } from "../src/structures/vocabulary.ts";
import { Uuid } from "../src/structures/domain.ts";
import type { TranscriptRecord } from "../src/structures/envelope.ts";
import { loadRecords } from "./utilities.ts";
import { S15_JSONL } from "./fixtures.ts";

// The S15 user edit's full post-edit content (the snippet with its `<n>\t` line-number prefixes stripped).
const S15_USER_EDIT_CONTENT = '# user edit\ndef hello():\n    print("hello")';

// The single `edited_text_file` attachment record in a transcript, found structurally.
function editedTextFileRecord(records: TranscriptRecord[]): TranscriptRecord {
    return records.find((record) => getUserEditEvent(record) !== undefined)!;
}

// `getUserEditEvent` turns the attachment record into a user-edit event with prefix-free content.
test("test_getUserEditEvent_reads_edited_text_file_attachment", () => {
    // Load the real S15 transcript and find its user-edit attachment record structurally.
    const records = loadRecords(S15_JSONL);
    const editRecord = editedTextFileRecord(records);
    // Convert it to a UserEditEvent.
    const event = getUserEditEvent(editRecord);
    // It is a user-edit event targeting scenario15.py, identified by the attachment record's own uuid.
    assert.ok(event !== undefined);
    assert.equal(event!.kind, EventKind.userEdit);
    assert.ok(event!.target.toString().endsWith("scenario15.py"));
    assert.equal(event!.changeId.toString(), editRecord.uuid!.toString());
    // Its content is the snippet's text with the `<n>\t` prefixes stripped (the full post-edit file).
    assert.equal(event!.content, S15_USER_EDIT_CONTENT);
});

// Exactly one record in the transcript is an `edited_text_file` attachment; all others yield no event.
test("test_getUserEditEvent_ignores_other_records", () => {
    const records = loadRecords(S15_JSONL);
    const userEditRecords = records.filter((record) => getUserEditEvent(record) !== undefined);
    assert.equal(userEditRecords.length, 1);
});

// `getBeaconSnippet` parses the numbered snippet of the S15 user edit and returns undefined for an unknown id.
test("test_getBeaconSnippet_parses_numbered_lines", () => {
    const records = loadRecords(S15_JSONL);
    const editRecord = editedTextFileRecord(records);
    const snippet = getBeaconSnippet(records, editRecord.uuid!);
    assert.ok(snippet !== undefined);
    assert.equal(snippet!.hasEllipsis, false);
    assert.equal(snippet!.lines[0]!.lineNo, 1);
    assert.equal(snippet!.lines[0]!.text, "# user edit");
    assert.equal(getBeaconSnippet(records, new Uuid("no-such-id")), undefined);
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


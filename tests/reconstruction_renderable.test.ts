import { test } from "node:test";
import assert from "node:assert/strict";
import {
    collectAcceptedUserEditIds,
    extractRenderableEvents,
    getFileHistoriesOver,
    isRenderableEvent,
} from "../src/reconstruction_renderable.ts";
import { extractFileEvents } from "../src/reconstruction_extract.ts";
import type { BackupReader } from "../src/reconstruction_sidecar.ts";
import { BlockType, RecordType, ToolName } from "../src/structures/vocabulary.ts";
import type { TranscriptRecord } from "../src/structures/envelope.ts";

// A synthetic assistant record carrying one Write tool_use.
function buildWriteRecord(filePath: string, content: string, timestamp: string): TranscriptRecord {
    return {
        type: RecordType.assistant,
        timestamp: new Date(timestamp),
        message: { content: [{ type: BlockType.tool_use, id: "toolu_x", name: ToolName.Write, input: { file_path: filePath, content }, caller: { type: "direct" } }] },
    } as unknown as TranscriptRecord;
}

// A reader with no backups to offer.
const emptyReader: BackupReader = () => "";

test("test_getFileHistoriesOver_returns_one_history_per_written_file", () => {
    // Scenario: two Writes to different files give two histories.  Steps: reconstruct over both records.
    const records = [
        buildWriteRecord("/proj/a.py", "a = 1\n", "2026-01-01T00:00:01Z"),
        buildWriteRecord("/proj/b.py", "b = 1\n", "2026-01-01T00:00:02Z"),
    ];
    const histories = getFileHistoriesOver(records, emptyReader);
    // assert one history per file, each with one revision.
    assert.equal(histories.length, 2);
    assert.equal(histories[0]!.revisions.length, 1);
});

test("test_collectAcceptedUserEditIds_is_empty_when_no_user_edits_exist", () => {
    // Scenario: a transcript with only a Write has no accepted user edits.  Steps: collect over one Write record.
    const records = [buildWriteRecord("/proj/a.py", "a = 1\n", "2026-01-01T00:00:01Z")];
    assert.equal(collectAcceptedUserEditIds(records, emptyReader).size, 0);
});

test("test_isRenderableEvent_keeps_non_user_edit_events", () => {
    // Scenario: a Write event renders even with an empty accepted set.  Steps: extract the event, then test it.
    const [event] = extractFileEvents([buildWriteRecord("/proj/a.py", "a = 1\n", "2026-01-01T00:00:01Z")]);
    assert.equal(isRenderableEvent(event!, new Set<string>()), true);
});

test("test_extractRenderableEvents_keeps_every_event_when_accepted_is_undefined", () => {
    // Scenario: no accepted set means no filtering.  Steps: extract renderable events over one Write.
    const events = extractRenderableEvents([buildWriteRecord("/proj/a.py", "a = 1\n", "2026-01-01T00:00:01Z")]);
    assert.equal(events.length, 1);
});

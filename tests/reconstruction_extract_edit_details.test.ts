import { test } from "node:test";
import assert from "node:assert/strict";
import { collectEditDetailsByToolUseId, createEditEvent } from "../src/reconstruction_extract_edit_details.ts";
import { extractFileEvents } from "../src/reconstruction_extract.ts";
import { EventKind } from "../src/structures/vocabulary.ts";
import { S2_JSONL } from "./fixtures.ts";
import { loadRecords } from "./utilities.ts";
import type { ToolUseBlock } from "../src/structures/content-blocks.ts";

// s2 performs two Edits: both get a detail, and each detail builds an edit event.
test("test_collect_edit_details_indexes_s2_edits_by_tool_use_id", () => {
    const records = loadRecords(S2_JSONL);
    const detailById = collectEditDetailsByToolUseId(records);
    const edits = extractFileEvents(records).filter((event) => event.kind === EventKind.edit);
    assert.equal(detailById.size, 2);
    for (const edit of edits) {
        assert.ok(detailById.has(edit.changeId.toString()));
    }
});

test("test_create_edit_event_returns_undefined_without_detail", () => {
    const block = { id: "toolu_none", input: { file_path: "/p/a.py" } } as unknown as ToolUseBlock;
    assert.equal(createEditEvent(block, new Date(0), new Map()), undefined);
});

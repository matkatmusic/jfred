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

test("test_create_edit_event_targets_the_path_key_when_file_path_is_absent", () => {
    const block = { id: "toolu_path", input: { path: "/p/b.py", old_string: "a", new_string: "b" } } as unknown as ToolUseBlock;
    const detailById = new Map([["toolu_path", { hunks: [], originalFile: null }]]);
    const event = createEditEvent(block, new Date(0), detailById);
    assert.equal(event?.target.toString(), "/p/b.py");
});

test("test_create_edit_event_throws_when_input_has_neither_file_path_nor_path", () => {
    const block = { id: "toolu_nopath", input: { old_string: "a", new_string: "b" } } as unknown as ToolUseBlock;
    const detailById = new Map([["toolu_nopath", { hunks: [], originalFile: null }]]);
    assert.throws(() => createEditEvent(block, new Date(0), detailById), /Edit tool_use toolu_nopath has no path in its input/);
});

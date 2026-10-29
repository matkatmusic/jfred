// Task 145: sibling tool_use records with one message.id are one turn; rewound branches stay excluded.

import { test } from "node:test";
import assert from "node:assert/strict";
import { selectLiveBranch } from "../src/reconstruction_branch.ts";
import { BlockType, RecordType } from "../src/structures/vocabulary.ts";
import { Uuid } from "../src/structures/domain.ts";
import type { TranscriptRecord } from "../src/structures/envelope.ts";
import { createRecord, createLastPromptRecord } from "./reconstruction-branch-test-helpers.ts";

// One tool_use record of an assistant response; messageId is shared by all its sibling records.
function assistantToolUse(uuid: string, parent: string, messageId: string, toolUseId: string): TranscriptRecord {
    return {
        type: RecordType.assistant,
        uuid: new Uuid(uuid),
        parentUuid: new Uuid(parent),
        message: { id: messageId, content: [{ type: BlockType.tool_use, id: toolUseId, name: "Write", input: {} }] },
    } as TranscriptRecord;
}

// The user record echoing one tool_use's result.
function userToolResult(uuid: string, parent: string, toolUseId: string): TranscriptRecord {
    return {
        type: RecordType.user,
        uuid: new Uuid(uuid),
        parentUuid: new Uuid(parent),
        message: { role: "user", content: [{ type: BlockType.tool_result, tool_use_id: toolUseId, content: "ok" }] },
    } as TranscriptRecord;
}

// The s85 fork: sibling A2 (msg M1) dead-ends at R2 while the trunk continues A1 -> R1 -> A3.
function buildParallelToolCallRecords(): TranscriptRecord[] {
    return [
        createRecord(RecordType.user, "P", null),
        assistantToolUse("A1", "P", "M1", "tool-one"),
        assistantToolUse("A2", "A1", "M1", "tool-two"),
        userToolResult("R2", "A2", "tool-two"),      // dead end — parallel sibling's result
        userToolResult("R1", "A1", "tool-one"),      // trunk continues here
        createRecord(RecordType.assistant, "A3", "R1"),       // next API response (msg id irrelevant)
        createLastPromptRecord("A3"),
    ];
}

test("test_select_live_branch_keeps_parallel_tool_call_sibling_write", () => {
    // Scenario: sibling A2 shares A1's message.id, so the live branch keeps it despite the dead end.
    const kept = selectLiveBranch(buildParallelToolCallRecords());
    const uuids = kept.filter((record) => record.uuid).map((record) => record.uuid!.toString());
    assert.ok(uuids.includes("A2"));
});

test("test_select_live_branch_keeps_the_sibling_tool_result", () => {
    // Scenario: R2's parent A2 is absorbed, so the closure keeps R2 and extraction sees the whole Write.
    const kept = selectLiveBranch(buildParallelToolCallRecords());
    const uuids = kept.filter((record) => record.uuid).map((record) => record.uuid!.toString());
    assert.ok(uuids.includes("R2"));
});

test("test_absorb_does_not_swallow_a_tool_result_leading_to_real_content", () => {
    // Scenario: dead result R2, then an assistant text reply, is a real rewind and stays excluded.
    const records: TranscriptRecord[] = [
        createRecord(RecordType.user, "P", null),
        assistantToolUse("A1", "P", "M1", "tool-one"),
        userToolResult("R2", "A1", "tool-one"),          // dead side of the fork...
        createRecord(RecordType.assistant, "A9", "R2"),            // ...with real assistant content below
        createLastPromptRecord("A9"),
        userToolResult("R1", "A1", "tool-one"),           // trunk continues here
        createRecord(RecordType.assistant, "A3", "R1"),
        createLastPromptRecord("A3"),
    ];
    const kept = selectLiveBranch(records);
    const uuids = kept.filter((record) => record.uuid).map((record) => record.uuid!.toString()).sort();
    assert.deepEqual(uuids, ["A1", "A3", "P", "R1"]);
});

test("test_absorb_does_not_swallow_a_real_rewound_branch", () => {
    // Scenario: a real rewind forks into new response M9; no absorb rule matches, so it stays excluded.
    const records: TranscriptRecord[] = [
        createRecord(RecordType.user, "P", null),
        assistantToolUse("A1", "P", "M1", "tool-one"),
        userToolResult("R1", "A1", "tool-one"),
        assistantToolUse("B1", "P", "M9", "tool-nine"),  // abandoned turn, its own response
        createRecord(RecordType.user, "B2", "B1"),                 // abandoned user prompt
        createLastPromptRecord("B2"),                                 // earlier abandoned head
        createRecord(RecordType.assistant, "A3", "R1"),
        createLastPromptRecord("A3"),
    ];
    const kept = selectLiveBranch(records);
    const uuids = kept.filter((record) => record.uuid).map((record) => record.uuid!.toString()).sort();
    assert.deepEqual(uuids, ["A1", "A3", "P", "R1"]);
});

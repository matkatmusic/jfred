// Task 145: parallel tool calls split ONE assistant API response into sibling JSONL records
// sharing message.id, and each tool_result parents onto ITS OWN tool_use sibling — so the
// surviving ancestor walk reaches only one sibling's chain and the others dead-end (s85's
// `Write two.py`). Those dead ends are the same live turn, not a rewind; the trunk absorbs
// them. A real rewound branch (different message.id, prompt-first diverging record) must stay
// excluded.

import { test } from "node:test";
import assert from "node:assert/strict";
import { selectLiveBranch } from "../src/reconstruction_branch.ts";
import { BlockType, RecordType } from "../src/structures/vocabulary.ts";
import { Uuid } from "../src/structures/domain.ts";
import type { TranscriptRecord } from "../src/structures/envelope.ts";
import { rec, lastPrompt } from "./reconstruction-branch-test-helpers.ts";

// One tool_use record of a (possibly split) assistant API response: messageId is the response's
// message.id, shared across every sibling record the split produced.
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

// The s85 fork shape: prompt P -> tool_use A1 (msg M1) -> sibling tool_use A2 (msg M1) with its
// result R2 dead-ending, while the trunk continues from A1 via R1 -> A3 (msg M2, the tip).
function buildParallelToolCallRecords(): TranscriptRecord[] {
    return [
        rec(RecordType.user, "P", null),
        assistantToolUse("A1", "P", "M1", "tool-one"),
        assistantToolUse("A2", "A1", "M1", "tool-two"),
        userToolResult("R2", "A2", "tool-two"),      // dead end — parallel sibling's result
        userToolResult("R1", "A1", "tool-one"),      // trunk continues here
        rec(RecordType.assistant, "A3", "R1"),       // next API response (msg id irrelevant)
        lastPrompt("A3"),
    ];
}

test("test_select_live_branch_keeps_parallel_tool_call_sibling_write", () => {
    // Scenario: the sibling tool_use A2 shares trunk record A1's message.id — same API
    // response, same live turn — so the live branch keeps it despite the parentUuid dead end.
    const kept = selectLiveBranch(buildParallelToolCallRecords());
    const uuids = kept.filter((record) => record.uuid).map((record) => record.uuid!.toString());
    assert.ok(uuids.includes("A2"));
});

test("test_select_live_branch_keeps_the_sibling_tool_result", () => {
    // Scenario: R2 is a tool_result-only user record whose parent (A2) is absorbed — the
    // closure keeps the result too, so extraction sees the complete Write.
    const kept = selectLiveBranch(buildParallelToolCallRecords());
    const uuids = kept.filter((record) => record.uuid).map((record) => record.uuid!.toString());
    assert.ok(uuids.includes("R2"));
});

test("test_absorb_does_not_swallow_a_real_rewound_branch", () => {
    // Scenario: a genuine rewind forks at P into an assistant turn from a DIFFERENT API
    // response (msg M9) followed by an abandoned user prompt; neither absorb rule matches, so
    // the rewound branch stays excluded from the live selection.
    const records: TranscriptRecord[] = [
        rec(RecordType.user, "P", null),
        assistantToolUse("A1", "P", "M1", "tool-one"),
        userToolResult("R1", "A1", "tool-one"),
        assistantToolUse("B1", "P", "M9", "tool-nine"),  // abandoned turn, its own response
        rec(RecordType.user, "B2", "B1"),                 // abandoned user prompt
        lastPrompt("B2"),                                 // earlier abandoned head
        rec(RecordType.assistant, "A3", "R1"),
        lastPrompt("A3"),
    ];
    const kept = selectLiveBranch(records);
    const uuids = kept.filter((record) => record.uuid).map((record) => record.uuid!.toString()).sort();
    assert.deepEqual(uuids, ["A1", "A3", "P", "R1"]);
});

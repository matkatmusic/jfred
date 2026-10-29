import { test } from "node:test";
import assert from "node:assert/strict";
import { collectOrphanedUuids } from "../src/reconstruction_orphans.ts";
import { RecordType } from "../src/structures/vocabulary.ts";
import type { TranscriptRecord } from "../src/structures/envelope.ts";
import { createRecord, createLastPromptRecord } from "./reconstruction-branch-test-helpers.ts";

// A hook rewrite forks tool_use A into dead TR1 and live TR2; the dead side has no prompt.
const bashUse = { type: "tool_use", id: "toolu_01", name: "Bash", input: {}, caller: { type: "direct" } };
const bashResult = { type: "tool_result", tool_use_id: "toolu_01", content: "7227", is_error: false };

function buildPlumbingForkRecords(deadTail: TranscriptRecord[]): TranscriptRecord[] {
    return [
        createRecord(RecordType.user, "R", null, [{ type: "text", text: "count words" }]),
        createRecord(RecordType.assistant, "A", "R", [bashUse]),
        createRecord(RecordType.user, "TR1", "A", [bashResult]),
        ...deadTail,
        createRecord(RecordType.user, "TR2", "A", [bashResult]),
        createRecord(RecordType.assistant, "A2", "TR2", [{ type: "text", text: "Done." }]),
        createLastPromptRecord("A2"),
    ];
}

// A hook-rewrite micro-fork with no prompt or text is not a rewind, so nothing dims.
test("test_collect_orphaned_uuids_skips_tool_plumbing_micro_fork", () => {
    const records = buildPlumbingForkRecords([createLastPromptRecord("TR1")]);
    assert.equal(collectOrphanedUuids(records).size, 0);
});

// The same fork with assistant text on the dead side is a real rewound exchange — it still dims.
test("test_collect_orphaned_uuids_keeps_rewound_branch_with_content", () => {
    const records = buildPlumbingForkRecords([
        createRecord(RecordType.assistant, "A3", "TR1", [{ type: "text", text: "It is 7227." }]),
        createLastPromptRecord("A3"),
    ]);
    assert.deepEqual([...collectOrphanedUuids(records)].sort(), ["A3", "TR1"]);
});

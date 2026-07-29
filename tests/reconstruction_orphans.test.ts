import { test } from "node:test";
import assert from "node:assert/strict";
import { collectOrphanedUuids } from "../src/reconstruction_orphans.ts";
import { RecordType } from "../src/structures/vocabulary.ts";
import type { TranscriptRecord } from "../src/structures/envelope.ts";
import { rec, lastPrompt } from "./reconstruction-branch-test-helpers.ts";

// A PreToolUse-hook command rewrite (e.g. rtk) forks the tree mid-tool-call: the same tool_use "A" gets TWO tool_result children — the dead one (TR1, with its own last-prompt head) and the live one (TR2) the conversation continues from. The dead side is pure plumbing: no user prompt, no assistant text.
const bashUse = { type: "tool_use", id: "toolu_01", name: "Bash", input: {}, caller: { type: "direct" } };
const bashResult = { type: "tool_result", tool_use_id: "toolu_01", content: "7227", is_error: false };

function buildPlumbingForkRecords(deadTail: TranscriptRecord[]): TranscriptRecord[] {
    return [
        rec(RecordType.user, "R", null, [{ type: "text", text: "count words" }]),
        rec(RecordType.assistant, "A", "R", [bashUse]),
        rec(RecordType.user, "TR1", "A", [bashResult]),
        ...deadTail,
        rec(RecordType.user, "TR2", "A", [bashResult]),
        rec(RecordType.assistant, "A2", "TR2", [{ type: "text", text: "Done." }]),
        lastPrompt("A2"),
    ];
}

// A hook-rewrite micro-fork (dead side = tool_use/tool_result plumbing, no prompt, no assistant text) is not a /rewind — nothing dims (the rtk pattern).
test("test_collect_orphaned_uuids_skips_tool_plumbing_micro_fork", () => {
    const records = buildPlumbingForkRecords([lastPrompt("TR1")]);
    assert.equal(collectOrphanedUuids(records).size, 0);
});

// The same fork with assistant text on the dead side is a real rewound exchange — it still dims.
test("test_collect_orphaned_uuids_keeps_rewound_branch_with_content", () => {
    const records = buildPlumbingForkRecords([
        rec(RecordType.assistant, "A3", "TR1", [{ type: "text", text: "It is 7227." }]),
        lastPrompt("A3"),
    ]);
    assert.deepEqual([...collectOrphanedUuids(records)].sort(), ["A3", "TR1"]);
});

import { test } from "node:test";
import assert from "node:assert/strict";
import { findStructuralRewoundBranches } from "../src/reconstruction_fork.ts";
import { RecordType } from "../src/structures/vocabulary.ts";
import type { TranscriptRecord } from "../src/structures/envelope.ts";
import { Uuid } from "../src/structures/domain.ts";

// A synthetic record of `recordType`, with a single text content block when it is conversational.
function buildRecord(
    recordType: RecordType,
    uuid: string,
    parentUuid: string | null,
    timestamp: string,
): TranscriptRecord {
    return {
        type: recordType,
        uuid: new Uuid(uuid),
        parentUuid: parentUuid === null ? null : new Uuid(parentUuid),
        timestamp: new Date(timestamp),
        message: { content: [{ type: "text", text: "x" }] },
    } as unknown as TranscriptRecord;
}

// A fork: one parent ("fork") with an earlier abandoned prompt (whose subtree continues to an assistant reply) and a later surviving prompt. Mirrors the S13 shape in miniature.
function buildForkRecords(): TranscriptRecord[] {
    return [
        buildRecord(RecordType.system, "fork", null, "2026-01-01T00:00:00Z"),
        buildRecord(RecordType.user, "abandonedPrompt", "fork", "2026-01-01T00:00:10Z"),
        buildRecord(RecordType.assistant, "abandonedTip", "abandonedPrompt", "2026-01-01T00:00:11Z"),
        buildRecord(RecordType.user, "survivingPrompt", "fork", "2026-01-01T00:00:20Z"),
    ];
}

// A fork whose earlier prompt is abandoned produces exactly one structural rewound branch, tipped at the abandoned subtree's deepest reply and forked at the shared parent.
test("test_a_fork_with_an_abandoned_edited_prompt_yields_one_structural_rewound_branch", () => {
    // Build a fork with an abandoned prompt (earlier) and a surviving prompt (later).
    const records = buildForkRecords();
    // With no tips claimed yet, the structural pass discovers the abandoned branch.
    const branches = findStructuralRewoundBranches(records, new Set<string>());
    // Exactly one rewound branch: tip abandonedTip, forked at "fork", not surviving.
    assert.equal(branches.length, 1);
    assert.equal(branches[0]!.tip.toString(), "abandonedTip");
    assert.equal(branches[0]!.rewindPoint!.toString(), "fork");
    assert.equal(branches[0]!.isSurviving, false);
});

// When the abandoned subtree already holds a represented (existing) tip, the dedup guard skips it, so a branch the head path already enumerated is never double-counted (the S7/S8/S11/S12 regression).
test("test_an_abandoned_subtree_already_holding_an_existing_tip_is_skipped", () => {
    // Build the same fork, but mark abandonedTip as already represented by a head-based branch.
    const records = buildForkRecords();
    const existingTips = new Set<string>(["abandonedTip"]);
    // The structural pass must add nothing — the abandoned subtree is already represented.
    const branches = findStructuralRewoundBranches(records, existingTips);
    assert.equal(branches.length, 0);
});


import { test } from "node:test";
import assert from "node:assert/strict";
import { attachForkedSubagentRoots, findForkedSubagentBranches } from "../src/reconstruction_fork_graft.ts";
import { findConversationBranches } from "../src/reconstruction_branch.ts";
import { RecordType } from "../src/structures/vocabulary.ts";
import { Uuid } from "../src/structures/domain.ts";
import type { TranscriptRecord } from "../src/structures/envelope.ts";
import { createLastPromptRecord } from "./reconstruction-branch-test-helpers.ts";

const AGENT = "agentX";

// A timestamped turn; `messageId` marks the API response and `agentId` marks a sidechain record.
function buildTurn(
    type: RecordType,
    uuid: string,
    parent: string | null,
    second: number,
    extra: { messageId?: string; agentId?: string } = {},
): TranscriptRecord {
    return {
        type,
        uuid: new Uuid(uuid),
        parentUuid: parent === null ? null : new Uuid(parent),
        timestamp: new Date(Date.UTC(2026, 0, 1, 0, 0, second)),
        message: { id: extra.messageId, content: [{ type: "text", text: "x" }] },
        ...(extra.agentId !== undefined ? { agentId: extra.agentId, isSidechain: true } : {}),
    } as unknown as TranscriptRecord;
}

function buildForkRef(parentLastUuid: string): TranscriptRecord {
    return {
        type: RecordType.forkContextRef,
        agentId: AGENT,
        parentSessionId: "parentSession",
        parentLastUuid,
        contextLength: 10,
    } as unknown as TranscriptRecord;
}

// Parent chain u1 -> a1 -> u2; fork chain f1 -> f2 -> f3 rooted at null.
function buildParentRecords(): TranscriptRecord[] {
    return [
        buildTurn(RecordType.user, "u1", null, 1),
        buildTurn(RecordType.assistant, "a1", "u1", 2),
        buildTurn(RecordType.user, "u2", "a1", 3),
        createLastPromptRecord("u2"),
    ];
}

function buildForkRecords(): TranscriptRecord[] {
    return [
        buildTurn(RecordType.assistant, "f1", null, 4, { agentId: AGENT }),
        buildTurn(RecordType.user, "f2", "f1", 5, { agentId: AGENT }),
        buildTurn(RecordType.assistant, "f3", "f2", 6, { agentId: AGENT }),
    ];
}

test("test_graft_rewrites_the_root_parent_and_leaves_the_input_unmutated", () => {
    // Scenario: a loaded fork root gets parentLastUuid as its parent in a copy.
    const records = [...buildParentRecords(), buildForkRef("a1"), ...buildForkRecords()];
    const originalRoot = records[5]!;
    const grafted = attachForkedSubagentRoots(records);
    const graftedRoot = grafted[5]!;
    // The copy points into the parent; the input root still has a null parent.
    assert.equal(graftedRoot.parentUuid!.toString(), "a1");
    assert.equal(originalRoot.parentUuid, null);
    assert.notEqual(graftedRoot, originalRoot);
    // Every other record is the same object.
    assert.equal(grafted[0], records[0]);
    assert.equal(grafted[6], records[6]);
});

test("test_graft_returns_the_same_array_when_no_fork_record_exists", () => {
    const records = buildParentRecords();
    assert.equal(attachForkedSubagentRoots(records), records);
});

test("test_graft_skips_a_fork_whose_parent_last_uuid_is_not_loaded", () => {
    // Scenario: the pointer names a record that is not in the stream.
    const records = [...buildParentRecords(), buildForkRef("missing"), ...buildForkRecords()];
    const grafted = attachForkedSubagentRoots(records);
    assert.equal(grafted, records);
    assert.equal(grafted[5]!.parentUuid, null);
});

test("test_fork_branch_has_the_deepest_reply_as_tip_and_the_graft_point_as_rewind", () => {
    const grafted = attachForkedSubagentRoots([...buildParentRecords(), buildForkRef("a1"), ...buildForkRecords()]);
    const branches = findForkedSubagentBranches(grafted, new Set<string>());
    assert.equal(branches.length, 1);
    assert.equal(branches[0]!.tip.toString(), "f3");
    assert.equal(branches[0]!.rewindPoint!.toString(), "a1");
    assert.equal(branches[0]!.isSurviving, false);
    // A tip already claimed is skipped.
    assert.equal(findForkedSubagentBranches(grafted, new Set<string>(["f3"])).length, 0);
});

test("test_parallel_assistant_siblings_at_the_graft_point_give_one_non_surviving_branch", () => {
    // a1 and a1b share one message.id; the fork hangs off a1b and its root shares that id.
    const records = [
        buildTurn(RecordType.user, "u1", null, 1),
        buildTurn(RecordType.assistant, "a1", "u1", 2, { messageId: "m1" }),
        buildTurn(RecordType.assistant, "a1b", "u1", 2, { messageId: "m1" }),
        buildTurn(RecordType.user, "u2", "a1", 3),
        createLastPromptRecord("u2"),
        buildForkRef("a1b"),
        buildTurn(RecordType.assistant, "f1", null, 4, { agentId: AGENT, messageId: "m1" }),
        buildTurn(RecordType.user, "f2", "f1", 5, { agentId: AGENT }),
        buildTurn(RecordType.assistant, "f3", "f2", 6, { agentId: AGENT }),
    ];
    const branches = findConversationBranches(attachForkedSubagentRoots(records));
    const nonSurviving = [];
    for (const branch of branches) {
        if (!branch.isSurviving) {
            nonSurviving.push(branch);
        }
    }
    assert.equal(nonSurviving.length, 1);
    assert.equal(nonSurviving[0]!.tip.toString(), "f3");
    assert.equal(nonSurviving[0]!.rewindPoint!.toString(), "a1b");
});

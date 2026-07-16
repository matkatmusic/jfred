import { test } from "node:test";
import assert from "node:assert/strict";
import {
    collectDescendantUuids,
    findDeepestPromptOrReply,
} from "../src/reconstruction_tree.ts";
import {
    findPromptForkPoints,
    isGenuineUserPrompt,
} from "../src/reconstruction_prompts.ts";
import { BlockType, RecordType } from "../src/structures/vocabulary.ts";
import type { TranscriptRecord } from "../src/structures/envelope.ts";
import { Uuid } from "../src/structures/domain.ts";
import { loadRecords } from "./utilities.ts";
import { S13_JSONL } from "./fixtures.ts";

// A synthetic text content block.
function buildTextBlock(text: string): Record<string, unknown> {
    return { type: BlockType.text, text };
}

// A synthetic tool_result content block — the shape a tool's result echo carries.
function buildToolResultBlock(): Record<string, unknown> {
    return { type: BlockType.tool_result, tool_use_id: "toolu_x", content: "ok", is_error: false };
}

// A synthetic record of `recordType` carrying the given content blocks.
function buildRecord(
    recordType: RecordType,
    uuid: string,
    parentUuid: string | null,
    timestamp: string,
    blocks: Record<string, unknown>[],
): TranscriptRecord {
    return {
        type: recordType,
        uuid: new Uuid(uuid),
        parentUuid: parentUuid === null ? null : new Uuid(parentUuid),
        timestamp: new Date(timestamp),
        message: { content: blocks },
    } as unknown as TranscriptRecord;
}

// A synthetic user record carrying one plain text block — the shape of a real typed-in prompt.
function buildUserTextRecord(
    uuid: string,
    parentUuid: string | null,
    text: string,
    timestamp: string,
): TranscriptRecord {
    return buildRecord(RecordType.user, uuid, parentUuid, timestamp, [buildTextBlock(text)]);
}

// A synthetic user record carrying a tool_result block — the shape a tool's result takes (e.g. a
// Write result), which is a `user`-typed record but NOT a typed-in prompt.
function buildUserToolResultRecord(
    uuid: string,
    parentUuid: string,
    timestamp: string,
): TranscriptRecord {
    return buildRecord(RecordType.user, uuid, parentUuid, timestamp, [buildToolResultBlock()]);
}

// A synthetic assistant record carrying one text block.
function buildAssistantRecord(
    uuid: string,
    parentUuid: string,
    text: string,
    timestamp: string,
): TranscriptRecord {
    return {
        type: RecordType.assistant,
        uuid: new Uuid(uuid),
        parentUuid: new Uuid(parentUuid),
        timestamp: new Date(timestamp),
        message: { content: [{ type: BlockType.text, text }] },
    } as unknown as TranscriptRecord;
}

// A plain text `user` record (no tool_result, not isMeta) is the canonical typed-in prompt, so the
// predicate accepts it.
test("test_a_plain_user_text_record_is_a_genuine_prompt", () => {
    // Build a plain user record carrying only a text block.
    const record = buildUserTextRecord("u1", "p0", "Edit scenario13.py", "2026-01-01T00:00:10Z");
    // The predicate must accept it as a genuine prompt.
    assert.equal(isGenuineUserPrompt(record), true);
});

// A `user` record whose content is a tool_result is a tool's result echo, not a typed-in prompt, so
// the predicate rejects it (this is what stops a Write-result `user` record from reading as a fork child).
test("test_a_user_record_carrying_a_tool_result_is_not_a_prompt", () => {
    // Build a user record whose only block is a tool_result.
    const record = buildUserToolResultRecord("u2", "p0", "2026-01-01T00:00:11Z");
    // The predicate must reject it.
    assert.equal(isGenuineUserPrompt(record), false);
});

// A user record flagged isMeta is /exit or local-command machinery, not a real prompt, so it is rejected.
test("test_an_isMeta_user_record_is_not_a_prompt", () => {
    // Build a plain user text record, then flag it isMeta.
    const record = buildUserTextRecord("u3", "p0", "<local-command-caveat>", "2026-01-01T00:00:12Z");
    (record as { isMeta?: boolean }).isMeta = true;
    // The predicate must reject an isMeta record.
    assert.equal(isGenuineUserPrompt(record), false);
});

// An assistant record is never a user prompt, so the predicate rejects it on the type check alone.
test("test_an_assistant_record_is_not_a_prompt", () => {
    // Build an assistant text record.
    const record = buildAssistantRecord("a1", "u1", "Done.", "2026-01-01T00:00:13Z");
    // The predicate must reject any non-user record.
    assert.equal(isGenuineUserPrompt(record), false);
});

// A synthetic attachment record (a side-record that threads into the tree but is not a prompt).
function buildAttachmentRecord(
    uuid: string,
    parentUuid: string,
    timestamp: string,
): TranscriptRecord {
    return buildRecord(RecordType.attachment, uuid, parentUuid, timestamp, []);
}

// The short (first-8) form of every returned fork-point uuid, for set assertions.
function shortForkIds(forks: Uuid[]): string[] {
    return forks.map((fork) => fork.toString().slice(0, 8));
}

// A record that is the parentUuid of two genuine prompts is a rewind fork point — both prompts share
// one parent, which is the structural signal of a rewind that re-prompted from that point.
test("test_a_record_parenting_two_genuine_prompts_is_a_fork_point", () => {
    // Build two genuine user prompts that share parent "fork".
    const promptA = buildUserTextRecord("childA", "fork", "Edit … farewell", "2026-01-01T00:00:10Z");
    const promptB = buildUserTextRecord("childB", "fork", "Read …", "2026-01-01T00:00:20Z");
    // findPromptForkPoints must return exactly the shared parent uuid.
    const forks = findPromptForkPoints([promptA, promptB]);
    assert.deepEqual(forks.map((fork) => fork.toString()), ["fork"]);
});

// A parent with one genuine-prompt child and one attachment child has only ONE genuine-prompt child,
// so it is NOT a fork point — the attachment side-record must not count toward the fork threshold.
test("test_a_record_with_one_prompt_child_and_one_attachment_child_is_not_a_fork_point", () => {
    // Build one genuine prompt and one attachment, both parented at "node".
    const prompt = buildUserTextRecord("childP", "node", "Edit …", "2026-01-01T00:00:10Z");
    const attachment = buildAttachmentRecord("childAtt", "node", "2026-01-01T00:00:11Z");
    // With only one genuine-prompt child, "node" must not be reported as a fork point.
    const forks = findPromptForkPoints([prompt, attachment]);
    assert.deepEqual(forks, []);
});

// On the real S13 transcript, the single rewind fork is the record b55cd7c5 — the only record
// parenting two genuine prompts (the abandoned "Add a function called farewell(name)" prompt and the surviving "Read" prompt).
test("test_findPromptForkPoints_returns_the_single_S13_fork_b55cd7c5", () => {
    // Load the real S13 transcript.
    const records = loadRecords(S13_JSONL);
    // The fork-point set, by short id, must be exactly ["b55cd7c5"].
    assert.deepEqual(shortForkIds(findPromptForkPoints(records)), ["b55cd7c5"]);
});

// The abandoned subtree threads a prompt → attachment → assistant chain; the descendant walk must
// follow children of EVERY type, so the assistant continuation past the attachment is reached.
test("test_collectDescendantUuids_walks_through_attachment_intermediaries", () => {
    // Build prompt → attachment → assistant, each parented to the prior.
    const prompt = buildUserTextRecord("p1", "fork", "Edit …", "2026-01-01T00:00:10Z");
    const attachment = buildAttachmentRecord("att1", "p1", "2026-01-01T00:00:11Z");
    const assistant = buildAssistantRecord("as1", "att1", "Edited.", "2026-01-01T00:00:12Z");
    // Walking down from the prompt must reach the assistant that sits past the attachment.
    const descendants = collectDescendantUuids([prompt, attachment, assistant], new Uuid("p1"));
    assert.equal(descendants.has("as1"), true);
});

// The abandoned branch's tip is its deepest user/assistant turn (the final "Thanks!" assistant
// 1623ed02), NOT a later trailing `system` bookkeeping record (15a21160).
test("test_findDeepestPromptOrReply_returns_the_last_assistant_not_a_trailing_system_record", () => {
    // Load the real S13 transcript and start from the abandoned user prompt: 7ceda07f.
    const records = loadRecords(S13_JSONL);
    const abandonedPrompt = records.find(
        (record) => record.uuid !== undefined && record.uuid.toString().startsWith("7ceda07f"),
    )!;
    // The deepest user/assistant tip of that subtree is the "Thanks!" assistant 1623ed02.
    const tip = findDeepestPromptOrReply(records, abandonedPrompt.uuid!);
    assert.ok(tip !== undefined);
    assert.equal(tip!.toString().slice(0, 8), "1623ed02");
});


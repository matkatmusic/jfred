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

function buildTextBlock(text: string): Record<string, unknown> {
    return { type: BlockType.text, text };
}

function buildToolResultBlock(): Record<string, unknown> {
    return { type: BlockType.tool_result, tool_use_id: "toolu_x", content: "ok", is_error: false };
}

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

// The shape of a real typed-in prompt.
function buildUserTextRecord(
    uuid: string,
    parentUuid: string | null,
    text: string,
    timestamp: string,
): TranscriptRecord {
    return buildRecord(RecordType.user, uuid, parentUuid, timestamp, [buildTextBlock(text)]);
}

// A tool result is a `user`-typed record but NOT a typed-in prompt.
function buildUserToolResultRecord(
    uuid: string,
    parentUuid: string,
    timestamp: string,
): TranscriptRecord {
    return buildRecord(RecordType.user, uuid, parentUuid, timestamp, [buildToolResultBlock()]);
}

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

// A plain text `user` record (no tool_result, not isMeta) is the canonical typed-in prompt.
test("test_a_plain_user_text_record_is_a_genuine_prompt", () => {
    const record = buildUserTextRecord("u1", "p0", "Edit scenario13.py", "2026-01-01T00:00:10Z");
    assert.equal(isGenuineUserPrompt(record), true);
});

// Rejecting tool-result echoes is what stops a Write result from reading as a fork child.
test("test_a_user_record_carrying_a_tool_result_is_not_a_prompt", () => {
    const record = buildUserToolResultRecord("u2", "p0", "2026-01-01T00:00:11Z");
    assert.equal(isGenuineUserPrompt(record), false);
});

// A user record flagged isMeta is /exit or local-command machinery, not a real prompt.
test("test_an_isMeta_user_record_is_not_a_prompt", () => {
    const record = buildUserTextRecord("u3", "p0", "<local-command-caveat>", "2026-01-01T00:00:12Z");
    (record as { isMeta?: boolean }).isMeta = true;
    assert.equal(isGenuineUserPrompt(record), false);
});

test("test_an_assistant_record_is_not_a_prompt", () => {
    const record = buildAssistantRecord("a1", "u1", "Done.", "2026-01-01T00:00:13Z");
    assert.equal(isGenuineUserPrompt(record), false);
});

// A side-record that threads into the tree but is not a prompt.
function buildAttachmentRecord(
    uuid: string,
    parentUuid: string,
    timestamp: string,
): TranscriptRecord {
    return buildRecord(RecordType.attachment, uuid, parentUuid, timestamp, []);
}

function shortForkIds(forks: Uuid[]): string[] {
    return forks.map((fork) => fork.toString().slice(0, 8));
}

// Two genuine prompts sharing one parent is the structural signal of a rewind re-prompted there.
test("test_a_record_parenting_two_genuine_prompts_is_a_fork_point", () => {
    const promptA = buildUserTextRecord("childA", "fork", "Edit … farewell", "2026-01-01T00:00:10Z");
    const promptB = buildUserTextRecord("childB", "fork", "Read …", "2026-01-01T00:00:20Z");
    const forks = findPromptForkPoints([promptA, promptB]);
    assert.deepEqual(forks.map((fork) => fork.toString()), ["fork"]);
});

// An attachment side-record must not count toward the fork threshold.
test("test_a_record_with_one_prompt_child_and_one_attachment_child_is_not_a_fork_point", () => {
    const prompt = buildUserTextRecord("childP", "node", "Edit …", "2026-01-01T00:00:10Z");
    const attachment = buildAttachmentRecord("childAtt", "node", "2026-01-01T00:00:11Z");
    const forks = findPromptForkPoints([prompt, attachment]);
    assert.deepEqual(forks, []);
});

// S13's b55cd7c5 is the only record parenting two genuine prompts (abandoned "farewell", surviving "Read").
test("test_findPromptForkPoints_returns_the_single_S13_fork_b55cd7c5", () => {
    const records = loadRecords(S13_JSONL);
    assert.deepEqual(shortForkIds(findPromptForkPoints(records)), ["b55cd7c5"]);
});

// The descendant walk must follow every child type, or a continuation past an attachment is missed.
test("test_collectDescendantUuids_walks_through_attachment_intermediaries", () => {
    const prompt = buildUserTextRecord("p1", "fork", "Edit …", "2026-01-01T00:00:10Z");
    const attachment = buildAttachmentRecord("att1", "p1", "2026-01-01T00:00:11Z");
    const assistant = buildAssistantRecord("as1", "att1", "Edited.", "2026-01-01T00:00:12Z");
    const descendants = collectDescendantUuids([prompt, attachment, assistant], new Uuid("p1"));
    assert.equal(descendants.has("as1"), true);
});

// The tip is the deepest user/assistant turn, not a trailing system bookkeeping record; the walk starts at an abandoned prompt.
test("test_findDeepestPromptOrReply_returns_the_last_assistant_not_a_trailing_system_record", () => {
    const records = loadRecords(S13_JSONL);
    const abandonedPrompt = records.find(
        (record) => record.uuid !== undefined && record.uuid.toString().startsWith("7ceda07f"),
    )!;
    const tip = findDeepestPromptOrReply(records, abandonedPrompt.uuid!);
    assert.ok(tip !== undefined);
    assert.equal(tip!.toString().slice(0, 8), "1623ed02");
});


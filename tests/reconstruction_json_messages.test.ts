// Unit tests for the message and branch builders (src/reconstruction_json.ts); split from reconstruction_json.test.ts.

import { test } from "node:test";
import assert from "node:assert/strict";
import {
    extractConversationMessages,
    summarizeBranches,
} from "../src/reconstruction_json.ts";
import { isGenuineUserPrompt } from "../src/reconstruction_prompts.ts";
import { RecordType, BlockType } from "../src/structures/vocabulary.ts";
import { loadRecords } from "./utilities.ts";
import { S19_JSONL } from "./fixtures.ts";

const records = loadRecords(S19_JSONL);

test("test_extractConversationMessages_keeps_genuine_user_prompts", () => {
    // Behavior: every user message returned is a genuine prompt; tool-result user records are dropped.
    const messages = extractConversationMessages(records);
    const userRecords = records.filter((r) => r.type === RecordType.user);
    const genuine = userRecords.filter((r) => isGenuineUserPrompt(r));
    const nonPrompt = userRecords.find((r) => !isGenuineUserPrompt(r));
    const returnedUserMessages = messages.filter((m) => m.role === RecordType.user);
    const returnedUserUuids = returnedUserMessages.map((m) => m.uuid?.toString());
    assert.equal(returnedUserUuids.length, genuine.length);
    if (nonPrompt !== undefined) {
        assert.ok(!returnedUserUuids.includes(nonPrompt.uuid?.toString()));
    }
});

test("test_extractConversationMessages_keeps_assistant_text_replies", () => {
    // Behavior: assistant replies with text are kept; a pure tool_use assistant turn (no text) is omitted.
    const messages = extractConversationMessages(records);
    const assistantMessages = messages.filter((m) => m.role === RecordType.assistant);
    assert.ok(assistantMessages.length > 0);
    for (const message of assistantMessages) {
        assert.notEqual(message.text, "");
    }
});

test("test_extractMessageText_reads_plain_string_user_content", () => {
    // Behavior: a user record whose message.content is a plain string yields that string as text.
    const messages = extractConversationMessages(records);
    const stringPrompt = records.find((r) => {
        const message = r.message as { content?: unknown } | undefined;
        return isGenuineUserPrompt(r) && typeof message?.content === "string";
    });
    if (stringPrompt !== undefined) {
        const raw = (stringPrompt.message as { content: string }).content;
        const built = messages.find((m) => m.uuid?.toString() === stringPrompt.uuid?.toString());
        assert.equal(built?.text, raw);
    }
});

test("test_extractMessageText_joins_assistant_text_blocks", () => {
    // Behavior: an assistant record with array content yields only its TextBlock texts.
    const messages = extractConversationMessages(records);
    const blockAssistant = records.find((r) => {
        const message = r.message as { content?: unknown } | undefined;
        return r.type === RecordType.assistant && Array.isArray(message?.content);
    });
    if (blockAssistant !== undefined) {
        const blocks = (blockAssistant.message as { content: { type: string; text?: string }[] }).content;
        const textBlocks = blocks.filter((b) => b.type === BlockType.text);
        const blockTexts = textBlocks.map((b) => b.text);
        const expected = blockTexts.join("\n");
        const built = messages.find((m) => m.uuid?.toString() === blockAssistant.uuid?.toString());
        if (expected !== "") {
            assert.equal(built?.text, expected);
        }
    }
});

test("test_summarizeBranches_marks_surviving_branch_not_rewound", () => {
    // Behavior: the surviving branch is not rewound.
    const branches = summarizeBranches(records);
    const surviving = branches.filter((b) => b.isSurviving);
    assert.ok(surviving.length >= 1);
    for (const branch of surviving) {
        assert.equal(branch.wasRewound, false);
    }
});

test("test_summarizeBranches_marks_abandoned_branch_rewound", () => {
    // Behavior: S19 has a rewound (abandoned) branch with a rewindPoint.
    const branches = summarizeBranches(records);
    const abandoned = branches.find((b) => !b.isSurviving);
    assert.ok(abandoned !== undefined);
    assert.equal(abandoned!.wasRewound, true);
    assert.notEqual(abandoned!.rewindPoint, undefined);
});

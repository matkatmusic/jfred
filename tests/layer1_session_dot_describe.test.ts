// One log record to one dot's kind, label and pair id (task 888, step 11).

import { test } from "node:test";
import assert from "node:assert/strict";
import { parseTranscriptLine } from "../src/parse/loadTranscript.ts";
import { readRecordDotDescription } from "../src/layer1_session_dot_describe.ts";
import { WireRecordKind } from "../webapp/layer1-components/session-column/layer1-wire-annotations.ts";
import type { TranscriptRecord } from "../src/structures/envelope.ts";

const SESSION_ID = "aaaa1111-0000-4000-8000-000000000001";
const TIMESTAMP = "2026-07-01T11:00:00.000Z";

function buildRecord(fields: Record<string, unknown>): TranscriptRecord {
    return parseTranscriptLine(JSON.stringify({ sessionId: SESSION_ID, timestamp: TIMESTAMP, ...fields }));
}

function buildMessageRecord(type: string, content: unknown): TranscriptRecord {
    return buildRecord({ type, uuid: "u-1", message: { role: type, content } });
}

test("test_an_assistant_record_with_a_tool_use_block_is_a_tool_use_dot_labelled_with_the_tool_name_and_paired_by_the_block_id", () => {
    // Scenario: an assistant record holds one tool_use block.
    const record = buildMessageRecord("assistant", [{ type: "tool_use", id: "toolu_1", name: "Bash", input: {} }]);
    // The dot is a tool_use dot, labelled with the tool name, paired by the block id.
    const description = readRecordDotDescription(record);
    assert.equal(description.kind, WireRecordKind.toolUse);
    assert.equal(description.label, "Bash");
    assert.equal(description.pairId?.toString(), "toolu_1");
});

test("test_a_user_record_with_a_tool_result_block_is_a_tool_result_dot_paired_by_tool_use_id", () => {
    // Scenario: a user record holds one tool_result block.
    const record = buildMessageRecord("user", [{ type: "tool_result", tool_use_id: "toolu_1", content: "done" }]);
    // The dot is a tool_result dot, paired by the tool_use_id.
    const description = readRecordDotDescription(record);
    assert.equal(description.kind, WireRecordKind.toolResult);
    assert.equal(description.pairId?.toString(), "toolu_1");
});

test("test_a_tool_result_label_is_the_first_80_characters_of_the_result", () => {
    // Scenario: the tool_result content is a 200-character string.
    const longResult = "r".repeat(200);
    const record = buildMessageRecord("user", [{ type: "tool_result", tool_use_id: "toolu_1", content: longResult }]);
    // The label is the first 80 characters.
    assert.equal(readRecordDotDescription(record).label, "r".repeat(80));
});

test("test_a_tool_result_with_array_content_joins_its_text_parts", () => {
    // Scenario: the tool_result content is an array of two text parts.
    const parts = [{ type: "text", text: "one" }, { type: "text", text: "two" }];
    const record = buildMessageRecord("user", [{ type: "tool_result", tool_use_id: "toolu_1", content: parts }]);
    // The label joins the parts with a newline.
    assert.equal(readRecordDotDescription(record).label, "one\ntwo");
});

test("test_a_user_record_with_string_content_is_a_user_dot_labelled_with_the_first_80_characters", () => {
    // Scenario: a user record whose content is a 200-character string.
    const record = buildMessageRecord("user", "u".repeat(200));
    // The dot is a user dot, labelled with the first 80 characters, with no pair id.
    const description = readRecordDotDescription(record);
    assert.equal(description.kind, WireRecordKind.user);
    assert.equal(description.label, "u".repeat(80));
    assert.equal(description.pairId, undefined);
});

test("test_an_assistant_record_with_text_blocks_is_an_assistant_dot_labelled_with_the_joined_text", () => {
    // Scenario: an assistant record holds two text blocks.
    const record = buildMessageRecord("assistant", [{ type: "text", text: "first" }, { type: "text", text: "second" }]);
    // The dot is an assistant dot, labelled with the texts joined by a newline.
    const description = readRecordDotDescription(record);
    assert.equal(description.kind, WireRecordKind.assistant);
    assert.equal(description.label, "first\nsecond");
});

test("test_an_assistant_record_with_an_unknown_block_type_still_makes_a_dot", () => {
    // Scenario: an assistant record holds a block type the parser does not know, then a text block.
    const record = buildMessageRecord("assistant", [{ type: "tool_reference" }, { type: "text", text: "hi" }]);
    // The dot is an assistant dot labelled "hi", and nothing throws.
    const description = readRecordDotDescription(record);
    assert.equal(description.kind, WireRecordKind.assistant);
    assert.equal(description.label, "hi");
});

test("test_attachment_permission_mode_and_custom_title_records_keep_their_kind_and_use_the_record_type_as_label", () => {
    // Scenario: one record of each plain type.
    const attachment = buildRecord({ type: "attachment", uuid: "u-2", attachment: { type: "x" } });
    // const permissionMode = buildRecord({ type: "permission-mode", permissionMode: "default" });
    // const customTitle = buildRecord({ type: "custom-title", customTitle: "my title" });
    const permissionMode = parseTranscriptLine(JSON.stringify({ type: "permission-mode", sessionId: SESSION_ID, permissionMode: "default" }));
    const customTitle = parseTranscriptLine(JSON.stringify({ type: "custom-title", sessionId: SESSION_ID, customTitle: "my title" }));
    // Each keeps its kind, labelled with the record type, with no pair id.
    assert.deepEqual(readRecordDotDescription(attachment), { kind: WireRecordKind.attachment, label: "attachment", pairId: undefined });
    assert.deepEqual(readRecordDotDescription(permissionMode), { kind: WireRecordKind.permissionMode, label: "permission-mode", pairId: undefined });
    assert.deepEqual(readRecordDotDescription(customTitle), { kind: WireRecordKind.customTitle, label: "custom-title", pairId: undefined });
});

test("test_any_other_record_type_is_unknown_and_labelled_with_the_record_type", () => {
    // Scenario: a system record.
    const record = buildRecord({ type: "system", uuid: "u-3", subtype: "x" });
    // The dot kind is unknown, labelled "system".
    const description = readRecordDotDescription(record);
    assert.equal(description.kind, WireRecordKind.unknown);
    assert.equal(description.label, "system");
});

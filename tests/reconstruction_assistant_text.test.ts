import { test } from "node:test";
import assert from "node:assert/strict";
import { containsAssistantText } from "../src/reconstruction_assistant_text.ts";
import { RecordType } from "../src/structures/vocabulary.ts";
import { createRecord } from "./reconstruction-branch-test-helpers.ts";

test("test_contains_assistant_text_true_for_text_block", () => {
    const record = createRecord(RecordType.assistant, "A", null, [{ type: "text", text: "hi" }]);
    assert.equal(containsAssistantText(record), true);
});

test("test_contains_assistant_text_true_for_string_content", () => {
    const record = createRecord(RecordType.assistant, "A", null, "hi" as unknown as unknown[]);
    assert.equal(containsAssistantText(record), true);
});

test("test_contains_assistant_text_false_for_blank_text_and_tool_use", () => {
    const blank = createRecord(RecordType.assistant, "A", null, [{ type: "text", text: "  " }]);
    const toolUse = createRecord(RecordType.assistant, "B", null, [{ type: "tool_use", id: "t", name: "Bash", input: {} }]);
    assert.equal(containsAssistantText(blank), false);
    assert.equal(containsAssistantText(toolUse), false);
});

test("test_contains_assistant_text_false_for_user_record", () => {
    const record = createRecord(RecordType.user, "U", null, [{ type: "text", text: "hi" }]);
    assert.equal(containsAssistantText(record), false);
});

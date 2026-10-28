// Tests for buildConversationViewModel (webapp/views/conversation-model.ts) on a small canned document.

import { test } from "node:test";
import assert from "node:assert/strict";
import { buildConversationViewModel } from "../webapp/views/conversation-model.ts";

const DOCUMENT = {
    messages: [{ uuid: "u1", role: "user", text: "hi" }],
    lineVerdicts: [
        { uuid: "x0", line: 0, type: "system", verdict: "folded" },
        { uuid: "u1", line: 1, type: "user", verdict: "kept" },
    ],
    branches: [],
    filesTouched: [],
};

test("test_buildConversationViewModel_turns_message_lines_into_message_entries_and_others_into_stubs", () => {
    // Scenario: lines keep their order; a matching uuid gives a message entry, any other line a stub.
    const { entries } = buildConversationViewModel(DOCUMENT);
    // assert kinds in line order.
    assert.deepEqual(entries.map((entry) => entry.kind), ["stub", "message"]);
    assert.equal(entries[1]!.message!.text, "hi");
});

test("test_buildConversationViewModel_stub_carries_line_type_and_verdict", () => {
    // Scenario: a stub keeps the fields the stub row prints.
    const stub = buildConversationViewModel(DOCUMENT).entries[0]!;
    // assert the stub fields match the verdict.
    assert.deepEqual([stub.line, stub.uuid, stub.type, stub.verdict], [0, "x0", "system", "folded"]);
});

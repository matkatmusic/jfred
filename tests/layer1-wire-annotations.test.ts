// Per-file test for webapp/layer1-wire-annotations.ts: the exact record-kind vocabulary.

import { test } from "node:test";
import assert from "node:assert/strict";
import { WireRecordKind } from "../webapp/layer1-wire-annotations.ts";

test("test_wire_record_kind_lists_the_exact_members", () => {
  // Verify: the eight members and their log spellings.
  assert.deepEqual(WireRecordKind, {
    user: "user",
    assistant: "assistant",
    toolUse: "tool_use",
    toolResult: "tool_result",
    attachment: "attachment",
    permissionMode: "permission-mode",
    customTitle: "custom-title",
    unknown: "unknown",
  });
});

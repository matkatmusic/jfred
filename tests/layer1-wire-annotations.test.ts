// Per-file test for webapp/layer1-wire-annotations.ts: the exact record-kind vocabulary.

import { test } from "node:test";
import assert from "node:assert/strict";
import { WireRecordKind, type WireAnnotation } from "../webapp/layer1-wire-annotations.ts";

test("test_wire_annotation_requires_session_id_and_title", () => {
  // Verify: a record with both session fields type-checks; one without them does not.
  const complete: WireAnnotation = {
    id: "a1",
    kind: WireRecordKind.user,
    instant: "2026-06-01T09:05:07.123Z",
    label: "hello",
    sessionId: "0f3c9a7e",
    sessionTitle: "seed the demo app",
    sessionFile: "/fixture/demo/projects/0f3c9a7e.jsonl",
    line: 1000,
  };
  // @ts-expect-error sessionId and sessionTitle are required
  const missing: WireAnnotation = {
    id: "a2",
    kind: WireRecordKind.user,
    instant: "2026-06-01T09:05:07.123Z",
    label: "hello",
  };
  assert.equal(complete.sessionId, "0f3c9a7e");
  assert.equal(missing.id, "a2");
});

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

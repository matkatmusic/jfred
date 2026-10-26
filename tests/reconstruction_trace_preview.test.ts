import assert from "node:assert/strict";
import { test } from "node:test";
import { getRecordKindPreview } from "../src/reconstruction_trace_preview.ts";

test("getRecordKindPreview describes a Bash tool_use by its command", () => {
  const record = { type: "assistant", message: { content: [{ type: "tool_use", name: "Bash", id: "t1", input: { command: "ls   -la" } }] } };
  assert.deepEqual(getRecordKindPreview(record, new Set()), { kind: "Bash", preview: "ls -la" });
});

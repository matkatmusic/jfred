import { test } from "node:test";
import assert from "node:assert/strict";
import { RecordType } from "../src/structures/vocabulary.ts";
import { Uuid } from "../src/structures/domain.ts";
import { createRecord, createLastPromptRecord } from "./reconstruction-branch-test-helpers.ts";

test("createRecord with a parent and blocks sets uuid, parentUuid and message content", () => {
  const blocks = [{ type: "text", text: "hi" }];
  const record = createRecord(RecordType.assistant, "a1", "p1", blocks) as unknown as Record<string, unknown>;
  assert.equal(record.type, RecordType.assistant);
  assert.deepEqual(record.uuid, new Uuid("a1"));
  assert.deepEqual(record.parentUuid, new Uuid("p1"));
  assert.deepEqual(record.message, { content: blocks });
});

test("createRecord with a null parent and no blocks has null parentUuid and no message", () => {
  const record = createRecord(RecordType.user, "u1", null) as unknown as Record<string, unknown>;
  assert.equal(record.parentUuid, null);
  assert.equal("message" in record, false);
});

test("createLastPromptRecord builds a lastPrompt record with the leaf uuid", () => {
  const record = createLastPromptRecord("leaf1") as unknown as Record<string, unknown>;
  assert.deepEqual(record, { type: RecordType.lastPrompt, leafUuid: "leaf1" });
});

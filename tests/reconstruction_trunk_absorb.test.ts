// Tests for same-turn trunk absorption of parallel tool-call siblings.

import { test } from "node:test";
import assert from "node:assert/strict";
import { addParallelToolCallSiblings } from "../src/reconstruction_trunk_absorb.ts";
import { BlockType, RecordType } from "../src/structures/vocabulary.ts";
import { Uuid } from "../src/structures/domain.ts";
import type { TranscriptRecord } from "../src/structures/envelope.ts";

function assistantRecord(uuid: string, parent: string, messageId: string): TranscriptRecord {
  return { type: RecordType.assistant, uuid: new Uuid(uuid), parentUuid: new Uuid(parent), message: { id: messageId } } as TranscriptRecord;
}

function resultRecord(uuid: string, parent: string): TranscriptRecord {
  const content = [{ type: BlockType.tool_result, tool_use_id: "t", content: "ok" }];
  return { type: RecordType.user, uuid: new Uuid(uuid), parentUuid: new Uuid(parent), message: { content } } as TranscriptRecord;
}

test("absorbs a same-message sibling and its result echo onto the trunk", () => {
  const records = [assistantRecord("A1", "P", "M1"), assistantRecord("A2", "A1", "M1"), resultRecord("R2", "A2")];
  const trunk = new Set<string>(["A1"]);
  addParallelToolCallSiblings(records, trunk);
  assert.deepEqual([...trunk].sort(), ["A1", "A2", "R2"]);
});

test("keeps an assistant record with a different message id off the trunk", () => {
  const records = [assistantRecord("A1", "P", "M1"), assistantRecord("B1", "A1", "M2")];
  const trunk = new Set<string>(["A1"]);
  addParallelToolCallSiblings(records, trunk);
  assert.deepEqual([...trunk], ["A1"]);
});

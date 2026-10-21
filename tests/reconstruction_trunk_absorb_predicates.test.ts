// Tests for the trunk absorption record predicates.

import { test } from "node:test";
import assert from "node:assert/strict";
import { findResponseMessageId, isRecordAlreadyKept, isRecordJoiningAbsorbedTurn } from "../src/reconstruction_trunk_absorb_predicates.ts";
import { BlockType, RecordType } from "../src/structures/vocabulary.ts";
import { Uuid } from "../src/structures/domain.ts";
import type { TranscriptRecord } from "../src/structures/envelope.ts";

function resultRecord(uuid: string, parent: string): TranscriptRecord {
  const content = [{ type: BlockType.tool_result, tool_use_id: "t", content: "ok" }];
  return { type: RecordType.user, uuid: new Uuid(uuid), parentUuid: new Uuid(parent), message: { content } } as TranscriptRecord;
}

function promptRecord(uuid: string, parent: string): TranscriptRecord {
  return { type: RecordType.user, uuid: new Uuid(uuid), parentUuid: new Uuid(parent), message: { content: "hi" } } as TranscriptRecord;
}

test("reads the message id and the already-kept state", () => {
  const record = { type: RecordType.assistant, uuid: new Uuid("A"), message: { id: "M1" } } as TranscriptRecord;
  assert.equal(findResponseMessageId(record), "M1");
  assert.equal(isRecordAlreadyKept(record, new Set(["A"])), true);
  assert.equal(isRecordAlreadyKept(record, new Set()), false);
});

test("a result echo joins the turn only when no real content lies below it", () => {
  const echo = resultRecord("R", "A");
  const trunk = new Set(["A"]);
  const plumbingBelow = new Map([["R", [resultRecord("R2", "R")]]]);
  const promptBelow = new Map([["R", [promptRecord("U", "R")]]]);
  assert.equal(isRecordJoiningAbsorbedTurn(echo, trunk, plumbingBelow), true);
  assert.equal(isRecordJoiningAbsorbedTurn(echo, trunk, promptBelow), false);
});

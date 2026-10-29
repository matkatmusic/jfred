// Session-root path lookups for multi-source joins: session id, root membership and root order.

import { test } from "node:test";
import assert from "node:assert/strict";
import { Path } from "../src/structures/domain.ts";
import type { TranscriptRecord } from "../src/structures/envelope.ts";
import {
  computeRootOrder,
  filterRecordsByRoot,
  getSessionId,
  isRecordInRoot,
} from "../src/reconstruction_multi_source_paths.ts";

function buildRecord(sessionId: string | undefined): TranscriptRecord {
  return { sessionId } as unknown as TranscriptRecord;
}

const ROOTS = new Map<string, Path>([["s1", new Path("/alpha")], ["s2", new Path("/beta")]]);

test("test_get_session_id_reads_envelope_field", () => {
  assert.equal(getSessionId(buildRecord("s1")), "s1");
});

test("test_is_record_in_root_matches_only_resolved_root", () => {
  assert.equal(isRecordInRoot(buildRecord("s1"), ROOTS, "/alpha"), true);
  assert.equal(isRecordInRoot(buildRecord("s1"), ROOTS, "/beta"), false);
  assert.equal(isRecordInRoot(buildRecord(undefined), ROOTS, "/alpha"), false);
});

test("test_filter_records_by_root_keeps_only_that_roots_records", () => {
  const records = [buildRecord("s1"), buildRecord("s2"), buildRecord("s1")];
  assert.equal(filterRecordsByRoot(records, ROOTS, "/alpha").length, 2);
});

test("test_compute_root_order_lists_roots_by_first_appearance", () => {
  const records = [buildRecord("s2"), buildRecord("s1"), buildRecord("s2")];
  assert.deepEqual(computeRootOrder(records, ROOTS), ["/beta", "/alpha"]);
});

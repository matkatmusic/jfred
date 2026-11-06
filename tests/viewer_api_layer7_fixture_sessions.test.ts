// Per-file test for src/viewer_api_layer7_fixture_sessions.ts: session membership, mid records, same-instant pair.

import assert from "node:assert/strict";
import { test } from "node:test";
import { buildFixtureAnnotations, listFillerIds } from "../src/viewer_api_layer7_fixture_data.ts";
import { buildFixtureLayer1View } from "../src/viewer_api_layer1_fixture_view.ts";
import {
  ANNOTATION_MID_IDS, ANNOTATION_SAME_ID, FIXTURE_LOG_SESSIONS,
} from "../src/viewer_api_layer7_fixture_sessions.ts";

const TICK_COUNT = 300;
const SESSION_COUNT = 4;
// The 36 canned S4 records plus every row record after S4 starts.
const FOURTH_SESSION_COUNT = 152;

function buildRuler() {
  const firstMs = Date.parse("2026-06-01T08:00:00Z");
  return Array.from({ length: TICK_COUNT }, (_unused, tick) => ({
    instant: new Date(firstMs + tick * 3600_000), axisPx: tick * 16, eventCount: 1,
  }));
}

function listRecords() {
  return buildFixtureAnnotations(buildRuler());
}

function listSessionRange(sessionNumber: number): { first: number; last: number } {
  const sessionId = FIXTURE_LOG_SESSIONS[sessionNumber - 1]!.id.toString();
  let first = Number.POSITIVE_INFINITY;
  let last = Number.NEGATIVE_INFINITY;
  for (const record of listRecords()) {
    const isInSession = record.sessionId.toString() === sessionId;
    if (isInSession) {
      first = Math.min(first, record.instant.getTime());
      last = Math.max(last, record.instant.getTime());
    }
  }
  return { first, last };
}

test("test_four_sessions_have_the_fixed_titles", () => {
  assert.equal(FIXTURE_LOG_SESSIONS.length, SESSION_COUNT);
  assert.deepEqual(FIXTURE_LOG_SESSIONS.map((session) => session.title), [
    "seed the demo app", "extract the trim helper", "session3", "cover the error branch, take notes",
  ]);
});

test("test_counts_per_session", () => {
  // Block 8 + fillers (1:6, 2:~, ...) are fixed by the digit string; check totals and S4.
  const counts = new Map<string, number>();
  for (const record of listRecords()) {
    counts.set(record.sessionId.toString(), (counts.get(record.sessionId.toString()) ?? 0) + 1);
  }
  assert.equal(counts.size, SESSION_COUNT);
  let total = 0;
  for (const count of counts.values()) {
    total += count;
  }
  // assert.equal(total, 81);
  // 81 canned records, plus one row record for each of the 235 ticks that had no visible record.
  assert.equal(total, 81 + 235);
  const fourthId = FIXTURE_LOG_SESSIONS[3]!.id.toString();
  // assert.equal(counts.get(fourthId), 30 + 6);
  assert.equal(counts.get(fourthId), FOURTH_SESSION_COUNT);
});

function listTickMs(): Set<number> {
  return new Set(buildRuler().map((tick) => tick.instant.getTime()));
}

test("test_every_ruler_row_has_at_least_one_annotation", () => {
  // Build annotations for the 300-tick ruler.
  const annotatedMs = new Set(listRecords().map((record) => record.instant.getTime()));
  // Every tick instant is the instant of some annotation.
  for (const tickMs of listTickMs()) {
    assert.ok(annotatedMs.has(tickMs), `no annotation at ${new Date(tickMs).toISOString()}`);
  }
});

test("test_every_ruler_row_has_a_record_that_hide_ignored_keeps_visible", () => {
  // Build annotations for the 300-tick ruler, then drop the records the hide-ignored box hides.
  const visibleMs = new Set(listRecords().filter((record) => record.isIgnored !== true).map((record) => record.instant.getTime()));
  // Every tick instant is the instant of some visible record, so every ruler row keeps a dot.
  for (const tickMs of listTickMs()) {
    assert.ok(visibleMs.has(tickMs), `no visible record at ${new Date(tickMs).toISOString()}`);
  }
});

test("test_building_annotations_keeps_the_ruler_row_count", () => {
  // Build annotations for the real fixture view, then check its ruler still has 419 rows with a dot each.
  const view = buildFixtureLayer1View();
  assert.equal(view.ruler.length, 419);
  const annotatedMs = new Set(view.annotations!.map((annotation) => annotation.instant.getTime()));
  for (const row of view.ruler) {
    assert.ok(annotatedMs.has(row.instant.getTime()));
  }
});

test("test_each_row_annotation_takes_the_session_of_the_nearest_earlier_annotation", () => {
  // Split the records into the canned ones and the new row ones.
  const records = listRecords();
  const rows = records.filter((record) => record.id.toString().startsWith("l7-row-"));
  const canned = records.filter((record) => !record.id.toString().startsWith("l7-row-"));
  assert.equal(rows.length, 235);
  for (const row of rows) {
    // The nearest earlier canned record is the last one before the row's instant.
    const earlier = canned.filter((record) => record.instant.getTime() < row.instant.getTime());
    const expectedId = earlier.length === 0 ? FIXTURE_LOG_SESSIONS[0]!.id : earlier[earlier.length - 1]!.sessionId;
    assert.equal(row.sessionId.toString(), expectedId.toString());
    assert.equal(row.kind, "assistant");
    assert.equal(row.label, "Made-up chat line");
  }
});

test("test_each_session_file_and_line_pair_is_unique_and_lines_start_at_1000", () => {
  // Collect every sessionFile and line pair.
  const pairs = listRecords().map((record) => `${record.sessionFile}:${record.line}`);
  assert.equal(new Set(pairs).size, pairs.length);
  // Each file starts at line 1000.
  for (const session of FIXTURE_LOG_SESSIONS) {
    const lines = listRecords().filter((record) => record.sessionFile === `/fixture/demo/projects/${session.file}`).map((record) => record.line);
    assert.equal(Math.min(...lines), 1000);
  }
});

test("test_session_three_ends_overlap_sessions_one_and_two", () => {
  const one = listSessionRange(1);
  const two = listSessionRange(2);
  const three = listSessionRange(3);
  assert.ok(three.first >= one.first && three.first <= one.last);
  assert.ok(three.first >= two.first && three.first <= two.last);
  assert.ok(three.last >= two.first && three.last <= two.last);
});

test("test_session_four_starts_after_the_others_end", () => {
  const four = listSessionRange(4);
  for (const sessionNumber of [1, 2, 3]) {
    assert.ok(four.first > listSessionRange(sessionNumber).last);
  }
});

test("test_every_mid_record_is_on_no_ruler_tick", () => {
  const tickMs = new Set(buildRuler().map((tick) => tick.instant.getTime()));
  const midIds = new Set(ANNOTATION_MID_IDS.map((id) => id.toString()));
  const mids = listRecords().filter((record) => midIds.has(record.id.toString()));
  assert.equal(mids.length, 12);
  for (const mid of mids) {
    assert.ok(!tickMs.has(mid.instant.getTime()));
  }
});

test("test_same_record_shares_an_instant_with_filler_seven_and_differs_in_session", () => {
  const records = listRecords();
  const same = records.find((record) => record.id.toString() === ANNOTATION_SAME_ID.toString())!;
  const filler = records.find((record) => record.id.toString() === listFillerIds()[7]!.toString())!;
  assert.equal(same.instant.getTime(), filler.instant.getTime());
  assert.notEqual(same.sessionId.toString(), filler.sessionId.toString());
});

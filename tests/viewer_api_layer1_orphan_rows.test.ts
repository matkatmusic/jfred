// Orphan row placement: instant lookup fails loudly, rows sort ascending, disk rows read slot 0.

import { test } from "node:test";
import assert from "node:assert/strict";
import { Path } from "../src/structures/domain.ts";
import { buildDiskOrphanRow, buildInstantOnAxis, sortRowsByInstant } from "../src/viewer_api_layer1_orphan_rows.ts";

const EARLY = new Date("2020-01-01T00:00:00Z");
const LATE = new Date("2021-01-01T00:00:00Z");

test("test_buildInstantOnAxis_throws_when_the_instant_is_missing", () => {
  assert.throws(() => buildInstantOnAxis(new Map(), EARLY), /missing from the resolved ruler/);
});

test("test_buildInstantOnAxis_returns_the_resolved_offset", () => {
  const placed = buildInstantOnAxis(new Map([[EARLY.getTime(), 5]]), EARLY);
  assert.deepEqual(placed, { instant: EARLY, axisPx: 5 });
});

test("test_sortRowsByInstant_orders_ascending_without_mutating", () => {
  const rows = [
    { path: new Path("late"), instant: LATE, axisPx: 2 },
    { path: new Path("early"), instant: EARLY, axisPx: 1 },
  ];
  const sorted = sortRowsByInstant(rows);
  assert.equal(sorted[0]?.path.toString(), "early");
  assert.equal(rows[0]?.path.toString(), "late");
});

test("test_buildDiskOrphanRow_places_the_file_node_at_slot_zero", () => {
  const row = buildDiskOrphanRow({ relativePath: new Path("x"), mtime: EARLY }, [7]);
  assert.deepEqual(row, { path: new Path("x"), instant: EARLY, axisPx: 7 });
});

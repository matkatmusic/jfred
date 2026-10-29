import { test } from "node:test";
import assert from "node:assert/strict";
import "../src/viewer_api_layer3_fixture_data.ts";
import { buildCraftedEvents } from "../src/viewer_api_layer3_fixture_crafted_events.ts";
import { WireEditKind } from "../webapp/layer1-wire-edits.ts";

test("test_buildCraftedEvents_returns_twelve_events_with_unique_change_ids", () => {
  const events = buildCraftedEvents();
  const changeIds = new Set(events.map((event) => event.changeId));
  assert.equal(events.length, 12);
  assert.equal(changeIds.size, 12);
});

test("test_buildCraftedEvents_lists_events_oldest_first_per_path", () => {
  const events = buildCraftedEvents();
  const lastInstantByPath = new Map<string, string>();
  for (const event of events) {
    const previous = lastInstantByPath.get(event.path) ?? "";
    assert.ok(previous <= event.at, `${event.path} out of order at ${event.at}`);
    lastInstantByPath.set(event.path, event.at);
  }
});

test("test_buildCraftedEvents_marks_only_the_stale_edit_as_expectDerived", () => {
  const derived = buildCraftedEvents().filter((event) => event.expectDerived === true);
  assert.equal(derived.length, 1);
  assert.equal(derived[0]!.kind, WireEditKind.edit);
});

test("test_buildCraftedEvents_gives_edits_hunks_and_reads_and_writes_content", () => {
  for (const event of buildCraftedEvents()) {
    if (event.kind === WireEditKind.edit) {
      assert.ok(event.hunks !== undefined && event.hunks.length > 0);
    }
    else {
      assert.ok(event.content !== undefined && event.content.length > 0);
    }
  }
});

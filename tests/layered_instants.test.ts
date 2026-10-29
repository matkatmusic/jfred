// Task 197 (spec S1): instant axis placement with the Q7/Q9 same-second content-order tiebreak.

import { test } from "node:test";
import assert from "node:assert/strict";
import {
    compareAxisPlacements,
    convertEpochSecondsToInstant,
    type AxisPlacement,
} from "../src/layered_instants.ts";

// Build a placement without repeating the object literal in every test.
function makePlacement(instantMs: number, widenedFromSeconds: boolean, content: string | undefined): AxisPlacement {
    return { instant: new Date(instantMs), widenedFromSeconds, content };
}

test("test_convertEpochSecondsToInstant_multiplies_by_1000", () => {
    // Scenario: git committer time is in epoch seconds, the axis is UTC ms; widen one second.
    const instant = convertEpochSecondsToInstant(1_700_000_000);
    // the resulting Instant sits at exactly that second's ms boundary.
    assert.equal(instant.getTime(), 1_700_000_000_000);
});

test("test_same_second_equal_content_places_commit_after_jsonl", () => {
    // Scenario: commit and JSONL row share a second with IDENTICAL content; the commit sorts after.
    const commit = makePlacement(1_700_000_000_000, true, "A\n");
    const jsonl = makePlacement(1_700_000_000_400, false, "A\n");
    // the comparator orders jsonl first, commit second, from BOTH argument orders.
    assert.ok(compareAxisPlacements(jsonl, commit) < 0);
    assert.ok(compareAxisPlacements(commit, jsonl) > 0);
});

test("test_same_second_differing_content_places_commit_before_jsonl", () => {
    // Scenario: same-second pair with DIFFERING content; the commit holds the older state and sorts before.
    const commit = makePlacement(1_700_000_000_000, true, "OLD\n");
    const jsonl = makePlacement(1_700_000_000_400, false, "NEW\n");
    // the comparator orders commit first from both argument orders.
    assert.ok(compareAxisPlacements(commit, jsonl) < 0);
    assert.ok(compareAxisPlacements(jsonl, commit) > 0);
});

test("test_same_second_unknown_content_falls_back_to_ms_order", () => {
    // Scenario: the tiebreak needs BOTH contents; a side without content falls back to ms order.
    const commit = makePlacement(1_700_000_000_000, true, undefined);
    const jsonl = makePlacement(1_700_000_000_400, false, "A\n");
    // ms order puts the second-boundary commit first.
    assert.ok(compareAxisPlacements(commit, jsonl) < 0);
    assert.ok(compareAxisPlacements(jsonl, commit) > 0);
});

test("test_different_seconds_order_by_ms", () => {
    // Scenario: the tiebreak applies only WITHIN a second; across seconds ms order wins.
    const commit = makePlacement(1_700_000_001_000, true, "A\n");
    const jsonl = makePlacement(1_700_000_000_400, false, "A\n");
    // the earlier ms instant sorts first.
    assert.ok(compareAxisPlacements(jsonl, commit) < 0);
    assert.ok(compareAxisPlacements(commit, jsonl) > 0);
});

test("test_same_precision_same_ms_compare_equal_for_stable_source_order", () => {
    // Scenario: two JSONL placements at the same ms compare equal, so a stable sort keeps source order.
    const first = makePlacement(1_700_000_000_400, false, "A\n");
    const second = makePlacement(1_700_000_000_400, false, "B\n");
    // the comparator returns 0 for the pair.
    assert.equal(compareAxisPlacements(first, second), 0);
});

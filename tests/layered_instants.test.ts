// Task 197 (spec S1): instant axis placement — git committer seconds widened ×1000 onto the
// shared UTC-ms axis, with the Q7/Q9 content-order tiebreak for same-second commit-vs-JSONL
// placements.

import { test } from "node:test";
import assert from "node:assert/strict";
import {
    compareAxisPlacements,
    widenCommitterSecondsToInstant,
    type AxisPlacement,
} from "../src/layered_instants.ts";

// Build a placement without repeating the object literal in every test.
function makePlacement(instantMs: number, widenedFromSeconds: boolean, content: string | undefined): AxisPlacement {
    return { instant: new Date(instantMs), widenedFromSeconds, content };
}

test("test_widenCommitterSecondsToInstant_multiplies_by_1000", () => {
    // Scenario: git committer time arrives in whole epoch seconds; the shared axis is UTC ms.
    // Steps:
    // widen a known committer second.
    const instant = widenCommitterSecondsToInstant(1_700_000_000);
    // the resulting Instant sits at exactly that second's ms boundary.
    assert.equal(instant.getTime(), 1_700_000_000_000);
});

test("test_same_second_equal_content_places_commit_after_jsonl", () => {
    // Scenario: a commit and a JSONL row share a second and hold IDENTICAL content — the commit
    // blob snapshotted the state the JSONL row produced, so the commit sorts after it.
    // Steps:
    // a widened (git) placement at the second boundary and an ms (JSONL) placement inside it.
    const commit = makePlacement(1_700_000_000_000, true, "A\n");
    const jsonl = makePlacement(1_700_000_000_400, false, "A\n");
    // the comparator orders jsonl first, commit second, from BOTH argument orders.
    assert.ok(compareAxisPlacements(jsonl, commit) < 0);
    assert.ok(compareAxisPlacements(commit, jsonl) > 0);
});

test("test_same_second_differing_content_places_commit_before_jsonl", () => {
    // Scenario: same-second pair with DIFFERING content — had the commit happened after the
    // JSONL change, its blob would hold that content, so the commit sorts before it.
    // Steps:
    // a widened placement whose content is the older state.
    const commit = makePlacement(1_700_000_000_000, true, "OLD\n");
    const jsonl = makePlacement(1_700_000_000_400, false, "NEW\n");
    // the comparator orders commit first from both argument orders.
    assert.ok(compareAxisPlacements(commit, jsonl) < 0);
    assert.ok(compareAxisPlacements(jsonl, commit) > 0);
});

test("test_same_second_unknown_content_falls_back_to_ms_order", () => {
    // Scenario: the tiebreak needs BOTH contents; a byteless side degrades to plain ms order.
    // Steps:
    // a widened placement with no content at the second boundary.
    const commit = makePlacement(1_700_000_000_000, true, undefined);
    const jsonl = makePlacement(1_700_000_000_400, false, "A\n");
    // ms order puts the second-boundary commit first.
    assert.ok(compareAxisPlacements(commit, jsonl) < 0);
    assert.ok(compareAxisPlacements(jsonl, commit) > 0);
});

test("test_different_seconds_order_by_ms", () => {
    // Scenario: the content tiebreak applies only WITHIN a second — across seconds the widened
    // flag is irrelevant and ms order wins even when contents are equal.
    // Steps:
    // a widened placement one second after an ms placement, identical content.
    const commit = makePlacement(1_700_000_001_000, true, "A\n");
    const jsonl = makePlacement(1_700_000_000_400, false, "A\n");
    // the earlier ms instant sorts first.
    assert.ok(compareAxisPlacements(jsonl, commit) < 0);
    assert.ok(compareAxisPlacements(commit, jsonl) > 0);
});

test("test_same_precision_same_ms_compare_equal_for_stable_source_order", () => {
    // Scenario: two JSONL placements at the exact same ms — the comparator reports equality so a
    // stable sort preserves source (line) order, which IS content order within a session.
    // Steps:
    // two ms placements at one instant.
    const first = makePlacement(1_700_000_000_400, false, "A\n");
    const second = makePlacement(1_700_000_000_400, false, "B\n");
    // the comparator returns 0 for the pair.
    assert.equal(compareAxisPlacements(first, second), 0);
});

// Per-file test for webapp/layer1-cut-rules.ts: refusal order, the three texts, and the facts that give no refusal.

import { test } from "node:test";
import assert from "node:assert/strict";
import { CUT_REFUSAL_TEXT, CutRefusal, findCutRefusal } from "../webapp/layer1-components/commits-column/layer1-cut-rules.ts";

const TIP_MS = Date.parse("2026-06-03T10:30:00Z");
const LATER_MS = Date.parse("2026-06-03T18:20:00Z");
const EARLIER_MS = Date.parse("2026-06-01T14:30:00Z");

test("test_a_tick_without_a_beacon_gets_no_verified_node", () => {
  // Verify: rule 1 fires first, even when the tick is also before the tip.
  const facts = { isBeacon: false, isCommit: false, instantMs: EARLIER_MS, tipMs: TIP_MS };
  assert.equal(findCutRefusal(facts), CutRefusal.noVerifiedNode);
});

test("test_no_base_and_not_a_commit_needs_a_commit", () => {
  // Verify: a snapshot-only beacon cannot start the branch.
  const facts = { isBeacon: true, isCommit: false, instantMs: LATER_MS, tipMs: undefined };
  assert.equal(findCutRefusal(facts), CutRefusal.baseNeedsCommit);
});

test("test_no_base_and_a_commit_beacon_is_accepted", () => {
  // Verify: a commit tick can become the base.
  const facts = { isBeacon: true, isCommit: true, instantMs: LATER_MS, tipMs: undefined };
  assert.equal(findCutRefusal(facts), undefined);
});

test("test_a_beacon_before_the_tip_is_not_forward", () => {
  // Verify: rule 3 refuses an earlier beacon.
  const facts = { isBeacon: true, isCommit: true, instantMs: EARLIER_MS, tipMs: TIP_MS };
  assert.equal(findCutRefusal(facts), CutRefusal.notForward);
});

test("test_a_beacon_at_the_tip_is_not_forward", () => {
  // Verify: equal to the tip is refused.
  const facts = { isBeacon: true, isCommit: false, instantMs: TIP_MS, tipMs: TIP_MS };
  assert.equal(findCutRefusal(facts), CutRefusal.notForward);
});

test("test_a_beacon_after_the_tip_is_accepted", () => {
  // Verify: a later beacon gives no refusal.
  const facts = { isBeacon: true, isCommit: false, instantMs: LATER_MS, tipMs: TIP_MS };
  assert.equal(findCutRefusal(facts), undefined);
});

test("test_a_created_only_tick_before_the_tip_gives_no_verified_node", () => {
  // Verify: the order puts rule 1 ahead of rule 3.
  const facts = { isBeacon: false, isCommit: false, instantMs: EARLIER_MS, tipMs: TIP_MS };
  assert.equal(findCutRefusal(facts), CutRefusal.noVerifiedNode);
});

test("test_refusal_texts_are_three_distinct_exact_strings", () => {
  // Verify: one text per refusal, none repeated.
  assert.deepEqual(CUT_REFUSAL_TEXT, {
    [CutRefusal.noVerifiedNode]: "No mark here: this time has no verified node (commit, on-disk or snapshot).",
    [CutRefusal.notForward]: "No mark here: marks only extend forward from the last jfred commit.",
    [CutRefusal.baseNeedsCommit]: "No base here: the base must be a commit.",
  });
  assert.equal(new Set(Object.values(CUT_REFUSAL_TEXT)).size, 3);
});

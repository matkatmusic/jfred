// Per-file test for webapp/layer1-cut-rules.ts: refusal order, the three texts, and the facts that give no refusal.

import { test } from "node:test";
import assert from "node:assert/strict";
import { CUT_REFUSAL_TEXT, CutRefusal, findCutRefusal } from "../webapp/layer1-components/commits-column/layer1-cut-rules.ts";

const TIP_MS = Date.parse("2026-06-03T10:30:00Z");
const LATER_MS = Date.parse("2026-06-03T18:20:00Z");
const EARLIER_MS = Date.parse("2026-06-01T14:30:00Z");

// test("test_a_tick_without_a_beacon_gets_no_verified_node", () => {
//   // Verify: rule 1 fires first, even when the tick is also before the tip.
//   const facts = { isBeacon: false, isCommit: false, instantMs: EARLIER_MS, tipMs: TIP_MS };
//   assert.equal(findCutRefusal(facts), CutRefusal.noVerifiedNode);
// });
test("test_with_no_tip_a_non_beacon_row_still_says_no_verified_node", () => {
  // Verify: with no base the old first rule still fires.
  const facts = { isBeacon: false, isCommit: false, isChangedSinceTip: false, instantMs: LATER_MS, tipMs: undefined };
  assert.equal(findCutRefusal(facts), CutRefusal.noVerifiedNode);
});

test("test_with_no_tip_a_beacon_row_that_is_not_a_commit_still_says_base_needs_commit", () => {
  // Verify: a snapshot-only beacon cannot start the branch.
  const facts = { isBeacon: true, isCommit: false, isChangedSinceTip: false, instantMs: LATER_MS, tipMs: undefined };
  assert.equal(findCutRefusal(facts), CutRefusal.baseNeedsCommit);
});

test("test_no_base_and_a_commit_beacon_is_accepted", () => {
  // Verify: a commit tick can become the base.
  const facts = { isBeacon: true, isCommit: true, isChangedSinceTip: false, instantMs: LATER_MS, tipMs: undefined };
  assert.equal(findCutRefusal(facts), undefined);
});

test("test_with_a_tip_a_row_not_newer_than_the_tip_says_not_forward_even_when_no_file_changed", () => {
  // Verify: a row before the tip says forward only, not no change, and not no verified node.
  const facts = { isBeacon: false, isCommit: false, isChangedSinceTip: false, instantMs: EARLIER_MS, tipMs: TIP_MS };
  assert.equal(findCutRefusal(facts), CutRefusal.notForward);
});

test("test_a_row_at_the_tip_is_not_forward", () => {
  // Verify: equal to the tip is refused.
  const facts = { isBeacon: true, isCommit: false, isChangedSinceTip: true, instantMs: TIP_MS, tipMs: TIP_MS };
  assert.equal(findCutRefusal(facts), CutRefusal.notForward);
});

test("test_with_a_tip_a_newer_row_with_no_changed_file_says_no_change_since_tip", () => {
  // Verify: the beacon facts no longer matter with a tip.
  const facts = { isBeacon: true, isCommit: true, isChangedSinceTip: false, instantMs: LATER_MS, tipMs: TIP_MS };
  assert.equal(findCutRefusal(facts), CutRefusal.noChangeSinceTip);
});

test("test_with_a_tip_a_newer_row_with_a_changed_file_has_no_refusal", () => {
  // Verify: a changed row gives no refusal, also when it holds no beacon.
  const facts = { isBeacon: false, isCommit: false, isChangedSinceTip: true, instantMs: LATER_MS, tipMs: TIP_MS };
  assert.equal(findCutRefusal(facts), undefined);
});

test("test_the_no_change_text_reads_as_in_the_contract", () => {
  // Verify: the exact text of the new refusal.
  assert.equal(CUT_REFUSAL_TEXT[CutRefusal.noChangeSinceTip], "No mark here: no file changed at this time compared with the last jfred commit.");
});

test("test_refusal_texts_are_four_distinct_exact_strings", () => {
  // Verify: one text per refusal, none repeated.
  assert.deepEqual(CUT_REFUSAL_TEXT, {
    [CutRefusal.noVerifiedNode]: "No mark here: this time has no node that holds file contents (commit, on-disk, snapshot or edit).",
    [CutRefusal.notForward]: "No mark here: marks only extend forward from the last jfred commit.",
    [CutRefusal.baseNeedsCommit]: "No base here: the base must be a commit.",
    [CutRefusal.noChangeSinceTip]: "No mark here: no file changed at this time compared with the last jfred commit.",
  });
  assert.equal(new Set(Object.values(CUT_REFUSAL_TEXT)).size, 4);
});

// Task 358 part N: nearest beacon, change-between, verdict, and worst-of rules.

import assert from "node:assert/strict";
import { test } from "node:test";
import { BeaconSource, type BeaconCandidate } from "../src/layer1_beacon_candidates.ts";
import { computeFileVerdict, findNearestBeaconAfter, isChangeBetween, findWorstConfidence, type ChangeEvent } from "../src/layer1_run_verdict.ts";
import { Path } from "../src/structures/domain.ts";
import { WireConfidence, WireEditKind } from "../webapp/layer1-wire-edits.ts";

const TARGET = new Path("/work/a.py");
const RUN = new Date("2026-07-24T10:00:00.000Z");
const LATER = new Date("2026-07-24T10:05:00.000Z");

function buildCandidate(source: BeaconSource, instant: Date, content = "x\n"): BeaconCandidate {
  return { source, instant, content };
}

function buildChange(kind: WireEditKind, instant: Date, target = TARGET): ChangeEvent {
  return { kind, target, instant };
}

test("test_findNearestBeaconAfter_takes_the_smallest_instant_after_the_run", () => {
  const near = buildCandidate(BeaconSource.commit, new Date("2026-07-24T10:01:00.000Z"));
  const far = buildCandidate(BeaconSource.readEcho, LATER);
  assert.equal(findNearestBeaconAfter([far, near], RUN), near);
});

test("test_findNearestBeaconAfter_ignores_an_instant_equal_to_the_run", () => {
  const same = buildCandidate(BeaconSource.fileHistory, RUN);
  assert.equal(findNearestBeaconAfter([same], RUN), undefined);
  const after = buildCandidate(BeaconSource.fileHistory, new Date(RUN.getTime() + 1));
  assert.equal(findNearestBeaconAfter([same, after], RUN), after);
});

test("test_findNearestBeaconAfter_breaks_ties_in_source_order", () => {
  const sources = [BeaconSource.commit, BeaconSource.bashCat, BeaconSource.readEcho, BeaconSource.fileHistory];
  const tied = sources.map((source) => buildCandidate(source, LATER));
  assert.equal(findNearestBeaconAfter(tied, RUN)!.source, BeaconSource.fileHistory);
  assert.equal(findNearestBeaconAfter(tied.slice(0, 3), RUN)!.source, BeaconSource.readEcho);
  assert.equal(findNearestBeaconAfter(tied.slice(0, 2), RUN)!.source, BeaconSource.bashCat);
});

test("test_computeFileVerdict_equal_content_is_verified", () => {
  const beacon = buildCandidate(BeaconSource.readEcho, LATER, "same\n");
  assert.equal(computeFileVerdict("same\n", beacon, false), WireConfidence.verified);
});

test("test_computeFileVerdict_different_content_is_mismatch", () => {
  const beacon = buildCandidate(BeaconSource.readEcho, LATER, "same\n");
  assert.equal(computeFileVerdict("other\n", beacon, false), WireConfidence.mismatch);
});

test("test_computeFileVerdict_no_beacon_or_a_change_between_is_undefined", () => {
  const beacon = buildCandidate(BeaconSource.readEcho, LATER, "same\n");
  assert.equal(computeFileVerdict("same\n", undefined, false), undefined);
  assert.equal(computeFileVerdict("same\n", beacon, true), undefined);
});

test("test_isChangeBetween_sees_an_edit_or_write_of_the_same_path_strictly_between", () => {
  const middle = new Date("2026-07-24T10:02:00.000Z");
  assert.equal(isChangeBetween(TARGET, RUN, LATER, [buildChange(WireEditKind.edit, middle)]), true);
  assert.equal(isChangeBetween(TARGET, RUN, LATER, [buildChange(WireEditKind.write, middle)]), true);
});

test("test_isChangeBetween_ignores_reads_other_paths_and_outside_instants", () => {
  const middle = new Date("2026-07-24T10:02:00.000Z");
  const events = [
    buildChange(WireEditKind.read, middle),
    buildChange(WireEditKind.edit, middle, new Path("/work/b.py")),
    buildChange(WireEditKind.edit, RUN),
    buildChange(WireEditKind.edit, LATER),
  ];
  assert.equal(isChangeBetween(TARGET, RUN, LATER, events), false);
});

test("test_findWorstConfidence_orders_mismatch_then_injected_unverified_then_verified", () => {
  const { verified, injectedUnverified, mismatch } = WireConfidence;
  assert.equal(findWorstConfidence([verified, injectedUnverified, mismatch]), mismatch);
  assert.equal(findWorstConfidence([verified, injectedUnverified]), injectedUnverified);
  assert.equal(findWorstConfidence([verified]), verified);
  assert.equal(findWorstConfidence([]), undefined);
});

test("test_findWorstConfidence_throws_for_a_confidence_without_a_rank", () => {
  assert.throws(() => findWorstConfidence([WireConfidence.derived]), /no worst-of rank/);
});

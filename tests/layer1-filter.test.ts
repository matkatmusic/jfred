// Expected pixels are hand-derived, never from layOutNodeLadders — that would pass whatever it did.

import { test } from "node:test";
import assert from "node:assert/strict";
import { filterLayer1ViewByTargets } from "../webapp/layer1-filter.ts";
import { RULER_NODE_ROW_PIXELS } from "../webapp/layer1-ruler-axis.ts";
import type { WireLayer1View } from "../webapp/layer1-wire.ts";
import { initLayer1Dom } from "./webapp-dom-test-helpers.ts";
import { FULL_VIEW, KEEP_TARGETS, T0, T1, T2, T3, T5, T6, findPair } from "./layer1-filter-test-helpers.ts";

test("test_filtering_to_a_folder_keeps_only_that_folders_files", () => {
    // A folder selection filters all three record kinds, not just the pairs.
    const filtered = filterLayer1ViewByTargets(FULL_VIEW, KEEP_TARGETS);
    assert.deepEqual(filtered.pairs.map((pair) => pair.path), ["src/keep/a.ts", "src/keep/b.ts", "src/keep/deep/d.ts"]);
    assert.deepEqual(filtered.gitOrphans, []);
    assert.deepEqual(filtered.diskOrphans.map((orphan) => orphan.path), ["src/keep/extra.ts"]);
});

test("test_filtering_keeps_files_in_nested_subfolders", () => {
    // "That folder's files" includes every subfolder below it.
    const filtered = filterLayer1ViewByTargets(FULL_VIEW, KEEP_TARGETS);
    assert.ok(filtered.pairs.some((pair) => pair.path === "src/keep/deep/d.ts"));
});

test("test_filtering_matches_a_target_exactly_and_not_by_prefix", () => {
    // A startsWith test would let `src/keep/a.ts` drag in `src/keep/a.ts.bak` (task 278).
    const withLookalike: WireLayer1View = {
        ...FULL_VIEW,
        pairs: [...FULL_VIEW.pairs, { path: "src/keep/a.ts.bak", commits: [{ hash: "za", instant: T1, axisPx: 44 }], onDisk: { instant: T1, axisPx: 44 } }],
    };
    const filtered = filterLayer1ViewByTargets(withLookalike, KEEP_TARGETS);
    assert.ok(!filtered.pairs.some((pair) => pair.path === "src/keep/a.ts.bak"));
});

test("test_the_filtered_ruler_holds_only_the_surviving_instants", () => {
    // The ruler is recomputed over the filtered set; instants with no surviving record leave it.
    const filtered = filterLayer1ViewByTargets(FULL_VIEW, KEEP_TARGETS);
    assert.deepEqual(filtered.ruler.map((tick) => tick.instant), [T0, T1, T2, T3, T5, T6]);
});

test("test_the_filtered_ruler_starts_at_zero", () => {
    // The full view's earliest instant belongs to a dropped file, so reused offsets fail here.
    const filtered = filterLayer1ViewByTargets(FULL_VIEW, KEEP_TARGETS);
    assert.equal(filtered.ruler[0]?.axisPx, 0);
    assert.equal(filtered.ruler[0]?.instant, T0);
});

test("test_the_filtered_ruler_is_shorter_than_the_full_ruler", () => {
    // The timeline's height is the last tick's offset, so dropping the latest instant shortens it.
    const filtered = filterLayer1ViewByTargets(FULL_VIEW, KEEP_TARGETS);
    assert.equal(filtered.ruler.at(-1)?.axisPx, 132);
    assert.equal(FULL_VIEW.ruler.at(-1)?.axisPx, 198);
});

test("test_a_filtered_pair_keeps_its_instants_and_takes_new_offsets", () => {
    // The re-layout re-places nodes; it must never re-time them.
    const filtered = filterLayer1ViewByTargets(FULL_VIEW, KEEP_TARGETS);
    const pair = findPair(filtered, "src/keep/a.ts");
    assert.deepEqual(pair.commits.map((commit) => commit.instant), [T0, T2]);
    assert.equal(pair.onDisk.instant, T5);
    assert.deepEqual(pair.commits.map((commit) => commit.axisPx), [0, 44]);
    assert.equal(pair.onDisk.axisPx, 110);
});

test("test_two_nodes_of_one_pair_at_the_same_instant_still_take_different_rows", () => {
    // A commit and mtime sharing a moment is the overprinting task 251 removed.
    const filtered = filterLayer1ViewByTargets(FULL_VIEW, KEEP_TARGETS);
    const pair = findPair(filtered, "src/keep/b.ts");
    assert.equal(pair.commits[0]?.instant, pair.onDisk.instant);
    assert.equal(pair.onDisk.axisPx - pair.commits[0]!.axisPx, RULER_NODE_ROW_PIXELS);
});

test("test_an_empty_selection_restores_every_record_at_its_original_offset", () => {
    // Task 253: clearing the filter takes the SAME re-layout, so it must land on the endpoint's offsets.
    const restored = filterLayer1ViewByTargets(FULL_VIEW, undefined);
    // every record comes back at the offsets the fixture arrived with.
    assert.deepEqual(restored, FULL_VIEW);
});

test("test_a_filter_that_matches_nothing_draws_zero_files", () => {
    // Task 326: two active pickers with no overlap must EMPTY the stage, never show everything.
    const filtered = filterLayer1ViewByTargets(FULL_VIEW, []);
    assert.equal(filtered.pairs.length, 0);
    assert.equal(filtered.gitOrphans.length, 0);
    assert.equal(filtered.diskOrphans.length, 0);
    assert.equal(filtered.ruler.length, 0);
});

test("test_two_pickers_intersect_and_an_empty_one_does_not_filter", async () => {
    // Tasks 292+326: an idle picker never filters; dynamic import because layer1-page.ts boots at module scope.
    initLayer1Dom();
    const { getIntersectedFilterTargets: intersectFilterTargets } = await import("../webapp/layer1-view-render.ts");
    // Steps: both pickers idle means no filter at all, spelled undefined.
    assert.equal(intersectFilterTargets([], []), undefined);
    // one picker idle, the other holding a selection.
    assert.deepEqual(intersectFilterTargets([], ["a.ts", "b.ts"]), ["a.ts", "b.ts"]);
    assert.deepEqual(intersectFilterTargets(["a.ts"], []), ["a.ts"]);
    // both holding one: only what they agree on survives.
    assert.deepEqual(intersectFilterTargets(["a.ts", "b.ts"], ["b.ts", "c.ts"]), ["b.ts"]);
    // and no overlap draws nothing, which is the honest answer rather than either picker's list.
    assert.deepEqual(intersectFilterTargets(["a.ts"], ["c.ts"]), []);
});

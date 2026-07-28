// Expected pixels are hand-derived, never from layOutNodeLadders — that would pass whatever it did.

import { test } from "node:test";
import assert from "node:assert/strict";
import { filterLayer1ViewByTargets, relayOutLayer1View } from "../webapp/layer1-filter.ts";
import { RULER_NODE_ROW_PIXELS } from "../webapp/layer1-ruler-axis.ts";
import type { WireLayer1View } from "../webapp/layer1-wire.ts";
import { setupLayer1Dom } from "./webapp-dom-test-helpers.ts";

// Full ISO-8601 UTC, because the re-layout round-trips these through Date.toISOString().
const EARLY = "2026-07-01T08:00:00.000Z";
const T0 = "2026-07-01T10:00:00.000Z";
const T1 = "2026-07-01T11:00:00.000Z";
const T2 = "2026-07-01T12:00:00.000Z";
const T3 = "2026-07-01T13:00:00.000Z";
const T4 = "2026-07-01T14:00:00.000Z";
const T5 = "2026-07-01T15:00:00.000Z";
const T6 = "2026-07-01T16:00:00.000Z";
const T7 = "2026-07-01T17:00:00.000Z";

// `src/drop/` owns BOTH the earliest and latest instants, so reused server offsets fail on both.
const KEEP_TARGETS = ["src/keep/a.ts", "src/keep/b.ts", "src/keep/deep/d.ts", "src/keep/extra.ts"];

const FULL_VIEW: WireLayer1View = {
    pairs: [
        { path: "src/keep/a.ts", commits: [{ hash: "aa", instant: T0, axisPx: 22 }, { hash: "ab", instant: T2, axisPx: 66 }], onDisk: { instant: T5, axisPx: 154 } },
        { path: "src/keep/b.ts", commits: [{ hash: "ba", instant: T3, axisPx: 88 }], onDisk: { instant: T3, axisPx: 110 } },
        { path: "src/keep/deep/d.ts", commits: [{ hash: "da", instant: T1, axisPx: 44 }], onDisk: { instant: T6, axisPx: 176 } },
        { path: "src/drop/c.ts", commits: [{ hash: "ca", instant: EARLY, axisPx: 0 }], onDisk: { instant: T4, axisPx: 132 } },
    ],
    gitOrphans: [{ path: "src/drop/gone.ts", instant: T7, axisPx: 198 }],
    diskOrphans: [{ path: "src/keep/extra.ts", instant: T2, axisPx: 66 }],
    // The filter RE-MEASURES eventCount rather than carrying it over, so these expectations drop with the records they counted.
    ruler: [EARLY, T0, T1, T2, T3, T4, T5, T6, T7].map((instant, index) => ({
        instant,
        axisPx: [0, 22, 44, 66, 88, 132, 154, 176, 198][index]!,
        eventCount: [1, 1, 1, 2, 2, 1, 1, 1, 1][index]!,
    })),
};

function findPair(view: WireLayer1View, path: string) {
    const pair = view.pairs.find((candidate) => candidate.path === path);
    assert.ok(pair !== undefined, `no pair for ${path}`);
    return pair;
}

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
    // The ruler is recomputed over the filtered set, so an instant no surviving record sits at must leave it entirely.
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
    const restored = filterLayer1ViewByTargets(FULL_VIEW, []);
    // every record comes back at the offsets the fixture arrived with.
    assert.deepEqual(restored, FULL_VIEW);
});

test("test_the_relayout_does_not_mutate_the_view_it_is_given", () => {
    // Task 253: the page re-filters from a cached payload, so a mutating re-layout corrupts the second click.
    const originalAxisPx = FULL_VIEW.pairs[0]!.commits[0]!.axisPx;
    relayOutLayer1View(filterLayer1ViewByTargets(FULL_VIEW, KEEP_TARGETS));
    // the source view still holds it.
    assert.equal(FULL_VIEW.pairs[0]!.commits[0]!.axisPx, originalAxisPx);
});

test("test_two_pickers_intersect_and_an_empty_one_does_not_filter", async () => {
    // Scenario (task 292): the File Nav's folders and the JSONLs pane are two independent filters
    // over one file list, and the mockup's rule is `inSelection && touchedBySelection`. An EMPTY
    // list means that picker is not filtering — reading it as "select nothing" would blank the
    // stage the moment either picker was left alone.
    // Imported here rather than at the top: layer1-page.ts boots at module scope, so a top-level
    // import would wire the whole page for a test about one pure function.
    setupLayer1Dom();
    const { intersectFilterTargets } = await import("../webapp/layer1-page.ts");
    // Steps: one picker idle, the other holding a selection.
    assert.deepEqual(intersectFilterTargets([], ["a.ts", "b.ts"]), ["a.ts", "b.ts"]);
    assert.deepEqual(intersectFilterTargets(["a.ts"], []), ["a.ts"]);
    // both holding one: only what they agree on survives.
    assert.deepEqual(intersectFilterTargets(["a.ts", "b.ts"], ["b.ts", "c.ts"]), ["b.ts"]);
    // and no overlap draws nothing, which is the honest answer rather than either picker's list.
    assert.deepEqual(intersectFilterTargets(["a.ts"], ["c.ts"]), []);
});

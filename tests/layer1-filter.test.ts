// Task 253: a folder filter must show only the selected folder's files AND recompute the ruler over
// them, so the canvas shrinks to the selected files' own timestamp range instead of keeping the
// full-project offsets.
//
// The expected pixel values below are written out by hand from the axis's documented rules rather
// than produced by calling layOutNodeLadders here — a test that recomputes with the code under test
// would pass no matter what that code did. The rules (webapp/layer1-ruler-axis.ts): a gap is
// 2.5 px/hour, clamped into [16, 120], then raised to the EARLIER instant's stacked-row demand of
// rows x 22 px. Every gap in this fixture is one or two hours, i.e. 2.5-5 px linear, so the 16 px
// floor takes over and the 22 px content floor then outranks it — which makes every gap 22 px, or
// 44 px leaving an instant where one pair stacks two nodes. That predictability is why the fixture
// uses whole-hour instants.

import { test } from "node:test";
import assert from "node:assert/strict";
import { filterLayer1ViewByTargets, relayOutLayer1View } from "../webapp/layer1-filter.ts";
import { RULER_NODE_ROW_PIXELS } from "../webapp/layer1-ruler-axis.ts";
import type { WireLayer1View } from "../webapp/layer1-wire.ts";

// Full ISO-8601 UTC, because the re-layout hydrates these to Date and writes them back with
// toISOString() — any other spelling would come back changed and the deep-equal test would fail for
// a reason that has nothing to do with filtering.
const EARLY = "2026-07-01T08:00:00.000Z";
const T0 = "2026-07-01T10:00:00.000Z";
const T1 = "2026-07-01T11:00:00.000Z";
const T2 = "2026-07-01T12:00:00.000Z";
const T3 = "2026-07-01T13:00:00.000Z";
const T4 = "2026-07-01T14:00:00.000Z";
const T5 = "2026-07-01T15:00:00.000Z";
const T6 = "2026-07-01T16:00:00.000Z";
const T7 = "2026-07-01T17:00:00.000Z";

// Two folders under one shared `src/` prefix. `src/drop/` deliberately owns BOTH the earliest
// instant (c.ts's first commit) and the latest (gone.ts), so dropping it has to move the ruler's
// start AND its end — a filter that reused the server's offsets would fail on both counts.
// `src/keep/b.ts` commits and lands on disk at the same instant, which is the case that needs two
// stacked rows at one tick.
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
    // eventCount is task 275's per-instant node tally across every bubble. T2 and T3 each carry two
    // (T2 is a.ts's second commit plus the extra.ts disk orphan; T3 is b.ts committing and landing
    // on disk in the same moment), and every other instant is drawn by exactly one node. The filter
    // RE-MEASURES these rather than carrying them over, so the expectations below drop with the
    // records they counted.
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
    // Scenario (task 253): a folder selection filters all three record kinds, not just the pairs.
    // Steps:
    // filter the view to the four targets under src/keep/.
    const filtered = filterLayer1ViewByTargets(FULL_VIEW, KEEP_TARGETS);
    // the src/drop/ pair is gone and the src/keep/ pairs remain.
    assert.deepEqual(filtered.pairs.map((pair) => pair.path), ["src/keep/a.ts", "src/keep/b.ts", "src/keep/deep/d.ts"]);
    // the git orphan, which lives under src/drop/, is gone.
    assert.deepEqual(filtered.gitOrphans, []);
    // the disk orphan, which lives under src/keep/, survives.
    assert.deepEqual(filtered.diskOrphans.map((orphan) => orphan.path), ["src/keep/extra.ts"]);
});

test("test_filtering_keeps_files_in_nested_subfolders", () => {
    // Scenario (task 253): "that folder's files" includes every subfolder below it.
    // Steps:
    // filter to src/keep/, whose target list includes the file one directory deeper.
    const filtered = filterLayer1ViewByTargets(FULL_VIEW, KEEP_TARGETS);
    // the nested file is still there.
    assert.ok(filtered.pairs.some((pair) => pair.path === "src/keep/deep/d.ts"));
});

test("test_filtering_matches_a_target_exactly_and_not_by_prefix", () => {
    // Scenario (task 253): the caller resolves a folder to its leaf paths, so this function compares
    // whole paths. A startsWith test here would let `src/keep/a.ts` also drag in `src/keep/a.ts.bak`
    // — the substring class of bug task 278 removed from the find-file box.
    // Steps:
    // add a pair whose path merely EXTENDS a selected target.
    const withLookalike: WireLayer1View = {
        ...FULL_VIEW,
        pairs: [...FULL_VIEW.pairs, { path: "src/keep/a.ts.bak", commits: [{ hash: "za", instant: T1, axisPx: 44 }], onDisk: { instant: T1, axisPx: 44 } }],
    };
    // filter on the original targets, which do NOT name it.
    const filtered = filterLayer1ViewByTargets(withLookalike, KEEP_TARGETS);
    // it is excluded.
    assert.ok(!filtered.pairs.some((pair) => pair.path === "src/keep/a.ts.bak"));
});

test("test_the_filtered_ruler_holds_only_the_surviving_instants", () => {
    // Scenario (task 253): the ruler is recomputed over the filtered set, so an instant no surviving
    // record sits at must leave it entirely.
    // Steps:
    // filter to src/keep/.
    const filtered = filterLayer1ViewByTargets(FULL_VIEW, KEEP_TARGETS);
    // exactly the six instants the survivors occupy remain, ascending.
    assert.deepEqual(filtered.ruler.map((tick) => tick.instant), [T0, T1, T2, T3, T5, T6]);
});

test("test_the_filtered_ruler_starts_at_zero", () => {
    // Scenario (task 253): the earliest instant in the FULL view belongs to a dropped file, so the
    // filtered view's own earliest instant must become the new origin. This is the assertion that
    // fails if the code reuses the offsets the endpoint shipped.
    // Steps:
    // filter to src/keep/, which excludes the file owning the earliest instant.
    const filtered = filterLayer1ViewByTargets(FULL_VIEW, KEEP_TARGETS);
    // the first surviving tick sits at the origin, where the dropped one used to.
    assert.equal(filtered.ruler[0]?.axisPx, 0);
    assert.equal(filtered.ruler[0]?.instant, T0);
});

test("test_the_filtered_ruler_is_shorter_than_the_full_ruler", () => {
    // Scenario (task 253): the timeline's height must resize to the selected files' range. Height is
    // the last tick's offset, so a filter that removes the latest instant must shorten it.
    // Steps:
    // filter to src/keep/, which excludes the file owning the latest instant.
    const filtered = filterLayer1ViewByTargets(FULL_VIEW, KEEP_TARGETS);
    // the filtered ruler ends earlier than the full one.
    assert.equal(filtered.ruler.at(-1)?.axisPx, 132);
    assert.equal(FULL_VIEW.ruler.at(-1)?.axisPx, 198);
});

test("test_a_filtered_pair_keeps_its_instants_and_takes_new_offsets", () => {
    // Scenario (task 253): the re-layout re-places nodes; it must never re-time them.
    // Steps:
    // filter to src/keep/.
    const filtered = filterLayer1ViewByTargets(FULL_VIEW, KEEP_TARGETS);
    const pair = findPair(filtered, "src/keep/a.ts");
    // its commit and on-disk instants are untouched.
    assert.deepEqual(pair.commits.map((commit) => commit.instant), [T0, T2]);
    assert.equal(pair.onDisk.instant, T5);
    // its offsets are the ones the shortened ruler gives, not the ones it arrived with.
    assert.deepEqual(pair.commits.map((commit) => commit.axisPx), [0, 44]);
    assert.equal(pair.onDisk.axisPx, 110);
});

test("test_two_nodes_of_one_pair_at_the_same_instant_still_take_different_rows", () => {
    // Scenario (task 253): the layout returns offsets parallel to the ladders handed in, by outer
    // AND inner index. A pair whose commit and mtime share a moment is exactly the case a lookup
    // keyed by instant would collapse onto one row, which is the overprinting task 251 removed.
    // Steps:
    // filter to src/keep/, which retains the pair that commits and lands on disk at one instant.
    const filtered = filterLayer1ViewByTargets(FULL_VIEW, KEEP_TARGETS);
    const pair = findPair(filtered, "src/keep/b.ts");
    // both nodes report the same instant.
    assert.equal(pair.commits[0]?.instant, pair.onDisk.instant);
    // and are drawn one node row apart.
    assert.equal(pair.onDisk.axisPx - pair.commits[0]!.axisPx, RULER_NODE_ROW_PIXELS);
});

test("test_an_empty_selection_restores_every_record_at_its_original_offset", () => {
    // Scenario (task 253): re-clicking the selected folder clears the filter, which arrives here as
    // an empty target list. It goes through the SAME re-layout rather than short-circuiting, so this
    // also pins that the page's layout of the unfiltered set lands exactly where the endpoint's did
    // — if the two ever disagree, a filtered view would not line up with the view it came from.
    // Steps:
    // filter with nothing selected.
    const restored = filterLayer1ViewByTargets(FULL_VIEW, []);
    // every record comes back at the offsets the fixture arrived with.
    assert.deepEqual(restored, FULL_VIEW);
});

test("test_the_relayout_does_not_mutate_the_view_it_is_given", () => {
    // Scenario (task 253): the page keeps the unfiltered payload in a closure and re-filters from it
    // on every folder click, so a mutating re-layout would corrupt the second click.
    // Steps:
    // remember an offset that the filter is about to change, then filter.
    const originalAxisPx = FULL_VIEW.pairs[0]!.commits[0]!.axisPx;
    relayOutLayer1View(filterLayer1ViewByTargets(FULL_VIEW, KEEP_TARGETS));
    // the source view still holds it.
    assert.equal(FULL_VIEW.pairs[0]!.commits[0]!.axisPx, originalAxisPx);
});

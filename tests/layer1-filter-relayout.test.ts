// Expected pixels are hand-derived, never from computeNodeLadderLayout — that would pass whatever it did.

import { test } from "node:test";
import assert from "node:assert/strict";
import { filterLayer1ViewByTargets, computeRelaidLayer1View } from "../webapp/layer1-filter.ts";
import { WireRewindKind } from "../webapp/layer1-wire-branches.ts";
import type { WireLayer1View } from "../webapp/layer1-wire.ts";
import { EARLY, FULL_VIEW, KEEP_TARGETS, T0, T1, T2, T3, T4, T5, T6, T7, findPair } from "./layer1-filter-test-helpers.ts";

test("test_the_relayout_places_edits_after_snapshots_at_their_own_ruler_offsets", () => {
    // Hand-derived: one hour apart, and FULL_VIEW above shows each such step is one 22 px node row.
    const edit = { instant: T3, axisPx: 0, kind: "edit", changeId: "toolu_1", confidence: "verified", sessionId: "s", sessionFile: "f.jsonl" };
    const snapshot = { instant: T2, axisPx: 0, version: 1, sessionId: "s", sessionFile: "f.jsonl" };
    const view: WireLayer1View = {
        pairs: [{ path: "src/keep/a.ts", commits: [{ hash: "aa", instant: T0, axisPx: 0 }], onDisk: { instant: T1, axisPx: 0 },
            snapshots: [snapshot], edits: [edit as never] }],
        gitOrphans: [], diskOrphans: [], ruler: [],
    };
    const pair = findPair(computeRelaidLayer1View(view), "src/keep/a.ts");
    assert.deepEqual(pair.snapshots!.map((node) => node.axisPx), [44]);
    assert.deepEqual(pair.edits!.map((node) => node.axisPx), [66]);
    assert.equal(pair.edits![0]!.changeId, "toolu_1");
});

// test("test_the_relayout_places_branch_nodes_on_ruler_ticks_and_leaves_trunk_offsets_alone", () => {
//     // Task 379: hand-derived, one hour is one 22 px row; the fork and rejoin reuse commit instants, so they add no row.
//     const branchNode = (instant: string) => ({ instant, axisPx: 0, label: "b" });
//     const view: WireLayer1View = {
//         pairs: [{ path: "src/keep/a.ts", commits: [{ hash: "aa", instant: T0, axisPx: 0 }, { hash: "ab", instant: T1, axisPx: 0 }], onDisk: { instant: T2, axisPx: 0 },
//             branches: [
//                 { rewindKind: WireRewindKind.conversation, forkFrom: T0, rejoinAt: T1, nodes: [branchNode(T3), branchNode(T4)] },
//                 { rewindKind: WireRewindKind.code, forkFrom: T1, nodes: [branchNode(T5)] },
//             ] }],
//         gitOrphans: [], diskOrphans: [], ruler: [],
//     };
//     const relaid = computeRelaidLayer1View(view);
//     const pair = findPair(relaid, "src/keep/a.ts");
//     assert.deepEqual(pair.commits.map((node) => node.axisPx), [0, 22]);
//     assert.equal(pair.onDisk.axisPx, 44);
//     assert.deepEqual(pair.branches!.map((branch) => branch.nodes.map((node) => node.axisPx)), [[66, 88], [110]]);
//     assert.deepEqual(relaid.ruler.map((tick) => tick.axisPx), [0, 22, 44, 66, 88, 110]);
// });

test("test_the_relayout_gives_a_fork_its_own_slot_and_a_rejoin_its_trunk_nodes_offset", () => {
    // Task 357: 22 px per hour; fork owns a row, rejoin on trunk adds none, else one.
    const branchNode = (instant: string) => ({ instant, axisPx: 0, changeId: "toolu_1", label: "edit" });
    const at = (instant: string) => ({ instant, axisPx: 0 });
    const view: WireLayer1View = {
        pairs: [{ path: "src/keep/a.ts", commits: [{ hash: "aa", instant: T0, axisPx: 0 }, { hash: "ab", instant: T1, axisPx: 0 }], onDisk: { instant: T2, axisPx: 0 },
            branches: [
                { rewindKind: WireRewindKind.conversation, forkAt: at(T3), rejoinAt: at(T1), nodes: [branchNode(T4), branchNode(T5)] },
                { rewindKind: WireRewindKind.conversation, forkAt: at(T6), keptToEnd: true, nodes: [branchNode(T7)] },
                { rewindKind: WireRewindKind.conversation, forkAt: at(EARLY), rejoinAt: at("2026-07-01T18:00:00.000Z"), nodes: [] },
            ] }],
        gitOrphans: [], diskOrphans: [], ruler: [],
    };
    const relaid = computeRelaidLayer1View(view);
    const pair = findPair(relaid, "src/keep/a.ts");
    assert.deepEqual(pair.commits.map((node) => node.axisPx), [22, 44]);
    assert.equal(pair.onDisk.axisPx, 66);
    const [first, second, third] = pair.branches!;
    assert.equal(first!.forkAt.axisPx, 88);
    assert.equal(first!.rejoinAt!.axisPx, 44);
    assert.deepEqual(first!.nodes.map((node) => node.axisPx), [110, 132]);
    assert.equal(second!.forkAt.axisPx, 154);
    assert.equal("rejoinAt" in second!, false);
    assert.deepEqual(second!.nodes.map((node) => node.axisPx), [176]);
    assert.equal(third!.forkAt.axisPx, 0);
    assert.equal(third!.rejoinAt!.axisPx, 198);
    assert.deepEqual(relaid.ruler.map((tick) => tick.axisPx), [0, 22, 44, 66, 88, 110, 132, 154, 176, 198]);
});

test("test_the_relayout_places_script_runs_after_snapshots_and_edits_at_their_own_ruler_offsets", () => {
    // Hand-derived: one hour apart is one 22 px node row, as above.
    const edit = { instant: T3, axisPx: 0, kind: "edit", changeId: "toolu_1", confidence: "verified", sessionId: "s", sessionFile: "f.jsonl" };
    const snapshot = { instant: T2, axisPx: 0, version: 1, sessionId: "s", sessionFile: "f.jsonl" };
    const scriptRun = { instant: T4, axisPx: 0, toolUseId: "toolu_2", executorKind: "bash", code: "ls", sessionId: "s", sessionFile: "f.jsonl" };
    const view: WireLayer1View = {
        pairs: [{ path: "src/keep/a.ts", commits: [{ hash: "aa", instant: T0, axisPx: 0 }], onDisk: { instant: T1, axisPx: 0 },
            snapshots: [snapshot], edits: [edit as never], scriptRuns: [scriptRun as never] }],
        gitOrphans: [], diskOrphans: [], ruler: [],
    };
    const pair = findPair(computeRelaidLayer1View(view), "src/keep/a.ts");
    assert.deepEqual(pair.edits!.map((node) => node.axisPx), [66]);
    assert.deepEqual(pair.scriptRuns!.map((node) => node.axisPx), [88]);
    assert.equal(pair.scriptRuns![0]!.toolUseId, "toolu_2");
});

test("test_a_pair_without_script_runs_gets_no_script_runs_key_from_the_relayout", () => {
    const pair = findPair(computeRelaidLayer1View(FULL_VIEW), "src/keep/a.ts");
    assert.ok(!("scriptRuns" in pair));
});

test("test_a_pair_without_edits_gets_no_edits_key_from_the_relayout", () => {
    const pair = findPair(computeRelaidLayer1View(FULL_VIEW), "src/keep/a.ts");
    assert.ok(!("edits" in pair));
});

test("test_the_relayout_does_not_mutate_the_view_it_is_given", () => {
    // Task 253: the page re-filters from a cached payload, so a mutating re-layout corrupts the second click.
    const originalAxisPx = FULL_VIEW.pairs[0]!.commits[0]!.axisPx;
    computeRelaidLayer1View(filterLayer1ViewByTargets(FULL_VIEW, KEEP_TARGETS));
    // the source view still holds it.
    assert.equal(FULL_VIEW.pairs[0]!.commits[0]!.axisPx, originalAxisPx);
});

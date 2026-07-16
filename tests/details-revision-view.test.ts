// Pure view-model tests for the Revision View's focus + range helpers (webapp/views/details.ts,
// item 84): which card an incoming focus selects, whether a toggled run of cards names ONE
// range, and which timeline nodes own that run. Split from details-viewmodels.test.ts, which is
// at the project's 250-line cap.
// Fixtures are wire-shaped literals (what the browser sees after fetch + JSON.parse); kind
// values go through the vocabulary enum members, never bare literals.

import { test } from "node:test";
import assert from "node:assert/strict";
import {
    RevisionViewMode,
    buildRevisionCards,
    checkCardRunIsContiguous,
    computeFileRouteFocus,
    computeFocusedCardIndex,
    computeOwningNodeIndexes,
} from "../webapp/views/details-model.ts";
import { AGENT_TURN_NODE_KIND, type FileChange, type TimelineNode } from "../webapp/views/timeline-types.ts";
import { EventKind } from "../src/structures/vocabulary.ts";

// ── fixtures ────────────────────────────────────────────────────────────────────────────────

// One file's three revisions. Nothing in TWO_NODES_OWNING_REVISIONS owns toolu_third — that
// absence is what the rewound/synthetic cases assert on.
const THREE_REVISION_HISTORY = {
    target: "src/orders.py",
    revisions: [
        { kind: EventKind.write as string, changeId: "toolu_first", timestamp: "2026-07-01T10:00:00Z" },
        { kind: EventKind.edit as string, changeId: "toolu_second", timestamp: "2026-07-01T10:05:00Z" },
        { kind: EventKind.edit as string, changeId: "toolu_third", timestamp: "2026-07-01T10:10:00Z" },
    ],
};

// One file change on src/orders.py. FileChange names renamedFrom + isFirstRevision explicitly —
// they are required fields, not optional ones.
function buildOrdersChange(changeId: string, eventKind: EventKind, when: string, isFirstRevision: boolean): FileChange {
    return { path: "src/orders.py", eventKind: eventKind as string, renamedFrom: undefined, isFirstRevision, changeId, when };
}

// Two snapshot-bearing turns, each owning one of the first two revisions by changeId.
const TWO_NODES_OWNING_REVISIONS: TimelineNode[] = [
    {
        kind: AGENT_TURN_NODE_KIND,
        when: "2026-07-01T10:00:00Z",
        sessionId: "abc12345",
        text: "write orders.py",
        snapshots: [{ index: 1, when: "2026-07-01T10:00:00Z", changeIds: ["toolu_first"], changedPaths: ["src/orders.py"] }],
        fileChanges: [buildOrdersChange("toolu_first", EventKind.write, "2026-07-01T10:00:00Z", true)],
        gitOperations: [],
    },
    {
        kind: AGENT_TURN_NODE_KIND,
        when: "2026-07-01T10:05:00Z",
        sessionId: "abc12345",
        text: "edit orders.py",
        snapshots: [{ index: 2, when: "2026-07-01T10:05:00Z", changeIds: ["toolu_second"], changedPaths: ["src/orders.py"] }],
        fileChanges: [buildOrdersChange("toolu_second", EventKind.edit, "2026-07-01T10:05:00Z", false)],
        gitOperations: [],
    },
];

// A turn owning revision #1 whose snapshots array is EMPTY. Only TurnNode/SessionEndNode can
// carry fileChanges at all (CommitNode and ToolCallNode declare BOTH fileChanges?: undefined AND
// snapshots?: undefined), so an owner can never be snapshot-LESS — but it can be snapshot-EMPTY.
const ONE_SNAPSHOT_EMPTY_NODE_OWNING_A_REVISION: TimelineNode[] = [
    {
        kind: AGENT_TURN_NODE_KIND,
        when: "2026-07-01T10:00:00Z",
        sessionId: "abc12345",
        text: "write orders.py",
        snapshots: [],
        fileChanges: [buildOrdersChange("toolu_first", EventKind.write, "2026-07-01T10:00:00Z", true)],
        gitOperations: [],
    },
];

// ── which card an incoming focus selects ────────────────────────────────────────────────────

test("test_computeFocusedCardIndex_defaults_to_the_first_card_without_a_focus", () => {
    // Step 1: a three-revision card list.
    const cards = buildRevisionCards(THREE_REVISION_HISTORY);
    // Step 2: no focus means the Revision View opens where it always has — revision #1. This is
    // the Files-treeview entry, which must stay byte-identical to its pre-item-84 behavior.
    assert.equal(computeFocusedCardIndex(cards, undefined), 0);
});

test("test_computeFocusedCardIndex_finds_the_card_owning_a_changeId", () => {
    // Step 1: a three-revision card list whose second revision has a known changeId.
    const cards = buildRevisionCards(THREE_REVISION_HISTORY);
    // Step 2: focusing that changeId selects its own card, 0-based — this is what makes a
    // timeline chip land on ITS revision rather than revision #1.
    assert.equal(computeFocusedCardIndex(cards, { changeId: "toolu_second", mode: RevisionViewMode.content }), 1);
});

test("test_computeFocusedCardIndex_falls_back_to_the_first_card_for_an_unknown_changeId", () => {
    // Step 1: a three-revision card list.
    const cards = buildRevisionCards(THREE_REVISION_HISTORY);
    // Step 2: a changeId no card carries (rewound / synthetic) must not select nothing — the
    // view still has to land somewhere, so it opens on revision #1.
    assert.equal(computeFocusedCardIndex(cards, { changeId: "toolu_missing", mode: RevisionViewMode.diff }), 0);
});

// ── whether a toggled run of cards names one range ──────────────────────────────────────────

test("test_checkCardRunIsContiguous_accepts_an_adjacent_run", () => {
    // Step 1: cards #2, #3 and #4 toggled on (0-based 1, 2, 3).
    // Step 2: an adjacent run names one before→after pair, so it is a legal range.
    assert.equal(checkCardRunIsContiguous([1, 2, 3]), true);
});

test("test_checkCardRunIsContiguous_accepts_a_single_card", () => {
    // Step 1: one card toggled on.
    // Step 2: a run of one is trivially contiguous — single card and contiguous run are the
    // same mechanism at N=1 and N>1.
    assert.equal(checkCardRunIsContiguous([2]), true);
});

test("test_checkCardRunIsContiguous_accepts_a_run_toggled_out_of_order", () => {
    // Step 1: the user clicked card #4 before #2 before #3 — the selection Set preserves click
    // order, not card order.
    // Step 2: contiguity is about the cards, not the clicks: this is still one range.
    assert.equal(checkCardRunIsContiguous([3, 1, 2]), true);
});

test("test_checkCardRunIsContiguous_rejects_a_gap", () => {
    // Step 1: cards #1 and #4 toggled on, #2 and #3 left off.
    // Step 2: a gapped selection names no single range and must be refused rather than
    // silently diffing across the gap.
    assert.equal(checkCardRunIsContiguous([0, 3]), false);
});

test("test_checkCardRunIsContiguous_rejects_an_empty_selection", () => {
    // Step 1: nothing toggled on.
    // Step 2: no cards is no range.
    assert.equal(checkCardRunIsContiguous([]), false);
});

// ── which timeline nodes own a card run ─────────────────────────────────────────────────────

test("test_computeOwningNodeIndexes_maps_a_card_run_onto_its_timeline_nodes", () => {
    // Step 1: two nodes, each owning one revision by changeId.
    const cards = buildRevisionCards(THREE_REVISION_HISTORY);
    // Step 2: the run's cards resolve to the node indexes whose fileChanges carry their
    // changeIds — the same resolution "Jump to timeline step" already uses (details.ts:443).
    assert.deepEqual(computeOwningNodeIndexes(cards, TWO_NODES_OWNING_REVISIONS, [0, 1]), [0, 1]);
});

test("test_computeOwningNodeIndexes_skips_cards_no_node_owns", () => {
    // Step 1: card #3's changeId appears in no node's fileChanges (rewound / synthetic).
    const cards = buildRevisionCards(THREE_REVISION_HISTORY);
    // Step 2: it contributes no node index rather than the -1 that would poison the step range.
    assert.deepEqual(computeOwningNodeIndexes(cards, TWO_NODES_OWNING_REVISIONS, [2]), []);
});

test("test_computeOwningNodeIndexes_skips_an_owner_whose_snapshots_are_empty", () => {
    // Step 1: a node that owns the card's changeId but whose snapshots array is empty.
    const cards = buildRevisionCards(THREE_REVISION_HISTORY);
    // Step 2: it is dropped. computeRangeSummary maps snapshots to step indexes and Math.min()s
    // them (timeline.ts:416-421), so an empty-snapshot owner would yield fromStepIndex=Infinity
    // and send a garbage /api/range-patch request.
    assert.deepEqual(computeOwningNodeIndexes(cards, ONE_SNAPSHOT_EMPTY_NODE_OWNING_A_REVISION, [0]), []);
});


// ── the /file/ route's focus (task 93: the retired File History view's anchor semantics) ────

test("test_computeFileRouteFocus_maps_anchor_number_to_that_revisions_changeId_in_content_mode", () => {
    // Step 1: the /file/src/orders.py/rev/2 route names the file's 2nd revision (1-based).
    const focus = computeFileRouteFocus([THREE_REVISION_HISTORY], "src/orders.py", "2");
    // Step 2: the Revision View focuses that revision's changeId, in content mode — the
    // retired File History view auto-expanded the anchored revision's content pane.
    assert.deepEqual(focus, { changeId: "toolu_second", mode: RevisionViewMode.content });
});

test("test_computeFileRouteFocus_returns_undefined_without_an_anchor", () => {
    // Step 1: the bare /file/src/orders.py route carries no /rev/<n> anchor.
    // Step 2: no focus — renderDetailsFileMode defaults to card #1 in diff mode.
    assert.equal(computeFileRouteFocus([THREE_REVISION_HISTORY], "src/orders.py", undefined), undefined);
});

test("test_computeFileRouteFocus_returns_undefined_for_an_unknown_target", () => {
    // Step 1: the routed file is absent from the document's filesTouched.
    // Step 2: no focus — the view itself renders its "No revisions" empty state.
    assert.equal(computeFileRouteFocus([THREE_REVISION_HISTORY], "src/missing.py", "1"), undefined);
});

test("test_computeFileRouteFocus_returns_undefined_for_an_out_of_range_anchor", () => {
    // Step 1: /rev/9 on a 3-revision history names no revision.
    // Step 2: no focus rather than a fabricated one.
    assert.equal(computeFileRouteFocus([THREE_REVISION_HISTORY], "src/orders.py", "9"), undefined);
});

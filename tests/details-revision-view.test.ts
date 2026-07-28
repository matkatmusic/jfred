// Pure view-model tests for the Revision View's focus + range helpers (item 84). Fixtures are
// wire-shaped literals — what the browser sees after fetch + JSON.parse.

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

// Nothing in TWO_NODES_OWNING_REVISIONS owns toolu_third — the rewound/synthetic cases need that gap.
const THREE_REVISION_HISTORY = {
    target: "src/orders.py",
    revisions: [
        { kind: EventKind.write as string, changeId: "toolu_first", timestamp: "2026-07-01T10:00:00Z" },
        { kind: EventKind.edit as string, changeId: "toolu_second", timestamp: "2026-07-01T10:05:00Z" },
        { kind: EventKind.edit as string, changeId: "toolu_third", timestamp: "2026-07-01T10:10:00Z" },
    ],
};

// renamedFrom and isFirstRevision are named explicitly because FileChange requires them.
function buildOrdersChange(changeId: string, eventKind: EventKind, when: string, isFirstRevision: boolean): FileChange {
    return { path: "src/orders.py", displayPath: "src/orders.py", eventKind: eventKind as string, renamedFrom: undefined, isFirstRevision, changeId, when };
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

// An owner can never be snapshot-LESS (the types forbid it) but it can be snapshot-EMPTY.
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

test("test_computeFocusedCardIndex_defaults_to_the_first_card_without_a_focus", () => {
    const cards = buildRevisionCards(THREE_REVISION_HISTORY);
    // The Files-treeview entry must stay byte-identical to its pre-item-84 behavior.
    assert.equal(computeFocusedCardIndex(cards, undefined), 0);
});

test("test_computeFocusedCardIndex_finds_the_card_owning_a_changeId", () => {
    const cards = buildRevisionCards(THREE_REVISION_HISTORY);
    // This is what makes a timeline chip land on ITS revision rather than revision #1.
    assert.equal(computeFocusedCardIndex(cards, { changeId: "toolu_second", mode: RevisionViewMode.content }), 1);
});

test("test_computeFocusedCardIndex_falls_back_to_the_first_card_for_an_unknown_changeId", () => {
    const cards = buildRevisionCards(THREE_REVISION_HISTORY);
    // A rewound/synthetic changeId must still land somewhere, so it opens on revision #1.
    assert.equal(computeFocusedCardIndex(cards, { changeId: "toolu_missing", mode: RevisionViewMode.diff }), 0);
});

test("test_checkCardRunIsContiguous_accepts_an_adjacent_run", () => {
    // An adjacent run names one before→after pair, so it is a legal range.
    assert.equal(checkCardRunIsContiguous([1, 2, 3]), true);
});

test("test_checkCardRunIsContiguous_accepts_a_single_card", () => {
    // Single card and contiguous run are the same mechanism at N=1 and N>1.
    assert.equal(checkCardRunIsContiguous([2]), true);
});

test("test_checkCardRunIsContiguous_accepts_a_run_toggled_out_of_order", () => {
    // The selection Set preserves click order, but contiguity is about the cards.
    assert.equal(checkCardRunIsContiguous([3, 1, 2]), true);
});

test("test_checkCardRunIsContiguous_rejects_a_gap", () => {
    // A gapped selection must be refused rather than silently diffing across the gap.
    assert.equal(checkCardRunIsContiguous([0, 3]), false);
});

test("test_checkCardRunIsContiguous_rejects_an_empty_selection", () => {
    assert.equal(checkCardRunIsContiguous([]), false);
});

test("test_computeOwningNodeIndexes_maps_a_card_run_onto_its_timeline_nodes", () => {
    const cards = buildRevisionCards(THREE_REVISION_HISTORY);
    // Same changeId resolution "Jump to timeline step" already uses.
    assert.deepEqual(computeOwningNodeIndexes(cards, TWO_NODES_OWNING_REVISIONS, [0, 1]), [0, 1]);
});

test("test_computeOwningNodeIndexes_skips_cards_no_node_owns", () => {
    const cards = buildRevisionCards(THREE_REVISION_HISTORY);
    // An unowned card contributes no index rather than the -1 that would poison the step range.
    assert.deepEqual(computeOwningNodeIndexes(cards, TWO_NODES_OWNING_REVISIONS, [2]), []);
});

test("test_computeOwningNodeIndexes_skips_an_owner_whose_snapshots_are_empty", () => {
    const cards = buildRevisionCards(THREE_REVISION_HISTORY);
    // computeRangeSummary Math.min()s snapshot step indexes, so an empty-snapshot owner would
    // yield fromStepIndex=Infinity and send a garbage /api/range-patch request.
    assert.deepEqual(computeOwningNodeIndexes(cards, ONE_SNAPSHOT_EMPTY_NODE_OWNING_A_REVISION, [0]), []);
});


// Task 93: the retired File History view's anchor semantics, which are 1-based.
test("test_computeFileRouteFocus_maps_anchor_number_to_that_revisions_changeId_in_content_mode", () => {
    const focus = computeFileRouteFocus([THREE_REVISION_HISTORY], "src/orders.py", "2");
    // Content mode, because the retired view auto-expanded the anchored revision's content pane.
    assert.deepEqual(focus, { changeId: "toolu_second", mode: RevisionViewMode.content });
});

test("test_computeFileRouteFocus_returns_undefined_without_an_anchor", () => {
    // No focus lets renderDetailsFileMode default to card #1 in diff mode.
    assert.equal(computeFileRouteFocus([THREE_REVISION_HISTORY], "src/orders.py", undefined), undefined);
});

test("test_computeFileRouteFocus_returns_undefined_for_an_unknown_target", () => {
    // No focus lets the view render its own "No revisions" empty state.
    assert.equal(computeFileRouteFocus([THREE_REVISION_HISTORY], "src/missing.py", "1"), undefined);
});

test("test_computeFileRouteFocus_returns_undefined_for_an_out_of_range_anchor", () => {
    // An out-of-range anchor yields no focus rather than a fabricated one.
    assert.equal(computeFileRouteFocus([THREE_REVISION_HISTORY], "src/orders.py", "9"), undefined);
});

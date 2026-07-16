// Details pane view-model half (split from details.ts, task 92): the DOM-free, tested types
// and pure functions the pane's modes share, plus the localStorage-backed diff-mode /
// full-contents choices (tests/details-viewmodels.test.ts, tests/details-revision-view.test.ts).

import {
    DIFF_MODE_STORAGE_KEY,
    DiffDisplayMode,
    resolveInitialDiffDisplayMode,
} from "./diff-vs-base-model.ts";
import {
    COMMIT_NODE_KIND,
    type TimelineNode,
    type WireTimelineDocument,
} from "./timeline-types.ts";
import { computeAnchoredRevisionIndex } from "./file-history-model.ts";

// ── types (derived from timeline's wire/view-model types — one canonical home, no copies) ──

// One reconstructed file history off the wire document (target + its revision list).
export type WireFileHistory = WireTimelineDocument["filesTouched"][number];

// Everything the render modes need from the owning timeline view: the loaded document, the
// node list, and the callbacks the timeline wires (its inspector openers, row selector, and
// range-patch fetcher).
export type DetailsContext = {
    project: string;
    document: WireTimelineDocument;
    nodes: TimelineNode[];
    openNodeInspector: (nodeIndex: number) => void;
    selectTimelineRow: (nodeIndex: number) => void;
    // item 84: open a revision's causing JSONL record in the right column (the rev-card { }
    // action). Only the timeline can resolve changeId → (jsonl, line), so it passes this in.
    openRecordForChangeId: (changeId: string) => void;
    // item 84: the multi-card range diff fetches the server's step-range patch. fetchRangePatch
    // is closure-local to the timeline (it owns the consent params and its cache), so it too
    // passes in rather than being rebuilt here.
    fetchRangePatch: (fromStepIndex: number, toStepIndex: number) => Promise<string>;
};

// One File-Revisions card: 1-based number, the revision kind as its op badge label, and the
// changeId the card's diff/jump actions resolve through.
export type RevisionCard = { revisionNumber: number; opLabel: string; timestamp: string; changeId: string };

// item 84: which right-column render the Revision View opens with. Local to the view layer —
// this is no wire vocabulary, so it lives beside its view (the same precedent DiffDisplayMode
// sets in views/diff-vs-base.ts), not in src/structures/vocabulary.ts.
export enum RevisionViewMode {
    diff = "diff",        // the revision's diff vs the previous revision — the card's own default
    content = "content",  // the revision's full file content
    record = "record",    // the JSONL record that caused the revision
}

// item 84: which revision the Revision View opens on, and how. Absent → revision #1 in diff
// mode, which is the Files-treeview entry's unchanged behavior.
export type RevisionFocus = { changeId: string; mode: RevisionViewMode };

// The two diff-toggle labels (#dm-columns / #dm-inline).
export type DiffToggleLabel = "columns" | "inline";

// task 93: the /file/<path>/rev/<n> route carries a 1-based revision number; the Revision View
// focuses by changeId. Content mode mirrors the retired File History view's anchored
// auto-expand. No anchor / unknown target / out-of-range number → no focus (card #1, diff).
export function computeFileRouteFocus(
    filesTouched: WireFileHistory[], target: string, anchorRev: string | undefined,
): RevisionFocus | undefined {
    const fileHistory = filesTouched.find((entry) => entry.target === target);
    if (fileHistory === undefined) {
        return undefined;
    }
    const revisionIndex = computeAnchoredRevisionIndex(anchorRev, fileHistory.revisions.length);
    if (revisionIndex === undefined) {
        return undefined;
    }
    return { changeId: fileHistory.revisions[revisionIndex]!.changeId, mode: RevisionViewMode.content };
}

// ── view-model half (DOM-free, tested) ─────────────────────────────────────────────────────

// A node kind's readable label: the wire kind with its dashes spaced ("agent-turn" → "agent turn").
function humanizeNodeKind(kind: string): string {
    return kind.replaceAll("-", " ");
}

// The pane header for a selected row: commits lead with their hash + message; every other node
// names its 1-based step position and kind. Timestamps use the timeline's row format.
export function computeDetailsHeaderText(node: TimelineNode, position: { index: number; total: number }): string {
    const timestamp = new Date(node.when).toLocaleString();
    if (node.kind === COMMIT_NODE_KIND) {
        // no hash → no hash segment; a placeholder dash reads broken (user report, s58)
        const hashSegment = node.resultHash === undefined ? "" : ` ${node.resultHash}`;
        return `git commit${hashSegment} — ${node.detail ?? "git commit"} — ${timestamp}`;
    }
    return `Step ${position.index + 1} of ${position.total} — ${humanizeNodeKind(node.kind)} — ${timestamp}`;
}

// A file history's revision cards, 1-based, each labeled with its wire event kind.
export function buildRevisionCards(history: WireFileHistory): RevisionCard[] {
    return history.revisions.map((revision, index) => ({
        revisionNumber: index + 1,
        opLabel: revision.kind,
        timestamp: revision.timestamp,
        changeId: revision.changeId,
    }));
}

// item 84: the 0-based card a focus selects. An absent focus, or a changeId no card carries
// (rewound / synthetic revisions), opens revision #1 — the view must always land somewhere.
export function computeFocusedCardIndex(cards: RevisionCard[], focus: RevisionFocus | undefined): number {
    if (focus === undefined) {
        return 0;
    }
    const focusedIndex = cards.findIndex((card) => card.changeId === focus.changeId);
    if (focusedIndex < 0) {
        return 0;
    }
    return focusedIndex;
}

// item 84: whether a set of toggled cards names ONE range — at least one card, and no gap
// between the lowest and highest. A gapped selection ("#1 and #4") names no single before→after
// pair, so the range mode refuses it rather than silently diffing across the gap. Click order
// does not matter; card order does.
export function checkCardRunIsContiguous(selectedIndexes: number[]): boolean {
    if (selectedIndexes.length === 0) {
        return false;
    }
    const sorted = [...selectedIndexes].sort((left, right) => left - right);
    const span = sorted[sorted.length - 1]! - sorted[0]!;
    return span === sorted.length - 1;
}

// item 84: the timeline node indexes owning a run of cards — each card's changeId names the node
// whose fileChanges carry it, the same resolution the "Jump to timeline step" action uses. Two
// kinds of card contribute nothing: one no node owns (rewound / synthetic revisions), and one
// whose owner carries an EMPTY snapshots array — computeRangeSummary maps snapshots to step
// indexes and Math.min()s them (timeline.ts:416-421), so an empty-snapshot owner would yield
// fromStepIndex = Infinity and send a garbage /api/range-patch request. (A snapshot-LESS owner
// is unreachable: only TurnNode/SessionEndNode carry fileChanges, and both require snapshots.)
export function computeOwningNodeIndexes(cards: RevisionCard[], nodes: TimelineNode[], selectedIndexes: number[]): number[] {
    const ownerIndexes: number[] = [];
    for (const cardIndex of selectedIndexes) {
        const card = cards[cardIndex];
        if (card === undefined) {
            continue;
        }
        const ownerIndex = nodes.findIndex(
            (candidate) => (candidate.fileChanges ?? []).some((change) => change.changeId === card.changeId),
        );
        if (ownerIndex < 0) {
            continue;
        }
        if ((nodes[ownerIndex]!.snapshots ?? []).length === 0) {
            continue;
        }
        ownerIndexes.push(ownerIndex);
    }
    return ownerIndexes;
}

// The stored diff-vs-base vocabulary mapped onto the fork toggle: "split" (and the absent /
// garbage default) reads Columns, "inline" reads Inline — one storage key, two vocabularies.
export function mapStoredDiffModeToToggle(stored: string | undefined): DiffToggleLabel {
    if (resolveInitialDiffDisplayMode(stored) === DiffDisplayMode.split) {
        return "columns";
    }
    return "inline";
}

// ── persisted view choices ──────────────────────────────────────────────────────────────────

// localStorage is browser-only; the node test runner imports this module with no DOM (same
// typeof-window guard rationale as diff-vs-base, item 36a).
export function readStoredDiffMode(): string | undefined {
    if (typeof window === "undefined") {
        return undefined;
    }
    return localStorage.getItem(DIFF_MODE_STORAGE_KEY) ?? undefined;
}

export function writeStoredDiffMode(label: DiffToggleLabel): void {
    if (typeof window === "undefined") {
        return;
    }
    localStorage.setItem(DIFF_MODE_STORAGE_KEY, label === "columns" ? DiffDisplayMode.split : DiffDisplayMode.inline);
}

// item 75: "Show full contents" persists like the Columns/Inline toggle, under its own key.
const FULL_CONTENTS_STORAGE_KEY = "reveng.diff.fullContents";

// The stored full-contents flag: "1" is on; absent / anything else is off (opt-in — the
// default view is the ±3-line hunk diff).
export function resolveInitialFullContentsChoice(stored: string | undefined): boolean {
    return stored === "1";
}

// localStorage is browser-only (same typeof-window guard as readStoredDiffMode).
function readStoredFullContents(): string | undefined {
    if (typeof window === "undefined") {
        return undefined;
    }
    return localStorage.getItem(FULL_CONTENTS_STORAGE_KEY) ?? undefined;
}

export function writeStoredFullContents(on: boolean): void {
    if (typeof window === "undefined") {
        return;
    }
    localStorage.setItem(FULL_CONTENTS_STORAGE_KEY, on ? "1" : "0");
}

export function fullContentsIsOn(): boolean {
    return resolveInitialFullContentsChoice(readStoredFullContents());
}

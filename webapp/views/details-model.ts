// Details pane view model (split from details.ts, task 92): DOM-free, tested types and pure functions the pane's modes share.

import {
  COMMIT_NODE_KIND,
  type TimelineNode,
  type WireTimelineDocument,
} from "./timeline-types.ts";
import { computeAnchoredRevisionIndex } from "./file-history-model.ts";
import { formatRowTimestamp } from "./timeline-labels.ts";
import { GIT_BASE_CHANGE_ID_PREFIX } from "./timeline-changes.ts";

// ── types (derived from timeline's wire/view-model types, one canonical home) ──

// One reconstructed file history off the wire document (target + its revision list).
export type WireFileHistory = WireTimelineDocument["filesTouched"][number];

// task 56 follow-up: a base-commit beacon changeId renders as baseline content, not an empty diff.
export function isChangeIdGitBaseline(changeId: string | undefined): boolean {
  return changeId !== undefined && changeId.startsWith(GIT_BASE_CHANGE_ID_PREFIX);
}

// What the render modes need from the owning timeline view: the document, the nodes, and the timeline's callbacks.
export type DetailsContext = {
  project: string;
  document: WireTimelineDocument;
  nodes: TimelineNode[];
  openNodeInspector: (nodeIndex: number) => void;
  selectTimelineRow: (nodeIndex: number) => void;
  // item 84: opens a revision's causing JSONL record; only the timeline can resolve changeId to a line.
  openRecordForChangeId: (changeId: string) => void;
  // item 84: fetches the step-range patch; closure-local to the timeline, which owns consent params and cache.
  fetchRangePatch: (fromStepIndex: number, toStepIndex: number) => Promise<string>;
};

// One File-Revisions card; unrecoverableReason (task 119) set means a dashed card with no actions.
export type RevisionCard = { revisionNumber: number; opLabel: string; timestamp: string; changeId: string; unrecoverableReason?: string };

// item 84: which right-column render the Revision View opens with. Local to the view layer, no wire vocabulary.
export enum RevisionViewMode {
  diff = "diff",        // the revision's diff vs the previous revision — the card's own default
  content = "content",  // the revision's full file content
  record = "record",    // the JSONL record that caused the revision
}

// item 84: which revision the Revision View opens on, and how. Absent means revision #1 in diff mode.
export type RevisionFocus = { changeId: string; mode: RevisionViewMode };

// task 93: /file/<path>/rev/<n> carries a 1-based number. No anchor, unknown target or bad number means no focus.
export function computeFileRouteFocus(
  filesTouched: WireFileHistory[], target: string, anchorRev: string | undefined,
): RevisionFocus | undefined {
  let fileHistory: WireFileHistory | undefined = undefined;
  for (const entry of filesTouched) {
    const isFirstMatch = entry.target === target && fileHistory === undefined;
    if (isFirstMatch) {
      fileHistory = entry;
    }
  }
  if (fileHistory === undefined) {
    return undefined;
  }
  const revisionIndex = computeAnchoredRevisionIndex(anchorRev, fileHistory.revisions.length);
  if (revisionIndex === undefined) {
    return undefined;
  }
  return { changeId: fileHistory.revisions[revisionIndex]!.changeId, mode: RevisionViewMode.content };
}

// A node kind's readable label: dashes become spaces ("agent-turn" to "agent turn").
function formatNodeKind(kind: string): string {
  return kind.replaceAll("-", " ");
}

// The pane header for a selected row: commits lead with hash and message; other nodes name step position and kind.
export function computeDetailsHeaderText(node: TimelineNode, position: { index: number; total: number }): string {
  const timestamp = formatRowTimestamp(node.when);   // task 160: blank, never "Invalid Date"
  if (node.kind === COMMIT_NODE_KIND) {
    // no hash → no hash segment; a placeholder dash reads broken (user report, s58)
    const hashSegment = node.resultHash === undefined ? "" : ` ${node.resultHash}`;
    return `git commit${hashSegment} — ${node.detail ?? "git commit"} — ${timestamp}`;
  }
  return `Step ${position.index + 1} of ${position.total} — ${formatNodeKind(node.kind)} — ${timestamp}`;
}

// A file history's revision cards, 1-based, each labeled with its wire event kind.
export function buildRevisionCards(history: WireFileHistory): RevisionCard[] {
  const cards: RevisionCard[] = [];
  for (let index = 0; index < history.revisions.length; index++) {
    const revision = history.revisions[index]!;
    cards.push({
      revisionNumber: index + 1,
      opLabel: revision.kind,
      timestamp: revision.timestamp,
      changeId: revision.changeId,
      unrecoverableReason: revision.unrecoverable?.reason,
    });
  }
  return cards;
}

// item 84: the 0-based card a focus selects. No focus or an unknown changeId opens revision #1.
export function computeFocusedCardIndex(cards: RevisionCard[], focus: RevisionFocus | undefined): number {
  if (focus === undefined) {
    return 0;
  }
  for (let cardIndex = 0; cardIndex < cards.length; cardIndex++) {
    const isFocused = cards[cardIndex]!.changeId === focus.changeId;
    if (isFocused) {
      return cardIndex;
    }
  }
  return 0;
}

// item 84: true when the toggled cards form one gapless run; click order does not matter.
export function isCardRunContiguous(selectedIndexes: number[]): boolean {
  if (selectedIndexes.length === 0) {
    return false;
  }
  const span = Math.max(...selectedIndexes) - Math.min(...selectedIndexes);
  return span === selectedIndexes.length - 1;
}

// item 84: node indexes owning the cards; ownerless or empty-snapshot cards are skipped (Infinity range-patch).
export function computeOwningNodeIndexes(cards: RevisionCard[], nodes: TimelineNode[], selectedIndexes: number[]): number[] {
  const ownerIndexes: number[] = [];
  for (const cardIndex of selectedIndexes) {
    const card = cards[cardIndex];
    if (card === undefined) {
      continue;
    }
    let ownerIndex = -1;
    for (let nodeIndex = 0; nodeIndex < nodes.length; nodeIndex++) {
      for (const change of nodes[nodeIndex]!.fileChanges ?? []) {
        const isFirstOwner = ownerIndex < 0 && change.changeId === card.changeId;
        if (isFirstOwner) {
          ownerIndex = nodeIndex;
        }
      }
    }
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

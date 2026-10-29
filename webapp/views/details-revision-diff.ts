// Right-column renders for one Revision View card: diff, content, or causing record.

import { buildFileHistoryViewModel } from "./file-history-model.ts";
import { computeRevisionDiffFallbackText } from "./timeline-labels-tags.ts";
import type { FileChange } from "./timeline-node-types.ts";
import {
  type DetailsContext,
  type RevisionCard,
  RevisionViewMode,
  type WireFileHistory,
  isChangeIdGitBaseline,
} from "./details-model.ts";
import { isFullContentsOn } from "./details-stored-choices.ts";
import { renderGitBaselineInDetails } from "./details-baseline.ts";
import {
  renderContentInDetails,
  renderDiffInDetails,
  renderTextInDetails,
  renderUnrecoverableInDetails,
} from "./details-diff.ts";

export type RevisionPage = {
  target: string;
  context: DetailsContext;
  history: WireFileHistory;
  cards: RevisionCard[];
  revisionContents: ReturnType<typeof buildFileHistoryViewModel>["revisions"];
  getDiffBlocks: (full: boolean) => Promise<string[]>;
  left: HTMLElement;
  baseName: string;
  focusedIndex: number;
  focusedMode: RevisionViewMode;
  rangeSelected: Set<number>;
  rangeToggles: HTMLElement[];
};

export async function renderCardDiff(page: RevisionPage, card: RevisionCard, index: number): Promise<void> {
  const { target, context, history, getDiffBlocks } = page;
  const label = `${target} — revision #${card.revisionNumber}`;
  function refreshCardDiff(): void {
    void renderCardDiff(page, card, index);
  }
  // A placeholder's lines repeat the prior revision, so show the failure reason instead.
  if (card.unrecoverableReason !== undefined) {
    const previousBlock = index > 0 ? (await getDiffBlocks(isFullContentsOn()))[index - 1] : undefined;
    renderUnrecoverableInDetails(label, target, card.unrecoverableReason, previousBlock, refreshCardDiff);
    return;
  }
  const isGitBaseline = isChangeIdGitBaseline(card.changeId);
  if (isGitBaseline) {
    renderGitBaselineInDetails(context.document, target, card.changeId);
    return;
  }
  const block = (await getDiffBlocks(isFullContentsOn()))[index];
  const change: FileChange = {
    path: target,
    displayPath: target,
    eventKind: card.opLabel,
    renamedFrom: history.revisions[index]!.rename?.from,
    isFirstRevision: index === 0,
    changeId: card.changeId,
    when: card.timestamp,
  };
  const fallbackText = computeRevisionDiffFallbackText(block, change);
  if (fallbackText !== undefined) {
    renderTextInDetails(label, fallbackText);
    return;
  }
  renderDiffInDetails(label, target, block!, refreshCardDiff);
}

// A card's own click always means diff: only an incoming focus can ask for content or record.
export function renderCardInMode(page: RevisionPage, card: RevisionCard, index: number, mode: RevisionViewMode): void {
  if (mode === RevisionViewMode.content) {
    renderContentInDetails(page.target, card.revisionNumber, page.revisionContents[index]?.content);
    return;
  }
  if (mode === RevisionViewMode.record) {
    page.context.openRecordForChangeId(card.changeId);
    return;
  }
  void renderCardDiff(page, card, index);
}

export function renderFocusedCard(page: RevisionPage): void {
  renderCardInMode(page, page.cards[page.focusedIndex]!, page.focusedIndex, page.focusedMode);
}

// Right-column renders for one Revision View card: diff, content, or causing record.

import { buildFileHistoryViewModel } from "./file-history-model.ts";
import { computeRevisionDiffFallbackText } from "./timeline-labels-tags.ts";
import { type FileChange } from "./timeline-types.ts";
import {
  type DetailsContext,
  type RevisionCard,
  RevisionViewMode,
  type WireFileHistory,
  checkChangeIdIsGitBaseline,
  fullContentsIsOn,
} from "./details-model.ts";
import { showGitBaselineInDetails } from "./details-baseline.ts";
import {
  showContentInDetails,
  showDiffInDetails,
  showTextInDetails,
  showUnrecoverableInDetails,
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
    const previousBlock = index > 0 ? (await getDiffBlocks(fullContentsIsOn()))[index - 1] : undefined;
    showUnrecoverableInDetails(label, target, card.unrecoverableReason, previousBlock, refreshCardDiff);
    return;
  }
  const isGitBaseline = checkChangeIdIsGitBaseline(card.changeId);
  if (isGitBaseline) {
    showGitBaselineInDetails(context.document, target, card.changeId);
    return;
  }
  const block = (await getDiffBlocks(fullContentsIsOn()))[index];
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
    showTextInDetails(label, fallbackText);
    return;
  }
  showDiffInDetails(label, target, block!, refreshCardDiff);
}

// A card's own click always means diff: only an incoming focus can ask for content or record.
export function renderCardInMode(page: RevisionPage, card: RevisionCard, index: number, mode: RevisionViewMode): void {
  if (mode === RevisionViewMode.content) {
    showContentInDetails(page.target, card.revisionNumber, page.revisionContents[index]?.content);
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

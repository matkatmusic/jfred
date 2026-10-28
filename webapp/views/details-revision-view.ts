// File-Revisions mode: the Revision View every file route lands on (tests/details-revision-view.test.ts).

import { createElement } from "../app-dom.ts";
import { getFileHistoryRoute } from "../app-routes.ts";
import { openDetailsPane } from "../inspector-pane.ts";
import { buildFileHistoryViewModel } from "./file-history-model.ts";
import {
  type DetailsContext,
  type RevisionCard,
  type RevisionFocus,
  RevisionViewMode,
  type WireFileHistory,
  buildRevisionCards,
  computeFocusedCardIndex,
} from "./details-model.ts";
import { fetchRevisionDiffBlocks, setDetailsHeader } from "./details-diff.ts";
import {
  buildMissingRevisionCard,
  buildRevisionActionsElement,
  buildRevisionHeadElement,
} from "./details-revision-cards.ts";
import { type RevisionPage, renderCardDiff, renderCardInMode } from "./details-revision-diff.ts";
import { toggleRangeCard } from "./details-revision-range.ts";

function findRevisedHistory(filesTouched: WireFileHistory[], target: string): WireFileHistory | undefined {
  for (const entry of filesTouched) {
    if (entry.target !== target)
      continue;
    return entry.revisions.length === 0 ? undefined : entry;
  }
  return undefined;
}

// The diff at each context width is fetched once on first need, so switching cards never re-fetches.
function createDiffBlocksGetter(project: string, target: string): (full: boolean) => Promise<string[]> {
  let defaultBlocks: Promise<string[]> | undefined;
  let fullBlocks: Promise<string[]> | undefined;
  function getDiffBlocks(full: boolean): Promise<string[]> {
    if (full) {
      fullBlocks ??= fetchRevisionDiffBlocks(project, target, true);
      return fullBlocks;
    }
    defaultBlocks ??= fetchRevisionDiffBlocks(project, target, false);
    return defaultBlocks;
  }
  return getDiffBlocks;
}

function selectCard(left: HTMLElement, cardElement: HTMLElement): void {
  for (const other of left.querySelectorAll(".rev-card")) {
    other.classList.remove("selected");
  }
  cardElement.classList.add("selected");
}

// An action button's click must not re-trigger the card's own diff swap.
function buildActionButton(text: string, onActivate: () => unknown): HTMLElement {
  function stopAndActivate(event: Event): void {
    event.stopPropagation();
    onActivate();
  }
  return createElement("button", { text, onclick: stopAndActivate as EventListener });
}

function appendRevisionCard(page: RevisionPage, card: RevisionCard, index: number): void {
  function toggleThisCard(): void {
    toggleRangeCard(page, index);
  }
  const rangeToggle = buildActionButton("☐", toggleThisCard);
  page.rangeToggles.push(rangeToggle);
  const healthyCardRows = [
    buildRevisionHeadElement(rangeToggle, card),
    buildRevisionActionsElement(buildActionButton, page.context, page.target, page.baseName, card, index, page.revisionContents, page.getDiffBlocks),
  ];
  const cardElement = card.unrecoverableReason === undefined
    ? createElement("div", { class: "rev-card" }, healthyCardRows)
    : buildMissingRevisionCard(buildActionButton, page.context, card, page.cards.length);
  function selectAndRenderCard(): void {
    selectCard(page.left, cardElement);
    void renderCardDiff(page, card, index);
  }
  cardElement.onclick = selectAndRenderCard;
  page.left.append(cardElement);
  if (index === page.focusedIndex) {
    selectCard(page.left, cardElement);
    renderCardInMode(page, card, index, page.focusedMode);
  }
}

export function renderDetailsFileMode(target: string, context: DetailsContext, focus?: RevisionFocus): void {
  openDetailsPane();
  setDetailsHeader(`File Revisions — ${target}`);
  const left = document.getElementById("details-left")!;
  left.replaceChildren(createElement("div", { class: "pane-title", text: "Revisions" }));
  const history = findRevisedHistory(context.document.filesTouched, target);
  if (history === undefined) {
    left.append(createElement("div", { class: "dempty", text: "No revisions" }));
    return;
  }
  function openDiffVsBase(): void {
    location.hash = `${getFileHistoryRoute(context.project, target)}/vsbase`;
  }
  left.append(createElement("button", { class: "row-btn", text: "Diff vs Base", onclick: openDiffVsBase }));
  const cards = buildRevisionCards(history);
  const page: RevisionPage = {
    target,
    context,
    history,
    cards,
    revisionContents: buildFileHistoryViewModel(context.document, target).revisions,
    getDiffBlocks: createDiffBlocksGetter(context.project, target),
    left,
    baseName: target.slice(target.lastIndexOf("/") + 1),
    focusedIndex: computeFocusedCardIndex(cards, focus),
    focusedMode: focus?.mode ?? RevisionViewMode.diff,
    rangeSelected: new Set<number>(),
    rangeToggles: [],
  };
  for (let index = 0; index < cards.length; index++) {
    appendRevisionCard(page, cards[index]!, index);
  }
}

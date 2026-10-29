// Rev-card DOM builders split from details-revision-view.ts: pure element construction only.

import { createElement } from "../app-dom.ts";
import { buildFileHistoryViewModel } from "./file-history-model.ts";
import {
  type DetailsContext,
  type RevisionCard,
} from "./details-model.ts";
import { isFullContentsOn } from "./details-stored-choices.ts";
import { renderContentInDetails } from "./details-diff.ts";
import { saveTextFile } from "./download.ts";

function moveToOwningTimelineStep(context: DetailsContext, card: RevisionCard): void {
  let ownerIndex = -1;
  for (const [nodeIndex, candidate] of context.nodes.entries()) {
    for (const change of candidate.fileChanges ?? []) {
      const isFirstOwner = change.changeId === card.changeId && ownerIndex < 0;
      if (isFirstOwner) {
        ownerIndex = nodeIndex;
      }
    }
  }
  // No owning row (rewound / synthetic revisions): the button is a no-op.
  if (ownerIndex >= 0) {
    context.selectTimelineRow(ownerIndex);
  }
}

type BuildActionButton = (text: string, onActivate: () => unknown) => HTMLElement;

function buildJumpButton(buildActionButton: BuildActionButton, context: DetailsContext, card: RevisionCard): HTMLElement {
  function moveToStep(): void {
    moveToOwningTimelineStep(context, card);
  }
  return buildActionButton("Jump to timeline step", moveToStep);
}

function buildJsonButton(buildActionButton: BuildActionButton, context: DetailsContext, card: RevisionCard): HTMLElement {
  function openRecord(): void {
    context.openRecordForChangeId(card.changeId);
  }
  return buildActionButton("{ }", openRecord);
}

export function buildRevisionHeadElement(rangeToggle: HTMLElement, card: RevisionCard): HTMLElement {
  return createElement("div", { class: "rev-head" }, [
    rangeToggle,
    createElement("span", { text: `#${card.revisionNumber}` }),
    createElement("span", { class: `op-badge op-${card.opLabel}`, text: card.opLabel }),
    createElement("span", { class: "rev-ts", text: new Date(card.timestamp).toLocaleString() }),
  ]);
}

export function buildRevisionActionsElement(
  buildActionButton: (text: string, onActivate: () => unknown) => HTMLElement,
  context: DetailsContext,
  target: string,
  baseName: string,
  card: RevisionCard,
  index: number,
  revisionContents: ReturnType<typeof buildFileHistoryViewModel>["revisions"],
  getDiffBlocks: (full: boolean) => Promise<string[]>,
): HTMLElement {
  function openRevisionContent(): void {
    renderContentInDetails(target, card.revisionNumber, revisionContents[index]?.content);
  }
  function saveRevisionVersion(): void {
    saveTextFile(`${baseName}.rev${card.revisionNumber}`,revisionContents[index]?.content ?? "");
  }
  async function copyRevisionPatch(): Promise<void> {
    const diffBlocks = await getDiffBlocks(isFullContentsOn());
    await navigator.clipboard.writeText(diffBlocks[index] ?? "");
  }
  async function saveRevisionPatch(): Promise<void> {
    const diffBlocks = await getDiffBlocks(isFullContentsOn());
    saveTextFile(`${baseName}.rev${card.revisionNumber}.patch`, diffBlocks[index] ?? "");
  }
  return createElement("div", { class: "rev-actions" }, [
    buildActionButton("Show content", openRevisionContent),
    buildActionButton("Export this version", saveRevisionVersion),
    buildActionButton("Copy patch", copyRevisionPatch),
    buildActionButton("Export .patch", saveRevisionPatch),
    buildJumpButton(buildActionButton, context, card),
    // item 84: the only route to a file-modifying event's JSON; the timeline chip delegates here.
    buildJsonButton(buildActionButton, context, card),
  ]);
}

// task 130: an unrecoverable placeholder card offers only jump and { }; its lines are carried forward.
export function buildMissingRevisionCard(
  buildActionButton: (text: string, onActivate: () => unknown) => HTMLElement,
  context: DetailsContext,
  card: RevisionCard,
  revisionCount: number,
): HTMLElement {
  return createElement("div", { class: "rev-card missing" }, [
    createElement("div", { class: "rev-head" }, [
      createElement("span", { text: `rev ${card.revisionNumber} ✗` }),
      createElement("span", { class: "rev-ts", text: new Date(card.timestamp).toLocaleString() }),
    ]),
    createElement("div", {
      class: "why",
      title: card.unrecoverableReason!,
      text: `rev ${card.revisionNumber} (of ${revisionCount}) failed to apply ${card.opLabel}`,
    }),
    createElement("div", { class: "rev-actions" }, [
      buildJumpButton(buildActionButton, context, card),
      buildJsonButton(buildActionButton, context, card),
    ]),
  ]);
}

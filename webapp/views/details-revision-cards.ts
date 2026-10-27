// Rev-card DOM builders split from details-revision-view.ts: pure element construction only.

import { createElement } from "../app-dom.ts";
import { buildFileHistoryViewModel } from "./file-history-model.ts";
import {
  type DetailsContext,
  type RevisionCard,
} from "./details-model.ts";
import { isFullContentsOn } from "./details-stored-choices.ts";
import { showContentInDetails } from "./details-diff.ts";
import { downloadText } from "./download.ts";

function moveToOwningTimelineStep(context: DetailsContext, card: RevisionCard): void {
  let ownerIndex = -1;
  for (const [nodeIndex, candidate] of context.nodes.entries()) {
    for (const change of candidate.fileChanges ?? []) {
      if (change.changeId === card.changeId && ownerIndex < 0) {
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
  return createElement("div", { class: "rev-actions" }, [
    buildActionButton("Show content", () => showContentInDetails(target, card.revisionNumber, revisionContents[index]?.content)),
    buildActionButton("Export this version", () => downloadText(`${baseName}.rev${card.revisionNumber}`, revisionContents[index]?.content ?? "")),
    buildActionButton("Copy patch", async () => navigator.clipboard.writeText((await getDiffBlocks(isFullContentsOn()))[index] ?? "")),
    buildActionButton("Export .patch", async () => downloadText(`${baseName}.rev${card.revisionNumber}.patch`, (await getDiffBlocks(isFullContentsOn()))[index] ?? "")),
    buildActionButton("Jump to timeline step", () => jumpToOwningTimelineStep(context, card)),
    // item 84: the ONLY route to a file-modifying event's JSON. The timeline chip's { } delegates here, so this is load-bearing for the unification rule, not a nicety — without it the Revision View has no JSON route at all.
    buildActionButton("{ }", () => context.openRecordForChangeId(card.changeId)),
  ]);
}

// task 119: an unrecoverable placeholder's card — dashed "rev N ✗" head. task 129: the .why line says which revision (of how many) failed to apply which operation; the raw engine error survives as the hover title. task 130: ONLY the jump + { } actions — the placeholder's lines are the prior revision carried forward, so content/export/patch actions would lie.
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
      buildActionButton("Jump to timeline step", () => jumpToOwningTimelineStep(context, card)),
      buildActionButton("{ }", () => context.openRecordForChangeId(card.changeId)),
    ]),
  ]);
}

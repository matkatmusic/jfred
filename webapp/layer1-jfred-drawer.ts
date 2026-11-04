// Task 383: shows a jfred commit message in the Details drawer, with a Commit button for a pending mark.

import { createElement, getRequiredElementById } from "./app-dom.ts";
import { renderDetailView } from "./layer1-diff-view.ts";
import { clearDiffPair, setDrawerTools } from "./layer1-drawer-diff.ts";
import { storeOpenedNode } from "./layer1-node-link.ts";

export interface JfredMessageView {
  // Undefined while the mark is still pending.
  shortHash: string | undefined;
  parentShortHash: string;
  instant: string;
  message: string;
}

const PENDING_HASH_TEXT = "(pending)";

function buildMessagePane(view: JfredMessageView, onCommit: (() => void) | undefined): HTMLElement {
  const pane = createElement("div", { class: "jpane" });
  if (onCommit !== undefined)
    pane.append(createElement("button", { class: "jcommit", id: "jfred-commit-button", text: "Commit", onclick: onCommit }));
  pane.append(createElement("pre", { class: "jfred-message", text: view.message }));
  return pane;
}

export function openJfredMessage(view: JfredMessageView, onCommit?: () => void): void {
  clearDiffPair();
  storeOpenedNode(undefined);
  getRequiredElementById("dprev").hidden = true;
  getRequiredElementById("dnext").hidden = true;
  getRequiredElementById("dpath").textContent = `jfred commit ${view.shortHash ?? PENDING_HASH_TEXT}`;
  getRequiredElementById("dmeta").textContent = `parent ${view.parentShortHash} | author date ${view.instant}`;
  setDrawerTools("none");
  renderDetailView([buildMessagePane(view, onCommit)]);
}

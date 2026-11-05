// Task 383: the jfred commit column between the session column and the bubbles.

import { createElement, getRequiredElementById } from "../../app-dom.ts";
import { repaintCutMarks } from "./layer1-cut-paint.ts";
import { openJfredMessage } from "./layer1-jfred-drawer.ts";
import { buildJfredEntries, JfredEntryKind, listJfredEntries } from "./layer1-jfred-entries.ts";
import { commitPending, deleteJfredBranch, readJfredBranch } from "./layer1-jfred-state.ts";
import type { WireRulerTick } from "../../layer1-wire.ts";

import { attachHoverPopup } from "../popups/layer1-hover-popup.ts";
import type { HoverPopupContent } from "../popups/layer1-hover-popup.ts";
import { wrapTextAtColumns } from "../ruler/layer1-wrap-text.ts";

const STRIP_ID = "jfred-strip";
const POPUP_COLUMNS = 50;

let lastTicks: readonly WireRulerTick[] = [];

function buildHead(): HTMLElement {
  const title = createElement("span", { text: "commits" });
  return createElement("div", { class: "jhead" }, [title, createElement("button", { class: "jdelete", text: "Delete jfred branch" })]);
}

function openCommitMessage(shortHash: string): void {
  for (const commit of readJfredBranch().commits) {
    if (commit.shortHash === shortHash) {
      openJfredMessage(commit);
      return;
    }
  }
  throw new Error(`no jfred commit ${shortHash}`);
}

function applyPendingCommit(): void {
  const made = commitPending();
  renderJfredEntries();
  repaintCutMarks();
  openJfredMessage(made);
}

export function openPendingMessage(): void {
  const branch = readJfredBranch();
  if (branch.pending === undefined)
    throw new Error("no pending jfred mark");
  const parentShortHash = listJfredEntries(branch).at(-1)!.parentShortHash!;
  openJfredMessage({ shortHash: undefined, parentShortHash, instant: branch.pending.instant, message: branch.pending.message }, applyPendingCommit);
}

function executeDeleteClick(): void {
  deleteJfredBranch();
  renderJfredEntries();
  repaintCutMarks();
}

// The base entry has no message, so its click does nothing.
function dispatchStripClick(event: Event): void {
  const target = event.target as HTMLElement;
  const deleteButton = target.closest(".jdelete");
  const isDeleteClick = deleteButton !== null;
  if (isDeleteClick) {
    executeDeleteClick();
    return;
  }
  const entry = target.closest<HTMLElement>("[data-entry-kind]");
  if (entry?.dataset["entryKind"] === JfredEntryKind.pending)
    openPendingMessage();
  if (entry?.dataset["entryKind"] === JfredEntryKind.commit)
    openCommitMessage(entry.dataset["shortHash"]!);
}

function findEntryMessage(element: HTMLElement): string {
  for (const entry of listJfredEntries(readJfredBranch())) {
    const isSameKind = entry.kind === element.dataset["entryKind"];
    const isSameHash = entry.shortHash === element.dataset["shortHash"];
    const isTarget = isSameKind && isSameHash;
    if (isTarget)
      return entry.message!;
  }
  throw new Error(`no jfred entry for ${element.dataset["entryKind"]}`);
}

// The base has no message, so it gets no popup.
function readEntryPopup(target: HTMLElement): HoverPopupContent | undefined {
  const element = target.closest<HTMLElement>("[data-entry-kind]");
  const hasNoEntry = element === null;
  if (hasNoEntry)
    return undefined;
  const isBase = element.dataset["entryKind"] === JfredEntryKind.base;
  if (isBase)
    return undefined;
  return { lines: wrapTextAtColumns(findEntryMessage(element), POPUP_COLUMNS).split("\n") };
}

function buildStripOnce(): HTMLElement {
  const existing = document.getElementById(STRIP_ID);
  if (existing !== null)
    return existing;
  const strip = createElement("div", { id: STRIP_ID, class: "jfred-strip" });
  (document.getElementById("annotation-track") ?? getRequiredElementById("ruler")).after(strip);
  strip.addEventListener("click", dispatchStripClick);
  attachHoverPopup(strip, readEntryPopup);
  return strip;
}

// Draws from the ticks of the last render; keeps the head even when the branch is empty.
export function renderJfredEntries(): void {
  // ponytail: a handful of entries, draw all; add a window like layer1-annotation-window.ts past about 200
  buildStripOnce().replaceChildren(buildHead(), ...buildJfredEntries(readJfredBranch(), lastTicks));
}

// Runs after renderAnnotationTrack in every stage render; Commit mode off removes the strip.
export function renderJfredStrip(ticks: readonly WireRulerTick[]): void {
  lastTicks = ticks;
  const isArmed = readJfredBranch().isArmed;
  if (!isArmed) {
    document.getElementById(STRIP_ID)?.remove();
    return;
  }
  renderJfredEntries();
}

// Redraws from the ticks of the last render; Commit mode calls it after a toggle.
export function refreshJfredStrip(): void {
  renderJfredStrip(lastTicks);
}

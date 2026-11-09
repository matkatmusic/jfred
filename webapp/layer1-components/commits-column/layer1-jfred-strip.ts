// Task 383: the jfred commit column between the session column and the bubbles.

import { createElement, getRequiredElementById } from "../../app-dom.ts";
import { repaintCutMarks } from "./layer1-cut-paint.ts";
import { openJfredMessage } from "./layer1-jfred-drawer.ts";
import { buildJfredEntries, JfredEntryKind, listJfredEntries } from "./layer1-jfred-entries.ts";
import { sendJfredCommit, sendJfredDelete } from "./layer1-jfred-api.ts";
// import { commitPending, deleteJfredBranch, readJfredBranch } from "./layer1-jfred-state.ts";
import { appendCommit, buildCommitRequest, deleteJfredBranch, readJfredBranch } from "./layer1-jfred-state.ts";
import type { JfredCommit } from "./layer1-jfred-state.ts";
import { JfredCommitOutcome } from "./layer1-wire-jfred.ts";
import type { WireJfredCommitReply } from "./layer1-wire-jfred.ts";
import { saveJfredBaseHash } from "../../layer1-settings.ts";
import type { WireRulerTick } from "../../layer1-wire.ts";

import { openToast } from "../details-drawer/layer1-diff-pane-support.ts";
import { hideLayer1Progress } from "../loading-bar/layer1-progress.ts";
import { closeBusyShield } from "../popups/layer1-busy-shield.ts";
import { attachHoverPopup } from "../popups/layer1-hover-popup.ts";
import type { HoverPopupContent } from "../popups/layer1-hover-popup.ts";
import { openYesNoQuestion } from "../popups/layer1-yes-no-row.ts";
import { wrapTextAtColumns } from "../ruler/layer1-wrap-text.ts";

const STRIP_ID = "jfred-strip";
const POPUP_COLUMNS = 50;
export const DELETE_QUESTION = "Delete the jfred branch? This removes every jfred commit from the list.";
const MOVE_QUESTION_START = "This range changes no file, so no commit is made. Move the end mark to ";
const NO_LATER_CHANGE_TEXT = "No commit: this range changes no file, and no later time changes a file.";
const NO_LATER_TICK_TEXT = "No commit: a later time changes a file, but no ruler item can hold a mark there.";

let movePendingMark: (instant: string) => boolean = () => {
  throw new Error("no pending-mark mover is registered");
};

export function registerPendingMarkMover(mover: (instant: string) => boolean): void {
  movePendingMark = mover;
}

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

// function applyPendingCommit(): void {
//   const made = commitPending();
//   renderJfredEntries();
//   repaintCutMarks();
//   openJfredMessage(made);
// }

function applyPendingCommit(): void {
  void sendJfredCommit(buildCommitRequest()).then(applyCommitReply, reportJfredFailure);
}

function applyCommitReply(reply: WireJfredCommitReply | undefined): void {
  if (reply === undefined)
    return;
  if (reply.outcome === JfredCommitOutcome.committed) {
    applyServerCommit(reply.commit);
    return;
  }
  if (reply.outcome === JfredCommitOutcome.unrebuilt) {
    openMoveQuestionForUnrebuiltPaths(reply.paths, reply.nextInstant);
    return;
  }
  openMoveQuestionForUnchangedRange(reply.nextInstant);
}

function openMoveQuestionForUnrebuiltPaths(paths: string[], nextInstant: string): void {
  const question = `${paths.join(", ")} could not be rebuilt here. Move the Commit point to ${nextInstant}?`;
  function applyThisMoveAnswer(isYes: boolean): void {
    applyMoveAnswer(isYes, nextInstant);
  }
  void openYesNoQuestion(question, "Yes, move it", "No").then(applyThisMoveAnswer);
}

function applyServerCommit(commit: JfredCommit): void {
  appendCommit(commit);
  renderJfredEntries();
  repaintCutMarks();
  openJfredMessage(commit);
}

function reportJfredFailure(error: unknown): never {
  hideLayer1Progress();
  closeBusyShield();
  openToast(String(error));
  throw error;
}

function openMoveQuestionForUnchangedRange(nextInstant: string | undefined): void {
  if (nextInstant === undefined) {
    openToast(NO_LATER_CHANGE_TEXT);
    return;
  }
  const question = `${MOVE_QUESTION_START}${nextInstant}, the first later time that changes a file?`;
  const movedInstant: string = nextInstant;
  function applyThisMoveAnswer(isYes: boolean): void {
    applyMoveAnswer(isYes, movedInstant);
  }
  void openYesNoQuestion(question, "Yes, move it", "No").then(applyThisMoveAnswer);
}

function applyMoveAnswer(isYes: boolean, nextInstant: string): void {
  if (!isYes)
    return;
  const isMoved = movePendingMark(nextInstant);
  if (!isMoved)
    openToast(NO_LATER_TICK_TEXT);
}

export function openPendingMessage(): void {
  const branch = readJfredBranch();
  if (branch.pending === undefined)
    throw new Error("no pending jfred mark");
  const parentShortHash = listJfredEntries(branch).at(-1)!.parentShortHash!;
  openJfredMessage({ shortHash: undefined, parentShortHash, instant: branch.pending.instant, message: branch.pending.message }, applyPendingCommit);
}

function applyCannedDelete(): void {
  deleteJfredBranch();
  renderJfredEntries();
  repaintCutMarks();
}

function applyServerDelete(): void {
  deleteJfredBranch();
  saveJfredBaseHash("");
  renderJfredEntries();
  repaintCutMarks();
}

function applyDeleteAnswer(isYes: boolean): void {
  if (!isYes)
    return;
  const isCanned = readJfredBranch().isCanned;
  if (isCanned) {
    applyCannedDelete();
    return;
  }
  void sendJfredDelete().then(applyServerDelete, reportJfredFailure);
}

function executeDeleteClick(): void {
  void openYesNoQuestion(DELETE_QUESTION, "Yes, delete", "No").then(applyDeleteAnswer);
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
  const strip = createElement("div", { id: STRIP_ID, class: "jfred-strip", "data-component": "CommitsColumn" });
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

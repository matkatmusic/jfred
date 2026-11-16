// Task 383: the jfred commit column between the session column and the bubbles.

import { createElement, getRequiredElementById } from "../../app-dom.ts";
import { renderBarsCutStrip } from "../bars-view/layer1-bars-cut-strip.ts";
import type { BarsCutStripHandlers } from "../bars-view/layer1-bars-cut-strip.ts";
import { isBarsViewOn } from "../bars-view/layer1-bars-mode.ts";
import { repaintCutMarks } from "./layer1-cut-paint.ts";
import { openJfredMessage } from "./layer1-jfred-drawer.ts";
import { appendJfredPatch } from "./layer1-jfred-patch.ts";
import { buildJfredEntries, JfredEntryKind, listJfredEntries } from "./layer1-jfred-entries.ts";
import { fetchScriptReplayNeeds, runScriptReplay, sendJfredCommit, sendJfredDelete } from "./layer1-jfred-api.ts";
// import { commitPending, deleteJfredBranch, readJfredBranch } from "./layer1-jfred-state.ts";
import { appendCommit, buildCommitRequest, deleteJfredBranch, readJfredBranch, readTipMs } from "./layer1-jfred-state.ts";
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
import { openMissingExecutablesNotice, openScriptReplayConsent } from "../popups/layer1-run-consent.ts";
import { openYesNoQuestion } from "../popups/layer1-yes-no-row.ts";
import { wrapTextAtColumns } from "../ruler/layer1-wrap-text.ts";

const STRIP_ID = "jfredCommitsDrawerComponent";
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
  const title = createElement("span", { "data-component": "commitsHeadTitle", text: "commits" });
  return createElement("div", { class: "jhead" }, [title, createElement("button", { class: "jdelete", "data-component": "commitsDeleteBranchButton", text: "Delete jfred branch" })]);
}

function openCommitMessage(shortHash: string): void {
  for (const commit of readJfredBranch().commits) {
    if (commit.shortHash === shortHash) {
      openJfredMessage(commit);
      const isRealBranch = !readJfredBranch().isCanned;
      if (isRealBranch) {
        void appendJfredPatch(commit.shortHash).then(undefined, reportJfredFailure);
      }
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

// function applyPendingCommit(): void {
//   void sendJfredCommit(buildCommitRequest()).then(applyCommitReply, reportJfredFailure);
// }

async function sendCommitAfterScriptReplay(): Promise<WireJfredCommitReply | undefined> {
  const request = buildCommitRequest();
  const tipMs = readTipMs();
  let fromInstant: string | null = null;
  if (tipMs !== undefined) {
    fromInstant = new Date(tipMs).toISOString();
  }
  const needs = await fetchScriptReplayNeeds({ fromInstant, toInstant: request.markInstant });
  if (needs === undefined) {
    return undefined;
  }
  let isRunAllowed = false;
  if (needs.tasks.length > 0) {
    isRunAllowed = await openScriptReplayConsent(needs);
    if (isRunAllowed) {
      const runReply = await runScriptReplay({ toInstant: request.markInstant, allowScripts: true });
      if (runReply === undefined) {
        return undefined;
      }
      await openMissingExecutablesNotice(runReply);
    }
  }
  return sendJfredCommit({ ...request, allowScripts: isRunAllowed });
}

// function applyPendingCommit(): void {
//   void sendCommitAfterScriptReplay().then(applyCommitReply, reportJfredFailure);
// }

export function applyPendingCommit(): void {
  void sendCommitAfterScriptReplay().then(applyCommitReply, reportJfredFailure);
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
  const isRealBranch = !readJfredBranch().isCanned;
  if (isRealBranch) {
    void appendJfredPatch(commit.shortHash).then(undefined, reportJfredFailure);
  }
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

// function executeDeleteClick(): void {
//   void openYesNoQuestion(DELETE_QUESTION, "Yes, delete", "No").then(applyDeleteAnswer);
// }

export function executeDeleteClick(): void {
  void openYesNoQuestion(DELETE_QUESTION, "Yes, delete", "No").then(applyDeleteAnswer);
}

const barsCutStripHandlers: BarsCutStripHandlers = { commitPendingMark: applyPendingCommit, askDeleteBranch: executeDeleteClick };

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
  const strip = createElement("div", { id: STRIP_ID, class: "jfredCommitsDrawerComponent", "data-component": "jfredCommitsDrawerComponent" });
  // (document.getElementById("sessionDotLinesComponent") ?? getRequiredElementById("timelineRulerComponent")).after(strip);
  getRequiredElementById("timelineRulerContainer").append(strip);
  strip.addEventListener("click", dispatchStripClick);
  attachHoverPopup(strip, readEntryPopup);
  return strip;
}

// Draws from the ticks of the last render; keeps the head even when the branch is empty.
export function renderJfredEntries(): void {
  if (isBarsViewOn()) {
    renderBarsCutStrip(barsCutStripHandlers);
    return;
  }
  // ponytail: a handful of entries, draw all; add a window like layer1-annotation-window.ts past about 200
  buildStripOnce().replaceChildren(buildHead(), ...buildJfredEntries(readJfredBranch(), lastTicks));
}

// Runs after renderAnnotationTrack in every stage render; Commit mode off removes the strip.
export function renderJfredStrip(ticks: readonly WireRulerTick[]): void {
  lastTicks = ticks;
  renderBarsCutStrip(barsCutStripHandlers);
  if (isBarsViewOn()) {
    document.getElementById(STRIP_ID)?.remove();
    return;
  }
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

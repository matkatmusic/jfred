// Pure judges that check PopupFacts from the Layer 6 run console popup and the consent text.

import { findNodeFacts } from "./layer6-node-facts.ts";
import {
  CRASH_BLOCKER_ID, MISMATCH_ID, ORIGINAL_FAILED_ID, REPLAY_MISMATCH_ID, REPLAY_NOT_REPLAYED_ID, SKIP_AFTER_ID, SKIP_FAILED_ID, VERIFIED_ID,
  type NodeFacts, type PopupFacts,
} from "./layer6-probes.ts";

export const CancelKind = { idle: "btn-idle", live: "btn-live", cancelled: "btn-cancelled" } as const;
export type CancelKind = (typeof CancelKind)[keyof typeof CancelKind];

export interface TitleColours { mismatch: string; verified: string; originalFailed: string }
export interface OutcomeCase { id: string; name: string; termClass: string | undefined; stateClass: string | undefined; note: string | undefined }

const CONSENT_PHRASES = ["copied files only", "no network", "Docker container", "Docker must be on"];
const STEP_LINE = /step \d of 6/g;
const SLOW_LINE_TOTAL = 6;
const RUN_STATE_WORD = "run-state-";

export const OUTCOME_CASES: OutcomeCase[] = [
  { id: REPLAY_MISMATCH_ID, name: "the mismatch run", termClass: "term-mismatch", stateClass: "run-state-mismatch", note: undefined },
  { id: SKIP_FAILED_ID, name: "the original-failed run", termClass: "term-original-failed", stateClass: "run-state-original-failed", note: undefined },
  { id: SKIP_AFTER_ID, name: "the run with no proof file", termClass: undefined, stateClass: "run-state-injected-unverified", note: "Replayed. No proof file was found to compare with." },
  { id: CRASH_BLOCKER_ID, name: "the crashed run", termClass: undefined, stateClass: undefined, note: "the script crashed with exit code 1" },
  { id: REPLAY_NOT_REPLAYED_ID, name: "the not-replayed run", termClass: undefined, stateClass: undefined, note: "this script only reads files, so it is not replayed" },
];

export function isConsentTextRight(text: string): boolean {
  let hasAllPhrases = true;
  for (const phrase of CONSENT_PHRASES) {
    const hasPhrase = text.includes(phrase);
    if (!hasPhrase)
      hasAllPhrases = false;
  }
  return hasAllPhrases && !text.includes("full access");
}

export function isPopupShown(popup: PopupFacts): boolean {
  const hasSize = popup.width > 0 && popup.height > 0;
  return !popup.hidden && hasSize && !popup.insideDrawer && popup.drawerOpen;
}

export function isPopupContentRight(popup: PopupFacts, outputText: string): boolean {
  const hasPre = popup.preCount === 1 && popup.preWhiteSpace === "pre";
  return hasPre && popup.preText === outputText;
}

export function isCancelButtonRight(popup: PopupFacts, kind: CancelKind, mismatchBorderColor: string | undefined): boolean {
  const isLive = kind === CancelKind.live;
  const hasKind = popup.cancelClass.split(" ").includes(kind);
  const isEnabledRight = popup.cancelDisabled !== isLive;
  const isColourRight = !isLive || popup.cancelBorderColor === mismatchBorderColor;
  const isStruckRight = popup.cancelDecoration.includes("line-through") === (kind === CancelKind.cancelled);
  return popup.cancelButtons === 1 && hasKind && isEnabledRight && isColourRight && isStruckRight;
}

export function isTerminalBlockRight(popup: PopupFacts, termClass: string | undefined): boolean {
  const wanted = termClass === undefined ? [] : [termClass];
  return JSON.stringify(popup.terminalClasses) === JSON.stringify(wanted);
}

function isNoteRight(noteTexts: string[], note: string | undefined): boolean {
  if (note === undefined)
    return noteTexts.length === 0;
  return noteTexts.join("\n").includes(note);
}

function isStateClassRight(dotClasses: string, stateClass: string | undefined): boolean {
  if (stateClass === undefined)
    return !dotClasses.includes(RUN_STATE_WORD);
  return dotClasses.split(" ").includes(stateClass);
}

export function isOutcomeRight(popup: PopupFacts, dotClasses: string, outcome: OutcomeCase): boolean {
  const isBlockRight = isTerminalBlockRight(popup, outcome.termClass);
  const isDotRight = isStateClassRight(dotClasses, outcome.stateClass);
  return isBlockRight && isDotRight && isNoteRight(popup.noteTexts, outcome.note);
}

export function isEventColoursSame(nodes: NodeFacts[], titles: TitleColours): boolean {
  const mismatch = findNodeFacts(nodes, MISMATCH_ID);
  const verified = findNodeFacts(nodes, VERIFIED_ID);
  const failed = findNodeFacts(nodes, ORIGINAL_FAILED_ID);
  const isMismatchSame = mismatch?.borderColor === titles.mismatch;
  const isVerifiedSame = verified?.outlineColor === titles.verified;
  const isFailedSame = failed?.outlineColor === titles.originalFailed;
  return isMismatchSame && isVerifiedSame && isFailedSame;
}

export function isPopupClearOfDrawer(popup: PopupFacts): boolean {
  const popupRight = popup.popupRect[2] ?? Infinity;
  const drawerLeft = popup.drawerRect[0] ?? 0;
  return popup.insideStagewrap && popup.overlapsTimelines && popupRight <= drawerLeft;
}

export function countOutputLines(text: string): number {
  return [...text.matchAll(STEP_LINE)].length;
}

export function isOutputStreaming(earlyText: string, laterText: string): boolean {
  const earlyCount = countOutputLines(earlyText);
  const laterCount = countOutputLines(laterText);
  return earlyCount < laterCount && laterCount < SLOW_LINE_TOTAL;
}

export function isOutputStopped(cancelledText: string, laterText: string): boolean {
  return cancelledText === laterText && countOutputLines(laterText) < SLOW_LINE_TOTAL;
}

export function listNewResources(before: string[], after: string[]): string[] {
  return after.slice(before.length);
}

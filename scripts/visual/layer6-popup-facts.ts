// Pure judges that check PopupFacts from the Layer 6 run console popup.

import { findNodeFacts } from "./layer6-node-facts.ts";
import { MISMATCH_ID, ORIGINAL_FAILED_ID, VERIFIED_ID, type NodeFacts, type PopupFacts } from "./layer6-probes.ts";

const TERMINAL_CLASSES = ["term-cancelled", "term-verified", "term-mismatch", "term-original-failed"];

export interface TitleColours { mismatch: string; verified: string; originalFailed: string }

export function isPopupShown(popup: PopupFacts): boolean {
  const hasSize = popup.width > 0 && popup.height > 0;
  return !popup.hidden && hasSize && !popup.insideDrawer && popup.drawerOpen;
}

export function isPopupContentRight(popup: PopupFacts): boolean {
  const hasPre = popup.preCount === 1 && popup.preWhiteSpace === "pre";
  const hasCaption = popup.captionCount === 1 && popup.captionStyle === "italic";
  return hasPre && hasCaption && popup.stateCaptionCount === 1;
}

export function isCancelButtonsRight(popup: PopupFacts, mismatchBorderColor: string | undefined): boolean {
  const hasStates = popup.idleDisabled && !popup.liveDisabled && popup.cancelledDisabled;
  const hasColour = popup.liveBorderColor === mismatchBorderColor;
  const isStruck = popup.cancelledDecoration.includes("line-through");
  return popup.cancelButtons === 3 && hasStates && hasColour && isStruck;
}

export function isTerminalBlocksRight(popup: PopupFacts): boolean {
  const isOrdered = JSON.stringify(popup.terminalClasses) === JSON.stringify(TERMINAL_CLASSES);
  const colourCount = new Set(popup.terminalColours).size;
  return isOrdered && colourCount === TERMINAL_CLASSES.length;
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

export function listNewResources(before: string[], after: string[]): string[] {
  return after.slice(before.length);
}

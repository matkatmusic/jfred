// L9 redesign: letter dots, session lines, and the dot hover popup text.

import { createElement } from "./app-dom.ts";
import { buildPairBracket } from "./layer1-annotation-bracket.ts";
import { ANNOTATION_LOOKS } from "./layer1-annotation-looks.ts";
import type { PairSpan, Placement } from "./layer1-annotation-window.ts";
import type { HoverPopupContent } from "./layer1-hover-popup.ts";
import type { WireAnnotation } from "./layer1-wire-annotations.ts";

// Where one session sits: its lane offset in px and its color.
export interface SessionLook {
  laneX: number;
  color: string;
}

export const STAMPLESS_NOTE = "(no timestamp: placed at the previous record)";

function listFlagClasses(placement: Placement): string[] {
  const flags: string[] = [];
  if (placement.annotation.isIgnored) {
    flags.push("is-ignored");
  }
  if (placement.annotation.isStampless) {
    flags.push("is-stampless");
  }
  return flags;
}

function setLookProperties(element: HTMLElement, look: SessionLook): void {
  element.style.setProperty("--lane-x", `${look.laneX}px`);
  element.style.setProperty("--session-color", look.color);
}

function buildNodeAttributes(annotation: WireAnnotation, className: string): Record<string, string | undefined> {
  return {
    class: className,
    "data-record-id": annotation.id,
    "data-record-kind": annotation.kind,
    "data-instant": annotation.instant,
    "data-pair-id": annotation.pairId,
    "data-session-id": annotation.sessionId,
    "data-session-title": annotation.sessionTitle,
    "data-record-label": annotation.label,
    "data-session-file": annotation.sessionFile,
    "data-line": String(annotation.line),
    text: ANNOTATION_LOOKS[annotation.kind].dotLetter,
  };
}

export function buildNode(placement: Placement, look: SessionLook): HTMLElement {
  const { annotation } = placement;
  const className = ["anode", ANNOTATION_LOOKS[annotation.kind].cssClass, ...listFlagClasses(placement)].join(" ");
  const node = createElement("i", buildNodeAttributes(annotation, className));
  node.style.setProperty("--axis-px", String(placement.axisPx));
  node.style.setProperty("--stack", String(placement.stack));
  setLookProperties(node, look);
  return node;
}

// The line runs from the session's first dot to its last dot.
export function buildSessionLine([first, last]: PairSpan, look: SessionLook): HTMLElement {
  const line = buildPairBracket(buildNode(first, look), buildNode(last, look), "sline");
  line.dataset["sessionId"] = first.annotation.sessionId;
  setLookProperties(line, look);
  return line;
}

// Same bracket as before, moved to the lane of its first dot.
export function buildPairSpanBracket([first, last]: PairSpan, look: SessionLook): HTMLElement {
  const bracket = buildPairBracket(buildNode(first, look), buildNode(last, look), "abracket");
  bracket.dataset["pairId"] = first.annotation.pairId!;
  bracket.style.setProperty("--lane-x", `${look.laneX}px`);
  return bracket;
}

// Popup lines: session title, the log line text, and the stampless note when it applies.
export function readDotPopup(target: HTMLElement): HoverPopupContent | undefined {
  const dot = target.closest<HTMLElement>("i.anode");
  if (dot === null) {
    return undefined;
  }
  const lines = [dot.dataset["sessionTitle"]!, dot.dataset["recordLabel"]!];
  const isStampless = dot.classList.contains("is-stampless");
  if (isStampless) {
    lines.push(STAMPLESS_NOTE);
  }
  return { lines, backgroundColor: dot.style.getPropertyValue("--session-color") };
}

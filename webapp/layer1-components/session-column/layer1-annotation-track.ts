// Task 382: shared session column between ruler and bubbles; only records near the viewport are in the DOM.

import { createElement, getRequiredElementById } from "../../app-dom.ts";
// import { buildPairBracket } from "./layer1-annotation-bracket.ts";
// import { ANNOTATION_LOOKS } from "./layer1-annotation-looks.ts";
import { buildNode, buildPairSpanBracket, buildSessionLine, readDotPopup } from "./layer1-annotation-dots.ts";
import type { SessionLook } from "./layer1-annotation-dots.ts";
import { ANNOTATION_MARGIN_PX, listPairSpans, listSessionSpans, listWindowPlacements, computeAnnotationPlacements } from "./layer1-annotation-window.ts";
import type { PairSpan, Placement } from "./layer1-annotation-window.ts";
import { attachHoverPopup } from "../popups/layer1-hover-popup.ts";
import { renderLayer1Minimap } from "../minimap/layer1-minimap.ts";
import { removeRulerDisplay, renderRulerDisplay } from "../ruler/layer1-ruler-display.ts";
import { removeRulerHead, renderRulerHead } from "../ruler/layer1-ruler-head.ts";
import { listSelectedSessions } from "../jsonls-nav/layer1-sessions.ts";
import { listSessionColors } from "./layer1-session-colors.ts";
import { computeBarReservePx, computeLaneX, computeSessionLanes, computeTrackWidthPx } from "./layer1-session-lanes.ts";
import type { SessionSpan } from "./layer1-session-lanes.ts";
import type { WireAnnotation } from "./layer1-wire-annotations.ts";
import type { WireLayer1View, WireRulerTick } from "../../layer1-wire.ts";

const TRACK_ID = "annotation-track";

// Module state because a filter redraw hands the stage a view that no longer carries the field.
let annotations: WireAnnotation[] = [];
let colors = new Map<string, string>();
let placements: Placement[] = [];
let pairSpans: PairSpan[] = [];
let sessionSpans: PairSpan[] = [];
let looksBySession = new Map<string, SessionLook>();
let lastTicks: readonly WireRulerTick[] = [];
let isSessionShown = false;

export function storeAnnotations(view: Pick<WireLayer1View, "annotations">): void {
  annotations = view.annotations ?? [];
  colors = listSessionColors(annotations);
}

export function isSessionColumnShown(): boolean {
  return isSessionShown;
}

export function toggleSessionColumn(): void {
  isSessionShown = !isSessionShown;
  renderAnnotationTrack(lastTicks);
  renderLayer1Minimap();
}

// function buildTitle(annotation: WireAnnotation): string {
//   const title = `${annotation.kind}: ${annotation.label}`;
//   if (annotation.isStampless) {
//     return `${title} (no timestamp: placed at the previous record)`;
//   }
//   return title;
// }

// function buildRecordElement(tag: string, className: string, placement: Placement, text?: string): HTMLElement {
//   ... moved to layer1-annotation-dots.ts (buildNode); the dot has no title now, the popup replaces it.
// }

// function buildLabel(placement: Placement): HTMLElement {
//   const { annotation } = placement;
//   return buildRecordElement("span", "alabel", placement, `${ANNOTATION_LOOKS[annotation.kind].letter} ${annotation.label}`);
// }

// CSS `zoom` shrinks scroll offsets, so divide the viewport back into axis pixels; unset zoom means 1.
function readCanvasZoom(): number {
  const rawZoom = document.querySelector<HTMLElement>(".viz-root")!.style.getPropertyValue("--zoom");
  if (rawZoom === "") {
    return 1;
  }
  return Number(rawZoom);
}

function listOverlappingSpans(spans: readonly PairSpan[], topPx: number, bottomPx: number): PairSpan[] {
  const overlapping: PairSpan[] = [];
  for (const span of spans) {
    const isBelowTop = span[1].axisPx >= topPx;
    const isAboveBottom = span[0].axisPx <= bottomPx;
    const isOverlapping = isBelowTop && isAboveBottom;
    if (isOverlapping) {
      overlapping.push(span);
    }
  }
  return overlapping;
}

function readLook(placement: Placement): SessionLook {
  return looksBySession.get(placement.annotation.sessionId)!;
}

function listWindowLines(topPx: number, bottomPx: number): HTMLElement[] {
  const lines: HTMLElement[] = [];
  for (const span of listOverlappingSpans(sessionSpans, topPx, bottomPx)) {
    lines.push(buildSessionLine(span, readLook(span[0])));
  }
  for (const span of listOverlappingSpans(pairSpans, topPx, bottomPx)) {
    lines.push(buildPairSpanBracket(span, readLook(span[0])));
  }
  return lines;
}

function listWindowElements(topPx: number, bottomPx: number): HTMLElement[] {
  const elements: HTMLElement[] = [];
  for (const placement of listWindowPlacements(placements, topPx, bottomPx)) {
    // elements.push(buildNode(placement), buildLabel(placement));
    elements.push(buildNode(placement, readLook(placement)));
  }
  return [...listWindowLines(topPx, bottomPx), ...elements];
}

// Also the scroll handler: a named function, so adding it again is a DOM no-op.
export function renderAnnotationWindow(): void {
  const pane = getRequiredElementById("timelines");
  const zoom = readCanvasZoom();
  const topPx = pane.scrollTop / zoom - ANNOTATION_MARGIN_PX;
  const bottomPx = (pane.scrollTop + pane.clientHeight) / zoom + ANNOTATION_MARGIN_PX;
  // const title = createElement("div", { class: "atitle", text: "session" });
  const head = createElement("div", { class: "ahead" });
  getRequiredElementById(TRACK_ID).replaceChildren(head, ...listWindowElements(topPx, bottomPx));
}

function buildTrackOnce(): void {
  const existingTrack = document.getElementById(TRACK_ID);
  if (existingTrack !== null) {
    return;
  }
  const track = createElement("div", { id: TRACK_ID, class: "atrack" });
  getRequiredElementById("ruler").after(track);
  attachHoverPopup(track, readDotPopup);
  getRequiredElementById("timelines").addEventListener("scroll", renderAnnotationWindow);
}

function removeTrack(): void {
  const track = document.getElementById(TRACK_ID);
  if (track === null) {
    return;
  }
  track.remove();
  getRequiredElementById("timelines").removeEventListener("scroll", renderAnnotationWindow);
}

function setTrackWidthPx(widthPx: number): void {
  getRequiredElementById("stagewrap").style.setProperty("--track-w", `${widthPx}px`);
}

function listSessionSpanPixels(spans: readonly PairSpan[]): SessionSpan[] {
  const pixels: SessionSpan[] = [];
  for (const [first, last] of spans) {
    pixels.push({ firstPx: first.axisPx, lastPx: last.axisPx });
  }
  return pixels;
}

// Fills looksBySession and returns the track width for the packed lanes.
function setSessionLooks(spans: readonly PairSpan[]): number {
  const lanes = computeSessionLanes(listSessionSpanPixels(spans));
  const reservePx = computeBarReservePx(listSelectedSessions().length);
  looksBySession = new Map<string, SessionLook>();
  for (const [index, span] of spans.entries()) {
    const sessionId = span[0].annotation.sessionId;
    looksBySession.set(sessionId, { laneX: computeLaneX(lanes[index]!, reservePx), color: colors.get(sessionId)! });
  }
  return computeTrackWidthPx(Math.max(...lanes) + 1, reservePx);
}

function renderSessionColumn(): void {
  if (!isSessionShown) {
    removeTrack();
    setTrackWidthPx(0);
    return;
  }
  setTrackWidthPx(setSessionLooks(sessionSpans));
  buildTrackOnce();
  renderAnnotationWindow();
}

// Gate A: no annotations (real data) leaves no head, no row display, no track and no width.
function removeSessionUi(): void {
  removeTrack();
  removeRulerHead();
  removeRulerDisplay();
  setTrackWidthPx(0);
}

function renderSessionControls(): void {
  renderRulerDisplay(annotations, colors, isSessionShown);
  renderRulerHead(isSessionShown, toggleSessionColumn);
  renderSessionColumn();
}

export function renderAnnotationTrack(ticks: readonly WireRulerTick[]): void {
  if (annotations.length === 0) {
    removeSessionUi();
    return;
  }
  if (ticks.length === 0) {
    return;
  }
  lastTicks = ticks;
  placements = computeAnnotationPlacements(annotations, ticks);
  pairSpans = listPairSpans(placements);
  sessionSpans = listSessionSpans(placements);
  renderSessionControls();
}

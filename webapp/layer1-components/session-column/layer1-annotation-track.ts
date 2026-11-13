// Task 382: shared session column between ruler and bubbles; only records near the viewport are in the DOM.

import { createElement, getInputById, getRequiredElementById } from "../../app-dom.ts";
// import { buildPairBracket } from "./layer1-annotation-bracket.ts";
// import { ANNOTATION_LOOKS } from "./layer1-annotation-looks.ts";
import { buildNode, buildPairSpanBracket, buildSessionLine, readDotPopup } from "./layer1-annotation-dots.ts";
import type { SessionLook } from "./layer1-annotation-dots.ts";
import { ANNOTATION_MARGIN_PX, listPairSpans, listSessionPixelSpansFromPlacements, listSessionPixelSpansFromServer, listSessionSpans, listWindowPlacements, computeAnnotationPlacements } from "./layer1-annotation-window.ts";
import type { PairSpan, Placement } from "./layer1-annotation-window.ts";
import { attachHoverPopup } from "../popups/layer1-hover-popup.ts";
import { moveOpenDetailsPane } from "../details-drawer/layer1-details-pane.ts";
import { renderLayer1Minimap } from "../minimap/layer1-minimap.ts";
import { moveMiniMapToRulerEdge } from "../minimap/layer1-minimap-position.ts";
import { removeRulerDisplay, renderRulerDisplay } from "../ruler/layer1-ruler-display.ts";
import { removeRulerHead, renderRulerHead } from "../ruler/layer1-ruler-head.ts";
import { buildLaneStrip, LANE_STRIP_ID, renderLaneStrip, scrollLanesByWheel } from "./layer1-session-lane-strip.ts";
import { listSelectedSessions } from "../jsonls-nav/layer1-sessions.ts";
import { listSessionColors } from "./layer1-session-colors.ts";
import { computeBarReservePx, computeLaneX, computeSessionLanes, computeTrackWidthPx } from "./layer1-session-lanes.ts";
// import type { SessionSpan } from "./layer1-session-lanes.ts";
import type { SessionPixelSpan } from "./layer1-session-lanes.ts";
import { scheduleSessionDotsFetch, stopSessionDotsFetch } from "./layer1-session-dots-fetch.ts";
import type { SessionDotsRequest } from "./layer1-session-dots-fetch.ts";
import { computeVisibleInstantRange } from "./layer1-session-dots-viewport.ts";
import { listRulerRows } from "../ruler/layer1-ruler-rows.ts";
import { readSourcePaths } from "../top-bars/layer1-source-paths.ts";
import type { WireAnnotation, WireSessionDots, WireSessionSpan } from "./layer1-wire-annotations.ts";
import { SourceKind } from "../../layer1-wire.ts";
import type { WireLayer1View, WireRulerTick } from "../../layer1-wire.ts";

const TRACK_ID = "sessionDotLinesComponent";

// Module state because a filter redraw hands the stage a view that no longer carries the field.
let annotations: WireAnnotation[] = [];
let colors = new Map<string, string>();
let placements: Placement[] = [];
let pairSpans: PairSpan[] = [];
// let sessionSpans: PairSpan[] = [];
let sessionSpans: SessionPixelSpan[] = [];
let looksBySession = new Map<string, SessionLook>();
let lastTicks: readonly WireRulerTick[] = [];
let isSessionShown = false;
// Real mode: no annotations on the view and the page has jsonl paths.
let isRealView = false;
let loadedProject: { dir: string; jsonlFolders: string[] } = { dir: "", jsonlFolders: [] };
let serverSessionSpans: WireSessionSpan[] = [];

export function storeAnnotations(view: Pick<WireLayer1View, "annotations">): void {
  stopSessionDotsFetch();
  const jsonlFolders = [...readSourcePaths(SourceKind.jsonl)];
  const hasNoAnnotations = view.annotations === undefined;
  const hasJsonlFolders = jsonlFolders.length > 0;
  isRealView = hasNoAnnotations && hasJsonlFolders;
  loadedProject = { dir: getInputById("dir").value.trim(), jsonlFolders };
  annotations = view.annotations ?? [];
  serverSessionSpans = [];
  colors = listSessionColors(annotations);
}

export function isSessionColumnShown(): boolean {
  return isSessionShown;
}

export function toggleSessionDotLines(): void {
  isSessionShown = !isSessionShown;
  renderAnnotationTrack(lastTicks);
  renderLayer1Minimap();
  moveOpenDetailsPane();
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
  const rawZoom = document.querySelector<HTMLElement>(".appWindow")!.style.getPropertyValue("--zoom");
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

function listOverlappingSessionSpans(spans: readonly SessionPixelSpan[], topPx: number, bottomPx: number): SessionPixelSpan[] {
  const overlapping: SessionPixelSpan[] = [];
  for (const span of spans) {
    const isBelowTop = span.lastPx >= topPx;
    const isAboveBottom = span.firstPx <= bottomPx;
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
  for (const span of listOverlappingSessionSpans(sessionSpans, topPx, bottomPx)) {
    lines.push(buildSessionLine(span, looksBySession.get(span.sessionId)!));
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

function readWindowBoundsPx(): { topPx: number; bottomPx: number } {
  const pane = getRequiredElementById("timelineContainer");
  const zoom = readCanvasZoom();
  const topPx = pane.scrollTop / zoom - ANNOTATION_MARGIN_PX;
  const bottomPx = (pane.scrollTop + pane.clientHeight) / zoom + ANNOTATION_MARGIN_PX;
  return { topPx, bottomPx };
}

function readSessionDotsRequest(): SessionDotsRequest | undefined {
  const { topPx, bottomPx } = readWindowBoundsPx();
  const range = computeVisibleInstantRange(listRulerRows([...lastTicks]), topPx, bottomPx);
  if (range === undefined) {
    return undefined;
  }
  return { dir: loadedProject.dir, jsonlFolders: loadedProject.jsonlFolders, range };
}

// Also the scroll handler for real mode: a named function, so adding it again is a DOM no-op.
function scheduleRealSessionDots(): void {
  if (!isRealView) {
    return;
  }
  if (!isSessionShown) {
    return;
  }
  scheduleSessionDotsFetch(readSessionDotsRequest, applySessionDots);
}

// An answer stores and redraws; it never asks again.
function applySessionDots(dots: WireSessionDots): void {
  annotations = dots.annotations;
  serverSessionSpans = dots.sessionSpans;
  colors = listSessionColors(dots.sessionSpans);
  placeSessionDots(lastTicks);
  renderSessionColumn();
  moveMiniMapToRulerEdge();
  moveOpenDetailsPane();
}

// The lane strip stays in place so its sideways scroll survives a redraw.
function clearWindowElements(track: HTMLElement): void {
  for (const child of [...track.children]) {
    const isStrip = child.id === LANE_STRIP_ID;
    if (!isStrip) {
      child.remove();
    }
  }
}

// Also the scroll handler: a named function, so adding it again is a DOM no-op.
export function renderAnnotationWindow(): void {
  const { topPx, bottomPx } = readWindowBoundsPx();
  // const title = createElement("div", { class: "atitle", text: "session" });
  const head = createElement("div", { class: "ahead" });
  const track = getRequiredElementById(TRACK_ID);
  clearWindowElements(track);
  track.prepend(head, ...listWindowElements(topPx, bottomPx));
  // getRequiredElementById(TRACK_ID).replaceChildren(head, ...listWindowElements(topPx, bottomPx));
}

function buildTrackOnce(): void {
  const existingTrack = document.getElementById(TRACK_ID);
  if (existingTrack !== null) {
    return;
  }
  const track = createElement("div", { id: TRACK_ID, class: "sessionDotLinesComponent", "data-component": "sessionDotLinesComponent" });
  // getRequiredElementById("timelineRulerComponent").after(track);
  const strip = document.getElementById("jfredCommitsDrawerComponent");
  if (strip !== null) {
    strip.before(track);
  } else {
    getRequiredElementById("timelineRulerContainer").append(track);
  }
  attachHoverPopup(track, readDotPopup);
  track.append(buildLaneStrip());
  track.addEventListener("wheel", scrollLanesByWheel, { passive: false });
  getRequiredElementById("timelineContainer").addEventListener("scroll", renderAnnotationWindow);
  getRequiredElementById("timelineContainer").addEventListener("scroll", scheduleRealSessionDots);
}

function removeTrack(): void {
  const track = document.getElementById(TRACK_ID);
  if (track === null) {
    return;
  }
  track.remove();
  getRequiredElementById("timelineContainer").removeEventListener("scroll", renderAnnotationWindow);
  getRequiredElementById("timelineContainer").removeEventListener("scroll", scheduleRealSessionDots);
}

function setTrackWidthPx(widthPx: number): void {
  getRequiredElementById("sessionDataContainer").style.setProperty("--track-w", `${widthPx}px`);
}

// function listSessionSpanPixels(spans: readonly PairSpan[]): SessionSpan[] {
//   const pixels: SessionSpan[] = [];
//   for (const [first, last] of spans) {
//     pixels.push({ firstPx: first.axisPx, lastPx: last.axisPx });
//   }
//   return pixels;
// }

// Fills looksBySession and returns the track width for the packed lanes.
function setSessionLooks(spans: readonly SessionPixelSpan[]): number {
  const lanes = computeSessionLanes(spans);
  const reservePx = computeBarReservePx(listSelectedSessions().length);
  looksBySession = new Map<string, SessionLook>();
  for (const [index, span] of spans.entries()) {
    looksBySession.set(span.sessionId, { laneX: computeLaneX(lanes[index]!, reservePx), color: colors.get(span.sessionId)! });
  }
  return computeTrackWidthPx(Math.max(0, ...lanes) + 1, reservePx);
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
  renderLaneStrip();
}

// Gate A: no annotations (real data) leaves no head, no row display, no track and no width.
function removeSessionUi(): void {
  removeTrack();
  removeRulerHead();
  removeRulerDisplay();
  getRequiredElementById("session-toggle").hidden = true;
  setTrackWidthPx(0);
}

function renderRulerParts(): void {
  if (isRealView) {
    removeRulerHead();
    removeRulerDisplay();
    return;
  }
  renderRulerDisplay(annotations, colors, isSessionShown);
  // renderRulerHead(isSessionShown, toggleSessionColumn);
  renderRulerHead();
}

function renderSessionControls(): void {
  renderRulerParts();
  const sessionToggleButton = getRequiredElementById("session-toggle");
  sessionToggleButton.hidden = false;
  sessionToggleButton.classList.toggle("current", isSessionShown);
  sessionToggleButton.onclick = () => {
    toggleSessionDotLines();
    moveMiniMapToRulerEdge();
  };
  renderSessionColumn();
}

function placeSessionDots(ticks: readonly WireRulerTick[]): void {
  placements = computeAnnotationPlacements(annotations, ticks);
  pairSpans = listPairSpans(placements);
  sessionSpans = isRealView ? listSessionPixelSpansFromServer(serverSessionSpans, ticks) : listSessionPixelSpansFromPlacements(listSessionSpans(placements));
}

export function renderAnnotationTrack(ticks: readonly WireRulerTick[]): void {
  if (annotations.length === 0) {
    if (!isRealView) {
      removeSessionUi();
      return;
    }
  }
  if (ticks.length === 0) {
    return;
  }
  lastTicks = ticks;
  placeSessionDots(ticks);
  renderSessionControls();
  scheduleRealSessionDots();
}

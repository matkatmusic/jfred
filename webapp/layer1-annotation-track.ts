// Task 382: shared session column between ruler and bubbles; only records near the viewport are in the DOM.

import { createElement, getRequiredElementById } from "./app-dom.ts";
import { buildPairBracket } from "./layer1-annotation-bracket.ts";
import { ANNOTATION_LOOKS } from "./layer1-annotation-looks.ts";
import { ANNOTATION_MARGIN_PX, listPairSpans, listWindowPlacements, placeAnnotations } from "./layer1-annotation-window.ts";
import type { PairSpan, Placement } from "./layer1-annotation-window.ts";
import type { WireAnnotation } from "./layer1-wire-annotations.ts";
import type { WireLayer1View, WireRulerTick } from "./layer1-wire.ts";

const TRACK_ID = "annotation-track";

// Module state because a filter redraw hands the stage a view that no longer carries the field.
let annotations: WireAnnotation[] = [];
let placements: Placement[] = [];
let pairSpans: PairSpan[] = [];

export function rememberAnnotations(view: Pick<WireLayer1View, "annotations">): void {
  annotations = view.annotations ?? [];
}

function buildTitle(annotation: WireAnnotation): string {
  const title = `${annotation.kind}: ${annotation.label}`;
  if (annotation.isStampless) {
    return `${title} (no timestamp: placed at the previous record)`;
  }
  return title;
}

function listFlagClasses(annotation: WireAnnotation): string[] {
  const flags: string[] = [];
  if (annotation.isIgnored) {
    flags.push("is-ignored");
  }
  if (annotation.isStampless) {
    flags.push("is-stampless");
  }
  return flags;
}

function buildRecordElement(tag: string, className: string, placement: Placement, text?: string): HTMLElement {
  const { annotation } = placement;
  const element = createElement(tag, {
    class: [className, ...listFlagClasses(annotation)].join(" "),
    "data-record-id": annotation.id,
    "data-record-kind": annotation.kind,
    "data-instant": annotation.instant,
    "data-pair-id": annotation.pairId,
    title: buildTitle(annotation),
    text,
  });
  element.style.setProperty("--axis-px", String(placement.axisPx));
  element.style.setProperty("--stack", String(placement.stack));
  return element;
}

function buildNode(placement: Placement): HTMLElement {
  return buildRecordElement("i", `anode ${ANNOTATION_LOOKS[placement.annotation.kind].cssClass}`, placement);
}

function buildLabel(placement: Placement): HTMLElement {
  const { annotation } = placement;
  return buildRecordElement("span", "alabel", placement, `${ANNOTATION_LOOKS[annotation.kind].letter} ${annotation.label}`);
}

function buildSpanBracket([first, last]: PairSpan): HTMLElement {
  const bracket = buildPairBracket(buildNode(first), buildNode(last), "abracket");
  bracket.dataset["pairId"] = first.annotation.pairId!;
  return bracket;
}

// CSS `zoom` shrinks scroll offsets, so divide the viewport back into axis pixels; unset zoom means 1.
function readCanvasZoom(): number {
  const rawZoom = document.querySelector<HTMLElement>(".viz-root")!.style.getPropertyValue("--zoom");
  if (rawZoom === "") {
    return 1;
  }
  return Number(rawZoom);
}

function listWindowBrackets(topPx: number, bottomPx: number): HTMLElement[] {
  const brackets: HTMLElement[] = [];
  for (const span of pairSpans) {
    const isBelowTop = span[1].axisPx >= topPx;
    const isAboveBottom = span[0].axisPx <= bottomPx;
    const isOverlapping = isBelowTop && isAboveBottom;
    if (isOverlapping) {
      brackets.push(buildSpanBracket(span));
    }
  }
  return brackets;
}

function listWindowElements(topPx: number, bottomPx: number): HTMLElement[] {
  const elements: HTMLElement[] = [];
  for (const placement of listWindowPlacements(placements, topPx, bottomPx)) {
    elements.push(buildNode(placement), buildLabel(placement));
  }
  return [...elements, ...listWindowBrackets(topPx, bottomPx)];
}

// Also the scroll handler: a named function, so adding it again is a DOM no-op.
export function drawAnnotationWindow(): void {
  const pane = getRequiredElementById("timelines");
  const zoom = readCanvasZoom();
  const topPx = pane.scrollTop / zoom - ANNOTATION_MARGIN_PX;
  const bottomPx = (pane.scrollTop + pane.clientHeight) / zoom + ANNOTATION_MARGIN_PX;
  const title = createElement("div", { class: "atitle", text: "session" });
  getRequiredElementById(TRACK_ID).replaceChildren(title, ...listWindowElements(topPx, bottomPx));
}

function buildTrackOnce(): void {
  if (document.getElementById(TRACK_ID) !== null) {
    return;
  }
  getRequiredElementById("ruler").after(createElement("div", { id: TRACK_ID, class: "atrack" }));
  getRequiredElementById("timelines").addEventListener("scroll", drawAnnotationWindow);
}

function removeTrack(): void {
  const track = document.getElementById(TRACK_ID);
  if (track === null) {
    return;
  }
  track.remove();
  getRequiredElementById("timelines").removeEventListener("scroll", drawAnnotationWindow);
}

// No annotations (real data) builds nothing and adds no listener.
export function renderAnnotationTrack(ticks: readonly WireRulerTick[]): void {
  if (annotations.length === 0) {
    removeTrack();
    return;
  }
  if (ticks.length === 0) {
    return;
  }
  placements = placeAnnotations(annotations, ticks);
  pairSpans = listPairSpans(placements);
  buildTrackOnce();
  drawAnnotationWindow();
}

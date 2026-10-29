// The Files pane's coverage strip and its click-for-reason popover.

import { createElement } from "../app-dom.ts";
import type { CoverageSegment } from "./reconstruction-coverage.ts";

// The open coverage popover and its segment; a document click closes it.
let openCoveragePopover: { segment: HTMLElement; popover: HTMLElement } | undefined;

function hideCoveragePopover(): void {
  openCoveragePopover?.popover.remove();
  openCoveragePopover = undefined;
}
// Guarded because the node test suite imports this module without a DOM.
if (typeof document !== "undefined") {
  document.addEventListener("click", hideCoveragePopover);
}

// The strip on a partly-recovered file row: one segment per revision, plus a recovered count.
export function appendCoverageStrip(item: HTMLElement, target: string, segments: CoverageSegment[]): void {
  const segmentCells: HTMLElement[] = [];
  let recovered = 0;
  for (const segment of segments) {
    segmentCells.push(buildCoverageSegmentElement(item, target, segment));
    if (segment.recovered) {
      recovered++;
    }
  }
  item.append(createElement("span", { class: "covbar" }, segmentCells));
  item.append(createElement("span", { class: "revcount", text: `${recovered} / ${segments.length} revs` }));
}

// One strip segment; a red one toggles the reason popover. stopPropagation keeps the row unselected.
function buildCoverageSegmentElement(item: HTMLElement, target: string, segment: CoverageSegment): HTMLElement {
  const cell = createElement("span", { class: segment.recovered ? "" : "miss" });
  if (!segment.recovered) {
    function toggleSegmentReasonPopover(event: Event): void {
      event.stopPropagation();
      toggleCoveragePopover(cell, item, target, segment);
    }
    cell.addEventListener("click", toggleSegmentReasonPopover);
  }
  return cell;
}

function stopEventPropagation(event: Event): void {
  event.stopPropagation();
}

// Show the reason popover under the file row, or hide it when its own segment is re-clicked.
function toggleCoveragePopover(cell: HTMLElement, item: HTMLElement, target: string, segment: CoverageSegment): void {
  const wasOpen = openCoveragePopover?.segment === cell;
  hideCoveragePopover();
  if (wasOpen) {
    return;
  }
  const popover = createElement("div", { class: "popover cov-popover" }, [
    createElement("div", { text: `${target} — rev ${segment.revisionIndex + 1} ✗ unrecoverable` }),
    createElement("div", { class: "muted", text: `reason: ${segment.reason ?? "unknown"}` }),
  ]);
  popover.addEventListener("click", stopEventPropagation);
  item.after(popover);
  openCoveragePopover = { segment: cell, popover };
}

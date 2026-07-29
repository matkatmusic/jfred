// task 119: the Files pane's coverage strip and its click-for-reason popover. Split out of views/sidebar.ts (task 253 — the 250-line cap; split, never condense), which now holds only the sessions/files trees themselves. Nothing here is shared with the details pane's "Files touched" tree: that one passes no coverage and renders plain revision counts.

import { el } from "../app-dom.ts";
import type { CoverageSegment } from "./reconstruction-coverage.ts";

// The one open coverage popover and the segment that opened it (clicking that segment again closes it). One document-level click closes it from anywhere, the toolbar popovers' pattern (app-header.ts) — in-popover and segment clicks stopPropagation to stay open.
let openCoveragePopover: { segment: HTMLElement; popover: HTMLElement } | undefined;

function hideCoveragePopover(): void {
    openCoveragePopover?.popover.remove();
    openCoveragePopover = undefined;
}
// Guarded like app.ts's bootstrap: the node test suite imports this module without a DOM.
if (typeof document !== "undefined") {
    document.addEventListener("click", hideCoveragePopover);
}

// The strip on a partially-recovered file's row: one segment per revision (red = unrecoverable, click for the reason popover) and "<recovered> / <total> revs" in place of the plain count.
export function appendCoverageStrip(item: HTMLElement, target: string, segments: CoverageSegment[]): void {
    item.append(el("span", { class: "covbar" },
        segments.map((segment) => buildCoverageSegmentElement(item, target, segment))));
    const recovered = segments.filter((segment) => segment.recovered).length;
    item.append(el("span", { class: "revcount", text: `${recovered} / ${segments.length} revs` }));
}

// One strip segment; a red (unrecovered) one toggles the reason popover under the row. The stopPropagation keeps the click from also selecting the file row (and from the document-level closer instantly hiding the popover it just opened).
function buildCoverageSegmentElement(item: HTMLElement, target: string, segment: CoverageSegment): HTMLElement {
    const cell = el("span", { class: segment.recovered ? "" : "miss" });
    if (!segment.recovered) {
        cell.addEventListener("click", (event) => {
            event.stopPropagation();
            toggleCoveragePopover(cell, item, target, segment);
        });
    }
    return cell;
}

// Show (or hide, when its own segment is re-clicked) the reason popover, inserted into the flow right under the segment's file row.
function toggleCoveragePopover(cell: HTMLElement, item: HTMLElement, target: string, segment: CoverageSegment): void {
    const wasOpen = openCoveragePopover?.segment === cell;
    hideCoveragePopover();
    if (wasOpen) {
        return;
    }
    const popover = el("div", { class: "popover cov-popover" }, [
        el("div", { text: `${target} — rev ${segment.revisionIndex + 1} ✗ unrecoverable` }),
        el("div", { class: "muted", text: `reason: ${segment.reason ?? "unknown"}` }),
    ]);
    popover.addEventListener("click", (event) => event.stopPropagation());
    item.after(popover);
    openCoveragePopover = { segment: cell, popover };
}

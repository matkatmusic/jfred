// Task 284: a gutter row that several events share EXPANDS into the files touched at that instant, instead of silently jumping to whichever one the lookup happened to find first. The user, on the mockup (2026-07-26): the row lists the names, and clicking a name is what jumps — so the reader picks the file rather than the page guessing for them. The row stays open while they walk it.
//
// A printed row is not one instant. layer1-ruler-rows.ts merges entries that print the same label or would overprint (247 of 683 entries in this repo), so the row carries the offsets of every entry it absorbed and the list is built over ALL of them — a per-instant list would show only the surviving entry's own events and disagree with the "(n)" printed beside it.
//
// ponytail: the open list is NOT given room of its own. The mockup feeds its height back into the layout so every row and bubble below shifts down (mockup 663-677); here the offsets are resolved server-side, so doing that means re-running relayOutLayer1View and re-rendering ~800 bubbles on every expand and every close. CEILING: while a row is open its list paints over the two or three timestamps below it in the gutter (it is absolutely positioned inside the opaque, z-index 8 `.ruler`, so it never covers the canvas), and a re-click or Escape restores them. UPGRADE PATH: layOutNodeLadders in webapp/layer1-ruler-axis.ts gains an extra-pixels-per-instant map, threaded through relayOutLayer1View in webapp/layer1-filter.ts, and the page re-lays-out on expand.

import { el } from "./app-dom.ts";
import { highlightLandedElement } from "./layer1-find-file.ts";
import { listElementsDrawnAtAxisPx } from "./layer1-ruler-click.ts";

// One thing DRAWN at a row's instants: which file it belongs to, what that file's row calls itself, and the element itself — clicking a name then needs no second lookup, and cannot land on a different element than the one that was counted.
export interface TickEvent {
    path: string;
    kind: string;
    element: HTMLElement;
}

// The ONE open row. Module scope, like layer1-find-file.ts's cycle position: only one row is ever open, and the page has no other place to keep that. A row is never open across a re-render — markMultiEventTicks clears it, because the ticks it pointed at have just been replaced.
let expandedTick: HTMLElement | undefined;

// The offsets each wired tick stands for. A WeakMap rather than a data- attribute so the numbers never go through a string and back, and so a replaced tick takes its entry with it.
const rowOffsetsByTick = new WeakMap<HTMLElement, number[]>();

// Remember what a tick absorbed, at the moment layer1-ruler-click.ts wires it. Kept here, beside the only reader, so the two cannot disagree about the shape of what was stored.
export function rememberRowOffsets(tick: HTMLElement, axisPxList: number[]): void {
    rowOffsetsByTick.set(tick, axisPxList);
}

// The file a drawn element belongs to. `.fname`'s `data-path` is the bubble's identity (task 280 — the find box and the File Nav's exact-path jump read the same attribute).
function readOwningPath(element: HTMLElement): string {
    return element.closest(".filebox")?.querySelector<HTMLElement>(".fname")?.dataset.path ?? "";
}

// What one drawn element contributes to the list.
function describeDrawnElement(element: HTMLElement): TickEvent {
    // An orphan's row IS its path — buildOrphanBucket writes it into the row's first `span`, and the bucket's own `.fname` is a heading ("No on-disk match"), not a file. Its kind is empty: the bucket the name jumps to is what says which direction the orphan is, and the user rejected seeing that title listed as though it were a property of the file (mockup 899-903).
    if (element.matches("li")) {
        return { path: element.querySelector("span")?.textContent ?? "", kind: "", element };
    }
    // A `.node`'s label is the `.nlabel` beside it; the bare `.filebox` safety net has none, so it's path-only.
    const label = element.matches(".node") ? element.nextElementSibling?.textContent : undefined;
    return { path: readOwningPath(element), kind: label ?? "", element };
}

// Everything drawn at the instants ONE printed row stands for, in the order the lookup found it.
export function listEventsAtRow(axisPxList: number[]): TickEvent[] {
    const events: TickEvent[] = [];
    // De-duped on the ELEMENT: a merged row can absorb two entries at the same offset, else one element lists twice.
    const seen = new Set<HTMLElement>();
    for (const axisPx of axisPxList) {
        for (const element of listElementsDrawnAtAxisPx(axisPx)) {
            if (seen.has(element)) {
                continue;
            }
            seen.add(element);
            events.push(describeDrawnElement(element));
        }
    }
    return events;
}

// The name the button prints. The same expression layer1-page.ts inlines for a bubble's label; there is no shared basename helper in webapp/ to reuse.
function readBasename(path: string): string {
    return path.split("/").pop() ?? path;
}

// `title` carries the full path since the 300px button can't; `stopPropagation` stops the click from closing the row.
function buildTickFileButton(event: TickEvent): HTMLElement {
    return el("button", {
        text: `${readBasename(event.path)}  ${event.kind}`.trimEnd(),
        title: event.path,
        onclick: (clickEvent: Event) => {
            clickEvent.stopPropagation();
            // The same jump a single-event tick makes (layer1-ruler-click.ts): "nearest" because the clicked row is already on screen, "center" because the stage is ~168,000 px wide.
            event.element.scrollIntoView({ block: "nearest", inline: "center" });
            highlightLandedElement(event.element);
        },
    });
}

// The list itself, a child of its tick so it opens directly under the timestamp inside the gutter.
export function buildTickFileList(events: TickEvent[]): HTMLElement {
    return el("div", { class: "tickfiles" }, events.map(buildTickFileButton));
}

// Shut whatever is open. Safe on a tick that a re-render has already detached.
function closeExpandedRow(): void {
    expandedTick?.classList.remove("expanded");
    expandedTick?.querySelector(".tickfiles")?.remove();
    expandedTick = undefined;
}

// Open `tick` on its file list, or shut it if it is the row already open. Closing whatever was open first is what keeps "the ONE open row" true — two lists hanging in the gutter would overprint.
export function toggleExpandedRow(tick: HTMLElement, events: TickEvent[]): void {
    const wasOpen = expandedTick === tick;
    closeExpandedRow();
    if (wasOpen) {
        return;
    }
    tick.classList.add("expanded");
    tick.appendChild(buildTickFileList(events));
    expandedTick = tick;
}

// Underline the rows that would EXPAND, so the affordance never promises a list the click then refuses to open (mockup 687). Called from renderLayer1Stage AFTER the stage is in the DOM — the test is the same walk the click makes, and it can only see bubbles that have been drawn.
//
// ponytail: one walk of the stage per row. Over this repo that is ~436 rows against ~800 bubbles on each render, and it is O(rows x elements) — measurable but paid once, against a view that takes ~10 s to fetch. UPGRADE PATH if it shows: one walk collecting elements into a Map<axisPx, HTMLElement[]>, which every caller of listElementsDrawnAtAxisPx could then read.
export function markMultiEventTicks(): void {
    // The ticks were just replaced, so nothing is open any more, whatever was before.
    expandedTick = undefined;
    for (const tick of document.querySelectorAll<HTMLElement>("#ruler .tick")) {
        if (listEventsAtRow(rowOffsetsByTick.get(tick) ?? []).length > 1) {
            tick.classList.add("multi");
        }
    }
}

// Escape shuts the open row — the only page state a click cannot obviously undo. Wired once from bootLayer1Page (wireLeaderVisibility's precedent): the ticks are replaced on every render, so a per-tick listener would have to be re-attached each time.
export function wireTickExpansion(): void {
    document.addEventListener("keydown", (event) => {
        if (event.key !== "Escape") {
            return;
        }
        closeExpandedRow();
    });
}

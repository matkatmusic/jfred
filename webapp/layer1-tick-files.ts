// Task 284: a shared gutter row EXPANDS into its file names; the reader picks the file.
//
// A merged row stands for EVERY absorbed entry, so the list matches the "(n)" printed beside it.
//
// Task 300: the open list's height feeds the layout, so rows and bubbles below shift instead of being overprinted.

import { el } from "./app-dom.ts";
import type { RulerExpansion } from "./layer1-filter.ts";
import { highlightLandedElement } from "./layer1-find-file.ts";
import { flashSession } from "./layer1-sessions.ts";
import { listElementsDrawnAtAxisPx, snapshotStageBubbles, type BubbleSnapshot } from "./layer1-ruler-click.ts";
import type { RulerRow } from "./layer1-ruler-rows.ts";

// One thing DRAWN at a row's instants: owning file, its own label, and the element the click lands on.
export interface TickEvent {
    path: string;
    kind: string;
    element: HTMLElement;
    // Task 316: the owning JSONL, present only on a snapshot node, so its row can flash on click.
    session?: string;
}

// Task 300: the ONE open row (first instant + measured list height); survives its own re-render.
let expandedRow: RulerExpansion | undefined;

// Task 300: the redraw the expansion triggers, registered by layer1-page.ts so no import cycle forms.
let requestStageRelayout: () => void = () => {};

export function onExpansionRelayout(callback: () => void): void {
    requestStageRelayout = callback;
}

// What layer1-page.ts feeds the two-pass layout; undefined while no row is open.
export function readRulerExpansion(): RulerExpansion | undefined {
    return expandedRow;
}

// Filter and load redraws call this: a changed view invalidates the measured list, so the row closes.
export function closeRulerExpansion(): void {
    expandedRow = undefined;
}

// A WeakMap, not a data- attribute: no string round-trip, and a replaced tick takes its entry with it.
const rowsByTick = new WeakMap<HTMLElement, RulerRow>();

// Remember what a tick absorbed when layer1-ruler-click.ts wires it; kept beside the only reader.
export function rememberRow(tick: HTMLElement, row: RulerRow): void {
    rowsByTick.set(tick, row);
}

// The owning file: `.fname`'s `data-path` is the bubble's identity (task 280).
function readOwningPath(element: HTMLElement): string {
    return element.closest(".filebox")?.querySelector<HTMLElement>(".fname")?.dataset.path ?? "";
}

// What one drawn element contributes to the list.
function describeDrawnElement(element: HTMLElement): TickEvent {
    // An orphan's row IS its path; the bucket `.fname` is a heading, and kind stays empty (mockup 899-903).
    if (element.matches("li")) {
        return { path: element.querySelector("span")?.textContent ?? "", kind: "", element };
    }
    // A `.node`'s label is the `.nlabel` beside it; the bare `.filebox` safety net has none, so it's path-only.
    const label = element.matches(".node") ? element.nextElementSibling?.textContent : undefined;
    return { path: readOwningPath(element), kind: label ?? "", element, session: element.dataset.sessionFile };
}

// Everything drawn at the instants ONE printed row stands for, in the order the lookup found it.
export function listEventsAtRow(axisPxList: number[], snapshot: BubbleSnapshot[] = snapshotStageBubbles()): TickEvent[] {
    const events: TickEvent[] = [];
    // De-duped on the ELEMENT, else a same-offset merged row lists one element twice.
    const seen = new Set<HTMLElement>();
    for (const axisPx of axisPxList) {
        for (const element of listElementsDrawnAtAxisPx(axisPx, snapshot)) {
            if (seen.has(element)) {
                continue;
            }
            seen.add(element);
            events.push(describeDrawnElement(element));
        }
    }
    return events;
}

// The name the button prints; same inline expression layer1-page.ts uses for a bubble's label.
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
            // The same jump a single-event tick makes (layer1-ruler-click.ts): "nearest" vertically, "center" horizontally.
            event.element.scrollIntoView({ block: "nearest", inline: "center" });
            highlightLandedElement(event.element);
            if (event.session !== undefined) {
                // flashSession keys rows by basename (like the drawer), so a full path never matches.
                flashSession(event.session.split("/").pop() ?? event.session);
            }
        },
    });
}

// The list itself, a child of its tick so it opens directly under the timestamp inside the gutter.
export function buildTickFileList(events: TickEvent[]): HTMLElement {
    return el("div", { class: "tickfiles" }, events.map(buildTickFileButton));
}

// List height in axis px from a throwaway render; fallback covers layout-free DOMs.
function measureListHeightPx(tick: HTMLElement, events: TickEvent[]): number {
    const probe = tick.appendChild(buildTickFileList(events));
    const measuredPx = probe.offsetHeight;
    probe.remove();
    return measuredPx > 0 ? measuredPx : events.length * 13 + 2;
}

// Task 300: flip expansion STATE, then re-lay-out so rows below make room.
export function toggleExpandedRow(tick: HTMLElement, events: TickEvent[]): void {
    const instantMs = new Date(rowsByTick.get(tick)?.instants[0] ?? 0).getTime();
    const wasOpen = expandedRow?.instantMs === instantMs;
    expandedRow = wasOpen ? undefined : { instantMs, listHeightPx: measureListHeightPx(tick, events) };
    requestStageRelayout();
}

// After a re-render, re-open the surviving expanded row on FRESH elements; a filtered-away row just stays shut.
function reopenExpandedRow(): void {
    for (const tick of document.querySelectorAll<HTMLElement>("#ruler .tick")) {
        const row = rowsByTick.get(tick);
        if (row === undefined || expandedRow === undefined) {
            continue;
        }
        if (!row.instants.some((instant) => new Date(instant).getTime() === expandedRow!.instantMs)) {
            continue;
        }
        tick.classList.add("expanded");
        tick.appendChild(buildTickFileList(listEventsAtRow(row.axisPxList)));
        return;
    }
}

// Underline rows that would EXPAND (mockup 687); one shared snapshot (task 309) after the stage is drawn.
export function markMultiEventTicks(): void {
    const snapshot = snapshotStageBubbles();
    for (const tick of document.querySelectorAll<HTMLElement>("#ruler .tick")) {
        const events = listEventsAtRow(rowsByTick.get(tick)?.axisPxList ?? [], snapshot);
        if (events.length > 1) {
            tick.classList.add("multi");
        }
        // Task 316: a row standing ONLY for snapshots hides below Layer 2, like the nodes it lists.
        if (events.length > 0 && events.every((event) => event.element.matches(".n-snap"))) {
            tick.classList.add("n-snap");
        }
    }
    // Task 300: the expansion outlives its own re-render, so the open row is rebuilt on the fresh ticks.
    reopenExpandedRow();
}

// Escape shuts the open row; wired once from bootLayer1Page since ticks are replaced every render.
export function wireTickExpansion(): void {
    document.addEventListener("keydown", (event) => {
        if (event.key !== "Escape" || expandedRow === undefined) {
            return;
        }
        closeRulerExpansion();
        requestStageRelayout();
    });
}

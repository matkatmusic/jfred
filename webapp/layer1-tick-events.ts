// Tasks 284, 360: the events a ruler row stands for, and the file list built from them.

import { createElement } from "./app-dom.ts";
import { highlightLandedElement, scrollToUncoveredCentre } from "./layer1-find-file.ts";
import { isKindHidden } from "./layer1-kind-filter.ts";
import { classifyNodeKind } from "./layer1-node-kind.ts";
import type { ShowRowKind } from "./layer1-show-row.ts";
import { flashSession } from "./layer1-sessions.ts";
import { listElementsDrawnAtAxisPx, collectStageBubbles, type BubbleSnapshot } from "./layer1-ruler-click.ts";
import type { RulerRow } from "./layer1-ruler-rows.ts";

// One thing DRAWN at a row's instants: owning file, its own label, and the element the click lands on.
export interface TickEvent {
  path: string;
  kind: string;
  element: HTMLElement;
  // Task 360: undefined for an orphan row, which no show-row box governs.
  nodeKind: ShowRowKind | undefined;
  // Task 316: the owning JSONL, present only on a snapshot node, so its row can flash on click.
  session?: string;
}

// A WeakMap, not a data- attribute: no string round-trip, and a replaced tick takes its entry with it.
export const rowsByTick = new WeakMap<HTMLElement, RulerRow>();

// Remember what a tick absorbed when layer1-ruler-click.ts wires it; kept beside the only reader.
export function rememberRow(tick: HTMLElement, row: RulerRow): void {
  rowsByTick.set(tick, row);
}

// The owning file: `.fname`'s `data-path` is the bubble's identity (task 280).
function readOwningPath(element: HTMLElement): string {
  return element.closest(".filebox")?.querySelector<HTMLElement>(".fname")?.dataset.path ?? "";
}

// What one drawn element contributes to the list.
function readTickEvent(element: HTMLElement): TickEvent {
  // An orphan's row IS its path; the bucket `.fname` is a heading, and kind stays empty (mockup 899-903).
  const isOrphanRow = element.matches("li");
  if (isOrphanRow) {
    return { path: element.querySelector("span")?.textContent ?? "", kind: "", element, nodeKind: undefined };
  }
  // A `.node`'s label is the `.nlabel` beside it; the bare `.filebox` safety net has none, so it's path-only.
  const label = element.matches(".node") ? element.nextElementSibling?.textContent : undefined;
  return { path: readOwningPath(element), kind: label ?? "", element, nodeKind: classifyNodeKind(element), session: element.dataset.sessionFile };
}

// Every event drawn at one printed row's instants, hidden kinds included, in lookup order.
export function listAllEventsAtRow(axisPxList: number[], snapshot: BubbleSnapshot[]): TickEvent[] {
  const events: TickEvent[] = [];
  // De-duped on the ELEMENT, else a same-offset merged row lists one element twice.
  const seen = new Set<HTMLElement>();
  for (const axisPx of axisPxList) {
    for (const element of listElementsDrawnAtAxisPx(axisPx, snapshot)) {
      const isDuplicate = seen.has(element);
      if (isDuplicate) {
        continue;
      }
      seen.add(element);
      events.push(readTickEvent(element));
    }
  }
  return events;
}

// Task 360: the ruler click, open file list and reopen all read this, so they list visible kinds only.
export function listEventsAtRow(axisPxList: number[], snapshot: BubbleSnapshot[] = collectStageBubbles()): TickEvent[] {
  const visible: TickEvent[] = [];
  for (const event of listAllEventsAtRow(axisPxList, snapshot)) {
    const isVisibleKind = !isKindHidden(event.nodeKind);
    if (isVisibleKind) {
      visible.push(event);
    }
  }
  return visible;
}

// The name the button prints; same inline expression layer1-page.ts uses for a bubble's label.
function readBasename(path: string): string {
  return path.split("/").pop() ?? path;
}

// `title` carries the full path since the 300px button can't; `stopPropagation` stops the click from closing the row.
function buildTickFileButton(event: TickEvent): HTMLElement {
  return createElement("button", {
    text: `${readBasename(event.path)}  ${event.kind}`.trimEnd(),
    title: event.path,
    onclick: (clickEvent: Event) => {
      clickEvent.stopPropagation();
      // The same jump a single-event tick makes (layer1-ruler-click.ts).
      scrollToUncoveredCentre(event.element);
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
  const buttons: HTMLElement[] = [];
  for (const event of events) {
    buttons.push(buildTickFileButton(event));
  }
  return createElement("div", { class: "tickfiles" }, buttons);
}

// List height in axis px from a throwaway render; fallback covers layout-free DOMs.
export function measureListHeightPx(tick: HTMLElement, events: TickEvent[]): number {
  const probe = tick.appendChild(buildTickFileList(events));
  const measuredPx = probe.offsetHeight;
  probe.remove();
  return measuredPx > 0 ? measuredPx : events.length * 13 + 2;
}

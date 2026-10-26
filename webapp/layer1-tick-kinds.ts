// Task 360: each ruler tick shows its visible kinds as dashes and hides when every kind is hidden.

import { el } from "./app-dom.ts";
import { KIND_HIDDEN_CLASS, isKindHidden } from "./layer1-kind-filter.ts";
import { SHOW_ROW_LABELS, ShowRowKind } from "./layer1-show-row.ts";
import type { BubbleSnapshot } from "./layer1-ruler-click.ts";
import { listAllEventsAtRow, rowsByTick, type TickEvent } from "./layer1-tick-events.ts";

// One empty dash per distinct visible kind, in show-row order, right after the timestamp text so `.tickfiles` stays last.
function renderKindDashes(tick: HTMLElement, visible: TickEvent[]): void {
  tick.querySelector(".kind-dashes")?.remove();
  const dashes: HTMLElement[] = [];
  for (const kind of Object.values(ShowRowKind)) {
    let hasVisibleEventOfKind = false;
    for (const event of visible) {
      const isOfKind = event.nodeKind === kind;
      if (isOfKind) {
        hasVisibleEventOfKind = true;
        break;
      }
    }
    if (hasVisibleEventOfKind) {
      dashes.push(el("i", { class: `kdash kdash-${kind}`, title: SHOW_ROW_LABELS[kind] }));
    }
  }
  tick.insertBefore(el("span", { class: "kind-dashes" }, dashes), tick.firstChild?.nextSibling ?? null);
}

// Underline rows that would EXPAND (mockup 687); a row with only hidden kinds hides but keeps its slot.
export function markTickKindState(snapshot: BubbleSnapshot[]): void {
  for (const tick of document.querySelectorAll<HTMLElement>("#ruler .tick")) {
    const all = listAllEventsAtRow(rowsByTick.get(tick)?.axisPxList ?? [], snapshot);
    const visible: TickEvent[] = [];
    for (const event of all) {
      const isVisibleKind = !isKindHidden(event.nodeKind);
      if (isVisibleKind) {
        visible.push(event);
      }
    }
    tick.classList.toggle("multi", visible.length > 1);
    tick.classList.toggle(KIND_HIDDEN_CLASS, all.length > 0 && visible.length === 0);
    renderKindDashes(tick, visible);
    // Retired by task 360 (the hidden-kind set replaces it): if (all.length > 0 && all.every((event) => event.element.matches(".n-snap"))) { tick.classList.add("n-snap"); }
  }
}

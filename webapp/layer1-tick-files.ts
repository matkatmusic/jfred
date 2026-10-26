// Tasks 284, 300: a ruler row expands into its file names; open height feeds layout.

import type { RulerExpansion } from "./layer1-filter.ts";
import { onKindFilterChange } from "./layer1-kind-filter.ts";
import { collectStageBubbles } from "./layer1-ruler-click.ts";
import { buildTickFileList, listEventsAtRow, measureListHeightPx, rowsByTick, type TickEvent } from "./layer1-tick-events.ts";
import { markTickKindState } from "./layer1-tick-kinds.ts";

// Task 300: the ONE open row (first instant + measured list height); survives its own re-render.
let expandedRow: RulerExpansion | undefined;

// Task 300: the redraw the expansion triggers, registered by layer1-page.ts so no import cycle forms.
let triggerStageRelayout: () => void = () => {};

export function onExpansionRelayout(callback: () => void): void {
  triggerStageRelayout = callback;
}

// What layer1-page.ts feeds the two-pass layout; undefined while no row is open.
export function readRulerExpansion(): RulerExpansion | undefined {
  return expandedRow;
}

// Filter and load redraws call this: a changed view invalidates the measured list, so the row closes.
export function closeRulerExpansion(): void {
  expandedRow = undefined;
}

// Task 300: flip expansion STATE, then re-lay-out so rows below make room.
export function toggleExpandedRow(tick: HTMLElement, events: TickEvent[]): void {
  const instantMs = new Date(rowsByTick.get(tick)?.instants[0] ?? 0).getTime();
  const wasOpen = expandedRow?.instantMs === instantMs;
  expandedRow = wasOpen ? undefined : { instantMs, listHeightPx: measureListHeightPx(tick, events) };
  triggerStageRelayout();
}

// After a re-render, re-open the surviving expanded row on FRESH elements; a filtered-away row just stays shut.
function openExpandedRowAgain(): void {
  const tick = findTickAtExpandedInstant();
  if (tick === undefined) {
    return;
  }
  tick.classList.add("expanded");
  tick.querySelector(".tickfiles")?.remove();
  const events = listEventsAtRow(rowsByTick.get(tick)!.axisPxList);
  const listHeightPx = measureListHeightPx(tick, events);
  tick.appendChild(buildTickFileList(events));
  // A kind shown since measuring changes the list height, so the stage lays out again after this render.
  if (listHeightPx !== expandedRow!.listHeightPx) {
    expandedRow = { instantMs: expandedRow!.instantMs, listHeightPx };
    queueMicrotask(triggerStageRelayout);
  }
}

// A redraw replaces every tick, so the open list moves to the fresh tick and the row stays open.
export function moveOpenRowToNewTicks(openList: Element | null): void {
  const tick = findTickAtExpandedInstant();
  const hasNothingToCarry = openList === null || tick === undefined;
  if (hasNothingToCarry) {
    return;
  }
  tick.classList.add("expanded");
  tick.appendChild(openList);
}

// The tick whose row holds the open expansion's instant, if one is drawn.
function findTickAtExpandedInstant(): HTMLElement | undefined {
  if (expandedRow === undefined) {
    return undefined;
  }
  for (const tick of document.querySelectorAll<HTMLElement>("#ruler .tick")) {
    for (const instant of rowsByTick.get(tick)?.instants ?? []) {
      const isExpandedInstant = new Date(instant).getTime() === expandedRow.instantMs;
      if (isExpandedInstant) {
        return tick;
      }
    }
  }
  return undefined;
}

// One shared snapshot (task 309) after the stage is drawn.
export function markMultiEventTicks(): void {
  markTickKindState(collectStageBubbles());
  // Task 300: the expansion outlives its own re-render, so the open row is rebuilt on the fresh ticks.
  openExpandedRowAgain();
}

// Task 360: a box toggle re-marks the ticks, rebuilds the open file list, and relays out the stage.
export function refreshTicksForKindFilter(): void {
  markTickKindState(collectStageBubbles());
  if (expandedRow === undefined) {
    return;
  }
  const tick = findTickAtExpandedInstant();
  const events = tick === undefined ? [] : listEventsAtRow(rowsByTick.get(tick)!.axisPxList);
  const isRowGone = tick === undefined || events.length <= 1;
  if (isRowGone) {
    closeRulerExpansion();
    for (const openTick of document.querySelectorAll<HTMLElement>("#ruler .tick.expanded")) {
      openTick.querySelector(".tickfiles")?.remove();
      openTick.classList.remove("expanded");
    }
    triggerStageRelayout();
    return;
  }
  tick.querySelector(".tickfiles")?.remove();
  const listHeightPx = measureListHeightPx(tick, events);
  tick.appendChild(buildTickFileList(events));
  // The open list is rebuilt in place; only a changed height needs the stage laid out again.
  if (listHeightPx !== expandedRow.listHeightPx) {
    expandedRow = { instantMs: expandedRow.instantMs, listHeightPx };
    triggerStageRelayout();
  }
}

function closeOpenRowOnEscape(event: KeyboardEvent): void {
  const isIgnoredKey = event.key !== "Escape" || expandedRow === undefined;
  if (isIgnoredKey) {
    return;
  }
  closeRulerExpansion();
  triggerStageRelayout();
}

// Escape shuts the open row; wired once from bootLayer1Page since ticks are replaced every render.
export function wireTickExpansion(): void {
  onKindFilterChange(refreshTicksForKindFilter);
  document.addEventListener("keydown", closeOpenRowOnEscape);
}

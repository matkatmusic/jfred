// Task 383: reads the stage to learn which ruler ticks hold a verified node (commit, on-disk or snapshot).

import { getRequiredElementById } from "./app-dom.ts";
import { collectStageBubbles, type BubbleSnapshot } from "./layer1-ruler-click.ts";
import { listAllEventsAtRow, rowsByTick } from "./layer1-tick-events.ts";
import type { CutFacts } from "./layer1-cut-rules.ts";

export type TickBeaconFacts = Pick<CutFacts, "isBeacon" | "isCommit" | "instantMs">;

// Test n-created first: a created node carries n-disk too.
export function isBeaconNode(element: HTMLElement): boolean {
  const classes = element.classList;
  if (!classes.contains("node") || classes.contains("n-created"))
    return false;
  return classes.contains("n-commit") || classes.contains("n-disk") || classes.contains("n-snap");
}

export function readTickBeaconFacts(tick: HTMLElement, snapshot: BubbleSnapshot[]): TickBeaconFacts {
  const row = rowsByTick.get(tick);
  if (row === undefined)
    throw new Error("ruler tick has no stored row");
  const facts = { isBeacon: false, isCommit: false, instantMs: Date.parse(row.instants[0]!) };
  for (const event of listAllEventsAtRow(row.axisPxList, snapshot)) {
    if (!isBeaconNode(event.element))
      continue;
    facts.isBeacon = true;
    facts.isCommit ||= event.element.classList.contains("n-commit");
  }
  return facts;
}

export function countSkippedBeaconTicks(fromMs: number, toMs: number): number {
  const snapshot = collectStageBubbles();
  let count = 0;
  for (const tick of getRequiredElementById("ruler").querySelectorAll<HTMLElement>(".tick")) {
    const facts = readTickBeaconFacts(tick, snapshot);
    const isBetween = facts.instantMs > fromMs && facts.instantMs < toMs;
    if (isBetween && facts.isBeacon)
      count++;
  }
  return count;
}

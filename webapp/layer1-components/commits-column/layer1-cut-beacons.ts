// Task 383: reads the stage to learn which ruler ticks hold a verified node (commit, on-disk, snapshot or edit).

import { getRequiredElementById } from "../../app-dom.ts";
import { collectStageBubbles, type BubbleSnapshot } from "../ruler/layer1-ruler-click.ts";
import { listAllEventsAtRow, rowsByTick } from "../ruler/layer1-tick-events.ts";
import type { CutFacts } from "./layer1-cut-rules.ts";

export type TickBeaconFacts = Pick<CutFacts, "isBeacon" | "isCommit" | "instantMs">;

// Test n-created first: a created node carries n-disk too.
export function isBeaconNode(element: HTMLElement): boolean {
  const classes = element.classList;
  const isNode = classes.contains("node");
  const isCreated = classes.contains("n-created");
  if (!isNode)
    return false;
  if (isCreated)
    return false;
  const isCommit = classes.contains("n-commit");
  const isDisk = classes.contains("n-disk");
  const isSnap = classes.contains("n-snap");
  const isEdit = classes.contains("n-edit");
  return isCommit || isDisk || isSnap || isEdit;
}

export function readTickBeaconFacts(tick: HTMLElement, snapshot: BubbleSnapshot[]): TickBeaconFacts {
  const row = rowsByTick.get(tick);
  if (row === undefined)
    throw new Error("ruler tick has no stored row");
  const facts = { isBeacon: false, isCommit: false, instantMs: Date.parse(row.instants[0]!) };
  for (const event of listAllEventsAtRow(row.axisPxList, snapshot)) {
    const isBeacon = isBeaconNode(event.element);
    if (!isBeacon)
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
    if (isBetween) {
      if (facts.isBeacon)
        count++;
    }
  }
  return count;
}

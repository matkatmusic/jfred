// Task 383: reads the stage to learn which ruler ticks hold a verified node (commit, on-disk, snapshot or edit).

import { getRequiredElementById } from "../../app-dom.ts";
import { readBarsTickBeaconFacts } from "../bars-view/layer1-bars-cut-facts.ts";
import { isBarsViewOn } from "../bars-view/layer1-bars-mode.ts";
import { readTickIsChangedSinceTip } from "../bars-view/layer1-bars-scissors.ts";
import { collectStageBubbles, type BubbleSnapshot } from "../ruler/layer1-ruler-click.ts";
import { listAllEventsAtRow, rowsByTick } from "../ruler/layer1-tick-events.ts";
import type { CutFacts } from "./layer1-cut-rules.ts";

// export type TickBeaconFacts = Pick<CutFacts, "isBeacon" | "isCommit" | "instantMs">;
export type TickBeaconFacts = Pick<CutFacts, "isBeacon" | "isCommit" | "isChangedSinceTip" | "instantMs">;

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
  if (isBarsViewOn()) {
    return readBarsTickBeaconFacts(tick);
  }
  const row = rowsByTick.get(tick);
  if (row === undefined)
    throw new Error("ruler tick has no stored row");
  // const facts = { isBeacon: false, isCommit: false, instantMs: Date.parse(row.instants[0]!) };
  const facts = { isBeacon: false, isCommit: false, isChangedSinceTip: readTickIsChangedSinceTip(tick), instantMs: Date.parse(row.instants[row.instants.length - 1]!) };
  for (const event of listAllEventsAtRow(row.axisPxList, snapshot)) {
    const isBeacon = isBeaconNode(event.element);
    if (!isBeacon)
      continue;
    facts.isBeacon = true;
    facts.isCommit ||= event.element.classList.contains("n-commit");
  }
  return facts;
}

// [] in the Bars view (the facts do not use the bubble snapshot), else collectStageBubbles().
export function collectCutSnapshot(): BubbleSnapshot[] {
  if (isBarsViewOn()) {
    return [];
  }
  return collectStageBubbles();
}

export function countSkippedBeaconTicks(fromMs: number, toMs: number): number {
  // const snapshot = collectStageBubbles();
  const snapshot = collectCutSnapshot();
  let count = 0;
  for (const tick of getRequiredElementById("timelineRulerComponent").querySelectorAll<HTMLElement>(".tick")) {
    const facts = readTickBeaconFacts(tick, snapshot);
    const isBetween = facts.instantMs > fromMs && facts.instantMs < toMs;
    if (isBetween) {
      // if (facts.isBeacon)
      if (facts.isChangedSinceTip)
        count++;
    }
  }
  return count;
}

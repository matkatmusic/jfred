// Task 383: paints cut-mark classes and refusal titles on ruler ticks.

import { getRequiredElementById } from "./app-dom.ts";
import { readTickBeaconFacts } from "./layer1-cut-beacons.ts";
import { CUT_REFUSAL_TEXT, findCutRefusal } from "./layer1-cut-rules.ts";
import { collectStageBubbles, type BubbleSnapshot } from "./layer1-ruler-click.ts";
import { rowsByTick } from "./layer1-tick-events.ts";
import { readJfredBranch, readTipMs, type JfredBranch } from "./layer1-jfred-state.ts";

const CutClass = {
  ok: "cut-ok",
  no: "cut-no",
  base: "cut-base",
  set: "cut-set",
  pending: "cut-pending",
} as const;

function readTickInstantMs(tick: HTMLElement): number {
  const row = rowsByTick.get(tick);
  if (row === undefined)
    throw new Error("ruler tick has no stored row");
  return Date.parse(row.instants[0]!);
}

function listStateClasses(instantMs: number, branch: JfredBranch): string[] {
  const classes: string[] = [];
  if (branch.base !== undefined && Date.parse(branch.base.instant) === instantMs)
    classes.push(CutClass.base);
  for (const commit of branch.commits) {
    if (Date.parse(commit.instant) === instantMs)
      classes.push(CutClass.set);
  }
  if (branch.pending !== undefined && Date.parse(branch.pending.instant) === instantMs)
    classes.push(CutClass.pending);
  return classes;
}

function paintArmedTick(tick: HTMLElement, snapshot: BubbleSnapshot[]): void {
  const refusal = findCutRefusal({ ...readTickBeaconFacts(tick, snapshot), tipMs: readTipMs() });
  tick.classList.add(refusal === undefined ? CutClass.ok : CutClass.no);
  if (refusal !== undefined)
    tick.title = CUT_REFUSAL_TEXT[refusal];
}

export function repaintCutMarks(): void {
  const branch = readJfredBranch();
  const snapshot = branch.isArmed ? collectStageBubbles() : [];
  for (const tick of getRequiredElementById("ruler").querySelectorAll<HTMLElement>(".tick")) {
    tick.classList.remove(...Object.values(CutClass));
    tick.removeAttribute("title");
    tick.classList.add(...listStateClasses(readTickInstantMs(tick), branch));
    if (branch.isArmed)
      paintArmedTick(tick, snapshot);
  }
}

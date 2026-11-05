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
  const hasBase = branch.base !== undefined;
  if (hasBase && Date.parse(branch.base!.instant) === instantMs)
    classes.push(CutClass.base);
  for (const commit of branch.commits) {
    if (Date.parse(commit.instant) === instantMs)
      classes.push(CutClass.set);
  }
  const hasPending = branch.pending !== undefined;
  if (hasPending && Date.parse(branch.pending!.instant) === instantMs)
    classes.push(CutClass.pending);
  return classes;
}

// A tick with the full-time attribute keeps it as its title; a real-page tick has no title.
function restoreTickTitle(tick: HTMLElement): void {
  const fullTime = tick.dataset["fullTime"];
  if (fullTime === undefined) {
    tick.removeAttribute("title");
    return;
  }
  tick.title = fullTime;
}

function buildRefusalTitle(tick: HTMLElement, refusalText: string): string {
  const fullTime = tick.dataset["fullTime"];
  if (fullTime === undefined)
    return refusalText;
  return `${refusalText}\n${fullTime}`;
}

function paintArmedTick(tick: HTMLElement, snapshot: BubbleSnapshot[]): void {
  const refusal = findCutRefusal({ ...readTickBeaconFacts(tick, snapshot), tipMs: readTipMs() });
  if (refusal === undefined) {
    tick.classList.add(CutClass.ok);
    return;
  }
  tick.classList.add(CutClass.no);
  tick.title = buildRefusalTitle(tick, CUT_REFUSAL_TEXT[refusal]);
}

// Marks show only while Commit mode is on; unarmed ticks carry no cut class.
export function repaintCutMarks(): void {
  const branch = readJfredBranch();
  const snapshot = branch.isArmed ? collectStageBubbles() : [];
  for (const tick of getRequiredElementById("ruler").querySelectorAll<HTMLElement>(".tick")) {
    tick.classList.remove(...Object.values(CutClass));
    restoreTickTitle(tick);
    if (branch.isArmed) {
      tick.classList.add(...listStateClasses(readTickInstantMs(tick), branch));
      paintArmedTick(tick, snapshot);
    }
  }
}

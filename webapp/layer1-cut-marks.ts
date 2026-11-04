// Task 383: in Commit mode a ruler click sets the base or the pending mark.

import { getRequiredElementById } from "./app-dom.ts";
import { countSkippedBeaconTicks, readTickBeaconFacts } from "./layer1-cut-beacons.ts";
import { repaintCutMarks } from "./layer1-cut-paint.ts";
import { CUT_REFUSAL_TEXT, findCutRefusal } from "./layer1-cut-rules.ts";
import { openToast } from "./layer1-diff-pane-support.ts";
import { redrawJfredStrip, openPendingMessage } from "./layer1-jfred-strip.ts";
import { buildCommitMessage, listSnapLines } from "./layer1-jfred-message.ts";
import { readJfredBranch, readTipMs, setBase, setPending } from "./layer1-jfred-state.ts";
import { collectStageBubbles, type BubbleSnapshot } from "./layer1-ruler-click.ts";
import { listAllEventsAtRow, rowsByTick } from "./layer1-tick-events.ts";

const SHORT_HASH_LENGTH = 8;

function readTickInstant(tick: HTMLElement): string {
  const row = rowsByTick.get(tick);
  if (row === undefined)
    throw new Error("ruler tick has no stored row");
  return row.instants[0]!;
}

function readCommitShortHash(tick: HTMLElement, snapshot: BubbleSnapshot[]): string {
  for (const event of listAllEventsAtRow(rowsByTick.get(tick)!.axisPxList, snapshot)) {
    if (event.element.classList.contains("n-commit"))
      return event.element.title.slice(0, SHORT_HASH_LENGTH);
  }
  throw new Error("base tick has no commit node");
}

function setPendingMark(instant: string): void {
  const markMs = Date.parse(instant);
  const skippedCount = countSkippedBeaconTicks(readTipMs()!, markMs);
  const wallClock = new Date().toISOString();
  setPending({ instant, message: buildCommitMessage({ markInstant: instant, skippedCount, snapLines: listSnapLines(markMs), wallClock }) });
}

function acceptTick(tick: HTMLElement, snapshot: BubbleSnapshot[]): void {
  const instant = readTickInstant(tick);
  if (readJfredBranch().base === undefined)
    setBase({ instant, shortHash: readCommitShortHash(tick, snapshot) });
  else
    setPendingMark(instant);
  redrawJfredStrip();
  repaintCutMarks();
  if (readJfredBranch().pending !== undefined)
    openPendingMessage();
}

function handleCutClick(event: Event): void {
  if (!readJfredBranch().isArmed)
    return;
  const target = event.target as HTMLElement;
  const tick = target.closest<HTMLElement>(".tick");
  if (tick === null || target.closest(".tickfiles") !== null)
    return;
  event.stopPropagation();
  const snapshot = collectStageBubbles();
  const refusal = findCutRefusal({ ...readTickBeaconFacts(tick, snapshot), tipMs: readTipMs() });
  if (refusal === undefined)
    acceptTick(tick, snapshot);
  else
    openToast(CUT_REFUSAL_TEXT[refusal]);
}

// A named capture listener, so a second call is a DOM no-op; layer1-ruler-click.ts stays untouched.
export function installCutMarkClick(): void {
  getRequiredElementById("ruler").addEventListener("click", handleCutClick, true);
}

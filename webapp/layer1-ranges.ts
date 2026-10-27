// Task 292: per picked JSONL, a bar for the session extent and a wash over the timeline stretch it covers.

import { createElement, getRequiredElementById } from "./app-dom.ts";
import { RULER_NODE_ROW_PIXELS } from "./layer1-ruler-axis.ts";
import { spawnWash } from "./layer1-wash.ts";
import type { WireRulerTick, WireSession } from "./layer1-wire.ts";

interface AxisBand {
  fromPx: number;
  toPx: number;
}

interface SessionMarks {
  bar: HTMLElement;
  band: AxisBand;
  wash: HTMLElement | undefined;
}

// The ruler is capped and floored, so an arbitrary instant is interpolated between its two ticks.
function findTickIndexAtOrAfter(instantMs: number, ticks: readonly WireRulerTick[]): number {
  for (const [index, tick] of ticks.entries()) {
    const tickMs = Date.parse(tick.instant);
    if (tickMs >= instantMs) {
      return index;
    }
  }
  return -1;
}

// Where an arbitrary instant sits on the axis, clamped at both ends.
export function computeAxisPixelsAt(instantMs: number, ticks: readonly WireRulerTick[]): number {
  const first = ticks[0];
  const last = ticks[ticks.length - 1];
  const hasNoTicks = first === undefined || last === undefined;
  if (hasNoTicks) {
    return 0;
  }
  const firstMs = Date.parse(first.instant);
  if (instantMs <= firstMs) {
    return first.axisPx;
  }
  const afterIndex = findTickIndexAtOrAfter(instantMs, ticks);
  if (afterIndex < 0) {
    return last.axisPx;
  }
  const after = ticks[afterIndex]!;
  const before = ticks[afterIndex - 1]!;
  const afterMs = Date.parse(after.instant);
  const beforeMs = Date.parse(before.instant);
  if (afterMs === instantMs) {
    return after.axisPx;
  }
  return before.axisPx + (after.axisPx - before.axisPx) * ((instantMs - beforeMs) / (afterMs - beforeMs));
}

// One absolutely-placed strip: the two numbers both marks are built from.
function buildMark(className: string, fromPx: number, spanPx: number): HTMLElement {
  const node = createElement("div", { class: className });
  node.style.setProperty("--axis-px", String(fromPx));
  node.style.setProperty("--span-px", String(spanPx));
  return node;
}

// Wash closes half a row past the first/last covered event; no covered event means no wash.
// ponytail: foot assumes ONE node row per tick; put a row count on WireRulerTick if ever reported.
function buildSessionWash(session: WireSession, ticks: readonly WireRulerTick[]): HTMLElement | undefined {
  const startedMs = Date.parse(session.started);
  const endedMs = Date.parse(session.ended);
  const covered: WireRulerTick[] = [];
  for (const tick of ticks) {
    const instantMs = Date.parse(tick.instant);
    const isAfterStart = instantMs >= startedMs;
    const isBeforeEnd = instantMs <= endedMs;
    const isCovered = isAfterStart && isBeforeEnd;
    if (isCovered) {
      covered.push(tick);
    }
  }
  const firstCovered = covered[0];
  const lastCovered = covered[covered.length - 1];
  const hasNoCoveredTick = firstCovered === undefined || lastCovered === undefined;
  if (hasNoCoveredTick) {
    return undefined;
  }
  const topPx = firstCovered.axisPx - RULER_NODE_ROW_PIXELS / 2;
  const footPx = lastCovered.axisPx + RULER_NODE_ROW_PIXELS / 2;
  const wash = spawnWash(topPx, footPx, "var(--c-script)");
  wash.classList.add("range-wash");
  return wash;
}

function isInsideAnyBand(axisPx: number, bands: readonly AxisBand[]): boolean {
  for (const band of bands) {
    const isInsideBand = axisPx >= band.fromPx && axisPx <= band.toPx;
    if (isInsideBand) {
      return true;
    }
  }
  return false;
}

// Mark gutter rows inside a band, read from the row's own `--axis-px` since merged rows hold one offset.
function markTicksInsideBands(bands: readonly AxisBand[]): void {
  for (const tick of getRequiredElementById("ruler").querySelectorAll(".tick")) {
    const axisPx = Number((tick as HTMLElement).style.getPropertyValue("--axis-px"));
    const isInRange = isInsideAnyBand(axisPx, bands);
    tick.classList.toggle("inrange", isInRange);
  }
}

// One session's bar, band and wash. `slot` is the lane the 7 px bar occupies, so picked sessions never overlap.
function buildSessionMarks(session: WireSession, slot: number, ticks: readonly WireRulerTick[]): SessionMarks {
  const fromPx = computeAxisPixelsAt(Date.parse(session.started), ticks);
  const toPx = computeAxisPixelsAt(Date.parse(session.ended), ticks);
  const bar = buildMark("range", fromPx, toPx - fromPx);
  bar.style.setProperty("--slot", String(slot));
  // The name is a tooltip because the 7 px lane must never cover a bubble.
  bar.title = `${session.file}\n${session.started} → ${session.ended}`;
  return { bar, band: { fromPx, toPx }, wash: buildSessionWash(session, ticks) };
}

// Draw every picked session's bar and wash, and mark the gutter rows they cover.
export function renderSessionRanges(sessions: readonly WireSession[], ticks: readonly WireRulerTick[]): void {
  const sessionsToMark = ticks.length === 0 ? [] : sessions;
  const bars: HTMLElement[] = [];
  const washes: HTMLElement[] = [];
  const bands: AxisBand[] = [];
  for (const [slot, session] of sessionsToMark.entries()) {
    const marks = buildSessionMarks(session, slot, ticks);
    bars.push(marks.bar);
    bands.push(marks.band);
    if (marks.wash !== undefined) {
      washes.push(marks.wash);
    }
  }
  getRequiredElementById("washes").replaceChildren(...washes);
  getRequiredElementById("ranges").replaceChildren(...bars);
  markTicksInsideBands(bands);
}

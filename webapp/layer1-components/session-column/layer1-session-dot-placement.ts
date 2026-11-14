// Task 908: session layout puts each dot at its row's top plus its line, one line per distinct instant.

import { SESSION_DOT_PX, countInstantsBefore, listDistinctInstants, listDistinctInstantsBySession } from "../ruler/layer1-session-dot-counts.ts";
import type { SessionDotInstants } from "../ruler/layer1-session-dot-counts.ts";
import { buildDotLineKey } from "./layer1-session-slots.ts";
import type { SessionDotLine, SessionDotLines, SessionSlots } from "./layer1-session-slots.ts";
import type { Placement } from "./layer1-annotation-window.ts";
import type { SessionPixelSpan } from "./layer1-session-lanes.ts";
import type { WireAnnotation, WireSessionSpan } from "./layer1-wire-annotations.ts";
import type { WireRulerTick } from "../../layer1-wire.ts";

function listTickMs(ticks: readonly WireRulerTick[]): number[] {
  const tickMs: number[] = [];
  for (const tick of ticks) {
    tickMs.push(Date.parse(tick.instant));
  }
  return tickMs;
}

// The last tick at or before the instant; earlier instants use the first row.
function findRowIndex(tickMs: readonly number[], instantMs: number): number {
  const ticksAtOrBefore = countInstantsBefore(tickMs, instantMs + 1);
  return Math.max(0, ticksAtOrBefore - 1);
}

// True when the ticks carry dot blocks: the ruler is a session layout.
export function isSessionLayout(ticks: readonly WireRulerTick[]): boolean {
  return ticks[0]?.dotBlockPx !== undefined;
}

export function readSessionMs(instants: SessionDotInstants, sessionId: string): readonly number[] {
  const sessionMs = instants.get(sessionId);
  if (sessionMs === undefined) {
    throw new Error(`session ${sessionId} has no dot instants`);
  }
  return sessionMs;
}

// distinctMs: the session's distinct instants. Line = distinct instants of this row before this one.
export function computeSessionDotAxisPx(ticks: readonly WireRulerTick[], tickMs: readonly number[], distinctMs: readonly number[], instantMs: number): number {
  const rowIndex = findRowIndex(tickMs, instantMs);
  const rowStartMs = rowIndex === 0 ? -Infinity : tickMs[rowIndex]!;
  const lineIndex = countInstantsBefore(distinctMs, instantMs) - countInstantsBefore(distinctMs, rowStartMs);
  return ticks[rowIndex]!.axisPx + lineIndex * SESSION_DOT_PX;
}
// Old one-dot-per-line axis function, replaced in task 908:
// export function computeSessionDotAxisPx(ticks, tickMs, sessionMs, dotIndex) {
//   const rowIndex = findRowIndex(tickMs, sessionMs[dotIndex]!);
//   const rowStartIndex = rowIndex === 0 ? 0 : countInstantsBefore(sessionMs, tickMs[rowIndex]!);
//   return ticks[rowIndex]!.axisPx + (dotIndex - rowStartIndex) * SESSION_DOT_PX;
// }

// A run of equal instants is one line: its y and how many dots share it.
function listDotLinesOfSession(ticks: readonly WireRulerTick[], tickMs: readonly number[], sortedMs: readonly number[]): SessionDotLine[] {
  const distinctMs = listDistinctInstants(sortedMs);
  const lines: SessionDotLine[] = [];
  for (const instantMs of distinctMs) {
    const axisPx = computeSessionDotAxisPx(ticks, tickMs, distinctMs, instantMs);
    const dotCount = countInstantsBefore(sortedMs, instantMs + 1) - countInstantsBefore(sortedMs, instantMs);
    lines.push({ axisPx, dotCount });
  }
  return lines;
}

interface SessionStart { sessionId: string; firstMs: number; }

function compareSessionStarts(left: SessionStart, right: SessionStart): number {
  const startStep = left.firstMs - right.firstMs;
  if (startStep !== 0) {
    return startStep;
  }
  return left.sessionId < right.sessionId ? -1 : 1;
}

// Whole-index instants only: lanes must not change when the loaded dots change.
export function listSessionDotLines(ticks: readonly WireRulerTick[], instants: SessionDotInstants): SessionDotLines[] {
  const tickMs = listTickMs(ticks);
  const starts: SessionStart[] = [];
  for (const [sessionId, sortedMs] of instants) {
    starts.push({ sessionId, firstMs: sortedMs[0]! });
  }
  starts.sort(compareSessionStarts);
  const sessions: SessionDotLines[] = [];
  for (const start of starts) {
    sessions.push({ sessionId: start.sessionId, lines: listDotLinesOfSession(ticks, tickMs, readSessionMs(instants, start.sessionId)) });
  }
  return sessions;
}

function readStackOfDot(slots: SessionSlots, annotation: WireAnnotation, axisPx: number, rank: number): number {
  const laneSlot = slots.laneSlotBySession.get(annotation.sessionId);
  const dotSlot = slots.dotSlotsByLine.get(buildDotLineKey(annotation.sessionId, axisPx))?.[rank];
  const message = `session ${annotation.sessionId} instant ${annotation.instant} rank ${rank} has no slot`;
  if (laneSlot === undefined) {
    throw new Error(message);
  }
  if (dotSlot === undefined) {
    throw new Error(message);
  }
  return dotSlot - laneSlot;
}

function compareByInstantThenLine(left: WireAnnotation, right: WireAnnotation): number {
  const instantStep = Date.parse(left.instant) - Date.parse(right.instant);
  if (instantStep !== 0) {
    return instantStep;
  }
  return left.line - right.line;
}

// How many dots of the same session and instant came before this one.
function takeSameInstantRank(rankCounts: Map<string, number>, annotation: WireAnnotation): number {
  const key = `${annotation.sessionId}@${Date.parse(annotation.instant)}`;
  const rank = rankCounts.get(key) ?? 0;
  rankCounts.set(key, rank + 1);
  return rank;
}

function buildSessionPlacement(annotation: WireAnnotation, rank: number, ticks: readonly WireRulerTick[], tickMs: readonly number[], distinctInstants: SessionDotInstants, slots: SessionSlots): Placement {
  const distinctMs = readSessionMs(distinctInstants, annotation.sessionId);
  const axisPx = computeSessionDotAxisPx(ticks, tickMs, distinctMs, Date.parse(annotation.instant));
  // task 912: stack is the slot offset from the lane, not the same-instant rank.
  // return { annotation, axisPx, stack: rank };
  return { annotation, axisPx, stack: readStackOfDot(slots, annotation, axisPx, rank) };
}
// Old placement used dotIndex = countInstantsBefore(sessionMs, instant) + rank and stack: 0.

// Placements come back ordered by instant then line.
// task 912: the placements need the slots.
// export function computeSessionDotPlacements(list: readonly WireAnnotation[], ticks: readonly WireRulerTick[], instants: SessionDotInstants): Placement[] {
export function computeSessionDotPlacements(list: readonly WireAnnotation[], ticks: readonly WireRulerTick[], instants: SessionDotInstants, slots: SessionSlots): Placement[] {
  const tickMs = listTickMs(ticks);
  const distinctInstants = listDistinctInstantsBySession(instants);
  const rankCounts = new Map<string, number>();
  const placements: Placement[] = [];
  for (const annotation of [...list].sort(compareByInstantThenLine)) {
    const rank = takeSameInstantRank(rankCounts, annotation);
    placements.push(buildSessionPlacement(annotation, rank, ticks, tickMs, distinctInstants, slots));
  }
  return placements;
}

// First dot to last dot of each session; spans outside the ruler are kept.
export function listSessionPixelSpansFromInstants(spans: readonly WireSessionSpan[], ticks: readonly WireRulerTick[], instants: SessionDotInstants): SessionPixelSpan[] {
  const tickMs = listTickMs(ticks);
  const distinctInstants = listDistinctInstantsBySession(instants);
  const pixelSpans: SessionPixelSpan[] = [];
  for (const span of spans) {
    const distinctMs = readSessionMs(distinctInstants, span.sessionId);
    const firstPx = computeSessionDotAxisPx(ticks, tickMs, distinctMs, distinctMs[0]!);
    const lastPx = computeSessionDotAxisPx(ticks, tickMs, distinctMs, distinctMs[distinctMs.length - 1]!);
    pixelSpans.push({ sessionId: span.sessionId, firstPx, lastPx });
  }
  return pixelSpans;
}

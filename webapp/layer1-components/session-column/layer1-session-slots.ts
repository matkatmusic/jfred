// Task 912: slot rule of the session column. Ported from placeDotsBySlotRule in mockup/session-line-collapse.html.

// One dot line of one session: its y and how many dots share it.
export interface SessionDotLine { axisPx: number; dotCount: number; }
// Sessions come in start order; lines ascend by axisPx.
export interface SessionDotLines { sessionId: string; lines: readonly SessionDotLine[]; }
export interface SessionSlots {
  laneSlotBySession: Map<string, number>;
  // Key from buildDotLineKey; slot of each dot on that line by rank; index 0 is the lane slot.
  dotSlotsByLine: Map<string, number[]>;
  // Highest used slot plus 1.
  slotCount: number;
}

interface LineAtAxisPx { sessionId: string; dotCount: number; }
interface SlotState {
  slots: SessionSlots;
  lastAxisPxBySession: Map<string, number>;
  // Per slot: the last line of the session that owns the slot.
  slotRunsUntilAxisPx: Map<number, number>;
}

export function buildDotLineKey(sessionId: string, axisPx: number): string {
  return `${sessionId}@${axisPx}`;
}

function compareNumbers(left: number, right: number): number {
  return left - right;
}

function groupLinesByAxisPx(sessions: readonly SessionDotLines[]): Map<number, LineAtAxisPx[]> {
  const linesByAxisPx = new Map<number, LineAtAxisPx[]>();
  for (const session of sessions) {
    for (const line of session.lines) {
      const linesHere = linesByAxisPx.get(line.axisPx) ?? [];
      linesHere.push({ sessionId: session.sessionId, dotCount: line.dotCount });
      linesByAxisPx.set(line.axisPx, linesHere);
    }
  }
  return linesByAxisPx;
}

function buildSlotState(sessions: readonly SessionDotLines[]): SlotState {
  const lastAxisPxBySession = new Map<string, number>();
  for (const session of sessions) {
    lastAxisPxBySession.set(session.sessionId, session.lines[session.lines.length - 1]!.axisPx);
  }
  const slots: SessionSlots = { laneSlotBySession: new Map(), dotSlotsByLine: new Map(), slotCount: 0 };
  return { slots, lastAxisPxBySession, slotRunsUntilAxisPx: new Map() };
}

function isSlotTaken(state: SlotState, usedSlots: ReadonlySet<number>, slot: number, axisPx: number): boolean {
  const isUsed = usedSlots.has(slot);
  if (isUsed) {
    return true;
  }
  const runsUntilAxisPx = state.slotRunsUntilAxisPx.get(slot);
  if (runsUntilAxisPx === undefined) {
    return false;
  }
  return runsUntilAxisPx >= axisPx;
}

function findFreeLaneSlot(state: SlotState, usedSlots: ReadonlySet<number>, axisPx: number): number {
  let slot = 0;
  let isTaken = isSlotTaken(state, usedSlots, slot, axisPx);
  while (isTaken) {
    slot += 1;
    isTaken = isSlotTaken(state, usedSlots, slot, axisPx);
  }
  return slot;
}

function takeLaneSlot(state: SlotState, usedSlots: ReadonlySet<number>, line: LineAtAxisPx, axisPx: number): number {
  const knownLaneSlot = state.slots.laneSlotBySession.get(line.sessionId);
  if (knownLaneSlot !== undefined) {
    return knownLaneSlot;
  }
  const laneSlot = findFreeLaneSlot(state, usedSlots, axisPx);
  state.slots.laneSlotBySession.set(line.sessionId, laneSlot);
  state.slotRunsUntilAxisPx.set(laneSlot, state.lastAxisPxBySession.get(line.sessionId)!);
  return laneSlot;
}

// Sessions that already have a lane go first, then new sessions; both in start order.
function listLinesLanedFirst(linesHere: readonly LineAtAxisPx[], laneSlotBySession: ReadonlyMap<string, number>): LineAtAxisPx[] {
  const lanedLines: LineAtAxisPx[] = [];
  const newLines: LineAtAxisPx[] = [];
  for (const line of linesHere) {
    const hasLane = laneSlotBySession.has(line.sessionId);
    if (hasLane) {
      lanedLines.push(line);
    } else {
      newLines.push(line);
    }
  }
  return [...lanedLines, ...newLines];
}

// Pass 1: the first dot of every session on this y goes in its lane slot.
function placeLaneDots(state: SlotState, axisPx: number, linesHere: readonly LineAtAxisPx[]): Set<number> {
  const usedSlots = new Set<number>();
  for (const line of listLinesLanedFirst(linesHere, state.slots.laneSlotBySession)) {
    const laneSlot = takeLaneSlot(state, usedSlots, line, axisPx);
    usedSlots.add(laneSlot);
    state.slots.dotSlotsByLine.set(buildDotLineKey(line.sessionId, axisPx), [laneSlot]);
  }
  return usedSlots;
}

// Pass 2, in session start order: extra dots take the next slots right of the lane with no dot on this y.
function placeExtraDots(state: SlotState, axisPx: number, linesHere: readonly LineAtAxisPx[], usedSlots: Set<number>): void {
  for (const line of linesHere) {
    const dotSlots = state.slots.dotSlotsByLine.get(buildDotLineKey(line.sessionId, axisPx))!;
    let slot = dotSlots[0]!;
    for (let rank = 1; rank < line.dotCount; rank += 1) {
      slot += 1;
      while (usedSlots.has(slot)) {
        slot += 1;
      }
      usedSlots.add(slot);
      dotSlots.push(slot);
    }
    state.slots.slotCount = Math.max(state.slots.slotCount, dotSlots[dotSlots.length - 1]! + 1);
  }
}

export function computeSessionSlots(sessions: readonly SessionDotLines[]): SessionSlots {
  const state = buildSlotState(sessions);
  const linesByAxisPx = groupLinesByAxisPx(sessions);
  const axisPxList = [...linesByAxisPx.keys()].sort(compareNumbers);
  for (const axisPx of axisPxList) {
    const linesHere = linesByAxisPx.get(axisPx)!;
    const usedSlots = placeLaneDots(state, axisPx, linesHere);
    placeExtraDots(state, axisPx, linesHere, usedSlots);
  }
  return state.slots;
}

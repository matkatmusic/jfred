export const SESSION_DOT_PX = 14;
export const SESSION_ROW_SPACER_PX = 6;
// Per session: its dot instants (epoch ms), ascending, one entry per dot.
export type SessionDotInstants = ReadonlyMap<string, readonly number[]>;

// How many entries are before limitMs.
export function countInstantsBefore(sortedMs: readonly number[], limitMs: number): number {
  let low = 0;
  let high = sortedMs.length;
  while (low < high) {
    const middle = Math.floor((low + high) / 2);
    if (sortedMs[middle]! < limitMs) {
      low = middle + 1;
    }
    else {
      high = middle;
    }
  }
  return low;
}

// Ascending instants with repeats removed.
export function listDistinctInstants(sortedMs: readonly number[]): number[] {
  const distinctMs: number[] = [];
  for (const ms of sortedMs) {
    const isRepeat = distinctMs[distinctMs.length - 1] === ms;
    if (!isRepeat) {
      distinctMs.push(ms);
    }
  }
  return distinctMs;
}

export function listDistinctInstantsBySession(instants: SessionDotInstants): SessionDotInstants {
  const distinctBySession = new Map<string, readonly number[]>();
  for (const [sessionId, sortedMs] of instants) {
    distinctBySession.set(sessionId, listDistinctInstants(sortedMs));
  }
  return distinctBySession;
}

// Most dots of one session at one instant: how many dot slots its lane needs (at least 1).
export function computeSessionWidthSlots(sortedMs: readonly number[]): number {
  let widthSlots = 1;
  let runLength = 0;
  let previousMs: number | undefined = undefined;
  for (const ms of sortedMs) {
    const isSameInstant = ms === previousMs;
    runLength = isSameInstant ? runLength + 1 : 1;
    widthSlots = Math.max(widthSlots, runLength);
    previousMs = ms;
  }
  return widthSlots;
}

function measureBusiestSessionLines(instants: SessionDotInstants, fromMs: number, toMs: number): number {
  let busiestLines = 0;
  for (const sortedMs of instants.values()) {
    const lines = countInstantsBefore(sortedMs, toMs) - countInstantsBefore(sortedMs, fromMs);
    busiestLines = Math.max(busiestLines, lines);
  }
  return busiestLines;
}

// tickMs is ascending and distinct. Row i owns [tick i, tick i+1).
export function computeDotBlockPxByTick(instants: SessionDotInstants, tickMs: readonly number[]): Map<number, number> {
  const distinctInstants = listDistinctInstantsBySession(instants);
  const blockPxByTick = new Map<number, number>();
  for (const [index, ms] of tickMs.entries()) {
    const fromMs = index === 0 ? -Infinity : ms;
    const toMs = index === tickMs.length - 1 ? Infinity : tickMs[index + 1]!;
    blockPxByTick.set(ms, measureBusiestSessionLines(distinctInstants, fromMs, toMs) * SESSION_DOT_PX);
  }
  return blockPxByTick;
}

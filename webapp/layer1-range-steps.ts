// Task 329: the instant-range to per-file step-pair rule behind the base/target wash.

// The one inside-the-range test every caller below shares: is ms within [from, to], inclusive?
function isMsInRange(ms: number, fromMs: number, toMs: number): boolean {
  return ms >= fromMs && ms <= toMs;
}

function findFirstIndexInRange(stepsMs: number[], fromMs: number, toMs: number): number {
  for (let index = 0; index < stepsMs.length; index += 1) {
    const isInside = isMsInRange(stepsMs[index]!, fromMs, toMs);
    if (isInside) {
      return index;
    }
  }
  return -1;
}

function findLastIndexBefore(stepsMs: number[], limitMs: number): number {
  for (let index = stepsMs.length - 1; index >= 0; index -= 1) {
    if (stepsMs[index]! < limitMs) {
      return index;
    }
  }
  return -1;
}

function findLastIndexUpTo(stepsMs: number[], startIndex: number, toMs: number): number {
  let index = startIndex;
  while (index + 1 < stepsMs.length) {
    const isNextInside = stepsMs[index + 1]! <= toMs;
    if (!isNextInside) {
      break;
    }
    index += 1;
  }
  return index;
}

// base = first step inside the range, target = last inside; an empty range holds its preceding state.
function findRangeStepIndexes(instants: string[], baseInstant: string, targetInstant: string): { baseIndex: number; targetIndex: number } | undefined {
  const fromMs = Date.parse(baseInstant);
  const toMs = Date.parse(targetInstant);
  const stepsMs: number[] = [];
  for (const instant of instants) {
    stepsMs.push(Date.parse(instant));
  }
  const baseIndex = findFirstIndexInRange(stepsMs, fromMs, toMs);
  if (baseIndex >= 0) {
    return { baseIndex, targetIndex: findLastIndexUpTo(stepsMs, baseIndex, toMs) };
  }
  const precedingIndex = findLastIndexBefore(stepsMs, fromMs);
  if (precedingIndex >= 0) {
    return { baseIndex: precedingIndex, targetIndex: precedingIndex };
  }
  // Every step post-dates the range: the file had no state inside it.
  return undefined;
}

// Task 336: does ANY instant land inside the range? The file-list sweep test.
function containsInstantInRange(instants: string[], baseInstant: string, targetInstant: string): boolean {
  const fromMs = Date.parse(baseInstant);
  const toMs = Date.parse(targetInstant);
  for (const instant of instants) {
    const isInside = isMsInRange(Date.parse(instant), fromMs, toMs);
    if (isInside) {
      return true;
    }
  }
  return false;
}

export { findRangeStepIndexes as resolveRangeStepIndexes, containsInstantInRange as hasInstantInRange };

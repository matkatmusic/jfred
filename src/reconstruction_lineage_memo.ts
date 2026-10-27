// Memoizes nested lineage replays (task 162): caches only results proven independent of the replay stack.

import {
  ReconstructionCounter,
  incrementReconstructionCounter,
} from "./reconstruction_counters.ts";

// Cached seed text plus the transitive set of queried cycle keys.
export type LineageSeedEntry = { text: string | undefined; queriedKeys: ReadonlySet<string> };

type LineageReplayFrame = { cycleKey: string; queriedKeys: Set<string>; poisoned: boolean };

// In-flight replays, outermost first — the ordered successor of `seedingLineages`.
const activeFrames: LineageReplayFrame[] = [];

export function countActiveLineageReplayFrames(): number {
  return activeFrames.length;
}

export function isLineageKeyOnReplayStack(cycleKey: string): boolean {
  for (const frame of activeFrames) {
    if (frame.cycleKey === cycleKey) {
      return true;
    }
  }
  return false;
}

// Propagate this key into every ancestor frame's dependency set.
export function markLineageKeyQueried(cycleKey: string): void {
  incrementReconstructionCounter(ReconstructionCounter.lineageReplayRequests);
  for (const frame of activeFrames) {
    frame.queriedKeys.add(cycleKey);
  }
}

// Poison every frame above the hit key's own frame; absent key poisons all defensively.
export function markLineageGuardHit(cycleKey: string): void {
  let hitIndex = -1;
  for (let index = 0; index < activeFrames.length; index += 1) {
    if (activeFrames[index]!.cycleKey === cycleKey) {
      hitIndex = index;
      break;
    }
  }
  for (let index = hitIndex + 1; index < activeFrames.length; index += 1) {
    activeFrames[index]!.poisoned = true;
  }
}

// Extract the file path prefix before the last "|" instant suffix.
function extractLineagePathOfCycleKey(cycleKey: string): string {
  return cycleKey.slice(0, cycleKey.lastIndexOf("|"));
}

// Refuse if any file the entry queried has an in-flight replay, at any instant.
function isNoQueriedKeyInFlight(entry: LineageSeedEntry): boolean {
  const inFlightPaths = new Set<string>();
  for (const frame of activeFrames) {
    inFlightPaths.add(extractLineagePathOfCycleKey(frame.cycleKey));
  }
  for (const queriedKey of entry.queriedKeys) {
    const queriedPath = extractLineagePathOfCycleKey(queriedKey);
    const isQueriedPathInFlight = inFlightPaths.has(queriedPath);
    if (isQueriedPathInFlight) {
      return false;
    }
  }
  return true;
}

// Return cached entry if window-preserved and no queried key is in flight.
export function findServableLineageSeed(
  seedsByKey: Map<string, LineageSeedEntry>,
  cycleKey: string,
  windowKeptInstant: boolean,
): LineageSeedEntry | null {
  if (!windowKeptInstant) {
    return null;
  }
  const entry = seedsByKey.get(cycleKey);
  if (entry === undefined) {
    return null;
  }
  const isServable = isNoQueriedKeyInFlight(entry);
  if (!isServable) {
    return null;
  }
  return entry;
}

// Serving a cached entry makes its dependencies the caller's dependencies.
export function markLineageCacheServe(entry: LineageSeedEntry): void {
  incrementReconstructionCounter(ReconstructionCounter.lineageCacheServes);
  for (const frame of activeFrames) {
    for (const queriedKey of entry.queriedKeys) {
      frame.queriedKeys.add(queriedKey);
    }
  }
}

// Execute compute in a fresh frame; returns null cacheable if poisoned by a guard hit.
export function executeLineageReplayFrame(
  cycleKey: string,
  compute: () => string | undefined,
): { text: string | undefined; cacheable: LineageSeedEntry | null } {
  const frame: LineageReplayFrame = { cycleKey, queriedKeys: new Set(), poisoned: false };
  activeFrames.push(frame);
  try {
    const text = compute();
    if (frame.poisoned) {
      return { text, cacheable: null };
    }
    return { text, cacheable: { text, queriedKeys: frame.queriedKeys } };
  }
  finally {
    activeFrames.pop();
  }
}

// Cache only when the replay window preserved the entry's instant.
export function storeLineageSeedWhenCacheable(
  seedsByKey: Map<string, LineageSeedEntry>,
  cycleKey: string,
  cacheable: LineageSeedEntry | null,
  windowKeptInstant: boolean,
): void {
  if (cacheable === null) {
    return;
  }
  if (!windowKeptInstant) {
    return;
  }
  seedsByKey.set(cycleKey, cacheable);
}

// True when the active replay window has not narrowed past `before`.
export function isInstantKeptByReplayWindow(previousCutoff: Date | undefined, before: Date): boolean {
  if (previousCutoff === undefined) {
    return true;
  }
  return previousCutoff.getTime() >= before.getTime();
}

// Safe memoization of nested lineage replays (task 162). A replay's result can depend on execution-stack state in exactly two ways: a cycle-guard hit inside its subtree (an ancestor's in-flight key answered `undefined`), and the never-widening replay window narrowing it. This module tracks, per in-flight replay frame, every cycleKey the frame's subtree queried, and which frames a guard hit degraded ("poisoned") — so reconstruction_branches.ts can cache exactly the replays whose results are PROVEN stack-independent, and serve a cached result only when a fresh compute would take the identical path. The frame stack REPLACES the old `seedingLineages` Set (same cycle-guard role, keys now ordered). Sole import: the counters module (itself import-free), which tallies replay requests/serves here because the two hook points (recordLineageKeyQuery, noteLineageCacheServe) are each called exactly once per replayLineageContentBefore entry/serve and reconstruction_branches.ts sits at its line cap.

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
    return activeFrames.some((frame) => frame.cycleKey === cycleKey);
}

// Propagate this key into every ancestor frame's dependency set.
export function recordLineageKeyQuery(cycleKey: string): void {
    incrementReconstructionCounter(ReconstructionCounter.lineageReplayRequests);
    for (const frame of activeFrames) {
        frame.queriedKeys.add(cycleKey);
    }
}

// Poison every frame above the hit key's own frame; absent key poisons all defensively.
export function recordLineageGuardHit(cycleKey: string): void {
    const hitIndex = activeFrames.findIndex((frame) => frame.cycleKey === cycleKey);
    for (let index = hitIndex + 1; index < activeFrames.length; index += 1) {
        activeFrames[index]!.poisoned = true;
    }
}

// Extract the file path prefix before the last "|" instant suffix.
function extractLineagePathOfCycleKey(cycleKey: string): string {
    return cycleKey.slice(0, cycleKey.lastIndexOf("|"));
}

// Refuse if any file the entry queried has an in-flight replay, at any instant.
function checkNoQueriedKeyInFlight(entry: LineageSeedEntry): boolean {
    const inFlightPaths = new Set(
        activeFrames.map((frame) => extractLineagePathOfCycleKey(frame.cycleKey)),
    );
    for (const queriedKey of entry.queriedKeys) {
        if (inFlightPaths.has(extractLineagePathOfCycleKey(queriedKey))) {
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
    if (!checkNoQueriedKeyInFlight(entry)) {
        return null;
    }
    return entry;
}

// Serving a cached entry makes its dependencies the caller's dependencies.
export function noteLineageCacheServe(entry: LineageSeedEntry): void {
    incrementReconstructionCounter(ReconstructionCounter.lineageCacheServes);
    for (const frame of activeFrames) {
        for (const queriedKey of entry.queriedKeys) {
            frame.queriedKeys.add(queriedKey);
        }
    }
}

// Execute compute in a fresh frame; returns null cacheable if poisoned by a guard hit.
export function runLineageReplayFrame(
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
    } finally {
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
export function doesReplayWindowKeepInstant(previousCutoff: Date | undefined, before: Date): boolean {
    if (previousCutoff === undefined) {
        return true;
    }
    return previousCutoff.getTime() >= before.getTime();
}

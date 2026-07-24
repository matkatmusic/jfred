// Safe memoization of nested lineage replays (task 162). A replay's result can depend on
// execution-stack state in exactly two ways: a cycle-guard hit inside its subtree (an ancestor's
// in-flight key answered `undefined`), and the never-widening replay window narrowing it. This
// module tracks, per in-flight replay frame, every cycleKey the frame's subtree queried, and which
// frames a guard hit degraded ("poisoned") — so reconstruction_branches.ts can cache exactly the
// replays whose results are PROVEN stack-independent, and serve a cached result only when a fresh
// compute would take the identical path. The frame stack REPLACES the old `seedingLineages` Set
// (same cycle-guard role, keys now ordered). Sole import: the counters module (itself
// import-free), which tallies replay requests/serves here because the two hook points
// (recordLineageKeyQuery, noteLineageCacheServe) are each called exactly once per
// replayLineageContentBefore entry/serve and reconstruction_branches.ts sits at its line cap.

import {
    ReconstructionCounter,
    incrementReconstructionCounter,
} from "./reconstruction_counters.ts";

// A cacheable lineage-seed result: the seeded text plus every cycleKey the computation queried
// (transitively). Valid to serve only while none of those keys is in flight.
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

// Every replay entry records its key into every in-flight frame: each ancestor's result now
// depends on what this key resolves to.
export function recordLineageKeyQuery(cycleKey: string): void {
    incrementReconstructionCounter(ReconstructionCounter.lineageReplayRequests);
    for (const frame of activeFrames) {
        frame.queriedKeys.add(cycleKey);
    }
}

// A cycle-guard hit on `cycleKey` degrades every frame pushed AFTER that key's own frame — they
// observed `undefined` where a clean compute would have seen a real seed. The key's own frame
// reproduces the same hit on a fresh compute (its subtree is deterministic), so it stays
// cacheable. Defensive: an absent key (findIndex -1) poisons every frame rather than risk caching
// a stack-dependent result.
export function recordLineageGuardHit(cycleKey: string): void {
    const hitIndex = activeFrames.findIndex((frame) => frame.cycleKey === cycleKey);
    for (let index = hitIndex + 1; index < activeFrames.length; index += 1) {
        activeFrames[index]!.poisoned = true;
    }
}

// Whether a cached entry may be served: nothing it queried is currently in flight, so a fresh
// compute would take the identical path and return the identical text — on ANY stack.
function checkNoQueriedKeyInFlight(entry: LineageSeedEntry): boolean {
    for (const queriedKey of entry.queriedKeys) {
        if (isLineageKeyOnReplayStack(queriedKey)) {
            return false;
        }
    }
    return true;
}

// The cached entry for cycleKey, but only when a replay whose window kept its instant could
// serve it verbatim; null otherwise (miss, dependency in flight, or window-narrowed replay).
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

// Run one replay computation inside its own frame. Returns the computed text plus the cacheable
// entry — null when a guard hit degraded the computation (stack-dependent, must not be stored).
// A throwing compute pops the frame and propagates (the surviving ancestors' accumulated queries
// stay valid: the throw is deterministic for the subtree).
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

// Store a proven stack-independent entry — but only for a replay whose window kept its instant
// (a window-narrowed result is not intrinsic to its (target, before) key).
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

// Whether entering the replay window for `before` kept that instant: enterLineageReplayWindow
// never widens, so the active cutoff equals `before` exactly when no earlier cutoff was already
// active. `previousCutoff` is enterLineageReplayWindow's return value.
export function doesReplayWindowKeepInstant(previousCutoff: Date | undefined, before: Date): boolean {
    if (previousCutoff === undefined) {
        return true;
    }
    return previousCutoff.getTime() >= before.getTime();
}

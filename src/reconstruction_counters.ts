// Tallies expensive engine operations; CLI snapshots these to stderr per run.

export enum ReconstructionCounter {
    executionRequests = "executionRequests",
    executionCacheHits = "executionCacheHits",
    preStateBuilds = "preStateBuilds",
    sandboxSpawns = "sandboxSpawns",
    sandboxMemoHits = "sandboxMemoHits",
    lineageReplayRequests = "lineageReplayRequests",
    lineageCacheServes = "lineageCacheServes",
}

const countsByCounter = new Map<ReconstructionCounter, number>();

export function incrementReconstructionCounter(counter: ReconstructionCounter): void {
    countsByCounter.set(counter, (countsByCounter.get(counter) ?? 0) + 1);
}

// Snapshot all counters (missing = 0) for CLI stderr and benchmark JSON output.
export function snapshotReconstructionCounters(): Record<string, number> {
    const snapshot: Record<string, number> = {};
    for (const counter of Object.values(ReconstructionCounter)) {
        snapshot[counter] = countsByCounter.get(counter) ?? 0;
    }
    return snapshot;
}

export function resetReconstructionCounters(): void {
    countsByCounter.clear();
}

// The one-line stderr report the CLI emits after a run (built here so reconstruction_cli.ts stays within its line cap).
export function formatReconstructionCountersLine(): string {
    return `counters: ${JSON.stringify(snapshotReconstructionCounters())}`;
}

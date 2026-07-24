// Reconstruction work counters (task 192): named tallies of the expensive engine operations
// (sandbox executions, pre-state builds, lineage replays), snapshotted by the CLI onto stderr
// so a real-corpus run reports how much work it actually did — the measurement that decides
// whether the deferred optimization phases (semantic execution-cache scopes, tree-index
// caching) are worth building. Module-level like the progress sink; reset per runCli run.
// No imports — the lineage memo (itself import-free) counts through this module.

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

// Every counter present, missing entries reported as 0 — the stable wire shape of the
// CLI's stderr report and the benchmark wrapper's JSON field.
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

// The one-line stderr report the CLI emits after a run (built here so reconstruction_cli.ts
// stays within its line cap).
export function formatReconstructionCountersLine(): string {
    return `counters: ${JSON.stringify(snapshotReconstructionCounters())}`;
}

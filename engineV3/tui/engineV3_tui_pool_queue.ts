// The queue helpers of the step pool: merge a walk request into a queue map, and pick the next request to start.

import type { StepRequest } from "./engineV3_tui_walk_types.ts";

export type PoolEntry = { request: StepRequest; isVisible: boolean };

// Keeps the older start time; the entry stays at its place in the map.
export function mergeEntry(entryByFileValue: Map<string, PoolEntry>, entry: PoolEntry): void {
    const fileValue = entry.request.file.value;
    const existingEntry = entryByFileValue.get(fileValue);
    if (existingEntry === undefined) {
        entryByFileValue.set(fileValue, entry);
        return;
    }
    const olderRequest = entry.request.startAt.getTime() < existingEntry.request.startAt.getTime() ? entry.request : existingEntry.request;
    entryByFileValue.set(fileValue, { request: olderRequest, isVisible: existingEntry.isVisible || entry.isVisible });
}

export function pickNextEntry(queueByFileValue: Map<string, PoolEntry>): PoolEntry {
    let firstHiddenEntry: PoolEntry | undefined;
    for (const entry of queueByFileValue.values()) {
        if (entry.isVisible) {
            return entry;
        }
        if (firstHiddenEntry === undefined) {
            firstHiddenEntry = entry;
        }
    }
    return firstHiddenEntry!;
}

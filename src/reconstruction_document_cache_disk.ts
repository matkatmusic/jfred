// Capacity and oldest-first eviction for the persisted document cache directory.

import { readdirSync, rmSync, statSync } from "node:fs";
import { join } from "node:path";
import type { Path } from "./structures/domain.ts";

// Cap on persisted cache files; exported so eviction tests reference it directly.
// ponytail: coarse mtime-ordered eviction, not true LRU; raise the cap or track recency in memory if a dev keeps more live projects warm than this at once.
export const DOCUMENT_CACHE_CAPACITY = 4;

// Evict oldest files by mtime when count exceeds DOCUMENT_CACHE_CAPACITY.
function compareByModifiedTime(a: { mtimeMs: number }, b: { mtimeMs: number }): number {
  return a.mtimeMs - b.mtimeMs;
}

export function removeOldestBeyondCapacity(directory: Path): void {
  const oldestFirst: { name: string; mtimeMs: number }[] = [];
  for (const name of readdirSync(directory.toString())) {
    const isCacheFile = name.endsWith(".json");
    if (isCacheFile) {
      oldestFirst.push({ name, mtimeMs: statSync(join(directory.toString(), name)).mtimeMs });
    }
  }
  oldestFirst.sort(compareByModifiedTime);
  const excessCount = Math.max(0, oldestFirst.length - DOCUMENT_CACHE_CAPACITY);
  for (const { name } of oldestFirst.slice(0, excessCount)) {
    rmSync(join(directory.toString(), name), { force: true });
    console.error(`document cache evicted ${name} (capacity ${DOCUMENT_CACHE_CAPACITY})`);
  }
}

// Tiny generic LRU primitives over a plain Map: insertion order becomes recency order when
// every read goes through getCachedValueRefreshingRecency. Shared by the engine's sandbox
// memo (reconstruction_script_execution.ts) and the viewer's artifact caches (viewer_api.ts).

// The cached value for `key`, re-inserted so the hit becomes the newest entry — or undefined.
export function getCachedValueRefreshingRecency<Value>(cache: Map<string, Value>, key: string): Value | undefined {
    const value = cache.get(key);
    if (value === undefined) {
        return undefined;
    }
    cache.delete(key);
    cache.set(key, value);
    return value;
}

// Drop least-recently-used entries until the cache fits the capacity (the Map's first key is
// always the least recently used under the read discipline above).
export function evictLeastRecentlyUsedEntries<Value>(cache: Map<string, Value>, capacity: number): void {
    while (cache.size > capacity) {
        const leastRecentKey = cache.keys().next().value as string;
        cache.delete(leastRecentKey);
    }
}


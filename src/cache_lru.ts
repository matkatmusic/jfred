// Generic LRU primitives over a plain Map, shared by sandbox memo and viewer caches.

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

// Evict oldest entries until cache fits capacity; Map insertion order tracks recency.
export function evictLeastRecentlyUsedEntries<Value>(cache: Map<string, Value>, capacity: number): void {
    while (cache.size > capacity) {
        const leastRecentKey = cache.keys().next().value as string;
        cache.delete(leastRecentKey);
    }
}



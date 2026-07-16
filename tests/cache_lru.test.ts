// Tests for the generic LRU primitives shared by the engine's sandbox memo and the viewer's
// artifact caches: a Map read that refreshes recency, and capacity eviction.

import { test } from "node:test";
import assert from "node:assert/strict";
import { getCachedValueRefreshingRecency, evictLeastRecentlyUsedEntries } from "../src/cache_lru.ts";

test("test_get_cached_value_refreshing_recency_moves_hit_to_newest", () => {
    // Scenario: reading "a" reorders it to newest, so "b" becomes the eviction candidate.
    const cache = new Map([["a", 1], ["b", 2]]);
    assert.equal(getCachedValueRefreshingRecency(cache, "a"), 1);
    assert.deepEqual([...cache.keys()], ["b", "a"]);
});

test("test_get_cached_value_refreshing_recency_misses_unknown_key", () => {
    // Scenario: a miss returns undefined and leaves the map untouched.
    const cache = new Map([["a", 1]]);
    assert.equal(getCachedValueRefreshingRecency(cache, "zz"), undefined);
    assert.deepEqual([...cache.keys()], ["a"]);
});

test("test_evict_least_recently_used_entries_drops_oldest_beyond_capacity", () => {
    // Scenario: capacity 2 over three insertions drops the oldest insertion only.
    const cache = new Map([["a", 1], ["b", 2], ["c", 3]]);
    evictLeastRecentlyUsedEntries(cache, 2);
    assert.deepEqual([...cache.keys()], ["b", "c"]);
});


// Task 162 proof rules for memoizing nested lineage replays.
import assert from "node:assert/strict";
import { test } from "node:test";
import {
    countActiveLineageReplayFrames,
    executeLineageReplayFrame,
    findServableLineageSeed,
    isInstantKeptByReplayWindow,
    isLineageKeyOnReplayStack,
    markLineageCacheServe,
    markLineageGuardHit,
    markLineageKeyQueried,
    storeLineageSeedWhenCacheable,
} from "../src/reconstruction_lineage_memo.ts";
import type { LineageSeedEntry } from "../src/reconstruction_lineage_memo.ts";

test("a clean frame completes cacheable and carries its subtree's queried keys", () => {
    const replayed = executeLineageReplayFrame("A|1", () => {
        markLineageKeyQueried("B|2");
        return "text-a";
    });
    assert.equal(replayed.text, "text-a");
    assert.notEqual(replayed.cacheable, null);
    assert.ok(replayed.cacheable!.queriedKeys.has("B|2"));
    assert.equal(countActiveLineageReplayFrames(), 0);
});

test("a guard hit poisons frames pushed after the hit key's frame but not that frame itself", () => {
    const outer = executeLineageReplayFrame("A|1", () => {
        const inner = executeLineageReplayFrame("B|2", () => {
            // the inner subtree re-queries the in-flight outer key — the classic seed cycle
            markLineageKeyQueried("A|1");
            markLineageGuardHit("A|1");
            return "degraded-b";
        });
        assert.equal(inner.cacheable, null);
        return "text-a";
    });
    assert.notEqual(outer.cacheable, null);
    assert.ok(outer.cacheable!.queriedKeys.has("A|1"));
});

test("a cached entry is servable only while none of its queried keys is in flight", () => {
    const seedsByKey = new Map<string, LineageSeedEntry>();
    seedsByKey.set("A|1", { text: "text-a", queriedKeys: new Set(["B|2"]) });
    assert.notEqual(findServableLineageSeed(seedsByKey, "A|1", true), null);
    executeLineageReplayFrame("B|2", () => {
        assert.equal(findServableLineageSeed(seedsByKey, "A|1", true), null);
        return undefined;
    });
    assert.notEqual(findServableLineageSeed(seedsByKey, "A|1", true), null);
});

test("a cached entry is not servable while a queried FILE is in flight at any instant", () => {
    // Task 220: the serve check must refuse on the queried key's path, not only its instant.
    const seedsByKey = new Map<string, LineageSeedEntry>();
    seedsByKey.set("A|h1", { text: "text-a", queriedKeys: new Set(["B|2"]) });
    executeLineageReplayFrame("B|3", () => {
        assert.equal(findServableLineageSeed(seedsByKey, "A|h1", true), null);
        return undefined;
    });
    assert.notEqual(findServableLineageSeed(seedsByKey, "A|h1", true), null);
});

test("a cached entry stays servable while an unrelated file is in flight", () => {
    // The path-level refusal must not fire for a different file with a matching instant.
    const seedsByKey = new Map<string, LineageSeedEntry>();
    seedsByKey.set("A|h1", { text: "text-a", queriedKeys: new Set(["B|2"]) });
    executeLineageReplayFrame("C|2", () => {
        assert.notEqual(findServableLineageSeed(seedsByKey, "A|h1", true), null);
        return undefined;
    });
});

test("a window-narrowed replay can neither read nor write the cache", () => {
    const seedsByKey = new Map<string, LineageSeedEntry>();
    seedsByKey.set("A|1", { text: "text-a", queriedKeys: new Set() });
    assert.equal(findServableLineageSeed(seedsByKey, "A|1", false), null);
    storeLineageSeedWhenCacheable(seedsByKey, "B|2", { text: "text-b", queriedKeys: new Set() }, false);
    assert.equal(seedsByKey.has("B|2"), false);
});

test("storeLineageSeedWhenCacheable stores only non-null entries", () => {
    const seedsByKey = new Map<string, LineageSeedEntry>();
    storeLineageSeedWhenCacheable(seedsByKey, "A|1", null, true);
    assert.equal(seedsByKey.size, 0);
    storeLineageSeedWhenCacheable(seedsByKey, "A|1", { text: "text-a", queriedKeys: new Set() }, true);
    assert.equal(seedsByKey.get("A|1")!.text, "text-a");
});

test("serving a cached entry hands its dependencies to the in-flight frames", () => {
    const served: LineageSeedEntry = { text: "text-c", queriedKeys: new Set(["D|4"]) };
    const outer = executeLineageReplayFrame("A|1", () => {
        markLineageCacheServe(served);
        return "text-a";
    });
    assert.ok(outer.cacheable!.queriedKeys.has("D|4"));
});

test("isInstantKeptByReplayWindow is false only when an earlier cutoff was already active", () => {
    const before = new Date("2026-01-02T00:00:00Z");
    assert.equal(isInstantKeptByReplayWindow(undefined, before), true);
    assert.equal(isInstantKeptByReplayWindow(new Date("2026-01-03T00:00:00Z"), before), true);
    assert.equal(isInstantKeptByReplayWindow(new Date("2026-01-01T00:00:00Z"), before), false);
});

test("a throwing compute pops its frame and propagates", () => {
    assert.throws(() =>
        executeLineageReplayFrame("A|1", () => {
            throw new Error("stage blew up");
        }),
    );
    assert.equal(countActiveLineageReplayFrames(), 0);
    assert.equal(isLineageKeyOnReplayStack("A|1"), false);
});

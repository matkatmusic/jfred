// tests/reconstruction_lineage_memo.test.ts — the task-162 proof rules for memoizing nested
// lineage replays: query tracking, guard-hit poisoning, serve validity, and the window gate.
import assert from "node:assert/strict";
import { test } from "node:test";
import {
    countActiveLineageReplayFrames,
    doesReplayWindowKeepInstant,
    findServableLineageSeed,
    isLineageKeyOnReplayStack,
    noteLineageCacheServe,
    recordLineageGuardHit,
    recordLineageKeyQuery,
    runLineageReplayFrame,
    storeLineageSeedWhenCacheable,
} from "../src/reconstruction_lineage_memo.ts";
import type { LineageSeedEntry } from "../src/reconstruction_lineage_memo.ts";

test("a clean frame completes cacheable and carries its subtree's queried keys", () => {
    const replayed = runLineageReplayFrame("A|1", () => {
        recordLineageKeyQuery("B|2");
        return "text-a";
    });
    assert.equal(replayed.text, "text-a");
    assert.notEqual(replayed.cacheable, null);
    assert.ok(replayed.cacheable!.queriedKeys.has("B|2"));
    assert.equal(countActiveLineageReplayFrames(), 0);
});

test("a guard hit poisons frames pushed after the hit key's frame but not that frame itself", () => {
    const outer = runLineageReplayFrame("A|1", () => {
        const inner = runLineageReplayFrame("B|2", () => {
            // the inner subtree re-queries the in-flight outer key — the classic seed cycle
            recordLineageKeyQuery("A|1");
            recordLineageGuardHit("A|1");
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
    runLineageReplayFrame("B|2", () => {
        assert.equal(findServableLineageSeed(seedsByKey, "A|1", true), null);
        return undefined;
    });
    assert.notEqual(findServableLineageSeed(seedsByKey, "A|1", true), null);
});

test("a cached entry is not servable while a queried FILE is in flight at any instant", () => {
    // Task 220: horizon keys let an entry be served at a different instant than it was computed
    // at; a fresh compute there would cycle-guard against the in-flight file — so the serve
    // check must refuse on the queried key's PATH, not just its exact instant.
    const seedsByKey = new Map<string, LineageSeedEntry>();
    seedsByKey.set("A|h1", { text: "text-a", queriedKeys: new Set(["B|2"]) });
    runLineageReplayFrame("B|3", () => {
        assert.equal(findServableLineageSeed(seedsByKey, "A|h1", true), null);
        return undefined;
    });
    assert.notEqual(findServableLineageSeed(seedsByKey, "A|h1", true), null);
});

test("a cached entry stays servable while an unrelated file is in flight", () => {
    // The path-level refusal must not over-trigger: a different file whose instant NUMBER
    // matches a queried key's instant is unrelated.
    const seedsByKey = new Map<string, LineageSeedEntry>();
    seedsByKey.set("A|h1", { text: "text-a", queriedKeys: new Set(["B|2"]) });
    runLineageReplayFrame("C|2", () => {
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
    const outer = runLineageReplayFrame("A|1", () => {
        noteLineageCacheServe(served);
        return "text-a";
    });
    assert.ok(outer.cacheable!.queriedKeys.has("D|4"));
});

test("doesReplayWindowKeepInstant is false only when an earlier cutoff was already active", () => {
    const before = new Date("2026-01-02T00:00:00Z");
    assert.equal(doesReplayWindowKeepInstant(undefined, before), true);
    assert.equal(doesReplayWindowKeepInstant(new Date("2026-01-03T00:00:00Z"), before), true);
    assert.equal(doesReplayWindowKeepInstant(new Date("2026-01-01T00:00:00Z"), before), false);
});

test("a throwing compute pops its frame and propagates", () => {
    assert.throws(() =>
        runLineageReplayFrame("A|1", () => {
            throw new Error("stage blew up");
        }),
    );
    assert.equal(countActiveLineageReplayFrames(), 0);
    assert.equal(isLineageKeyOnReplayStack("A|1"), false);
});

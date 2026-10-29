import { test } from "node:test";
import assert from "node:assert/strict";
import { FULL_VIEW, findPair } from "./layer1-filter-test-helpers.ts";

test("test_full_view_ruler_has_one_entry_per_instant_with_matching_counts", () => {
    assert.equal(FULL_VIEW.ruler.length, 9);
    assert.deepEqual(FULL_VIEW.ruler[0], { instant: "2026-07-01T08:00:00.000Z", axisPx: 0, eventCount: 1 });
    assert.deepEqual(FULL_VIEW.ruler[3], { instant: "2026-07-01T12:00:00.000Z", axisPx: 66, eventCount: 2 });
    assert.deepEqual(FULL_VIEW.ruler[8], { instant: "2026-07-01T17:00:00.000Z", axisPx: 198, eventCount: 1 });
});

test("test_find_pair_returns_the_pair_with_the_given_path", () => {
    assert.equal(findPair(FULL_VIEW, "src/keep/b.ts").path, "src/keep/b.ts");
});

test("test_find_pair_throws_when_no_pair_has_the_path", () => {
    assert.throws(() => findPair(FULL_VIEW, "src/missing.ts"), /no pair for src\/missing\.ts/);
});

// The Layer 1 stage render: the crumb counts, the empty state, and both orphan buckets.

import { test } from "node:test";
import assert from "node:assert/strict";
import { initLayer1Dom } from "./webapp-dom-test-helpers.ts";

initLayer1Dom();
const { renderLayer1Stage } = await import("../webapp/layer1-stage-render.ts");

const T0 = "2026-07-01T10:00:00.000Z";

function buildOrphan(path: string): object {
    return { path, instant: T0, axisPx: 0 };
}

test("test_an_empty_view_draws_the_empty_message_and_zero_counts", async () => {
    // Scenario: an empty view shows the empty message and zero counts.
    initLayer1Dom();
    await renderLayer1Stage({ pairs: [], gitOrphans: [], diskOrphans: [], ruler: [] } as never);
    assert.equal(document.getElementById("crumb")!.textContent, "0 pairs · 0 repo-only · 0 disk-only");
    assert.equal(document.querySelectorAll("#stage .nopairs").length, 1);
});

test("test_both_orphan_buckets_follow_the_pairs", async () => {
    // Scenario: repo-only files and disk-only files each get their own bucket after the pair widgets.
    initLayer1Dom();
    await renderLayer1Stage({
        pairs: [],
        gitOrphans: [buildOrphan("a.ts")],
        diskOrphans: [buildOrphan("b.ts")],
        ruler: [],
    } as never);
    assert.equal(document.getElementById("crumb")!.textContent, "0 pairs · 1 repo-only · 1 disk-only");
    const stageText = document.getElementById("stage")!.textContent!;
    assert.ok(stageText.indexOf("No on-disk match") < stageText.indexOf("No repository match"));
});

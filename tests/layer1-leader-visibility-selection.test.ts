// Dashed leader lines draw only on demand (user, 2026-07-26): tests assert the `shown` class, as happy-dom has no cascade.

import { test } from "node:test";
import assert from "node:assert/strict";
import { RULER_NODE_ROW_PIXELS } from "../webapp/layer1-ruler-axis.ts";
import {
    AT_EARLY,
    AT_SHARED,
    EARLY_HASH,
    LATE_PX,
    SHARED_PX,
    buildSharedInstantView,
    findBubble,
    findTickAt,
    triggerHover,
    listShownLeaderOffsets,
    loadPageWithView,
} from "./layer1-leader-visibility-test-helpers.ts";

test("test_hovering_a_stacked_snapshot_draws_the_line_at_its_bubble_s_tick", async () => {
    // Task 251 stacks the snapshot a row below its tied on-disk node; its line is still the tick's.
    await loadPageWithView({
        pairs: [{
            path: "src/index.ts",
            commits: [{ ...AT_EARLY, hash: EARLY_HASH }],
            onDisk: AT_SHARED,
            snapshots: [{ ...AT_SHARED, axisPx: SHARED_PX + RULER_NODE_ROW_PIXELS, version: 3, sessionId: "sess-a", sessionFile: "sess-a.jsonl" }],
        }],
        gitOrphans: [],
        diskOrphans: [],
        ruler: [{ ...AT_EARLY, eventCount: 1 }, { ...AT_SHARED, eventCount: 2 }],
    });
    const stacked = findBubble("index.ts").querySelector<HTMLElement>(".nlabel.n-snap");
    assert.ok(stacked, "no snapshot label was drawn");
    triggerHover(stacked);
    assert.deepEqual(listShownLeaderOffsets(), [SHARED_PX]);
});

test("test_a_landed_selection_keeps_its_line_up_after_the_pointer_moves_away", async () => {
    // Scenario: a landing is a SELECTION, so its line outlives the pointer.
    await loadPageWithView(buildSharedInstantView());
    const { markLandedElement } = await import("../webapp/layer1-find-file.ts");
    markLandedElement(findBubble("beginning.ts"));
    assert.deepEqual(listShownLeaderOffsets(), [SHARED_PX]);
    // mouse over an unrelated row and away again: the hover's line comes and goes...
    triggerHover(findTickAt(LATE_PX));
    assert.deepEqual(listShownLeaderOffsets().sort((a, b) => a - b), [SHARED_PX, LATE_PX]);
    triggerHover(undefined);
    // ...and the selection's line is still there.
    assert.deepEqual(listShownLeaderOffsets(), [SHARED_PX]);
});

// loadLineLabels and loadChipLineLocations: resolve nodes and chips to transcript lines from cached raw records.

import { test } from "node:test";
import assert from "node:assert/strict";
import { initWebappDom } from "./webapp-dom-test-helpers.ts";

test("test_line_labels_and_chip_locations_resolve_against_cached_raw_lines", async () => {
    initWebappDom();
    const { rawLinesCache } = await import("../webapp/app-fetch.ts");
    const { loadLineLabels, loadChipLineLocations } = await import("../webapp/views/timeline-line-locations.ts");
    const rawLines = [
        JSON.stringify({ type: "user", uuid: "u0" }),
        JSON.stringify({ type: "assistant", uuid: "u1", changeId: "chg-1" }),
    ];
    rawLinesCache.set("p|session-a.jsonl", rawLines);
    const context = {
        project: "p",
        listing: { jsonlFiles: [{ fileName: "session-a.jsonl" }] },
        nodes: [{ uuid: "u1", sessionId: "session-a", fileChanges: [{ path: "a.ts", changeId: "chg-1" }, { path: "b.ts" }] }],
        lineLabels: new Map(),
        chipLineLocations: new Map(),
    } as unknown as Parameters<typeof loadLineLabels>[0];
    await loadLineLabels(context);
    await loadChipLineLocations(context);
    assert.equal(context.lineLabels.get(0), "L:1 (of 1)");
    assert.equal(context.chipLineLocations.get("0:a.ts")!.line, 1);
    assert.equal(context.chipLineLocations.has("0:b.ts"), false);
});

// The drawer helpers record fetch asks, answer the diff route with FULL_DIFF, and build the one-node stage.

import { test } from "node:test";
import assert from "node:assert/strict";
import { initLayer1Dom } from "./webapp-dom-test-helpers.ts";
import {
    DISK_FILE_CONTENT, FULL_DIFF, buildDiskNodeStage, installRecordingFetch, waitForPendingFetches,
} from "./layer1-drawer-test-helpers.ts";

test("installRecordingFetch records each ask and answers the diff route with FULL_DIFF", async () => {
    const asks = installRecordingFetch(() => ({ content: DISK_FILE_CONTENT }));

    const content = await (await fetch("/api/layer1-file?path=a")).json();
    const diff = await (await fetch("/api/layer1-diff-content", { method: "POST", body: "{}" })).json();
    await waitForPendingFetches();

    assert.deepEqual(content, { content: DISK_FILE_CONTENT });
    assert.deepEqual(diff, { diff: FULL_DIFF });
    assert.equal(asks.length, 2);
    assert.equal(asks[1]!.body, "{}");
});

test("buildDiskNodeStage puts one on-disk node in the stage", () => {
    initLayer1Dom();

    const node = buildDiskNodeStage();

    assert.ok(node.classList.contains("n-disk"));
    assert.equal(document.getElementById("stage")!.querySelectorAll(".node").length, 1);
});

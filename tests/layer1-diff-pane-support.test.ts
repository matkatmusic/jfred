import { test } from "node:test";
import assert from "node:assert/strict";
import { getRequiredElementById } from "../webapp/app-dom.ts";
import { buildPairText, buildPatchText, computeArrowDisabledFlags, openToast, fetchDiffContent } from "../webapp/layer1-diff-pane-support.ts";
import { initLayer1Dom } from "./webapp-dom-test-helpers.ts";
import { installRecordingFetch } from "./layer1-drawer-test-helpers.ts";

test("buildPairText names an equal pair once and a range with both markers", () => {
    assert.deepEqual(buildPairText("a1", "b2", true), { label: "b2", meta: "" });
    assert.deepEqual(buildPairText("a1", "b2", false), { label: "a1 - b2", meta: "base a1 → target b2" });
});

test("computeArrowDisabledFlags disables a step that would leave the list", () => {
    assert.deepEqual(computeArrowDisabledFlags(0, 2, 3), [true, false, false, true]);
    assert.deepEqual(computeArrowDisabledFlags(1, 1, 3), [false, false, false, false]);
});

test("buildPatchText wraps hunks in git-apply headers", () => {
    assert.equal(buildPatchText("src/a.ts", "@@ -1 +1 @@"), "diff --git a/src/a.ts b/src/a.ts\n--- a/src/a.ts\n+++ b/src/a.ts\n@@ -1 +1 @@\n");
});

test("openToast shows the text in #dtoast", () => {
    initLayer1Dom();
    openToast("nothing to export");
    const toast = getRequiredElementById("dtoast");
    assert.equal(toast.textContent, "nothing to export");
    assert.equal(toast.hidden, false);
});

test("fetchDiffContent posts both sides and asks for full context only when told", async () => {
    const asks = installRecordingFetch(() => ({}));
    await fetchDiffContent("old", "new", true);
    await fetchDiffContent("old", "new", false);
    assert.deepEqual(JSON.parse(asks[0]!.body!), { base: "old", target: "new", context: "full" });
    assert.deepEqual(JSON.parse(asks[1]!.body!), { base: "old", target: "new" });
});

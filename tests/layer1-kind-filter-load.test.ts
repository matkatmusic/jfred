// Task 360: the Edit and Script run boxes load once, redraw once, and survive a cancelled fetch.

import { test } from "node:test";
import assert from "node:assert/strict";
import { stopLayer1Load } from "../webapp/layer1-progress.ts";
import { initLayer1Dom, waitForAsyncWork } from "./webapp-dom-test-helpers.ts";
import { installStreamRoute } from "./webapp-fetch-test-helpers.ts";
import { buildFreshView, readHiddenKinds, toggleBox } from "./layer1-kind-filter-helpers.ts";

// layer1-page.ts boots at MODULE SCOPE, so absorb that first boot here against a throwaway DOM.
initLayer1Dom();
const { renderShowRowWithKindFilter } = await import("../webapp/layer1-kind-filter.ts");

test("test_ticking_the_edit_box_loads_and_redraws_once_then_later_ticks_only_flip_the_attribute", async () => {
    initLayer1Dom();
    installStreamRoute("/api/layer1-edits", [{ pairs: [] }]);
    let redraws = 0;
    renderShowRowWithKindFilter(buildFreshView(), () => {
        redraws += 1;
    });
    toggleBox("edit", true);
    await waitForAsyncWork();
    assert.equal(redraws, 1);
    assert.equal(readHiddenKinds(), "script-run branch");
    toggleBox("edit", false);
    toggleBox("edit", true);
    await waitForAsyncWork();
    assert.equal(redraws, 1);
    assert.equal(readHiddenKinds(), "script-run branch");
});

test("test_ticking_the_script_run_box_loads_and_redraws_once_then_later_ticks_only_flip_the_attribute", async () => {
    initLayer1Dom();
    installStreamRoute("/api/layer1-script-runs", [{ pairs: [] }]);
    let redraws = 0;
    renderShowRowWithKindFilter(buildFreshView(), () => {
        redraws += 1;
    });
    assert.equal(readHiddenKinds(), "edit script-run branch");
    toggleBox("script-run", true);
    await waitForAsyncWork();
    assert.equal(redraws, 1);
    assert.equal(readHiddenKinds(), "edit branch");
    toggleBox("script-run", false);
    toggleBox("script-run", true);
    await waitForAsyncWork();
    assert.equal(redraws, 1);
    assert.equal(readHiddenKinds(), "edit branch");
});

test("test_a_cancelled_script_run_fetch_leaves_the_box_unchecked_and_the_nodes_hidden", async () => {
    initLayer1Dom();
    Object.assign(globalThis, { fetch: async () => {
        stopLayer1Load();
        throw new Error("aborted");
    } });
    renderShowRowWithKindFilter(buildFreshView(), () => {});
    toggleBox("script-run", true);
    await waitForAsyncWork();
    assert.equal(document.querySelector<HTMLInputElement>("#show-row [data-kind=script-run]")!.checked, false);
    assert.equal(readHiddenKinds(), "edit script-run branch");
});

test("test_the_layer_4_button_ticks_the_edit_box_then_the_script_run_box_and_skips_a_box_already_on", async () => {
    initLayer1Dom();
    installStreamRoute("/api/layer1-edits", [{ pairs: [] }]);
    const editFetch = globalThis.fetch;
    installStreamRoute("/api/layer1-script-runs", [{ pairs: [] }]);
    const scriptRunFetch = globalThis.fetch;
    const requested: string[] = [];
    Object.assign(globalThis, { fetch: (url: unknown, init?: RequestInit) => {
        requested.push(String(url).split("?")[0]!);
        return (String(url).includes("/api/layer1-edits") ? editFetch : scriptRunFetch)(url as string, init);
    } });
    let redraws = 0;
    renderShowRowWithKindFilter(buildFreshView(), () => {
        redraws += 1;
    });
    document.getElementById("layer-4")!.click();
    await waitForAsyncWork();
    assert.deepEqual(requested, ["/api/layer1-edits", "/api/layer1-script-runs"]);
    assert.equal(redraws, 2);
    assert.equal(readHiddenKinds(), "branch");
    document.getElementById("layer-4")!.click();
    await waitForAsyncWork();
    assert.equal(requested.length, 2);
});

test("test_a_cancelled_edit_fetch_leaves_the_box_unchecked_and_the_nodes_hidden", async () => {
    initLayer1Dom();
    Object.assign(globalThis, { fetch: async () => {
        stopLayer1Load();
        throw new Error("aborted");
    } });
    renderShowRowWithKindFilter(buildFreshView(), () => {});
    toggleBox("edit", true);
    await waitForAsyncWork();
    assert.equal(document.querySelector<HTMLInputElement>("#show-row [data-kind=edit]")!.checked, false);
    assert.equal(readHiddenKinds(), "edit script-run branch");
});

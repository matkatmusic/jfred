// Task 360: the Branch box loads once, waits for the redraw, and unticks on a failed fetch.

import { test } from "node:test";
import assert from "node:assert/strict";
import { initLayer1Dom, waitForAsyncWork } from "./webapp-dom-test-helpers.ts";
import { installStreamRoute } from "./webapp-fetch-test-helpers.ts";
import { buildFreshView, readHiddenKinds, toggleBox } from "./layer1-kind-filter-helpers.ts";

// layer1-page.ts boots at MODULE SCOPE, so absorb that first boot here against a throwaway DOM.
initLayer1Dom();
const { renderShowRowWithKindFilter } = await import("../webapp/layer1-kind-filter.ts");

test("test_ticking_the_branch_box_loads_and_redraws_once_then_later_ticks_only_flip_the_attribute", async () => {
    initLayer1Dom();
    installStreamRoute("/api/layer1-branches", [{ pairs: [] }]);
    let redraws = 0;
    renderShowRowWithKindFilter(buildFreshView(), () => {
        redraws += 1;
    });
    assert.equal(readHiddenKinds(), "edit script-run branch");
    toggleBox("branch", true);
    await waitForAsyncWork();
    assert.equal(redraws, 1);
    assert.equal(readHiddenKinds(), "edit script-run");
    toggleBox("branch", false);
    toggleBox("branch", true);
    await waitForAsyncWork();
    assert.equal(redraws, 1);
    assert.equal(readHiddenKinds(), "edit script-run");
});

test("test_the_branch_box_waits_for_the_redraw_promise_before_it_unhides_the_kind", async () => {
    initLayer1Dom();
    installStreamRoute("/api/layer1-branches", [{ pairs: [] }]);
    let finishRedraw: () => void = () => {};
    renderShowRowWithKindFilter(buildFreshView(), () => new Promise<void>((resolve) => {
        finishRedraw = resolve;
    }));
    toggleBox("branch", true);
    await waitForAsyncWork();
    assert.equal(readHiddenKinds(), "edit script-run branch");
    finishRedraw();
    await waitForAsyncWork();
    assert.equal(readHiddenKinds(), "edit script-run");
});

test("test_a_failed_branch_fetch_unticks_the_box_and_keeps_the_kind_hidden", async () => {
    initLayer1Dom();
    Object.assign(globalThis, { fetch: async () => ({ ok: false, status: 500, text: async () => "boom" }) });
    renderShowRowWithKindFilter(buildFreshView(), () => {});
    toggleBox("branch", true);
    await waitForAsyncWork();
    assert.equal(document.querySelector<HTMLInputElement>("#show-row [data-kind=branch]")!.checked, false);
    assert.equal(readHiddenKinds(), "edit script-run branch");
});

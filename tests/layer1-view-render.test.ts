// The Layer 1 view render's folder-selection filter helpers.

import { test } from "node:test";
import assert from "node:assert/strict";
import { initLayer1Dom } from "./webapp-dom-test-helpers.ts";

initLayer1Dom();
const { clearFolderFilterState, getIntersectedFilterTargets } = await import("../webapp/layer1-view-render.ts");

test("test_two_idle_pickers_do_not_filter", () => {
    assert.equal(getIntersectedFilterTargets([], []), undefined);
});

test("test_one_idle_picker_passes_the_other_through", () => {
    assert.deepEqual(getIntersectedFilterTargets(["a.ts"], []), ["a.ts"]);
    assert.deepEqual(getIntersectedFilterTargets([], ["b.ts"]), ["b.ts"]);
});

test("test_two_active_pickers_keep_only_shared_paths", () => {
    assert.deepEqual(getIntersectedFilterTargets(["a.ts", "b.ts"], ["b.ts", "c.ts"]), ["b.ts"]);
    assert.deepEqual(getIntersectedFilterTargets(["a.ts"], ["c.ts"]), []);
});

test("test_clearing_the_filter_state_drops_the_only_selected_highlight", () => {
    // Scenario: a fresh project must not start with the only-selected button lit.
    initLayer1Dom();
    const button = document.getElementById("filenav-only-selected") ?? document.body.appendChild(document.createElement("button"));
    button.id = "filenav-only-selected";
    button.classList.add("current");
    clearFolderFilterState();
    assert.equal(button.classList.contains("current"), false);
});

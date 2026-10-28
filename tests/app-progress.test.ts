// DOM tests for the timeline-scoped loading overlay and its Cancel button (task 164).

import { test } from "node:test";
import assert from "node:assert/strict";
import { initWebappDom } from "./webapp-dom-test-helpers.ts";

// Dynamic import runs after the DOM globals exist; each test hides the overlay to reset the singleton.
async function showProgressInFreshDom(): Promise<typeof import("../webapp/app-progress.ts")> {
    initWebappDom();
    const progressModule = await import("../webapp/app-progress.ts");
    progressModule.renderLoadingProgress("constructing branches", Number.NaN);
    return progressModule;
}

// The first element matching `selector`, asserted present — a missing element fails the test naming the selector.
function getRequiredElement(selector: string): HTMLElement {
    const element = document.querySelector(selector);
    assert.ok(element !== null, `${selector} exists`);
    return element as HTMLElement;
}

test("test_renderLoadingProgress_mounts_the_overlay_inside_the_timeline_pane", async () => {
    // Scenario: the overlay covers only the timeline pane, so the console and inspector stay usable.
    const progressModule = await showProgressInFreshDom();
    try {
        // assert the overlay's parent is the timeline pane, not document.body.
        const overlay = getRequiredElement(".timeline-progress-overlay");
        assert.equal(overlay.parentElement?.id, "timeline-pane");
    } finally {
        progressModule.hideLoadingProgress();
    }
});

test("test_cancel_button_reveals_the_inline_confirm_row", async () => {
    // Scenario: clicking Cancel swaps in the confirm row and does not navigate yet.
    const progressModule = await showProgressInFreshDom();
    try {
        // the confirm row starts hidden.
        const confirmRow = getRequiredElement(".timeline-progress-confirm");
        assert.equal(confirmRow.hidden, true);
        // click Cancel: the confirm row appears, the Cancel button hides.
        getRequiredElement(".timeline-progress-cancel").click();
        assert.equal(confirmRow.hidden, false);
        assert.equal(getRequiredElement(".timeline-progress-cancel").hidden, true);
        // no navigation happened before the user confirms.
        assert.equal(window.location.hash, "");
    } finally {
        progressModule.hideLoadingProgress();
    }
});

test("test_confirm_no_restores_the_cancel_button", async () => {
    // Scenario: answering "No" returns the box to its pre-cancel state.
    const progressModule = await showProgressInFreshDom();
    try {
        getRequiredElement(".timeline-progress-cancel").click();
        // click "No": the confirm row hides and the Cancel button returns.
        getRequiredElement(".timeline-progress-confirm-no").click();
        assert.equal(getRequiredElement(".timeline-progress-confirm").hidden, true);
        assert.equal(getRequiredElement(".timeline-progress-cancel").hidden, false);
    } finally {
        progressModule.hideLoadingProgress();
    }
});

test("test_confirm_yes_navigates_to_the_project_picker", async () => {
    // Scenario: answering "Yes, cancel" navigates to "#/", which aborts the in-flight load.
    const progressModule = await showProgressInFreshDom();
    try {
        window.location.hash = "#/project/demo";
        // open the confirm row and answer "Yes, cancel".
        getRequiredElement(".timeline-progress-cancel").click();
        getRequiredElement(".timeline-progress-confirm-yes").click();
        // the route is the project picker.
        assert.equal(window.location.hash, "#/");
    } finally {
        progressModule.hideLoadingProgress();
    }
});

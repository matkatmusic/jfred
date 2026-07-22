// DOM tests for webapp/app-progress.ts (task 164): the loading overlay is scoped to the
// timeline pane (the console stays usable underneath) and carries a Cancel button whose
// in-DOM confirm navigates back to the project picker. Runs against a happy-dom window
// carrying the real index.html markup (webapp-dom-test-helpers.ts installs the globals).

import { test } from "node:test";
import assert from "node:assert/strict";
import { setupWebappDom } from "./webapp-dom-test-helpers.ts";

// Boot a fresh DOM and show the overlay once. The dynamic import keeps the webapp module load
// AFTER the happy-dom globals exist; each test calls hideLoadingProgress in its finally so the
// module-level singleton resets and the next test builds fresh elements in its own document.
async function showProgressInFreshDom(): Promise<typeof import("../webapp/app-progress.ts")> {
    setupWebappDom();
    const progressModule = await import("../webapp/app-progress.ts");
    progressModule.showLoadingProgress("constructing branches", Number.NaN);
    return progressModule;
}

// The first element matching `selector`, asserted present — a missing element fails the test
// naming the selector.
function getRequiredElement(selector: string): HTMLElement {
    const element = document.querySelector(selector);
    assert.ok(element !== null, `${selector} exists`);
    return element as HTMLElement;
}

test("test_showLoadingProgress_mounts_the_overlay_inside_the_timeline_pane", async () => {
    // Scenario: the overlay must block ONLY the timeline pane, so the console and inspector
    // stay usable during a load (task 164).
    // Steps:
    // boot the DOM and show the overlay.
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
    // Scenario: clicking Cancel swaps in the in-DOM confirm row — it must NOT navigate yet.
    // Steps:
    // boot the DOM and show the overlay.
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
    // Steps:
    // boot the DOM, show the overlay, and open the confirm row.
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
    // Scenario: answering "Yes, cancel" navigates to "#/" — the hashchange-driven renderRoute
    // aborts the in-flight load (app-router.ts), so navigation IS the cancellation.
    // Steps:
    // boot the DOM on a project route and show the overlay.
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

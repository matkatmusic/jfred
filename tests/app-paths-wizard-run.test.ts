// DOM tests for webapp/app-paths-wizard-run.ts (task 159): run launch, navigation, and cancel.

import { test } from "node:test";
import assert from "node:assert/strict";
import { initWebappDom } from "./webapp-dom-test-helpers.ts";

function getElement(id: string): HTMLElement {
    const element = document.getElementById(id);
    assert.ok(element !== null, `#${id} exists`);
    return element;
}

test("test_launch_wizard_run_opens_popover_on_first_screen_with_back_disabled", async () => {
    initWebappDom();
    const { launchWizardRun, stopWizardRun } = await import("../webapp/app-paths-wizard-run.ts");
    launchWizardRun([1, 2], undefined);
    assert.equal(getElement("paths-popover").hidden, false);
    assert.equal(getElement("wizard-screen-1").hidden, false);
    assert.equal((getElement("wizard-back") as HTMLButtonElement).disabled, true);
    assert.equal(getElement("wizard-next").textContent, "Next ▸");
    stopWizardRun();
});

test("test_move_wizard_forward_then_back_walks_screens", async () => {
    initWebappDom();
    const { launchWizardRun, moveWizardForward, moveWizardBack, stopWizardRun } = await import("../webapp/app-paths-wizard-run.ts");
    launchWizardRun([1, 2], undefined);
    moveWizardForward();
    assert.equal(getElement("wizard-screen-2").hidden, false);
    assert.equal(getElement("wizard-next").textContent, "Finish ▸");
    moveWizardBack();
    assert.equal(getElement("wizard-screen-1").hidden, false);
    stopWizardRun();
});

test("test_stop_wizard_run_hides_popover_and_shows_summary", async () => {
    initWebappDom();
    const { launchWizardRun, stopWizardRun } = await import("../webapp/app-paths-wizard-run.ts");
    launchWizardRun([1], undefined);
    stopWizardRun();
    assert.equal(getElement("paths-popover").hidden, true);
    assert.equal(getElement("paths-summary").hidden, false);
});

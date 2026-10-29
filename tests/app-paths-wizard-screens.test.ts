// DOM tests for webapp/app-paths-wizard-screens.ts (task 159): popover face selection and screen prefill.

import { test } from "node:test";
import assert from "node:assert/strict";
import { initWebappDom } from "./webapp-dom-test-helpers.ts";

function getElement(id: string): HTMLElement {
    const element = document.getElementById(id);
    assert.ok(element !== null, `#${id} exists`);
    return element;
}

test("test_select_popover_face_shows_only_the_named_face", async () => {
    initWebappDom();
    const { selectPopoverFace } = await import("../webapp/app-paths-wizard-screens.ts");
    selectPopoverFace("wizard-screen-3");
    assert.equal(getElement("wizard-screen-3").hidden, false);
    assert.equal(getElement("paths-summary").hidden, true);
    assert.equal(getElement("wizard-nav").hidden, false);
    selectPopoverFace("paths-summary");
    assert.equal(getElement("paths-summary").hidden, false);
    assert.equal(getElement("wizard-nav").hidden, true);
});

test("test_fill_screen_3_checks_yes_only_when_repo_field_is_set", async () => {
    initWebappDom();
    const { fillScreen } = await import("../webapp/app-paths-wizard-screens.ts");
    (getElement("repo-dir-input") as HTMLInputElement).value = "/repos/p";
    fillScreen(3, undefined);
    assert.equal((getElement("wizard-repo-yes") as HTMLInputElement).checked, true);
    (getElement("repo-dir-input") as HTMLInputElement).value = "";
    fillScreen(3, undefined);
    assert.equal((getElement("wizard-repo-no") as HTMLInputElement).checked, true);
});

test("test_clear_repo_fields_empties_repo_and_base_commit", async () => {
    initWebappDom();
    const { clearRepoFields } = await import("../webapp/app-paths-wizard-screens.ts");
    (getElement("repo-dir-input") as HTMLInputElement).value = "/repos/p";
    (getElement("base-commit-display") as HTMLInputElement).value = "abc";
    clearRepoFields();
    assert.equal((getElement("repo-dir-input") as HTMLInputElement).value, "");
    assert.equal((getElement("base-commit-display") as HTMLInputElement).value, "");
});

test("test_find_route_project_name_reads_project_segment", async () => {
    initWebappDom();
    const { findRouteProjectName } = await import("../webapp/app-paths-wizard-screens.ts");
    location.hash = "#/project/demo";
    assert.equal(findRouteProjectName(), "demo");
    location.hash = "#/";
    assert.equal(findRouteProjectName(), undefined);
});

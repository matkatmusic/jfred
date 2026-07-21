// DOM smoke tests for webapp/app-header.ts (task 122): the config-driven folder inputs and the
// toolbar popover model, run against a happy-dom window carrying the real index.html markup
// (webapp-dom-test-helpers.ts installs the globals the webapp import chain expects).

import { test } from "node:test";
import assert from "node:assert/strict";
import { flushAsyncWork, setupWebappDom, stubFetchRoutes } from "./webapp-dom-test-helpers.ts";

// Boot a fresh DOM, stub the two endpoints initializeHeader touches, and run it. The dynamic
// import keeps every webapp module load AFTER the globals exist; re-initializing per test is
// safe because initializeHeader re-resolves every element by id on each call, and listeners
// from a previous test's window resolve ids against that abandoned document.
async function initializeHeaderInFreshDom(): Promise<void> {
    setupWebappDom();
    stubFetchRoutes({
        "/api/config": { projectsDir: "/tmp/projects", fileHistoryDir: "/tmp/file-history", bootId: "boot-1" },
        "/api/projects": [{ name: "proj-a" }, { name: "proj-b" }],
    });
    const { initializeHeader } = await import("../webapp/app-header.ts");
    await initializeHeader();
}

// The element with `id`, asserted present — a missing id fails the test naming the id.
function getRequiredElementById(id: string): HTMLElement {
    const element = document.getElementById(id);
    assert.ok(element !== null, `#${id} exists`);
    return element;
}

test("test_initializeHeader_fills_folder_inputs_from_config", async () => {
    // Scenario: initializeHeader fetches /api/config and mirrors the reported folders into the
    // two Paths inputs.
    // Steps:
    // boot the DOM and run initializeHeader against the stubbed config.
    await initializeHeaderInFreshDom();
    // assert both folder inputs carry the stubbed config values.
    assert.equal((getRequiredElementById("projects-dir-input") as HTMLInputElement).value, "/tmp/projects");
    assert.equal((getRequiredElementById("file-history-dir-input") as HTMLInputElement).value, "/tmp/file-history");
});

test("test_projects_button_opens_menu_and_document_click_closes_it", async () => {
    // Scenario: the Projects button opens its popover (its stopPropagation keeps the
    // document-level closer out), the menu fills with one row per project, and a plain
    // document click closes every popover again.
    // Steps:
    // boot the DOM and run initializeHeader.
    await initializeHeaderInFreshDom();
    const projectsMenu = getRequiredElementById("projects-menu");
    // the menu starts hidden (index.html markup).
    assert.equal(projectsMenu.hidden, true);
    // click the Projects button: the popover opens despite the document-level closer.
    getRequiredElementById("projects-btn").click();
    assert.equal(projectsMenu.hidden, false);
    // the fire-and-forget populate settles: one .menu-item per stubbed project, in order.
    await flushAsyncWork();
    const menuItems = [...projectsMenu.querySelectorAll(".menu-item")];
    assert.deepEqual(menuItems.map((item) => item.textContent), ["proj-a", "proj-b"]);
    // a plain document-level click closes both popovers.
    document.body.click();
    assert.equal(projectsMenu.hidden, true);
    assert.equal(getRequiredElementById("paths-popover").hidden, true);
});

test("test_paths_popover_stays_open_on_inside_click", async () => {
    // Scenario: clicks inside the paths popover (typing in the inputs) stop propagation so the
    // document-level closer never fires; only the apply button lets its click through.
    // Steps:
    // boot the DOM and run initializeHeader.
    await initializeHeaderInFreshDom();
    const pathsPopover = getRequiredElementById("paths-popover");
    // open the popover via its toolbar button.
    getRequiredElementById("paths-btn").click();
    assert.equal(pathsPopover.hidden, false);
    // click an inside element that is NOT the apply button (#projects-dir-change).
    getRequiredElementById("projects-dir-input").click();
    // assert the popover stayed open.
    assert.equal(pathsPopover.hidden, false);
});

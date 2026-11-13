// The Layer 1 page layout (plan steps 18, 19, 20): where each named box sits and what it holds.

import { test } from "node:test";
import assert from "node:assert/strict";
import { initLayer1Dom } from "./webapp-dom-test-helpers.ts";
import { buildLayer1Layout } from "../webapp/layer1-layout.ts";
import { installProjectSettingsToggle } from "../webapp/layer1-components/top-bars/layer1-project-settings-toggle.ts";

function getRequiredBox(boxId: string): HTMLElement {
    const box = document.getElementById(boxId);
    assert.ok(box, `missing #${boxId}`);
    return box;
}

function getChildIds(parent: HTMLElement): string[] {
    return Array.from(parent.children).map((child) => child.id);
}

function getChildIndex(parent: HTMLElement, child: HTMLElement): number {
    return Array.from(parent.children).indexOf(child);
}

const HEADER_ROW_CHILD_SELECTORS = [
    "h1",
    "#crumb",
    ".timebar",
    "#project-settings",
    "#commit-mode",
    "#clear-results",
    "[data-component-inspector-toggle]",
    "#clear-results-confirm",
    ".zoombar",
    ".layerbar",
];

test("test_header_row_holds_title_crumb_controls_in_page_order", () => {
    // Scenario: headerRowComponent holds the old header children, in the old page order.
    // Steps: open the real page markup.
    initLayer1Dom();
    const headerRow = getRequiredBox("headerRowComponent");
    // The row holds exactly the ten old header children.
    assert.equal(headerRow.children.length, HEADER_ROW_CHILD_SELECTORS.length);
    // Each child, in order, matches the selector of the part that belongs there.
    for (const [index, selector] of HEADER_ROW_CHILD_SELECTORS.entries()) {
        assert.ok(headerRow.children[index]!.matches(selector), `child ${index} should match ${selector}`);
    }
});

test("test_title_and_crumb_stay_at_the_left_of_the_header_row", () => {
    // Scenario: the title and the crumb are the first two parts of the row.
    initLayer1Dom();
    const headerRow = getRequiredBox("headerRowComponent");
    // The first child is the title.
    assert.equal(headerRow.children[0]!.tagName, "H1");
    // The second child is the crumb.
    assert.equal(headerRow.children[1]!.id, "crumb");
});

test("test_both_source_rows_sit_under_the_header_row", () => {
    // Scenario: the two source rows are the 2nd and 3rd children of headerContainer.
    initLayer1Dom();
    const headerContainer = getRequiredBox("headerContainer");
    // The header row is the first child.
    assert.equal(headerContainer.children[0], getRequiredBox("headerRowComponent"));
    // The second child is the folder row: a .sources row that is not the repo row.
    assert.ok(headerContainer.children[1]!.classList.contains("sources"));
    assert.equal(headerContainer.children[1]!.classList.contains("repo"), false);
    // The third child is the git repo row.
    assert.ok(headerContainer.children[2]!.classList.contains("sources"));
    assert.ok(headerContainer.children[2]!.classList.contains("repo"));
});

test("test_engine_bar_is_the_last_child_of_the_header_container_right_after_the_jump_row", () => {
    // Scenario: the engine bar closes the header container, after the jump row.
    initLayer1Dom();
    const headerContainer = getRequiredBox("headerContainer");
    // The last child is the engine bar.
    assert.equal(headerContainer.lastElementChild?.id, "engine-v3-bar");
    // The engine bar follows the jump row directly.
    assert.equal(getRequiredBox("jumpToRowComponent").nextElementSibling, headerContainer.lastElementChild);
});

test("test_project_settings_button_shows_both_source_rows", () => {
    // Scenario: a click on the project settings button opens the two source rows under headerContainer.
    initLayer1Dom();
    installProjectSettingsToggle();
    const appWindow = getRequiredBox("appWindow");
    // The rows start hidden.
    assert.equal(appWindow.classList.contains("project-settings-open"), false);
    // Both source rows are children of headerContainer.
    assert.equal(document.querySelectorAll("#headerContainer > .sources").length, 2);
    // A click on the button marks the page as showing the rows.
    getRequiredBox("project-settings").click();
    assert.equal(appWindow.classList.contains("project-settings-open"), true);
});

test("test_building_the_layout_twice_keeps_one_of_each_box", () => {
    // Scenario: a second build call changes nothing.
    initLayer1Dom();
    const headerContainer = getRequiredBox("headerContainer");
    const childCountBefore = headerContainer.children.length;
    const childIdsBefore = getChildIds(headerContainer);
    // Build again.
    buildLayer1Layout();
    // There is still exactly one of each header box.
    assert.equal(document.querySelectorAll("#headerContainer").length, 1);
    assert.equal(document.querySelectorAll("#headerRowComponent").length, 1);
    // The header container holds the same children, in the same order.
    assert.equal(getRequiredBox("headerContainer"), headerContainer);
    assert.equal(headerContainer.children.length, childCountBefore);
    assert.deepEqual(getChildIds(headerContainer), childIdsBefore);
});

test("test_every_new_box_has_id_class_and_data_component_with_the_same_name", () => {
    // Scenario: each header box carries its name three times: id, class, data-component.
    initLayer1Dom();
    // Check each name in turn.
    for (const boxName of ["headerContainer", "headerRowComponent"]) {
        const box = getRequiredBox(boxName);
        assert.equal(box.id, boxName);
        assert.ok(box.classList.contains(boxName), `${boxName} class`);
        assert.equal(box.getAttribute("data-component"), boxName);
    }
});

test("test_session_data_container_holds_sources_on_the_left_and_timeline_components_on_the_right", () => {
    // Scenario: sourcesContainer comes first, timelineComponentsContainer comes after it.
    initLayer1Dom();
    const sessionDataContainer = getRequiredBox("sessionDataContainer");
    const sourcesContainer = getRequiredBox("sourcesContainer");
    const timelineComponentsContainer = getRequiredBox("timelineComponentsContainer");
    // Both boxes are children of sessionDataContainer.
    assert.equal(sourcesContainer.parentElement, sessionDataContainer);
    assert.equal(timelineComponentsContainer.parentElement, sessionDataContainer);
    // The sources box is the first child, so it sits at the left.
    assert.equal(sessionDataContainer.children[0], sourcesContainer);
    // The timeline box comes after the sources box, so it sits at the right.
    assert.ok(getChildIndex(sessionDataContainer, timelineComponentsContainer) > getChildIndex(sessionDataContainer, sourcesContainer));
    // The session data container is a child of the app window.
    assert.equal(sessionDataContainer.parentElement, getRequiredBox("appWindow"));
});

test("test_sources_container_holds_file_nav_then_jsonls", () => {
    // Scenario: file nav is the top pane and jsonls is the bottom pane of sourcesContainer.
    initLayer1Dom();
    const sourcesContainer = getRequiredBox("sourcesContainer");
    const fileNav = getRequiredBox("fileNavComponent");
    const jsonls = getRequiredBox("jsonlsComponent");
    // Both panes are children of the sources container.
    assert.equal(fileNav.parentElement, sourcesContainer);
    assert.equal(jsonls.parentElement, sourcesContainer);
    // File nav comes first.
    assert.ok(getChildIndex(sourcesContainer, fileNav) < getChildIndex(sourcesContainer, jsonls));
});

test("test_file_nav_and_jsonls_start_with_grow_3_and_2_and_min_size_80", () => {
    // Scenario: the two source panes share the height 3 to 2 and never get shorter than 80 pixels.
    initLayer1Dom();
    const fileNav = getRequiredBox("fileNavComponent");
    const jsonls = getRequiredBox("jsonlsComponent");
    // File nav: grow 3, min size 80.
    assert.equal(fileNav.style.flexGrow, "3");
    assert.equal(fileNav.style.minHeight, "80px");
    // Jsonls: grow 2, min size 80.
    assert.equal(jsonls.style.flexGrow, "2");
    assert.equal(jsonls.style.minHeight, "80px");
});

test("test_column_grip_follows_sources_container_inside_session_data_container", () => {
    // Scenario: the column grip is the next sibling of sourcesContainer.
    initLayer1Dom();
    const grip = getRequiredBox("filenav-grip");
    // The grip is a child of sessionDataContainer.
    assert.equal(grip.parentElement, getRequiredBox("sessionDataContainer"));
    // The grip comes right after sourcesContainer.
    assert.equal(grip.previousElementSibling, getRequiredBox("sourcesContainer"));
});

test("test_timeline_components_container_orders_loadbar_controls_then_timeline", () => {
    // Scenario: the right column holds three parts, top to bottom.
    initLayer1Dom();
    const timelineComponentsContainer = getRequiredBox("timelineComponentsContainer");
    // The three parts are the only children, in this order.
    assert.deepEqual(getChildIds(timelineComponentsContainer), [
        "loadbar",
        "timelineViewControls",
        "timelineContainer",
    ]);
});

test("test_loading_bar_sits_directly_above_the_timeline_view_controls", () => {
    // Scenario: nothing sits between the loading bar and the controls.
    initLayer1Dom();
    // The next sibling of the loading bar is the controls.
    assert.equal(getRequiredBox("loadbar").nextElementSibling, getRequiredBox("timelineViewControls"));
});

test("test_timeline_container_holds_one_canvas_that_holds_ruler_container_then_bubble_container", () => {
    // Scenario: the scroll box has one child, the canvas, and the canvas holds the two containers side by side.
    initLayer1Dom();
    const timelineContainer = getRequiredBox("timelineContainer");
    // The scroll box holds exactly one child, the canvas.
    assert.equal(timelineContainer.children.length, 1);
    const canvas = timelineContainer.children[0]!;
    assert.ok(canvas.classList.contains("canvas"));
    // The ruler container is a child of the canvas.
    const rulerContainer = getRequiredBox("timelineRulerContainer");
    assert.equal(rulerContainer.parentElement, canvas);
    // The bubble container comes right after the ruler container.
    assert.equal(rulerContainer.nextElementSibling, getRequiredBox("fileBubbleContainer"));
});

test("test_leaders_washes_and_ranges_stay_inside_the_canvas", () => {
    // Scenario: the three background layers are children of the canvas.
    initLayer1Dom();
    const canvas = getRequiredBox("timelineContainer").children[0]!;
    // Each layer sits directly in the canvas.
    for (const layerId of ["leaders", "washes", "ranges"]) {
        assert.equal(getRequiredBox(layerId).parentElement, canvas, `#${layerId} parent`);
    }
});

test("test_minimap_is_the_first_child_of_the_timeline_ruler_container", () => {
    // Scenario: the minimap is the first child of timelineRulerContainer, not a child of sessionDataContainer.
    initLayer1Dom();
    const sessionDataContainer = getRequiredBox("sessionDataContainer");
    const minimap = document.querySelector(".minimapComponent");
    assert.ok(minimap, "missing .minimapComponent");
    // The minimap parent is timelineRulerContainer, and the minimap comes first.
    assert.equal(minimap.parentElement!.id, "timelineRulerContainer");
    assert.equal(minimap.parentElement!.children[0], minimap);
    // sessionDataContainer now holds three children, in this order.
    assert.equal(sessionDataContainer.children.length, 3);
    assert.equal(sessionDataContainer.children[0]!.id, "sourcesContainer");
    assert.equal(sessionDataContainer.children[1]!.id, "filenav-grip");
    assert.equal(sessionDataContainer.children[2]!.id, "timelineComponentsContainer");
});

test("test_ruler_container_holds_the_minimap_and_the_ruler_at_first", () => {
    // Scenario: before any session lines or commit strip exist, the ruler container holds two children.
    initLayer1Dom();
    const rulerContainer = getRequiredBox("timelineRulerContainer");
    // Two children.
    assert.equal(rulerContainer.children.length, 2);
    // The first child is the minimap.
    assert.ok(rulerContainer.children[0]!.classList.contains("minimapComponent"));
    // The second child is the ruler.
    assert.equal(rulerContainer.children[1]!.id, "timelineRulerComponent");
});

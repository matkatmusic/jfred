// The Layer 1 header's "project settings" toggle, tested against the real layer1.html markup.

import { test } from "node:test";
import assert from "node:assert/strict";
import { initLayer1Dom } from "./webapp-dom-test-helpers.ts";
import { installProjectSettingsToggle } from "../webapp/layer1-components/top-bars/layer1-project-settings-toggle.ts";

function readRowsOpen(): boolean {
    return document.querySelector(".appWindow")!.classList.contains("project-settings-open");
}

function readButton(): HTMLButtonElement {
    return document.getElementById("project-settings") as HTMLButtonElement;
}

test("test_the_project_settings_rows_sit_in_the_header_container_and_start_hidden", () => {
    // Scenario: the page opens with the toggle off, and both rows are children [1] and [2] of #headerContainer.
    initLayer1Dom();
    installProjectSettingsToggle();
    // The toggle is off and the button is not marked `.current`.
    assert.equal(readRowsOpen(), false);
    assert.equal(readButton().classList.contains("current"), false);
    // The first child of #headerContainer is the header row, so the rows follow it.
    const headerContainer = document.getElementById("headerContainer")!;
    const jsonlRow = headerContainer.children[1]!;
    const repoRow = headerContainer.children[2]!;
    assert.ok(jsonlRow.classList.contains("sources"));
    assert.equal(jsonlRow.classList.contains("repo"), false);
    assert.ok(repoRow.classList.contains("sources"));
    assert.ok(repoRow.classList.contains("repo"));
    // No `.sources` row sits anywhere else in the page.
    assert.equal(document.querySelectorAll(".sources").length, 2);
});

test("test_the_project_settings_button_follows_the_time_bar", () => {
    // Scenario: the button is its own element right after the `.timebar` div.  Steps: open the real markup.
    initLayer1Dom();
    assert.equal(document.querySelector(".timebar")!.nextElementSibling, readButton());
    assert.equal(readButton().textContent, "project settings");
});

test("test_clicking_the_project_settings_button_shows_then_hides_the_rows", () => {
    // Scenario: the first click shows the rows and marks `.current`; the second click hides them.
    initLayer1Dom();
    installProjectSettingsToggle();
    readButton().click();
    assert.equal(readRowsOpen(), true);
    assert.equal(readButton().classList.contains("current"), true);
    readButton().click();
    assert.equal(readRowsOpen(), false);
    assert.equal(readButton().classList.contains("current"), false);
});

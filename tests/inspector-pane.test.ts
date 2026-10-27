// DOM tests for webapp/inspector-pane.ts: pane open and reset, and the tool-jump buttons.

import { test } from "node:test";
import assert from "node:assert/strict";
import { initWebappDom } from "./webapp-dom-test-helpers.ts";

async function importInspectorPane(): Promise<typeof import("../webapp/inspector-pane.ts")> {
    initWebappDom();
    return import("../webapp/inspector-pane.ts");
}

test("test_openInspectorPane_shows_the_pane_and_labels_the_right_column_json", async () => {
    // Scenario: opening the pane unhides it, drops the drawer modifiers, and hides the diff toggle.
    const { openInspectorPane } = await importInspectorPane();
    const pane = document.getElementById("inspector")!;
    pane.classList.add("hidden", "snapshot-drawer", "file-preview-drawer");
    const body = openInspectorPane();
    assert.equal(pane.classList.contains("hidden"), false);
    assert.equal(pane.classList.contains("snapshot-drawer"), false);
    assert.equal(pane.classList.contains("file-preview-drawer"), false);
    assert.equal(document.getElementById("details-right-label")!.textContent, "JSON");
    assert.equal(document.getElementById("diff-mode-toggle")!.hidden, true);
    assert.equal(body.id, "details-right-body");
});

test("test_openDetailsPane_unhides_without_clearing_the_right_column", async () => {
    // Scenario: diff and file modes unhide the pane and keep whatever they painted.
    const { openDetailsPane } = await importInspectorPane();
    document.getElementById("inspector")!.classList.add("hidden");
    document.getElementById("details-right-body")!.append(document.createElement("span"));
    openDetailsPane();
    assert.equal(document.getElementById("inspector")!.classList.contains("hidden"), false);
    assert.equal(document.getElementById("details-right-body")!.children.length, 1);
});

test("test_appendToolNavigationButtons_adds_a_button_only_for_lines_that_exist", async () => {
    // Scenario: a missing result line (-1) offers only the hook button, and clicking it renders the hook line.
    const { appendToolNavigationButtons } = await importInspectorPane();
    const buttons: HTMLElement[] = [];
    const shownLines: number[] = [];
    appendToolNavigationButtons({ hookLine: 4, resultLine: -1 }, buttons, (line) => shownLines.push(line));
    assert.equal(buttons.length, 1);
    assert.equal(buttons[0]!.textContent, "Go to PreToolUse hook");
    buttons[0]!.click();
    assert.deepEqual(shownLines, [4]);
});

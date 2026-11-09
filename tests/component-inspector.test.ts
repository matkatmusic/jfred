// The component inspector module: toggle, enter, Escape, click blocking, and Copy. happy-dom has no layout, so these test state, not pixels.

import { test } from "node:test";
import assert from "node:assert/strict";
import { Window } from "happy-dom";

const TAGGED_PAGE = `
    <div id="page" data-component="Page">
        <div id="header" data-component="Header"><button id="toggle" data-component-inspector-toggle>names</button></div>
        <button id="pageButton">Run</button>
        <div id="nav" data-component="Nav"><span id="navText"></span></div>
        <div id="rows" data-component-inspector-rows></div>
    </div>`;

const SOURCE_FOR_NAV = { file: "/abs/nav.html", line: 7 };

let copiedTexts: string[] = [];

// A fresh window with the tagged page, a fake source route, and a fake clipboard.
function openPageWithMarkup(markup: string): void {
    const browserWindow = new Window({ url: "http://localhost:7343/" });
    copiedTexts = [];
    Object.assign(globalThis, {
        window: browserWindow,
        document: browserWindow.document,
        fetch: async () => ({ ok: true, json: async () => SOURCE_FOR_NAV }),
    });
    Object.defineProperty(globalThis, "navigator", {
        value: { clipboard: { writeText: async (text: string) => void copiedTexts.push(text) } },
        configurable: true,
    });
    browserWindow.document.body.innerHTML = markup;
}

// Importing starts the module on the first window; each test installs again on its own window.
openPageWithMarkup(TAGGED_PAGE);
const { installComponentInspector } = await import("../webapp/component-inspector/component-inspector.ts");

function startInspector(): void {
    openPageWithMarkup(TAGGED_PAGE);
    installComponentInspector();
}

function clickElement(id: string): void {
    document.getElementById(id)!.dispatchEvent(new window.MouseEvent("click", { bubbles: true, cancelable: true }));
}

function hoverElement(id: string): void {
    document.getElementById(id)!.dispatchEvent(new window.MouseEvent("pointermove", { bubbles: true }));
}

function pressEscape(): void {
    document.dispatchEvent(new window.KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
}

function switchInspectorOn(): void {
    clickElement("toggle");
}

function isOverlayHidden(): boolean {
    return document.querySelector<HTMLElement>(".ci-overlay")!.hidden;
}

test("test_entering_a_part_pushes_it_and_escape_pops_it", () => {
    // Scenario: clicking a candidate enters it; Escape goes back up.
    startInspector();
    switchInspectorOn();
    clickElement("page");
    // Page is entered and the page is zoomed.
    assert.ok(document.getElementById("page")!.classList.contains("ci-entered"));
    assert.ok(document.documentElement.classList.contains("ci-zoomed"));
    // Escape pops the stack: nothing is hidden any more.
    pressEscape();
    assert.ok(!document.getElementById("page")!.classList.contains("ci-entered"));
    assert.ok(!document.documentElement.classList.contains("ci-zoomed"));
});

test("test_entering_a_nested_part_requires_entering_its_parent_first", () => {
    // Scenario: at the root, a click on Nav enters Page (its outermost tagged ancestor), not Nav.
    startInspector();
    switchInspectorOn();
    clickElement("navText");
    assert.ok(document.getElementById("page")!.classList.contains("ci-entered"));
    assert.ok(!document.getElementById("nav")!.classList.contains("ci-entered"));
    // A second click now enters Nav.
    clickElement("navText");
    assert.ok(document.getElementById("nav")!.classList.contains("ci-entered"));
});

test("test_copy_writes_the_name_file_line_hierarchy_text_for_the_stack_top", async () => {
    // Scenario: with Nav entered, the Copy button writes the exact text.
    startInspector();
    switchInspectorOn();
    clickElement("navText");
    clickElement("navText");
    document.querySelector<HTMLElement>(".ci-copy")!.click();
    await new Promise((resolve) => setTimeout(resolve, 0));
    assert.deepEqual(copiedTexts, ["{ Nav, /abs/nav.html, 7, Page.Nav }"]);
});

test("test_while_on_a_click_on_a_page_button_does_not_reach_the_page_listener", () => {
    // Scenario: with the switch on, a page button's own click listener never runs.
    startInspector();
    let pageButtonClicks = 0;
    document.getElementById("pageButton")!.addEventListener("click", () => void pageButtonClicks++);
    switchInspectorOn();
    clickElement("pageButton");
    assert.equal(pageButtonClicks, 0);
});

test("test_while_off_a_click_on_a_page_button_reaches_the_page_listener", () => {
    // Scenario: with the switch off, the page behaves normally.
    startInspector();
    let pageButtonClicks = 0;
    document.getElementById("pageButton")!.addEventListener("click", () => void pageButtonClicks++);
    clickElement("pageButton");
    assert.equal(pageButtonClicks, 1);
});

test("test_hovering_a_page_part_shows_the_overlay", () => {
    // Scenario: the precondition for the next two tests, a tagged part under the pointer shows the overlay.
    startInspector();
    switchInspectorOn();
    hoverElement("navText");
    assert.equal(isOverlayHidden(), false);
});

test("test_hovering_the_toggle_gives_no_candidate", () => {
    // Scenario: the toggle sits inside a tagged header, yet hovering it never shows the overlay.
    startInspector();
    switchInspectorOn();
    hoverElement("navText");
    hoverElement("toggle");
    assert.equal(isOverlayHidden(), true);
});

test("test_hovering_the_rows_gives_no_candidate", () => {
    // Scenario: the rows container sits inside the tagged page, yet hovering it never shows the overlay.
    startInspector();
    switchInspectorOn();
    hoverElement("navText");
    hoverElement("rows");
    assert.equal(isOverlayHidden(), true);
});

test("test_clicking_the_toggle_while_on_turns_it_off", () => {
    // Scenario: the toggle's own click reaches its handler even while the inspector blocks page clicks.
    startInspector();
    let pageButtonClicks = 0;
    document.getElementById("pageButton")!.addEventListener("click", () => void pageButtonClicks++);
    switchInspectorOn();
    clickElement("toggle");
    clickElement("pageButton");
    assert.equal(pageButtonClicks, 1);
});

test("test_the_rows_are_hidden_while_off_and_shown_while_on", () => {
    // Scenario: the rows take page space only while the switch is on.
    startInspector();
    const rows = document.getElementById("rows")!;
    assert.equal(rows.hidden, true);
    switchInspectorOn();
    assert.equal(rows.hidden, false);
    clickElement("toggle");
    assert.equal(rows.hidden, true);
});

test("test_install_throws_when_the_toggle_button_is_missing", () => {
    // Scenario: no fallback; a page without the toggle fails loudly.
    openPageWithMarkup('<div data-component-inspector-rows></div>');
    assert.throws(() => installComponentInspector());
});

test("test_install_throws_when_the_rows_container_is_missing", () => {
    // Scenario: no fallback; a page without the rows container fails loudly.
    openPageWithMarkup("<button data-component-inspector-toggle>names</button>");
    assert.throws(() => installComponentInspector());
});

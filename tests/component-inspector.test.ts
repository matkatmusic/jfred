// The component inspector module: toggle, enter, Escape, click blocking, and Copy. happy-dom has no layout, so these test state, not pixels.

import { mock, test } from "node:test";
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

function doubleClickElement(id: string): void {
    document.getElementById(id)!.dispatchEvent(new window.MouseEvent("dblclick", { bubbles: true, cancelable: true }));
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
    doubleClickElement("page");
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
    doubleClickElement("navText");
    assert.ok(document.getElementById("page")!.classList.contains("ci-entered"));
    assert.ok(!document.getElementById("nav")!.classList.contains("ci-entered"));
    // A second click now enters Nav.
    doubleClickElement("navText");
    assert.ok(document.getElementById("nav")!.classList.contains("ci-entered"));
});

test("test_entering_a_nested_part_whites_out_its_siblings", () => {
    // Scenario: with Nav entered inside Page, Header (a sibling of Nav inside Page) is hidden while Nav stays visible.
    // Turn the inspector on.
    startInspector();
    switchInspectorOn();
    // Enter the outer tagged part, Page.
    doubleClickElement("navText");
    // Enter the nested tagged child of Page, Nav.
    doubleClickElement("navText");
    // Header is a sibling of Nav inside Page: it is hidden; Nav stays visible.
    assert.equal(window.getComputedStyle(document.getElementById("header")!).visibility, "hidden");
    assert.equal(window.getComputedStyle(document.getElementById("nav")!).visibility, "visible");
});

test("test_copy_writes_the_name_file_line_hierarchy_text_for_the_stack_top", async () => {
    // Scenario: with Nav entered, the Copy button writes the exact text.
    startInspector();
    switchInspectorOn();
    doubleClickElement("navText");
    doubleClickElement("navText");
    document.querySelector<HTMLElement>(".ci-copy")!.click();
    await new Promise((resolve) => setTimeout(resolve, 0));
    assert.deepEqual(copiedTexts, ["{ Nav, /abs/nav.html, 7, Page.Nav }"]);
});

const COPIED_TEXT_DURATION_MS = 5000;

function readCopyButtonText(): string {
    return document.querySelector<HTMLElement>(".ci-copy")!.textContent;
}

async function clickCopyAndFlushPromises(): Promise<void> {
    document.querySelector<HTMLElement>(".ci-copy")!.click();
    await new Promise((resolve) => setImmediate(resolve));
}

function startInspectorWithNavEnteredAndFakeTimers(): void {
    startInspector();
    switchInspectorOn();
    doubleClickElement("navText");
    doubleClickElement("navText");
    mock.timers.enable({ apis: ["setTimeout"] });
}

test("test_copy_button_says_copied_right_after_a_click", async () => {
    // Scenario: a successful copy changes the button text from Copy to Copied.
    startInspectorWithNavEnteredAndFakeTimers();
    try {
        assert.equal(readCopyButtonText(), "Copy");
        await clickCopyAndFlushPromises();
        assert.equal(readCopyButtonText(), "Copied");
    }
    finally {
        mock.timers.reset();
    }
});

test("test_copy_button_says_copy_again_after_five_seconds", async () => {
    // Scenario: 5000 ms after the click the button text returns to Copy, and not before.
    startInspectorWithNavEnteredAndFakeTimers();
    try {
        await clickCopyAndFlushPromises();
        mock.timers.tick(COPIED_TEXT_DURATION_MS - 1);
        assert.equal(readCopyButtonText(), "Copied");
        mock.timers.tick(1);
        assert.equal(readCopyButtonText(), "Copy");
    }
    finally {
        mock.timers.reset();
    }
});

test("test_a_second_copy_click_restarts_the_five_seconds", async () => {
    // Scenario: clicking again at 3 s keeps Copied until 5 s after the second click.
    startInspectorWithNavEnteredAndFakeTimers();
    try {
        await clickCopyAndFlushPromises();
        mock.timers.tick(3000);
        await clickCopyAndFlushPromises();
        mock.timers.tick(COPIED_TEXT_DURATION_MS - 1);
        assert.equal(readCopyButtonText(), "Copied");
        mock.timers.tick(1);
        assert.equal(readCopyButtonText(), "Copy");
    }
    finally {
        mock.timers.reset();
    }
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

test("test_hovering_a_scrolled_part_clips_the_overlay_to_its_scroll_window", () => {
    // Scenario: a part scrolled inside an overflow container gets an overlay cut to the container's visible window.
    // Open a page with a scroller (overflow: auto) that holds a tagged part.
    openPageWithMarkup(`
        <button id="toggle" data-component-inspector-toggle>names</button>
        <div id="rows" data-component-inspector-rows></div>
        <div id="scroller" style="overflow: auto">
            <div id="scrolledPart" data-component="ScrolledPart"><span id="scrolledText"></span></div>
        </div>`);
    installComponentInspector();
    // happy-dom reports "" for an unset overflow where a browser reports "visible", so state it on body and html.
    document.body.style.overflow = "visible";
    document.documentElement.style.overflow = "visible";
    // Stub the scroller window at left 100, top 150, right 700, bottom 600.
    document.getElementById("scroller")!.getBoundingClientRect = () => ({ left: 100, top: 150, right: 700, bottom: 600, width: 600, height: 450 }) as DOMRect;
    // Stub the part, scrolled up so its top is above the scroller window: left 120, top -400, right 500, bottom 400.
    document.getElementById("scrolledPart")!.getBoundingClientRect = () => ({ left: 120, top: -400, right: 500, bottom: 400, width: 380, height: 800 }) as DOMRect;
    // Turn the inspector on and hover the text inside the part.
    switchInspectorOn();
    hoverElement("scrolledText");
    // The overlay covers only the visible piece: left 120, top 150 (scroller top), width 380, height 250 (400 - 150).
    const overlay = document.querySelector<HTMLElement>(".ci-overlay")!;
    assert.equal(overlay.style.left, "120px");
    assert.equal(overlay.style.top, "150px");
    assert.equal(overlay.style.width, "380px");
    assert.equal(overlay.style.height, "250px");
});

function readInfoRowText(): string {
    return document.querySelector<HTMLElement>(".ci-info")!.textContent;
}

function readOverlayLabelText(): string {
    return document.querySelector<HTMLElement>(".ci-label")!.textContent;
}

async function flushPromises(): Promise<void> {
    await new Promise((resolve) => setImmediate(resolve));
}

test("test_hovering_a_nested_part_shows_the_deepest_part_in_the_info_row", async () => {
    // Scenario: at the page root the blue box and the info row both show the deepest tagged part, Nav.
    // Turn the inspector on and hover the text inside Nav.
    startInspector();
    switchInspectorOn();
    hoverElement("navText");
    await flushPromises();
    // The info row names the deepest part with its source location.
    assert.equal(readInfoRowText(), "Page.Nav (/abs/nav.html:7)");
    // The blue box shows the same deepest part, Nav.
    assert.equal(readOverlayLabelText(), "Nav");
});

test("test_hovering_a_nested_part_puts_the_box_on_the_deepest_part", () => {
    // Scenario: with nothing entered, the blue box sits on the deepest tagged part under the pointer, like browser inspect-element.
    // Turn the inspector on and hover the text inside Nav, which sits inside Page.
    startInspector();
    switchInspectorOn();
    hoverElement("navText");
    // The box label names the deepest part, Nav, not the outer part, Page.
    assert.equal(readOverlayLabelText(), "Nav");
});

test("test_a_single_click_locks_the_info_row_on_the_clicked_part", async () => {
    // Scenario: after a single click, hovering another part does not change the info row.
    // Turn the inspector on and click the text inside Nav.
    startInspector();
    switchInspectorOn();
    clickElement("navText");
    await flushPromises();
    assert.equal(readInfoRowText(), "Page.Nav (/abs/nav.html:7)");
    // Hover Header: the row stays on Nav.
    hoverElement("header");
    await flushPromises();
    assert.equal(readInfoRowText(), "Page.Nav (/abs/nav.html:7)");
});

test("test_a_single_click_does_not_enter_the_part", () => {
    // Scenario: a single click locks the row but the page does not white out.
    startInspector();
    switchInspectorOn();
    clickElement("navText");
    assert.ok(!document.documentElement.classList.contains("ci-zoomed"));
    assert.equal(document.querySelector(".ci-entered"), null);
});

test("test_a_double_click_enters_the_hovered_candidate", () => {
    // Scenario: a double click enters the candidate, one level below the entered part.
    startInspector();
    switchInspectorOn();
    // Hover the text inside Nav: the candidate is Page.
    hoverElement("navText");
    doubleClickElement("navText");
    // Page is entered and the page is zoomed.
    assert.ok(document.getElementById("page")!.classList.contains("ci-entered"));
    assert.ok(document.documentElement.classList.contains("ci-zoomed"));
});

test("test_a_double_click_removes_the_lock", async () => {
    // Scenario: entering a part drops the lock, so the row shows the new stack top.
    startInspector();
    switchInspectorOn();
    // Lock Nav with a single click.
    clickElement("navText");
    await flushPromises();
    assert.equal(readInfoRowText(), "Page.Nav (/abs/nav.html:7)");
    // Enter Page with a double click.
    doubleClickElement("navText");
    await flushPromises();
    assert.equal(readInfoRowText(), "Page (/abs/nav.html:7)");
});

test("test_escape_removes_the_lock_before_leaving_an_entered_part", async () => {
    // Scenario: with Page entered and Nav locked, the first Escape unlocks and the second leaves Page.
    startInspector();
    switchInspectorOn();
    // Enter Page with a double click.
    doubleClickElement("navText");
    // Lock Nav with a single click.
    clickElement("navText");
    await flushPromises();
    assert.equal(readInfoRowText(), "Page.Nav (/abs/nav.html:7)");
    // The first Escape removes the lock only: the row shows the stack top and Page stays entered.
    pressEscape();
    await flushPromises();
    assert.equal(readInfoRowText(), "Page (/abs/nav.html:7)");
    assert.ok(document.getElementById("page")!.classList.contains("ci-entered"));
    // The second Escape leaves Page.
    pressEscape();
    assert.equal(document.querySelector(".ci-entered"), null);
});

test("test_turning_the_inspector_off_removes_the_lock", async () => {
    // Scenario: a lock does not survive switching the inspector off and on.
    startInspector();
    switchInspectorOn();
    // Lock Nav with a single click.
    clickElement("navText");
    // Switch off and on again.
    clickElement("toggle");
    switchInspectorOn();
    // The row follows the mouse again.
    hoverElement("header");
    await flushPromises();
    assert.equal(readInfoRowText(), "Page.Header (/abs/nav.html:7)");
});

test("test_copy_writes_the_locked_part_text", async () => {
    // Scenario: with Nav locked at the page root, Copy writes Nav, not the stack top.
    startInspector();
    switchInspectorOn();
    clickElement("navText");
    await flushPromises();
    await clickCopyAndFlushPromises();
    assert.deepEqual(copiedTexts, ["{ Nav, /abs/nav.html, 7, Page.Nav }"]);
});

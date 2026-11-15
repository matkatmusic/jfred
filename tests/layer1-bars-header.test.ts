import assert from "node:assert/strict";
import { test } from "node:test";
import {
    describeFilesDoneStatus,
    describeLoadingHeader,
    describeSelectedHeader,
    setBarsHeaderLine,
    setBarsStatusLine,
    showBarsReadBar,
} from "../webapp/layer1-components/bars-view/layer1-bars-header.ts";
import { initBarsDom } from "./layer1-bars-test-helpers.ts";

test("test_the_loading_header_names_the_file_count_when_it_is_known", () => {
    // Ask for the loading header with 12 files.
    const headerText = describeLoadingHeader(12);
    // The text names the 12 files.
    assert.equal(headerText, "Loading change history for 12 files");
});

test("test_the_loading_header_has_no_count_before_the_first_line", () => {
    // Ask for the loading header with no file count yet.
    const headerText = describeLoadingHeader(undefined);
    // The text has no count.
    assert.equal(headerText, "Loading change history");
});

test("test_the_files_done_status_reads_c_of_n_files_done", () => {
    // Ask for the status with 3 done of 12.
    const statusText = describeFilesDoneStatus(3, 12);
    // The text reads "3 of 12 files done".
    assert.equal(statusText, "3 of 12 files done");
});

test("test_the_selected_header_names_the_row_text", () => {
    // Ask for the selected header with 5 files and the row text "Nov 13, 10:00".
    const headerText = describeSelectedHeader(5, "Nov 13, 10:00");
    // The text names the file count and the row text.
    assert.equal(headerText, "Change history of 5 files, back to Nov 13, 10:00");
});

test("test_setting_the_header_line_writes_an_arrow_and_the_text", () => {
    // Start with the bars page markup.
    initBarsDom();
    // Set the header line text.
    setBarsHeaderLine("Loading change history");
    // The line holds the green arrow span, then a space, then the text.
    const headerLine = document.getElementById("barsHeaderLine") as HTMLElement;
    const arrow = headerLine.querySelector("span.barsArrow") as HTMLElement;
    assert.equal(arrow.textContent, "==>");
    assert.equal(arrow.getAttribute("data-component"), "barsArrow");
    assert.equal(headerLine.textContent, "==> Loading change history");
    // Setting again replaces the old content.
    setBarsHeaderLine("Second text");
    assert.equal(headerLine.textContent, "==> Second text");
    assert.equal(headerLine.querySelectorAll("span.barsArrow").length, 1);
});

test("test_setting_the_status_line_writes_an_arrow_and_the_text", () => {
    // Start with the bars page markup.
    initBarsDom();
    // Set the status line text.
    setBarsStatusLine("3 of 12 files done");
    // The line holds the green arrow span, then a space, then the text.
    const statusLine = document.getElementById("barsStatusLine") as HTMLElement;
    const arrow = statusLine.querySelector("span.barsArrow") as HTMLElement;
    assert.equal(arrow.textContent, "==>");
    assert.equal(statusLine.textContent, "==> 3 of 12 files done");
    // The header line stays empty.
    assert.equal((document.getElementById("barsHeaderLine") as HTMLElement).textContent, "");
});

test("test_showing_the_read_bar_removes_hidden_and_hiding_adds_it", () => {
    // Start with the bars page markup: the read bar is hidden.
    initBarsDom();
    const readBar = document.getElementById("barsReadBar") as HTMLElement;
    assert.equal(readBar.hasAttribute("hidden"), true);
    // Show the bar: the hidden attribute goes away.
    showBarsReadBar(true);
    assert.equal(readBar.hasAttribute("hidden"), false);
    // Hide the bar: the hidden attribute comes back.
    showBarsReadBar(false);
    assert.equal(readBar.hasAttribute("hidden"), true);
});

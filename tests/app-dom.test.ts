// DOM tests for webapp/app-dom.ts: the el() builder's attribute handling and the shared getInputById helper (task 159).

import { test } from "node:test";
import assert from "node:assert/strict";
import { setupWebappDom } from "./webapp-dom-test-helpers.ts";

test("test_el_builds_element_with_class_text_listener_and_children", async () => {
    // Scenario: el() maps class/text to properties, on* to listeners, everything else to attributes, and appends children in order.
    setupWebappDom();
    const { el } = await import("../webapp/app-dom.ts");
    let clickCount = 0;
    const child = el("span", { text: "inner" });
    const node = el("div", { class: "outer", title: "tip", onclick: () => { clickCount += 1; } }, [child, "tail"]);
    assert.equal(node.className, "outer");
    assert.equal(node.getAttribute("title"), "tip");
    assert.equal(node.childNodes.length, 2);
    assert.equal(node.textContent, "innertail");
    node.click();
    assert.equal(clickCount, 1);
});

test("test_getInputById_resolves_input_elements_by_id", async () => {
    // Scenario (task 159): getInputById resolves an index.html input whose value round-trips.
    setupWebappDom();
    const { getInputById } = await import("../webapp/app-dom.ts");
    const input = getInputById("projects-dir-input");
    input.value = "/tmp/somewhere";
    assert.equal(getInputById("projects-dir-input").value, "/tmp/somewhere");
});

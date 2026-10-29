// DOM tests for webapp/inspector-json.ts: highlighted-JSON spans, jump-links, long-value collapse.

import { test } from "node:test";
import assert from "node:assert/strict";
import { initWebappDom } from "./webapp-dom-test-helpers.ts";

async function importInspectorJson(): Promise<typeof import("../webapp/inspector-json.ts")> {
    initWebappDom();
    return import("../webapp/inspector-json.ts");
}

const EMPTY_MAPS = { uuidToLine: new Map<string, number>(), toolIdToLines: new Map<string, number[]>() };

test("test_renderHighlightedJson_wraps_each_token_kind_in_a_class_span", async () => {
    // Scenario: key, string, number, bool and null tokens each get their own class.
    const { renderHighlightedJson } = await importInspectorJson();
    const text = '{"a": "x", "b": 1, "c": true, "d": null}';
    const pre = renderHighlightedJson(text, JSON.parse(text), 1, EMPTY_MAPS, () => {}, [], () => {});
    assert.equal(pre.querySelectorAll(".json-key").length, 4);
    assert.equal(pre.querySelectorAll(".json-string").length, 1);
    assert.equal(pre.querySelectorAll(".json-number").length, 1);
    assert.equal(pre.querySelectorAll(".json-bool").length, 1);
    assert.equal(pre.querySelectorAll(".json-null").length, 1);
    assert.equal(pre.textContent, text);
});

test("test_renderHighlightedJson_links_uuid_value_to_its_line", async () => {
    // Scenario: a string equal to a known uuid becomes a jump-link calling showLine.
    const { renderHighlightedJson } = await importInspectorJson();
    const maps = { uuidToLine: new Map([["u-1", 4]]), toolIdToLines: new Map<string, number[]>() };
    const shown: number[] = [];
    const text = '{"parentUuid": "u-1"}';
    const pre = renderHighlightedJson(text, JSON.parse(text), 9, maps, (line) => shown.push(line), [], () => {});
    (pre.querySelector(".jump-link") as HTMLElement).click();
    assert.deepEqual(shown, [4]);
});

test("test_renderHighlightedJson_collapses_long_string_behind_toggle", async () => {
    // Scenario: a string past the limit renders collapsed with a toggle button.
    const { renderHighlightedJson } = await importInspectorJson();
    const text = JSON.stringify({ a: "x".repeat(600) });
    const pre = renderHighlightedJson(text, JSON.parse(text), 1, EMPTY_MAPS, () => {}, [], () => {});
    assert.equal(pre.querySelectorAll(".json-collapsed").length, 1);
    (pre.querySelector(".json-expand") as HTMLElement).click();
    assert.equal(pre.querySelectorAll(".json-collapsed").length, 0);
});

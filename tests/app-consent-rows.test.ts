// DOM tests for webapp/app-consent-rows.ts: script rows, Expand buttons, and read-only blocks.

import { test } from "node:test";
import assert from "node:assert/strict";
import { initWebappDom } from "./webapp-dom-test-helpers.ts";

const LONG_CODE = Array.from({ length: 20 }, (_unused, index) => `print(${index})`).join("\n");

async function importRowsInFreshDom(): Promise<typeof import("../webapp/app-consent-rows.ts")> {
    initWebappDom();
    return import("../webapp/app-consent-rows.ts");
}

test("test_buildConsentScriptRow_adds_expand_button_only_for_long_code", async () => {
    // Scenario: a short script needs no Expand button; a script over the preview capacity gets one.
    const { buildConsentScriptRow } = await importRowsInFreshDom();
    const shortRow = buildConsentScriptRow({ timestamp: "2026-01-01T00:00:00Z", code: "print(1)" });
    const longRow = buildConsentScriptRow({ timestamp: "2026-01-01T00:00:00Z", code: LONG_CODE });
    assert.equal(shortRow.querySelector("button"), null);
    assert.equal(longRow.querySelector("button")!.textContent, "Expand");
});

test("test_expand_button_click_toggles_preview_and_label", async () => {
    // Scenario: clicking Expand marks the pre expanded and relabels the button Collapse; a second click undoes both.
    const { buildConsentScriptRow } = await importRowsInFreshDom();
    const row = buildConsentScriptRow({ timestamp: "2026-01-01T00:00:00Z", code: LONG_CODE });
    const button = row.querySelector("button")!;
    button.click();
    assert.ok(row.querySelector("pre")!.classList.contains("expanded"));
    assert.equal(button.textContent, "Collapse");
    button.click();
    assert.ok(!row.querySelector("pre")!.classList.contains("expanded"));
    assert.equal(button.textContent, "Expand");
});

test("test_appendReadOnlyScriptsBlock_adds_one_closed_block_with_a_row_per_script", async () => {
    // Scenario: a run of two read-only scripts becomes one closed details block holding two rows.
    const { appendReadOnlyScriptsBlock } = await importRowsInFreshDom();
    const box = document.createElement("div");
    appendReadOnlyScriptsBlock(box, [{ timestamp: "2026-01-01T00:00:00Z", code: "a" }, { timestamp: "2026-01-01T00:00:01Z", code: "b" }]);
    const blocks = box.querySelectorAll("details.consent-readonly-block");
    assert.equal(blocks.length, 1);
    assert.equal((blocks[0] as HTMLDetailsElement).open, false);
    assert.equal(blocks[0]!.querySelectorAll(".consent-script").length, 2);
    assert.match(blocks[0]!.querySelector("summary")!.textContent!, /2 readonly script\(s\)/);
});

test("test_toggleReadOnlyBlocksVisibility_opens_all_when_any_closed_then_closes_all", async () => {
    // Scenario: with one block open and one closed, toggling opens both; toggling again closes both.
    const { appendReadOnlyScriptsBlock, toggleReadOnlyBlocksVisibility, listReadOnlyBlocks } = await importRowsInFreshDom();
    const box = document.createElement("div");
    appendReadOnlyScriptsBlock(box, [{ timestamp: "2026-01-01T00:00:00Z", code: "a" }]);
    appendReadOnlyScriptsBlock(box, [{ timestamp: "2026-01-01T00:00:01Z", code: "b" }]);
    const blocks = listReadOnlyBlocks(box);
    blocks[0]!.open = true;
    toggleReadOnlyBlocksVisibility(box);
    assert.deepEqual([blocks[0]!.open, blocks[1]!.open], [true, true]);
    toggleReadOnlyBlocksVisibility(box);
    assert.deepEqual([blocks[0]!.open, blocks[1]!.open], [false, false]);
});

test("test_updateRowExpandButtonLabel_relabels_the_row_button", async () => {
    // Scenario: the row's button reads Collapse when expanded and Expand otherwise.
    const { buildConsentScriptRow, updateRowExpandButtonLabel } = await importRowsInFreshDom();
    const row = buildConsentScriptRow({ timestamp: "2026-01-01T00:00:00Z", code: LONG_CODE });
    const pre = row.querySelector("pre")!;
    updateRowExpandButtonLabel(pre, true);
    assert.equal(row.querySelector("button")!.textContent, "Collapse");
    updateRowExpandButtonLabel(pre, false);
    assert.equal(row.querySelector("button")!.textContent, "Expand");
});

// DOM tests for webapp/app-consent-toggle-all.ts: the Expand All / Collapse All button.

import { test } from "node:test";
import assert from "node:assert/strict";
import { initWebappDom } from "./webapp-dom-test-helpers.ts";

const LONG_CODE = Array.from({ length: 20 }, (_unused, index) => `print(${index})`).join("\n");

// A box holding one long modifying row and one read-only block, with the button attached.
async function attachToggleAllInFreshDom(): Promise<{ box: HTMLElement; button: HTMLButtonElement }> {
    initWebappDom();
    const { buildConsentScriptRow, appendReadOnlyScriptsBlock } = await import("../webapp/app-consent-rows.ts");
    const { attachToggleAllButton } = await import("../webapp/app-consent-toggle-all.ts");
    const box = document.createElement("div");
    box.append(buildConsentScriptRow({ timestamp: "2026-01-01T00:00:00Z", code: LONG_CODE }));
    appendReadOnlyScriptsBlock(box, [{ timestamp: "2026-01-01T00:00:01Z", code: "a", readOnly: true }]);
    const button = document.createElement("button");
    attachToggleAllButton(box, button);
    return { box, button };
}

test("test_attachToggleAllButton_starts_as_expand_all", async () => {
    // Scenario: with a collapsed preview and a closed block, the label offers Expand All.
    const { button } = await attachToggleAllInFreshDom();
    assert.equal(button.textContent, "Expand All");
});

test("test_toggle_all_click_expands_everything_then_collapses_everything", async () => {
    // Scenario: one click opens the preview and the block and relabels Collapse All; the next click undoes it.
    const { box, button } = await attachToggleAllInFreshDom();
    const pre = box.querySelector(".consent-script pre")!;
    const block = box.querySelector("details.consent-readonly-block") as HTMLDetailsElement;
    button.click();
    assert.ok(pre.classList.contains("expanded"));
    assert.equal(block.open, true);
    assert.equal(button.textContent, "Collapse All");
    button.click();
    assert.ok(!pre.classList.contains("expanded"));
    assert.equal(block.open, false);
    assert.equal(button.textContent, "Expand All");
});

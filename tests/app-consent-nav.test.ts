// DOM tests for webapp/app-consent-nav.ts: the Prev/Next selection over visible consent rows.

import { test } from "node:test";
import assert from "node:assert/strict";
import { initWebappDom } from "./webapp-dom-test-helpers.ts";

// A box of three modifying rows plus the three nav controls, attached and ready.
async function attachNavInFreshDom(): Promise<{ box: HTMLElement; prev: HTMLButtonElement; next: HTMLButtonElement; counter: HTMLElement }> {
    initWebappDom();
    const { attachConsentNavigation } = await import("../webapp/app-consent-nav.ts");
    const box = document.createElement("div");
    const scripts = [];
    for (let index = 0; index < 3; index++) {
        const row = document.createElement("div");
        row.className = "consent-script";
        box.append(row);
        scripts.push({ timestamp: "2026-01-01T00:00:00Z", code: `print(${index})` });
    }
    const prev = document.createElement("button");
    const next = document.createElement("button");
    const counter = document.createElement("span");
    attachConsentNavigation(box, scripts, { prevButton: prev, nextButton: next, navCounter: counter });
    return { box, prev, next, counter };
}

test("test_attachConsentNavigation_selects_first_row_and_disables_prev", async () => {
    // Scenario: on attach the first modifying row is selected, the counter reads 1 of 3, and Prev is disabled.
    const { box, prev, next, counter } = await attachNavInFreshDom();
    assert.ok(box.querySelectorAll(".consent-script")[0]!.classList.contains("consent-selected"));
    assert.equal(counter.textContent, "Script 1 of 3");
    assert.equal(prev.disabled, true);
    assert.equal(next.disabled, false);
});

test("test_next_click_moves_selection_and_clamps_at_the_last_row", async () => {
    // Scenario: Next twice reaches the last row and disables Next; a third click stays put.
    const { box, next, counter } = await attachNavInFreshDom();
    next.click();
    next.click();
    next.click();
    assert.ok(box.querySelectorAll(".consent-script")[2]!.classList.contains("consent-selected"));
    assert.equal(counter.textContent, "Script 3 of 3");
    assert.equal(next.disabled, true);
});

test("test_prev_click_moves_selection_back", async () => {
    // Scenario: Next then Prev returns the selection to the first row.
    const { box, prev, next } = await attachNavInFreshDom();
    next.click();
    prev.click();
    assert.ok(box.querySelectorAll(".consent-script")[0]!.classList.contains("consent-selected"));
});

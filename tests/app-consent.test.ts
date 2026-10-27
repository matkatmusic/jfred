// DOM tests for webapp/app-consent.ts: the consent dialog renders its header, rows, and stores the choice.

import { test } from "node:test";
import assert from "node:assert/strict";
import { initWebappDom } from "./webapp-dom-test-helpers.ts";
import { stubFetchRoutes } from "./webapp-fetch-test-helpers.ts";

const SCRIPTS = [
    { timestamp: "2026-01-01T00:00:00Z", code: "print(1)" },
    { timestamp: "2026-01-01T00:00:01Z", code: "ls", readOnly: true },
];

async function renderDialogInFreshDom(): Promise<HTMLElement> {
    initWebappDom();
    stubFetchRoutes({ "/api/projects": [] });
    const { renderConsentDialog } = await import("../webapp/app-consent.ts");
    const container = document.createElement("div");
    renderConsentDialog(container, "proj-a", SCRIPTS);
    return container;
}

test("test_renderConsentDialog_shows_counts_rows_and_hides_the_skeleton_toggle", async () => {
    // Scenario: one modifying plus one read-only script yields the split heading, a Show/hide button, and both rows.
    const container = await renderDialogInFreshDom();
    assert.match(container.querySelector("h2")!.textContent!, /2 recorded script execution\(s\) — 1 modifying, 1 read-only/);
    assert.equal(container.querySelectorAll(".consent-script").length, 2);
    assert.equal(container.querySelectorAll("details.consent-readonly-block").length, 1);
    assert.equal((document.getElementById("toggle-all") as HTMLButtonElement).hidden, true);
});

test("test_continue_button_stores_a_declined_choice", async () => {
    // Scenario: Continue without running records "0" for the project in sessionStorage.
    const container = await renderDialogInFreshDom();
    const buttons = [...container.querySelectorAll("button")];
    const continueButton = buttons.find((button) => button.textContent === "Continue without running")!;
    continueButton.click();
    assert.equal(sessionStorage.getItem("consent:proj-a"), "0");
});

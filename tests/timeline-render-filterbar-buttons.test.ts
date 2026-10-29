// Filter bar button helpers: exactly one button carries the active class.

import { test } from "node:test";
import assert from "node:assert/strict";
import { initWebappDom } from "./webapp-dom-test-helpers.ts";

test("test_mark_active_button_activates_only_the_chosen_button", async () => {
    initWebappDom();
    const { markActiveButton, ACTIVE_BUTTON_CLASS } = await import("../webapp/views/timeline-render-filterbar-buttons.ts");
    const first = document.createElement("button");
    const second = document.createElement("button");
    first.classList.add(ACTIVE_BUTTON_CLASS);
    markActiveButton([first, second], second);
    assert.equal(first.classList.contains(ACTIVE_BUTTON_CLASS), false);
    assert.equal(second.classList.contains(ACTIVE_BUTTON_CLASS), true);
});

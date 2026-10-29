// Filter bar: rendering builds the search input, hides the search chrome, and unhides the bar.

import { test } from "node:test";
import assert from "node:assert/strict";
import { initWebappDom } from "./webapp-dom-test-helpers.ts";

test("test_render_timeline_filter_bar_starts_with_chrome_hidden", async () => {
    initWebappDom();
    const { renderTimelineFilterBar } = await import("../webapp/views/timeline-render-filterbar.ts");
    for (const id of ["all-lines-btn", "reask-baseline-btn"]) {
        const existing = document.getElementById(id);
        if (existing === null) {
            const button = document.createElement("button");
            button.id = id;
            document.body.appendChild(button);
        }
    }
    const bar = document.createElement("div");
    bar.hidden = true;
    const context = { nodes: [], nodeRows: new Map(), project: "p", reconstructionDocument: { sessionTitles: {} } };
    renderTimelineFilterBar(context as never, bar);
    assert.equal(bar.hidden, false);
    assert.equal(bar.querySelectorAll(".search-step").length, 2);
    assert.equal((bar.querySelector(".search-clear") as HTMLElement).hidden, true);
    assert.equal(bar.querySelectorAll(".toolbar-btn.active").length, 1);
});
